/**
 * 公車 API
 *
 * 查詢(需登入):
 *   GET /api/bus/nearby?lat=&lng=&radius=400 → 半徑內可搭的路線(同路線同方向只留最近的站),依距離排序
 *       (通勤怎麼搭改由 /api/commute/trips 算,含轉乘)
 *   GET /api/bus/routes/:key  → 一條路線方向的線形、全部站、時刻表
 *   GET /api/bus/names        → 篩選用建議:公車主路線名 + 捷運線名
 *   GET /api/bus/along?names=307,板南線&radius=400 → 走得到這些路線(任一條)的房源 id
 *       公車看半徑內有沒有該路線任一方向的站;捷運看 800m 內有沒有該線的站
 *
 * 採集機推入(bearer INGEST_SECRET),覆蓋式:
 *   POST /api/ingest/bus/routes  { version, items: BusRouteIn[] }
 *   POST /api/ingest/bus/stops   { version, items: BusStopIn[] }
 *   POST /api/ingest/bus/commit  { version, force? } → 刪掉其他 version;新版站數不到舊版一半就擋下(抓壞保護)
 */
import { Hono } from "hono";
import { z } from "zod";
import { ALONG_MRT_R, BusRouteIn, BusStopIn, haversine, summarizeDay, type AlongResponse, type BusRouteDetail, type DaySummary, type NearbyBusResponse, type NearbyRoute } from "@shared/bus";
import type { AppEnv } from "../env";
import { requireIngest, requireUser } from "../auth";
import { ownerOf, ownerSql } from "../pool";
import { mrtGraph } from "../transit/mrt";
import { parseSchedule, routeMetas, stopsNear, toStop, type Hit, type RouteMeta } from "../busdata";

export const bus = new Hono<AppEnv>();
bus.use("/api/bus/*", requireUser());
bus.use("/api/ingest/bus/*", requireIngest());

// ---- 查詢 ----

const num = (v: string | undefined) => (v == null || v === "" ? NaN : Number(v));

