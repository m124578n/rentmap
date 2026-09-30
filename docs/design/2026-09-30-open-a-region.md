# 開一個生活圈的步驟(台中 → 高雄 → 台南)

日期：2026-09-30
相關：`../business/2026-09-30-direction-notes-and-regions.md` §6 資料清單、§8 第 7 步

程式已經依生活圈分開：公車網路、捷運 / 台鐵圖、YouBike、生活機能網格都是「一個生活圈一份」放進 Worker 記憶體，
匯入時只覆蓋該生活圈（公車依縣市、生活機能依座標），所以先抓台中的資料不會清掉北區的。
下面是**在家那台**要做的事；資料齊了再把 `src/shared/regions.ts` 的 `enabled` 打開。

## 1. 資料（都可以在 `enabled: false` 時先抓）

| 項目 | 指令 | 備註 |
|---|---|---|
| 公車 | `npm run collect -- bus --region=taichung` | 只換台中的公車；TDX 金鑰必填 |
| 租賃實價登錄 | `npm run collect -- rent-stats --region=taichung` | 台中代碼 b、台南 d、高雄 e |
| 生活機能 / 嫌惡設施 | `npm run collect -- pois --region=taichung` | 垃圾車、YouBike、拉麵、治安點位是雙北專用來源，其他生活圈會跳過 |
| 台鐵 | `npm run collect -- tra`（開區後重跑一次） | tra.json 放所有已開放生活圈的站；**要 commit** |
| 捷運 / 輕軌 | 站已在 `public/mrt.json`(從 menmap 複製:台中綠線 TG、高雄紅橘線 KR / KO、輕軌 KC);官方站間時間跑 `npm run collect -- metro`(已含 KRTC、KLRT、TMRT) | 高雄、台中的 TDX 站號轉換(`collector/metro-transform.ts` 的 `tdxRef`)是推的,第一次跑完看 `mrt-times.json` 有沒有 KR / KC / TG 開頭的段 |
| YouBike | 跟生活機能一起:`pois --region=taichung --only=youbike` | 雙北用市府 API,其他縣市走 TDX `Bike/Station`(要金鑰);抓到後把該縣市的 `coverage` 加上 `youbike` |
| 淹水 | `scripts/build_hazards.py` 加縣市代碼 | 水利署圖資全國一致 |
| 垃圾車、治安、液化、航空噪音 | 各市各做，沒有就維持 `coverage: []` | 介面會標「此區沒有這項資料」 |

## 2. 開區

1. `src/shared/regions.ts`：`REGIONS.taichung` 的 `cities` 放 `["台中市"]`、`planned` 清空、`enabled: true`；有資料的項目加進 `CITY_INFO.台中市.coverage`。
2. `npm run check`、`npm test`（`test/collector/regions.test.ts` 的開放清單要跟著改）。
3. 本機開 dev，地圖左上會出現「找哪裡」切換；切到台中確認：地圖範圍、行政區選單、地址搜尋、通勤（公車 + 機車估）、行情、生活機能。
4. 機車時速：`src/shared/drive.ts` 的 `SPEED.taichung` 是估的，有實測再調。

## 3. 已知要先處理的

- ~~台南與高雄的外框重疊~~:已改用縣市界多邊形(`src/shared/city-bounds.json`,`cityAt`),茄萣、甲仙等都歸高雄。
- 台鐵班距已經每個生活圈各算一組(`tra.json` 的 `headways`)。
- 通勤引擎：Workers Paid 方案每次請求 CPU 上限較寬，但每個生活圈第一次請求都要載一次公車網路（約 1 秒）。
