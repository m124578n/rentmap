# 開一個生活圈的步驟(台中 → 高雄 → 台南)

日期：2026-09-30
相關：`../business/2026-09-30-direction-notes-and-regions.md` §6 資料清單、§8 第 7 步

程式已經依生活圈分開：公車網路、捷運 / 台鐵圖、YouBike、生活機能網格都是「一個生活圈一份」放進 Worker 記憶體，
匯入時只覆蓋該生活圈（公車依縣市、生活機能依座標），所以先抓台中的資料不會清掉北區的。
下面是**在家那台**要做的事；資料齊了再把 `src/shared/regions.ts` 的 `enabled` 打開。

## 1. 資料（都可以在 `enabled: false` 時先抓）

一次抓齊:`npm run data:refresh -- --region=taichung`(下表各項的集合,有執行鎖與摘要;單項失敗可用 `--only=<項目>` 重跑)。

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

## 4. 2026-09-30 晚上在家抓資料的結果

一律用 `npm run data:refresh`(有執行鎖;單項 `--only=`;分區 `--region=`)。

| 資料 | 北北基桃 | 台中 | 高雄 | 台南 |
|---|---|---|---|---|
| 公車(路線方向 / 站 / 有時刻) | 3,396 / 121,127 / 2,399 | 755 / 37,124 / 694 | 617 / 19,253 / 360 ※ | 692 / 23,545 / 562 |
| 租賃實價登錄(近 4 季) | 91,987 | 21,745 | 21,821 | 13,077 |
| 淹水潛勢(6h150 + 24h500 多邊形) | 基隆 1,323、台北 2,926、新北 12,114、桃園 14,818 | 14,751 | 26,939 | 33,925 |
| YouBike 站 | 4,123(基隆沒有) | 1,834 | 1,512 | 784 |
| 捷運站間時間 | 已有 | 綠線 17 段 | 紅線 22、橘線 13、輕軌 | 沒有捷運 |
| 台鐵 | 76 站 | 開區後重跑 `collect -- tra` | 同左 | 同左 |
| 生活機能 / 嫌惡設施(OSM) | 等台灣檔下載完(見下) | 同左 | 同左 | 同左 |
| 垃圾車、治安點位、液化、航空噪音 | 只有雙北 | 沒有 | 沒有 | 沒有 |

※ 高雄的 TDX `Bus/Schedule` 是空的,班次在 `Bus/DailyTimeTable`,而且只有一天(2026-08-22,週六)。採集會自動改用它並當成每天適用
(`collector/bus/transform.ts` 的 `dailyToSchedules`),所以高雄平日的班次可能被低估,約四成路線沒有時刻(通勤引擎對沒有時刻的路線用預設班距)。

### 這一輪修掉 / 查清楚的事

- **Overpass 整晚連不上**(主站與鏡像都一樣)。改成下載 Geofabrik 的台灣 `.osm.pbf`(約 330 MB,`taiwan-latest` 別名會無限轉址,要抓帶日期的檔名)
  在本機抽:`scripts/build_osm_pois.py` 產出跟 Overpass 一樣格式的快取檔(`data/osm/`),`collect -- pois` 看到 30 天內的快取就不會打 Overpass。
  四個生活圈一次產好;`data:refresh` 的 pois 步驟會先跑它。
- **淹水潛勢的縣市代碼**(水利署 `207-{代碼}.7z`):01 基隆、02 台北、03 新北、04 桃園、07 台中、11 嘉義、12 台南、13 高雄、14 屏東。
  各縣市檔名與級距欄位都不同(六級含 0–0.3m、五級、只有文字區間),`build_hazards.py` 的 `flood_level` 統一成 1–5 級;台南沒有 `.prj`,當 TWD97。
- **災害多邊形七個縣市共 10.7 萬個**:API 改成一個生活圈載一份(`routes/hazards.ts` 的 `loadZones(DB, region)`),不然全部載進記憶體會逼近 Workers 上限。
- **實價登錄匯入**原本只收已開放的縣市,跟「開區前可以先抓」矛盾,已改成收所有列在 `regions.ts` 的縣市;房 / 廳 / 衛有離譜值(台中有 >50 衛)時當成沒填。
- **台中捷運站號**:TDX 是 G0 / G3 / G8a…,`mrt.json`(OSM)是 TG103A / TG103 / TG109…,改用站名對(`tmrtNameMap`)。
- **TDX 限速**:同一晚連抓幾個縣市很容易 429,`tdxGet` 與公車採集都改成 15、30、45… 秒退避。
- 採集不能同時開兩份(會互撞),`data:refresh` 有執行鎖。

### 開區前還差什麼

1. 生活機能匯入(等台灣檔);匯完後各縣市 `coverage` 補 `youbike`。
2. `npm run collect -- tra`(開區後的站才會進 `tra.json`)。
3. `regions.ts` 把該生活圈 `enabled: true`、`cities` 填上,`test/collector/regions.test.ts` 的開放清單跟著改。
4. 本機切到該生活圈逐項看過(§2 第 3 點);機車時速 `SPEED.*` 是估的。
5. 垃圾車、治安各縣市的來源還沒找,先標「此區沒有這項資料」。
