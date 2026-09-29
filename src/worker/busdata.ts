/**
 * 公車查詢共用:附近站、路線資料、直達搭法。/api/bus/nearby(單點)與 /api/commute(所有房源 × 所有地點)都用這裡。
 */
import { BUS_M_PER_MIN, haversine, walkMin, type CommuteOption, type DaySummary, type NearbyStop, type Schedule } from "@shared/bus";

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

/** 平均等車 = 平日班距中間值的一半(先看尖峰,再看離峰),沒資料當 10 分 */
export function waitMin(s: DaySummary | null) {
  const h = s?.peak ?? s?.offpeak;
  if (!h) return 10;
  return Math.min(30, Math.max(1, Math.round((h[0] + h[1]) / 4)));
}

/**
 * 直達搭法:同一條路線方向,家附近的站(上車)站序 < 目的地附近的站(下車)。每個路線方向留總時間最短的一種。
 * 總時間 = 走到站 + 等車(班距一半)+ 坐車(時刻表有就用,沒有用距離估)+ 下車走過去
 */
export function directOptions(homeHits: Hit[], destHits: Hit[], metas: Map<string, RouteMeta>, summaries: Map<string, DaySummary | null>): CommuteOption[] {
  const byKeyHome = new Map<string, Hit[]>();
  for (const h of homeHits) byKeyHome.set(h.route_key, [...(byKeyHome.get(h.route_key) ?? []), h]);
  const best = new Map<string, CommuteOption>();
  const walkM = (o: CommuteOption) => o.board.distance_m + o.alight.distance_m;
  for (const a of destHits) {
    const homes = byKeyHome.get(a.route_key);
    const m = metas.get(a.route_key);
    if (!homes || !m) continue;
    const wd = summaries.get(a.route_key) ?? null;
    for (const b of homes) {
      if (b.seq >= a.seq) continue;
      const exact = a.t_min != null && b.t_min != null && a.t_min >= b.t_min;
      const ride = Math.max(1, exact ? a.t_min! - b.t_min! : Math.round((a.dist_m - b.dist_m) / BUS_M_PER_MIN));
      const board = toStop(b);
      const alight = toStop(a);
      const wait = waitMin(wd);
      const opt: CommuteOption = {
        key: m.key,
        name: m.name,
        to_name: m.to_name,
        board,
        alight,
        stops: a.seq - b.seq,
        ride_min: ride,
        ride_exact: exact,
        wait_min: wait,
        total_min: board.walk_min + wait + ride + alight.walk_min,
        wd,
      };
      const cur = best.get(m.key);
      // 同分時少走路的贏(提早一站下車再走,和坐到底常常算出一樣的分鐘)
      if (!cur || opt.total_min < cur.total_min || (opt.total_min === cur.total_min && walkM(opt) < walkM(cur))) best.set(m.key, opt);
    }
  }
  return [...best.values()].sort((x, y) => x.total_min - y.total_min);
}
