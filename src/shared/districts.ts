/**
 * 行政區(鄉鎮市區)界:這個點在哪個區、每個區多大。落腳圈把格子歸到區用(worker/transit/zones.ts)。
 * 資料 src/shared/district-bounds.json(scripts/build_district_bounds.py 產生,約 100m 精度;只拿來判斷,不拿來畫圖)。
 */
import districtBounds from "./district-bounds.json";
import { cityAt, type CityName } from "./regions";

type Rings = number[][][]; // [ring][point][lng, lat]
interface District {
  city: CityName;
  name: string;
  polys: Rings[];
  bbox: [number, number, number, number];
  /** 平方公里 */
  km2: number;
}

function inRings(lng: number, lat: number, rings: Rings) {
  let inside = false;
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!;
      const [xj, yj] = ring[j]!;
      if (yi! > lat !== yj! > lat && lng < ((xj! - xi!) * (lat - yi!)) / (yj! - yi!) + xi!) inside = !inside;
    }
  return inside;
}

/** 多邊形面積(平方公里,外圈減洞;小範圍用等距近似) */
function areaKm2(polys: Rings[]) {
  let total = 0;
  for (const rings of polys)
    rings.forEach((ring, k) => {
      const lat0 = ring[0]![1]!;
      const kx = 111.32 * Math.cos((lat0 * Math.PI) / 180);
      let a = 0;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j]![0]! * kx * ring[i]![1]! * 110.54 - ring[i]![0]! * kx * ring[j]![1]! * 110.54;
      total += (k === 0 ? 1 : -1) * Math.abs(a / 2);
    });
  return total;
}

const BY_CITY = new Map<CityName, District[]>();
for (const [city, towns] of Object.entries(districtBounds as Record<string, Record<string, Rings[]>>)) {
  const list: District[] = [];
  for (const [name, polys] of Object.entries(towns)) {
    let w = 180,
      s = 90,
      e = -180,
      n = -90;
    for (const p of polys)
      for (const [lng, lat] of p[0]!) {
        w = Math.min(w, lng!);
        e = Math.max(e, lng!);
        s = Math.min(s, lat!);
        n = Math.max(n, lat!);
      }
    list.push({ city: city as CityName, name, polys, bbox: [w, s, e, n], km2: areaKm2(polys) });
  }
  BY_CITY.set(city as CityName, list);
}

/** 點在哪個區;不在任何一區(海上、界外)回 null。已知縣市可以傳進來省一次判斷 */
export function districtAt(lat: number, lng: number, city: CityName | null = cityAt(lat, lng)): { city: CityName; district: string } | null {
  if (!city) return null;
  for (const d of BY_CITY.get(city) ?? []) {
    const [w, s, e, n] = d.bbox;
    if (lng < w || lng > e || lat < s || lat > n) continue;
    if (d.polys.some((p) => inRings(lng, lat, p))) return { city, district: d.name };
  }
  return null;
}

/** 區的面積(平方公里);不認得回 null */
export function districtKm2(city: string, district: string): number | null {
  return BY_CITY.get(city as CityName)?.find((d) => d.name === district)?.km2 ?? null;
}
