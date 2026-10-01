# 2026-10-01 給雲端 Claude 的工作清單

日期:2026-10-01
相關:`2026-09-30-open-a-region.md` §4(資料現況)、`../business/2026-09-30-direction-notes-and-regions.md`

家裡那台(本機 D1)昨晚把四個生活圈的資料都抓齊、三個新生活圈已打開並驗證過,全部在 main 上。
資料類的事只能在家裡做(採集、匯入都在本機 D1);下面列的是**不需要本機資料、雲端可以直接做的**。做完照常推分支,家裡會併進 main。

## 現況(main `835706e` 之後)

- `src/shared/regions.ts`:north / taichung / tainan / kaohsiung 都 `enabled: true`;各縣市 `coverage` 反映實際有的資料
  (台中、高雄的 `garbage` 是用 OSM 門牌對出來的,`PARTIAL_GARBAGE` 標示約一成沒座標)。
- `public/tra.json` 151 站、`public/mrt-times.json` 含台中綠線、高雄紅橘線與輕軌。
- `scripts/verify-regions.mjs`:切生活圈、右鍵市中心出報告、截圖、列錯誤(需要 dev server 與本機資料,雲端跑不了)。
- 治安各區件數(雙北以外):`collector/crime` 已會抓警政署全國資料並寫 `periods`,但內政部開放資料平台(117.56.7.x)從 9/30 晚上掛到 10/1 早上,
  還沒實際跑過;跑完才會把那些縣市的 `coverage` 加上 `crimeDistricts`。**雲端不用動這塊。**

## 雲端可以做的(依序)

1. **狀態頁依生活圈**:`GET /api/status?region=` 目前不管 region,所有生活圈加總(`src/worker/routes/status.ts`);
   改成帶 `region` 時只算該生活圈(公車依縣市、生活機能 / 災害依生活圈外框 `regionBbox`、實價登錄依縣市、治安各區依縣市),
   `StatusPage` 顯示目前生活圈並可切換。測試:`test/` 加一個 Workers 測試,塞兩個生活圈的 pois 後各查一次。
2. **非北區的整合測試**:現有 Workers 測試幾乎都用台北座標。補:
   - `/api/nearby` 與 `/api/garbage/fit` 在台中座標(24.16, 120.65)上,用 ingest 塞幾筆 `garbage` / `convenience`,確認走的是台中那份網格、北區不受影響。
   - `/api/hazards?city=台中市` 的 `no_coverage` 要是 `["liquefaction", "airnoise"]`;`city=台南市` 是 `["airnoise"]`。
   - `/api/commute` 房源在高雄、地點在高雄:載高雄公車網路(用 `test/bus.test.ts` 的 ingest 方式塞一條高雄路線)。
3. **`/api/nearby/summary` 瘦身**:本機 1,893 間房源回 463 KB(每間所有類別都列,含 0)。只回非 0 的類別、或把 counts 壓成陣列;
   前端 `features/nearby`、`ComparePage`、`fit` 讀的地方跟著改。改完 `src/shared/poi.ts` 的型別。
4. **治安區塊**(`features/crime/CrimeSection.tsx`):雙北以外的縣市只有各區件數、沒有點位,目前文案「只到行政區、沒有點位」可以;
   但「住宅竊盜{生活圈} N 區第 M 多」的排名在那些縣市會把「沒有紀錄的區」排除,確認分母用的是該縣市的 `districts` 數(沒件數的區算 0),
   不是「有件數的區」。加測試(純函式抽出來)。
5. **部署前的 runbook(只寫文件,不部署)**:`docs/design/deploy-runbook.md`,把 CLAUDE.md 散落的部署注意事項整理成一份可照做的清單:
   Workers Paid(通勤引擎 CPU)、`wrangler.jsonc` 的 D1 / 環境變數、`wrangler secret` 要放哪些(`src/worker/env.ts` 的清單)、`APP_ORIGIN` / `ADMIN_EMAILS`、
   `index.html` 的 `og:image` 改絕對網址、`public/sw.js` 的 `VERSION`、`.env` 的 `RENTMAP_API` 改正式站、第一次 `d1 migrations apply`、
   資料匯入順序(`npm run data:refresh` 從家裡推到正式站要幾分鐘、哪些要先)。**使用者說「好」之前不要執行任何一步。**
6. **條款文件**:`src/client/features/legal/docs.tsx` 的「資料來源與免責聲明」昨晚加了台南液化、台中 / 台南 / 高雄垃圾車、
   OSM 門牌(各市政府門牌位置資料經 OpenStreetMap);家裡已把 `LEGAL_DOCS.sources` 版本加到 1.1。之後再改內容照 `src/shared/legal.ts` 的規則加版本。
7. **AboutPage / 首頁文案**:地區標語已改成跟著 `OPEN_REGIONS` 產生(「北北基桃、台中、台南、高雄 · 找房筆記」)。
   如果要改成更短的說法(「六都」之類),那是對外名稱,先問使用者(方向文件 §9 第 1 點還沒決定)。

## 要使用者決定、先不要做

- 金流(方向文件第 8 步)、部署、任何雲端資源(鐵則)。
- 機車通勤要不要接路徑引擎(方向文件 §9)。
- 台中、高雄垃圾車那一成沒座標的點要不要之後用 TGOS 補(要固定 IP 或網域,部署後才能申請)。

## 只能在家裡做的(雲端不要碰)

- 任何 `npm run collect -- …`、`npm run data:refresh`、`scripts/build_*.py`、`scripts/locate_garbage.py`(要本機 D1、TDX 金鑰、台灣 OSM 檔)。
- `public/tra.json`、`public/mrt-times.json`、`public/crime-districts.json` 的內容(由採集產生;雲端改了會被下次採集覆蓋)。
