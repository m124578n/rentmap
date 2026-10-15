/**
 * 落腳圈:依到「我的地點」的通勤時間,把生活圈分成第一圈 / 第二圈 / 第三圈,列出圈內的行政區與車站。
 * 計算在 worker/transit/zones.ts(GET /api/zones);排名分數、預算篩選、生活感在前端用這裡的函式算(權重可以即時調)。
 */
import { z } from "zod";
import type { CommuteMode } from "./drive";
import type { CommuteWhen } from "./trip";
import type { PoiCat } from "./poi";
import type { RegionKey } from "./regions";

/** 預設三圈:≤20 / ≤35 / ≤50 分(可以在畫面上改) */
export const DEFAULT_RINGS = [20, 35, 50] as const;
export const RING_LABEL = ["第一圈", "第二圈", "第三圈", "第四圈"];
export const RING_COLOR = ["#059669", "#84cc16", "#f59e0b", "#f97316"];

/** 多個地點怎麼合成一個時間:max = 最久那個(每個地點都要能接受)、weighted = 依每週天數加權平均 */
export const COMBINES = ["max", "weighted"] as const;
export type Combine = (typeof COMBINES)[number];
export const COMBINE_LABEL: Record<Combine, string> = { max: "最久那個地點", weighted: "依每週天數加權" };

export const ZonesQuery = z.object({
  mode: z.enum(["transit", "scooter", "car"]).default("transit"),
  combine: z.enum(COMBINES).default("max"),
  rings: z
    .string()
    .default(DEFAULT_RINGS.join(","))
    .transform((s) => s.split(",").map(Number))
    .pipe(z.array(z.number().int().min(5).max(120)).min(1).max(4)),
});

export interface ZoneDistrict {
  city: string;
  district: string;
  /** 每一圈有幾格(只算這一圈、不含內圈) */
  ring_cells: number[];
  /** 圈內面積佔全區的比例(0–1) */
  share: number;
  /** 最內是第幾圈(0 = 第一圈) */
  best_ring: number;
  /** 圈內格子的合成通勤時間:最短、中位數 */
  min: number;
  median: number;
  /** 每個地點各自的中位數(順序同 places;到不了 null) */
  per_place: (number | null)[];
  /** 圈內格子的範圍 [w, s, e, n](點了縮放過去) */
  bbox: [number, number, number, number];
  /** 租賃實價登錄近一年中位數(依房型;樣本 < 5 不列) */
  rent: { kind: string; median: number; count: number }[];
  /** 買賣近一年每坪單價中位數(元 / 坪);樣本 < 5 為 null */
  sale_unit: number | null;
  sale_count: number;
  /** 圈內格子裡的生活機能點數 */
  pois: Partial<Record<PoiCat, number>>;
  /** 圈內格子的面積(平方公里),算密度用 */
  km2: number;
  /** 圈內格子落在淹水潛勢(颱風等級 0.5m 以上或短時強降雨會淹)的比例 */
  flood_share: number;
}

export interface ZoneStation {
  name: string;
  rail: "mrt" | "tra";
  lat: number;
  lng: number;
  /** 合成通勤時間(站所在那一格) */
  min: number;
  ring: number;
  district: string | null;
}

export interface ZonesResponse {
  mode: CommuteMode;
  combine: Combine;
  rings: number[];
  when: CommuteWhen;
  places: { id: number; name: string; days: number }[];
  /** 有沒有交通資料(大眾運輸看公車網路、機車開車看道路圖);沒有時圈只是參考 */
  has_data: boolean;
  /** 格子大小(緯度度數 / 經度度數) */
  step: number;
  step_lng: number;
  /** 圈內的格子:[格子中心 lat, lng, 第幾圈, 合成分鐘] */
  cells: [number, number, number, number][];
  districts: ZoneDistrict[];
  stations: ZoneStation[];
}

/** GET /api/shares/:token/zones:分享連結(不用登入,唯讀) */
export interface SharedZones extends ZonesResponse {
  region: RegionKey;
  created_at: string;
}

// ---- 前端:落腳分數、生活感 ----

