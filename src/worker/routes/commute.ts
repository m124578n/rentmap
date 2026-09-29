/**
 * 所有房源 × 我的每個地點的公車直達通勤(需登入):
 *   GET /api/commute?radius=400  → CommuteMatrix
 *
 * 不對每間房各查一次(房源上千間),而是對每個地點:
 *   1. 找地點 500m 內的站 → 哪些路線方向到得了
 *   2. 一次撈出這些路線方向「在下車站之前」的所有站
 *   3. 站丟進網格,每間房只看附近格子裡半徑內的站 → directOptions
 * 查詢數 ≈ 地點數 × (1 + 路線數/90 × 2),和房源數無關。
 */
import { Hono } from "hono";
import { asc, eq } from "drizzle-orm";
import { haversine, summarizeDay, type CommuteBest, type CommuteMatrix, type DaySummary } from "@shared/bus";
import type { AppEnv } from "../env";
import { requireUser } from "../auth";
import { db, schema } from "../db";
import { directOptions, parseSchedule, routeMetas, stopsNear, type Hit, type StopRow } from "../busdata";

export const commute = new Hono<AppEnv>();
commute.use("/api/commute", requireUser());

const DEST_RADIUS = 500;

commute.get("/api/commute", async (c) => {
  const radius = Math.min(1000, Math.max(100, Number(c.req.query("radius")) || 400));
  const DB = c.env.DB;
  const d = db(DB);
  const places = await d
    .select({ id: schema.myPlaces.id, lat: schema.myPlaces.lat, lng: schema.myPlaces.lng })
    .from(schema.myPlaces)
    .where(eq(schema.myPlaces.userId, c.get("user").id))
    .orderBy(asc(schema.myPlaces.id));
  const props = (await d.select({ id: schema.properties.id, lat: schema.properties.lat, lng: schema.properties.lng }).from(schema.properties)).filter(
    (p): p is { id: number; lat: number; lng: number } => p.lat != null && p.lng != null,
  );
  const hasBus = (await DB.prepare("SELECT 1 FROM bus_routes LIMIT 1").first()) != null;
  const items: CommuteMatrix["items"] = {};
  for (const p of props) items[p.id] = {};

  if (hasBus) {
    for (const place of places) {
      const destHits = await stopsNear(DB, place.lat, place.lng, DEST_RADIUS);
      const maxSeq = new Map<string, number>();
      for (const h of destHits) maxSeq.set(h.route_key, Math.max(maxSeq.get(h.route_key) ?? 0, h.seq));
      const keys = [...maxSeq.keys()];
      const metas = await routeMetas(DB, keys);
      const summaries = new Map<string, DaySummary | null>();
      for (const [k, m] of metas) summaries.set(k, summarizeDay(parseSchedule(m.schedule_json)?.wd));

      // 這些路線方向在下車站之前的站,放進網格(一格邊長 ≥ 半徑,查 3×3 格就涵蓋)
      const cell = radius / 100000;
      const grid = new Map<string, StopRow[]>();
      for (let i = 0; i < keys.length; i += 90) {
        const chunk = keys.slice(i, i + 90);
        const { results } = await DB.prepare(
          `SELECT route_key, seq, name, lat, lng, dist_m, t_min FROM bus_route_stops WHERE route_key IN (${chunk.map(() => "?").join(",")})`,
        )
          .bind(...chunk)
          .all<StopRow>();
        for (const s of results) {
          if (s.seq >= maxSeq.get(s.route_key)!) continue;
          const g = `${Math.floor(s.lat / cell)}:${Math.floor(s.lng / cell)}`;
          grid.set(g, [...(grid.get(g) ?? []), s]);
        }
      }

      for (const p of props) {
        const gy = Math.floor(p.lat / cell);
        const gx = Math.floor(p.lng / cell);
        const home: Hit[] = [];
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++)
            for (const s of grid.get(`${gy + dy}:${gx + dx}`) ?? []) {
              const dist = haversine(p.lat, p.lng, s.lat, s.lng);
              if (dist <= radius) home.push({ ...s, distance_m: Math.round(dist) });
            }
        const opts = home.length ? directOptions(home, destHits, metas, summaries) : [];
        const b = opts[0];
        items[p.id]![place.id] = b
          ? {
              total_min: b.total_min,
              name: b.name,
              to_name: b.to_name,
              board: b.board.name,
              board_walk: b.board.walk_min,
              alight: b.alight.name,
              alight_walk: b.alight.walk_min,
              ride_min: b.ride_min,
              wait_min: b.wait_min,
              stops: b.stops,
              others: [...new Set(opts.slice(1).map((o) => o.name))].filter((n) => n !== b.name).slice(0, 3),
            }
          : null;
      }
    }
  }
  const body: CommuteMatrix = { radius, has_bus: hasBus, items };
  return c.json(body);
});
