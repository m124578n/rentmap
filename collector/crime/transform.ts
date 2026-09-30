/**
 * 治安(竊盜)開放資料 → 純函式(測試在 test/collector/crime.test.ts)。
 *
 * 臺北市警察局:住宅 / 汽車 / 機車竊盜點位(data.taipei CSV,Big5),地點是「臺北市中正區廈門街91~120號」這種門牌區間,
 *   沒有座標 → 用「巷」去 Nominatim 查(collector/lib/geocode.ts 有快取),查不到退到「路段」;只到區中心的丟掉
 *   (不然全部堆在區中心,附近的房源會被灌爆)。門牌 OSM 幾乎沒有,不查。位置是巷 / 路段的中點,只能看大概。
 * 新北市警察局:「犯罪資料」只有案類、年、日期(季)、行政區 → 只能給區的件數,不畫點。
 * 警政署:全國「犯罪資料」(每季一檔,格式跟新北市那份一樣但縣市、區分兩欄)→ 雙北以外的縣市用它算各區件數。
 */
import { CITY_INFO, type CityName } from "../../src/shared/regions";

export const THEFT_KINDS = ["house", "moto", "car"] as const;
export type TheftKind = (typeof THEFT_KINDS)[number];
export const THEFT_LABEL: Record<TheftKind | "bike", string> = { house: "住宅竊盜", moto: "機車竊盜", car: "汽車竊盜", bike: "自行車竊盜" };

