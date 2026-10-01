import { SELF, createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import app from "../src/worker/index";
import { signSession, SESSION_COOKIE } from "../src/worker/auth";
import { effectivePlan, extendPlan, type PlanState } from "../src/shared/plan";

// 方案權限只在公開模式生效(私人模式不限),所以跟 pool.test.ts 一樣換一份 env 直接呼叫 app.fetch
const ORIGIN = "http://localhost:5173";
const PUBLIC_ENV = { ...env, PRIVATE_POOL: undefined };
const cookies: Record<number, string> = {};

async function pub(path: string, uid: number | null, init: RequestInit = {}) {
  const headers: Record<string, string> = { Origin: ORIGIN, "Content-Type": "application/json", ...((init.headers as Record<string, string>) ?? {}) };
  if (uid != null) headers.Cookie = cookies[uid]!;
  const ctx = createExecutionContext();
  const res = await app.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers }), PUBLIC_ENV, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
const json = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });
const ingest = (path: string, body: unknown, secret = "test-ingest") => pub(path, null, { ...json(body), headers: { Authorization: `Bearer ${secret}` } });
const note = (uid: number, i: number) =>
  pub("/api/properties", uid, json({ title: `第 ${i} 間`, city: "台北市", district: "大安區", rent: 20000, kind: "獨立套房", lat: 25.03, lng: 121.54, source: "manual" }));
const place = (uid: number, i: number) => pub("/api/places", uid, json({ name: `地點 ${i}`, lat: 25.04, lng: 121.56 }));
const me = async (uid: number) => ((await (await pub("/api/me", uid)).json()) as { plan: PlanState }).plan;

beforeAll(async () => {
  const now = new Date().toISOString();
  for (const uid of [11, 12, 13]) {
    await env.DB.prepare("INSERT INTO users (id, provider, provider_id, display_name, email, created_at, last_login_at) VALUES (?, 'google', ?, ?, ?, ?, ?)")
      .bind(uid, `sub-${uid}`, `U${uid}`, `u${uid}@example.com`, now, now)
      .run();
    cookies[uid] = `${SESSION_COOKIE}=${await signSession({ id: uid, name: `U${uid}`, avatar: null }, "test-secret")}`;
  }
});

describe("方案計算(純函式)", () => {
  it("到期、沒有到期日、不認得的方案都算免費", () => {
    const now = new Date("2026-10-01T00:00:00Z");
    expect(effectivePlan("rent", "2026-10-02T00:00:00Z", now)).toBe("rent");
    expect(effectivePlan("rent", "2026-09-30T00:00:00Z", now)).toBe("free");
    expect(effectivePlan("buy", null, now)).toBe("free");
    expect(effectivePlan("admin", "2099-01-01T00:00:00Z", now)).toBe("free");
  });
  it("續買從原本到期日往後加;買房沒到期時買租屋不會降級", () => {
    const now = new Date("2026-10-01T00:00:00Z");
    expect(extendPlan({ plan: "free", until: null }, { plan: "rent", days: 30 }, now)).toEqual({ plan: "rent", until: "2026-10-31T00:00:00.000Z" });
    expect(extendPlan({ plan: "rent", until: "2026-10-11T00:00:00Z" }, { plan: "rent", days: 30 }, now).until).toBe("2026-11-10T00:00:00.000Z");
    expect(extendPlan({ plan: "buy", until: "2026-10-11T00:00:00Z" }, { plan: "rent", days: 30 }, now).plan).toBe("buy");
    // 過期的舊方案不疊加
    expect(extendPlan({ plan: "rent", until: "2026-01-01T00:00:00Z" }, { plan: "rent", days: 30 }, now).until).toBe("2026-10-31T00:00:00.000Z");
  });
});

