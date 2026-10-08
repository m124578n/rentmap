/**
 * 生活機能(附近地點)
 *
 * 查詢(需登入):
 *   GET /api/nearby?lat=&lng=&radius=500      半徑內每類幾個 + 每類最近 5 個(面板用);&all=<類別> 那一類回半徑內全部(地圖標點用,上限 500)
 *   GET /api/nearby/box?w=&s=&e=&n=&cat=     畫面範圍內某一類的點(地圖「生活機能」圖層;範圍超過約 4km 見方回 too_big)
 *   GET /api/nearby/summary?radius=500         每間房源半徑內每類幾個(比較表、列表用)
 *   GET /api/garbage/fit?max=300&after=19:00   每間房源:走 max 公尺內有沒有 after 以後、平日至少 3 天有收的垃圾車(房東寫了代收就算有)
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
import { AVOIDABLE_CATS, encodeNearbySummary, garbageService, PoiIn, POI_CATEGORIES, POI_CATS, weekdayCount, type GarbageFit, type NearbyPoi, type NearbyResponse, type NearbySummary, type PoiBoxResponse, type PoiCat } from "@shared/poi";
import type { AppEnv } from "../env";
import { requireIngest, requireUser } from "../auth";
import { cachedJson, propertiesSig, tableSig } from "../cache";
import { isPrivatePool, ownerOf, ownerSql } from "../pool";
import { DEFAULT_REGION, REGION_KEYS, boxInTaiwan, inTaiwan, regionAt, regionBbox, type RegionKey } from "@shared/regions";

export const nearby = new Hono<AppEnv>();
nearby.use("/api/nearby", requireUser());
nearby.use("/api/nearby/*", requireUser());
nearby.use("/api/garbage/*", requireUser());
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
  note: string | null;
  minute: number | null;
  days: number | null;
}
const CELL = 0.005; // 約 550m
const cellKey = (y: number, x: number) => `${y}:${x}`;
type Grid = { sig: string; grid: Map<string, Poi[]>; n: number };
const cache = new Map<RegionKey, Grid>();

/** 一個生活圈一份(依外框取點);座標在哪個生活圈就用哪份 */
async function loadGrid(DB: D1Database, region: RegionKey = DEFAULT_REGION): Promise<Grid> {
  const [w, s, e, n] = regionBbox(region);
  const box = "WHERE lat BETWEEN ?1 AND ?2 AND lng BETWEEN ?3 AND ?4";
  const head = await DB.prepare(`SELECT COUNT(*) AS n, MAX(version) AS v FROM pois ${box}`).bind(s, n, w, e).first<{ n: number; v: string | null }>();
  const sig = `${head?.n ?? 0}#${head?.v ?? ""}`;
  const hit = cache.get(region);
  if (hit?.sig === sig) return hit;
  const { results } = await DB.prepare(`SELECT category, subtype, name, lat, lng, rating, url, note, minute, days FROM pois ${box}`).bind(s, n, w, e).all<Poi>();
  const grid = new Map<string, Poi[]>();
  for (const p of results) {
    const k = cellKey(Math.floor(p.lat / CELL), Math.floor(p.lng / CELL));
    const list = grid.get(k);
    if (list) list.push(p);
    else grid.set(k, [p]);
  }
  const out = { sig, grid, n: results.length };
  cache.set(region, out);
  return out;
}

const regionOf = (lat: number, lng: number) => regionAt(lat, lng) ?? DEFAULT_REGION;

