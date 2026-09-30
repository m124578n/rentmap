import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { signSession, SESSION_COOKIE } from "../src/worker/auth";
import type { MarketMatrix, MarketResponse, RentStatIn } from "../src/shared/market";

const ORIGIN = "http://localhost:5173";
let cookie = "";
const ingestHeaders = { Authorization: "Bearer test-ingest", "Content-Type": "application/json" };
const authed = () => ({ headers: { Cookie: cookie, Origin: ORIGIN } });
const post = (path: string, body: unknown) => SELF.fetch(`${ORIGIN}/api/ingest/${path}`, { method: "POST", headers: ingestHeaders, body: JSON.stringify(body) });

const stat = (serial: string, rent: number, size: number, extra: Partial<RentStatIn> = {}): RentStatIn => ({
  serial,
  city: "台北市",
  district: "大安區",
  road: `路${serial}`, // 每筆不同棟(同一棟最多只算 2 筆)
  kind: "整層住家",
  building_type: "華廈",
  floor: 3,
  total_floors: 7,
  building_age: 30,
  size_ping: size,
  rooms: 2,
  livings: 1,
  baths: 1,
  rent,
  date: "2026-03-01",
  has_elevator: true,
  furnished: true,
  has_mgmt: true,
  has_parking: false,
  social: false,
  ...extra,
});

let target = 0;
let noKind = 0;

beforeAll(async () => {
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO users (provider, provider_id, display_name, email, created_at, last_login_at) VALUES ('google','sub-1','Tester','tester@example.com',?,?)",
  )
    .bind(now, now)
    .run();
  cookie = `${SESSION_COOKIE}=${await signSession({ id: 1, name: "Tester", avatar: null }, "test-secret")}`;
  const listing = (id: string, extra: Record<string, unknown>) => ({
    source: "591",
    source_listing_id: id,
    source_url: `https://rent.591.com.tw/${id}`,
    title: `房 ${id}`,
    city: "台北市",
    district: "大安區",
    rent: 36000,
    ...extra,
  });
  const res = await post("listings", {
    items: [listing("t", { kind: "整層住家", size_ping: 30, rooms: 2, building_age: 28, has_elevator: true }), listing("nokind", {})],
  });
  [target, noKind] = ((await res.json()) as { ids: number[] }).ids as [number, number];
});

describe("rent stats ingest + market", () => {
  it("ingest requires the secret and valid items", async () => {
    expect((await SELF.fetch(`${ORIGIN}/api/ingest/rent-stats`, { method: "POST", body: "{}" })).status).toBe(401);
    expect((await post("rent-stats", { items: [{ serial: "x" }] })).status).toBe(400);
  });

  it("upserts by serial; social / parking / old rows don't count", async () => {
    const items = [
      stat("A1", 30000, 28),
      stat("A2", 32000, 30),
      stat("A3", 34000, 31),
      stat("A4", 36000, 33),
      stat("A5", 99999, 35), // 下面覆蓋成 40000
      stat("S1", 10000, 30, { social: true }),
      stat("P1", 90000, 30, { has_parking: true }),
      stat("OLD", 5000, 30, { date: "2024-01-01" }),
    ];
    expect((await post("rent-stats", { items })).status).toBe(200);
    expect((await post("rent-stats", { items: [stat("A5", 40000, 35)] })).status).toBe(200);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM rent_stats").first<{ n: number }>();
    expect(n?.n).toBe(8);

    const one = (await (await SELF.fetch(`${ORIGIN}/api/properties/${target}/market`, authed())).json()) as MarketResponse;
    expect(one.has_data).toBe(true);
    expect(one.market).toMatchObject({ level: 0, scope: "district", count: 5, enough: true, median: 34000, p25: 32000, p75: 36000, diff_pct: 6, from: "2026-03-01" });
    expect(one.market!.comparables).toHaveLength(5);

    const all = (await (await SELF.fetch(`${ORIGIN}/api/market`, authed())).json()) as MarketMatrix;
    expect(all.items[target]).toEqual({ median: 34000, diff_pct: 6, count: 5, enough: true, level: 0 });
    expect(all.items[noKind]).toBeNull();
  });

  it("asking prices: other active listings of the same district and kind, not itself", async () => {
    const mk = (id: string, rent: number, district = "大安區") => ({
      source: "591",
      source_listing_id: id,
      source_url: `https://rent.591.com.tw/${id}`,
      title: id,
      city: "台北市",
      district,
      rent,
      kind: "整層住家",
      size_ping: 30,
      rooms: 2,
    });
    expect((await post("listings", { items: [mk("k1", 40000), mk("k2", 42000), mk("k3", 44000), mk("other", 90000, "萬華區")] })).status).toBe(200);
    const one = (await (await SELF.fetch(`${ORIGIN}/api/properties/${target}/market`, authed())).json()) as MarketResponse;
    // 3 間不到 5:退到同區全部;不含自己(36000)、不含別區
    expect(one.asking).toMatchObject({ scope: "district", count: 3, enough: false, median: 42000, diff_pct: -14 });
    expect(one.asking).not.toHaveProperty("comparables");
  });

  it("prune drops rows older than a date", async () => {
    const r = (await (await post("rent-stats/prune", { before: "2025-01-01" })).json()) as { deleted: number; total: number };
    expect(r).toEqual({ deleted: 1, total: 7 });
  });

  it("requires login; 404 for unknown property", async () => {
    expect((await SELF.fetch(`${ORIGIN}/api/market`)).status).toBe(401);
    expect((await SELF.fetch(`${ORIGIN}/api/properties/99999/market`, authed())).status).toBe(404);
  });
});