/** 民國 yyyMMdd → YYYY-MM-DD;不合法回 null */
export function rocDate(s: string): string | null {
  const m = s.trim().match(/^(\d{2,3})(\d{2})(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]) + 1911;
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export interface TaipeiTheftRow {
  id: string;
  kind: TheftKind;
  date: string;
  /** 「17~19」 */
  slot: string;
  district: string;
  /** 給 Nominatim 查的:由細到粗(巷 → 路段),不含縣市與區 */
  queries: string[];
}

/** 簡單的 CSV 一行(臺北市的檔沒有引號欄位) */
const cells = (line: string) => line.split(",").map((x) => x.trim());

/**
 * 臺北市竊盜 CSV:編號,案類,發生日期,發生時段,發生地點
 * 地點例:臺北市中正區廈門街91~120號、臺北市文山區萬美里萬寧街1~30號、臺北市信義區富台里忠孝東路5段295巷6弄1~30號
 */
export function parseTaipeiTheft(csv: string, kind: TheftKind): TaipeiTheftRow[] {
  const out: TaipeiTheftRow[] = [];
  for (const line of csv.split(/\r?\n/).slice(1)) {
    const [id, , date, slot, place] = cells(line);
    if (!id || !place) continue;
    const d = rocDate(date ?? "");
    const m = place.replace(/\s/g, "").match(/^[臺台]北市(\S{1,3}?區)(?:\S{1,3}?里(?=\S*?[路街道巷]))?(.+)$/);
    if (!d || !m) continue;
    const district = m[1]!;
    const rest = m[2]!;
    // 門牌 OSM 幾乎沒有(實測 60 筆全查不到),直接從巷開始,查不到再到路段
    const queries: string[] = [];
    const lane = rest.match(/^(.+?巷)/);
    if (lane) queries.push(lane[1]!);
    const road = rest.match(/^(.+?(?:[路街道](?:[一二三四五六七八九十\d]+段)?))/);
    if (road && !queries.includes(road[1]!)) queries.push(road[1]!);
    if (!queries.length) continue;
    out.push({ id, kind, date: d, slot: slot ?? "", district, queries });
  }
  return out;
}

export interface NtpcCrimeRow {
  kind: TheftKind | "bike" | "other";
  date: string;
  district: string | null;
}

/** 新北市「犯罪資料」CSV:type,year,date,location(location 常只有「新北市」) */
export function parseNtpcCrime(csv: string): NtpcCrimeRow[] {
  const KIND: Record<string, NtpcCrimeRow["kind"]> = { 住宅竊盜: "house", 機車竊盜: "moto", 汽車竊盜: "car", 自行車竊盜: "bike" };
  const out: NtpcCrimeRow[] = [];
  for (const line of csv.replace(/^﻿/, "").split(/\r?\n/).slice(1)) {
    const [type, , date, loc] = cells(line);
    const d = rocDate(date ?? "");
    if (!type || !d) continue;
    const m = (loc ?? "").match(/^新北市(\S+?區)/);
    out.push({ kind: KIND[type] ?? "other", date: d, district: m?.[1] ?? null });
  }
  return out;
}

export interface NpaCrimeRow {
  kind: TheftKind | "bike" | "other";
  date: string;
  city: CityName;
  /** 不在 regions.ts 那個縣市的區清單裡(沒寫、寫錯)→ null */
  district: string | null;
}

const NPA_KIND: Record<string, NpaCrimeRow["kind"]> = { 住宅竊盜: "house", 機車竊盜: "moto", 汽車竊盜: "car", 自行車竊盜: "bike" };

/**
 * 警政署「犯罪資料」CSV:type,oc_year,oc_data,oc_county,oc_region(全國;只留 regions.ts 有列的縣市)。
 * 縣市用「臺」、區有時連縣市一起寫(「臺中市西屯區」),都整理成 regions.ts 的寫法。
 */
export function parseNpaCrime(csv: string): NpaCrimeRow[] {
  const out: NpaCrimeRow[] = [];
  for (const line of csv.replace(/^\uFEFF/, "").split(/\r?\n/).slice(1)) {
    const [type, , date, county, region] = cells(line).map((x) => x.replace(/^"|"$/g, ""));
    const d = rocDate(date ?? "");
    const city = (county ?? "").replace(/臺/g, "台");
    if (!type || !d || !(city in CITY_INFO)) continue;
    const info = CITY_INFO[city as CityName];
    const dist = (region ?? "").replace(/臺/g, "台").replace(city, "").trim();
    out.push({ kind: NPA_KIND[type] ?? "other", date: d, city: city as CityName, district: (info.districts as readonly string[]).includes(dist) ? dist : null });
  }
  return out;
}

export interface CrimeDistricts {
  /** 統計期間(資料最新日往前一年) */
  from: string;
  to: string;
  /** 「台北市|大安區」→ 各案類件數 */
  items: Record<string, Partial<Record<TheftKind | "bike", number>>>;
  /** 新北市沒寫到區的件數(只寫「新北市」) */
  ntpc_unknown: number;
  /** 雙北以外的縣市(警政署全國資料)各自的統計期間;沒列的縣市用上面的 from / to */
  periods?: Record<string, { from: string; to: string }>;
}

/** 近一年各區件數:臺北市用點位資料(依地址的區),新北市用犯罪資料(依 location 的區),其他縣市用警政署全國資料 */
export function districtStats(tp: Pick<TaipeiTheftRow, "kind" | "date" | "district">[], ntpc: NtpcCrimeRow[], npa: NpaCrimeRow[] = []): CrimeDistricts {
  const lastOf = (xs: { date: string }[]) => xs.reduce((m, x) => (x.date > m ? x.date : m), "");
  const yearBefore = (d: string) => `${Number(d.slice(0, 4)) - 1}${d.slice(4)}`;
  const items: CrimeDistricts["items"] = {};
  const add = (key: string, k: TheftKind | "bike") => {
    const row = (items[key] ??= {});
    row[k] = (row[k] ?? 0) + 1;
  };
  const tpTo = lastOf(tp);
  const ntTo = lastOf(ntpc);
  for (const r of tp) if (r.date > yearBefore(tpTo)) add(`台北市|${r.district}`, r.kind);
  let unknown = 0;
  for (const r of ntpc) {
    if (r.date <= yearBefore(ntTo) || r.kind === "other") continue;
    if (!r.district) unknown++;
    else add(`新北市|${r.district}`, r.kind);
  }
  const to = [tpTo, ntTo].sort()[1] ?? tpTo;
  // 警政署的檔是整季整季出的:最新一天往前一年 = 最近四季。雙北已有各自的來源,不重複算
  const others = npa.filter((r) => r.city !== "台北市" && r.city !== "新北市");
  const npaTo = lastOf(others);
  const periods: NonNullable<CrimeDistricts["periods"]> = {};
  for (const r of others) {
    if (r.date <= yearBefore(npaTo)) continue;
    periods[r.city] ??= { from: yearBefore(npaTo), to: npaTo };
    if (r.kind !== "other" && r.district) add(`${r.city}|${r.district}`, r.kind);
  }
  return { from: yearBefore(to), to, items, ntpc_unknown: unknown, ...(others.length ? { periods } : {}) };
}
