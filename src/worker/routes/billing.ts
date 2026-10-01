/**
 * 方案開通 / 取消(採集機 bearer INGEST_SECRET;綠界串好後由付款通知呼叫同一套邏輯)。使用者自己沒有任何 API 能改方案。
 *   POST /api/ingest/plan          { email, offer, ref }   開通或延長;同一個 ref 只算一次(重送回 duplicate)
 *   POST /api/ingest/plan/revoke   { ref }                 退款:扣回那筆的天數(到期就回免費);記成 ref = "revoke:<ref>",重送不會扣兩次
 * 每筆都記在 plan_grants(對帳、退款用)。
 */
import { Hono } from "hono";
import { z } from "zod";
import { GrantBody, OFFERS, effectivePlan, extendPlan, type PlanKey } from "@shared/plan";
import type { AppEnv } from "../env";
import { requireIngest } from "../auth";
import { nowIso } from "../db";

export const billing = new Hono<AppEnv>();
billing.use("/api/ingest/plan", requireIngest());
billing.use("/api/ingest/plan/*", requireIngest());

type UserRow = { id: number; plan: string; plan_until: string | null };
const isUnique = (e: unknown) => /UNIQUE constraint failed/i.test(String((e as Error)?.message ?? e));

billing.post("/api/ingest/plan", async (c) => {
  const parsed = GrantBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
  const { email, offer: offerId, ref } = parsed.data;
  const offer = OFFERS.find((o) => o.id === offerId)!;
  const DB = c.env.DB;
  const user = await DB.prepare("SELECT id, plan, plan_until FROM users WHERE lower(email) = lower(?)").bind(email).first<UserRow>();
  if (!user) return c.json({ error: "user not found" }, 404);
  const cur = { plan: effectivePlan(user.plan, user.plan_until), until: user.plan_until };
  const next = extendPlan(cur, offer);
  try {
    // 同一個交易:先記開通(ref 唯一,重送會失敗),再改方案
    await DB.batch([
      DB.prepare("INSERT INTO plan_grants (user_id, offer, plan, days, price, ref, until_after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(
        user.id,
        offer.id,
        next.plan,
        offer.days,
        offer.price,
        ref,
        next.until,
        nowIso(),
      ),
      DB.prepare("UPDATE users SET plan = ?, plan_until = ? WHERE id = ?").bind(next.plan, next.until, user.id),
    ]);
  } catch (e) {
    if (isUnique(e)) return c.json({ duplicate: true }, 200);
    throw e;
  }
  return c.json({ user_id: user.id, plan: next.plan, until: next.until }, 201);
});

const RevokeBody = z.object({ ref: z.string().min(1).max(100) });
billing.post("/api/ingest/plan/revoke", async (c) => {
  const parsed = RevokeBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid" }, 400);
  const DB = c.env.DB;
  const g = await DB.prepare("SELECT user_id, offer, days FROM plan_grants WHERE ref = ?").bind(parsed.data.ref).first<{ user_id: number; offer: string; days: number }>();
  if (!g || g.days <= 0) return c.json({ error: "grant not found" }, 404);
  const user = await DB.prepare("SELECT id, plan, plan_until FROM users WHERE id = ?").bind(g.user_id).first<UserRow>();
  if (!user) return c.json({ error: "user not found" }, 404);
  const now = Date.now();
  const until = user.plan_until ? Date.parse(user.plan_until) - g.days * 86400_000 : now;
  const plan: PlanKey = until > now ? effectivePlan(user.plan, new Date(until).toISOString()) : "free";
  const untilIso = plan === "free" ? null : new Date(until).toISOString();
  try {
    await DB.batch([
      DB.prepare("INSERT INTO plan_grants (user_id, offer, plan, days, price, ref, until_after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(
        user.id,
        g.offer,
        plan,
        -g.days,
        -(OFFERS.find((o) => o.id === g.offer)?.price ?? 0),
        `revoke:${parsed.data.ref}`,
        untilIso ?? nowIso(),
        nowIso(),
      ),
      DB.prepare("UPDATE users SET plan = ?, plan_until = ? WHERE id = ?").bind(plan, untilIso, user.id),
    ]);
  } catch (e) {
    if (isUnique(e)) return c.json({ duplicate: true }, 200);
    throw e;
  }
  return c.json({ user_id: user.id, plan, until: untilIso });
});
