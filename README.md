# rent-house(租屋筆記)

租屋 × 搬家決策平台。從「我想搬家」到「搬完家」的一站式工具。

- 設計文件:`docs/design/2026-09-20-architecture.md`
- 部署目標:Cloudflare Workers + D1 + R2(**尚未部署**,本機開發中)

## 本機開發

```sh
npm install
cp .dev.vars.example .dev.vars   # 填 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET(與 menmap 同一組)
npm run db:migrate:local         # 建本地 D1
npm run dev                      # http://localhost:5173
```

驗證:`npm run check`(型別)、`npm test`(Workers 環境整合測試)。

## 目前進度

- [x] M1 骨架:Vite + React + Hono + D1(Drizzle)、Google 登入、手動新增房源、列表、詳細頁、狀態切換
- [ ] M2 地圖(MapLibre + CARTO)
- [ ] M3 採集機:貼 URL → pending → 抓 591 → ingest
- [ ] M4 收藏 Kanban、照片上傳 R2
- [ ] M5 實價登錄匯入、租金行情
- [ ] M6 需求設定與符合度
- [ ] M7 AI 分析
- [ ] M8 比較表
