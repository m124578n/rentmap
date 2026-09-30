import type { SessionUser } from "@shared/schemas";

/**
 * Bindings 與非機密變數(DB / APP_ORIGIN / ADMIN_EMAILS)由 `wrangler types` 從 wrangler.jsonc 產到
 * worker-configuration.d.ts 的 Cloudflare.Env;這裡只補機密(雲端 wrangler secret put,本機 .dev.vars)。
 */
declare global {
  namespace Cloudflare {
    interface Env {
      GOOGLE_CLIENT_ID?: string;
      GOOGLE_CLIENT_SECRET?: string;
      SESSION_SECRET?: string;
      INGEST_SECRET?: string; // 採集機 bearer
      ANTHROPIC_API_KEY?: string;
      DEV_USER_EMAIL?: string; // 只放 .dev.vars:本機免 Google 登入(GET /api/auth/dev)
      PRIVATE_POOL?: string; // 只放 .dev.vars:"1" = 私人模式(共用房源池、照片、聯絡人、採集推入);沒設 = 公開模式(見 pool.ts)
    }
  }
}

export type Env = Cloudflare.Env;
export type AppEnv = { Bindings: Env; Variables: { user: SessionUser } };
