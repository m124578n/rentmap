# 機車 / 開車的道路圖(路徑引擎)

日期:2026-10-01
狀態:已實作(本機),四個生活圈的道路圖已匯入本地 D1。
相關:方向文件 §9(「機車通勤要不要接路徑引擎」→ 使用者同意接)、`src/shared/drive.ts`(舊的直線估算,現在是備用)

## 為什麼

雙北以外大眾運輸稀疏,多數人騎機車;直線距離 × 1.3 在河、山、國道、單行道附近會錯很多(要繞橋、機車不能上國道)。
Worker 不抓外站(鐵則),所以不能呼叫 Google / OSRM 之類的導航服務;改成**本機從 OSM 建道路圖、推進 D1,Worker 自己算最短時間**。

## 資料流

```
data/osm/taiwan.osm.pbf(build_osm_pois.py 下載,Geofabrik,25 天內不重抓)
  → python scripts/build_roads.py        各生活圈:抽車道 → 收縮成「路口 → 路口」的有向邊 → data/roads/{region}.bin
  → npm run collect -- roads             base64 切約 900KB 一段 → POST /api/ingest/roads → /commit(段數齊才換版,舊版刪掉)
  → road_graphs 表(migration 0016)
  → Worker transit/roads.ts              整份載進記憶體(依 version 快取)、建反向圖與最近路口索引
  → GET /api/commute/drive?mode=…        所有房源 × 我的地點(列表、篩選、排序、上色、符合度、每月支出用;走 Cache API)
  → GET /api/commute/drive/at?lat&lng    面板查一個地址:機車與開車到每個地點
```

`npm run data:refresh` 的 roads 步驟(OSM 那條線,排在 pois 後面)會依序跑上面三步,每 30 天。

## 道路圖

- 道路:`highway` = motorway / trunk / primary / secondary / tertiary(含 `_link`)、unclassified、residential、living_street、road、service
  (停車場走道、車道出入口不算);`access = no / private` 不收。
- 機車不能走:motorway(國道)、`motorroad = yes`(快速道路)、`motorcycle = no`、`motor_vehicle = no`;`motorcycle = yes / designated` 例外可以。
- 汽車不能走:`motorcar = no`、`motor_vehicle = no`。
- 單行:`oneway = yes / -1`;motorway 與圓環預設單行。機車也照單行(實際上機車常逆向騎巷子,這裡不算)。
- 大小(2026-10-01):北區 23.2 萬路口 / 54 萬有向邊 / 6.6 MB;高雄 22.6 萬 / 56 萬 / 6.6 MB;台中、台南各約 11 萬 / 28 萬 / 3.3 MB。
- 格式見 `src/shared/roads.ts` 開頭;`build_roads.py` 與 `decodeRoads` 要一起改。

## 時間怎麼算

```
分鐘 = 牽車 / 停車(機車 4、開車 8;drive.ts 的 OVERHEAD)
     + 門口到最近路口的直線距離 ÷ 200 m/分(兩端都算)
     + 道路最短時間(Dijkstra)
道路時間 = Σ 路段長 ÷ 類別時速(shared/roads.ts 的 CLASS_KMH,中南部離峰、含紅綠燈的感覺)× 係數
係數 = 34(機車)或 36(開車)÷ drive.ts 的 SPEED[生活圈][尖峰 / 離峰]   ← 跟舊的直線估算同一套比例(北區、尖峰比較慢)
       國道與快速道路只乘係數的平方根(比較不受市區紅綠燈影響)
```

- 上班(dir = to):在**反向圖**上從地點出發,一次就得到「每個路口到地點」的時間,每間房只看自己最近的路口。
- 下班(dir = from):正向圖從地點出發。
- 面板查單一地址:中心放在那個地址,目標是各地點的路口,都定案就提早停。
- 最近的路口只找那個車種能進出的(機車不會被吸到國道上);1.5 km 內沒有路口回 null(山區、海上)。
- 沒有即時路況、轉向延遲、停等紅燈的細節;介面標「道路圖最短時間 … 不是導航」。

本機實測(平日 08:00 上班):台北車站 → 101 機車 19 分 / 7.0 km(舊直線估 20 分);中壢 → 101 開車 71 分 / 48 km(走國道);
鳳山 → 高雄三多 機車 19 分 / 5.7 km;永康 → 台南火車站 機車 18 分 / 6.2 km。北區 1,876 間房源 × 1 地點的矩陣 0.15 秒(之後走快取),單一地址 10–45 ms。

## 方案

跟大眾運輸同一套(`commuteGate`):免費版只算平日 08:00 上班、只用最早建的地點;下班或自訂時段 402。`test/plan.test.ts` 有測。

## 前端

- `useCommute`:通勤方式選機車 / 開車時查 `/api/commute/drive`;`has_roads = false`(還沒匯入道路圖)或查失敗才退回直線估(`driveBrief`)。
- 面板 `CommuteSection` 的 `DriveLine`:查 `/api/commute/drive/at`(同一個地址的各地點共用一次);沒有道路圖時顯示舊的「(估)」;跨生活圈(> 100 km)不顯示。

## 之後可以調的

- 各類道路時速與生活圈係數都是估的;有使用者回報實際通勤時間後再校正(`CLASS_KMH`、`SPEED`)。
- 機車逆向騎巷子、待轉、塞車熱點都沒算。
- 正式站:四個生活圈的道路圖約 20 MB(base64 後約 26 MB)存在 D1;每個生活圈第一次請求要載入與建索引(本機約 0.1 秒)。
