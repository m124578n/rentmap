# 租屋 × 搬家決策平台 — 架構設計

日期：2026-09-20
狀態：草案，尚未部署（部署前需經明確同意）

---

## 0. 一句話定位

從「我想搬家」到「搬完家」的一站式決策工具。核心是三種資料：
**房源資料**（這間房是什麼）、**市場資料**（價格合理嗎）、**使用者實際經驗**（看過的人怎麼說），
再用行程管理、AI 分析、搬家服務把它們串成流程。

第一版只服務一個使用者：你自己這次搬家。做到哪裡就用到哪裡。

---

## 1. 技術選型（全部跑在 Cloudflare）

| 層 | 選擇 | 理由 |
|---|---|---|
| 執行環境 | **Cloudflare Workers**（單一 Worker + Static Assets） | Pages 已不建議新專案使用；一個 Worker 同時服務前端靜態檔與 API，最簡單 |
| 建置工具 | **Vite + `@cloudflare/vite-plugin`** | 一個 Vite 專案同時 build 前端 SPA 與 Worker，本機 `vite dev` 就有 D1/R2/KV 模擬 |
| 前端 | **React 19 + TypeScript + Tailwind + shadcn/ui** | CRM 類 UI（表格、表單、Kanban、對話框）元件最齊；`react-map-gl` 地圖整合成熟 |
| 路由 / 資料 | **TanStack Router + TanStack Query** | 型別安全路由；Query 處理快取與離線（看房時訊號差） |
| 地圖 | **MapLibre GL JS** + **CARTO** Positron / Dark Matter GL style | 與 menmap 相同：免金鑰、向量圖磚、亮暗兩套；沿用 menmap 的 `localizeBasemap`（地名強制中文、關掉聚落層）與 PWA 快取規則（CARTO 條款端側快取 ≤ 30 天） |
| API | **Hono** | Workers 上最輕量、型別友善；可用 RPC client 讓前後端共享型別 |
| 資料庫 | **D1**（SQLite） + **Drizzle ORM** | 免費額度充足（5 GB）；Drizzle 有 D1 migration 工具 |
| 快取 | **KV** | Geocoding 結果、URL 解析結果、AI 分析結果快取 |
| 檔案 | **不存任何檔案**（決定 2026-09-22） | 照片只存來源連結；看房紀錄只有文字、評分、checklist。不用 R2，省掉檔案管理 |
| 驗證 | **JSON Schema / Zod**（`shared/` 共用） | 前後端同一份 schema |
| AI 分析 | **Anthropic API**（`claude-sonnet-5`）| 結構化輸出 JSON（優點 / 缺點 / 價差原因）；金鑰放 Worker secret |
| 登入 | **Google OAuth**（比照 menmap：Worker 端 OAuth flow + HS256 JWT session cookie）| 一開始就是正式帳號系統，Phase 3 公開評論不用換；程式碼從 menmap 搬 |
| 資料採集 | **家裡這台 Windows 跑 Node + TypeScript**（`collector/`，與 Worker 共用 `src/shared` 的 Zod schema）| 591 純 fetch 就是完整 SSR，`__NUXT__` 用 `node:vm` 執行；好房之後用 Playwright；住宅 IP 不會被擋；家裡只做 outbound push。探測結果見 `2026-09-20-collector-spike.md` |
| 背景工作 | 採集排程在家裡（Task Scheduler）；雲端 Cron 只做輕量事（例如清過期快取） | Worker 不抓外站 |
| 測試 | **Vitest** + `@cloudflare/vitest-pool-workers`；E2E 用 Playwright | 可直接在 Workers runtime 跑測試 |

**不採用的東西**：Next.js（在 Workers 上 OpenNext 太重）、Google Maps / MapTiler（付費或要金鑰，CARTO 就夠）、Postgres（Hyperdrive 多一層，D1 對單人夠用）、Cloudflare Browser Rendering（資料中心 IP 會被擋，menmap 已驗證過）。

