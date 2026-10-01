import { CITY_INFO, hasCoverage, normalizeCity, type CityName } from "./regions";

export type CrimeKind = "house" | "moto" | "car" | "bike";
export type CrimeItems = Record<string, Partial<Record<CrimeKind, number>>>;

/**
 * 這個區的件數在生活圈各區裡排第幾多。
 * 分母 = 生活圈裡**有治安資料**的縣市的全部行政區(regions.ts 的 districts),檔案裡沒列的區算 0 件;
 * 沒資料的縣市(例如北區的桃園、基隆)整個不算,不能當成 0 件。
 * 這個區沒有件數(0 或沒列)回 null(不顯示排名)。同件數同名次(並列取最前)。
 */
export function districtRank(
  items: CrimeItems,
  regionCities: readonly string[],
  city: string,
  district: string,
  kind: CrimeKind,
  covered: (city: CityName) => boolean = (c) => hasCoverage(c, "crimeDistricts"),
): { n: number; of: number } | null {
  const mine = items[`${normalizeCity(city) ?? city}|${district}`]?.[kind] ?? 0;
  if (!mine) return null;
  const counts: number[] = [];
  for (const c of regionCities) {
    const name = normalizeCity(c);
    if (!name || !covered(name)) continue;
    for (const d of CITY_INFO[name as CityName].districts) counts.push(items[`${name}|${d}`]?.[kind] ?? 0);
  }
  if (!counts.length) return null;
  return { n: counts.filter((x) => x > mine).length + 1, of: counts.length };
}
