/**
 * 災害潛勢(淹水、土壤液化)
 *
 * 查詢(需登入):
 *   GET /api/hazards?lat=&lng=&city=台北市   這個點各種災害落在哪一級(city 用來判斷液化有沒有資料:看 regions.ts 的 coverage)
 *   GET /api/hazards/summary       每間房源各種災害的等級(比較表、需求符合度用)
 *   GET /api/hazards/zones?kind=&w=&s=&e=&n=   畫面範圍內某種災害的多邊形(GeoJSON,地圖圖層用;範圍太大回 too_big)
 *
 * 採集機推入(bearer INGEST_SECRET),整批覆蓋式:
 *   POST /api/ingest/hazards          { version, items: HazardZoneIn[] }
 *   POST /api/ingest/hazards/commit   { version, force? }  刪掉其他 version;新版不到舊版一半就擋
 *
 * 多邊形**一個生活圈一份**進記憶體(七個縣市共約 10.7 萬個、100 萬個頂點,全部一起載會逼近 Workers 記憶體上限;
 *   北北基桃約 3 萬個),依外框放進約 1.1km 的網格;查點時只看同格的,先比外框再做 ray casting。
 *   生活圈由座標決定(regionAt),所以查台中的點只會載台中那一份。
 */
import { Hono } from "hono";
import { z } from "zod";
import { HAZARD_KINDS, HazardZoneIn, type HazardKind, type HazardLevels, type HazardResponse, type HazardSummary } from "@shared/hazard";
import type { AppEnv } from "../env";
import { requireIngest, requireUser } from "../auth";
import { cachedJson, propertiesSig, tableSig } from "../cache";
import { DEFAULT_REGION, REGIONS, hasCoverage, regionAt, type Coverage, type RegionKey } from "@shared/regions";
import { ownerOf, ownerSql } from "../pool";

export const hazards = new Hono<AppEnv>();
hazards.use("/api/hazards", requireUser());
hazards.use("/api/hazards/*", requireUser());
hazards.use("/api/ingest/hazards", requireIngest());
hazards.use("/api/ingest/hazards/*", requireIngest());

interface Zone {
  kind: HazardKind;
  level: number;
  city: string;
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
  rings: [number, number][][];
}
const CELL = 0.01;
const cellKey = (y: number, x: number) => `${y}:${x}`;
type ZoneCache = { sig: string; zones: Zone[]; grid: Map<string, number[]>; cities: Set<string> };
const caches = new Map<RegionKey, ZoneCache>();
const regionCities = (r: RegionKey): string[] => [...REGIONS[r].cities, ...REGIONS[r].planned];

async function loadZones(DB: D1Database, region: RegionKey): Promise<ZoneCache> {
  const cities = regionCities(region);
  const inList = cities.map(() => "?").join(",");
  const head = await DB.prepare(`SELECT COUNT(*) AS n, MAX(version) AS v FROM hazard_zones WHERE city IN (${inList})`)
    .bind(...cities)
    .first<{ n: number; v: string | null }>();
  const sig = `${head?.n ?? 0}#${head?.v ?? ""}`;
  const hit = caches.get(region);
  if (hit?.sig === sig) return hit;
  const { results } = await DB.prepare(`SELECT kind, level, city, min_lat, min_lng, max_lat, max_lng, rings FROM hazard_zones WHERE city IN (${inList})`)
    .bind(...cities)
    .all<{
    kind: HazardKind;
    level: number;
    city: string;
    min_lat: number;
    min_lng: number;
    max_lat: number;
    max_lng: number;
    rings: string;
  }>();
  const zones: Zone[] = results.map((r) => ({
    kind: r.kind,
    level: r.level,
    city: r.city,
    minLat: r.min_lat,
    minLng: r.min_lng,
    maxLat: r.max_lat,
    maxLng: r.max_lng,
    rings: JSON.parse(r.rings) as [number, number][][],
  }));
  const grid = new Map<string, number[]>();
  zones.forEach((z, i) => {
    for (let y = Math.floor(z.minLat / CELL); y <= Math.floor(z.maxLat / CELL); y++)
      for (let x = Math.floor(z.minLng / CELL); x <= Math.floor(z.maxLng / CELL); x++) {
        const k = cellKey(y, x);
        const list = grid.get(k);
        if (list) list.push(i);
        else grid.set(k, [i]);
      }
  });
  const built: ZoneCache = { sig, zones, grid, cities: new Set(zones.filter((z) => z.kind === "liquefaction").map((z) => z.city)) };
  caches.set(region, built);
  return built;
}

