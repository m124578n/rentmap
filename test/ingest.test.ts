import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const ORIGIN = "http://localhost:5173";
const item = {
  title: "測試物件",
  city: "台北市",
  district: "大安區",
  road: "安居街",
  lat: 25.018,
  lng: 121.551,
  size_ping: 22,
  rooms: 3,
  source: "591",
  source_url: "https://rent.591.com.tw/999001",
  source_listing_id: "999001",
  rent: 30000,
  photos: ["https://img1.591.com.tw/a.jpg"],
};

const post = (body: unknown, token = "test-ingest") =>
  SELF.fetch(`${ORIGIN}/api/ingest/listings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

describe("ingest", () => {
  it("rejects a bad bearer", async () => {
    expect((await post({ items: [item] }, "nope")).status).toBe(401);
  });

  it("rejects invalid items", async () => {
    const res = await post({ items: [{ ...item, district: "板橋區" }] });
    expect(res.status).toBe(400);
  });

  it("creates then updates by (source, source_listing_id), recording price history", async () => {
    const a = (await (await post({ items: [item] })).json()) as { created: number; updated: number; ids: number[] };
    expect(a).toMatchObject({ created: 1, updated: 0 });
    const pid = a.ids[0]!;

    const b = (await (await post({ items: [{ ...item, rent: 29000, title: "改標題" }] })).json()) as { created: number; updated: number; ids: number[] };
    expect(b).toMatchObject({ created: 0, updated: 1, ids: [pid] });

    const listings = await env.DB.prepare("SELECT COUNT(*) AS n FROM listings WHERE property_id = ?").bind(pid).first<{ n: number }>();
    expect(listings?.n).toBe(1);
    const hist = await env.DB.prepare("SELECT l.rent FROM listing_price_history l JOIN listings x ON x.id = l.listing_id WHERE x.property_id = ? ORDER BY l.id").bind(pid).all<{ rent: number }>();
    expect(hist.results.map((r) => r.rent)).toEqual([30000, 29000]);
    const prop = await env.DB.prepare("SELECT title, geocode_source FROM properties WHERE id = ?").bind(pid).first<{ title: string; geocode_source: string }>();
    expect(prop).toEqual({ title: "改標題", geocode_source: "approx" });
  });

  it("lists active listings and marks removed via /status", async () => {
    await post({ items: [{ ...item, source_listing_id: "999003" }] });
    const before = (await (await SELF.fetch(`${ORIGIN}/api/ingest/active?source=591`, { headers: { Authorization: "Bearer test-ingest" } })).json()) as {
      items: { source_listing_id: string }[];
    };
    expect(before.items.map((i) => i.source_listing_id)).toContain("999003");

    const r = await SELF.fetch(`${ORIGIN}/api/ingest/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-ingest" },
      body: JSON.stringify({ items: [{ source: "591", source_listing_id: "999003", status: "removed" }] }),
    });
    expect(await r.json()).toEqual({ updated: 1 });
    const after = (await (await SELF.fetch(`${ORIGIN}/api/ingest/active?source=591`, { headers: { Authorization: "Bearer test-ingest" } })).json()) as {
      items: { source_listing_id: string }[];
    };
    expect(after.items.map((i) => i.source_listing_id)).not.toContain("999003");
  });

  it("keeps manually corrected coordinates", async () => {
    const a = (await (await post({ items: [{ ...item, source_listing_id: "999002" }] })).json()) as { ids: number[] };
    const pid = a.ids[0]!;
    await env.DB.prepare("UPDATE properties SET lat = 1, lng = 2, geocode_source = 'manual' WHERE id = ?").bind(pid).run();
    await post({ items: [{ ...item, source_listing_id: "999002", lat: 9, lng: 9 }] });
    const prop = await env.DB.prepare("SELECT lat, lng, geocode_source FROM properties WHERE id = ?").bind(pid).first<{ lat: number; lng: number; geocode_source: string }>();
    expect(prop).toEqual({ lat: 1, lng: 2, geocode_source: "manual" });
  });
});
