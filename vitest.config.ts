import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// 測試直接跑在 workerd 裡;D1 每個測試檔各自一份,migrations 在 test/setup.ts 套用。
export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, "migrations")),
          SESSION_SECRET: "test-secret",
          INGEST_SECRET: "test-ingest",
          APP_ORIGIN: "http://localhost:5173",
          ADMIN_EMAILS: "tester@example.com",
        },
      },
    })),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src/client"),
      "@shared": path.resolve(import.meta.dirname, "src/shared"),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
  },
});