bus.get("/api/bus/nearby", async (c) => {
  const lat = num(c.req.query("lat"));
  const lng = num(c.req.query("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return c.json({ error: "lat/lng required" }, 400);
  const radius = Math.min(1500, Math.max(100, num(c.req.query("radius")) || 400));
  const DB = c.env.DB;

  const hits = await stopsNear(DB, lat, lng, radius);
  // 每個路線方向留最近的站
  const nearest = new Map<string, Hit>();
  for (const h of hits) {
    const cur = nearest.get(h.route_key);
    if (!cur || h.distance_m < cur.distance_m) nearest.set(h.route_key, h);
  }
  const metas = await routeMetas(DB, [...nearest.keys()]);
  const summaries = new Map<string, DaySummary | null>();
  for (const [k, m] of metas) summaries.set(k, summarizeDay(parseSchedule(m.schedule_json)?.wd));

  // 同名路線(307 去 / 返)合成一組
  const groups = new Map<string, NearbyRoute>();
  for (const [key, h] of nearest) {
    const m = metas.get(key);
    if (!m) continue;
    let g = groups.get(m.name);
    if (!g) {
      g = { route_uid: m.route_uid, name: m.name, city: m.city, distance_m: h.distance_m, dirs: [] };
      groups.set(m.name, g);
    }
    g.distance_m = Math.min(g.distance_m, h.distance_m);
    g.dirs.push({ key, direction: m.direction, variant: m.variant ?? null, from_name: m.from_name, to_name: m.to_name, stop: toStop(h), wd: summaries.get(key) ?? null });
  }
  const routes = [...groups.values()]
    .map((g) => ({ ...g, dirs: g.dirs.sort((a, b) => a.direction - b.direction) }))
    .sort((a, b) => a.distance_m - b.distance_m || a.name.localeCompare(b.name, "zh-Hant"));


  const hasData = hits.length > 0 || (await DB.prepare("SELECT 1 FROM bus_routes LIMIT 1").first()) != null;
  const body: NearbyBusResponse = { radius, routes, has_data: hasData };
  return c.json(body);
});

bus.get("/api/bus/routes/:key", async (c) => {
  const key = c.req.param("key");
  const r = await c.env.DB.prepare(
    "SELECT key, route_uid, name, variant, city, direction, from_name, to_name, length_m, shape_json, schedule_json FROM bus_routes WHERE key = ?",
  )
    .bind(key)
    .first<RouteMeta & { length_m: number; shape_json: string }>();
  if (!r) return c.json({ error: "not found" }, 404);
  const { results } = await c.env.DB.prepare("SELECT seq, name, lat, lng, dist_m, t_min FROM bus_route_stops WHERE route_key = ? ORDER BY seq")
    .bind(key)
    .all<BusRouteDetail["stops"][number]>();
  const body: BusRouteDetail = {
    route: {
      key: r.key,
      route_uid: r.route_uid,
      name: r.name,
      variant: r.variant ?? null,
      city: r.city,
      direction: r.direction,
      from_name: r.from_name,
      to_name: r.to_name,
      length_m: r.length_m,
      shape: JSON.parse(r.shape_json) as [number, number][],
      schedule: parseSchedule(r.schedule_json),
    },
    stops: results,
  };
  c.header("Cache-Control", "private, max-age=3600");
  return c.json(body);
});

bus.get("/api/bus/names", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT DISTINCT name FROM bus_routes").all<{ name: string }>();
  const g = mrtGraph();
  const body = {
    bus: results.map((r) => r.name).sort((a, b) => a.localeCompare(b, "zh-Hant", { numeric: true })),
    mrt: Object.values(g.lineName),
  };
  c.header("Cache-Control", "private, max-age=3600");
  return c.json(body);
});

/** 「板南」「板南線」「BL」都對到板南線 */
function mrtLineOf(q: string): { code: string; name: string } | null {
  const g = mrtGraph();
  for (const [code, name] of Object.entries(g.lineName))
    if (name === q || name === `${q}線` || code === q.toUpperCase() || `捷運${name}` === q) return { code, name };
  return null;
}

bus.get("/api/bus/along", async (c) => {
  const qs = [...new Set((c.req.query("names") ?? "").split(",").map((s) => s.trim()).filter(Boolean))].slice(0, 10);
  if (!qs.length) return c.json({ error: "names required" }, 400);
  const radius = Math.min(1000, Math.max(100, num(c.req.query("radius")) || 400));
  const DB = c.env.DB;

  // 「307」也要對到「307西藏三民」(TDX 把同一路的另一種走法建成另一條路線),但「紅3」不能對到「紅30」
  const busQs = qs.filter((q) => !mrtLineOf(q)).map((q) => q.toUpperCase());
  const dirCount = new Map<string, number>();
  const matched = new Map<string, Set<string>>();
  const pts: { lat: number; lng: number; r: number }[] = [];
  if (busQs.length) {
    const { results: rows } = await DB.prepare(
      `SELECT r.key, r.name, j.value AS q FROM bus_routes r JOIN json_each(?) j
         ON UPPER(r.name) = j.value
         OR (substr(UPPER(r.name), 1, length(j.value)) = j.value AND substr(r.name, length(j.value) + 1, 1) NOT GLOB '[0-9A-Za-z]')`,
    )
      .bind(JSON.stringify(busQs))
      .all<{ key: string; name: string; q: string }>();
    for (const r of rows) (matched.get(r.q) ?? matched.set(r.q, new Set()).get(r.q)!).add(r.name);
    const { results } = await DB.prepare("SELECT DISTINCT lat, lng FROM bus_route_stops WHERE route_key IN (SELECT value FROM json_each(?))")
      .bind(JSON.stringify([...new Set(rows.map((r) => r.key))]))
      .all<{ lat: number; lng: number }>();
    for (const r of results) pts.push({ ...r, r: radius });
    for (const r of rows) (dirCount.set(r.q, (dirCount.get(r.q) ?? 0) + 1));
  }
  const g = mrtGraph();
  const queries: AlongResponse["queries"] = qs.map((q) => {
    const line = mrtLineOf(q);
    if (line) {
      const sts = g.stations.filter((s) => s.lines.includes(line.code));
      for (const s of sts) pts.push({ lat: s.lat, lng: s.lng, r: Math.max(radius, ALONG_MRT_R) });
      return { q, kind: "mrt", label: `捷運${line.name}`, dirs: sts.length ? 1 : 0 };
    }
    const names = [...(matched.get(q.toUpperCase()) ?? [])].sort((a, b) => a.length - b.length || a.localeCompare(b, "zh-Hant"));
    const n = dirCount.get(q.toUpperCase()) ?? 0;
    return { q, kind: n ? "bus" : null, label: n ? names.slice(0, 3).join("、") + (names.length > 3 ? " 等" : "") : null, dirs: n };
  });

  // 站點進網格(約 1.1km 一格),房源只看附近九格
  const CELL = 0.01;
  const grid = new Map<string, typeof pts>();
  for (const p of pts) {
    const k = `${Math.floor(p.lat / CELL)}:${Math.floor(p.lng / CELL)}`;
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(p);
  }
  const { results: props } = await DB.prepare(`SELECT id, lat, lng FROM properties WHERE lat IS NOT NULL AND lng IS NOT NULL${ownerSql(ownerOf(c))}`).all<{ id: number; lat: number; lng: number }>();
  const ids: number[] = [];
  for (const h of props) {
    const y = Math.floor(h.lat / CELL);
    const x = Math.floor(h.lng / CELL);
    let hit = false;
    for (let dy = -1; dy <= 1 && !hit; dy++)
      for (let dx = -1; dx <= 1 && !hit; dx++)
        for (const p of grid.get(`${y + dy}:${x + dx}`) ?? [])
          if (haversine(h.lat, h.lng, p.lat, p.lng) <= p.r) {
            hit = true;
            break;
          }
    if (hit) ids.push(h.id);
  }
  const body: AlongResponse = { radius, queries, ids };
  return c.json(body);
});

// ---- 採集機推入 ----

const Version = z.string().min(1).max(40);
const RoutesBody = z.object({ version: Version, items: z.array(BusRouteIn).min(1).max(100) });
const StopsBody = z.object({ version: Version, items: z.array(BusStopIn).min(1).max(2000) });

// 一個請求一條 SQL:整批 JSON 綁成一個參數,用 json_each 展開(D1 一次呼叫的查詢數有上限,逐列 batch 會超過)
bus.post("/api/ingest/bus/routes", async (c) => {
  const parsed = RoutesBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues.slice(0, 20) }, 400);
  const { version, items } = parsed.data;
  const rows = items.map((r) => ({ ...r, shape: JSON.stringify(r.shape), schedule: r.schedule ? JSON.stringify(r.schedule) : null }));
  await c.env.DB.prepare(
    `INSERT OR REPLACE INTO bus_routes (key, route_uid, name, variant, city, direction, from_name, to_name, stop_count, length_m, shape_json, schedule_json, version)
     SELECT j.value ->> 'key', j.value ->> 'route_uid', j.value ->> 'name', j.value ->> 'variant', j.value ->> 'city', j.value ->> 'direction',
            j.value ->> 'from_name', j.value ->> 'to_name', j.value ->> 'stop_count', j.value ->> 'length_m',
            j.value ->> 'shape', j.value ->> 'schedule', ?1
     FROM json_each(?2) AS j`,
  )
    .bind(version, JSON.stringify(rows))
    .run();
  return c.json({ upserted: items.length });
});

