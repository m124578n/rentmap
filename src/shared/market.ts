/**
 * 租金行情(內政部租賃實價登錄)。匯入格式、API 回傳型別、行情計算(純函式,前後端 / 測試共用)。
 *
 * 相似物件:同縣市、同行政區、同房型(整層 / 獨立套房 / 分租套房 / 雅房),近一年,排除社宅包租代管與含車位。
 * 由嚴到寬試五層條件,第一個有 MIN_SAMPLES 筆的就用:
 *   0 同區:坪數 ±30%、房數相同、屋齡 ±10 年、電梯相同
 *   1 同區:坪數 ±30%、房數相同
 *   2 同區:坪數 ±50%
 *   3 同縣市:坪數 ±30%、房數相同(同區樣本少時,寧可擴大範圍也不放掉坪數:信義區一年只有 42 筆獨立套房、
 *     中位數 11 萬,多是服務式公寓,拿來比 6 坪套房會差九成)
 *   4 同區同房型(都不夠時的最後手段,標樣本 / 條件)
 * 分租套房 / 雅房的登錄面積常是整戶,不看坪數。房源缺某欄位就略過那個條件。
 * 先清樣本:
 *   - 同一棟(路段 + 總樓層 + 屋齡)最多算 2 筆(包租業者會把同一棟的每間都登錄,條件一收窄就只剩那一棟)
 *   - 租金超過全體中位數 3 倍或不到 1/3 的不算(實測信義區有業者把整戶 24 萬的租約以「分租套房」反覆登錄)
 */
import { z } from "zod";
import { ALL_CITIES, type CityName } from "./regions";

export const RentStatIn = z.object({
  serial: z.string().min(1).max(40),
  // 匯入接受所有縣市(含還沒開放的生活圈):開區前要能先把資料抓進來(docs/design/2026-09-30-open-a-region.md)
  city: z.enum(ALL_CITIES as [CityName, ...CityName[]]),
  district: z.string().min(1).max(10),
  road: z.string().max(40).nullable(),
  kind: z.string().max(10).nullable(),
  building_type: z.string().max(30).nullable(),
  floor: z.number().int().nullable(),
  total_floors: z.number().int().nullable(),
  building_age: z.number().int().min(0).max(150).nullable(),
  size_ping: z.number().min(0).max(10000).nullable(),
  rooms: z.number().int().min(0).max(50).nullable(),
  livings: z.number().int().min(0).max(50).nullable(),
  baths: z.number().int().min(0).max(50).nullable(),
  rent: z.number().int().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  has_elevator: z.boolean().nullable(),
  furnished: z.boolean().nullable(),
  has_mgmt: z.boolean().nullable(),
  has_parking: z.boolean(),
  social: z.boolean(),
});
export type RentStatIn = z.infer<typeof RentStatIn>;

/** 行情計算用的一筆(資料庫的一列) */
export type RentStat = Pick<RentStatIn, "district" | "road" | "kind" | "building_type" | "floor" | "total_floors" | "building_age" | "size_ping" | "rooms" | "rent" | "date" | "has_elevator">;

export interface MarketTarget {
  kind: string | null | undefined;
  size_ping: number | null;
  rooms: number | null;
  building_age: number | null;
  has_elevator: boolean | null;
  rent: number | null;
}

export interface MarketResult {
  /** 用到第幾層條件(0 最嚴) */
  level: number;
  /** 比的範圍:同區或全縣市 */
  scope: "district" | "city";
  /** 這層用了哪些條件(給人看) */
  criteria: string[];
  count: number;
  /** 樣本 ≥ MIN_SAMPLES */
  enough: boolean;
  median: number;
  p25: number;
  p75: number;
  /** 每坪租金中位數(整層 / 獨立套房才有) */
  per_ping_median: number | null;
  /** 這間的租金比中位數高 / 低幾 %;沒有租金為 null */
  diff_pct: number | null;
  /** 最像的幾筆:坪數最接近、再來較新的 */
  comparables: RentStat[];
  /** 資料涵蓋的租賃日範圍 */
  from: string;
  to: string;
}
/** sale = 買房筆記:median 是買賣實價登錄的每坪單價、diff_pct 是開價換算單價比行情 */
export type MarketBrief = Pick<MarketResult, "median" | "diff_pct" | "count" | "enough" | "level"> & { sale?: boolean };

/** GET /api/market:所有房源的行情摘要;items[propertyId],null = 算不出(沒房型 / 沒樣本) */
export interface MarketMatrix {
  has_data: boolean;
  items: Record<string, MarketBrief | null>;
}
export interface MarketResponse {
  has_data: boolean;
  market: MarketResult | null;
  /** 目前開價:系統裡還在刊登的同區同房型(不含這間),用同一套相似條件;comparables 不給(那是房源不是實價登錄) */
  asking: Omit<MarketResult, "comparables"> | null;
  /** 方案不含成交明細:comparables 是空的(shared/plan.ts 的 marketDetail) */
  detail_locked?: boolean;
}

export const MIN_SAMPLES = 5;
const SIZE_BY_PING = new Set(["整層住家", "獨立套房"]);

export function quantile(sorted: number[], q: number) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** pool = 同縣市、同區、同房型、近一年、已排除社宅 / 含車位 */
export const OUTLIER_FACTOR = 3;

export const PER_BUILDING = 2;

