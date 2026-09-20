# 給 Claude 的工作守則(rent-house / 租屋筆記)

設計與進度在 `docs/design/2026-09-20-architecture.md`。這份只放「怎麼工作」。

## 鐵則

- **使用者說「好」之前不部署、不建任何雲端資源**:不跑 `wrangler deploy`、`d1 create`、`r2 bucket create`、
  `secret put`。本機一律用 `vite dev` 的本地模擬(`.wrangler/state`)。
- 不用 superpowers 那套流程(已全域停用)。直接做,設計討論用文件與簡短說明。
- 採集在家裡這台跑(Python + Playwright),Worker 不抓外站。地圖用 CARTO,不用 Google Maps / MapTiler。
- 能從 menmap(`../menmap`)抄的就抄:地圖 `localizeBasemap`、`mrt.json`、採集架構、OAuth。

## 專案結構(單一 Worker,前端 + API 同一個)

```
src/client/   React SPA(TanStack Router + Query、Tailwind v4)
src/worker/   Hono API;db/schema.ts 是 Drizzle schema
src/shared/   Zod schema 與常數,前後端共用
migrations/   D1 SQL(drizzle-kit 產生,不要手改)
test/         vitest 跑在 workerd(@cloudflare/vitest-plugin)
collector/    家裡的 Python 採集(尚未建)
```

## 常用指令

| 指令 | 做什麼 |
|---|---|
| `npm run dev` | 本機 5173,含 Worker 與本地 D1 |
| `npm run check` | tsc 型別檢查(改 wrangler.jsonc 後先 `npm run types`) |
| `npm test` | Workers 環境的整合測試 |
| `npm run db:generate` | 改 `src/worker/db/schema.ts` 後產 migration |
| `npm run db:migrate:local` | 套 migration 到本地 D1(`vite dev` 開著時不要跑,會撞 SQLite) |

## 驗證順序(省 token)

1. `npm run check` 過了就不用開瀏覽器確認編譯。
2. API 行為用 `npm test` 或 curl;測試可以自己簽 session cookie(見 `test/properties.test.ts` 的 `signSession`)。
3. 只有版面 / 視覺改動才截圖,一張就好。

## 本機登入

`.dev.vars` 的 `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` 用 menmap 同一組 client(已註冊 `http://localhost:5173`)。
沒填時 `/api/me` 回 `enabled: false`,前端顯示「尚未設定登入」。只有 `ADMIN_EMAILS` 裡的帳號能登入。

## 已知坑

- Tailwind v4 的 `@apply` 不能引用自訂 class(`.btn`),要重複 utility。
- `@cloudflare/vitest-plugin` 需要 vitest 4.x,不能升 5。
- `tsc -b` 偶爾吃到舊的 `.tsbuildinfo` 報假錯,刪掉重跑。
- 型別:bindings 從 `worker-configuration.d.ts`(`npm run types` 產生)的 `Cloudflare.Env` 來,機密欄位在 `src/worker/env.ts` 用 `declare global` 補。
