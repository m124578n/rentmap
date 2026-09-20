import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const alias = {
  "@": path.resolve(import.meta.dirname, "src/client"),
  "@shared": path.resolve(import.meta.dirname, "src/shared"),
};

// 兩個測試環境:
//   workers   → test/*.test.ts,跑在 workerd,D1 每個測試檔各自一份(migrations 在 test/setup.ts 套用)
//   collector → test/collector/*.test.ts,一般 Node(parser 要用 node:vm 執行 591 的 __NUXT__)
export default defineConfig({
  test: {
    projects: [
      {
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
        resolve: { alias },
        test: { name: "workers", include: ["test/*.test.ts"], setupFiles: ["./test/setup.ts"] },
      },
      {
        resolve: { alias },
        test: { name: "collector", include: ["test/collector/**/*.test.ts"], environment: "node" },
      },
    ],
  },
});
