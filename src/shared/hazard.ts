/**
 * 災害潛勢:淹水(水利署第四代淹水潛勢圖,雙北)、土壤液化(臺北市工務局,只有台北市)、
 * 航空噪音防制區(雙北環保局依里公告,松山機場;新北林口下福里是桃園機場)。
 * 圖資由 scripts/build_hazards.py 轉成 data/hazard/hazards.json,`npm run collect -- hazards` 推進 D1。
 */
import { z } from "zod";

export const HAZARD_KINDS = ["flood6", "flood24", "liquefaction", "airnoise"] as const;
export type HazardKind = (typeof HAZARD_KINDS)[number];
export const HAZARD_LABEL: Record<HazardKind, string> = {
  flood6: "淹水(短時強降雨)",
  flood24: "淹水(颱風等級)",
  liquefaction: "土壤液化",
  airnoise: "航空噪音",
};
/** 情境說明 */
export const HAZARD_NOTE: Record<HazardKind, string> = {
  flood6: "6 小時累積 150 毫米(梅雨、午後雷陣雨)",
  flood24: "24 小時累積 500 毫米(颱風)",
  liquefaction: "臺北市工務局潛勢圖(新北市沒有開放資料)",
  airnoise: "環保局公告的航空噪音防制區,以「里」為單位(松山機場):第一級 60–65 dB、第二級 65–75、第三級 75 以上(日夜音量)",
};
/** 淹水 level 1–5 = 淹水深度級距;液化 level 1–3 = 低 / 中 / 高;航空噪音 1–3 = 第一 ~ 三級 */
export function hazardLevelLabel(kind: HazardKind, level: number) {
  if (kind === "liquefaction") return ["", "低潛勢", "中潛勢", "高潛勢"][level] ?? "";
  if (kind === "airnoise") return ["", "第一級", "第二級", "第三級"][level] ?? "";
  return ["", "0.3–0.5m", "0.5–1m", "1–2m", "2–3m", "3m 以上"][level] ?? "";
}

/** 面板 / 比較表顯示的文字 */
export function hazardText(kind: HazardKind, level: number | undefined) {
  if (!level) return kind === "airnoise" ? "不在防制區" : "不在潛勢區";
  if (kind === "airnoise") return `${hazardLevelLabel(kind, level)}(${["", "60–65", "65–75", "75+"][level]} dB)`;
  if (kind === "liquefaction") return hazardLevelLabel(kind, level);
  return `可能淹 ${hazardLevelLabel(kind, level)}`;
}

/** 算「嚴重」的門檻(紅字;需求「避開」也用這個):短時強降雨會淹、颱風 0.5m 以上、液化高潛勢、噪音第二級以上 */
export function hazardSevere(kind: HazardKind, level: number | undefined) {
  if (!level) return false;
  if (kind === "flood6") return level >= 1;
  if (kind === "liquefaction") return level >= 3;
  return level >= 2;
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

/** /api/hazards/zones:畫面範圍內的多邊形(properties.level);too_big = 範圍太大沒給,要放大 */
export interface HazardZones {
  type: "FeatureCollection";
  features: { type: "Feature"; geometry: { type: "Polygon"; coordinates: [number, number][][] }; properties: { level: number } }[];
  too_big: boolean;
}
