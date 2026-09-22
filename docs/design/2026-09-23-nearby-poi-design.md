# 附近地點(生活機能)設計

日期：2026-09-23
狀態：設計，尚未實作（排在 M5 租金行情之後或之前，看需要）

## 需求

點地圖上某個點（房源標記，或地圖任意位置）→ 看到附近有什麼：餐飲、超商 / 超市 / 賣場、醫院 / 診所 / 藥局、公園、警察局、廟宇、學校、市場、郵局 / 銀行、健身房…。
延伸：**我的地點**（公司、爸媽家、常去的健身房）→ 每間房源顯示到這些地點的距離 / 通勤時間，可拿來篩選與比較。

## 資料來源：OpenStreetMap（Overpass），一次下載、放 D1

- 免金鑰、可商用（ODbL），雙北覆蓋率：超商 / 公園 / 廟宇 / 學校 / 醫療很完整，餐飲約七八成（連鎖與熱門店都有，小店缺）。
- 2026-09-23 實測數量（雙北 bbox 24.85,121.28 ～ 25.30,121.75）：

| 類別 | OSM tag | 數量 |
|---|---|---|
| 超商 | shop=convenience | 4,906 |
| 超市 | shop=supermarket / greengrocer | 1,078 |
| 賣場 | shop=department_store / mall | 未測（限速） |
| 餐飲 | amenity=restaurant / cafe / fast_food | 約 2 萬（查詢逾時） |
| 醫院 | amenity=hospital | 117 |
| 診所 | amenity=clinic / doctors / dentist | 2,042 |
| 藥局 | amenity=pharmacy | 未測 |
| 公園 | leisure=park / garden / playground | 5,441 |
| 警察局 | amenity=police | 未測 |
| 廟宇 / 教堂 | amenity=place_of_worship | 3,149 |
| 學校 | amenity=school / kindergarten / university | 1,249 |
| 市場 | amenity=marketplace | 272 |
| 郵局 / 銀行 | amenity=post_office / bank | 2,227 |
| 健身 | leisure=fitness_centre / sports_centre / swimming_pool | 未測 |

合計約 4 到 6 萬筆，D1 免費額度綽綽有餘。

- Overpass 公用伺服器對連續查詢會回 429 / 504，所以**不能即時查**，改成：家裡的採集機用 `scripts/fetch_pois.ts` 一類一類慢慢抓（每類之間歇 10 秒、失敗退避重試，同 menmap 的 `fetch_mrt.py`），推到 ingest，一個月更新一次就夠。
- 不用 Google Places（要金鑰、付費、條款不准存）；591 物件頁的「位置與周邊」只有該物件的幾筆，不能拿來查任意點。

## 餐飲要特別處理（使用者強調餐廳很重要）

OSM 的餐飲只有七八成，小店常缺，所以餐飲用三層疊起來：

| 層 | 來源 | 有什麼 | 成本 |
|---|---|---|---|
| 1. 基底 | OSM（同上） | 約 2 萬筆連鎖與熱門店，名稱、類型、部分營業時間 | 免費，一次下載 |
| 2. 精準 | **menmap 的拉麵店資料**（`menmap.shunzz.com/shops.json`，1,426 家，含 Google 評分、營業狀態、價位，每天更新） | 直接畫上地圖，點了可跳去麵咩撲 | 免費，現成 |
| 3. 完整 | **Google Maps 連結**：「在 Google Maps 看這附近的餐廳」，帶座標開 `https://www.google.com/maps/search/餐廳/@lat,lng,17z` | 全量、有評論，但不存資料 | 免費，零維護 |

之後若想要「收藏的房源附近有哪些餐廳、評分多少」存下來：只對收藏的房源（幾十間）用 menmap 的 `ramen` 採集後端搜 Google Maps「餐廳」關鍵字抓前 20 筆，資料量小、住宅 IP 抓得到。全雙北抓 Google Maps 不做（量太大、Google 條款不准存）。

面板的「餐飲」一列顯示：OSM 數量 + 拉麵店數量（有評分的用星號標）+ Google Maps 按鈕。

## 公車：重點是「住這裡可以搭哪幾路」

使用者要的不是站牌位置，是**路線**：站在這間房，走幾分鐘內有哪些路線可搭。所以路線資料一開始就要進來，站牌只是載體。

### 資料來源：交通部 TDX（免費，要註冊拿 client id / secret）

一次下載雙北全部路線與站牌，放 D1，一個月更新一次：
- `Bus/Stop/City/{Taipei|NewTaipei}`：站牌（StopUID、站名、經緯度）
- `Bus/StopOfRoute/City/{…}`：每條路線的站序（RouteUID、RouteName、方向、站牌清單）
雙北約 1,100 條路線、1.8 萬個站牌、站牌×路線約 5 萬列。

備案（不用金鑰）：data.taipei「公車站牌 / 路線站牌」CSV、data.ntpc.gov.tw 新北公車站牌；格式兩市不同，先用 TDX 一套解決。
OSM 的 `highway=bus_stop` 有站名但路線資料不全，只當備援。

### 資料模型

```
bus_stops        stop_uid, name, city, lat, lng            index (lat, lng)
bus_routes       route_uid, name(307|紅30|…), city, kind(一般|幹線|快速|…)
bus_stop_routes  stop_uid, route_uid, direction(0|1)      index (stop_uid)、index (route_uid)
```

