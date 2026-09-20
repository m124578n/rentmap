import { defineConfig } from "drizzle-kit";

// 只用來從 schema 產生 SQL migration(`npm run db:generate`);套用交給 wrangler d1 migrations。
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/worker/db/schema.ts",
  out: "./migrations",
});