---

## 2. 系統架構

```
   [家裡 Windows（採集機）]                 [Cloudflare]                          [你]

  collector (Node + TypeScript)
    ├─ 591：fetch + node:vm 執行 __NUXT__；好房：Playwright（之後）
    └─ publish：POST /api/ingest/listings（bearer secret，outbound only）
                       │
                       ▼
          ┌──────────────────────────────────────────┐
          │  Google OAuth（/auth/*，session cookie）    │
          └────────────────────┬─────────────────────┘
                               ▼
          ┌──────────────────────────────────────────┐
          │  Worker: rentmap（Hono + Static Assets）    │
          │   /            → React SPA                │◀──── 瀏覽器 / 手機
          │   /api/*       → 業務 API                  │
          │   /api/ingest  → 採集機寫入（bearer，不走 session）│
          │   /api/ingest/pending → 採集機領取待抓 URL   │
          └──┬──────────┬──────────┬──────────────────┘
             ▼          ▼          ▼
           D1         R2         KV        外部：Anthropic API、Nominatim、CARTO tiles
         主資料     照片/錄音    快取
```

**兩條寫入路徑**：
- **採集機 → ingest**：房源本體（listing / property / 照片 URL / 價格快照）由家裡抓好再推上去。
- **你 → API**：收藏、狀態、聯絡紀錄、看房評價這些「人的資料」直接在網頁寫。

**貼 URL 的流程**：你在手機或電腦貼一個 591 網址 → 進 `pending_urls` 表 → 採集機每 N 分鐘 poll `/api/ingest/pending` 抓回來 → 推回 ingest → 網頁上出現房源。家裡不用開 port，手機也能用。

**單一 Worker、單一 repo**。前端與 API 同一個 Worker（不像 menmap 分 Pages + Worker），少一組路由設定。

## 3. 專案結構

```
rentmap/
├── docs/design/              設計文件
├── migrations/               D1 SQL migrations（Drizzle 產生）
├── collector/                家裡跑的採集（Node + TS，`npm run collect`）
│   ├── cli.ts                add <url> / list <listUrl>；之後加 watch / sync
│   ├── sources/five91.ts     591 parser（fetch + node:vm）；之後 housefun.ts
│   └── lib/http.ts           禮貌抓取：UA、隨機間隔、退避重試
├── data/                     探測輸出、logs/（gitignore）
├── scripts/                  一次性腳本：匯入實價登錄、run_daily.ps1、fetch_mrt.py（從 menmap 複製）
├── public/                   靜態資源（icon、manifest）
├── src/
│   ├── client/               React SPA
│   │   ├── routes/           TanStack Router 檔案式路由
│   │   ├── components/       UI 元件（shadcn 放 components/ui）
│   │   ├── features/         依功能切：map / listing / pipeline / market / visit / compare
│   │   ├── lib/              api client、hooks、utils
│   │   └── main.tsx
│   ├── worker/               Hono API
│   │   ├── index.ts          入口：Hono app + cron handler
│   │   ├── routes/           每個資源一檔：properties、listings、favorites、market、ai、visits…
│   │   ├── services/         純邏輯：ingest/（驗證與 upsert）、market/（行情計算）、ai/、planner/
│   │   ├── db/               Drizzle schema + queries
│   │   └── env.ts            Bindings 型別
│   └── shared/               前後端共用：Zod schema、型別、常數（行政區、設備 enum）
├── wrangler.jsonc
├── vite.config.ts
├── drizzle.config.ts
└── package.json
```

---

## 4. 資料模型（D1）

核心關係：一個 **Property**（實體物件）掛多個 **Listing**（各來源的刊登）。
Phase 1 就用這個結構，但去重演算法留到 Phase 3；Phase 1 每個 Listing 自動建一個 Property。

