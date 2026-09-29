/**
 * 公車 API
 *
 * 查詢(需登入):
 *   GET /api/bus/nearby?lat=&lng=&radius=400 → 半徑內可搭的路線(同路線同方向只留最近的站),依距離排序
 *       (通勤怎麼搭改由 /api/commute/trips 算,含轉乘)
 *   GET /api/bus/routes/:key  → 一條路線方向的線形、全部站、時刻表
 *
 * 採集機推入(bearer INGEST_SECRET),覆蓋式:
 *   POST /api/ingest/bus/routes  { version, items: BusRouteIn[] }
 *   POST /api/ingest/bus/stops   { version, items: BusStopIn[] }
 *   POST /api/ingest/bus/commit  { version, force? } → 刪掉其他 version;新版站數不到舊版一半就擋下(抓壞保護)
 */
import { Hono } from "hono";
import { z } from "zod";
import { BusRouteIn, BusStopIn, summarizeDay, type BusRouteDetail, type DaySummary, type NearbyBusResponse, type NearbyRoute } from "@shared/bus";
import type { AppEnv } from "../env";
import { requireIngest, requireUser } from "../auth";
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
    g.dirs.push({ key, direction: m.direction, from_name: m.from_name, to_name: m.to_name, stop: toStop(h), wd: summaries.get(key) ?? null });
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
    "SELECT key, route_uid, name, city, direction, from_name, to_name, length_m, shape_json, schedule_json FROM bus_routes WHERE key = ?",
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
    `INSERT OR REPLACE INTO bus_routes (key, route_uid, name, city, direction, from_name, to_name, stop_count, length_m, shape_json, schedule_json, version)
     SELECT j.value ->> 'key', j.value ->> 'route_uid', j.value ->> 'name', j.value ->> 'city', j.value ->> 'direction',
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
