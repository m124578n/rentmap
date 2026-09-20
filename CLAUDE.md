# 給 Claude 的工作守則(rent-house / 租屋筆記)

設計與進度在 `docs/design/2026-09-20-architecture.md`。這份只放「怎麼工作」。

## 鐵則

- **使用者說「好」之前不部署、不建任何雲端資源**:不跑 `wrangler deploy`、`d1 create`、`r2 bucket create`、
  `secret put`。本機一律用 `vite dev` 的本地模擬(`.wrangler/state`)。
- 不用 superpowers 那套流程(已全域停用)。直接做,設計討論用文件與簡短說明。
- 採集在家裡這台跑(`collector/`,Node + TS;591 純 fetch,不用 Playwright),Worker 不抓外站。地圖用 CARTO,不用 Google Maps / MapTiler。
- 能從 menmap(`../menmap`)抄的就抄:地圖 `localizeBasemap`、`mrt.json`、採集架構、OAuth。

## 專案結構(單一 Worker,前端 + API 同一個)

```
src/client/   React SPA(TanStack Router + Query、Tailwind v4);features/map/ 是地圖(CARTO 底圖、捷運圖層、價格標記)
src/worker/   Hono API;db/schema.ts 是 Drizzle schema
src/shared/   Zod schema 與常數,前後端共用
migrations/   D1 SQL(drizzle-kit 產生,不要手改)
test/         vitest 跑在 workerd(@cloudflare/vitest-plugin)
collector/    家裡的採集 CLI(`npm run collect -- add <url> [--dry]`);parser 測試在 test/collector/
```

## 常用指令

| 指令 | 做什麼 |
|---|---|
| `npm run dev` | 本機 5173,含 Worker 與本地 D1 |
| `npm run check` | tsc 型別檢查(改 wrangler.jsonc 後先 `npm run types`) |
| `npm test` | Workers 環境的整合測試 |
| `npm run db:generate` | 改 `src/worker/db/schema.ts` 後產 migration |
| `npm run db:migrate:local` | 套 migration 到本地 D1(`vite dev` 開著時不要跑,會撞 SQLite) |
| `npm run collect -- add <591網址> --dry` | 抓一筆並印 JSON;不加 `--dry` 就推到 `.env` 的 `RENT_HOUSE_API` |

## 驗證順序(省 token)

1. `npm run check` 過了就不用開瀏覽器確認編譯。
2. API 行為用 `npm test` 或 curl;測試可以自己簽 session cookie(見 `test/properties.test.ts` 的 `signSession`)。
3. 只有版面 / 視覺改動才截圖,一張就好:`npm run dev` 開著,`node scripts/shot.mjs / data/shot.png --click=.rh-marker`(`--dark` 切暗色),再用 Read 看圖。

## 本機登入

本機不用 Google:`.dev.vars` 有 `DEV_USER_EMAIL` 時前端出現「本機登入」鈕(`GET /api/auth/dev`),只在 `APP_ORIGIN` 是 localhost 時生效。
curl 測 API 可以 `curl -c jar http://localhost:5173/api/auth/dev` 拿 cookie。正式站才用 Google(`ADMIN_EMAILS` 白名單)。

## 已知坑

- Tailwind v4 的 `@apply` 不能引用自訂 class(`.btn`),要重複 utility。
- `@cloudflare/vitest-plugin` 需要 vitest 4.x,不能升 5。
- `tsc -b` 偶爾吃到舊的 `.tsbuildinfo` 報假錯,刪掉重跑。
- maplibre-gl v6 在 Vite 8 dev 模式要 `optimizeDeps.exclude`,否則 worker 載不到、圖磚全空(已設在 vite.config.ts)。
- `import * as maplibregl from "maplibre-gl"`(v6 沒有 default export);GeoJSON 型別從 `geojson` 套件 import。
- 591 的 `window.__NUXT__` 是 JS 函式呼叫不是 JSON,要 `node:vm` 執行;Playwright 裡 stringify 會循環參照。
- 型別:bindings 從 `worker-configuration.d.ts`(`npm run types` 產生)的 `Cloudflare.Env` 來,機密欄位在 `src/worker/env.ts` 用 `declare global` 補。
