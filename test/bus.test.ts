import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { signSession, SESSION_COOKIE } from "../src/worker/auth";
import type { AlongResponse, BusRouteDetail, BusRouteIn, BusStopIn, NearbyBusResponse } from "../src/shared/bus";
import type { CommuteMatrix, Trip, TripsResponse } from "../src/shared/trip";
import type { Place } from "../src/shared/schemas";

const ORIGIN = "http://localhost:5173";
let cookie = "";
const ingestHeaders = { Authorization: "Bearer test-ingest", "Content-Type": "application/json" };
const authed = (init: RequestInit = {}) => ({
  ...init,
  headers: { Cookie: cookie, Origin: ORIGIN, "Content-Type": "application/json", ...(init.headers ?? {}) },
});

// 一條東西向的假路線:lat 25.04,lng 121.500 起每站往東約 200m(0.002 度),共 10 站
const LAT = 25.04;
const lngAt = (i: number) => 121.5 + i * 0.002;
function route(key: string, name: string, direction: number, extra: Partial<BusRouteIn> = {}): BusRouteIn {
  return {
    key,
    route_uid: key.split(":")[0]!,
    name,
    city: "Taipei",
    direction,
    from_name: "起點",
    to_name: "終點",
    stop_count: 10,
    length_m: 2000,
    shape: [
      [lngAt(0), LAT],
      [lngAt(9), LAT],
    ],
    schedule: { wd: { bands: [{ s: "06:00", e: "09:00", min: 5, max: 8 }, { s: "09:00", e: "22:30", min: 10, max: 15 }] } },
    ...extra,
  };
}
function stops(key: string, reverse = false, withTimes = false): BusStopIn[] {
  return Array.from({ length: 10 }, (_, i) => {
    const pos = reverse ? 9 - i : i;
    return {
      route_key: key,
      seq: i + 1,
      stop_uid: `${key}-${i}`,
      station_id: null,
      name: `站${pos}`,
      lat: LAT,
      lng: lngAt(pos),
      dist_m: i * 200,
      t_min: withTimes ? i * 2 : null,
    };
  });
}
async function ingest(path: string, body: unknown) {
  return SELF.fetch(`${ORIGIN}/api/ingest/bus/${path}`, { method: "POST", headers: ingestHeaders, body: JSON.stringify(body) });
}

beforeAll(async () => {
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO users (provider, provider_id, display_name, email, created_at, last_login_at) VALUES ('google','sub-1','Tester','tester@example.com',?,?)",
  )
    .bind(now, now)
    .run();
  cookie = `${SESSION_COOKIE}=${await signSession({ id: 1, name: "Tester", avatar: null }, "test-secret")}`;
});

describe("bus ingest", () => {
  it("rejects without ingest secret", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/ingest/bus/routes`, { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
  });

  it("imports routes + stops and commits", async () => {
    const v = "v1";
    expect((await ingest("routes", { version: v, items: [route("R1:0", "307", 0), route("R1:1", "307", 1), route("R2:0", "紅30", 0)] })).status).toBe(200);
    const res = await ingest("stops", { version: v, items: [...stops("R1:0", false, true), ...stops("R1:1", true), ...stops("R2:0").slice(0, 3)] });
    expect(res.status).toBe(200);
    const commit = await ingest("commit", { version: v });
    expect(commit.status).toBe(200);
  });

  it("commit refuses a much smaller re-import unless forced", async () => {
    await ingest("routes", { version: "v2", items: [route("R9:0", "999", 0)] });
    await ingest("stops", { version: "v2", items: stops("R9:0").slice(0, 2) });
    const res = await ingest("commit", { version: "v2" });
    expect(res.status).toBe(409);
    // 清掉試驗資料,v1 繼續用
    await env.DB.prepare("DELETE FROM bus_route_stops WHERE version = 'v2'").run();
    await env.DB.prepare("DELETE FROM bus_routes WHERE version = 'v2'").run();
  });
});

describe("bus nearby", () => {
  it("requires login", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/bus/nearby?lat=${LAT}&lng=${lngAt(1)}`);
    expect(res.status).toBe(401);
  });

  it("lists routes near a point, both directions grouped, nearest stop each", async () => {
    // 站1 旁邊 30m
    const res = await SELF.fetch(`${ORIGIN}/api/bus/nearby?lat=${LAT + 0.0003}&lng=${lngAt(1)}&radius=300`, authed());
    expect(res.status).toBe(200);
    const body = (await res.json()) as NearbyBusResponse;
    expect(body.has_data).toBe(true);
    expect(body.routes.map((r) => r.name)).toEqual(["307", "紅30"]);
    const r307 = body.routes[0]!;
    expect(r307.dirs.map((d) => d.key)).toEqual(["R1:0", "R1:1"]);
    expect(r307.dirs[0]!.stop.name).toBe("站1");
    expect(r307.dirs[0]!.stop.walk_min).toBeGreaterThanOrEqual(1);
    expect(r307.dirs[0]!.wd).toMatchObject({ first: "06:00", last: "22:30", peak: [5, 8], offpeak: [10, 15] });
  });

  it("returns route detail with ordered stops", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/bus/routes/${encodeURIComponent("R1:1")}`, authed());
    expect(res.status).toBe(200);
    const body = (await res.json()) as BusRouteDetail;
    expect(body.route.name).toBe("307");
    expect(body.route.shape).toHaveLength(2);
    expect(body.stops.map((s) => s.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(body.stops[0]!.name).toBe("站9");
  });

  it("404 for unknown route", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/bus/routes/nope`, authed());
    expect(res.status).toBe(404);
  });
});

