import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { signSession, SESSION_COOKIE } from "../src/worker/auth";
import type { GarbageFit, NearbyResponse, NearbySummary, PoiIn } from "../src/shared/poi";

const ORIGIN = "http://localhost:5173";
let cookie = "";
const ingestHeaders = { Authorization: "Bearer test-ingest", "Content-Type": "application/json" };
const authed = () => ({ headers: { Cookie: cookie, Origin: ORIGIN } });
const post = (path: string, body: unknown) => SELF.fetch(`${ORIGIN}/api/ingest/${path}`, { method: "POST", headers: ingestHeaders, body: JSON.stringify(body) });

// 中心 25.04, 121.50;每 0.001 度緯度約 111m
const LAT = 25.04;
const LNG = 121.5;
const poi = (key: string, category: PoiIn["category"], dLat: number, name: string | null = key): PoiIn => ({
  key,
  category,
  subtype: null,
  name,
  lat: LAT + dLat,
  lng: LNG,
  rating: null,
  url: null,
});
let home = 0;

beforeAll(async () => {
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO users (provider, provider_id, display_name, email, created_at, last_login_at) VALUES ('google','sub-1','Tester','tester@example.com',?,?)",
  )
    .bind(now, now)
    .run();
  cookie = `${SESSION_COOKIE}=${await signSession({ id: 1, name: "Tester", avatar: null }, "test-secret")}`;
  const res = await post("listings", {
    items: [{ source: "591", source_listing_id: "h", source_url: "https://rent.591.com.tw/h", title: "房 h", city: "台北市", district: "中正區", rent: 20000, lat: LAT, lng: LNG }],
  });
  home = ((await res.json()) as { ids: number[] }).ids[0]!;
});

describe("pois ingest + nearby", () => {
  it("requires the ingest secret", async () => {
    expect((await SELF.fetch(`${ORIGIN}/api/ingest/pois`, { method: "POST", body: "{}" })).status).toBe(401);
  });

  it("ingest + commit per category; nearby counts and nearest first", async () => {
    const items = [
      poi("c1", "convenience", 0.001), // 111m
      poi("c2", "convenience", 0.003), // 333m
      poi("c3", "convenience", 0.008), // 890m:500m 外
      poi("p1", "park", 0.002, null), // 沒名字
      poi("p2", "park", 0.004),
      poi("c1", "food", 0.001), // 同一個 key 也可以屬於另一類
    ];
    expect((await post("pois", { version: "v1", items })).status).toBe(200);
    for (const category of ["convenience", "park", "food"]) expect((await post("pois/commit", { version: "v1", category })).status).toBe(200);

    const r = (await (await SELF.fetch(`${ORIGIN}/api/nearby?lat=${LAT}&lng=${LNG}&radius=500`, authed())).json()) as NearbyResponse;
    expect(r.has_data).toBe(true);
    expect(r.counts).toEqual({ convenience: 2, food: 1, park: 2 });
    expect(r.items.convenience!.map((x) => x.name)).toEqual(["c1", "c2"]);
    expect(r.items.convenience![0]!.distance_m).toBeGreaterThan(100);
    // 有名字的排前面
    expect(r.items.park!.map((x) => x.name)).toEqual(["p2", null]);

    const s = (await (await SELF.fetch(`${ORIGIN}/api/nearby/summary?radius=1000`, authed())).json()) as NearbySummary;
    expect(s.items[home]).toEqual({ convenience: 3, park: 2, food: 1 });
  });

  it("commit refuses a much smaller re-import unless forced; replaces stale rows", async () => {
    await post("pois", { version: "v2", items: [poi("c9", "convenience", 0.001)] });
    expect((await post("pois/commit", { version: "v2", category: "convenience" })).status).toBe(409);
    const forced = (await (await post("pois/commit", { version: "v2", category: "convenience", force: true })).json()) as { total: number; deleted: number };
    expect(forced).toEqual({ category: "convenience", total: 1, deleted: 3 });
    const r = (await (await SELF.fetch(`${ORIGIN}/api/nearby?lat=${LAT}&lng=${LNG}`, authed())).json()) as NearbyResponse;
    expect(r.counts.convenience).toBe(1);
    expect(r.counts.park).toBe(2); // 別類不受影響
  });

  it("garbage: 帶時間與星期;/api/garbage/fit 依距離、時間、平日天數判斷", async () => {
    const g = (key: string, dLat: number, minute: number, days = 0b1110110): PoiIn => ({ ...poi(key, "garbage", dLat), minute, days, note: `${minute}` });
    await post("pois", { version: "g1", items: [g("early", 0.001, 17 * 60), g("late", 0.002, 20 * 60), g("far-late", 0.006, 21 * 60), g("weekend", 0.001, 22 * 60, 0b1000001)] });
    expect((await post("pois/commit", { version: "g1", category: "garbage" })).status).toBe(200);
    const n = (await (await SELF.fetch(`${ORIGIN}/api/nearby?lat=${LAT}&lng=${LNG}`, authed())).json()) as NearbyResponse;
    expect(n.items.garbage![0]).toMatchObject({ name: "early", minute: 1020, note: "1020" });

    const fit = async (q: string) => ((await (await SELF.fetch(`${ORIGIN}/api/garbage/fit?${q}`, authed())).json()) as GarbageFit).items[home]!;
    // 300m 內 19:00 以後:late(222m、20:00)
    expect(await fit("max=300&after=19:00")).toMatchObject({ ok: true, service: false, best: { name: "late", minute: 1200 } });
    // 21:00 以後:far-late 在 667m 外;weekend 只收週六日 → 不算
    expect((await fit("max=300&after=21:00")).ok).toBe(false);
    expect((await fit("max=700&after=21:00")).best!.name).toBe("far-late");
    expect((await SELF.fetch(`${ORIGIN}/api/garbage/fit?after=25:00`, authed())).status).toBe(400);
  });

  it("線狀類別同一條只列一次;summary 有可避開類別的最近距離", async () => {
    const hw = (i: number, dLat: number, name: string): PoiIn => ({ ...poi(`w1:${i}`, "highway", dLat, name), key: `w${name}:${i}` });
    await post("pois", { version: "h1", items: [hw(0, 0.002, "國道1號"), hw(1, 0.0025, "國道1號"), hw(2, 0.003, "國道1號"), hw(0, 0.004, "環河快速道路"), poi("f1", "fuel", 0.0009)] });
    for (const category of ["highway", "fuel"]) await post("pois/commit", { version: "h1", category });
    const n = (await (await SELF.fetch(`${ORIGIN}/api/nearby?lat=${LAT}&lng=${LNG}`, authed())).json()) as NearbyResponse;
    expect(n.counts.highway).toBe(2);
    expect(n.items.highway!.map((x) => x.name)).toEqual(["國道1號", "環河快速道路"]);
    const s = (await (await SELF.fetch(`${ORIGIN}/api/nearby/summary?radius=500`, authed())).json()) as NearbySummary;
    expect(s.nearest[home]).toMatchObject({ fuel: 100, highway: 222 });
    expect(s.nearest[home]!.convenience).toBeUndefined(); // 不是可避開的類別
  });

  it("requires login and lat/lng", async () => {
    expect((await SELF.fetch(`${ORIGIN}/api/nearby?lat=25&lng=121`)).status).toBe(401);
    expect((await SELF.fetch(`${ORIGIN}/api/nearby`, authed())).status).toBe(400);
  });
});
