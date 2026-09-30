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
| 捷運 / 輕軌 | 從 menmap 的 `fetch_mrt.py` 輸出挑台中綠線、高雄紅橘線與輕軌，併進 `public/mrt.json` | 站的 `refs` 要有編號（G0、R10…）才連得起來；`mrt-times.json` 沒有的段落用距離估 |
| YouBike | 還沒有來源（雙北用市府 API） | TDX `Bike/Station/City/{City}` 可補；沒有時介面會標「無資料」 |
| 淹水 | `scripts/build_hazards.py` 加縣市代碼 | 水利署圖資全國一致 |
| 垃圾車、治安、液化、航空噪音 | 各市各做，沒有就維持 `coverage: []` | 介面會標「此區沒有這項資料」 |

## 2. 開區

1. `src/shared/regions.ts`：`REGIONS.taichung` 的 `cities` 放 `["台中市"]`、`planned` 清空、`enabled: true`；有資料的項目加進 `CITY_INFO.台中市.coverage`。
2. `npm run check`、`npm test`（`test/collector/regions.test.ts` 的開放清單要跟著改）。
3. 本機開 dev，地圖左上會出現「找哪裡」切換；切到台中確認：地圖範圍、行政區選單、地址搜尋、通勤（公車 + 機車估）、行情、生活機能。
4. 機車時速：`src/shared/drive.ts` 的 `SPEED.taichung` 是估的，有實測再調。

## 3. 已知要先處理的

- **台南與高雄的外框重疊**（高雄市北邊的茄萣、湖內、甲仙在台南外框內）：`regionAt` 目前用縣市外框判斷，開台南或高雄前要改成行政區界（內政部鄉鎮市區界 SHP）或至少把重疊區域的判斷改成「離哪個市中心近」。台中與北區沒有這個問題。
- 台鐵班距目前全部生活圈共用第一個的值；中南部區間車班次較少，開區時改成每個生活圈各自一組。
- 通勤引擎：Workers Paid 方案每次請求 CPU 上限較寬，但每個生活圈第一次請求都要載一次公車網路（約 1 秒）。
