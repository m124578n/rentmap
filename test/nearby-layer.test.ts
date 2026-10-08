import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { signSession, SESSION_COOKIE } from "../src/worker/auth";
import type { NearbyResponse, PoiBoxResponse, PoiIn } from "../src/shared/poi";

// 地圖標點:面板點一類畫出半徑內全部(&all=)、地圖「生活機能」圖層(/api/nearby/box)
const ORIGIN = "http://localhost:5173";
let cookie = "";
const get = async <T>(path: string) => {
  const r = await SELF.fetch(`${ORIGIN}${path}`, { headers: { Cookie: cookie, Origin: ORIGIN } });
  return { status: r.status, body: (await r.json()) as T };
};
const ingest = (path: string, body: unknown) =>
  SELF.fetch(`${ORIGIN}/api/ingest/${path}`, { method: "POST", headers: { Authorization: "Bearer test-ingest", "Content-Type": "application/json" }, body: JSON.stringify(body) });

const AT = { lat: 25.04, lng: 121.55 };
const shop = (i: number): PoiIn => ({ key: `c${i}`, category: "convenience", subtype: null, name: `超商${i}`, lat: AT.lat + i * 0.0003, lng: AT.lng, rating: null, url: null });

beforeAll(async () => {
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO users (provider, provider_id, display_name, created_at, last_login_at) VALUES ('google','sub-1','T',?,?)").bind(now, now).run();
  cookie = `${SESSION_COOKIE}=${await signSession({ id: 1, name: "T", avatar: null }, "test-secret")}`;
  // 8 家超商,間隔約 33m,都在 500m 內
  await ingest("pois", { version: "v1", items: Array.from({ length: 8 }, (_, i) => shop(i)) });
  await ingest("pois/commit", { version: "v1", category: "convenience" });
});

describe("點一類畫出半徑內全部", () => {
  it("預設每類最近 5 個;&all= 那一類回全部,其他類不變", async () => {
    const def = await get<NearbyResponse>(`/api/nearby?lat=${AT.lat}&lng=${AT.lng}&radius=500`);
    expect(def.body.counts.convenience).toBe(8);
    expect(def.body.items.convenience).toHaveLength(5);
    const all = await get<NearbyResponse>(`/api/nearby?lat=${AT.lat}&lng=${AT.lng}&radius=500&all=convenience`);
    expect(all.body.items.convenience).toHaveLength(8);
  });
});

describe("地圖生活機能圖層", () => {
  it("畫面範圍內那一類的點;範圍外不算", async () => {
    const r = await get<PoiBoxResponse>(`/api/nearby/box?w=121.54&s=25.039&e=121.56&n=25.0412&cat=convenience`);
    expect(r.status).toBe(200);
    expect(r.body.too_big).toBe(false);
    // 25.04 ~ 25.0412:i = 0..4
    expect(r.body.items.map((p) => p.name).sort()).toEqual(["超商0", "超商1", "超商2", "超商3", "超商4"]);
  });

  it("範圍太大回 too_big;類別或範圍不對 400;要登入", async () => {
    expect((await get<PoiBoxResponse>(`/api/nearby/box?w=121.3&s=24.9&e=121.7&n=25.2&cat=convenience`)).body.too_big).toBe(true);
    expect((await get(`/api/nearby/box?w=121.54&s=25.03&e=121.56&n=25.05&cat=nope`)).status).toBe(400);
    expect((await get(`/api/nearby/box?w=121.56&s=25.03&e=121.54&n=25.05&cat=convenience`)).status).toBe(400);
    const anon = await SELF.fetch(`${ORIGIN}/api/nearby/box?w=121.54&s=25.03&e=121.56&n=25.05&cat=convenience`);
    expect(anon.status).toBe(401);
  });
});