bus.post("/api/ingest/bus/stops", async (c) => {
  const parsed = StopsBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues.slice(0, 20) }, 400);
  const { version, items } = parsed.data;
  await c.env.DB.prepare(
    `INSERT OR REPLACE INTO bus_route_stops (route_key, seq, stop_uid, station_id, name, lat, lng, dist_m, t_min, version)
     SELECT j.value ->> 'route_key', j.value ->> 'seq', j.value ->> 'stop_uid', j.value ->> 'station_id', j.value ->> 'name',
            j.value ->> 'lat', j.value ->> 'lng', j.value ->> 'dist_m', j.value ->> 't_min', ?1
     FROM json_each(?2) AS j`,
  )
    .bind(version, JSON.stringify(items))
    .run();
  return c.json({ upserted: items.length });
});

const CommitBody = z.object({ version: Version, force: z.boolean().optional() });
bus.post("/api/ingest/bus/commit", async (c) => {
  const parsed = CommitBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid" }, 400);
  const { version, force } = parsed.data;
  const DB = c.env.DB;
  const count = async (sql: string) => ((await DB.prepare(sql).bind(version).first<{ n: number }>())?.n ?? 0);
  const fresh = await count("SELECT COUNT(*) AS n FROM bus_route_stops WHERE version = ?");
  const stale = await count("SELECT COUNT(*) AS n FROM bus_route_stops WHERE version <> ?");
  const total = fresh + stale;
  // 新版覆蓋了同 (route_key, seq) 的舊列,所以舊版總數 ≈ total;新版不到一半多半是抓壞了
  if (!force && fresh < total * 0.5) return c.json({ error: "新版站數不到現有的一半,疑似抓取不完整;確定要換就帶 force", fresh, total }, 409);
  const r1 = await DB.prepare("DELETE FROM bus_route_stops WHERE version <> ?").bind(version).run();
  const r2 = await DB.prepare("DELETE FROM bus_routes WHERE version <> ?").bind(version).run();
  return c.json({ stops: fresh, deleted_stops: r1.meta.changes ?? 0, deleted_routes: r2.meta.changes ?? 0 });
});
