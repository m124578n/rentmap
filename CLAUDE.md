# 給 Claude 的工作守則(rentmap / 租屋筆記)

repo:https://github.com/m124578n/rentmap(本機資料夾仍叫 `rent-house`,不要改名,Claude 的專案記憶綁在路徑上)。

設計與進度在 `docs/design/2026-09-20-architecture.md`。這份只放「怎麼工作」。

**產品方向(2026-09-30 定案,先讀):`docs/business/2026-09-30-direction-notes-and-regions.md`。** 重點:
- 產品是「找房筆記」:房源由使用者自己帶進來(手動 / 瀏覽器書籤小工具),賣的是對地址的分析。**不再每天抓 591 / 好房**,排程已停用。
- 抓來的房源只留在使用者本機 D1,不上正式站;公開版每人只看到自己的筆記,不存照片、屋況文字、聯絡人。用「私人模式」開關讓本機維持舊行為。
- 範圍以六都為主,依**生活圈**分區(north 北北基桃 / taichung / tainan / kaohsiung),一次只載一區;不要再新增寫死「台北市 / 新北市」的程式。

## 鐵則

- **使用者說「好」之前不部署、不建任何雲端資源**:不跑 `wrangler deploy`、`d1 create`、`r2 bucket create`、
  `secret put`。本機一律用 `vite dev` 的本地模擬(`.wrangler/state`)。
- 不用 superpowers 那套流程(已全域停用)。直接做,設計討論用文件與簡短說明。
- **不存任何檔案**:不用 R2,照片只存來源 URL,看房紀錄純文字。不要提議照片 / 錄音上傳。
- 採集在家裡這台跑(`collector/`,Node + TS;591 純 fetch,不用 Playwright),Worker 不抓外站。地圖用 CARTO,不用 Google Maps / MapTiler。
- 能從 menmap(`../menmap`)抄的就抄:地圖 `localizeBasemap`、`mrt.json`、採集架構、OAuth。

## 專案結構(單一 Worker,前端 + API 同一個)

