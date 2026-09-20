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
- [ ] M2 地圖(MapLibre + CARTO)
- [x] M3a 採集:591 parser + `collect add/list` + `/api/ingest/listings`(探測:`docs/design/2026-09-20-collector-spike.md`)
- [ ] M3b 貼 URL 佇列 + 採集機 watch;列表分頁 + 每日 sync;好房
- [ ] M4 收藏 Kanban、照片上傳 R2
- [ ] M5 實價登錄匯入、租金行情
- [ ] M6 需求設定與符合度
- [ ] M7 AI 分析
- [ ] M8 比較表
