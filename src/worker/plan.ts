/**
 * 方案權限(伺服器端;定義在 src/shared/plan.ts)。
 * 每個要擋的 API 自己呼叫 planOf / deny,不信任前端送來的任何方案資訊;方案只從 users.plan / plan_until 讀。
 * 私人模式(PRIVATE_POOL)不限制。
 */
import type { Context } from "hono";
import { ENTITLEMENTS, UNLIMITED, effectivePlan, type Entitlements, type PlanDenied, type PlanState } from "@shared/plan";
import type { AppEnv } from "./env";
import { isPrivatePool } from "./pool";

export async function planOf(c: Context<AppEnv>): Promise<PlanState> {
  if (isPrivatePool(c.env)) return { plan: "buy", until: null, ent: UNLIMITED, enforced: false };
  const row = await c.env.DB.prepare("SELECT plan, plan_until FROM users WHERE id = ?")
    .bind(c.get("user").id)
    .first<{ plan: string; plan_until: string | null }>();
  const plan = effectivePlan(row?.plan, row?.plan_until);
  return { plan, until: plan === "free" ? null : row!.plan_until, ent: ENTITLEMENTS[plan], enforced: true };
}

const MESSAGES: Record<keyof Entitlements, string> = {
  notes: "免費版最多存 3 間筆記;付費方案不限。",
  places: "免費版只能設 1 個地點;付費方案最多 5 個。",
  compare: "免費版最多比較 2 間。",
  commuteCustom: "下班、自訂時段與 YouBike 是付費方案的功能;免費版算平日 08:00 上班。",
  tour: "看房路線是付費方案的功能。",
  fit: "需求與符合度是付費方案的功能。",
  rentDetail: "租金行情的成交明細是付費方案的功能。",
  saleDetail: "買賣行情的成交明細是買房方案的功能。",
  costDetail: "每月支出明細是付費方案的功能。",
};

/** 402 Payment Required + 說明(前端顯示 message、帶去方案頁) */
export function deny(c: Context<AppEnv>, need: keyof Entitlements) {
  const body: PlanDenied = { error: "plan_required", need, message: MESSAGES[need] };
  return c.json(body, 402);
}
