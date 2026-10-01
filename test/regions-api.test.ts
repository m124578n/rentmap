import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { signSession, SESSION_COOKIE } from "../src/worker/auth";
import type { GarbageFit, NearbyResponse, PoiIn } from "../src/shared/poi";
import type { BusRouteIn, BusStopIn } from "../src/shared/bus";
import type { HazardResponse } from "../src/shared/hazard";
import type { CommuteMatrix } from "../src/shared/trip";

// 北區以外的生活圈:各自那份網格 / 公車網路,北區不受影響
const ORIGIN = "http://localhost:5173";
let cookie = "";
const authed = (init: RequestInit = {}) => ({ ...init, headers: { Cookie: cookie, Origin: ORIGIN, "Content-Type": "application/json" } });
const ingest = (path: string, body: unknown) =>
  SELF.fetch(`${ORIGIN}/api/ingest/${path}`, { method: "POST", headers: { Authorization: "Bearer test-ingest", "Content-Type": "application/json" }, body: JSON.stringify(body) });
const get = async <T>(path: string) => (await (await SELF.fetch(`${ORIGIN}${path}`, authed())).json()) as T;

const TC = { lat: 24.16, lng: 120.65 }; // 台中西屯
const poi = (key: string, category: PoiIn["category"], lat: number, lng: number, extra: Partial<PoiIn> = {}): PoiIn => ({ key, category, subtype: null, name: key, lat, lng, rating: null, url: null, ...extra });

beforeAll(async () => {
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO users (provider, provider_id, display_name, created_at, last_login_at) VALUES ('google','sub-1','T',?,?)").bind(now, now).run();
  cookie = `${SESSION_COOKIE}=${await signSession({ id: 1, name: "T", avatar: null }, "test-secret")}`;
  await ingest("pois", {
    version: "r1",
    items: [
      poi("tc-c1", "convenience", TC.lat + 0.001, TC.lng),
      poi("tc-c2", "convenience", TC.lat - 0.002, TC.lng),
      poi("tc-g1", "garbage", TC.lat + 0.0015, TC.lng, { minute: 19 * 60, days: 0b0111110, note: "19:00" }),
      poi("tp-c1", "convenience", 25.04, 121.5),
    ],
  });
  for (const category of ["convenience", "garbage"]) await ingest("pois/commit", { version: "r1", category });
});

describe("台中:生活機能、垃圾車走台中那份網格", () => {
  it("/api/nearby 在台中只算台中的點;台北的另外一份", async () => {
    const tc = await get<NearbyResponse>(`/api/nearby?lat=${TC.lat}&lng=${TC.lng}&radius=500`);
    expect(tc.counts).toMatchObject({ convenience: 2, garbage: 1 });
    const tp = await get<NearbyResponse>(`/api/nearby?lat=25.04&lng=121.5&radius=500`);
    expect(tp.counts).toEqual({ convenience: 1 });
  });

  it("/api/garbage/fit 台中的房源找得到台中的垃圾車", async () => {
    const r = await SELF.fetch(
      `${ORIGIN}/api/properties`,
      authed({ method: "POST", body: JSON.stringify({ title: "台中套房", city: "台中市", district: "西屯區", rent: 9000, lat: TC.lat, lng: TC.lng }) }),
    );
    const { id } = (await r.json()) as { id: number };
    const fit = await get<GarbageFit>(`/api/garbage/fit?max=300&after=18:00`);
    expect(fit.items[id]).toMatchObject({ ok: true, best: { minute: 19 * 60 } });
  });
});

describe("災害:沒有圖資的項目回「無資料」", () => {
  it("台中沒有液化、航空噪音;台南有液化沒有航空噪音", async () => {
    const tc = await get<HazardResponse>(`/api/hazards?lat=${TC.lat}&lng=${TC.lng}&city=${encodeURIComponent("台中市")}`);
    expect(tc.no_coverage).toEqual(["liquefaction", "airnoise"]);
    const tn = await get<HazardResponse>(`/api/hazards?lat=22.99&lng=120.21&city=${encodeURIComponent("臺南市")}`);
    expect(tn.no_coverage).toEqual(["airnoise"]);
    const tp = await get<HazardResponse>(`/api/hazards?lat=25.04&lng=121.5&city=${encodeURIComponent("台北市")}`);
    expect(tp.no_coverage).toEqual([]);
  });
});

describe("高雄:通勤載高雄的公車網路", () => {
  // 一條東西向的高雄公車:22.70 緯度,每站往東約 200m
  const LAT = 22.7;
  const lngAt = (i: number) => 120.33 + i * 0.002;
  const route: BusRouteIn = {
    key: "KH1:0",
    route_uid: "KH1",
    name: "紅99",
    city: "Kaohsiung",
    direction: 0,
    from_name: "起點",
    to_name: "終點",
    stop_count: 10,
    length_m: 2000,
    shape: [
      [lngAt(0), LAT],
      [lngAt(9), LAT],
    ],
    schedule: { wd: { bands: [{ s: "06:00", e: "22:00", min: 10, max: 15 }] } },
  };
  const stops: BusStopIn[] = Array.from({ length: 10 }, (_, i) => ({
    route_key: "KH1:0",
    seq: i + 1,
    stop_uid: `KH1-${i}`,
    station_id: null,
    name: `高雄站${i}`,
    lat: LAT,
    lng: lngAt(i),
    dist_m: i * 200,
    t_min: i * 2,
  }));

  it("高雄的房源 × 高雄的地點搭得到;北區的通勤看不到高雄公車", async () => {
    await ingest("bus/routes", { version: "kh1", items: [route] });
    await ingest("bus/stops", { version: "kh1", items: stops });
    expect((await ingest("bus/commit", { version: "kh1", cities: ["Kaohsiung"] })).status).toBe(200);
    await SELF.fetch(`${ORIGIN}/api/places`, authed({ method: "POST", body: JSON.stringify({ name: "高雄公司", lat: LAT, lng: lngAt(8) }) }));
    const r = await SELF.fetch(
      `${ORIGIN}/api/properties`,
      authed({ method: "POST", body: JSON.stringify({ title: "高雄套房", city: "高雄市", district: "鳳山區", rent: 8000, lat: LAT + 0.0003, lng: lngAt(1) }) }),
    );
    const { id } = (await r.json()) as { id: number };

    const kh = await get<CommuteMatrix>(`/api/commute?region=kaohsiung&radius=300`);
    expect(kh.has_bus).toBe(true);
    const trip = Object.values(kh.items[id]!)[0]!;
    expect(trip).toMatchObject({ kind: "bus", summary: "紅99" });

    const north = await get<CommuteMatrix>(`/api/commute?region=north&radius=300`);
    expect(north.has_bus).toBe(false);
    expect(north.items[id]).toBeUndefined(); // 高雄的房源不在北區的矩陣裡
  });
});
