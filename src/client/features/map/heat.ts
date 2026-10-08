import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Feature, FeatureCollection } from "geojson";
import type { PropertySummary } from "@shared/schemas";
import { HAZARD_LABEL, hazardText, type HazardKind } from "@shared/hazard";
import { coverageCities } from "@shared/regions";
import { useRegion } from "@/lib/region";
import { COMMUTE_SIDE_LABEL } from "@shared/trip";
import { api, type Bbox } from "@/lib/api";
import { useFilters, whenOf } from "@/lib/filters";
import { usePlaces } from "@/features/places/places";

/**
 * 地圖「區域圖層」:看哪一區適合,而不是一間一間看。
 *   commute   畫面範圍切網格,每格到我的地點最久那個要幾分(/api/commute/grid,跟著篩選列的上班 / 下班與時段)
 *   rent      每坪租金:目前篩選後的房源,約 500m 一格取中位數(至少 2 間才畫)
 *   flood6 / flood24 / liquefaction / airnoise   災害多邊形(/api/hazards/zones;淹水與液化要放大才畫)
 */
export const HEAT_MODES = ["none", "commute", "rent", "flood6", "flood24", "liquefaction", "airnoise"] as const;
export type HeatMode = (typeof HEAT_MODES)[number];
export const HEAT_LABEL: Record<HeatMode, string> = {
  none: "不顯示",
  commute: "通勤時間",
  rent: "每坪租金",
  flood6: HAZARD_LABEL.flood6,
  flood24: HAZARD_LABEL.flood24,
  liquefaction: HAZARD_LABEL.liquefaction,
  airnoise: HAZARD_LABEL.airnoise,
};

export interface Viewport extends Bbox {
  zoom: number;
}

// ---- 通勤顏色(標記上色也用這組) ----

export const COMMUTE_LEGEND: [string, string][] = [
  ["≤20 分", "#059669"],
  ["≤30", "#65a30d"],
  ["≤45", "#d97706"],
  [">45", "#dc2626"],
  ["搭不到", "#9ca3af"],
];

/** 最久那個地點的通勤分鐘 → 顏色;undefined(還在算)回 undefined */
export function commuteColor(min: number | null | undefined): string | undefined {
  if (min === undefined) return undefined;
  if (min === null) return "#9ca3af";
  return min <= 20 ? "#059669" : min <= 30 ? "#65a30d" : min <= 45 ? "#d97706" : "#dc2626";
}

// 災害:淹水藍色系(越深越淹)、液化 / 噪音 黃 → 紅
const FLOOD_COLORS = ["", "#93c5fd", "#60a5fa", "#2563eb", "#1d4ed8", "#1e3a8a"];
const WARM_COLORS = ["", "#facc15", "#f97316", "#dc2626"];
const hazardColor = (k: HazardKind, level: number) => (k === "flood6" || k === "flood24" ? FLOOD_COLORS : WARM_COLORS)[level] ?? "#dc2626";

// 每坪租金:便宜綠 → 貴紅,依畫得出來的格子分五等份
const RENT_COLORS = ["#059669", "#65a30d", "#ca8a04", "#ea580c", "#dc2626"];
const RENT_CELL = 0.0045;

function square(lat: number, lng: number, h: number, w: number, color: string): Feature {
  const [s, n, west, e] = [lat - h / 2, lat + h / 2, lng - w / 2, lng + w / 2];
  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [[[west, s], [e, s], [e, n], [west, n], [west, s]]] },
    properties: { color },
  };
}

/** 畫面範圍往外取整(0.02 度),平移一點點不會重抓 */
function snap(v: Viewport): Bbox {
  const r = (x: number, up: boolean) => Math.round((up ? Math.ceil(x / 0.02) : Math.floor(x / 0.02)) * 0.02 * 100) / 100;
  return { w: r(v.w, false), s: r(v.s, false), e: r(v.e, true), n: r(v.n, true) };
}

export interface HeatResult {
  fc: FeatureCollection | null;
  legend: [string, string][];
  /** 圖層下方的小字(資料說明、要放大、還沒設地點…) */
  note: string | null;
  loading: boolean;
}

