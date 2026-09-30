import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { signSession, SESSION_COOKIE } from "../src/worker/auth";
import type { HazardResponse, HazardSummary, HazardZoneIn, HazardZones } from "../src/shared/hazard";

const ORIGIN = "http://localhost:5173";
let cookie = "";
const ingestHeaders = { Authorization: "Bearer test-ingest", "Content-Type": "application/json" };
const authed = () => ({ headers: { Cookie: cookie, Origin: ORIGIN } });
const post = (path: string, body: unknown) => SELF.fetch(`${ORIGIN}/api/ingest/${path}`, { method: "POST", headers: ingestHeaders, body: JSON.stringify(body) });

/** 以 (lat, lng) 為中心、半邊 d 度的方形 ring */
const square = (lat: number, lng: number, d: number): [number, number][] => [
  [lng - d, lat - d],
  [lng + d, lat - d],
  [lng + d, lat + d],
  [lng - d, lat + d],
  [lng - d, lat - d],
];
const zone = (kind: HazardZoneIn["kind"], level: number, rings: [number, number][][]): HazardZoneIn => ({ kind, level, city: "台北市", rings });
const LAT = 25.05;
const LNG = 121.52;
let inside = 0;
let hole = 0;

beforeAll(async () => {
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO users (provider, provider_id, display_name, email, created_at, last_login_at) VALUES ('google','sub-1','Tester','tester@example.com',?,?)",
  )
    .bind(now, now)
    .run();
  cookie = `${SESSION_COOKIE}=${await signSession({ id: 1, name: "Tester", avatar: null }, "test-secret")}`;
  const listing = (id: string, lat: number, lng: number) => ({ source: "591", source_listing_id: id, source_url: `https://rent.591.com.tw/${id}`, title: id, city: "台北市", district: "中山區", rent: 20000, lat, lng });
  const res = await post("listings", { items: [listing("in", LAT + 0.004, LNG), listing("hole", LAT, LNG)] });
  [inside, hole] = ((await res.json()) as { ids: number[] }).ids as [number, number];
});

