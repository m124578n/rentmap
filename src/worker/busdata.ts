/**
 * 公車查詢共用:附近站、路線資料、班表摘要 → 等車分鐘。
 */
import { haversine, walkMin, type DaySummary, type NearbyStop, type Schedule } from "@shared/bus";

export interface StopRow {
  route_key: string;
  seq: number;
  name: string;
  lat: number;
  lng: number;
  dist_m: number;
  t_min: number | null;
}
export interface Hit extends StopRow {
  distance_m: number;
}
export interface RouteMeta {
  key: string;
  route_uid: string;
  name: string;
  city: string;
  direction: number;
  from_name: string | null;
  to_name: string | null;
  schedule_json: string | null;
}

/** bbox 先篩(走 lat,lng 索引),再算真距離 */
export async function stopsNear(DB: D1Database, lat: number, lng: number, radius: number): Promise<Hit[]> {
  const dLat = radius / 111320;
  const dLng = radius / (111320 * Math.cos((lat * Math.PI) / 180));
  const { results } = await DB.prepare(
    "SELECT route_key, seq, name, lat, lng, dist_m, t_min FROM bus_route_stops WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?",
  )
    .bind(lat - dLat, lat + dLat, lng - dLng, lng + dLng)
    .all<StopRow>();
  const out: Hit[] = [];
  for (const r of results) {
    const d = haversine(lat, lng, r.lat, r.lng);
    if (d <= radius) out.push({ ...r, distance_m: Math.round(d) });
  }
  return out;
}

export async function routeMetas(DB: D1Database, keys: string[]): Promise<Map<string, RouteMeta>> {
  const out = new Map<string, RouteMeta>();
  for (let i = 0; i < keys.length; i += 90) {
    const chunk = keys.slice(i, i + 90);
    const { results } = await DB.prepare(
      `SELECT key, route_uid, name, city, direction, from_name, to_name, schedule_json FROM bus_routes WHERE key IN (${chunk.map(() => "?").join(",")})`,
    )
      .bind(...chunk)
      .all<RouteMeta>();
    for (const r of results) out.set(r.key, r);
  }
  return out;
}

export function parseSchedule(raw: string | null): Schedule | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Schedule;
  } catch {
    return null;
  }
}

export const toStop = (h: Hit): NearbyStop => ({ name: h.name, seq: h.seq, lat: h.lat, lng: h.lng, distance_m: h.distance_m, walk_min: walkMin(h.distance_m) });
