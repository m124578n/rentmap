# 給 Claude 的工作守則(rentmap / 租屋筆記)

repo:https://github.com/m124578n/rentmap(本機資料夾仍叫 `rent-house`,不要改名,Claude 的專案記憶綁在路徑上)。

設計與進度在 `docs/design/2026-09-20-architecture.md`。這份只放「怎麼工作」。

## 鐵則

- **使用者說「好」之前不部署、不建任何雲端資源**:不跑 `wrangler deploy`、`d1 create`、`r2 bucket create`、
  `secret put`。本機一律用 `vite dev` 的本地模擬(`.wrangler/state`)。
- 不用 superpowers 那套流程(已全域停用)。直接做,設計討論用文件與簡短說明。
- **不存任何檔案**:不用 R2,照片只存來源 URL,看房紀錄純文字。不要提議照片 / 錄音上傳。
- 採集在家裡這台跑(`collector/`,Node + TS;591 純 fetch,不用 Playwright),Worker 不抓外站。地圖用 CARTO,不用 Google Maps / MapTiler。
- 能從 menmap(`../menmap`)抄的就抄:地圖 `localizeBasemap`、`mrt.json`、採集架構、OAuth。

## 專案結構(單一 Worker,前端 + API 同一個)

```
src/client/   React SPA(TanStack Router + Query、Tailwind v4);features/map/ 是地圖(CARTO 底圖、捷運圖層、價格標記)
              features/bus/ 是房源面板的公車區塊(附近路線、通勤直達、班表),map/busLayer.ts 畫路線
src/worker/   Hono API;db/schema.ts 是 Drizzle schema
src/shared/   Zod schema 與常數,前後端共用
migrations/   D1 SQL(drizzle-kit 產生,不要手改)
test/         vitest 跑在 workerd(@cloudflare/vitest-plugin)
collector/    家裡的採集 CLI(`npm run collect -- add <url> [--dry]`);sources/ 每站一檔(591 純 fetch、好房 Playwright),sources/index.ts 是註冊表;parser 測試在 test/collector/
              bus/ 是 TDX 公車(transform.ts 純函式,測試 test/collector/bus.test.ts)
```

## 常用指令

| 指令 | 做什麼 |
|---|---|
| `npm run dev` | 本機 5173,含 Worker 與本地 D1 |
| `npm run check` | tsc 型別檢查(改 wrangler.jsonc 後先 `npm run types`) |
| `npm test` | Workers 環境的整合測試 |
| `npm run db:generate` | 改 `src/worker/db/schema.ts` 後產 migration |
| `npm run db:migrate:local` | 套 migration 到本地 D1(`vite dev` 開著時不要跑,會撞 SQLite) |
| `npm run collect -- add <591網址> --dry` | 抓一筆並印 JSON;不加 `--dry` 就推到 `.env` 的 `RENTMAP_API` |
| `npm run collect -- list <591列表網址> --pages=1-5` | 抓多頁列表,每頁推一次。591 的 `kind` 只吃單一值(1 整層、2 獨立套房、3 分租套房) |
| `bash scripts/collect-city.sh <1 台北\|3 新北> [pages]` | 一個城市三種房型批次(約 25 分鐘);要用 `( … & )` 脫離式跑,工具的背景任務 10 分鐘會被砍 |
| `npm run collect -- bus [--dry] [--refresh]` | 從 TDX 下載雙北公車路線 / 站 / 線形 / 班表 → 覆蓋式推入(一個月一次;`.env` 的 `TDX_CLIENT_ID/SECRET`,沒填用匿名額度;原始檔快取 `data/tdx/`) |
| `npm run collect -- sync` | 每日同步(searches.json);排程 `RentmapDailySync` 每天 20:00 跑 `scripts/run_daily.ps1`,本機模式會自己起 / 關 dev server |

## 驗證順序(省 token)

1. `npm run check` 過了就不用開瀏覽器確認編譯。
2. API 行為用 `npm test` 或 curl;測試可以自己簽 session cookie(見 `test/properties.test.ts` 的 `signSession`)。
3. 只有版面 / 視覺改動才截圖,一張就好:`npm run dev` 開著,`node scripts/shot.mjs --route=/ --click=.rh-marker`(`--dark` 切暗色),再用 Read 看圖。

## 排程

每天 20:00 Windows 工作排程 `RentmapDailySync` 跑 `scripts/run_daily.ps1`(log 在 `data/logs/{date}-sync.log`)。**20:00 到約 20:40 不要改 Drizzle schema、不要另開 dev server**(它會偵測 5173 沒開就自己起一個,跑完關掉)。menmap 的排程同一時間跑,互不影響。部署後把 `.env` 的 `RENTMAP_API` 改成正式站即可。

## 本機登入

本機不用 Google:`.dev.vars` 有 `DEV_USER_EMAIL` 時前端出現「本機登入」鈕(`GET /api/auth/dev`),只在 `APP_ORIGIN` 是 localhost 時生效。
curl 測 API 可以 `curl -c jar http://localhost:5173/api/auth/dev` 拿 cookie。正式站才用 Google(`ADMIN_EMAILS` 白名單)。

## 已知坑

- 改 Drizzle schema 前先確認沒有採集在跑:HMR 會讓 Worker 立刻用新 schema 查 D1,欄位還沒 migrate 就整個 ingest 壞掉。順序:採集跑完 → 停 dev → 改 schema → `db:generate` → `db:migrate:local` → 重開。
- Tailwind v4 + Vite 8 dev:**新增的檔案**裡的 class 不會被掃到(`w-64`、`sm:hidden` 沒產生),要重開 dev server。改既有檔案沒這問題。
- Tailwind v4 的 `@apply` 不能引用自訂 class(`.btn`),要重複 utility。
- `@cloudflare/vitest-plugin` 需要 vitest 4.x,不能升 5。
- `tsc -b` 偶爾吃到舊的 `.tsbuildinfo` 報假錯,刪掉重跑。
- maplibre-gl v6 在 Vite 8 dev 模式要 `optimizeDeps.exclude`,否則 worker 載不到、圖磚全空(已設在 vite.config.ts)。
- `import * as maplibregl from "maplibre-gl"`(v6 沒有 default export);GeoJSON 型別從 `geojson` 套件 import。
- 樂屋被 Cloudflare 擋死(連 headed 真 Chrome + 人工點驗證都過不了),不要再花時間試自動化;見 spike 文件。
- Vite 的 watcher 會掃整個 repo:`data/` 底下放瀏覽器 profile 之類的鎖檔會讓 dev server 直接崩掉(已在 vite.config.ts 忽略 data/、.wrangler/、dist/)。
- 好房會限速:約 100 次載入就整站 403 一陣子。抓好房一定要走 sources/index.ts 的 politeDelay(6–10 秒),不要另外寫迴圈硬抓;sync 有斷路器,連續失敗或 403 就停該來源。
- 好房:列表分頁是頁內 JS `PM(n)`,要在同一個 Playwright page 上 evaluate;物件頁欄位是 `<li class="list">` 標題 + 值,地址是 `<address>` 不是 span;沒座標,用 Nominatim(快取在 data/geocode-cache.json,1 秒一次)。
- 591 的 `window.__NUXT__` 是 JS 函式呼叫不是 JSON,要 `node:vm` 執行;Playwright 裡 stringify 會循環參照。
- 型別:bindings 從 `worker-configuration.d.ts`(`npm run types` 產生)的 `Cloudflare.Env` 來,機密欄位在 `src/worker/env.ts` 用 `declare global` 補。