describe("hazards", () => {
  it("ingest + commit; point in polygon, holes, worst level wins", async () => {
    const items = [
      // 淹水颱風情境:大方形(0.5–1m)中間挖一個洞
      zone("flood24", 2, [square(LAT, LNG, 0.006), square(LAT, LNG, 0.002)]),
      // 同一區還有一塊更深的(1–2m)小方形,在洞外
      zone("flood24", 3, [square(LAT + 0.004, LNG, 0.001)]),
      zone("liquefaction", 3, [square(LAT, LNG, 0.01)]),
    ];
    expect((await post("hazards", { version: "v1", items })).status).toBe(200);
    expect((await post("hazards/commit", { version: "v1" })).status).toBe(200);

    const at = async (lat: number, lng: number) => (await (await SELF.fetch(`${ORIGIN}/api/hazards?lat=${lat}&lng=${lng}`, authed())).json()) as HazardResponse;
    expect((await at(LAT + 0.004, LNG)).levels).toEqual({ flood24: 3, liquefaction: 3 });
    expect((await at(LAT, LNG)).levels).toEqual({ liquefaction: 3 }); // 在洞裡:不淹
    expect((await at(LAT + 0.005, LNG + 0.005)).levels).toEqual({ flood24: 2, liquefaction: 3 });
    expect((await at(25.3, 121.9)).levels).toEqual({});
    // 新北市的點:液化「沒有資料」而不是「沒有潛勢」
    const ntpc = (await (await SELF.fetch(`${ORIGIN}/api/hazards?lat=25.012&lng=121.465&city=${encodeURIComponent("新北市")}`, authed())).json()) as HazardResponse;
    expect(ntpc.no_coverage).toEqual(["liquefaction"]);
    expect((await at(LAT, LNG)).no_coverage).toEqual([]);

    const s = (await (await SELF.fetch(`${ORIGIN}/api/hazards/summary`, authed())).json()) as HazardSummary;
    expect(s.items[inside]).toEqual({ flood24: 3, liquefaction: 3 });
    expect(s.items[hole]).toEqual({ liquefaction: 3 });
  });

  it("summary is cached until listings or zones change", async () => {
    const get = () => SELF.fetch(`${ORIGIN}/api/hazards/summary`, authed());
    await get();
    const hit = await get();
    expect(hit.headers.get("x-cache")).toBe("hit");
    expect(hit.headers.get("cache-control")).toContain("no-store");
    // 新房源 → 版本變了,重算且算得到新的那間
    const listing = { source: "591", source_listing_id: "new", source_url: "https://rent.591.com.tw/new", title: "new", city: "台北市", district: "中山區", rent: 20000, lat: LAT, lng: LNG };
    const { ids } = (await (await post("listings", { items: [listing] })).json()) as { ids: number[] };
    const miss = await get();
    expect(miss.headers.get("x-cache")).toBe("miss");
    expect(((await miss.json()) as HazardSummary).items[ids[0]!]).toEqual({ liquefaction: 3 });
  });

  it("zones in a viewport as GeoJSON; too big a viewport returns nothing", async () => {
    const zones = async (q: string) => (await (await SELF.fetch(`${ORIGIN}/api/hazards/zones?${q}`, authed())).json()) as HazardZones;
    const near = await zones(`kind=flood24&w=${LNG - 0.01}&s=${LAT - 0.01}&e=${LNG + 0.01}&n=${LAT + 0.01}`);
    expect(near.too_big).toBe(false);
    expect(near.features.map((f) => f.properties.level).sort()).toEqual([2, 3]);
    expect(near.features[0]!.geometry.coordinates.length).toBeGreaterThan(0);
    expect((await zones(`kind=flood24&w=121.9&s=25.3&e=121.95&n=25.35`)).features).toEqual([]);
    expect((await zones(`kind=flood24&w=121&s=24.6&e=122&n=25.4`)).too_big).toBe(true);
    expect((await SELF.fetch(`${ORIGIN}/api/hazards/zones?kind=bogus&w=1&s=1&e=2&n=2`, authed())).status).toBe(400);
  });

  it("commit refuses a much smaller re-import unless forced", async () => {
    await post("hazards", { version: "v2", items: [zone("flood6", 1, [square(LAT, LNG, 0.001)])] });
    expect((await post("hazards/commit", { version: "v2" })).status).toBe(409);
    expect((await post("hazards/commit", { version: "v2", force: true })).status).toBe(200);
    const r = (await (await SELF.fetch(`${ORIGIN}/api/hazards?lat=${LAT}&lng=${LNG}`, authed())).json()) as HazardResponse;
    expect(r.levels).toEqual({ flood6: 1 });
  });

  it("validation and auth", async () => {
    expect((await post("hazards", { version: "v3", items: [{ kind: "flood6", level: 1, city: "台北市", rings: [[[0, 0]]] }] })).status).toBe(400);
    expect((await SELF.fetch(`${ORIGIN}/api/hazards?lat=25&lng=121`)).status).toBe(401);
    expect((await SELF.fetch(`${ORIGIN}/api/hazards`, authed())).status).toBe(400);
  });
});

describe("hazards are loaded per living region", () => {
  it("a point is checked against its own region's zones only", async () => {
    const KH = { lat: 22.63, lng: 120.3 }; // 高雄市區
    const items: HazardZoneIn[] = [
      { kind: "flood6", level: 4, city: "台北市", rings: [square(LAT, LNG, 0.003)] },
      { kind: "flood6", level: 2, city: "高雄市", rings: [square(KH.lat, KH.lng, 0.003)] },
    ];
    expect((await post("hazards", { version: "v-regions", items })).status).toBe(200);
    expect((await post("hazards/commit", { version: "v-regions", force: true })).status).toBe(200);
    const at = async (lat: number, lng: number) => (await (await SELF.fetch(`${ORIGIN}/api/hazards?lat=${lat}&lng=${lng}`, authed())).json()) as HazardResponse;
    expect(await at(LAT, LNG)).toMatchObject({ has_data: true, levels: { flood6: 4 } });
    expect(await at(KH.lat, KH.lng)).toMatchObject({ has_data: true, levels: { flood6: 2 } });
    // 台中沒有任何多邊形:那個生活圈回報沒有資料,不會誤用別區的
    expect(await at(24.15, 120.67)).toMatchObject({ has_data: false, levels: {} });
    // 圖層:畫面在高雄時只回高雄的多邊形
    const zones = (await (await SELF.fetch(`${ORIGIN}/api/hazards/zones?kind=flood6&w=${KH.lng - 0.02}&s=${KH.lat - 0.02}&e=${KH.lng + 0.02}&n=${KH.lat + 0.02}`, authed())).json()) as HazardZones;
    expect(zones.features.map((f) => f.properties.level)).toEqual([2]);
  });
});
