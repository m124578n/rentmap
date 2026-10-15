/**
 * 落腳圈的計算(GET /api/zones,型別在 src/shared/zones.ts):
 *   1. 把生活圈切成約 500m 的格子,只看每個地點「最外圈時間內可能到得了」的範圍(省 CPU)
 *   2. 每格算到每個地點的時間:大眾運輸用 transit/plan.ts(一個地點一張從目的地往回算的表)、機車開車用 transit/roads.ts(一個地點一次最短路徑)
 *   3. 合成一個時間(最久那個 / 依每週天數加權),依門檻分圈
 *   4. 圈內格子依行政區彙總:通勤、租金與房價行情、生活機能點數、淹水比例;另列圈內的捷運 / 台鐵站
 */
import { haversine } from "@shared/bus";
import type { CommuteMode } from "@shared/drive";
import { districtAt, districtKm2 } from "@shared/districts";
import { cityAt, REGIONS, regionBbox, type CityName, type RegionKey } from "@shared/regions";
import type { CommuteWhen } from "@shared/trip";
import type { Combine, ZoneDistrict, ZoneStation, ZonesResponse } from "@shared/zones";
import type { PoiCat } from "@shared/poi";
import type { BikeNet } from "./bike";
import { mrtGraph } from "./mrt";
import type { BusNet } from "./network";
import { bestTrip, buildPlan } from "./plan";
import { briefOf, runRoads, type RoadNet } from "./roads";
import { loadPools, poolKey } from "../routes/market";
import { loadSalePools } from "../routes/sale";
import { loadGrid } from "../routes/nearby";
import { levelsAt, loadZones } from "../routes/hazards";

/** 格子邊長(緯度度數,約 500m) */
const STEP = 0.0045;
/** 最外圈的時間內大概能走多遠(km / 分):決定要算哪些格子,寬一點沒關係(只是多算) */
const REACH_KM_PER_MIN: Record<CommuteMode, number> = { transit: 0.6, scooter: 0.7, car: 1.0 };
const RENT_KINDS = ["整層住家", "獨立套房", "分租套房", "雅房"];
const MIN_SAMPLES = 5;

export interface ZonePlace {
  id: number;
  name: string;
  lat: number;
  lng: number;
  days: number;
}

