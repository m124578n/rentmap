import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { signSession, SESSION_COOKIE } from "../src/worker/auth";
import type { NearbyResponse, NearbySummary, PoiIn } from "../src/shared/poi";

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

  it("requires login and lat/lng", async () => {
    expect((await SELF.fetch(`${ORIGIN}/api/nearby?lat=25&lng=121`)).status).toBe(401);
    expect((await SELF.fetch(`${ORIGIN}/api/nearby`, authed())).status).toBe(400);
  });
});
