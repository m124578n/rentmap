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
| 地圖 | **MapLibre GL JS** + MapTiler 或 OpenFreeMap 圖磚 | 免費、無 Google 綁定；向量圖磚適合上千個標記 |
| API | **Hono** | Workers 上最輕量、型別友善；可用 RPC client 讓前後端共享型別 |
| 資料庫 | **D1**（SQLite） + **Drizzle ORM** | 免費額度充足（5 GB）；Drizzle 有 D1 migration 工具 |
| 照片 / 錄音 | **R2** | 看房照片、錄音直傳；免出口流量費 |
| 快取 | **KV** | Geocoding 結果、URL 解析結果、AI 分析結果快取 |
| 驗證 | **JSON Schema / Zod**（`shared/` 共用） | 前後端同一份 schema |
| AI 分析 | **Anthropic API**（`claude-sonnet-5`）| 結構化輸出 JSON（優點 / 缺點 / 價差原因）；金鑰放 Worker secret |
| 登入 | **Phase 1–2：Cloudflare Access**（Zero Trust，50 人內免費）| 零程式碼，整站鎖住只有你能進；Phase 3 有公開評論再換成正式 auth |
| 背景工作 | **Cron Trigger**（每日重新確認房源是否下架）；**Queues** 之後再說 | Phase 1 不需要 Queues |
| 測試 | **Vitest** + `@cloudflare/vitest-pool-workers`；E2E 用 Playwright | 可直接在 Workers runtime 跑測試 |

**不採用的東西**：Next.js（在 Workers 上 OpenNext 太重）、Google Maps（付費 + 綁定）、Postgres（Hyperdrive 多一層，D1 對單人夠用）。

---

## 2. 系統架構

```
                ┌────────────────────────────────────────────┐
                │           Cloudflare Access (登入)          │
                └───────────────────┬────────────────────────┘
                                    │
                ┌───────────────────▼────────────────────────┐
                │      Worker: rent-house (Hono + Assets)     │
                │                                            │
   瀏覽器 ──────▶  /            → React SPA (static assets)   │
   Bookmarklet ─▶  /api/*       → Hono routes                 │
                │  cron daily   → 房源狀態重新確認             │
                └──┬─────────┬──────────┬──────────┬─────────┘
                   │         │          │          │
                ┌──▼──┐   ┌──▼──┐   ┌───▼───┐  ┌───▼──────────┐
                │ D1  │   │ R2  │   │  KV   │  │ 外部 API      │
                │主資料│   │照片 │   │快取   │  │ Anthropic     │
                └─────┘   └─────┘   └───────┘  │ Geocoding     │
                                               │ MapTiler tiles│
                                               └──────────────┘
```

**單一 Worker、單一 repo、單一 package**。Phase 1 不做 monorepo。

---

## 3. 專案結構

