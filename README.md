# rentmap(租屋筆記)

租屋 × 搬家決策平台。從「我想搬家」到「搬完家」的一站式工具。

- **產品方向(2026-09-30)**:`docs/business/2026-09-30-direction-notes-and-regions.md` — 找房筆記、不再每日抓 591、六都依生活圈分區
- 設計文件:`docs/design/2026-09-20-architecture.md`
- 部署目標:Cloudflare Workers + D1(**尚未部署**,本機開發中)。不存任何檔案,照片只留來源連結。

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
- [x] 每日 sync 分四組四個時段(`collector/searches.json` 的 groups;`scripts/register_task.ps1` 註冊 `RentmapSync-*`):20:00 591 台北、21:00 591 新北 + 重抓 80 筆(好房、23:00 重抓不排程,手動 `--group=housefun|recheck`);每組 5–15 分鐘
- [x] 好房(hb):Playwright 抓列表(頁內 `PM(n)` 分頁)與物件頁,Nominatim 定位到路名;`collect add/list/sync` 自動依網址判斷來源
- [ ] M3b 貼 URL 佇列 + 採集機 watch;樂屋(Cloudflare 連人工驗證都擋,自動化放棄;將來只能走 bookmarklet)
- [x] M4 收藏管理:收藏 / 取消、狀態、星等、標籤、私人備註;`/board` 看板拖曳換狀態;地圖未收藏灰色、必看金框;篩選「只看收藏」
- [x] 附近地點 / 生活機能 + 我的地點:`collect -- pois` 抓 OSM + 麵咩撲拉麵,面板「生活機能」列各類數量與最近幾個、地圖畫點,比較表並排(設計:`docs/design/2026-09-23-nearby-poi-design.md`)
- [x] 垃圾車(雙北環保局點位與時間)、嫌惡設施 / 噪音源(加油站、變電所、殯葬、垃圾場、墓地、夜市、快速道路與鐵道高架;面板「注意」列最近距離)、YouBike 站點(通勤可騎車接捷運);需求可設「垃圾車幾點以後」「N 公尺內不要有…」
- [x] 災害潛勢:水利署淹水潛勢(短時強降雨、颱風)+ 臺北市土壤液化;`python scripts/build_hazards.py` 轉檔、`collect -- hazards` 匯入,面板「災害風險」、比較表、需求「避開」
- [x] 航空噪音防制區(松山機場,雙北環保局依里公告):面板、比較表、需求「避開」
- [x] 地圖右鍵 / 長按任意一點「看附近」:通勤、生活機能、災害、公車、附近房源與租金中位數
- [x] 地圖「區域圖層」:通勤時間網格(最久那個地點)、每坪租金、淹水 / 液化 / 航空噪音多邊形;可隱藏房源標記
- [x] 地圖標記群集:縮小時一區合成「N 間 · 最低價」,收藏的與選中的永遠單獨顯示
- [x] 每月實際支出(估):房租 + 管理費 + 電費(台電累進或房東每度價)+ 水 + 網路 + 通勤票價(TPASS 封頂);面板、比較表、需求可設「預算比總支出」
- [x] 治安:臺北市竊盜點位(500m 內近 3 年)、雙北各區近一年件數與排名(`collect -- crime`)
- [x] 看房路線(`/tour`,看板有連結):挑幾間已約看的,排出交通最短的順序與每間幾點到
- [x] 資料狀態頁(`/status`):每份資料筆數、最後更新、過期就列出要跑的指令
- [x] 介紹頁(未登入的首頁)、手機介面(底部「更多」、地圖圖層收成一顆鈕、面板頂端固定價格與收藏)
- [x] 可安裝到手機主畫面、離線看收藏與上次的看房路線;基本 SEO(描述、分享圖、robots)
- [x] 效能:彙總 API 依資料版本快取、頁面拆檔(地圖引擎只在地圖頁載)、列表 ETag、採集寫入批次化
- [x] M5 實價登錄匯入、租金行情;面板另列「目前開價」(系統內刊登中的相似房源),標開價比成交高幾 %
- [x] M6 需求設定與符合度:頂欄「我的需求」設預算、房型、坪數、通勤上限、必要設備與權重;列表 / 面板 / 比較表標符合度,地圖可依符合度上色,篩選「符合需求」隱藏不符的
- [ ] M7 AI 分析
- [x] M8 比較表:列表 / 房源面板按「比較」選 2–4 間,`/compare` 並排比價格、行情、空間、設備、上下班通勤、筆記,每列標最好的
