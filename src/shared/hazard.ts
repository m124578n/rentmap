/**
 * 災害潛勢:淹水(水利署第四代淹水潛勢圖,雙北)、土壤液化(臺北市工務局,只有台北市)。
 * 圖資由 scripts/build_hazards.py 轉成 data/hazard/hazards.json,`npm run collect -- hazards` 推進 D1。
 */
import { z } from "zod";

export const HAZARD_KINDS = ["flood6", "flood24", "liquefaction"] as const;
export type HazardKind = (typeof HAZARD_KINDS)[number];
export const HAZARD_LABEL: Record<HazardKind, string> = {
  flood6: "淹水(短時強降雨)",
  flood24: "淹水(颱風等級)",
  liquefaction: "土壤液化",
};
/** 情境說明 */
export const HAZARD_NOTE: Record<HazardKind, string> = {
  flood6: "6 小時累積 150 毫米(梅雨、午後雷陣雨)",
  flood24: "24 小時累積 500 毫米(颱風)",
  liquefaction: "臺北市工務局潛勢圖(新北市沒有開放資料)",
};
/** 淹水 level 1–5 = 淹水深度級距;液化 level 1–3 = 低 / 中 / 高 */
export function hazardLevelLabel(kind: HazardKind, level: number) {
  if (kind === "liquefaction") return ["", "低潛勢", "中潛勢", "高潛勢"][level] ?? "";
  return ["", "0.3–0.5m", "0.5–1m", "1–2m", "2–3m", "3m 以上"][level] ?? "";
}

export const HazardZoneIn = z.object({
  kind: z.enum(HAZARD_KINDS),
  level: z.number().int().min(1).max(5),
  city: z.string().max(10),
  /** 第一個 ring 外框,其餘是洞;[lng, lat] */
  rings: z
    .array(z.array(z.tuple([z.number(), z.number()])).min(4).max(20000))
    .min(1)
    .max(200),
});
export type HazardZoneIn = z.infer<typeof HazardZoneIn>;

/** 一個點各種災害的等級(null = 不在潛勢區) */
export type HazardLevels = Partial<Record<HazardKind, number>>;
export interface HazardResponse {
  has_data: boolean;
  levels: HazardLevels;
  /** 這個點不在該災害的資料範圍(液化只有台北市) */
  no_coverage: HazardKind[];
}
export interface HazardSummary {
  has_data: boolean;
  items: Record<string, HazardLevels>;
}