```
rent-house/
├── docs/design/              設計文件
├── migrations/               D1 SQL migrations（Drizzle 產生）
├── scripts/                  一次性腳本：匯入實價登錄、捷運站座標
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
│   │   ├── services/         純邏輯：import/（各來源 parser）、market/（行情計算）、ai/、planner/
│   │   ├── db/               Drizzle schema + queries
│   │   └── env.ts            Bindings 型別
│   └── shared/               前後端共用：Zod schema、型別、常數（行政區、設備 enum）
├── bookmarklet/              瀏覽器端抓取腳本（build 後產生一行 JS）
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
   ├──n Photo
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

**photos** — `id, property_id, visit_id?, r2_key, kind (listing|visit), caption, taken_at`

**favorites** — `property_id (PK), stage, tags_json, priority, note, rank, updated_at`
stage enum：`saved → contacted → scheduled → visited → considering → finalist | rejected → signed`

**contacts** — `id, property_id, role (landlord|agent), name, phone, line_id, other`
**contact_logs** — `id, property_id, at, channel, question, reply, status`

**visits** — `id, property_id, scheduled_at, duration_min, status (planned|done|cancelled), route_batch_id`
**visit_checklist_items** — `visit_id, item_key, state (ok|bad|na|unchecked), note`
**visit_reviews** — `visit_id, ratings_json {light,noise,condition,transport,space}, pros_json, cons_json, text, visibility (private|anon|public), share_flags_json, created_at`

**ai_analyses** — `property_id, input_hash, result_json, model, created_at`

**user_prefs** — `id=1, budget_min, budget_max, rooms_json, size_min, mrt_max_min, must_have_json, weights_json`

**mrt_stations** — `id, name, line, lat, lng`
**rent_stats** — 內政部租賃實價登錄：`id, city, district, road, building_type, size_ping, rooms, floor, total_floors, building_age, rent, rent_per_ping, date, has_elevator, has_mgmt, raw_json`

Phase 4 再加：`moves, move_items, movers, mover_quotes, move_checklist_items`。

---

## 5. 關鍵流程設計

### 5.1 房源匯入（URL → 房源）

591 有反爬與 JS 渲染，Worker 直接 fetch 常會失敗。策略分三層，全部落到同一個 `POST /api/import` 端點：

1. **Bookmarklet（主要方式）**：在 591 / 樂屋 / 好房頁面按一下書籤，在**你自己的瀏覽器**裡讀 DOM，整理成標準 JSON 後 POST 到 API。穩定、合法、不用管反爬。
2. **Worker 端 fetch**：貼 URL 進系統，Worker 嘗試抓 HTML 解析。成功就用，失敗提示改用 bookmarklet。
3. **手動表單**：FB 社團、路邊廣告等，直接填。

各來源 parser 放 `services/import/<source>.ts`，都輸出同一個 `ImportedListing` Zod schema，之後接 OCR 也走同一條路。

### 5.2 Geocoding

地址 → 座標。順序：KV 快取 → Nominatim（OSM，免費，含台灣地址）→ 手動在地圖上點位置修正。
591 頁面通常只給「大概位置」，允許 `lat/lng` 帶 `geocode_source = approx|manual|exact`。

### 5.3 捷運距離

Phase 1 用捷運站座標（政府開放資料）算直線距離 × 1.3 ÷ 80 m/min 估步行分鐘。夠用來篩選與比較，Phase 2 再考慮真正的路徑 API。

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

- 所有聯絡資訊、私人備註、看房日期永遠不公開。
- `visit_reviews.visibility` 預設 `private`；公開只揭露 `share_flags_json` 勾選的欄位。
- Phase 1–2 整站在 Access 後面，根本沒有其他使用者，隱私邏輯先做在資料層即可。

---

## 6. 開發階段與里程碑

每個里程碑結束都要是「你自己能用的東西」。

### Phase 1 — 自己搬家能用

| M | 內容 | 可用成果 |
|---|---|---|
| M1 | 專案骨架：Vite + React + Hono + D1 + Drizzle；手動新增房源表單；房源列表 | 能記錄房源 |
| M2 | 地圖：MapLibre、價格標記、點擊看摘要、Geocoding | 地圖上看房源 |
| M3 | Bookmarklet + URL 匯入（591 優先） | 一鍵存房源 |
| M4 | 收藏 / 狀態流程（Kanban）；房源詳細頁；照片上傳 R2 | 找房 CRM |
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
| Worker | `rent-house` | 前端 + API |
| D1 | `rent-house-db` | 主資料 |
| R2 | `rent-house-photos` | 照片、錄音 |
| KV | `rent-house-cache` | Geocoding / AI / 匯入快取 |
| Secrets | `ANTHROPIC_API_KEY`, `MAPTILER_API_KEY` | 用 `wrangler secret put` |
| Access | 一個 self-hosted app，只允許你的 email | 登入 |
| Cron | `0 3 * * *`（每日一次） | 重新確認房源狀態 |

**規則：在你說「好」之前，不執行任何 `wrangler deploy`、`wrangler d1 create`、`wrangler r2 bucket create` 等會建立雲端資源的指令。** 本機開發全部用 `vite dev` 的本地模擬。

---

## 8. 已知風險與對策

| 風險 | 對策 |
|---|---|
| 591 反爬 / 改版 | Bookmarklet 為主；parser 獨立檔案、有 fixture 測試，改版只修一檔 |
| Geocoding 不準 | 允許手動拖標記；記錄 `geocode_source` |
| 實價登錄資料格式變動 | 匯入 script 用 Zod 驗證，失敗整批不進 |
| D1 單筆查詢上限 / 無 PostGIS | 座標用 bounding box 索引查詢，量小夠用 |
| AI 產生不實資訊 | 只餵結構化資料，要求引用輸入欄位；輸出 JSON schema 驗證 |
| 看房現場沒網路 | Checklist 頁做 PWA + TanStack Query 離線佇列 |

---

## 9. 待你決定的事項

1. **前端框架**：React（本文預設）或 SvelteKit？兩者都能跑在同一個 Worker。
2. **地圖圖磚**：MapTiler（免費 10 萬次 / 月，要申請 key）或 OpenFreeMap（完全免費、無 key、無 SLA）？
3. **登入**：Phase 1 用 Cloudflare Access（推薦），還是一開始就做帳號系統？
4. **範圍**：目標城市只有台北 / 新北？影響捷運站資料與實價登錄匯入範圍。
5. **M1 之後**要不要就先直接用起來，邊用邊決定 M2–M8 的順序？
