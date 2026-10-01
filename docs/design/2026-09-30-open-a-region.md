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
3. 本機開 dev，先跑 `node scripts/verify-regions.mjs taichung`（切到該生活圈、右鍵市中心出報告、截圖到 `data/verify-*.png`、列出頁面錯誤與面板文字）；再自己看一遍：地圖左上會出現「找哪裡」切換；切到台中確認：地圖範圍、行政區選單、地址搜尋、通勤（公車 + 機車估）、行情、生活機能。
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
| 買賣實價登錄(近 4 季;2026-10-01 雲端加的買房行情) | 四區共 154,833 筆 | | | |
| 淹水潛勢(6h150 + 24h500 多邊形) | 基隆 1,323、台北 2,926、新北 12,114、桃園 14,818 | 14,751 | 26,939 | 33,925 |
| YouBike 站 | 4,123(基隆沒有) | 1,834 | 1,512 | 784 |
| 捷運站間時間 | 已有 | 綠線 17 段 | 紅線 22、橘線 13、輕軌 | 沒有捷運 |
| 台鐵(四區共 151 站) | 已有 | 已有 | 已有 | 已有 |
| 生活機能 / 嫌惡設施(OSM 元素) | 63,896 | 19,998 | 24,372 | 11,714 |
| 拉麵(menmap) | 643 | 276 | 163 | 0 |
| 垃圾車清運點 | 雙北 30,573 | 18,980(定位到 94.7%,見下) | 17,055(定位到 87.8%) | 14,190 |
| 土壤液化潛勢 | 台北市 136 | 沒有向量檔(見下) | 沒有向量檔 | 446(地調中心初級圖) |
| 治安點位、航空噪音 | 只有雙北 | 沒有 | 沒有 | 沒有 |
| 治安各區件數 | 雙北 | 程式好了,等內政部主機(見下) | 同左 | 同左 |

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

### 開區的狀況

**三個生活圈都已在 2026-09-30 晚上打開**(`regions.ts` 的 `enabled: true`;只想先開一區就把那一行改回去)。做過的:

1. 生活機能四區都匯入了(離線抽取,見上);各縣市 `coverage` 的 `youbike`、`garbage`、台南的 `liquefaction` 已補。
2. `collect -- tra` 重跑,`tra.json` 從 76 站變 151 站,四區各有班距。
3. 本機逐區驗證:切生活圈 → 地圖範圍對、右鍵市中心出報告(行情、公車、生活機能、垃圾車、YouBike、災害)沒有錯誤;
   通勤各區抽查 3–4 組起訖點(台中市政府、高雄三多、台南火車站、桃園火車站)都有合理方案。

還沒做:

- 機車時速 `SPEED.*` 是估的,沒有實測。
- 治安各區件數(雙北以外):程式好了,等內政部主機,見下一節。
- 桃園、基隆的垃圾車;雙北、台南以外的液化;雙北以外的治安點位、航空噪音 → 沒有來源,介面標「沒有資料」。

### 垃圾車與治安:各縣市來源查的結果

| 縣市 | 垃圾車清運點 | 狀況 |
|---|---|---|
| 台南 | data.tainan.gov.tw「臺南市垃圾清運點資料」(API `soa.tainan.gov.tw/Api/Service/Get/84df8cd6-…`) | **有座標**,14,190 點、370 條路線,已接(`collect -- pois --region=tainan --only=garbage`)。API 很不穩(常等 100 秒回 `success: false`),採集會重試 3 次並存一份在 `data/garbage/tainan.json`,都失敗就用存檔 |
| 台中 | opendata.taichung.gov.tw「臺中市定時定點垃圾收運地點」(20,040 列有收一般垃圾) | 市府資料只有區、里、地址,**沒有座標** → 用 OSM 門牌定位,定位到 18,983 列(94.7%),已接 |
| 高雄 | data.kcg.gov.tw「定時定點垃圾收運地點」(19,447 列,`/Json/Get/1adb56ea-…`) | 跟台中同一套系統、同樣欄位,地點有門牌也有路口 → 同樣的做法,定位到 17,081 列(87.8%),已接 |
| 桃園 | 原本的「垃圾車清運點資訊」在新版平台(opendata.tycg.gov.tw)已下架 | 只剩查詢網站 route.tyoem.gov.tw,沒有開放資料 |
| 基隆 | 沒找到 | — |

