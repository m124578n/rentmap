/**
 * 單趟票價(估):有每段(legs)就逐段算,只有摘要(TripBrief)就用 cost.ts 的 TRIP_FARE 粗估。
 * - 公車:每段 15 元(市區一段票;跨區或長程客運會更貴,不分)
 * - 捷運:依搭乘距離,5 公里內 20 元、之後每 3 公里 +5,最多 65(北捷的級距;其他城市的捷運差不多)
 * - 台鐵:區間車約每公里 1.46 元,最少 15
 * - YouBike:前 30 分鐘 5 元,之後每 30 分鐘 10 元
 * - 機車 / 開車:道路公里數 × 每公里油錢(drive.ts),不含停車費
 * 不算轉乘優惠、TPASS、學生票;介面一律標「約」。
 */
import { haversine } from "./bus";
import { TRIP_FARE } from "./cost";
import { DRIVE_COST_PER_KM } from "./drive";
import type { Trip, TripBrief, TripLeg } from "./trip";

export function metroFare(km: number) {
  if (km <= 5) return 20;
  return Math.min(65, 20 + Math.ceil((km - 5) / 3) * 5);
}

export function traFare(km: number) {
  return Math.max(15, Math.round(km * 1.46));
}

export function bikeFare(min: number) {
  return min <= 30 ? 5 : 5 + Math.ceil((min - 30) / 30) * 10;
}

/** 軌道段的長度(公里):沿經過的站累加,× 1.1 補彎道 */
function railKm(leg: Extract<TripLeg, { mode: "mrt" }>) {
  let m = 0;
  for (let i = 1; i < leg.path.length; i++) m += haversine(leg.path[i - 1]!.lat, leg.path[i - 1]!.lng, leg.path[i]!.lat, leg.path[i]!.lng);
  return (m * 1.1) / 1000;
}

export function legFare(leg: TripLeg): number {
  switch (leg.mode) {
    case "walk":
      return 0;
    case "bus":
      return 15;
    case "bike":
      return bikeFare(leg.min);
    case "mrt": {
      const km = railKm(leg);
      const tra = leg.lines.some((l) => l.includes("台鐵")) || leg.from.startsWith("台鐵") || leg.to.startsWith("台鐵");
      return tra ? traFare(km) : metroFare(km);
    }
  }
}

/** 一趟約多少錢(元) */
export function tripFare(t: Trip | TripBrief): number {
  if (t.kind === "scooter" || t.kind === "car") return Math.round((("km" in t ? t.km : undefined) ?? 0) * DRIVE_COST_PER_KM[t.kind]);
  if ("legs" in t && t.legs.length) return t.legs.reduce((s, l) => s + legFare(l), 0);
  return TRIP_FARE[t.kind];
}

/** 「約 35 元」「免費」 */
export function fareText(n: number) {
  return n === 0 ? "免費" : `約 ${n} 元`;
}
