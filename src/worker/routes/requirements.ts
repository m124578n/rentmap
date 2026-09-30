/**
 * 找房需求(需登入;M6 符合度用,計算在前端):
 *   GET /api/requirements  → { requirements }(沒設過回預設:什麼都不限)
 *   PUT /api/requirements  整份覆蓋
 */
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { EMPTY_REQUIREMENTS, Requirements } from "@shared/fit";
import type { AppEnv } from "../env";
import { db, nowIso, schema } from "../db";
import { requireUser } from "../auth";

export const requirements = new Hono<AppEnv>();
requirements.use("/api/requirements", requireUser());

requirements.get("/api/requirements", async (c) => {
  const [row] = await db(c.env.DB).select().from(schema.userRequirements).where(eq(schema.userRequirements.userId, c.get("user").id));
  // 存的是舊版格式(少欄位)時用預設補齊
  const parsed = row ? Requirements.safeParse({ ...EMPTY_REQUIREMENTS, ...(JSON.parse(row.json) as object) }) : null;
  return c.json({ requirements: parsed?.success ? parsed.data : EMPTY_REQUIREMENTS });
});

requirements.put("/api/requirements", async (c) => {
  const parsed = Requirements.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues.slice(0, 20) }, 400);
  const json = JSON.stringify(parsed.data);
  const now = nowIso();
  await db(c.env.DB)
    .insert(schema.userRequirements)
    .values({ userId: c.get("user").id, json, updatedAt: now })
    .onConflictDoUpdate({ target: schema.userRequirements.userId, set: { json, updatedAt: now } });
  return c.json({ requirements: parsed.data });
});