```
Property 1──n Listing 1──n ListingPriceHistory
   │
   ├──1 Favorite (pipeline 狀態)
   ├──n Contact / ContactLog
   ├──n Visit 1──n VisitChecklistItem
   │            └──1 VisitReview
   └──1 AiAnalysis (快取)

UserPrefs (單筆)
MrtStation (參考資料)
RentStat (實價登錄租賃，參考資料)
```

### 主要資料表

**properties**
`id, title, city, district, road, address_text, lat, lng, geocode_source, floor, total_floors, building_age, building_type, size_ping, rooms, living_rooms, bathrooms, has_elevator, has_parking, pet_allowed, cooking_allowed, has_washer, has_internet, furniture_json, mgmt_fee, utilities_note, nearest_mrt_id, mrt_walk_min, created_at, updated_at`

**listings**
`id, property_id, source (591|rakuya|hb|fb|agent|manual), source_url, source_listing_id, rent, deposit_months, raw_json, contact_name, contact_phone, contact_line, first_seen_at, last_seen_at, last_checked_at, status (active|removed|unknown), created_at`

**listing_price_history** — `listing_id, rent, seen_at`

**pending_urls** — `id, user_id, url, source, status (pending|fetching|done|failed), error, requested_at, done_at`（採集機 poll 用）

**users** — `id, google_sub, email, name, avatar, created_at`

**favorites** — `user_id, property_id (PK), stage, tags_json, priority, note, rank, updated_at`
stage enum：`saved → contacted → scheduled → visited → considering → finalist | rejected → signed`

**contacts** — `id, user_id, property_id, role (landlord|agent), name, phone, line_id, other`
**contact_logs** — `id, user_id, property_id, at, channel, question, reply, status`

**visits** — `id, user_id, property_id, scheduled_at, duration_min, status (planned|done|cancelled), route_batch_id`
**visit_checklist_items** — `visit_id, item_key, state (ok|bad|na|unchecked), note`
**visit_reviews** — `visit_id, ratings_json {light,noise,condition,transport,space}, pros_json, cons_json, text, visibility (private|anon|public), share_flags_json, created_at`

**ai_analyses** — `property_id, input_hash, result_json, model, created_at`

**user_prefs** — `user_id (PK), budget_min, budget_max, rooms_json, size_min, mrt_max_min, must_have_json, weights_json`

**mrt_stations** — `id, name, line, lat, lng`
**rent_stats** — 內政部租賃實價登錄：`id, city, district, road, building_type, size_ping, rooms, floor, total_floors, building_age, rent, rent_per_ping, date, has_elevator, has_mgmt, raw_json`

生活機能（設計見 `2026-09-23-nearby-poi-design.md`）：`pois`（OSM 一次下載，約 5 萬筆）、`my_places`（公司、家人住處等，算距離用）。

Phase 4 再加：`moves, move_items, movers, mover_quotes, move_checklist_items`。

---

## 5. 關鍵流程設計

### 5.1 房源匯入（家裡採集）

Worker 不抓外站。所有抓取都在家裡這台（住宅 IP）。591 純 fetch 即可（SSR），好房需要 Playwright，樂屋目前被 Cloudflare 擋。

**三種觸發**：
1. **貼 URL**（最常用）：網頁 / 手機貼 591、樂屋、好房網址 → `pending_urls` → 採集機 `watch` 模式每 5 分鐘 poll 一次，抓完推回。
2. **儲存搜尋條件**：在採集機設定幾組 591 搜尋 URL（例如「大安區 1–2 房 15k–22k」），每天排程跑一次 `sync`，新出現的房源自動進系統，已存在的更新價格與狀態（下架偵測）。
3. **手動表單**：FB 社團、路邊廣告直接填在網頁。

**採集端流程**：
```
URL → sources/<站>.ts 解析 → ImportedListing（src/shared 的 Zod schema）→ POST /api/ingest/listings
```
各站 parser 各自一檔，附 HTML fixture 測試（`test/collector/`），改版只修一檔。採集端與 ingest 端用同一份 Zod schema 驗證，不合格整筆退回。591 自帶座標，不需另外 geocoding。