```
src/client/   React SPA(TanStack Router + Query、Tailwind v4);features/map/ 是地圖(CARTO 底圖、捷運圖層、價格標記;
              PointDetail 是右鍵 / 長按任意點的面板、heat.ts + heatLayer.ts 是「區域圖層」:通勤網格、每坪租金、災害多邊形、
              priceMarkers.ts 是價格標記 + 群集:HTML 標記照舊,cluster source 決定誰被合併)
              features/cost/ 是每月支出(估,src/shared/cost.ts)、features/crime/ 是治安區塊;routes/TourPage 看房路線、routes/StatusPage 資料狀態、
              routes/AboutPage 介紹頁(沒登入時任何網址都顯示它);每一頁在 router.tsx 用 lazyRouteComponent 各自一個 chunk
              features/bus/ 是房源面板的公車區塊(附近路線、通勤直達、班表),map/busLayer.ts 畫路線
              features/market/ 是租金行情卡、features/fit/ 是需求與符合度(M6)、features/compare/ + routes/ComparePage 是比較表(M8)
              features/nearby/ 是生活機能(面板區塊,含垃圾車、嫌惡設施「注意」列;資料 src/shared/poi.ts、API routes/nearby.ts)
              features/hazard/ 是災害風險(淹水 / 液化;src/shared/hazard.ts、API routes/hazards.ts)
              features/report/ 是「地址即報告」:AddressSearch 搜地址 → PointDetail 出報告(含 /api/market/at 行情)→ SaveNote 存成筆記;房源增刪後用 lib/invalidate.ts 一起刷彙總
              features/places/ 是「我的地點」(輸入地址 → 瀏覽器查 Nominatim → 拖圖釘);features/commute/ 是通勤(面板「通勤」區塊、列表排序、篩選列「通勤 ≤ N 分」)
src/worker/   Hono API;db/schema.ts 是 Drizzle schema
              pool.ts 是私人 / 公開模式(PRIVATE_POOL):公開模式每人只看自己建的房源(properties.created_by),查房源的 SQL 都要接 ownerSql / ownerOf
              transit/ 是通勤規劃(公車 + 捷運、轉乘一次內;依時段算等車、下班用 reverseNet 反向算):network.ts 公車網路整份進記憶體、mrt.ts 由 public/mrt.json 建捷運圖(站間時間用 public/mrt-times.json)、plan.ts 從目的地往回算、bike.ts 是 YouBike 騎乘段
src/shared/   Zod schema 與常數,前後端共用;**regions.ts 是生活圈與縣市定義(行政區、TDX / 實價登錄代碼、範圍、各縣市有哪些資料),新增縣市或判斷「某縣市有沒有某資料」一律走它**
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
| `npm run collect -- bus [--dry] [--refresh]` | 從 TDX 下載雙北公車路線 / 站 / 線形 / 班表 → 覆蓋式推入(一個月一次,每次約 8 次請求;`.env` 的 `TDX_CLIENT_ID/SECRET` **必填**,不帶金鑰 API 一律 401;原始檔快取 `data/tdx/`) |
| `npm run collect -- rent-stats [--seasons=4] [--dry]` | 內政部租賃實價登錄(雙北最近 N 季)→ 推入 `rent_stats`(每季公布後一次,約 1/4/7/10 月;zip 快取 `data/lvr/`)。行情計算在 `src/shared/market.ts` |
| `npm run collect -- pois [--only=food,park] [--dry] [--force]` | 生活機能:OSM Overpass 一類一類抓 + menmap 拉麵 + 雙北環保局垃圾車清運點(`--only=garbage`,約 1 分鐘)+ YouBike 站點(`--only=youbike`)+ 嫌惡設施(加油站、變電所、快速道路、鐵道高架…)→ 每類覆蓋式推入 `pois`(一個月一次,全部約 15–20 分鐘;原始回應快取 `data/osm/`,中斷重跑會接著抓) |
| `pip install py7zr pyshp pyproj` + `python scripts/build_hazards.py`,再 `npm run collect -- hazards [--dry] [--force]` | 災害潛勢(水利署淹水 7z SHP + 臺北市液化 GeoJSON + 雙北航空噪音防制區,依里公告對上里界 SHP)→ `data/hazard/hazards.json` → 覆蓋式推入 `hazard_zones`(資料幾年才更新一次;原始檔快取 `data/hazard/`) |
| `npm run collect -- crime [--years=3] [--dry]` | 治安:臺北市警察局竊盜點位(住宅 / 機車 / 汽車)→ 巷或路段轉座標(Nominatim,快取 `data/geocode-cache.json`,第一次約 20–40 分鐘)→ 推入 `pois`(theft_*);雙北各區近一年件數 → `public/crime-districts.json`(**要 commit**)。每季一次,原始 CSV 快取 `data/crime/` |
| `npm run collect -- metro [--dry]` | 從 TDX 下載捷運官方站間時間 → `public/mrt-times.json`(進 git;路網有變才需要重跑。淡海、安坑輕軌 TDX 沒有,用距離估) |
| `npm run collect -- sync --group=<taipei\|newtaipei\|recheck\|housefun>` | 每日同步,分組分時段(20:00 台北、21:00 新北含重抓 80 筆;housefun / recheck 組不排程);排程 `RentmapSync-*` 跑 `scripts/run_daily.ps1 -Group …`,本機模式會自己起 / 關 dev server。不帶 group = 全部一次跑(量大,只在手動需要時) |

## 驗證順序(省 token)

1. `npm run check` 過了就不用開瀏覽器確認編譯。
2. API 行為用 `npm test` 或 curl;測試可以自己簽 session cookie(見 `test/properties.test.ts` 的 `signSession`)。
3. 只有版面 / 視覺改動才截圖,一張就好:`npm run dev` 開著,`node scripts/shot.mjs --route=/ --click=.rh-marker`(`--dark` 切暗色),再用 Read 看圖。

## 排程

**2026-09-30 起兩個排程都已停用(Disabled),方向改為找房筆記、不再每日採集。** 要恢復:`Get-ScheduledTask RentmapSync-* | Enable-ScheduledTask`。以下是原本的設定:

Windows 工作排程 `RentmapSync-*` 兩個時段(20:00 台北、21:00 新北 + 重抓 80 筆;好房中午與 23:00 重抓 2026-09-29 取消以減少喚醒,`--group=housefun|recheck` 仍可手動跑)各跑 `scripts/run_daily.ps1 -Group …`(log 在 `data/logs/{date}-sync-{group}.log`),每組 5–15 分鐘。排程會把睡眠中的電腦喚醒(WakeToRun,電源設定「允許喚醒計時器」已啟用),`run_daily.ps1` 開頭先等網路、`git pull`,自動睡眠預設關閉(`$env:AUTO_SLEEP=1` 才開:腳本開始後沒人動過電腦、且 menmap / 其他 rentmap 排程沒在跑才睡)。**這些時段前後 20 分鐘不要改 Drizzle schema、不要另開 dev server**(它會偵測 5173 沒開就自己起一個,跑完關掉)。menmap 的排程同一時間跑,互不影響。部署後把 `.env` 的 `RENTMAP_API` 改成正式站即可。

## 私人模式(PRIVATE_POOL)

本機 `.dev.vars` 要有 `PRIVATE_POOL=1`:共用的 591 / 好房房源池、照片、聯絡人、刊登天數、每坪開價圖層、採集推入(`/api/ingest/listings` 等)都靠它。
**沒設就是公開模式**(正式站預設):每人只看自己建的房源,採集推入 404。新增讀 `properties` 的 API 時要照 `src/worker/pool.ts` 過濾,快取 key 用 `propertiesSig(DB, ownerOf(c))`。

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
- `.ps1` 一定要存成 **UTF-8 with BOM**:PowerShell 5.1 沒 BOM 會用 ANSI 讀,中文字串直接讓腳本語法錯誤(register_task.ps1 踩過)。
- Vite 的 watcher 會掃整個 repo:`data/` 底下放瀏覽器 profile 之類的鎖檔會讓 dev server 直接崩掉(已在 vite.config.ts 忽略 data/、.wrangler/、dist/)。
- 好房會限速:約 100 次載入就整站 403 一陣子。抓好房一定要走 sources/index.ts 的 politeDelay(6–10 秒),不要另外寫迴圈硬抓;sync 有斷路器,連續失敗或 403 就停該來源。
- 好房:列表分頁是頁內 JS `PM(n)`,要在同一個 Playwright page 上 evaluate;物件頁欄位是 `<li class="list">` 標題 + 值,地址是 `<address>` 不是 span;沒座標,用 Nominatim(快取在 data/geocode-cache.json,1 秒一次)。
- 591 的 `window.__NUXT__` 是 JS 函式呼叫不是 JSON,要 `node:vm` 執行;Playwright 裡 stringify 會循環參照。
- `/api/commute` 一次算所有房源 × 地點:本機實測 8 萬站、3000 間、2 個地點約 0.5 秒(首次載入公車網路約 1 秒)。**部署時要 Workers Paid**,免費方案每次請求 CPU 10ms 不夠。
- maplibre v6 的 `map.isStyleLoaded()` 在任何 source 還在載入時也回 false:資料晚到時要等 `idle` 再畫(MapView 的 `whenReady`),直接 return 會永遠畫不上去。
- 離線:`public/sw.js` 只在正式建置註冊(`vite preview` 才測得到,dev 沒有)。改了快取策略要把檔內 `VERSION` 加一,舊快取才會清掉。
- 彙總 API(`/api/commute`、`/api/nearby/summary`、`/api/market`、`/api/hazards/summary`)走 `src/worker/cache.ts` 的 Cache API,key 帶資料版本(筆數 + 最大 version / id / updated_at)。**新增會影響結果的資料來源時要把它加進 key**,不然會回舊的;回應 header `x-cache: hit|miss`。`/api/properties` 用 ETag(304)。
- 部署時把 `index.html` 的 `og:image` 改成正式網域的絕對網址(社群平台不吃相對路徑)。
- 型別:bindings 從 `worker-configuration.d.ts`(`npm run types` 產生)的 `Cloudflare.Env` 來,機密欄位在 `src/worker/env.ts` 用 `declare global` 補。