/** ray casting */
function inRing(lng: number, lat: number, ring: [number, number][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 各種災害取最嚴重的一級 */
export function levelsAt(c: ZoneCache, lat: number, lng: number): HazardLevels {
  const out: HazardLevels = {};
  for (const i of c.grid.get(cellKey(Math.floor(lat / CELL), Math.floor(lng / CELL))) ?? []) {
    const z = c.zones[i]!;
    if (lat < z.minLat || lat > z.maxLat || lng < z.minLng || lng > z.maxLng) continue;
    if ((out[z.kind] ?? 0) >= z.level) continue;
    if (!inRing(lng, lat, z.rings[0]!)) continue;
    if (z.rings.slice(1).some((h) => inRing(lng, lat, h))) continue;
    out[z.kind] = z.level;
  }
  return out;
}


const HAZARD_COVERAGE: Record<HazardKind, Coverage> = { flood6: "flood", flood24: "flood", liquefaction: "liquefaction", airnoise: "airnoise" };

const num = (v: string | undefined) => (v == null || v === "" ? NaN : Number(v));

hazards.get("/api/hazards", async (c) => {
  const lat = num(c.req.query("lat"));
  const lng = num(c.req.query("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return c.json({ error: "lat/lng required" }, 400);
  const z = await loadZones(c.env.DB, regionAt(lat, lng) ?? DEFAULT_REGION);
  const body: HazardResponse = {
    has_data: z.zones.length > 0,
    levels: levelsAt(z, lat, lng),
    // 這個縣市沒有這項圖資(regions.ts 的 coverage):回報「沒有資料」而不是「沒有潛勢」
    no_coverage: HAZARD_KINDS.filter((k) => {
      const city = c.req.query("city") ?? "";
      return city !== "" && !hasCoverage(city, HAZARD_COVERAGE[k]);
    }),
  };
  return c.json(body);
});

hazards.get("/api/hazards/summary", async (c) => {
  const DB = c.env.DB;
  const key = ["hazard-summary", await tableSig(DB, "hazard_zones", "version"), await propertiesSig(DB, ownerOf(c))];
  const owner = ownerOf(c);
  return cachedJson(c, key, async (): Promise<HazardSummary> => {
    const { results } = await DB.prepare(`SELECT id, lat, lng FROM properties WHERE lat IS NOT NULL AND lng IS NOT NULL${ownerSql(owner)}`).all<{ id: number; lat: number; lng: number }>();
    // 房源依座標歸生活圈,只載用得到的那幾份(通常就一份)
    const byRegion = new Map<RegionKey, ZoneCache>();
    const items: HazardSummary["items"] = {};
    let hasData = false;
    for (const h of results) {
      const r = regionAt(h.lat, h.lng) ?? DEFAULT_REGION;
      let z = byRegion.get(r);
      if (!z) {
        z = await loadZones(DB, r);
        byRegion.set(r, z);
        hasData ||= z.zones.length > 0;
      }
      items[h.id] = levelsAt(z, h.lat, h.lng);
    }
    if (results.length === 0) hasData = (await loadZones(DB, DEFAULT_REGION)).zones.length > 0;
    return { has_data: hasData, items };
  });
});

/** 畫面範圍最大(度²):約 0.15° × 0.15°,再大就要使用者放大 */
const ZONES_MAX_AREA = 0.025;

hazards.get("/api/hazards/zones", async (c) => {
  const kind = z.enum(HAZARD_KINDS).safeParse(c.req.query("kind"));
  const [w, s, e, n] = (["w", "s", "e", "n"] as const).map((k) => Number(c.req.query(k))) as [number, number, number, number];
  if (!kind.success || ![w, s, e, n].every(Number.isFinite)) return c.json({ error: "kind, w, s, e, n required" }, 400);
  // 航空噪音只有一百多個里,整份給;其他看範圍
  if (kind.data !== "airnoise" && (e - w) * (n - s) > ZONES_MAX_AREA) return c.json({ type: "FeatureCollection", features: [], too_big: true });
  const zc = await loadZones(c.env.DB, regionAt((s + n) / 2, (w + e) / 2) ?? DEFAULT_REGION);
  const features = zc.zones
    .filter((zn) => zn.kind === kind.data && zn.maxLng >= w && zn.minLng <= e && zn.maxLat >= s && zn.minLat <= n)
    .map((zn) => ({ type: "Feature" as const, geometry: { type: "Polygon" as const, coordinates: zn.rings }, properties: { level: zn.level } }));
  return c.json({ type: "FeatureCollection", features, too_big: false });
});

// ---- 採集機推入 ----

const Version = z.string().min(1).max(40);
const ItemsBody = z.object({ version: Version, items: z.array(HazardZoneIn).min(1).max(1000) });
hazards.post("/api/ingest/hazards", async (c) => {
  const parsed = ItemsBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues.slice(0, 20) }, 400);
  const { version, items } = parsed.data;
  const rows = items.map((z) => {
    const pts = z.rings[0]!;
    return {
      ...z,
      min_lat: Math.min(...pts.map((p) => p[1])),
      max_lat: Math.max(...pts.map((p) => p[1])),
      min_lng: Math.min(...pts.map((p) => p[0])),
      max_lng: Math.max(...pts.map((p) => p[0])),
      rings: JSON.stringify(z.rings),
    };
  });
  await c.env.DB.prepare(
    `INSERT INTO hazard_zones (kind, level, city, min_lat, min_lng, max_lat, max_lng, rings, version)
     SELECT j.value ->> 'kind', j.value ->> 'level', j.value ->> 'city', j.value ->> 'min_lat', j.value ->> 'min_lng',
            j.value ->> 'max_lat', j.value ->> 'max_lng', j.value ->> 'rings', ?1
       FROM json_each(?2) AS j`,
  )
    .bind(version, JSON.stringify(rows))
    .run();
  return c.json({ inserted: rows.length });
});

const CommitBody = z.object({ version: Version, force: z.boolean().optional() });
hazards.post("/api/ingest/hazards/commit", async (c) => {
  const parsed = CommitBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid" }, 400);
  const { version, force } = parsed.data;
  const DB = c.env.DB;
  const count = async (sql: string) => (await DB.prepare(sql).bind(version).first<{ n: number }>())?.n ?? 0;
  const fresh = await count("SELECT COUNT(*) AS n FROM hazard_zones WHERE version = ?");
  const stale = await count("SELECT COUNT(*) AS n FROM hazard_zones WHERE version <> ?");
  if (!force && stale > 0 && fresh < stale * 0.5) return c.json({ error: "新版不到舊版一半,疑似轉檔不完整;確定要換就帶 --force", fresh, stale }, 409);
  const r = await DB.prepare("DELETE FROM hazard_zones WHERE version <> ?").bind(version).run();
  return c.json({ total: fresh, deleted: r.meta.changes ?? 0, kinds: HAZARD_KINDS });
});