**ingest 端點**：`POST /api/ingest/listings`（bearer secret，路由排除在 Access 之外），upsert `listings` + `properties`，價格有變就寫 `listing_price_history`。

### 5.2 Geocoding

591 物件頁自帶大概座標（`geocode_source = approx`）。手動表單的地址才需要 geocoding，在採集機用 Nominatim 做。網頁端保留「手動拖標記修正」，修正過（`manual`）的座標不會被採集覆蓋。
591 頁面通常只給「大概位置」，允許 `lat/lng` 帶 `geocode_source = approx|manual|exact`。

### 5.3 捷運距離

直接複製 menmap 的 `web/public/mrt.json`（OSM Overpass 產生，含雙北 / 台中 / 高雄站點、路線代碼與顏色、路線幾何），以及 `scripts/fetch_mrt.py` 供日後更新。Phase 1 用直線距離 × 1.3 ÷ 80 m/min 估步行分鐘。夠用來篩選與比較，Phase 2 再考慮真正的路徑 API。

### 5.4 租金合理性

兩個資料池，合併算統計：

- **rent_stats**：內政部租賃實價登錄（季度 CSV，用 script 匯入 D1）
- **listings**：系統內累積的房源（自己的資料護城河）

相似物件條件（可調）：同行政區、坪數 ±30%、房數相同、屋齡 ±10 年、電梯同值、近一年內。
輸出：`{ median, p25, p75, count, rent_per_ping_median, diff_pct, comparables[] }`。
樣本 < 5 時放寬條件並標示「樣本不足」。

### 5.5 需求符合度（🟢🟡🔴）

純前端計算，不打 API：每個維度給 0–1 分（價格、交通、坪數、屋況、設備），乘上使用者權重加總。
≥ 0.75 綠、≥ 0.5 黃、其餘紅。硬性條件（預算上限、必要設備）不符直接紅。

### 5.6 AI 分析

輸入：房源欄位 + 5.4 的行情結果 + 使用者需求。
Prompt 要求輸出固定 JSON：`{ pros[], cons[], price_diff_reasons[], notes }`。
明確禁止打分數、禁止「該不該租」的結論。以 `hash(輸入)` 為 key 快取在 `ai_analyses`，資料沒變就不重打。

### 5.7 看房行程（Phase 2）

輸入：日期、時段、選定房源、交通方式、每間停留分鐘、緩衝分鐘。
演算法：貪婪最近鄰 + 使用者手動拖曳調整；交通時間先用直線距離估（步行 80 m/min、大眾運輸 250 m/min、開車 400 m/min）。
路線最佳化（TSP 級）留 Phase 2 後段。

### 5.8 隱私

- 所有資料表凡是「人的資料」都帶 `user_id`；Phase 1 只有你一個帳號，但 schema 一開始就多人。
- 所有聯絡資訊、私人備註、看房日期永遠不公開。
- `visit_reviews.visibility` 預設 `private`；公開只揭露 `share_flags_json` 勾選的欄位。
- Phase 1–2 用 `ADMIN_EMAILS` 白名單，只有你的 Google 帳號能登入；開放註冊是 Phase 3 的事。

---

## 6. 開發階段與里程碑

每個里程碑結束都要是「你自己能用的東西」。

### Phase 1 — 自己搬家能用