describe("免費版(公開模式)", () => {
  it("/api/me 回免費方案與上限", async () => {
    const p = await me(11);
    expect(p).toMatchObject({ plan: "free", until: null, enforced: true, ent: { notes: 3, places: 1, tour: false } });
  });

  it("筆記最多 3 間,第 4 間 402", async () => {
    for (let i = 1; i <= 3; i++) expect((await note(11, i)).status).toBe(201);
    const r = await note(11, 4);
    expect(r.status).toBe(402);
    expect(await r.json()).toMatchObject({ error: "plan_required", need: "notes" });
  });

  it("地點 1 個;看房路線、存需求、下班時段要付費;YouBike 不算", async () => {
    expect((await place(11, 1)).status).toBe(201);
    expect((await place(11, 2)).status).toBe(402);
    const pts = [
      { lat: 25.03, lng: 121.54, name: "A" },
      { lat: 25.04, lng: 121.55, name: "B" },
    ];
    expect((await pub("/api/tour", 11, json({ points: pts }))).status).toBe(402);
    expect((await pub("/api/requirements", 11, { method: "PUT", body: JSON.stringify({}) })).status).toBe(402);
    expect((await pub("/api/commute?dir=from&time=18:00", 11)).status).toBe(402);
    expect((await pub("/api/commute?time=09:00", 11)).status).toBe(402);
    expect((await pub("/api/commute", 11)).status).toBe(200);
    expect((await pub("/api/commute/grid?w=121.5&s=25&e=121.52&n=25.02&dir=from", 11)).status).toBe(402);
  });

  it("行情只給中位數,成交明細拿掉(租屋、買賣)", async () => {
    const sale = (i: number) => ({
      serial: `PS${i}`, city: "台北市", district: "大安區", road: `路${i}`, building_type: "電梯大樓", floor: 5, total_floors: 12, building_age: 10, size_ping: 30,
      price: 30_000_000 + i, unit_price: 1_000_000 + i, rooms: 3, has_parking: false, parking_price: null, date: "2026-05-01", has_elevator: true, has_mgmt: true,
    });
    const rent = (i: number) => ({
      serial: `PR${i}`, city: "台北市", district: "大安區", road: `路${i}`, kind: "獨立套房", building_type: "電梯大樓", floor: 3, total_floors: 7, building_age: 10,
      size_ping: 8, rooms: 1, livings: 0, baths: 1, rent: 15000 + i * 100, date: "2026-05-01", has_elevator: true, furnished: true, has_mgmt: false, has_parking: false, social: false,
    });
    expect((await ingest("/api/ingest/sale-stats", { items: [1, 2, 3, 4, 5].map(sale) })).status).toBe(200);
    expect((await ingest("/api/ingest/rent-stats", { items: [1, 2, 3, 4, 5].map(rent) })).status).toBe(200);
    const s = (await (await pub("/api/market/sale/at?city=台北市&district=大安區&building_type=電梯大樓", 11)).json()) as { detail_locked?: boolean; market: { unit_median: number; comparables: unknown[] } };
    expect(s.detail_locked).toBe(true);
    expect(s.market.comparables).toEqual([]);
    expect(s.market.unit_median).toBeGreaterThan(0);
    const r = (await (await pub("/api/market/at?city=台北市&district=大安區&kind=獨立套房", 11)).json()) as { detail_locked?: boolean; market: { median: number; comparables: unknown[] } };
    expect(r.detail_locked).toBe(true);
    expect(r.market.comparables).toEqual([]);
    expect(r.market.median).toBeGreaterThan(0);
  });

  it("前端送什麼都改不了方案:沒有讓使用者改方案的 API", async () => {
    for (const [path, init] of [
      ["/api/me", { method: "PUT", body: JSON.stringify({ plan: "buy" }) }],
      ["/api/account", { method: "PATCH", body: JSON.stringify({ plan: "buy", plan_until: "2099-01-01" }) }],
      ["/api/ingest/plan", json({ email: "u11@example.com", offer: "buy90", ref: "self" })],
    ] as const) {
      const r = await pub(path, 11, init);
      expect([401, 404, 405]).toContain(r.status);
    }
    expect((await me(11)).plan).toBe("free");
  });
});