const median = (v: number[]) => {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

export async function computeZones(
  DB: D1Database,
  o: { region: RegionKey; places: ZonePlace[]; mode: CommuteMode; when: CommuteWhen; combine: Combine; rings: number[]; bus: BusNet; bikes: BikeNet; roads: RoadNet },
): Promise<ZonesResponse> {
  const { region, mode, when, combine } = o;
  const rings = [...o.rings].sort((a, b) => a - b);
  const places = o.places;
  const outer = rings.at(-1)!;
  const [rw, rs, re, rn] = regionBbox(region);
  const lat0 = (rs + rn) / 2;
  const kx = Math.cos((lat0 * Math.PI) / 180);
  const stepLng = STEP / kx;
  const base: ZonesResponse = {
    mode,
    combine,
    rings,
    when,
    places: places.map((p) => ({ id: p.id, name: p.name, days: p.days })),
    has_data: mode === "transit" ? o.bus.version != null : !!o.roads.g,
    step: STEP,
    step_lng: stepLng,
    cells: [],
    districts: [],
    stations: [],
  };
  if (!places.length) return base;

  // 每個地點:多遠以內要算、怎麼算時間
  const reachM = outer * REACH_KM_PER_MIN[mode] * 1000;
  const timers = places.map((pl) => {
    if (mode === "transit") {
      const plan = buildPlan(o.bus, pl, when, o.bikes);
      return (lat: number, lng: number) => bestTrip(plan, lat, lng, 400)?.total_min ?? null;
    }
    const run = runRoads(o.roads, mode, when, region, pl);
    return (lat: number, lng: number) => (run ? (briefOf(o.roads, run, { lat, lng })?.total_min ?? null) : null);
  });
  // 範圍:最久那個 → 每個地點都要到得了(交集);加權 → 任一個到得了(聯集)
  const boxes = places.map((p) => {
    const dLat = reachM / 110540;
    const dLng = reachM / (111320 * Math.cos((p.lat * Math.PI) / 180));
    return [p.lng - dLng, p.lat - dLat, p.lng + dLng, p.lat + dLat];
  });
  const pick = combine === "max" ? [Math.max, Math.min] : [Math.min, Math.max];
  const w = Math.max(rw, pick[0]!(...boxes.map((b) => b[0]!)));
  const s = Math.max(rs, pick[0]!(...boxes.map((b) => b[1]!)));
  const e = Math.min(re, pick[1]!(...boxes.map((b) => b[2]!)));
  const n = Math.min(rn, pick[1]!(...boxes.map((b) => b[3]!)));
  if (w >= e || s >= n) return base;

  const cities = new Set<string>(REGIONS[region].cities);
  const totalDays = places.reduce((t, p) => t + p.days, 0);
  interface Cell {
    lat: number;
    lng: number;
    ring: number;
    min: number;
    per: (number | null)[];
    city: CityName;
    district: string;
  }
  const cells = new Map<string, Cell>();
  const key = (iy: number, ix: number) => `${iy}:${ix}`;
  for (let iy = Math.floor(s / STEP); iy * STEP < n; iy++)
    for (let ix = Math.floor(w / stepLng); ix * stepLng < e; ix++) {
      const lat = (iy + 0.5) * STEP;
      const lng = (ix + 0.5) * stepLng;
      const near = places.map((p) => haversine(lat, lng, p.lat, p.lng) <= reachM);
      if (combine === "max" ? !near.every(Boolean) : !near.some(Boolean)) continue;
      const city = cityAt(lat, lng);
      if (!city || !cities.has(city)) continue;
      const d = districtAt(lat, lng, city);
      if (!d) continue;
      const per = timers.map((t, i) => (near[i] ? t(lat, lng) : null));
      let min: number | null;
      if (combine === "max") min = per.some((x) => x == null) ? null : Math.max(...(per as number[]));
      else {
        // 加權:到不了的地點當作很遠(最外圈的兩倍),不讓它被忽略
        min = Math.round(per.reduce<number>((t, x, i) => t + (x ?? outer * 2) * places[i]!.days, 0) / totalDays);
        if (per.every((x) => x == null)) min = null;
      }
      if (min == null) continue;
      const ring = rings.findIndex((r) => min! <= r);
      if (ring < 0) continue;
      cells.set(key(iy, ix), { lat, lng, ring, min, per, city, district: d.district });
    }

  // ---- 依行政區彙總 ----
  const byDist = new Map<string, Cell[]>();
  for (const c of cells.values()) (byDist.get(`${c.city}|${c.district}`) ?? byDist.set(`${c.city}|${c.district}`, []).get(`${c.city}|${c.district}`)!).push(c);
  const pools = await loadPools(DB);
  const salePools = new Map<string, Awaited<ReturnType<typeof loadSalePools>>>();
  // 生活機能:圈內格子裡的點
  const poiCount = new Map<string, Partial<Record<PoiCat, number>>>();
  const cellPois = new Map<Cell, number>();
  const { grid } = await loadGrid(DB, region);
  for (const list of grid.values())
    for (const p of list) {
      const ck = key(Math.floor(p.lat / STEP), Math.floor(p.lng / stepLng));
      const c = cells.get(ck);
      if (!c) continue;
      cellPois.set(c, (cellPois.get(c) ?? 0) + 1);
      const k = `${c.city}|${c.district}`;
      const m = poiCount.get(k) ?? poiCount.set(k, {}).get(k)!;
      m[p.category] = (m[p.category] ?? 0) + 1;
    }
  // 淹水:圈內格子中心落在潛勢區(颱風等級 0.5m 以上、或短時強降雨會淹)
  const hz = await loadZones(DB, region);
  const cellKm2 = (STEP * 110.54) * (stepLng * 111.32 * kx);

  const districts: ZoneDistrict[] = [];
  for (const [k, list] of byDist) {
    const [city, district] = k.split("|") as [CityName, string];
    const ringCells = rings.map((_, i) => list.filter((c) => c.ring === i).length);
    const area = districtKm2(city, district);
    let sp = salePools.get(city);
    if (!sp) salePools.set(city, (sp = await loadSalePools(DB, city)));
    const sales = (sp.byDistrict.get(district) ?? []).map((r) => r.unit_price).filter((x): x is number => !!x && x > 0);
    let flooded = 0;
    for (const c of list) {
      const lv = levelsAt(hz, c.lat, c.lng);
      if ((lv.flood24 ?? 0) >= 2 || (lv.flood6 ?? 0) >= 1) flooded++;
    }
    // 代表點:通勤不超過全區中位數的格子裡,生活機能點最多的那格(有人住、有店的地方,不是山上)
    const med = median(list.map((c) => c.min));
    const pt = list.filter((c) => c.min <= med).reduce((a, b) => ((cellPois.get(b) ?? 0) > (cellPois.get(a) ?? 0) ? b : a));
    const lats = list.map((c) => c.lat);
    const lngs = list.map((c) => c.lng);
    districts.push({
      city,
      district,
      ring_cells: ringCells,
      share: area ? Math.min(1, (list.length * cellKm2) / area) : 0,
      best_ring: Math.min(...list.map((c) => c.ring)),
      min: Math.min(...list.map((c) => c.min)),
      median: med,
      pt: [Math.round(pt.lat * 1e5) / 1e5, Math.round(pt.lng * 1e5) / 1e5],
      per_place: places.map((_, i) => {
        const v = list.map((c) => c.per[i]).filter((x): x is number => x != null);
        return v.length ? median(v) : null;
      }),
      bbox: [Math.min(...lngs) - stepLng / 2, Math.min(...lats) - STEP / 2, Math.max(...lngs) + stepLng / 2, Math.max(...lats) + STEP / 2],
      rent: RENT_KINDS.flatMap((kind) => {
        const pool = pools.get(poolKey(city, district, kind)) ?? [];
        return pool.length >= MIN_SAMPLES ? [{ kind, median: median(pool.map((r) => r.rent)), count: pool.length }] : [];
      }),
      sale_unit: sales.length >= MIN_SAMPLES ? median(sales) : null,
      sale_count: sales.length,
      pois: poiCount.get(k) ?? {},
      km2: Math.round(list.length * cellKm2 * 100) / 100,
      flood_share: Math.round((flooded / list.length) * 100) / 100,
    });
  }
  districts.sort((a, b) => a.median - b.median);

  // ---- 圈內的捷運 / 台鐵站 ----
  const stations: ZoneStation[] = [];
  for (const st of mrtGraph(region).stations) {
    const c = cells.get(key(Math.floor(st.lat / STEP), Math.floor(st.lng / stepLng)));
    if (!c) continue;
    stations.push({ name: st.name.replace(/^台鐵/, ""), rail: st.rail, lat: st.lat, lng: st.lng, min: c.min, ring: c.ring, district: c.district });
  }
  stations.sort((a, b) => a.min - b.min);

  return {
    ...base,
    cells: [...cells.values()].map((c) => [Math.round(c.lat * 1e5) / 1e5, Math.round(c.lng * 1e5) / 1e5, c.ring, c.min]),
    districts,
    stations,
  };
}
