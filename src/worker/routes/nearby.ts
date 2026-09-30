/**
 * 生活機能(附近地點)
 *
 * 查詢(需登入):
 *   GET /api/nearby?lat=&lng=&radius=500      半徑內每類幾個 + 每類最近 5 個(面板用)
 *   GET /api/nearby/summary?radius=500         每間房源半徑內每類幾個(比較表、列表用)
 *
 * 採集機推入(bearer INGEST_SECRET),每類覆蓋式:
 *   POST /api/ingest/pois          { version, items: PoiIn[] }
 *   POST /api/ingest/pois/commit   { version, category, force? }  刪掉該類其他 version;新版不到舊版一半就擋(抓壞保護)
 *
 * 地點整份進 Worker 記憶體(雙北約 6–8 萬筆)放網格,以筆數 + 最新 version 當快取鍵。
 */
import { Hono } from "hono";
import { z } from "zod";
import { haversine, walkMin } from "@shared/bus";
import { PoiIn, POI_CATS, type NearbyPoi, type NearbyResponse, type NearbySummary, type PoiCat } from "@shared/poi";
import type { AppEnv } from "../env";
import { requireIngest, requireUser } from "../auth";

export const nearby = new Hono<AppEnv>();
nearby.use("/api/nearby", requireUser());
nearby.use("/api/nearby/*", requireUser());
nearby.use("/api/ingest/pois", requireIngest());
nearby.use("/api/ingest/pois/*", requireIngest());

interface Poi {
  category: PoiCat;
  subtype: string | null;
  name: string | null;
  lat: number;
  lng: number;
  rating: number | null;
  url: string | null;
}
const CELL = 0.005; // 約 550m
const cellKey = (y: number, x: number) => `${y}:${x}`;
let cache: { sig: string; grid: Map<string, Poi[]>; n: number } | null = null;

async function loadGrid(DB: D1Database) {
  const head = await DB.prepare("SELECT COUNT(*) AS n, MAX(version) AS v FROM pois").first<{ n: number; v: string | null }>();
  const sig = `${head?.n ?? 0}#${head?.v ?? ""}`;
  if (cache?.sig === sig) return cache;
  const { results } = await DB.prepare("SELECT category, subtype, name, lat, lng, rating, url FROM pois").all<Poi>();
  const grid = new Map<string, Poi[]>();
  for (const p of results) {
    const k = cellKey(Math.floor(p.lat / CELL), Math.floor(p.lng / CELL));
    const list = grid.get(k);
    if (list) list.push(p);
    else grid.set(k, [p]);
  }
  cache = { sig, grid, n: results.length };
  return cache;
}

function around(grid: Map<string, Poi[]>, lat: number, lng: number, radius: number, cb: (p: Poi, d: number) => void) {
  const dLat = radius / 111320;
  const dLng = radius / (111320 * Math.cos((lat * Math.PI) / 180));
  const y0 = Math.floor((lat - dLat) / CELL);
  const y1 = Math.floor((lat + dLat) / CELL);
  const x0 = Math.floor((lng - dLng) / CELL);
  const x1 = Math.floor((lng + dLng) / CELL);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      for (const p of grid.get(cellKey(y, x)) ?? []) {
        const d = haversine(lat, lng, p.lat, p.lng);
        if (d <= radius) cb(p, d);
      }
}

const num = (v: string | undefined) => (v == null || v === "" ? NaN : Number(v));
const radiusOf = (v: string | undefined) => Math.min(1500, Math.max(100, num(v) || 500));
const KEEP = 5;

nearby.get("/api/nearby", async (c) => {
  const lat = num(c.req.query("lat"));
  const lng = num(c.req.query("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return c.json({ error: "lat/lng required" }, 400);
  const radius = radiusOf(c.req.query("radius"));
  const { grid, n } = await loadGrid(c.env.DB);
  const found = new Map<PoiCat, NearbyPoi[]>();
  around(grid, lat, lng, radius, (p, d) => {
    const list = found.get(p.category) ?? found.set(p.category, []).get(p.category)!;
    list.push({ name: p.name, subtype: p.subtype, lat: p.lat, lng: p.lng, distance_m: Math.round(d), walk_min: walkMin(d), rating: p.rating, url: p.url });
  });
  const body: NearbyResponse = { radius, has_data: n > 0, counts: {}, items: {} };
  for (const cat of POI_CATS) {
    const list = found.get(cat);
    if (!list) continue;
    body.counts[cat] = list.length;
    // 有名字的優先(沒名字的公園 / 遊戲場常是社區角落),再依距離
    body.items[cat] = list.sort((a, b) => Number(!a.name) - Number(!b.name) || a.distance_m - b.distance_m).slice(0, KEEP);
  }
  return c.json(body);
});

nearby.get("/api/nearby/summary", async (c) => {
  const radius = radiusOf(c.req.query("radius"));
  const { grid, n } = await loadGrid(c.env.DB);
  const { results } = await c.env.DB.prepare("SELECT id, lat, lng FROM properties WHERE lat IS NOT NULL AND lng IS NOT NULL").all<{ id: number; lat: number; lng: number }>();
  const items: NearbySummary["items"] = {};
  for (const h of results) {
    const counts: Partial<Record<PoiCat, number>> = {};
    around(grid, h.lat, h.lng, radius, (p) => void (counts[p.category] = (counts[p.category] ?? 0) + 1));
    items[h.id] = counts;
  }
  const body: NearbySummary = { radius, has_data: n > 0, items };
  return c.json(body);
});

// ---- 採集機推入 ----

const Version = z.string().min(1).max(40);
const ItemsBody = z.object({ version: Version, items: z.array(PoiIn).min(1).max(2000) });
nearby.post("/api/ingest/pois", async (c) => {
  const parsed = ItemsBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues.slice(0, 20) }, 400);
  const { version, items } = parsed.data;
  await c.env.DB.prepare(
    `INSERT OR REPLACE INTO pois (category, key, subtype, name, lat, lng, rating, url, version)
     SELECT j.value ->> 'category', j.value ->> 'key', j.value ->> 'subtype', j.value ->> 'name', j.value ->> 'lat', j.value ->> 'lng',
            j.value ->> 'rating', j.value ->> 'url', ?1
       FROM json_each(?2) AS j`,
  )
    .bind(version, JSON.stringify(items))
    .run();
  return c.json({ upserted: items.length });
});

const CommitBody = z.object({ version: Version, category: z.enum(POI_CATS as [PoiCat, ...PoiCat[]]), force: z.boolean().optional() });
nearby.post("/api/ingest/pois/commit", async (c) => {
  const parsed = CommitBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid" }, 400);
  const { version, category, force } = parsed.data;
  const DB = c.env.DB;
  const count = async (sql: string) => (await DB.prepare(sql).bind(category, version).first<{ n: number }>())?.n ?? 0;
  const fresh = await count("SELECT COUNT(*) AS n FROM pois WHERE category = ? AND version = ?");
  const stale = await count("SELECT COUNT(*) AS n FROM pois WHERE category = ? AND version <> ?");
  // 新版覆蓋了同 key 的舊列,所以舊版總數 ≈ fresh + stale;新版不到一半多半是抓壞了
  if (!force && fresh < (fresh + stale) * 0.5) return c.json({ error: "新版筆數不到現有的一半,疑似抓取不完整;確定要換就帶 --force", category, fresh, total: fresh + stale }, 409);
  const r = await DB.prepare("DELETE FROM pois WHERE category = ? AND version <> ?").bind(category, version).run();
  return c.json({ category, total: fresh, deleted: r.meta.changes ?? 0 });
});
