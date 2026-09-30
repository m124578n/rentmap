/**
 * M6 需求符合度(🟢🟡🔴)。純函式,前端算、不打 API;需求本身存在伺服器(手機電腦共用)。
 *
 * 硬性條件,不符直接紅:預算上限、房型、最少房數、必要設備(電梯 / 寵物 / 開伙)、通勤上限、
 *   垃圾車(走 N 公尺內要有幾點以後、平日至少 3 天的清運點;房東寫了垃圾代收就不看)。
 *   房源缺那個欄位 → 不算不符,但列在「不確定」。
 * 軟性維度各給 0–1 分,乘權重平均:
 *   租金   ≤ 理想價 1 分,到預算上限(沒設就理想價 ×1.3)0 分
 *   行情   比行情便宜 10% 以上 1 分,貴 20% 以上 0 分(實價登錄樣本足夠才算)
 *   通勤   最久的那段(每個地點的上班、下班)≤ 理想分鐘 1 分,到上限(沒設就理想 ×2)0 分
 *   坪數   ≥ 理想坪數 1 分,≤ 最小坪數(沒設就理想 ×0.6)0 分
 *   屋齡   ≤ 上限 ×0.4 1 分,≥ 上限 0 分
 * 總分 ≥ 0.75 綠、≥ 0.5 黃、其餘紅。什麼都沒設 → 不評(null)。
 */
import { z } from "zod";
import { KINDS } from "./constants";

const pos = z.number().positive().nullable();
const posInt = z.number().int().positive().nullable();
const weight = z.number().int().min(0).max(5);

export const Requirements = z.object({
  budget_max: posInt,
  budget_ideal: posInt,
  kinds: z.array(z.enum(KINDS)).max(KINDS.length),
  rooms_min: z.number().int().min(1).max(10).nullable(),
  size_min: pos,
  size_ideal: pos,
  commute_max: posInt,
  commute_ideal: posInt,
  age_max: posInt,
  need_elevator: z.boolean(),
  need_pet: z.boolean(),
  need_cooking: z.boolean(),
  /** 垃圾車:走多遠內(公尺)要有「幾點以後」的清運點;garbage_after 為 null = 不看 */
  garbage_max_m: z.number().int().min(50).max(1000),
  garbage_after: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable(),
  weights: z.object({ price: weight, market: weight, commute: weight, size: weight, age: weight }),
});
export type Requirements = z.infer<typeof Requirements>;
export type FitDimKey = keyof Requirements["weights"];

export const EMPTY_REQUIREMENTS: Requirements = {
  budget_max: null,
  budget_ideal: null,
  kinds: [],
  rooms_min: null,
  size_min: null,
  size_ideal: null,
  commute_max: null,
  commute_ideal: null,
  age_max: null,
  need_elevator: false,
  need_pet: false,
  need_cooking: false,
  garbage_max_m: 300,
  garbage_after: null,
  weights: { price: 3, market: 2, commute: 3, size: 2, age: 1 },
};

export const FIT_DIM_LABEL: Record<FitDimKey, string> = { price: "租金", market: "比行情", commute: "通勤", size: "坪數", age: "屋齡" };

export interface FitInput {
  rent: number | null;
  kind?: string | null;
  rooms: number | null;
  size_ping: number | null;
  building_age: number | null;
  has_elevator: boolean | null;
  pet_allowed: boolean | null;
  cooking_allowed: boolean | null;
}
export interface FitCtx {
  /** 最久那段通勤(分);null = 有地點但搭不到;undefined = 沒設地點或還在算 */
  commuteMin?: number | null;
  /** 比行情 %;undefined / null = 沒有(或樣本不足) */
  marketDiff?: number | null;
  /** 垃圾車條件的結果(/api/garbage/fit);undefined = 沒查 / 還在查 */
  garbage?: { ok: boolean; service: boolean } | null;
}

export type FitLevel = "green" | "yellow" | "red";
export interface FitDim {
  key: FitDimKey;
  score: number;
  weight: number;
  note: string;
}
export interface FitResult {
  level: FitLevel;
  /** 0–1;只有硬性條件時為 null */
  score: number | null;
  fails: string[];
  unknown: string[];
  dims: FitDim[];
}