describe("places", () => {
  it("create, list, delete", async () => {
    const created = await SELF.fetch(`${ORIGIN}/api/places`, authed({ method: "POST", body: JSON.stringify({ name: "公司", lat: 25.05, lng: 121.52 }) }));
    expect(created.status).toBe(201);
    const { place } = (await created.json()) as { place: Place };
    expect(place).toMatchObject({ name: "公司", lat: 25.05 });

    const list = (await (await SELF.fetch(`${ORIGIN}/api/places`, authed())).json()) as { items: Place[] };
    expect(list.items.map((p) => p.name)).toEqual(["公司"]);

    const patched = await SELF.fetch(
      `${ORIGIN}/api/places/${place.id}`,
      authed({ method: "PATCH", body: JSON.stringify({ address: "台北市中正區忠孝西路一段49號", lat: 25.0461, lng: 121.5173 }) }),
    );
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { place: Place }).place).toMatchObject({ name: "公司", address: "台北市中正區忠孝西路一段49號", lng: 121.5173 });

    expect((await SELF.fetch(`${ORIGIN}/api/places/${place.id}`, authed({ method: "DELETE" }))).status).toBe(200);
    expect((await SELF.fetch(`${ORIGIN}/api/places/${place.id}`, authed({ method: "DELETE" }))).status).toBe(404);
    expect((await SELF.fetch(`${ORIGIN}/api/places/${place.id}`, authed({ method: "PATCH", body: JSON.stringify({ name: "x" }) }))).status).toBe(404);
  });

  it("rejects points outside Taiwan", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/places`, authed({ method: "POST", body: JSON.stringify({ name: "x", lat: 35, lng: 139 }) }));
    expect(res.status).toBe(400);
  });
});

describe("commute (bus + MRT, up to one transfer)", () => {
  const listing = (id: string, lat: number | undefined, lng: number | undefined) => ({
    source: "591",
    source_listing_id: id,
    source_url: `https://rent.591.com.tw/${id}`,
    title: `房 ${id}`,
    city: "台北市",
    district: "大安區",
    rent: 20000,
    ...(lat != null ? { lat, lng } : {}),
  });
  const mkPlace = async (name: string, lat: number, lng: number) =>
    ((await (await SELF.fetch(`${ORIGIN}/api/places`, authed({ method: "POST", body: JSON.stringify({ name, lat, lng }) }))).json()) as { place: Place }).place.id;
  const trips = async (lat: number, lng: number, placeId: number, radius = 300) =>
    (await (await SELF.fetch(`${ORIGIN}/api/commute/trips?lat=${lat}&lng=${lng}&place_id=${placeId}&radius=${radius}`, authed())).json()) as TripsResponse;
  const legSum = (t: Trip) => t.legs.reduce((s, l) => s + l.min + (l.mode === "walk" ? 0 : l.wait), 0);

  it("direct bus in the right direction; legs add up", async () => {
    const office = await mkPlace("公司", LAT, lngAt(8));
    const r = await trips(LAT + 0.0003, lngAt(1), office);
    const best = r.trips[0]!;
    expect(best.kind).toBe("bus");
    expect(best.summary).toBe("307");
    const bus = best.legs.find((l) => l.mode === "bus")!;
    // R1:0 往東,站1 → 站8(提早一站下車再走是同分,少走路的贏);t_min 每站 2 分;尖峰 5–8 分 → 等 3 分
    expect(bus).toMatchObject({ key: "R1:0", from: "站1", to: "站8", stops: 7, min: 14, wait: 3, exact: true });
    for (const t of r.trips) expect(t.total_min).toBe(legSum(t));
    expect(r.trips.map((t) => t.total_min)).toEqual([...r.trips.map((t) => t.total_min)].sort((a, b) => a - b));
    // 捷運也會列出來(龍山寺 / 西門走得到,公司旁邊是台大醫院)
    expect(r.trips.some((t) => t.kind === "mrt" || t.kind === "bus+mrt")).toBe(true);
  });

  it("MRT across the city, with line change counted inside the MRT leg", async () => {
    const cityHall = await mkPlace("市府", 25.0405, 121.5655); // 市政府站旁
    const r = await trips(25.0353, 121.4999, cityHall); // 龍山寺站旁
    const best = r.trips[0]!;
    expect(best.kind).toBe("mrt");
    const m = best.legs.find((l) => l.mode === "mrt");
    expect(m).toMatchObject({ from: "龍山寺", to: "市政府", lines: ["板南線"], stops: 8 });
    expect(best.total_min).toBeGreaterThan(15);
    expect(best.total_min).toBeLessThan(35);
    expect(best.legs.at(-1)).toMatchObject({ mode: "walk", to: "市府" });
  });

  it("bus → bus transfer where there is no MRT", async () => {
    // 內湖山區(離捷運 4km):A 線東西向 lat 25.12,B 線南北向 lng 121.62
    const E = (i: number) => 121.6 + i * 0.002;
    const N = (i: number) => 25.12 + i * 0.002;
    const a: BusStopIn[] = Array.from({ length: 11 }, (_, i) => ({ route_key: "TA:0", seq: i + 1, stop_uid: `ta${i}`, station_id: null, name: `甲${i}`, lat: 25.12, lng: E(i), dist_m: i * 200, t_min: null }));
    const b: BusStopIn[] = Array.from({ length: 11 }, (_, i) => ({ route_key: "TB:0", seq: i + 1, stop_uid: `tb${i}`, station_id: null, name: `乙${i}`, lat: N(i), lng: 121.6201, dist_m: i * 200, t_min: null }));
    await ingest("routes", { version: "v1", items: [route("TA:0", "小1", 0), route("TB:0", "小2", 0)] });
    await ingest("stops", { version: "v1", items: [...a, ...b] });
    const top = await mkPlace("山上", N(10), 121.6201);
    const r = await trips(25.12, E(0), top);
    const best = r.trips[0]!;
    expect(best.kind).toBe("bus+bus");
    expect(best.summary).toBe("小1 → 小2");
    expect(best.transfers).toBe(1);
    expect(best.legs.map((l) => l.mode)).toEqual(["walk", "bus", "walk", "bus", "walk"]);
    expect(best.total_min).toBe(legSum(best));
  });

  it("matrix: every property × every place, best trip or null", async () => {
    const ing = await SELF.fetch(`${ORIGIN}/api/ingest/listings`, {
      method: "POST",
      headers: ingestHeaders,
      body: JSON.stringify({ items: [listing("near", LAT + 0.0003, lngAt(1)), listing("nocoord", undefined, undefined)] }),
    });
    const { ids } = (await ing.json()) as { ids: number[] };
    const [near, nocoord] = ids as [number, number];
    const places = ((await (await SELF.fetch(`${ORIGIN}/api/places`, authed())).json()) as { items: Place[] }).items;
    const office = places.find((p) => p.name === "公司")!.id;
    const far = await mkPlace("遠方", 25.2, 121.7);

    const res = await SELF.fetch(`${ORIGIN}/api/commute?radius=300`, authed());
    expect(res.status).toBe(200);
    const body = (await res.json()) as CommuteMatrix;
    expect(body.has_bus).toBe(true);
    expect(body.items[nocoord]).toBeUndefined();
    const best = body.items[near]![office]!;
    expect(best).toMatchObject({ kind: "bus", summary: "307", transfers: 0 });
    // 和面板的行程一樣
    expect(best.total_min).toBe((await trips(LAT + 0.0003, lngAt(1), office)).trips[0]!.total_min);
    expect(body.items[near]![far]).toBeNull();
  });

  it("time of day: routes not running then are skipped", async () => {
    const places = ((await (await SELF.fetch(`${ORIGIN}/api/places`, authed())).json()) as { items: Place[] }).items;
    const office = places.find((p) => p.name === "公司")!.id;
    const at = async (q: string) =>
      (await (await SELF.fetch(`${ORIGIN}/api/commute/trips?lat=${LAT + 0.0003}&lng=${lngAt(1)}&place_id=${office}&radius=300&${q}`, authed())).json()) as TripsResponse;
    // 307 平日 06:00–22:30 有班、離峰 10–15 分 → 等 6 分
    const noon = await at("day=wd&time=12:00&dir=to");
    expect(noon.when).toEqual({ day: "wd", time: "12:00", dir: "to" });
    expect(noon.trips.find((t) => t.kind === "bus")!.legs.find((l) => l.mode === "bus")).toMatchObject({ key: "R1:0", wait: 6 });
    // 深夜收班、週六沒開 → 沒有公車直達
    expect((await at("day=wd&time=23:40&dir=to")).trips.some((t) => t.kind === "bus")).toBe(false);
    expect((await at("day=sat&time=08:00&dir=to")).trips.some((t) => t.kind === "bus")).toBe(false);
    // 捷運 00:00–06:00 不營運
    expect((await at("day=wd&time=03:00&dir=to")).trips.every((t) => t.kind === "walk")).toBe(true);
    expect((await SELF.fetch(`${ORIGIN}/api/commute/trips?lat=25&lng=121.5&place_id=${office}&time=25:00`, authed())).status).toBe(400);
  });

  it("dir=from: 下班從地點回住處,搭反方向那條、行程是正向的", async () => {
    const places = ((await (await SELF.fetch(`${ORIGIN}/api/places`, authed())).json()) as { items: Place[] }).items;
    const office = places.find((p) => p.name === "公司")!.id;
    const r = (await (
      await SELF.fetch(`${ORIGIN}/api/commute/trips?lat=${LAT + 0.0003}&lng=${lngAt(1)}&place_id=${office}&radius=300&day=wd&time=18:00&dir=from`, authed())
    ).json()) as TripsResponse;
    const best = r.trips.find((t) => t.kind === "bus")!;
    expect(best.legs.map((l) => l.mode)).toEqual(["walk", "bus", "walk"]);
    const bus = best.legs[1]!;
    // R1:1 往西:站8(公司旁)上車 → 站1(住處旁)下車;反方向站序 seq 小的在東邊
    expect(bus).toMatchObject({ key: "R1:1", from: "站8", to: "站1", stops: 7 });
    if (bus.mode === "bus") expect(bus.board_seq).toBeLessThan(bus.alight_seq);
    expect(best.legs[0]).toMatchObject({ mode: "walk", to: "站8站" });
    expect(best.legs[2]).toMatchObject({ mode: "walk", to: "住處" });
    expect(best.total_min).toBe(legSum(best));
    // 捷運轉公車 / 公車轉捷運 方向也要翻
    for (const t of r.trips) if (t.kind === "bus+mrt") expect(t.legs.find((l) => l.mode !== "walk")!.mode).toBe("bus");
    for (const t of r.trips) if (t.kind === "mrt+bus") expect(t.legs.find((l) => l.mode !== "walk")!.mode).toBe("mrt");
  });

  it("along: 經過某路線的房源(公車主路線名、捷運線名)", async () => {
    const all = (await (await SELF.fetch(`${ORIGIN}/api/properties`, authed())).json()) as { items: { id: number; title: string }[] };
    const near = all.items.find((p) => p.title === "房 near")!.id;
    const along = async (q: string) => (await (await SELF.fetch(`${ORIGIN}/api/bus/along?${q}`, authed())).json()) as AlongResponse;

    const r = await along(`names=${encodeURIComponent("307,紅30,不存在")}&radius=300`);
    expect(r.queries).toEqual([
      { q: "307", kind: "bus", label: "307", dirs: 2 },
      { q: "紅30", kind: "bus", label: "紅30", dirs: 1 },
      { q: "不存在", kind: null, label: null, dirs: 0 },
    ]);
    expect(r.ids).toEqual([near]);
    // 板南線:龍山寺站約 560m,在捷運 800m 內;文湖線很遠
    expect((await along(`names=${encodeURIComponent("板南")}`)).ids).toEqual([near]);
    expect((await along(`names=${encodeURIComponent("文湖線")}`)).ids).toEqual([]);
    expect((await along(`names=${encodeURIComponent("不存在")}`)).ids).toEqual([]);
    // 前綴只接非數字 / 字母:「紅3」不是紅30、「30」不是 307
    expect((await along(`names=${encodeURIComponent("紅3,30")}`)).queries.map((q) => q.kind)).toEqual([null, null]);
    expect((await SELF.fetch(`${ORIGIN}/api/bus/along`, authed())).status).toBe(400);

    const names = (await (await SELF.fetch(`${ORIGIN}/api/bus/names`, authed())).json()) as { bus: string[]; mrt: string[] };
    expect(names.bus).toEqual(expect.arrayContaining(["307", "紅30"]));
    expect(names.mrt).toContain("板南線");
  });

  it("YouBike:住處與公司旁都有站 → 有騎車的搭法;bike=0 不算;下班方向段落正向", async () => {
    const places = ((await (await SELF.fetch(`${ORIGIN}/api/places`, authed())).json()) as { items: Place[] }).items;
    const office = places.find((p) => p.name === "公司")!.id;
    const yb = (key: string, lng: number) => ({ key, category: "youbike", subtype: null, name: key, lat: LAT + 0.0005, lng, rating: null, url: null, note: "20 格" });
    await SELF.fetch(`${ORIGIN}/api/ingest/pois`, { method: "POST", headers: ingestHeaders, body: JSON.stringify({ version: "y1", items: [yb("住處站", lngAt(1)), yb("公司站", lngAt(8))] }) });
    await SELF.fetch(`${ORIGIN}/api/ingest/pois/commit`, { method: "POST", headers: ingestHeaders, body: JSON.stringify({ version: "y1", category: "youbike" }) });
    const q = (extra: string) => `${ORIGIN}/api/commute/trips?lat=${LAT + 0.0003}&lng=${lngAt(1)}&place_id=${office}&radius=300&${extra}`;

    const r = (await (await SELF.fetch(q("day=wd&time=08:00&dir=to"), authed())).json()) as TripsResponse;
    const bike = r.trips.find((t) => t.kind === "bike")!;
    expect(bike.legs.map((l) => l.mode)).toEqual(["walk", "bike", "walk"]);
    expect(bike.legs[1]).toMatchObject({ mode: "bike", from: "住處站", to: "公司站", wait: 2 });
    expect(bike.summary).toBe("YouBike");
    expect(bike.total_min).toBe(legSum(bike));

    const off = (await (await SELF.fetch(q("day=wd&time=08:00&dir=to&bike=0"), authed())).json()) as TripsResponse;
    expect(off.trips.some((t) => t.kind.startsWith("bike"))).toBe(false);

    const back = (await (await SELF.fetch(q("day=wd&time=18:00&dir=from"), authed())).json()) as TripsResponse;
    const bb = back.trips.find((t) => t.kind === "bike")!;
    expect(bb.legs[1]).toMatchObject({ mode: "bike", from: "公司站", to: "住處站" });
    expect(bb.legs[0]).toMatchObject({ mode: "walk", to: "YouBike 公司站" });
    expect(bb.legs[2]).toMatchObject({ mode: "walk", to: "住處" });
  });

  it("requires login and a valid place", async () => {
    expect((await SELF.fetch(`${ORIGIN}/api/commute`)).status).toBe(401);
    expect((await SELF.fetch(`${ORIGIN}/api/commute/trips?lat=25&lng=121.5&place_id=99999`, authed())).status).toBe(404);
  });
});
