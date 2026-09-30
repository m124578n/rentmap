import type { QueryClient } from "@tanstack/react-query";

/**
 * 房源新增 / 刪除後要重抓的東西:列表,以及「所有房源 × 某資料」的彙總(通勤、行情、生活機能、災害、垃圾車、經過路線)。
 * 只刷列表的話,新房源在彙總裡查不到,會被當成「搭不到」「沒資料」。
 */
export function invalidateProperties(qc: QueryClient) {
  for (const key of ["properties", "commute", "market", "nearby-summary", "hazard-summary", "garbage-fit", "along"]) qc.invalidateQueries({ queryKey: [key] });
}