describe("開通與取消(bearer)", () => {
  it("沒金鑰或金鑰錯 401;不認得的 email 404;參數不對 400", async () => {
    expect((await pub("/api/ingest/plan", null, json({ email: "u12@example.com", offer: "rent30", ref: "x" }))).status).toBe(401);
    expect((await ingest("/api/ingest/plan", { email: "u12@example.com", offer: "rent30", ref: "x" }, "wrong")).status).toBe(401);
    expect((await ingest("/api/ingest/plan", { email: "nobody@example.com", offer: "rent30", ref: "x" })).status).toBe(404);
    expect((await ingest("/api/ingest/plan", { email: "u12@example.com", offer: "forever", ref: "x" })).status).toBe(400);
  });

  it("開通後限制解除;同一個 ref 重送不重複加天數", async () => {
    const r = await ingest("/api/ingest/plan", { email: "U12@example.com", offer: "rent30", ref: "order-1" });
    expect(r.status).toBe(201);
    const first = await me(12);
    expect(first).toMatchObject({ plan: "rent", ent: { notes: null, places: 5, tour: true, saleDetail: false } });
    expect(await (await ingest("/api/ingest/plan", { email: "u12@example.com", offer: "rent30", ref: "order-1" })).json()).toEqual({ duplicate: true });
    expect((await me(12)).until).toBe(first.until);
    for (let i = 1; i <= 4; i++) expect((await note(12, i)).status).toBe(201);
    expect((await place(12, 1)).status).toBe(201);
    expect((await place(12, 2)).status).toBe(201);
    expect((await pub("/api/commute?dir=from&time=18:00", 12)).status).toBe(200);
    const rm = (await (await pub("/api/market/at?city=台北市&district=大安區&kind=獨立套房", 12)).json()) as { detail_locked?: boolean; market: { comparables: unknown[] } };
    expect(rm.detail_locked).toBeUndefined();
    expect(rm.market.comparables.length).toBeGreaterThan(0);
    const s = (await (await pub("/api/market/sale/at?city=台北市&district=大安區", 12)).json()) as { detail_locked?: boolean };
    expect(s.detail_locked).toBe(true); // 買賣明細是買房方案
  });

  it("退款取消:扣回天數回到免費;重送不扣兩次;多的筆記還看得到但不能再新增", async () => {
    expect((await ingest("/api/ingest/plan/revoke", { ref: "order-1" })).status).toBe(200);
    expect(await (await ingest("/api/ingest/plan/revoke", { ref: "order-1" })).json()).toEqual({ duplicate: true });
    expect((await me(12)).plan).toBe("free");
    const list = (await (await pub("/api/properties", 12)).json()) as { items: unknown[] };
    expect(list.items).toHaveLength(4);
    expect((await note(12, 5)).status).toBe(402);
    // 降級後只用最早建的那個地點算通勤
    const m = (await (await pub("/api/commute", 12)).json()) as { items: Record<string, Record<string, unknown>> };
    const row = Object.values(m.items)[0]!;
    expect(Object.keys(row)).toHaveLength(1);
    const g = await env.DB.prepare("SELECT COUNT(*) AS n, SUM(days) AS d FROM plan_grants WHERE user_id = 12").first<{ n: number; d: number }>();
    expect(g).toEqual({ n: 2, d: 0 });
  });

  it("到期就自動回免費(不靠排程)", async () => {
    await env.DB.prepare("UPDATE users SET plan = 'buy', plan_until = '2020-01-01T00:00:00Z' WHERE id = 13").run();
    expect((await me(13)).plan).toBe("free");
  });
});

describe("私人模式不限制", () => {
  it("vitest 預設的私人模式:/api/me 是 enforced=false", async () => {
    await env.DB.prepare("INSERT OR IGNORE INTO users (id, provider, provider_id, display_name, created_at, last_login_at) VALUES (14, 'google', 'sub-14', 'U14', '2026-01-01', '2026-01-01')").run();
    const cookie = `${SESSION_COOKIE}=${await signSession({ id: 14, name: "U14", avatar: null }, "test-secret")}`;
    const r = (await (await SELF.fetch(`${ORIGIN}/api/me`, { headers: { Cookie: cookie } })).json()) as { plan: PlanState };
    expect(r.plan.enforced).toBe(false);
  });
});

describe("沒登入一律擋(所有使用者 API)", () => {
  const userApis: [string, string][] = [
    ["GET", "/api/properties"],
    ["POST", "/api/properties"],
    ["GET", "/api/properties/1"],
    ["PUT", "/api/properties/1/favorite"],
    ["GET", "/api/properties/1/market"],
    ["GET", "/api/places"],
    ["POST", "/api/places"],
    ["GET", "/api/commute"],
    ["GET", "/api/commute/trips?lat=25&lng=121&place_id=1"],
    ["GET", "/api/commute/grid?w=121.5&s=25&e=121.52&n=25.02"],
    ["POST", "/api/tour"],
    ["GET", "/api/requirements"],
    ["PUT", "/api/requirements"],
    ["GET", "/api/market"],
    ["GET", "/api/market/at?city=台北市&district=大安區&kind=獨立套房"],
    ["GET", "/api/market/sale/at?city=台北市&district=大安區"],
    ["GET", "/api/nearby?lat=25&lng=121"],
    ["GET", "/api/nearby/summary"],
    ["GET", "/api/hazards?lat=25&lng=121"],
    ["GET", "/api/hazards/summary"],
    ["GET", "/api/bus/nearby?lat=25&lng=121"],
    ["GET", "/api/garbage/fit?lat=25&lng=121"],
    ["GET", "/api/status"],
    ["GET", "/api/account/export"],
    ["DELETE", "/api/account"],
    ["POST", "/api/consent"],
  ];
  it.each(userApis)("%s %s → 401", async (method, path) => {
    const init: RequestInit = { method, ...(method === "GET" ? {} : { body: "{}" }) };
    expect((await pub(path, null, init)).status).toBe(401);
  });
});