| M | 內容 | 可用成果 |
|---|---|---|
| M1 | 專案骨架：Vite + React + Hono + D1 + Drizzle；手動新增房源表單；房源列表 | 能記錄房源 |
| M2 | 地圖：MapLibre、價格標記、點擊看摘要、Geocoding | 地圖上看房源 |
| M3 | collector：貼 URL → pending → 採集機抓 591 → ingest；`watch` 模式 | 一鍵存房源 |
| M4 | 收藏 / 狀態流程（Kanban）；房源詳細頁 | 找房 CRM |
| M5 | 實價登錄匯入；捷運站資料；租金行情卡 | 知道價格合不合理 |
| M6 | 需求設定 + 權重；地圖 🟢🟡🔴 | 篩掉不符合的 |
| M7 | AI 分析 | 看得懂的優缺點 |
| M8 | 比較表（2–4 間並排） | 做決定 |

### Phase 2 — 看房
聯絡紀錄 → 看房預約 → 行程規劃 → Checklist（PWA 離線）→ 照片 / 錄音 / 筆記 → 評價

### Phase 3 — 資料護城河
去重（同地址 + 坪數 + 樓層相似度）、價格歷史、掛網天數、公開看房情報、正式 auth

### Phase 4 — 搬家
搬家需求 → 搬家公司資料 → 估價 → 比價 → 搬家 Checklist

---

## 7. Cloudflare 資源規劃（尚未建立）

| 資源 | 名稱 | 用途 |
|---|---|---|
| Worker | `rentmap` | 前端 + API |
| D1 | `rentmap-db` | 主資料 |
| KV | `rentmap-cache` | Geocoding / AI / 匯入快取 |
| Secrets | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `ANTHROPIC_API_KEY`, `INGEST_SECRET` | 用 `wrangler secret put`；`INGEST_SECRET` 同一把放家裡 `.env`；Google OAuth 可與 menmap 同一組 client 只加 redirect URI |
| 家裡排程 | Task Scheduler，每日一次 `collector sync` + `publish` | 比照 menmap `run_daily.ps1` |

**規則：在你說「好」之前，不執行任何 `wrangler deploy`、`wrangler d1 create`、`wrangler r2 bucket create` 等會建立雲端資源的指令。** 本機開發全部用 `vite dev` 的本地模擬。

---

## 8. 已知風險與對策

| 風險 | 對策 |
|---|---|
| 591 反爬 / 改版 | 目前純 fetch 可行；parser 獨立檔案、有 fixture 測試，改版只修一檔；抓取 2.5–4 秒隨機間隔、429 退避 |
| 採集機關機 / 沒開 | 貼 URL 進 pending 佇列不會掉，開機後補抓；網頁顯示「等待採集」狀態 |
| Geocoding 不準 | 家裡用 Nominatim，允許網頁手動拖標記；記錄 `geocode_source` |
| 實價登錄資料格式變動 | 匯入 script 用 Zod 驗證，失敗整批不進 |
| D1 單筆查詢上限 / 無 PostGIS | 座標用 bounding box 索引查詢，量小夠用 |
| AI 產生不實資訊 | 只餵結構化資料，要求引用輸入欄位；輸出 JSON schema 驗證 |
| 看房現場沒網路 | Checklist 頁做 PWA + TanStack Query 離線佇列 |

---

## 9. 已定案（2026-09-20）

- 資料採集在家裡這台 Windows 跑，collector 用 Node + TypeScript（591 純 fetch 可行，探測見 `2026-09-20-collector-spike.md`）。
- 地圖底圖用 CARTO Positron / Dark Matter，沿用 menmap 的中文化與快取設定。
- 捷運站資料直接沿用 menmap 的 `mrt.json`。
- 前端 React + MapLibre，與 menmap 相同，地圖程式碼可搬。
- 登入用 Google OAuth，比照 menmap 實作；Phase 1 只有 `ADMIN_EMAILS` 白名單能登入。本機開發用 `DEV_USER_EMAIL` 免 Google。
- 不存任何檔案（照片、錄音）：照片只留來源連結，看房紀錄純文字（2026-09-22）。
- 目標範圍只有雙北（台北市、新北市）：實價登錄只匯入雙北，`mrt.json` 只取雙北路線，591 搜尋條件也只設雙北。