export function useHeat(mode: HeatMode, view: Viewport | null, items: PropertySummary[]): HeatResult {
  const region = useRegion();
  const f = useFilters();
  const places = usePlaces();
  const nPlaces = places.data?.items.length ?? 0;
  const box = view ? snap(view) : null;
  const when = whenOf(f, f.commuteSide);
  const isHazard = mode === "flood6" || mode === "flood24" || mode === "liquefaction" || mode === "airnoise";

  const grid = useQuery({
    queryKey: ["commute-grid", box, when.day, when.time, when.dir, f.commuteBike, places.data?.items.map((p) => `${p.id}:${p.lat},${p.lng}`).join("|")],
    queryFn: () => api.commuteGrid(box!, when, f.commuteBike),
    enabled: mode === "commute" && box != null && nPlaces > 0,
    staleTime: 10 * 60_000,
    placeholderData: keepPreviousData,
  });
  const zones = useQuery({
    // 航空噪音整份給(不看範圍),但伺服器依畫面中心決定哪個生活圈:key 要帶生活圈,不然切區後還是上一區的
    queryKey: ["hazard-zones", mode, mode === "airnoise" ? region.key : box],
    queryFn: () => api.hazardZones(mode as HazardKind, box!),
    enabled: isHazard && box != null,
    staleTime: 60 * 60_000,
    placeholderData: keepPreviousData,
  });

  return useMemo((): HeatResult => {
    if (mode === "none") return { fc: null, legend: [], note: null, loading: false };
    if (mode === "commute") {
      if (!nPlaces) return { fc: null, legend: [], note: "先在「我的地點」設公司地址", loading: false };
      const g = grid.data;
      const fc: FeatureCollection = {
        type: "FeatureCollection",
        features: (g?.cells ?? []).map((c) => {
          const worst = c.mins.some((m) => m == null) ? null : Math.max(...(c.mins as number[]));
          return square(c.lat, c.lng, g!.step, g!.step_lng, commuteColor(worst)!);
        }),
      };
      return {
        fc,
        legend: COMMUTE_LEGEND,
        note: `${COMMUTE_SIDE_LABEL[f.commuteSide]}${nPlaces > 1 ? "、最久那個地點" : ""};格子約 ${Math.round(((g?.step ?? 0.00225) * 111000) / 50) * 50}m`,
        loading: grid.isFetching,
      };
    }
    if (mode === "rent") {
      const cells = new Map<string, { lat: number; lng: number; v: number[] }>();
      for (const p of items) {
        if (p.lat == null || p.lng == null || p.rent == null || !p.size_ping) continue;
        const y = Math.floor(p.lat / RENT_CELL);
        const x = Math.floor(p.lng / RENT_CELL);
        const k = `${y}:${x}`;
        const c = cells.get(k) ?? { lat: (y + 0.5) * RENT_CELL, lng: (x + 0.5) * RENT_CELL, v: [] };
        c.v.push(p.rent / p.size_ping);
        cells.set(k, c);
      }
      const med = [...cells.values()]
        .filter((c) => c.v.length >= 2)
        .map((c) => {
          const v = c.v.sort((a, b) => a - b);
          return { ...c, m: v[Math.floor(v.length / 2)]! };
        });
      if (!med.length) return { fc: null, legend: [], note: "房源太少(每格至少 2 間有坪數的)", loading: false };
      const sorted = med.map((c) => c.m).sort((a, b) => a - b);
      const cuts = [0.2, 0.4, 0.6, 0.8].map((q) => sorted[Math.floor(q * (sorted.length - 1))]!);
      const bin = (m: number) => cuts.filter((c) => m > c).length;
      const fc: FeatureCollection = { type: "FeatureCollection", features: med.map((c) => square(c.lat, c.lng, RENT_CELL, RENT_CELL, RENT_COLORS[bin(c.m)]!)) };
      const $ = (n: number) => `$${Math.round(n).toLocaleString()}`;
      return {
        fc,
        legend: [[`≤${$(cuts[0]!)}`, RENT_COLORS[0]!], [`≤${$(cuts[1]!)}`, RENT_COLORS[1]!], [`≤${$(cuts[2]!)}`, RENT_COLORS[2]!], [`≤${$(cuts[3]!)}`, RENT_COLORS[3]!], [`更貴`, RENT_COLORS[4]!]],
        note: "每坪月租中位數,依目前篩選(房型混在一起會失真,建議只選一種)",
        loading: false,
      };
    }
    // 災害
    const k = mode as HazardKind;
    const z = zones.data;
    const levels = k === "flood6" || k === "flood24" ? [1, 2, 3, 4, 5] : [1, 2, 3];
    const legend = levels.map((l): [string, string] => [hazardText(k, l).replace("可能淹 ", ""), hazardColor(k, l)]);
    if (z?.too_big) return { fc: null, legend, note: "放大一點才會畫(圖資很細)", loading: zones.isFetching };
    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: (z?.features ?? []).map((ft) => ({ ...ft, properties: { color: hazardColor(k, ft.properties.level) } })),
    };
    const note =
      k === "liquefaction"
        ? `只有${coverageCities("liquefaction")}有資料`
        : k === "airnoise"
          ? coverageCities("airnoise", region.key)
            ? `${coverageCities("airnoise", region.key)}環保局依「里」公告的航空噪音防制區`
            : "這一區沒有航空噪音防制區的資料"
          : "水利署淹水潛勢(防洪設施正常運作下的模擬)";
    return { fc, legend, note, loading: zones.isFetching };
  }, [mode, grid.data, grid.isFetching, zones.data, zones.isFetching, items, nPlaces, f.commuteSide, region.key]);
}
