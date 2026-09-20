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
    }
  }
}

export type Env = Cloudflare.Env;
export type AppEnv = { Bindings: Env; Variables: { user: SessionUser } };
