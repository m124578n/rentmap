/**
 * 買賣行情(內政部不動產買賣實價登錄)與房貸試算。匯入格式、API 回傳型別、計算(純函式,前後端 / 測試共用)。
 *
 * 單價用政府公布的「單價元平方公尺」換成每坪(車位有分開計價時已扣掉車位);總價估算 = 單價中位數 × 坪數。
 * 相似物件:同縣市、同建物型態(公寓 / 華廈 / 電梯大樓 / 透天)、近一年,由嚴到寬:
 *   0 同區:坪數 ±30%、屋齡 ±10 年
 *   1 同區:屋齡 ±10 年
 *   2 同區
 *   3 同縣市:屋齡 ±10 年(同區太少時)
 *   4 同區全部型態(最後手段)
 * 先清樣本:單價超過中位數 3 倍或不到 1/3 的不算(多半是登錄錯誤或特殊交易沒寫在備註)。
 */
import { z } from "zod";
import { ALL_CITIES, type CityName } from "./regions";
import { MIN_SAMPLES, quantile } from "./market";

/** 買賣行情看的建物型態(跟房源的 building_type 同一套名字) */
export const SALE_TYPES = ["公寓", "華廈", "電梯大樓", "透天"] as const;
export type SaleType = (typeof SALE_TYPES)[number];

/** 房源的建物型態 → 買賣行情的型態(套房、其他、沒填 → null,不限型態) */
export function saleTypeOf(t: string | null | undefined): SaleType | null {
  return t && (SALE_TYPES as readonly string[]).includes(t) ? (t as SaleType) : null;
}

export const SaleStatIn = z.object({
  serial: z.string().min(1).max(40),
  city: z.enum(ALL_CITIES as [CityName, ...CityName[]]),
  district: z.string().min(1).max(10),
  road: z.string().max(40).nullable(),
  building_type: z.enum(SALE_TYPES),
  floor: z.number().int().nullable(),
  total_floors: z.number().int().nullable(),
  building_age: z.number().int().min(0).max(150).nullable(),
  /** 建物移轉面積(坪),已扣車位面積 */
  size_ping: z.number().min(0).max(10000).nullable(),
  /** 總價(元,含車位) */
  price: z.number().int().min(1),
  /** 每坪單價(元,政府公布的單價換算) */
  unit_price: z.number().int().min(1).nullable(),
  rooms: z.number().int().min(0).max(50).nullable(),
  has_parking: z.boolean(),
  parking_price: z.number().int().min(0).nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  has_elevator: z.boolean().nullable(),
  has_mgmt: z.boolean().nullable(),
});
export type SaleStatIn = z.infer<typeof SaleStatIn>;

export type SaleStat = Pick<SaleStatIn, "district" | "road" | "building_type" | "floor" | "total_floors" | "building_age" | "size_ping" | "price" | "unit_price" | "rooms" | "has_parking" | "date">;

export interface SaleTarget {
  building_type: SaleType | null;
  size_ping: number | null;
  building_age: number | null;
  /** 開價(總價,元);有的話算比行情高低 */
  price: number | null;
}

export interface SaleMarketResult {
  level: number;
  scope: "district" | "city";
  criteria: string[];
  count: number;
  enough: boolean;
  /** 每坪單價(元) */
  unit_median: number;
  unit_p25: number;
  unit_p75: number;
  /** 單價中位數 × 坪數(沒坪數 null) */
  est_total: number | null;
  /** 開價換算的單價比中位數高 / 低幾 % */
  diff_pct: number | null;
  comparables: SaleStat[];
  from: string;
  to: string;
}
export interface SaleMarketResponse {
  has_data: boolean;
  market: SaleMarketResult | null;
  /** 方案不含成交明細:comparables 是空的(shared/plan.ts 的 marketDetail) */
  detail_locked?: boolean;
}

export function cleanSalePool(all: SaleStat[]) {
  const priced = all.filter((r) => r.unit_price && r.unit_price > 0);
  if (!priced.length) return priced;
  const mid = quantile(priced.map((r) => r.unit_price!).sort((a, b) => a - b), 0.5);
  return priced.filter((r) => r.unit_price! <= mid * 3 && r.unit_price! >= mid / 3);
}