export function hasRequirements(r: Requirements) {
  return (
    r.budget_max != null ||
    r.budget_ideal != null ||
    r.kinds.length > 0 ||
    r.rooms_min != null ||
    r.size_min != null ||
    r.size_ideal != null ||
    r.commute_max != null ||
    r.commute_ideal != null ||
    r.age_max != null ||
    r.need_elevator ||
    r.need_pet ||
    r.need_cooking ||
    r.garbage_after != null
  );
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
/** v ≤ good → 1、v ≥ bad → 0,中間線性(good < bad) */
const lowerBetter = (v: number, good: number, bad: number) => (bad <= good ? (v <= good ? 1 : 0) : clamp01((bad - v) / (bad - good)));
/** v ≥ good → 1、v ≤ bad → 0(bad < good) */
const higherBetter = (v: number, good: number, bad: number) => (good <= bad ? (v >= good ? 1 : 0) : clamp01((v - bad) / (good - bad)));
const money = (n: number) => `$${n.toLocaleString()}`;

export function computeFit(p: FitInput, r: Requirements, ctx: FitCtx = {}): FitResult | null {
  if (!hasRequirements(r)) return null;
  const fails: string[] = [];
  const unknown: string[] = [];

  // ---- 硬性 ----
  if (r.budget_max != null) {
    if (p.rent == null) unknown.push("租金");
    else if (p.rent > r.budget_max) fails.push(`租金 ${money(p.rent)} 超過預算 ${money(r.budget_max)}`);
  }
  if (r.kinds.length) {
    if (!p.kind) unknown.push("房型");
    else if (!(r.kinds as string[]).includes(p.kind)) fails.push(`房型是${p.kind}`);
  }
  if (r.rooms_min != null) {
    if (p.rooms == null) unknown.push("房數");
    else if (p.rooms < r.rooms_min) fails.push(`只有 ${p.rooms} 房(要 ${r.rooms_min} 房以上)`);
  }
  const need = (on: boolean, v: boolean | null, label: string, no: string) => {
    if (!on) return;
    if (v == null) unknown.push(label);
    else if (!v) fails.push(no);
  };
  need(r.need_elevator, p.has_elevator, "電梯", "沒有電梯");
  need(r.need_pet, p.pet_allowed, "可否養寵物", "不可養寵物");
  need(r.need_cooking, p.cooking_allowed, "可否開伙", "不可開伙");
  if (r.commute_max != null && ctx.commuteMin !== undefined) {
    if (ctx.commuteMin === null) fails.push("通勤搭不到(轉乘一次內)");
    else if (ctx.commuteMin > r.commute_max) fails.push(`通勤最久 ${ctx.commuteMin} 分(上限 ${r.commute_max} 分)`);
  }

  if (r.garbage_after != null && ctx.garbage) {
    if (!ctx.garbage.ok) fails.push(`走 ${r.garbage_max_m}m 內沒有 ${r.garbage_after} 以後的垃圾車(也沒寫代收)`);
  }

  // ---- 軟性 ----
  const dims: FitDim[] = [];
  const w = r.weights;
  if (w.price > 0 && p.rent != null && (r.budget_max != null || r.budget_ideal != null)) {
    const ideal = r.budget_ideal ?? Math.round(r.budget_max! * 0.85);
    const top = r.budget_max ?? Math.round(ideal * 1.3);
    dims.push({ key: "price", weight: w.price, score: lowerBetter(p.rent, ideal, top), note: `${money(p.rent)}(理想 ${money(ideal)} 以內)` });
  }
  if (w.market > 0 && ctx.marketDiff != null) {
    const d = ctx.marketDiff;
    dims.push({ key: "market", weight: w.market, score: lowerBetter(d, -10, 20), note: `${d > 0 ? "貴" : "便宜"} ${Math.abs(d)}%` });
  }
  if (w.commute > 0 && ctx.commuteMin !== undefined && (r.commute_max != null || r.commute_ideal != null)) {
    const ideal = r.commute_ideal ?? Math.round(r.commute_max! * 0.6);
    const top = r.commute_max ?? ideal * 2;
    dims.push({
      key: "commute",
      weight: w.commute,
      score: ctx.commuteMin === null ? 0 : lowerBetter(ctx.commuteMin, ideal, top),
      note: ctx.commuteMin === null ? "搭不到" : `最久 ${ctx.commuteMin} 分(理想 ${ideal} 分內)`,
    });
  }
  if (w.size > 0 && p.size_ping != null && (r.size_min != null || r.size_ideal != null)) {
    const ideal = r.size_ideal ?? Math.round(r.size_min! * 1.3 * 10) / 10;
    const low = r.size_min ?? Math.round(ideal * 0.6 * 10) / 10;
    dims.push({ key: "size", weight: w.size, score: higherBetter(p.size_ping, ideal, low), note: `${p.size_ping} 坪(理想 ${ideal} 坪)` });
  }
  if (w.age > 0 && p.building_age != null && r.age_max != null) {
    dims.push({ key: "age", weight: w.age, score: lowerBetter(p.building_age, r.age_max * 0.4, r.age_max), note: `${p.building_age} 年(上限 ${r.age_max} 年)` });
  }

  const tw = dims.reduce((s, d) => s + d.weight, 0);
  const score = tw > 0 ? dims.reduce((s, d) => s + d.score * d.weight, 0) / tw : null;
  const level: FitLevel = fails.length ? "red" : score == null || score >= 0.75 ? "green" : score >= 0.5 ? "yellow" : "red";
  return { level, score: score == null ? null : Math.round(score * 100) / 100, fails, unknown, dims };
}
