import { applyD1Migrations, env } from "cloudflare:test";

// 每支測試檔開始前把 migrations 套到乾淨的 D1
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
