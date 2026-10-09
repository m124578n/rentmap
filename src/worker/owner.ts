/**
 * 站長帳號(wrangler.jsonc 的 OWNER_EMAILS,逗號分隔):
 *   - 方案永遠是完整版、權限不限(不用每 90 天手動開通;金流還沒串之前也能用全部功能)
 *   - 只有站長看得到營運儀表板(/admin、/api/admin/*)
 * email 一律從資料庫讀(Google 驗證過的那個),不信任 session 或前端。
 */
import type { Context, MiddlewareHandler } from "hono";
import type { AppEnv, Env } from "./env";

export function ownerEmails(env: Env): string[] {
  return ((env as { OWNER_EMAILS?: string }).OWNER_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isOwnerEmail(env: Env, email: string | null | undefined): boolean {
  return !!email && ownerEmails(env).includes(email.trim().toLowerCase());
}

export async function isOwner(c: Context<AppEnv>): Promise<boolean> {
  const row = await c.env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(c.get("user").id).first<{ email: string | null }>();
  return isOwnerEmail(c.env, row?.email);
}

/** 要放在 requireUser 後面;不是站長回 404(不透露有這個頁面) */
export function requireOwner(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!(await isOwner(c))) return c.json({ error: "not found" }, 404);
    await next();
  };
}
