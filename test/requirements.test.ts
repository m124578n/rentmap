import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { signSession, SESSION_COOKIE } from "../src/worker/auth";
import { EMPTY_REQUIREMENTS, type Requirements } from "../src/shared/fit";

const ORIGIN = "http://localhost:5173";
let cookie = "";
const authed = (init: RequestInit = {}) => ({ ...init, headers: { Cookie: cookie, Origin: ORIGIN, "Content-Type": "application/json" } });

beforeAll(async () => {
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO users (provider, provider_id, display_name, email, created_at, last_login_at) VALUES ('google','sub-1','Tester','tester@example.com',?,?)",
  )
    .bind(now, now)
    .run();
  cookie = `${SESSION_COOKIE}=${await signSession({ id: 1, name: "Tester", avatar: null }, "test-secret")}`;
});

describe("requirements", () => {
  const get = async () => ((await (await SELF.fetch(`${ORIGIN}/api/requirements`, authed())).json()) as { requirements: Requirements }).requirements;

  it("defaults when never saved; requires login", async () => {
    expect((await SELF.fetch(`${ORIGIN}/api/requirements`)).status).toBe(401);
    expect(await get()).toEqual(EMPTY_REQUIREMENTS);
  });

  it("put replaces the whole thing; invalid rejected", async () => {
    const next: Requirements = { ...EMPTY_REQUIREMENTS, budget_max: 30000, kinds: ["整層住家"], need_pet: true, weights: { ...EMPTY_REQUIREMENTS.weights, market: 4 } };
    expect((await SELF.fetch(`${ORIGIN}/api/requirements`, authed({ method: "PUT", body: JSON.stringify(next) }))).status).toBe(200);
    expect(await get()).toEqual(next);
    expect((await SELF.fetch(`${ORIGIN}/api/requirements`, authed({ method: "PUT", body: JSON.stringify({ ...next, budget_max: -1 }) }))).status).toBe(400);
    expect((await SELF.fetch(`${ORIGIN}/api/requirements`, authed({ method: "PUT", body: JSON.stringify({ ...next, kinds: ["豪宅"] }) }))).status).toBe(400);
    const again = { ...next, budget_max: null };
    await SELF.fetch(`${ORIGIN}/api/requirements`, authed({ method: "PUT", body: JSON.stringify(again) }));
    expect((await get()).budget_max).toBeNull();
  });
});