### 查詢：`GET /api/nearby/bus?lat=&lng=&radius=400`
1. bbox 篩 `bus_stops`，算距離，留半徑內（預設 400m ≈ 步行 6 分）。
2. JOIN `bus_stop_routes`，彙整成兩種輸出：
   - **路線清單**（主角）：`[{route: "307", nearest_stop: "黎明社教中心", distance_m: 101, walk_min: 2}, …]`，同路線只留最近的站，依距離排序。
   - **站牌清單**：`[{stop, distance_m, routes: ["307","262"]}, …]`。
3. KV 快取 1 天（key 同 POI）。

### 介面
- 面板「公車」區塊：一排路線徽章（`307` `262` `紅30` `藍7`…），每個徽章下小字「黎明社教中心 · 2 分」；徽章數量多就顯示前 12 個加「還有 8 條」。點徽章 → 地圖上高亮那條路線經過的附近站牌（之後再畫整條路線幾何）。
- 站牌本身在地圖上用巴士圖示畫半徑內的。
- 篩選列：「有經過 〔307▾〕 的公車」多選；「我的地點」之後可做「有公車直達公司」（兩點附近路線交集）。
- 591 的「最近公車站」（`positionRound.data[traffic]`）順手存進 `raw_json.traffic` 當備援顯示，但主體是 TDX。

### 之後
- 到站時間（TDX `EstimatedTimeOfArrival`，即時）；路線幾何（TDX `Shape`）畫在地圖上。
- 「有公車直達公司」：房源 400m 內路線 ∩ 公司 400m 內路線，且方向對。

## 資料模型

```
pois            id, osm_id, osm_type(node|way|relation), category(超商|超市|餐飲|…), subtype(原 tag 值), name, lat, lng, address, opening_hours, updated_at
                index (category, lat, lng)、index (lat, lng)
my_places       id, user_id, name(公司|爸媽家|…), lat, lng, icon, transport(walk|transit|drive), created_at
```

面（公園、醫院是 way / relation）取中心點存成一個點即可。

## 查詢方式

**附近搜尋**：`GET /api/nearby?lat=&lng=&radius=800&cats=超商,公園`
1. D1 用 bounding box 先篩（`lat BETWEEN … AND lng BETWEEN …`，走 (lat, lng) 索引，半徑 800m 大約 ±0.0072 度），
2. Worker 端算 haversine 距離、過濾半徑、依類別分組、每類依距離排序取前 N 筆，
3. 回 `{ counts: {超商: 5, 公園: 2, …}, items: [{category, name, distance_m, walk_min, lat, lng}] }`。
   步行分鐘 = 距離 × 1.3 ÷ 80。

一次查詢讀幾百列（bbox 內的點），每天讀取量不成問題；再用 KV 以「四捨五入到 100m 的座標 + 半徑」當 key 快取 1 天。

**我的地點距離**：房源列表 API 回每間房源到每個 my_place 的直線距離（Worker 端算，my_places 只有幾筆）；篩選列可加「離公司 3 公里內」；比較表（M8）多一列「到公司」。之後要真實通勤時間再接路徑 API，先直線距離。

## 介面

- **房源面板**新增「生活機能」區塊：預設半徑 500m 的各類數量（超商 3 · 超市 1 · 診所 4 · 公園 2 · 廟 1），點某一類展開最近 5 筆與步行分鐘。可切 500m / 1km。
- **地圖右鍵 / 長按任意點**：出現「看附近」，同一個面板但標題是座標或地址（反查 Nominatim）。
- 展開某類時，該類的點畫在地圖上（小圓點 + 名稱，只畫半徑內），並畫一個半徑圈；關閉面板就清掉。
- **我的地點**：設定頁（或篩選列裡的「我的地點」）新增：在地圖上點一下或輸入地址，取名字、挑圖示。地圖常駐顯示這些點（不同形狀的標記），面板顯示「到 公司 2.4 km · 步行 39 分」。
- 篩選列：「離 〔公司▾〕 〔3 km▾〕 內」。

## 分階段

0. **公車路線**（優先）：註冊 TDX → `scripts/fetch_bus.ts` 下載雙北站牌與路線站序 → 三張表 + `/api/nearby/bus` → 面板路線徽章。約半天到一天。591 parser 順手存 `raw_json.traffic`。
1. **PoI 資料**：`scripts/fetch_pois.ts`（Overpass 分類分批抓 → `POST /api/ingest/pois` 覆蓋式更新）+ `pois` 表 + `/api/nearby`。約半天。
2. **面板生活機能區塊 + 地圖畫點**：約半天。
3. **我的地點**：表 + API + 地圖標記 + 面板距離 + 篩選。約半天。
4. 之後：通勤時間（路徑 API）、公園 / 醫院用多邊形算「最近邊界」而不是中心點、把「附近有什麼」餵進 AI 分析（M7）。

## 風險

- OSM 餐飲小店缺漏：介面上標明「資料來源 OpenStreetMap」，別讓使用者以為附近沒吃的。
- Overpass 抓全量一次要幾十分鐘且可能被限速：腳本要能斷點續抓（依類別記進度）。
- 名稱多語：OSM 的 `name` 在台灣多半是中文，缺的時候退回 `name:zh` / `name:en`。
