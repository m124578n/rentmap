# 採集可行性探測(2026-09-20)

在家裡這台 Windows(住宅 IP)試抓三個租屋網站的結果。腳本已改寫成正式的 `collector/`,探測輸出在 `data/spike/`(不進 git)。

## 結論

| 站 | 純 fetch | Playwright(headless) | 結構化資料 | 決定 |
|---|---|---|---|---|
| **591** | ✅ 200,完整 SSR HTML | ✅ | `window.__NUXT__` 有全部欄位 + JSON-LD | **只用 fetch,不用 Playwright**。已完成 parser。 |
| 樂屋 | ❌ 403 | ❌ Cloudflare 驗證頁,被導回首頁 | — | 先不做。之後可試 headed 模式或 Chrome CDP 接真瀏覽器。 |
| 好房 | ❌ Python 端憑證錯誤(站方憑證缺 SKI) | ✅ 列表有 10 個物件連結 `rent.housefun.com.tw/rent/house/<id>/` | 未細看 | Phase 2 再做,需要 Playwright。 |

## 591 細節

- 列表:`https://rent.591.com.tw/list?region=1&kind=1,2`(region 1 台北市、3 新北市;kind 1 整層住家、2 獨立套房)。
  JSON-LD `ItemList` 每頁 30 筆物件 URL;分頁待確認(`&page=N`)。
- 物件頁:`https://rent.591.com.tw/<id>`。`<script>window.__NUXT__=(function(a,b,…){return {…}})(…)</script>`
  是 JS 函式呼叫格式,不是 JSON,要執行才拿得到 → collector 用 `node:vm` 跑那段字串。
  Playwright 裡 `JSON.stringify(window.__NUXT__)` 會因 Vue 響應式物件循環參照失敗,所以 fetch + vm 反而更簡單。
- 物件資料位置:`__NUXT__.data.<隨機key>.data`(找有 `title` 與 `positionRound` 的那個)。重要欄位:
  - `positionRound.lat/lng/address`(座標是大概位置,`geocode_source = approx`)、`positionRound.data[traffic].children[type=subway]`(最近捷運站與距離)
  - `favData.{price, layout, area, address, kindTxt}`、`gtm_detail_data.{region_name, section_name, shape_name, floor_name}`
  - `info[]`(格局 / 坪數 / 樓層 / 型態)、`infoData.data[]`(屋齡 `age`、電梯 `lift`、裝潢)
  - `service.facility[]`(冰箱 / 洗衣機 / 網路 / 車位 …)、`service.descData[]`(養寵物、開伙、最短租期)
  - `rent_calculation_data`(押金、管理費、水電計費方式、服務費)
  - `linkInfo.{name, roleName, mobile, line}`(聯絡)
  - `favData.other.desc`:591 自己的行情提示,例如「租金較市價便宜約20%」→ 存進 `raw_json.market_hint`
  - `publish.{postTime, updateTime}`(相對時間文字)、`dealText`(已出租)
- 照片:JSON-LD `image[]`,同一張有不同尺寸後綴(`!fit.1000x.water2.jpg` 等),去重後統一用 `!1000x.water2.jpg`。

## 因此調整的架構

- **collector 改用 TypeScript(Node)**,不用 Python:要執行 `__NUXT__` 的 JS,而且能直接 import `src/shared/schemas.ts` 的 Zod schema,採集端與 ingest 端同一份驗證。
- `npm run collect -- add <url> [--dry]`、`npm run collect -- list <listUrl> [--dry]`;`.env` 放 `RENT_HOUSE_API` 與 `INGEST_SECRET`。
- Worker 新增 `POST /api/ingest/listings`(bearer),依 `(source, source_listing_id)` upsert,租金變動寫 `listing_price_history`,手動修正過的座標不被覆蓋。
- 抓取間隔 2.5–4 秒隨機,5xx / 429 退避重試。

## 尚未做

- 貼 URL 佇列(`pending_urls` → 採集機 `watch` 輪詢)
- 列表分頁與「儲存搜尋條件每日 sync」、下架偵測
- 好房 parser(Playwright)、樂屋
