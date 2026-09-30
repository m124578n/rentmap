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
    expect(by("pois:food")).toMatchObject({ stale: true, command: "npm run collect -- pois --only=food" });
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
