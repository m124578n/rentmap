/**
 * YouBike 2.0 站點(pois 表 category = youbike)整份進記憶體網格,通勤規劃用來算「騎一段」:
 *   騎乘分鐘 = 直線距離 × 1.25(沿街)÷ 200 m/分(12 km/h),另加租 + 還 2 分;站點不看即時車數。
 */
import { haversine } from "@shared/bus";
import { DEFAULT_REGION, regionBbox, type RegionKey } from "@shared/regions";

export const BIKE_M_PER_MIN = 200;
export const BIKE_DETOUR = 1.25;
/** 租車 + 還車(刷卡、找車柱) */
export const BIKE_DOCK_MIN = 2;
/** 住處 / 目的地走到站:最多 300m */
export const BIKE_WALK_R = 300;
/** 捷運站旁的 YouBike 站:150m 內 */
export const BIKE_MRT_R = 150;
/** 直接騎到目的地最多 5km、騎去接捷運最多 3km(再遠就不實際) */
export const BIKE_DIRECT_MAX_M = 5000;
export const BIKE_TO_MRT_MAX_M = 3000;

export const rideMin = (m: number) => (m * BIKE_DETOUR) / BIKE_M_PER_MIN;

export interface BikeStation {
  name: string;
  lat: number;
  lng: number;
}
export interface BikeNet {
  sig: string;
  stations: BikeStation[];
  grid: Map<string, number[]>;
}

const CELL = 0.005;
const cellKey = (y: number, x: number) => `${y}:${x}`;
const cache = new Map<RegionKey, BikeNet>();

/** 一個生活圈一份(依生活圈外框取站) */
export async function loadBikes(DB: D1Database, region: RegionKey = DEFAULT_REGION): Promise<BikeNet> {
  const [w, s, e, n] = regionBbox(region);
  const box = "lat BETWEEN ?1 AND ?2 AND lng BETWEEN ?3 AND ?4";
  const head = await DB.prepare(`SELECT COUNT(*) AS n, MAX(version) AS v FROM pois WHERE category = 'youbike' AND ${box}`).bind(s, n, w, e).first<{ n: number; v: string | null }>();
  const sig = `${region}#${head?.n ?? 0}#${head?.v ?? ""}`;
  const hit = cache.get(region);
  if (hit?.sig === sig) return hit;
  const { results } = await DB.prepare(`SELECT name, lat, lng FROM pois WHERE category = 'youbike' AND (subtype IS NULL OR subtype <> '暫停營運') AND ${box}`)
    .bind(s, n, w, e)
    .all<{
      name: string | null;
      lat: number;
      lng: number;
    }>();
  const stations = results.map((r) => ({ name: r.name ?? "YouBike", lat: r.lat, lng: r.lng }));
  const grid = new Map<string, number[]>();
  stations.forEach((s, i) => {
    const k = cellKey(Math.floor(s.lat / CELL), Math.floor(s.lng / CELL));
    const list = grid.get(k);
    if (list) list.push(i);
    else grid.set(k, [i]);
  });
  const net = { sig, stations, grid };
  cache.set(region, net);
  return net;
}

export const EMPTY_BIKES: BikeNet = { sig: "", stations: [], grid: new Map() };

/** 半徑內的站(index, 距離) */
export function bikesNear(b: BikeNet, lat: number, lng: number, r: number): { i: number; m: number }[] {
  const dLat = r / 111320;
  const dLng = r / (111320 * Math.cos((lat * Math.PI) / 180));
  const out: { i: number; m: number }[] = [];
  for (let y = Math.floor((lat - dLat) / CELL); y <= Math.floor((lat + dLat) / CELL); y++)
    for (let x = Math.floor((lng - dLng) / CELL); x <= Math.floor((lng + dLng) / CELL); x++)
      for (const i of b.grid.get(cellKey(y, x)) ?? []) {
        const s = b.stations[i]!;
        const m = haversine(lat, lng, s.lat, s.lng);
        if (m <= r) out.push({ i, m });
      }
  return out.sort((a, c) => a.m - c.m);
}
