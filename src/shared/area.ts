/**
 * 公開的「各區行情」頁(/area/<縣市>/<行政區>,給搜尋引擎與 AI 搜尋引用)的彙總計算。純函式,測試直接呼叫。
 * 只用公開資料的彙總(實價登錄、警政統計),不碰任何人的筆記。
 */
import { quantile, MIN_SAMPLES, type RentStat } from "./market";
import { SALE_TYPES, type SaleStat, type SaleType } from "./sale";

/** 行情頁列的房型(雅房、分租套房的登錄坪數常是整戶,不算每坪) */
export const AREA_KINDS = ["整層住家", "獨立套房", "分租套房", "雅房"] as const;
const PER_PING_KINDS = new Set<string>(["整層住家", "獨立套房"]);

export interface RentRow {
  kind: string;
  count: number;
  median: number;
  p25: number;
  p75: number;
  /** 每坪月租中位數(整層、獨立套房才有) */
  per_ping: number | null;
  /** 全縣市同房型的月租中位數(對照用) */
  city_median: number | null;
  from: string;
  to: string;
}

export interface SaleRow {
  type: SaleType;
  count: number;
  /** 每坪單價(元) */
  unit_median: number;
  unit_p25: number;
  unit_p75: number;
  /** 總價中位數(元) */
  price_median: number;
  size_median: number | null;
  age_median: number | null;
  /** 全縣市同型態每坪中位數 */
  city_unit_median: number | null;
  from: string;
  to: string;
}

const sortNum = (xs: number[]) => xs.sort((a, b) => a - b);
const med = (xs: number[]) => (xs.length ? Math.round(quantile(sortNum(xs), 0.5)) : null);
const range = (dates: string[]) => {
  const s = [...dates].sort();
  return { from: s[0] ?? "", to: s[s.length - 1] ?? "" };
};

/** pools(kind) 回同區該房型的樣本(已 cleanPool);cityPools(kind) 回全縣市 */
export function rentRows(pools: (kind: string) => RentStat[], cityPools: (kind: string) => RentStat[]): RentRow[] {
  const out: RentRow[] = [];
  for (const kind of AREA_KINDS) {
    const rows = pools(kind);
    if (rows.length < MIN_SAMPLES) continue;
    const rents = sortNum(rows.map((r) => r.rent));
    const perPing = PER_PING_KINDS.has(kind) ? rows.filter((r) => r.size_ping && r.size_ping > 0).map((r) => r.rent / r.size_ping!) : [];
    out.push({
      kind,
      count: rows.length,
      median: Math.round(quantile(rents, 0.5)),
      p25: Math.round(quantile(rents, 0.25)),
      p75: Math.round(quantile(rents, 0.75)),
      per_ping: perPing.length >= MIN_SAMPLES ? med(perPing) : null,
      city_median: med(cityPools(kind).map((r) => r.rent)),
      ...range(rows.map((r) => r.date)),
    });
  }
  return out;
}

/** district = 同區全部型態、city = 全縣市全部型態(都已 cleanSalePool) */
export function saleRows(district: SaleStat[], city: SaleStat[]): SaleRow[] {
  const out: SaleRow[] = [];
  for (const type of SALE_TYPES) {
    const rows = district.filter((r) => r.building_type === type && r.unit_price);
    if (rows.length < MIN_SAMPLES) continue;
    const units = sortNum(rows.map((r) => r.unit_price!));
    out.push({
      type,
      count: rows.length,
      unit_median: Math.round(quantile(units, 0.5)),
      unit_p25: Math.round(quantile(units, 0.25)),
      unit_p75: Math.round(quantile(units, 0.75)),
      price_median: med(rows.map((r) => r.price))!,
      size_median: med(rows.flatMap((r) => (r.size_ping ? [r.size_ping] : []))),
      age_median: med(rows.flatMap((r) => (r.building_age != null ? [r.building_age] : []))),
      city_unit_median: med(city.filter((r) => r.building_type === type && r.unit_price).map((r) => r.unit_price!)),
      ...range(rows.map((r) => r.date)),
    });
  }
  return out;
}

/** 比全縣市高 / 低幾 %(四捨五入到整數;沒得比 null) */
export function vsCity(mine: number, city: number | null) {
  return city ? Math.round(((mine - city) / city) * 100) : null;
}
