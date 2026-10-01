import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { signSession, SESSION_COOKIE } from "../src/worker/auth";
import type { StatusResponse } from "../src/shared/status";

const ORIGIN = "http://localhost:5173";
let cookie = "";

beforeAll(async () => {
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO users (provider, provider_id, display_name, email, created_at, last_login_at) VALUES ('google','sub-1','Tester','tester@example.com',?,?)")
    .bind(now, now)
    .run();
  cookie = `${SESSION_COOKIE}=${await signSession({ id: 1, name: "Tester", avatar: null }, "test-secret")}`;
});

describe("data status", () => {
  it("requires login", async () => {
    expect((await SELF.fetch(`${ORIGIN}/api/status`)).status).toBe(401);
  });

  it("empty database: everything that needs importing is stale; listings freshness from last_seen", async () => {
    const get = async () => (await (await SELF.fetch(`${ORIGIN}/api/status`, { headers: { Cookie: cookie, Origin: ORIGIN } })).json()) as StatusResponse;
    let s = await get();
    const by = (k: string) => s.items.find((i) => i.key === k)!;
    expect(by("bus")).toMatchObject({ count: 0, updated: null, stale: true });
    expect(by("pois:food")).toMatchObject({ stale: true, command: "npm run collect -- pois --region=north --only=food" });
    expect(by("pois:theft_house")).toMatchObject({ group: "治安", command: "npm run collect -- crime" });
    expect(by("metro").stale).toBe(false); // 進 git 的檔,不會過期
    expect(by("listings:591").stale).toBe(true);

    const res = await SELF.fetch(`${ORIGIN}/api/ingest/listings`, {
      method: "POST",
      headers: { Authorization: "Bearer test-ingest", "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ source: "591", source_listing_id: "1", source_url: "https://rent.591.com.tw/1", title: "x", city: "台北市", district: "大安區", rent: 20000 }] }),
    });
    expect(res.status).toBe(200);
    s = await get();
    expect(by("listings:591")).toMatchObject({ count: 1, stale: false, age_days: 0 });
    expect(by("listings:591").note).toContain("近一天新進 1 間");
  });
});

describe("data status per region", () => {
  it("帶 region 只算那個生活圈:生活機能依座標、公車依縣市", async () => {
    const post = (path: string, body: unknown) =>
      SELF.fetch(`${ORIGIN}/api/ingest/${path}`, { method: "POST", headers: { Authorization: "Bearer test-ingest", "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const poi = (key: string, lat: number, lng: number) => ({ key, category: "pharmacy", subtype: null, name: key, lat, lng, rating: null, url: null });
    // 台北 2 間、台中 3 間、高雄茄萣 1 間(在台南外框裡,但屬高雄)
    await post("pois", { version: "s1", items: [poi("tp1", 25.04, 121.5), poi("tp2", 25.05, 121.51), poi("tc1", 24.15, 120.67), poi("tc2", 24.16, 120.66), poi("tc3", 24.14, 120.68), poi("kh1", 22.9067, 120.1826)] });
    const get = async (region: string) =>
      (await (await SELF.fetch(`${ORIGIN}/api/status?region=${region}`, { headers: { Cookie: cookie, Origin: ORIGIN } })).json()) as StatusResponse;
    const count = (s: StatusResponse, k: string) => s.items.find((i) => i.key === k)!.count;
    const north = await get("north");
    const tc = await get("taichung");
    expect(north.region).toBe("north");
    expect(count(north, "pois:pharmacy")).toBe(2);
    expect(count(tc, "pois:pharmacy")).toBe(3);
    expect(count(await get("tainan"), "pois:pharmacy")).toBe(0);
    expect(count(await get("kaohsiung"), "pois:pharmacy")).toBe(1);
    expect(tc.items.find((i) => i.key === "pois:pharmacy")!.command).toBe("npm run collect -- pois --region=taichung --only=pharmacy");
    // 台中的捷運段數不含台北的
    expect(count(tc, "metro")).toBeLessThan(count(north, "metro"));
  });
});
