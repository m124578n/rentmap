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

  it("one batch: new and existing mixed, duplicates collapsed, each new listing linked to its own property", async () => {
    await post({ items: [{ ...item, source_listing_id: "B1" }] });
    const r = (await (
      await post({
        items: [
          { ...item, source_listing_id: "B2", rent: 11000 },
          { ...item, source_listing_id: "B1", rent: 12000 },
          { ...item, source_listing_id: "B3", rent: 13000 },
          { ...item, source_listing_id: "B2", rent: 11500 }, // 同批重複:取最後一筆
        ],
      })
    ).json()) as { created: number; updated: number; ids: number[] };
    expect(r).toMatchObject({ created: 2, updated: 1 });
    expect(new Set(r.ids).size).toBe(3);
    const rows = await env.DB.prepare(
      "SELECT l.source_listing_id AS sid, l.rent, l.property_id AS pid, (SELECT COUNT(*) FROM listing_price_history h WHERE h.listing_id = l.id) AS hist FROM listings l WHERE l.source_listing_id IN ('B1','B2','B3') ORDER BY sid",
    ).all<{ sid: string; rent: number; pid: number; hist: number }>();
    expect(rows.results.map((x) => [x.sid, x.rent, x.hist])).toEqual([
      ["B1", 12000, 2],
      ["B2", 11500, 1],
      ["B3", 13000, 1],
    ]);
    expect(new Set(rows.results.map((x) => x.pid)).size).toBe(3);
  });

  it("/seen and /status update many ids in one statement", async () => {
    await post({ items: ["S1", "S2", "S3"].map((id) => ({ ...item, source_listing_id: id })) });
    const call = (path: string, body: unknown) =>
      SELF.fetch(`${ORIGIN}/api/ingest/${path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer test-ingest" }, body: JSON.stringify(body) }).then((x) => x.json());
    expect(await call("seen", { source: "591", ids: ["S1", "S2", "nope"] })).toEqual({ updated: 2 });
    expect(
      await call("status", {
        items: [
          { source: "591", source_listing_id: "S1", status: "removed" },
          { source: "591", source_listing_id: "S2", status: "removed" },
          { source: "591", source_listing_id: "S3", status: "unknown" },
        ],
      }),
    ).toEqual({ updated: 3 });
    const st = await env.DB.prepare("SELECT source_listing_id AS sid, status FROM listings WHERE source_listing_id IN ('S1','S2','S3') ORDER BY sid").all<{ sid: string; status: string }>();
    expect(st.results.map((x) => x.status)).toEqual(["removed", "removed", "unknown"]);
  });

  it("keeps manually corrected coordinates", async () => {
    const a = (await (await post({ items: [{ ...item, source_listing_id: "999002" }] })).json()) as { ids: number[] };
    const pid = a.ids[0]!;
    await env.DB.prepare("UPDATE properties SET lat = 1, lng = 2, geocode_source = 'manual' WHERE id = ?").bind(pid).run();
    await post({ items: [{ ...item, source_listing_id: "999002", lat: 9, lng: 9 }] });
    const prop = await env.DB.prepare("SELECT lat, lng, geocode_source FROM properties WHERE id = ?").bind(pid).first<{ lat: number; lng: number; geocode_source: string }>();
    expect(prop).toEqual({ lat: 1, lng: 2, geocode_source: "manual" });
  });

  it("stores the source posted date, keeping the earliest across re-posts", async () => {
    const id = "999010";
    await post({ items: [{ ...item, source_listing_id: id, source_posted_at: "2026/08/15 10:00" }] });
    const q = () => env.DB.prepare("SELECT posted_at FROM listings WHERE source_listing_id = ?").bind(id).first<{ posted_at: string | null }>();
    expect((await q())?.posted_at).toBe("2026-08-15");
    // 重新刊登:591 日期變新 → 保留較早的
    await post({ items: [{ ...item, source_listing_id: id, source_posted_at: "2026/09/20" }] });
    expect((await q())?.posted_at).toBe("2026-08-15");
    // 沒給 / 看不懂 → 不覆蓋
    await post({ items: [{ ...item, source_listing_id: id }] });
    expect((await q())?.posted_at).toBe("2026-08-15");
  });
});