/** 分數的五個面向與預設權重(0 = 不看) */
export const SCORE_KEYS = ["commute", "rent", "life", "safety", "flood"] as const;
export type ScoreKey = (typeof SCORE_KEYS)[number];
export const SCORE_LABEL: Record<ScoreKey, string> = { commute: "通勤", rent: "租金", life: "生活機能", safety: "治安", flood: "不淹水" };
export const DEFAULT_WEIGHTS: Record<ScoreKey, number> = { commute: 3, rent: 2, life: 2, safety: 1, flood: 1 };

/** 生活機能密度用的類別(每平方公里幾個) */
export const LIFE_CATS: PoiCat[] = ["convenience", "supermarket", "food", "market", "park", "clinic"];

/** 一個區的「代表租金」:整層住家優先,沒有就套房 */
export function rentOf(d: ZoneDistrict, kind?: string): number | null {
  const pick = kind ? d.rent.find((r) => r.kind === kind) : (d.rent.find((r) => r.kind === "整層住家") ?? d.rent.find((r) => r.kind === "獨立套房") ?? d.rent[0]);
  return pick?.median ?? null;
}

export const lifeDensity = (d: ZoneDistrict) => (d.km2 > 0 ? LIFE_CATS.reduce((n, c) => n + (d.pois[c] ?? 0), 0) / d.km2 : 0);

/**
 * 每個區 0–100 分:各面向在這次結果的區之間排名換成 0–1(最好 1),依權重加權平均。
 * crimeOf:近一年住宅竊盜件數(沒有資料回 null,那一項不算)。
 */
export function scoreDistricts(ds: ZoneDistrict[], weights: Record<ScoreKey, number>, opts: { rentKind?: string; crimeOf?: (d: ZoneDistrict) => number | null } = {}) {
  const metric: Record<ScoreKey, (d: ZoneDistrict) => number | null> = {
    commute: (d) => -d.median,
    rent: (d) => {
      const r = rentOf(d, opts.rentKind);
      return r == null ? null : -r;
    },
    life: (d) => lifeDensity(d),
    safety: (d) => {
      const c = opts.crimeOf?.(d);
      return c == null ? null : -c;
    },
    flood: (d) => -d.flood_share,
  };
  const rank = (k: ScoreKey) => {
    const vals = ds.map((d) => metric[k](d));
    const sorted = vals.filter((v): v is number => v != null).sort((a, b) => a - b);
    return vals.map((v) => (v == null || sorted.length < 2 ? null : sorted.indexOf(v) / (sorted.length - 1)));
  };
  const ranks = Object.fromEntries(SCORE_KEYS.map((k) => [k, rank(k)])) as Record<ScoreKey, (number | null)[]>;
  return ds.map((_, i) => {
    let sum = 0;
    let w = 0;
    for (const k of SCORE_KEYS) {
      const r = ranks[k][i];
      if (r == null || !weights[k]) continue;
      sum += r * weights[k];
      w += weights[k];
    }
    return w ? Math.round((sum / w) * 100) : null;
  });
}

/** 一句話的生活感(從資料自動產生):例「超商很密、公園多、近捷運大安站(第一圈)」 */
export function lifeSentence(d: ZoneDistrict, stations: ZoneStation[]): string {
  const parts: string[] = [];
  const per = (c: PoiCat) => (d.km2 > 0 ? (d.pois[c] ?? 0) / d.km2 : 0);
  if (per("convenience") >= 15) parts.push("超商很密");
  else if (per("convenience") < 3) parts.push("超商少");
  if (per("park") >= 6) parts.push("公園多");
  if (per("market") >= 1 || (d.pois.nightmarket ?? 0) > 0) parts.push((d.pois.nightmarket ?? 0) > 0 ? "有夜市、市場" : "有傳統市場");
  if (per("food") >= 60) parts.push("吃的選擇多");
  if (per("clinic") >= 8) parts.push("看病方便");
  const st = stations.filter((s) => s.district === d.district).sort((a, b) => a.min - b.min);
  if (st.length) parts.push(`${st[0]!.rail === "tra" ? "台鐵" : "捷運"}${st[0]!.name}站 ${st[0]!.min} 分到`);
  if (d.flood_share >= 0.3) parts.push("部分地區有淹水潛勢");
  return parts.length ? parts.join("、") : "住宅為主、機能普通";
}
