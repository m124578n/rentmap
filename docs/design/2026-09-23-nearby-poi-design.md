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

1. **PoI 資料**：`scripts/fetch_pois.ts`（Overpass 分類分批抓 → `POST /api/ingest/pois` 覆蓋式更新）+ `pois` 表 + `/api/nearby`。約半天。
2. **面板生活機能區塊 + 地圖畫點**：約半天。
3. **我的地點**：表 + API + 地圖標記 + 面板距離 + 篩選。約半天。
4. 之後：通勤時間（路徑 API）、公園 / 醫院用多邊形算「最近邊界」而不是中心點、把「附近有什麼」餵進 AI 分析（M7）。

## 風險

- OSM 餐飲小店缺漏：介面上標明「資料來源 OpenStreetMap」，別讓使用者以為附近沒吃的。
- Overpass 抓全量一次要幾十分鐘且可能被限速：腳本要能斷點續抓（依類別記進度）。
- 名稱多語：OSM 的 `name` 在台灣多半是中文，缺的時候退回 `name:zh` / `name:en`。