**台中、高雄的定位(`scripts/locate_garbage.py`)**:一開始以為 OSM 沒有門牌(因為 Nominatim 查不到),實際看台灣檔才發現
各市政府的門牌位置開放資料已經匯進 OSM(標籤 `addr:district / addr:street / addr:housenumber`,帶 `addr:TW:dataset` 資料集編號;
台中約 140 萬筆、高雄約 210 萬筆)。所以直接在本機對,不呼叫任何外部服務,**只收對得準的**:

| 方法 | 台中 | 高雄 | 說明 |
|---|---|---|---|
| 門牌 | 18,016 | 11,468 | 同區、同街(含巷弄)、同號 |
| 相鄰門牌 | 926 | 549 | 那一號不在資料裡時,用同街同側差 10 號以內的門牌;拿已知門牌回測,誤差中位數 7 公尺、九成在 32 公尺內 |
| 路口 | 24 | 2,613 | 兩條路共用的節點,限該區 |
| 巷口 | 17 | 2,451 | 巷跟母路共用的節點;OSM 沒畫那條巷就用巷內 10 號以內的第一戶 |
| 沒定位 | 1,057(5.3%) | 2,366(12.2%) | 門牌不在資料裡、寫法是地標(「○○公園旁」)、路口在 OSM 沒接起來 → 不收,不猜約略位置 |

對照:先前向測繪中心地圖查過的兩個門牌,座標完全一樣(同一份政府門牌資料)。介面在這兩個城市的生活機能區塊下面註明「約一成對不到、沒列出」
(`regions.ts` 的 `PARTIAL_GARBAGE`)。每月更新時 `data:refresh` 的 pois 步驟會先跑定位。

其他定位方式的結論(留著備查):

- **TGOS 門牌定位(內政部)**:申請要固定 IP 或網域,家裡這台是浮動 IP,現在申請不了;上面的做法夠用,部署後若要補那一成再說。
- **不要用國土測繪中心地圖的搜尋 API(`api.nlsc.gov.tw/MapSearch/QuerySearch`)**:它只在請求帶 `Referer: https://maps.nlsc.gov.tw/` 時才回資料
  (不帶就回 null),也就是只給測繪中心自己的網站用。要批次用就得偽造來源繞過這個限制,跟當初不抓 591 是同一種風險,所以沒有接。

土壤液化:地調中心的全國初級圖(1:25,000)現在只給 WMTS 圖磚(`liquid.net.tw`),舊的向量 API(geologycloud `…/liquefaction?area=`)已經 404。
只有台南市府開放平台另外放了一份 SHP(Web Mercator、沒有 `.prj`),已接進 `build_hazards.py`(`liquefaction_tainan`)。
新北、桃園、台中、高雄要等地調中心重新開放向量檔,或各市工務局自己釋出。

治安:

- **各區件數(全國)**:警政署「犯罪資料」(data.gov.tw 14200)每季一個 CSV(`type, oc_year, oc_data, oc_county, oc_region`),全國都有、到 115 年第 2 季。
  `collect -- crime` 已經會抓最近四季,把雙北以外的縣市(桃園、基隆、台中、台南、高雄)各區件數寫進 `public/crime-districts.json`
  (`periods` 記各縣市的統計期間;雙北維持原本的來源)。**2026-09-30 晚上下載主機 `opdadm.moi.gov.tw` 連不上**,所以還沒實際跑過:
  主機恢復後跑 `npm run collect -- crime --limit=0`(只更新各區件數,不重算點位),看一下各區數字合理,再把這些縣市的 `coverage` 加上 `crimeDistricts`、commit 那個 JSON。
  解析是照欄位說明寫的(測試用假資料),第一次跑要對一下真實檔案的編碼與寫法。
- **點位**:只有台北市有持續更新的點位資料;台中的「住宅竊盜資訊」停在 2016–2019,不用。