/** 一批房源各自所在生活圈的網格(先載好,迴圈裡同步取) */
async function gridsFor(DB: D1Database, pts: { lat: number; lng: number }[]) {
  const out = new Map<RegionKey, Grid>();
  for (const k of new Set(pts.map((p) => regionOf(p.lat, p.lng)))) out.set(k, await loadGrid(DB, k));
  return out;
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
/** &all=<類別>:那一類回半徑內全部(1km 內超商、餐飲可能上百) */
const ALL_MAX = 500;
/** 垃圾車列多一點:不同時間的點都要看得到 */
const KEEP_BY: Partial<Record<PoiCat, number>> = { garbage: 30 }; // 同一地點常有午、晚兩班,前端再依地點合併

nearby.get("/api/nearby", async (c) => {
  const lat = num(c.req.query("lat"));
  const lng = num(c.req.query("lng"));
  if (!inTaiwan(lat, lng)) return c.json({ error: "lat/lng required" }, 400);
  const radius = radiusOf(c.req.query("radius"));
  const all = c.req.query("all") as PoiCat | undefined;
  const { grid, n } = await loadGrid(c.env.DB, regionOf(lat, lng));
  // Google 評分只在私人模式給(公開版拉麵只留店名與位置)
  const rated = isPrivatePool(c.env);
  const found = new Map<PoiCat, NearbyPoi[]>();
  around(grid, lat, lng, radius, (p, d) => {
    const list = found.get(p.category) ?? found.set(p.category, []).get(p.category)!;
    list.push({
      name: p.name,
      subtype: p.subtype,
      lat: p.lat,
      lng: p.lng,
      distance_m: Math.round(d),
      walk_min: walkMin(d),
      rating: rated ? p.rating : null,
      url: p.url,
      note: p.note,
      minute: p.minute,
      days: p.days,
    });
  });
  const body: NearbyResponse = { radius, has_data: n > 0, counts: {}, items: {} };
  for (const cat of POI_CATS) {
    let list = found.get(cat);
    if (!list) continue;
    // 線狀(道路、鐵道)存的是每 40m 一點:同一條只留最近的,數量是「幾條」
    if ((POI_CATEGORIES[cat] as { line?: boolean }).line) {
      const byName = new Map<string, NearbyPoi>();
      for (const p of list.sort((a, b) => a.distance_m - b.distance_m)) {
        const k = p.name ?? `${p.subtype}`;
        if (!byName.has(k)) byName.set(k, p);
      }
      list = [...byName.values()];
    }
    body.counts[cat] = list.length;
    // 有名字的優先(沒名字的公園 / 遊戲場常是社區角落),再依距離
    body.items[cat] = list.sort((a, b) => Number(!a.name) - Number(!b.name) || a.distance_m - b.distance_m).slice(0, cat === all ? ALL_MAX : (KEEP_BY[cat] ?? KEEP));
  }
  return c.json(body);
});

/** 地圖圖層:畫面範圍內某一類(只在放大到街區時查;範圍太大回 too_big,前端提示放大) */
const BOX_MAX_DEG = 0.04;
const BOX_MAX_ITEMS = 1500;
nearby.get("/api/nearby/box", async (c) => {
  const [w, s, e, n] = (["w", "s", "e", "n"] as const).map((k) => num(c.req.query(k)));
  const cat = c.req.query("cat") as PoiCat;
  if (!boxInTaiwan(w!, s!, e!, n!)) return c.json({ error: "w, s, e, n required" }, 400);
  if (!(POI_CATS as readonly string[]).includes(cat)) return c.json({ error: "cat invalid" }, 400);
  const body: PoiBoxResponse = { cat, too_big: false, truncated: false, items: [] };
  if (e! - w! > BOX_MAX_DEG * 1.6 || n! - s! > BOX_MAX_DEG) return c.json({ ...body, too_big: true });
  const { grid } = await loadGrid(c.env.DB, regionOf((s! + n!) / 2, (w! + e!) / 2));
  for (let y = Math.floor(s! / CELL); y <= Math.floor(n! / CELL); y++)
    for (let x = Math.floor(w! / CELL); x <= Math.floor(e! / CELL); x++)
      for (const p of grid.get(cellKey(y, x)) ?? []) {
        if (p.category !== cat || p.lat < s! || p.lat > n! || p.lng < w! || p.lng > e!) continue;
        if (body.items.length >= BOX_MAX_ITEMS) {
          body.truncated = true;
          return c.json(body);
        }
        body.items.push({ name: p.name, subtype: p.subtype, lat: p.lat, lng: p.lng, note: p.note });
      }
  return c.json(body);
});

nearby.get("/api/nearby/summary", async (c) => {
  const radius = radiusOf(c.req.query("radius"));
  const DB = c.env.DB;
  const owner = ownerOf(c);
  const key = ["nearby-summary", radius, await tableSig(DB, "pois", "version"), await propertiesSig(DB, owner)];
  return cachedJson(c, ["v2", ...key], async () => encodeNearbySummary(await nearbySummary(DB, radius, owner)));
});

async function nearbySummary(DB: D1Database, radius: number, owner: number | null): Promise<NearbySummary> {
  const { results } = await DB.prepare(`SELECT id, lat, lng FROM properties WHERE lat IS NOT NULL AND lng IS NOT NULL${ownerSql(owner)}`).all<{ id: number; lat: number; lng: number }>();
  const grids = await gridsFor(DB, results);
  const n = [...grids.values()].reduce((a, g) => a + g.n, 0);
  const items: NearbySummary["items"] = {};
  const nearest: NearbySummary["nearest"] = {};
  const avoidable = new Set<PoiCat>(AVOIDABLE_CATS);
  for (const h of results) {
    const counts: Partial<Record<PoiCat, number>> = {};
    const near: Partial<Record<PoiCat, number>> = {};
    around(grids.get(regionOf(h.lat, h.lng))!.grid, h.lat, h.lng, radius, (p, d) => {
      counts[p.category] = (counts[p.category] ?? 0) + 1;
      if (avoidable.has(p.category) && (near[p.category] == null || d < near[p.category]!)) near[p.category] = Math.round(d);
    });
    items[h.id] = counts;
    nearest[h.id] = near;
  }
  return { radius, has_data: n > 0, items, nearest };
}

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
nearby.get("/api/garbage/fit", async (c) => {
  const max = Math.min(1000, Math.max(50, num(c.req.query("max")) || 300));
  const after = c.req.query("after") ?? "00:00";
  const m = HHMM.exec(after);
  if (!m) return c.json({ error: "after must be HH:MM" }, 400);
  const afterMin = Number(m[1]) * 60 + Number(m[2]);
  // 房東有沒有寫代收:看最新一筆刊登的 raw_json(屋況介紹、標籤)
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.lat, p.lng, (SELECT raw_json FROM listings WHERE property_id = p.id ORDER BY id DESC LIMIT 1) AS raw
       FROM properties p WHERE p.lat IS NOT NULL AND p.lng IS NOT NULL${ownerSql(ownerOf(c), "p")}`,
  ).all<{ id: number; lat: number; lng: number; raw: string | null }>();
  const grids = await gridsFor(c.env.DB, results);
  const items: GarbageFit["items"] = {};
  for (const h of results) {
    let best: { distance_m: number; minute: number; name: string | null } | null = null;
    around(grids.get(regionOf(h.lat, h.lng))!.grid, h.lat, h.lng, max, (p, d) => {
      if (p.category !== "garbage" || p.minute == null || p.minute < afterMin) return;
      if (p.days != null && weekdayCount(p.days) < 3) return;
      if (!best || d < best.distance_m) best = { distance_m: Math.round(d), minute: p.minute, name: p.name };
    });
    const service = garbageService(h.raw) === true;
    items[h.id] = { ok: service || best != null, service, best };
  }
  const body: GarbageFit = { max_m: max, after, items };
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
    `INSERT OR REPLACE INTO pois (category, key, subtype, name, lat, lng, rating, url, note, minute, days, version)
     SELECT j.value ->> 'category', j.value ->> 'key', j.value ->> 'subtype', j.value ->> 'name', j.value ->> 'lat', j.value ->> 'lng',
            j.value ->> 'rating', j.value ->> 'url', j.value ->> 'note', j.value ->> 'minute', j.value ->> 'days', ?1
       FROM json_each(?2) AS j`,
  )
    .bind(version, JSON.stringify(items))
    .run();
  return c.json({ upserted: items.length });
});

const CommitBody = z.object({ version: Version, category: z.enum(POI_CATS as [PoiCat, ...PoiCat[]]), force: z.boolean().optional(), region: z.enum(REGION_KEYS).optional() });
nearby.post("/api/ingest/pois/commit", async (c) => {
  const parsed = CommitBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid" }, 400);
  const { version, category, force, region } = parsed.data;
  const DB = c.env.DB;
  // 帶 region 就只換那個生活圈的舊資料(外框先粗篩,再用 regionAt 判斷,相鄰生活圈外框重疊的部分不會誤刪);沒帶 = 全部(舊行為)
  const [w, s, e, n] = region ? regionBbox(region) : [-180, -90, 180, 90];
  const box = "AND lat BETWEEN ?3 AND ?4 AND lng BETWEEN ?5 AND ?6";
  const q = (sql: string) => DB.prepare(sql).bind(category, version, s, n, w, e);
  const mine = (r: { lat: number; lng: number }) => !region || regionAt(r.lat, r.lng) === region;
  const fresh = (await q(`SELECT lat, lng FROM pois WHERE category = ?1 AND version = ?2 ${box}`).all<{ lat: number; lng: number }>()).results.filter(mine).length;
  const staleRows = (await q(`SELECT key, lat, lng FROM pois WHERE category = ?1 AND version <> ?2 ${box}`).all<{ key: string; lat: number; lng: number }>()).results.filter(mine);
  const stale = staleRows.length;
  // 新版覆蓋了同 key 的舊列,所以舊版總數 ≈ fresh + stale;新版不到一半多半是抓壞了
  if (!force && fresh < (fresh + stale) * 0.5) return c.json({ error: "新版筆數不到現有的一半,疑似抓取不完整;確定要換就帶 --force", category, fresh, total: fresh + stale }, 409);
  let deleted = 0;
  for (let i = 0; i < staleRows.length; i += 5000) {
    const keys = staleRows.slice(i, i + 5000).map((r) => r.key);
    const r = await DB.prepare("DELETE FROM pois WHERE category = ?1 AND key IN (SELECT value FROM json_each(?2))").bind(category, JSON.stringify(keys)).run();
    deleted += r.meta.changes ?? 0;
  }
  return c.json({ category, total: fresh, deleted });
});
