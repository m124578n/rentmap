/**
 * 條款同意(需登入):
 *   POST /api/consent { docs: [{ doc, version }] }  記下同意(使用者、文件、版本、時間、IP、UA);版本必須是目前版本
 * 還要同意哪些放在 /api/me 的 consent_needed(前端據此擋畫面)。
 */
import { Hono } from "hono";
import { z } from "zod";
import { LEGAL_DOCS, REQUIRED_CONSENTS } from "@shared/legal";
import type { AppEnv } from "../env";
import { requireUser } from "../auth";
import { neededFor } from "../consent";

export const legal = new Hono<AppEnv>();
legal.use("/api/consent", requireUser());

const Body = z.object({ docs: z.array(z.object({ doc: z.enum(REQUIRED_CONSENTS), version: z.string().max(20) })).min(1).max(10) });

legal.post("/api/consent", async (c) => {
  const parsed = Body.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid" }, 400);
  const stale = parsed.data.docs.filter((d) => LEGAL_DOCS[d.doc].version !== d.version);
  if (stale.length) return c.json({ error: "條款已更新,請重新整理再同意", stale }, 409);
  const user = c.get("user");
  const now = new Date().toISOString();
  const ip = c.req.header("CF-Connecting-IP") ?? c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ?? null;
  const ua = c.req.header("User-Agent")?.slice(0, 300) ?? null;
  await c.env.DB.batch(
    parsed.data.docs.map((d) =>
      c.env.DB.prepare("INSERT INTO consents (user_id, doc, version, accepted_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)").bind(user.id, d.doc, d.version, now, ip, ua),
    ),
  );
  return c.json({ consent_needed: await neededFor(c.env.DB, user.id) });
});
