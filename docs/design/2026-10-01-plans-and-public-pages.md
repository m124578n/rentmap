# 付費方案、公開頁與 SEO(實作說明)

日期:2026-10-01
狀態:已實作(本機),還沒部署;金流(綠界)還沒串。

商業面的決定(為什麼這樣定價、為什麼不賣點數、變現評估)在 `../business/2026-09-30-subscription-and-legal.md`;
產品名與網域在 `../business/2026-09-30-direction-notes-and-regions.md` §9。這份只寫**程式怎麼做、改的時候要注意什麼**。

---

## 1. 付費方案

### 1.1 方案與價格

只有一個付費方案「完整版」,差在天數;一次付清、不自動續約、不賣點數。定義在 `src/shared/plan.ts`(`OFFERS`、`ENTITLEMENTS`),帳號頁的方案卡片直接從這裡產生。

| 品項 id | 天數 | 價格 | 每天約 | |
| --- | --- | --- | --- | --- |
| `pro30` | 30 | 149 | 4.97 | |
| `pro60` | 60 | 249 | 4.15 | 主推(`best: true`,畫面標「最划算」) |
| `pro90` | 90 | 449 | 4.99 | 誘餌:最貴、每天反而比 30 天貴 |

`test/plan.test.ts` 會檢查這個排序(60 天每天最便宜、90 天最貴且每天不比 30 天便宜、只有 60 天是 best);改價錢時排序跑掉測試會失敗。

### 1.2 權限

| 權限(`Entitlements`) | 免費 | 完整版 | 在哪裡擋 |
| --- | --- | --- | --- |
| `notes` 筆記數 | 3 | 不限 | `POST /api/properties`(數 `created_by` = 自己的) |
| `places` 我的地點 | 1 | 5 | `POST /api/places`;通勤三支 API 只用最早建的 N 個 |
| `compare` 比較表 | 2 | 4 | 只在前端(`compare.tsx`、`ComparePage`):用的資料本來就拿得到 |
| `commuteCustom` 下班、自訂時段、YouBike | 否(只算平日 08:00 上班、不含 YouBike) | 是 | `/api/commute`、`/commute/trips`、`/commute/grid`:時段不是預設回 402;YouBike 直接關掉 |
| `tour` 看房路線 | 否 | 是 | `POST /api/tour` |
| `fit` 需求與符合度 | 否 | 是 | `PUT /api/requirements`(讀照常) |
| `marketDetail` 成交明細 | 否 | 是 | `/api/market/at`、`/api/properties/:id/market`、`/api/market/sale/at`:`comparables` 清空、加 `detail_locked: true`;中位數與區間照給 |
| `costDetail` 每月支出明細 | 否(只看總額) | 是 | 只在前端(`cost.tsx`):每項都是前端用拿得到的資料算的 |

- 私人模式(`PRIVATE_POOL=1`,本機自用)回 `UNLIMITED`,什麼都不擋。
- 被擋的回應:HTTP **402** + `{ error: "plan_required", need, message }`(`src/worker/plan.ts` 的 `deny`)。前端用 `planError(e)` 取 message 顯示。
- 到期:每次請求用 `effectivePlan(plan, plan_until)` 判斷,過期就是免費,不需要排程。不認得的值(含早期的 `rent` / `buy`)都算免費。
- 降級後資料不刪:多的筆記照樣看得到、只是不能新增;多的地點留著,通勤只算最早建的那幾個。

### 1.3 新增一個付費功能的步驟

1. `src/shared/plan.ts` 的 `Entitlements` 加欄位,`FREE` / `PRO` 各給值(`UNLIMITED` 跟著 `PRO`)。
2. 伺服器:在對應 API 開頭 `if (!(await planOf(c)).ent.xxx) return deny(c, "xxx")`,`src/worker/plan.ts` 的 `MESSAGES` 加一句說明。
   **不要只在前端擋**,除非那個功能用的資料使用者本來就拿得到(像比較表、支出明細)。
3. 前端:`usePlan().ent.xxx` 決定顯示,鎖住的地方放 `<PlanLock>…</PlanLock>`(帶到帳號頁的方案區塊)。
4. 帳號頁 `features()` 加一行說明;`test/plan.test.ts` 加「免費 402、完整版 200」。

### 1.4 資料與開通

- `users.plan`(`free` | `pro`)、`users.plan_until`(ISO):只由開通 API 寫,沒有任何使用者 API 能改(測試有試過從前端改)。
- `plan_grants`:每次開通 / 取消一筆(`offer`、`days`、`price`、`ref`、`until_after`)。`ref` 唯一 → 同一筆訂單重送不會重複加天數。刪帳號時跟著刪(cascade)。
- migration:`0015_tiresome_vengeance.sql`。
- API(bearer `INGEST_SECRET`,`src/worker/routes/billing.ts`):
  - `POST /api/ingest/plan { email, offer, ref }`:還沒到期就從原本到期日往後加(`extendPlan`),否則從現在起算。
  - `POST /api/ingest/plan/revoke { ref }`:退款用,扣回那一筆的天數;記成 `revoke:<ref>`,重送不會扣兩次。
