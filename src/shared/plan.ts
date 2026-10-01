/**
 * 付費方案與權限(前後端共用)。方案設計見 docs/business/2026-09-30-subscription-and-legal.md「功能拆分」。
 *
 * 只有期間方案(一次付清、不自動續約、不賣點數):免費 / 租屋 / 買房。到期就回到免費版,資料不刪,
 * 超過免費上限的部分照樣看得到、只是不能再新增。
 * **權限一律在伺服器檢查**(src/worker/plan.ts);前端的鎖只是顯示,不能當作保護。
 * 私人模式(PRIVATE_POOL,本機自用)不限制。
 */
import { z } from "zod";

export const PLANS = ["free", "rent", "buy"] as const;
export type PlanKey = (typeof PLANS)[number];
export const PLAN_LABEL: Record<PlanKey, string> = { free: "免費", rent: "租屋方案", buy: "買房方案" };

/** 賣的品項(價格是新台幣;綠界串好前只用來顯示) */
export const OFFERS = [
  { id: "rent30", plan: "rent", days: 30, price: 149 },
  { id: "rent90", plan: "rent", days: 90, price: 349 },
  { id: "buy90", plan: "buy", days: 90, price: 499 },
] as const satisfies readonly { id: string; plan: PlanKey; days: number; price: number }[];

export interface Entitlements {
  /** 筆記(自己建的房源)上限;null = 不限 */
  notes: number | null;
  /** 我的地點上限(通勤、網格用前 N 個) */
  places: number;
  /** 比較表最多幾間 */
  compare: number;
  /** 通勤:下班、自訂時段與星期、YouBike(免費只有平日 08:00 上班、不含 YouBike) */
  commuteCustom: boolean;
  /** 看房路線 */
  tour: boolean;
  /** 需求與符合度(存需求) */
  fit: boolean;
  /** 租金行情「最像的幾筆」 */
  rentDetail: boolean;
  /** 買賣行情「最像的幾筆」(買房方案) */
  saleDetail: boolean;
  /** 每月支出明細(免費只看總額) */
  costDetail: boolean;
}

const FREE: Entitlements = {
  notes: 3,
  places: 1,
  compare: 2,
  commuteCustom: false,
  tour: false,
  fit: false,
  rentDetail: false,
  saleDetail: false,
  costDetail: false,
};
const RENT: Entitlements = {
  notes: null,
  places: 5,
  compare: 4,
  commuteCustom: true,
  tour: true,
  fit: true,
  rentDetail: true,
  saleDetail: false,
  costDetail: true,
};
const BUY: Entitlements = { ...RENT, saleDetail: true };
export const ENTITLEMENTS: Record<PlanKey, Entitlements> = { free: FREE, rent: RENT, buy: BUY };
/** 私人模式:全部打開(本機自用,地點也不限) */
export const UNLIMITED: Entitlements = { ...BUY, places: 1000 };

/** 只看資料庫的兩欄決定現在的方案:到期(或沒有到期日)就是免費 */
export function effectivePlan(plan: string | null | undefined, until: string | null | undefined, now = new Date()): PlanKey {
  if (!plan || plan === "free" || !until) return "free";
  if (!(PLANS as readonly string[]).includes(plan)) return "free";
  return Date.parse(until) > now.getTime() ? (plan as PlanKey) : "free";
}

/** /api/me 回的方案狀態 */
export interface PlanState {
  plan: PlanKey;
  /** 到期時間(ISO);免費 null */
  until: string | null;
  ent: Entitlements;
  /** false = 私人模式,不限制 */
  enforced: boolean;
}

/** 被方案擋下的回應(HTTP 402) */
export interface PlanDenied {
  error: "plan_required";
  need: keyof Entitlements;
  message: string;
}

/** 開通(採集機 bearer 用;綠界串好後改由付款通知呼叫) */
export const GrantBody = z.object({
  email: z.string().email().max(200),
  offer: z.enum(OFFERS.map((o) => o.id) as [string, ...string[]]),
  /** 冪等:同一筆訂單 / 匯款重送不會重複加天數 */
  ref: z.string().min(1).max(100),
});
export type GrantBody = z.infer<typeof GrantBody>;

/** 每個方案一天值多少(用該方案最長的那個品項算;不同方案之間換算剩餘天數用) */
const PER_DAY: Record<Exclude<PlanKey, "free">, number> = Object.fromEntries(
  (["rent", "buy"] as const).map((k) => {
    const o = OFFERS.filter((x) => x.plan === k).sort((a, b) => b.days - a.days)[0]!;
    return [k, o.price / o.days];
  }),
) as Record<Exclude<PlanKey, "free">, number>;
const DAY = 86400_000;

/**
 * 開通後的方案與到期日:
 *   - 沒有有效方案:從現在起算
 *   - 同方案續買:從原本到期日往後加(剩下的天數不會被吃掉)
 *   - 不同方案:一律變成「比較高的那個」(不讓人花錢變少功能),天數照每天的價格換算,不能用便宜方案換到貴方案的天數:
 *     租屋還沒到期就買買房 → 剩下的租屋天數折成買房天數 + 買房天數;
 *     買房還沒到期又買租屋 → 租屋的天數折成買房天數加上去
 */
export function extendPlan(cur: { plan: PlanKey; until: string | null }, offer: { plan: PlanKey; days: number; price?: number }, now = new Date()) {
  const t = now.getTime();
  const curUntil = cur.until ? Date.parse(cur.until) : 0;
  const active = cur.plan !== "free" && curUntil > t;
  if (!active || offer.plan === "free") return { plan: offer.plan, until: new Date(t + offer.days * DAY).toISOString() };
  const curPlan = cur.plan as Exclude<PlanKey, "free">;
  const offPlan = offer.plan as Exclude<PlanKey, "free">;
  if (curPlan === offPlan) return { plan: curPlan, until: new Date(curUntil + offer.days * DAY).toISOString() };
  const target = curPlan === "buy" || offPlan === "buy" ? "buy" : curPlan;
  const remainingDays = (curUntil - t) / DAY;
  const offerPerDay = offer.price != null ? offer.price / offer.days : PER_DAY[offPlan];
  const days = remainingDays * (PER_DAY[curPlan] / PER_DAY[target]) + offer.days * (offerPerDay / PER_DAY[target]);
  return { plan: target, until: new Date(t + Math.floor(days * 24) * 3600_000).toISOString() };
}
