/**
 * 機車 / 開車通勤。有道路圖(shared/roads.ts,本機從 OSM 建、推進 D1)時由 Worker 算最短時間(/api/commute/drive);
 * 這裡是沒有道路圖時的備用估算:直線距離 × 繞路係數 ÷ 平均時速 + 牽車 / 找車位的固定時間,介面標「估」。
 * 時速分尖峰 / 離峰,生活圈可以各自覆寫(中南部路比較空)。
 */
import type { CommuteWhen, TripBrief } from "./trip";
import type { RegionKey } from "./regions";

export const COMMUTE_MODES = ["transit", "scooter", "car"] as const;
export type CommuteMode = (typeof COMMUTE_MODES)[number];
export type DriveMode = Exclude<CommuteMode, "transit">;
export const COMMUTE_MODE_LABEL: Record<CommuteMode, string> = { transit: "大眾運輸", scooter: "機車", car: "開車" };

/** 道路距離 ≈ 直線 × 1.3(市區棋盤路網的常見係數) */
export const DETOUR = 1.3;
/** 平均時速(km/h,含紅綠燈):[尖峰, 離峰] */
const SPEED: Record<RegionKey, Record<DriveMode, [number, number]>> = {
  north: { scooter: [24, 30], car: [18, 28] },
  taichung: { scooter: [28, 34], car: [24, 34] },
  tainan: { scooter: [28, 34], car: [26, 36] },
  kaohsiung: { scooter: [28, 34], car: [25, 35] },
};
/** 出門牽車、到了停車走過去(分);開車多算找車位 */
export const OVERHEAD: Record<DriveMode, number> = { scooter: 4, car: 8 };

/** 道路圖的類別時速(shared/roads.ts 的 CLASS_KMH)是以這個平均時速為準(中南部離峰) */
const ROAD_REF_KMH: Record<DriveMode, number> = { scooter: 34, car: 36 };
/** 道路圖的時間係數:生活圈 × 尖峰 / 離峰,跟上面的平均時速表同一套比例(北區、尖峰比較慢) */
export function roadFactor(mode: DriveMode, when: Pick<CommuteWhen, "day" | "time">, region: RegionKey = "north") {
  const [peak, off] = SPEED[region][mode];
  return ROAD_REF_KMH[mode] / (isPeak(when) ? peak : off);
}
/** 每公里油錢(元,估):機車約 1、汽車約 3;不含停車費 */
export const DRIVE_COST_PER_KM: Record<DriveMode, number> = { scooter: 1, car: 3 };

export function isPeak(when: Pick<CommuteWhen, "day" | "time">) {
  if (when.day !== "wd") return false;
  const [h, m] = when.time.split(":").map(Number) as [number, number];
  const t = h * 60 + m;
  return (t >= 7 * 60 && t < 9 * 60 + 30) || (t >= 17 * 60 && t < 19 * 60 + 30);
}

/** 道路公里數(估) */
export const roadKm = (straightM: number) => Math.round((straightM * DETOUR) / 100) / 10;

export function driveMin(mode: DriveMode, straightM: number, when: Pick<CommuteWhen, "day" | "time">, region: RegionKey = "north") {
  const [peak, off] = SPEED[region][mode];
  const kmh = isPeak(when) ? peak : off;
  return Math.max(1, Math.round(OVERHEAD[mode] + ((straightM * DETOUR) / 1000 / kmh) * 60));
}

/** 跟大眾運輸同一個形狀,篩選 / 排序 / 上色 / 符合度 / 每月支出都能直接用 */
export function driveBrief(mode: DriveMode, straightM: number, when: Pick<CommuteWhen, "day" | "time">, region: RegionKey = "north"): TripBrief {
  const km = roadKm(straightM);
  return { kind: mode, total_min: driveMin(mode, straightM, when, region), transfers: 0, summary: `${COMMUTE_MODE_LABEL[mode]}約 ${km} km(估)`, km };
}