- CLI:`npm run collect -- grant <email> <pro30|pro60|pro90> <ref>`、`npm run collect -- revoke <ref>`(推到 `.env` 的 `RENTMAP_API`)。
- 綠界串好後:付款通知驗證成功 → 呼叫同一套開通邏輯(ref 用綠界的交易編號);退款 → revoke。

### 1.5 安全性

- 權限一律在伺服器檢查,前端的鎖只是顯示。
- `INGEST_SECRET` 現在等於「能幫任何人開通方案」,不要外流(`deploy-runbook.md` 已註明)。
- 2026-10-01 順便修掉:`POST /api/tour` 原本沒要求登入(而且很吃 CPU)。`test/plan.test.ts` 最後一段逐一打 26 支需要登入的 API,未登入都要 401;新增使用者 API 時把它加進那張表。
- 已知的小缺口:筆記上限是「先數再新增」,同時送兩個請求可能多存一間;影響小,沒有上鎖。

### 1.6 本機測公開模式

`.dev.vars` 暫時把 `PRIVATE_POOL=1` 改成 `0`,重開 dev,用「本機登入」就是免費版;測完改回來(改回前不要跑採集)。
開通自己:`npm run collect -- grant <DEV_USER_EMAIL> pro60 test-1`。

---

## 2. 公開的各區行情頁

- 路徑:`/area`(目錄)、`/area/<縣市>`(各區對照表)、`/area/<縣市>/<區>`(一個區)。不用登入,**Worker 直接輸出 HTML**(`src/worker/routes/area.ts`),不載 SPA;樣式是頁內的小段 CSS,跟著系統深淺色。
- 內容:租金(租賃實價登錄,依房型的中位數、多數區間、每坪、和全市比、筆數)、房價(買賣實價登錄,依建物型態的每坪中位數、總價、坪數 / 屋齡)、治安(竊盜件數與生活圈內排名,只有 `crimeDistricts` 有資料的縣市)。彙總是純函式 `src/shared/area.ts`。
- 樣本少於 5 筆不列;整區都沒資料的頁面標 `noindex`、不進 sitemap。只用公開資料的彙總,不碰任何人的筆記。
- 快取:Cache API,key 帶 `rent_stats` / `sale_stats` 的版本與治安檔的期間;瀏覽器端 `public, max-age=3600`。
- `wrangler.jsonc` 的 `assets.run_worker_first` 要有 `/area`、`/area/*`、`/sitemap.xml`,不然會被 SPA 的 index.html 接走。新增公開路徑一樣要加。
- 結構化資料:BreadcrumbList + WebPage(about 一個 Place)。網址用 `APP_ORIGIN`。
- 之後可加:淹水 / 液化(要把多邊形換算成「這區有多少比例在範圍內」,算法還沒定)、捷運站數。

---

## 3. SEO / AI 搜尋

| 項目 | 在哪 | 說明 |
| --- | --- | --- |
| 介紹頁、條款頁預先產 HTML | `scripts/prerender.mjs`(`npm run build` 最後一步) | Playwright 用「沒登入」的樣子開 `/` 與 `/legal/*`,把 `#root` 寫回 `dist/client`;不跑 JS 的爬蟲(多數 AI 搜尋)也讀得到。要有 Chromium(沙盒 `PW_CHROMIUM=…`;`SKIP_PRERENDER=1` 跳過) |
| 登入的人不閃介紹頁 | `index.html` 行內 script + `Layout.tsx` | localStorage `loka_in` 有值就先清空預先產生的內容(不用 cookie:隱私權政策只寫了 session cookie);沒有就設 `__PRERENDERED__`,等 `/api/me` 時照畫介紹頁 |
| canonical、og:url、og:image、JSON-LD(WebSite + WebApplication) | `index.html` | 正式網域 `lokanote.shunzz.com` 寫死在這裡與 prerender.mjs;換網域兩邊一起改 |
| 常見問題 | `AboutPage.tsx` 的 `FAQ` | 同一份資料出畫面與 FAQPage 結構化資料 |
| sitemap | `GET /sitemap.xml`(Worker) | 介紹頁、條款頁、`/area`、各縣市、有資料的區 |
| robots | `public/robots.txt` | 允許 `/`、`/about`、`/legal/`、`/area`;擋 `/api/`、`/p/`;AI 爬蟲目前都不擋(要擋訓練用的見檔內註解) |
| llms.txt | `public/llms.txt` | 給 AI 搜尋的網站說明與引用注意事項;新增公開頁要補 |

上線後:Google Search Console 與 Bing Webmaster Tools 驗證網域、提交 sitemap(ChatGPT 搜尋 / Copilot 用 Bing 的索引)。

---

## 4. 還沒做

- 綠界付款串接(建立訂單、付款通知驗證 → 開通、退款 → revoke)、帳號頁「申請退款」。
- 地址報告整理成「摘要 + 解鎖看完整」的版面(目前是各區塊分別上鎖)。
- 收費上線時,隱私權政策的資料類別加「方案與付款紀錄」並加版本號。
- 付費意願測試:付款頁先放「預購 / 留 email」。
- 各區行情頁加淹水 / 液化、捷運。
