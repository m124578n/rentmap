# rent-house(租屋筆記)

租屋 × 搬家決策平台。從「我想搬家」到「搬完家」的一站式工具。

- 設計文件:`docs/design/2026-09-20-architecture.md`
- 部署目標:Cloudflare Workers + D1 + R2(**尚未部署**,本機開發中)

## 本機開發

```sh
npm install
cp .dev.vars.example .dev.vars   # 本機留 DEV_USER_EMAIL 就能「本機登入」,不用 Google
cp .env.example .env             # 採集 CLI 用
npm run db:migrate:local         # 建本地 D1
npm run dev                      # http://localhost:5173
npm run collect -- add https://rent.591.com.tw/<id>   # 抓一筆 591 推進本地 D1
```

驗證:`npm run check`(型別)、`npm test`(Workers 環境整合測試)。

## 目前進度

- [x] M1 骨架:Vite + React + Hono + D1(Drizzle)、Google 登入、手動新增房源、列表、詳細頁、狀態切換
- [x] M2 地圖:MapLibre + CARTO 亮暗底圖、雙北捷運路線與站點、價格標記、點選摘要卡、主題切換
- [x] M3a 採集:591 parser + `collect add/list --pages` + `/api/ingest/listings`(探測:`docs/design/2026-09-20-collector-spike.md`);`scripts/collect-taipei.sh` 批次抓台北市三種房型
- [x] 篩選列(地圖 / 列表共用):房型、租金、行政區、房數、坪數、電梯 / 寵物 / 開伙、狀態
- [x] 點標記 → 左側詳細面板(照片、狀態、規格、聯絡、屋況介紹)
- [x] 每日 sync:`npm run collect -- sync`(`collector/searches.json` 雙北六組條件 + 重抓偵測下架 / 漲跌價);Windows 排程 `RentHouseDailySync` 每天 20:00(`scripts/register_task.ps1`)
- [x] 好房(hb):Playwright 抓列表(頁內 `PM(n)` 分頁)與物件頁,Nominatim 定位到路名;`collect add/list/sync` 自動依網址判斷來源
- [ ] M3b 貼 URL 佇列 + 採集機 watch;樂屋(Cloudflare 連人工驗證都擋,自動化放棄;將來只能走 bookmarklet)
- [ ] M4 收藏 Kanban、照片上傳 R2
- [ ] M5 實價登錄匯入、租金行情
- [ ] M6 需求設定與符合度
- [ ] M7 AI 分析
- [ ] M8 比較表