/** districtPool = 同區全部型態、cityPool = 同縣市全部型態(都已 cleanSalePool 過或由這裡清) */
export function computeSaleMarket(t: SaleTarget, districtPool: SaleStat[], cityPool: SaleStat[] = [], opts: { cleaned?: boolean } = {}): SaleMarketResult | null {
  const pool = opts.cleaned ? districtPool : cleanSalePool(districtPool);
  const wide = opts.cleaned ? cityPool : cleanSalePool(cityPool);
  if (!pool.length && !wide.length) return null;
  const typeEq = (r: SaleStat) => !t.building_type || r.building_type === t.building_type;
  const useSize = t.size_ping != null && t.size_ping > 0;
  const sizeWithin = (r: SaleStat) => !useSize || (r.size_ping != null && Math.abs(r.size_ping - t.size_ping!) <= t.size_ping! * 0.3);
  const ageNear = (r: SaleStat) => t.building_age == null || (r.building_age != null && Math.abs(r.building_age - t.building_age) <= 10);
  const lbl = {
    type: t.building_type ? [t.building_type] : [],
    size: useSize ? ["坪數 ±30%"] : [],
    age: t.building_age != null ? ["屋齡 ±10 年"] : [],
  };
  type Tier = { from: SaleStat[]; scope: SaleMarketResult["scope"]; test: (r: SaleStat) => boolean; criteria: string[] };
  const tiers: Tier[] = [
    { from: pool, scope: "district", test: (r) => typeEq(r) && sizeWithin(r) && ageNear(r), criteria: [...lbl.type, ...lbl.size, ...lbl.age] },
    { from: pool, scope: "district", test: (r) => typeEq(r) && ageNear(r), criteria: [...lbl.type, ...lbl.age] },
    { from: pool, scope: "district", test: typeEq, criteria: lbl.type },
    { from: wide, scope: "city", test: (r) => typeEq(r) && ageNear(r), criteria: [...lbl.type, ...lbl.age] },
    { from: pool, scope: "district", test: () => true, criteria: [] },
  ];
  let level = tiers.length - 1;
  let rows: SaleStat[] = [];
  for (let i = 0; i < tiers.length; i++) {
    const hit = tiers[i]!.from.filter(tiers[i]!.test);
    if (hit.length >= MIN_SAMPLES || i === tiers.length - 1) {
      level = i;
      rows = hit;
      break;
    }
  }
  if (!rows.length) return null;
  const units = rows.map((r) => r.unit_price!).sort((a, b) => a - b);
  const median = Math.round(quantile(units, 0.5));
  const myUnit = t.price != null && useSize ? t.price / t.size_ping! : null;
  const dates = rows.map((r) => r.date).sort();
  const comparables = [...rows]
    .sort((a, b) => (useSize ? Math.abs((a.size_ping ?? 1e9) - t.size_ping!) - Math.abs((b.size_ping ?? 1e9) - t.size_ping!) : 0) || b.date.localeCompare(a.date))
    .slice(0, 8);
  return {
    level,
    scope: tiers[level]!.scope,
    criteria: tiers[level]!.criteria,
    count: rows.length,
    enough: rows.length >= MIN_SAMPLES,
    unit_median: median,
    unit_p25: Math.round(quantile(units, 0.25)),
    unit_p75: Math.round(quantile(units, 0.75)),
    est_total: useSize ? Math.round((median * t.size_ping!) / 10000) * 10000 : null,
    diff_pct: myUnit != null && median > 0 ? Math.round(((myUnit - median) / median) * 100) : null,
    comparables,
    from: dates[0]!,
    to: dates[dates.length - 1]!,
  };
}

// ---- 房貸試算 ----

export interface MortgageInput {
  /** 總價(元) */
  price: number;
  /** 自備款比例(0–1) */
  down: number;
  /** 年利率(%,例 2.2) */
  rate: number;
  /** 年限 */
  years: number;
  /** 寬限期(年,只繳利息) */
  grace?: number;
}
export interface MortgageResult {
  loan: number;
  downPayment: number;
  /** 寬限期內每月(只繳利息);沒有寬限期 null */
  graceMonthly: number | null;
  /** 本息平均攤還的每月 */
  monthly: number;
  totalInterest: number;
}

/** 本息平均攤還;寬限期內只繳利息,之後用剩下的年限攤還 */
export function mortgage(i: MortgageInput): MortgageResult {
  const loan = Math.round(i.price * (1 - i.down));
  const r = i.rate / 100 / 12;
  const grace = Math.max(0, Math.min(i.grace ?? 0, i.years - 1));
  const n = (i.years - grace) * 12;
  const monthly = r === 0 ? loan / n : (loan * r) / (1 - (1 + r) ** -n);
  const graceMonthly = grace ? loan * r : null;
  const total = monthly * n + (graceMonthly ?? 0) * grace * 12;
  return {
    loan,
    downPayment: i.price - loan,
    graceMonthly: graceMonthly == null ? null : Math.round(graceMonthly),
    monthly: Math.round(monthly),
    totalInterest: Math.round(total - loan),
  };
}

/** 預設:自備兩成、30 年、利率 2.2%(一般房貸大約值;使用者可改) */
export const MORTGAGE_DEFAULT = { down: 0.2, rate: 2.2, years: 30, grace: 0 };
