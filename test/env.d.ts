import type { D1Migration } from "@cloudflare/vitest-plugin";

// cloudflare:test 的 env 是全域 Cloudflare.Env(見 worker-configuration.d.ts 與 src/worker/env.ts);測試多一個 migrations binding
declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
export {};