/** 同一棟最多 PER_BUILDING 筆(留最新的);再剔除租金超過全體中位數 3 倍或不到 1/3 的 */
export function cleanPool(all: RentStat[]) {
  if (!all.length) return all;
  const seen = new Map<string, number>();
  const capped = [...all]
    .sort((a, b) => b.date.localeCompare(a.date))
    .filter((r) => {
      if (!r.road || r.total_floors == null || r.building_age == null) return true;
      const k = `${r.road}|${r.total_floors}|${r.building_age}`;
      const n = (seen.get(k) ?? 0) + 1;
      seen.set(k, n);
      return n <= PER_BUILDING;
    });
  const mid = quantile(capped.map((r) => r.rent).sort((a, b) => a - b), 0.5);
  return capped.filter((r) => r.rent <= mid * OUTLIER_FACTOR && r.rent >= mid / OUTLIER_FACTOR);
}

/**
 * districtPool = 同區同房型;cityPool = 同縣市同房型(省略就不擴大範圍)。
 * 一次算很多間時,呼叫端先各自 cleanPool 一次再傳 cleaned: true(整理樣本池是 O(n log n),每間都做太慢)。
 */
export function computeMarket(t: MarketTarget, districtPool: RentStat[], cityPool: RentStat[] = [], opts: { cleaned?: boolean } = {}): MarketResult | null {
  const pool = opts.cleaned ? districtPool : cleanPool(districtPool);
  const wide = opts.cleaned ? cityPool : cleanPool(cityPool);
  if (!pool.length && !wide.length) return null;
  const useSize = t.size_ping != null && t.size_ping > 0 && SIZE_BY_PING.has(t.kind ?? "");
  const useRooms = t.rooms != null && t.kind === "整層住家";
  const sizeWithin = (r: RentStat, k: number) => !useSize || (r.size_ping != null && Math.abs(r.size_ping - t.size_ping!) <= t.size_ping! * k);
  const roomsEq = (r: RentStat) => !useRooms || r.rooms === t.rooms;
  const ageNear = (r: RentStat) => t.building_age == null || (r.building_age != null && Math.abs(r.building_age - t.building_age) <= 10);
  const elevEq = (r: RentStat) => t.has_elevator == null || r.has_elevator === t.has_elevator;

  const lbl = {
    size: (k: number) => (useSize ? [`坪數 ±${k * 100}%`] : []),
    rooms: useRooms ? [`${t.rooms} 房`] : [],
    age: t.building_age != null ? ["屋齡 ±10 年"] : [],
    elev: t.has_elevator != null ? [t.has_elevator ? "有電梯" : "無電梯"] : [],
  };
  type Tier = { from: RentStat[]; scope: MarketResult["scope"]; test: (r: RentStat) => boolean; criteria: string[] };
  const tiers: Tier[] = [
    { from: pool, scope: "district", test: (r) => sizeWithin(r, 0.3) && roomsEq(r) && ageNear(r) && elevEq(r), criteria: [...lbl.size(0.3), ...lbl.rooms, ...lbl.age, ...lbl.elev] },
    { from: pool, scope: "district", test: (r) => sizeWithin(r, 0.3) && roomsEq(r), criteria: [...lbl.size(0.3), ...lbl.rooms] },
    { from: pool, scope: "district", test: (r) => sizeWithin(r, 0.5), criteria: lbl.size(0.5) },
    // 同區夠多卻還是湊不到 → 看全縣市相近坪數;沒坪數條件的話這層跟同區全部一樣,跳過
    ...(useSize || useRooms ? [{ from: wide, scope: "city" as const, test: (r: RentStat) => sizeWithin(r, 0.3) && roomsEq(r), criteria: [...lbl.size(0.3), ...lbl.rooms] }] : []),
    { from: pool, scope: "district", test: () => true, criteria: [] },
  ];
  let level = tiers.length - 1;
  let rows = pool;
  for (let i = 0; i < tiers.length; i++) {
    const hit = tiers[i]!.from.filter(tiers[i]!.test);
    if (hit.length >= MIN_SAMPLES || i === tiers.length - 1) {
      level = i;
      rows = hit;
      break;
    }
  }
  if (!rows.length) return null;
  const rents = rows.map((r) => r.rent).sort((a, b) => a - b);
  const median = Math.round(quantile(rents, 0.5));
  const perPing = SIZE_BY_PING.has(t.kind ?? "")
    ? rows
        .filter((r) => r.size_ping && r.size_ping > 0)
        .map((r) => r.rent / r.size_ping!)
        .sort((a, b) => a - b)
    : [];
  const dates = rows.map((r) => r.date).sort();
  const comparables = [...rows]
    .sort((a, b) => (useSize ? Math.abs((a.size_ping ?? 1e9) - t.size_ping!) - Math.abs((b.size_ping ?? 1e9) - t.size_ping!) : 0) || b.date.localeCompare(a.date))
    .slice(0, 8);
  return {
    level: tiers[level]!.scope === "city" ? 3 : level === tiers.length - 1 ? 4 : level,
    scope: tiers[level]!.scope,
    criteria: tiers[level]!.criteria,
    count: rows.length,
    enough: rows.length >= MIN_SAMPLES,
    median,
    p25: Math.round(quantile(rents, 0.25)),
    p75: Math.round(quantile(rents, 0.75)),
    per_ping_median: perPing.length ? Math.round(quantile(perPing, 0.5)) : null,
    diff_pct: t.rent != null && median > 0 ? Math.round(((t.rent - median) / median) * 100) : null,
    comparables,
    from: dates[0]!,
    to: dates[dates.length - 1]!,
  };
}

export const briefOf = (m: MarketResult | null): MarketBrief | null =>
  m ? { median: m.median, diff_pct: m.diff_pct, count: m.count, enough: m.enough, level: m.level } : null;
