import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { signSession, SESSION_COOKIE } from "../src/worker/auth";
import type { SaleMarketResponse, SaleStatIn } from "../src/shared/sale";

const ORIGIN = "http://localhost:5173";
let cookie = "";
const post = (path: string, body: unknown) =>
  SELF.fetch(`${ORIGIN}/api/ingest/${path}`, { method: "POST", headers: { Authorization: "Bearer test-ingest", "Content-Type": "application/json" }, body: JSON.stringify(body) });
const at = async (q: string) => SELF.fetch(`${ORIGIN}/api/market/sale/at?${q}`, { headers: { Cookie: cookie, Origin: ORIGIN } });
const s = (serial: string, unit: number, extra: Partial<SaleStatIn> = {}): SaleStatIn => ({
  serial, city: "台中市", district: "西屯區", road: `路${serial}`, building_type: "電梯大樓", floor: 8, total_floors: 15, building_age: 10, size_ping: 35,
  price: unit * 35, unit_price: unit, rooms: 3, has_parking: false, parking_price: null, date: "2026-03-01", has_elevator: true, has_mgmt: true, ...extra,
});
const q = (o: Record<string, string | number>) => new URLSearchParams(Object.entries(o).map(([k, v]) => [k, String(v)])).toString();

beforeAll(async () => {
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO users (provider, provider_id, display_name, created_at, last_login_at) VALUES ('google','sub-1','T',?,?)").bind(now, now).run();
  cookie = `${SESSION_COOKIE}=${await signSession({ id: 1, name: "T", avatar: null }, "test-secret")}`;
});

describe("買賣實價登錄", () => {
  it("要 ingest 金鑰;匯入用編號覆蓋", async () => {
    expect((await SELF.fetch(`${ORIGIN}/api/ingest/sale-stats`, { method: "POST", body: "{}" })).status).toBe(401);
    const items = [s("A1", 500000), s("A2", 550000), s("A3", 600000), s("A4", 650000), s("A5", 999999), s("B1", 300000, { building_type: "公寓", building_age: 40, has_elevator: false })];
    expect((await post("sale-stats", { items })).status).toBe(200);
    expect((await post("sale-stats", { items: [s("A5", 700000)] })).status).toBe(200);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM sale_stats").first<{ n: number }>();
    expect(n?.n).toBe(6);
  });

  it("任一地址的買賣行情:每坪中位數、估總價、開價比行情", async () => {
    const r = (await (await at(q({ city: "臺中市", district: "西屯區", building_type: "電梯大樓", size_ping: 30, building_age: 8, price: 19_500_000 }))).json()) as SaleMarketResponse;
    expect(r.has_data).toBe(true);
    expect(r.market).toMatchObject({ scope: "district", count: 5, unit_median: 600000, est_total: 18_000_000, diff_pct: 8 });
    // 沒資料的縣市
    const none = (await (await at(q({ city: "高雄市", district: "三民區" }))).json()) as SaleMarketResponse;
    expect(none).toEqual({ has_data: false, market: null });
  });

  it("買房筆記:存總價、列表回 deal / price(rent 為 null)、行情矩陣比每坪單價", async () => {
    const authed = (init: RequestInit = {}) => ({ ...init, headers: { Cookie: cookie, Origin: ORIGIN, "Content-Type": "application/json" } });
    const base = { title: "西屯三房", city: "台中市", district: "西屯區", deal: "buy", building_type: "電梯大樓", size_ping: 30, building_age: 9, land_ping: 6.5 };
    expect((await SELF.fetch(`${ORIGIN}/api/properties`, authed({ method: "POST", body: JSON.stringify(base) }))).status).toBe(400); // 沒總價
    expect((await SELF.fetch(`${ORIGIN}/api/properties`, authed({ method: "POST", body: JSON.stringify({ ...base, deal: "rent" }) }))).status).toBe(400); // 租屋沒月租
    const r = await SELF.fetch(`${ORIGIN}/api/properties`, authed({ method: "POST", body: JSON.stringify({ ...base, price: 19_500_000 }) }));
    expect(r.status).toBe(201);
    const { id } = (await r.json()) as { id: number };
    const list = (await (await SELF.fetch(`${ORIGIN}/api/properties`, authed())).json()) as { items: { id: number; deal: string; rent: number | null; price: number | null; land_ping: number | null }[] };
    expect(list.items.find((x) => x.id === id)).toMatchObject({ deal: "buy", rent: null, price: 19_500_000, land_ping: 6.5 });
    const mk = (await (await SELF.fetch(`${ORIGIN}/api/market`, authed())).json()) as { items: Record<string, { median: number; diff_pct: number; sale?: boolean } | null> };
    expect(mk.items[id]).toMatchObject({ sale: true, median: 600000, diff_pct: 8 });
  });

  it("要登入;參數不對 400;prune", async () => {
    expect((await SELF.fetch(`${ORIGIN}/api/market/sale/at?city=x&district=y`)).status).toBe(401);
    expect((await at("city=台中市")).status).toBe(400);
    expect(await (await post("sale-stats/prune", { before: "2026-04-01" })).json()).toEqual({ deleted: 6, total: 0 });
  });
});
