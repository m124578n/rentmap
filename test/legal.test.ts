import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { signSession, SESSION_COOKIE } from "../src/worker/auth";
import { consentsNeeded, LEGAL_DOCS } from "../src/shared/legal";

const ORIGIN = "http://localhost:5173";
let cookie = "";
const authed = (init: RequestInit = {}) => ({ ...init, headers: { Cookie: cookie, Origin: ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.9" } });

beforeAll(async () => {
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO users (provider, provider_id, display_name, created_at, last_login_at) VALUES ('google','sub-1','T',?,?)").bind(now, now).run();
  cookie = `${SESSION_COOKIE}=${await signSession({ id: 1, name: "T", avatar: null }, "test-secret")}`;
});

describe("條款同意", () => {
  it("第一次登入要同意服務條款與隱私權政策;同意後記下版本、時間、IP", async () => {
    const me = (await (await SELF.fetch(`${ORIGIN}/api/me`, authed())).json()) as { consent_needed: { doc: string }[] };
    expect(me.consent_needed.map((x) => x.doc)).toEqual(["terms", "privacy"]);
    const docs = [
      { doc: "terms", version: LEGAL_DOCS.terms.version },
      { doc: "privacy", version: LEGAL_DOCS.privacy.version },
    ];
    const r = await SELF.fetch(`${ORIGIN}/api/consent`, authed({ method: "POST", body: JSON.stringify({ docs }) }));
    expect(await r.json()).toEqual({ consent_needed: [] });
    const row = await env.DB.prepare("SELECT doc, version, ip FROM consents WHERE user_id = 1 ORDER BY id").all();
    expect(row.results).toEqual([
      { doc: "terms", version: LEGAL_DOCS.terms.version, ip: "203.0.113.9" },
      { doc: "privacy", version: LEGAL_DOCS.privacy.version, ip: "203.0.113.9" },
    ]);
  });

  it("舊版本不收;沒登入 401", async () => {
    const r = await SELF.fetch(`${ORIGIN}/api/consent`, authed({ method: "POST", body: JSON.stringify({ docs: [{ doc: "terms", version: "0.1" }] }) }));
    expect(r.status).toBe(409);
    expect((await SELF.fetch(`${ORIGIN}/api/consent`, { method: "POST", headers: { Origin: ORIGIN }, body: "{}" })).status).toBe(401);
  });

  it("條款改版要再同意一次,並知道上一版", () => {
    expect(consentsNeeded([{ doc: "terms", version: "0.9" }, { doc: "privacy", version: LEGAL_DOCS.privacy.version }])).toEqual([
      { doc: "terms", version: LEGAL_DOCS.terms.version, previous: "0.9" },
    ]);
  });
});

describe("帳號:匯出與刪除", () => {
  it("匯出只有自己的資料;刪除帳號連同自己建的房源", async () => {
    const mk = await SELF.fetch(`${ORIGIN}/api/properties`, authed({ method: "POST", body: JSON.stringify({ title: "我的", city: "台北市", district: "大安區", rent: 20000 }) }));
    const { id } = (await mk.json()) as { id: number };
    const ex = (await (await SELF.fetch(`${ORIGIN}/api/account/export`, authed())).json()) as { properties: { id: number }[]; consents: unknown[]; user: { id: number } };
    expect(ex.user.id).toBe(1);
    expect(ex.properties.map((p) => p.id)).toEqual([id]);
    expect(ex.consents.length).toBe(2);
    expect((await SELF.fetch(`${ORIGIN}/api/account`, authed({ method: "DELETE", body: "{}" }))).status).toBe(400);
    const del = await SELF.fetch(`${ORIGIN}/api/account`, authed({ method: "DELETE", body: JSON.stringify({ confirm: "刪除" }) }));
    expect(await del.json()).toEqual({ ok: true, deleted_properties: 1 });
    const left = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM users) AS u, (SELECT COUNT(*) FROM consents) AS c, (SELECT COUNT(*) FROM listings) AS l").first();
    expect(left).toEqual({ u: 0, c: 0, l: 0 });
  });
});
