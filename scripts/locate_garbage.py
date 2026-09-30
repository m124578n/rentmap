"""台中、高雄的垃圾車清運點定位:市府資料只有「區 + 里 + 地址 / 路口」,用台灣 OSM 檔裡的門牌與道路在本機對出座標。

為什麼可以:OSM 的台灣門牌是各市政府的門牌位置開放資料匯進去的(標籤有 addr:district / addr:street / addr:housenumber,
台中約 140 萬筆、高雄約 210 萬筆),所以「某區某路幾號」對得到就是準的。不呼叫任何外部定位服務
(Nominatim 查不到門牌;TGOS 要固定 IP 或網域才能申請;國土測繪中心地圖的搜尋 API 只給它自己的網站用,不要用)。

只收對得準的,對不到就不收(不猜約略位置):
  門牌     同區同街(含巷弄)同號;找不到那一號時用同街同側(單 / 雙號)相鄰的門牌(差 10 號以內,約 50 公尺內)
  路口     兩條路共用的節點(「中原街與中都街口」);同名路在市內有好幾處時用該區門牌的範圍挑
  巷口     那條巷跟母路共用的節點(「五甲二路610巷口」);OSM 沒畫那條巷就用巷內最小的門牌(10 號以內)

輸入:data/osm/taiwan.osm.pbf(scripts/build_osm_pois.py 會下載)、市府的清運點 JSON(下載後存 data/garbage/{city}-raw.json,30 天內不重抓)
輸出:data/garbage/{region}.json = 原始列 + lat / lng / how(只有定位到的列),給 `npm run collect -- pois --region=… --only=garbage` 匯入

    pip install osmium
    python scripts/locate_garbage.py                     # 台中 + 高雄
    python scripts/locate_garbage.py --region=taichung
    python scripts/locate_garbage.py --refresh           # 重新下載市府資料

平常不用直接跑:`npm run data:refresh` 的 pois 步驟會先跑這支。
"""

from __future__ import annotations

import collections
import json
import os
import re
import sys
import time
import urllib.request

import osmium

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR = os.path.join(ROOT, "data", "garbage")
PBF = os.path.join(ROOT, "data", "osm", "taiwan.osm.pbf")
RAW_MAX_AGE_DAYS = 30
UA = {"User-Agent": "rentmap/0.1 (personal rental notes)"}

# 兩市用同一套清運系統,欄位一樣(台中的時間欄位多一個 _time)
SOURCES = {
    "taichung": {
        "city": "台中市",
        # opendata.taichung.gov.tw「臺中市定時定點垃圾收運地點」
        "url": "https://newdatacenter.taichung.gov.tw/api/v1/no-auth/resource.download?rid=68d1a87f-7baa-4b50-8408-c36a3a7eda68",
        "rows": lambda d: d,
        "box": (120.46, 24.0, 121.46, 24.45),
    },
    "kaohsiung": {
        "city": "高雄市",
        # data.kcg.gov.tw「定時定點垃圾收運地點」
        "url": "https://data.kcg.gov.tw/Json/Get/1adb56ea-ee44-4bc2-b5ee-e236690e3f3c",
        "rows": lambda d: d["Data"],
        "box": (120.17, 22.47, 121.05, 23.47),
    },
}

FW = str.maketrans("０１２３４５６７８９－（）", "0123456789-()")
ZH = "零一二三四五六七八九十"
NEAR_NUMBERS = 10  # 找不到那一號時,同側相鄰門牌最多差幾號
LANE_MOUTH_MAX_NO = 10  # 巷口用巷內門牌代替時,最小門牌不能超過幾號


def norm(s) -> str:
    return (s or "").translate(FW).replace("臺", "台").replace(" ", "").replace("　", "")


def zh_section(s: str) -> str:
    """「2段」→「二段」(OSM 與門牌資料的段一律用國字)"""
    return re.sub(r"(\d)段", lambda m: ZH[int(m.group(1))] + "段", s)


def clean(caption: str) -> str:
    c = zh_section(norm(caption)).replace("巷-", "巷").replace("弄-", "弄")  # 台中的「115巷-1號」
    c = re.sub(r"[\(（﹝\[【].*?[\)）﹞\]】]", "", c)  # 括號裡是備註(定點、廟名、星期)
    c = re.sub(r"(號)(前|旁|邊|後|對面|斜對面|附近|門口|側)+.*$", r"\1", c)  # 「616號前」→「616號」
    c = re.sub(r"(口)號$", r"\1", c)  # 台中的「…巷口號」
    return c


RX_NO = re.compile(r"^(?P<street>.+?)(?P<no>\d+(?:之\d+|-\d+)?)號")
RX_CROSS = re.compile(r"^(?P<a>.+?(?:路|街|道|段|巷|弄))(?:\d+(?:之\d+|-\d+)?號)?(?:與|和|及|、|/)(?P<b>.+?(?:路|街|道|段|巷|弄))(?:\d+(?:之\d+|-\d+)?號)?(?:巷口|路口|街口|交叉路口|交叉口|口)?$")
# 兩條路名直接相連、沒有「與」:「慶雲街懷安街口」「大昌一路立志街168巷口」
RX_CROSS2 = re.compile(r"^(?P<a>.+?(?:路|街|道|段)(?:\d+巷)?)(?P<b>\D.*?(?:路|街|道|段)(?:\d+巷)?(?:\d+弄)?)(?:巷口|路口|街口|交叉口|口)$")
RX_LANE = re.compile(r"^(?P<road>.+?(?:路|街|道|段))(?P<lane>\d+巷)(?P<alley>\d+弄)?(?:巷口|弄口|口)?$")


def hn_norm(s: str) -> str:
    return norm(s).rstrip("號").replace("-", "之")


def parse(caption: str):
    """→ ("cross", a, b) / ("no", street, no) / ("lane", parent, child) / None"""
    p = parse_text(clean(caption))
    if p:
        return p
    # 本文是地標、括號裡才是地址:「民族市場(懷安街146號)」
    for inner in re.findall(r"[\(（]([^\)）]+)[\)）]", norm(caption)):
        p = parse_text(clean(inner))
        if p and p[0] == "no":
            return p
    return None


def parse_text(c: str):
    m = RX_CROSS.match(c)
    if m and m["a"] != m["b"]:
        return ("cross", m["a"], m["b"])
    m = RX_NO.match(c)
    if m and re.search(r"(路|街|道|段|巷|弄)$", m["street"]):
        return ("no", m["street"], hn_norm(m["no"]))
    m = RX_LANE.match(c)
    if m:
        lane = m["road"] + m["lane"]
        return ("lane", lane, lane + m["alley"]) if m["alley"] else ("lane", m["road"], lane)
    m = RX_CROSS2.match(c)
    if m and m["a"] != m["b"]:
        return ("cross", m["a"], m["b"])
    return None


def fetch_raw(region: str, refresh: bool) -> list[dict]:
    src = SOURCES[region]
    path = os.path.join(DIR, f"{region}-raw.json")
    fresh = os.path.exists(path) and time.time() - os.path.getmtime(path) < RAW_MAX_AGE_DAYS * 86400
    if not fresh or refresh:
        print(f"下載 {src['city']} 清運點 …")
        try:
            raw = urllib.request.urlopen(urllib.request.Request(src["url"], headers=UA), timeout=300).read()
            rows = src["rows"](json.loads(raw.decode("utf-8-sig")))
            if len(rows) < 1000:
                raise ValueError(f"只有 {len(rows)} 列")
            with open(path, "wb") as f:
                f.write(raw)
        except Exception as e:  # 下載失敗就用上次那份
            if not os.path.exists(path):
                raise SystemExit(f"{src['city']} 清運點下載失敗,也沒有存檔:{e}")
            print(f"  下載失敗({str(e)[:100]}),用上次存的那份")
    return src["rows"](json.load(open(path, encoding="utf-8-sig")))


def has_garbage(r: dict) -> bool:
    return any(r.get(f"g_d{i}_s") or r.get(f"g_d{i}_time_s") for i in range(1, 8))


def main() -> None:
    args = sys.argv[1:]
    only = next((a[9:] for a in args if a.startswith("--region=")), None)
    regions = [only] if only else list(SOURCES)
    regions = [r for r in regions if r in SOURCES]
    if not regions:
        print("這個生活圈的垃圾車不需要定位(只有台中、高雄要)")
        return
    if not os.path.exists(PBF):
        raise SystemExit("沒有 data/osm/taiwan.osm.pbf:先跑 python scripts/build_osm_pois.py")
    os.makedirs(DIR, exist_ok=True)
    t0 = time.time()

    raw = {r: [x for x in fetch_raw(r, "--refresh" in args) if has_garbage(x)] for r in regions}
    city_region = {SOURCES[r]["city"]: r for r in regions}
    parsed = {r: [parse(x.get("caption", "")) for x in raw[r]] for r in regions}
    # 只留用得到的街名(門牌索引全留要好幾 GB)
    need_streets = {r: collections.defaultdict(set) for r in regions}  # region → district → {street}
    need_roads = {r: set() for r in regions}
    for r in regions:
        for x, p in zip(raw[r], parsed[r]):
            if not p:
                continue
            d = norm(x.get("area"))
            if p[0] == "no":
                need_streets[r][d].add(p[1])
            elif p[0] == "lane":
                need_roads[r].update(p[1:])
                need_streets[r][d].add(p[2])
            else:
                need_roads[r].update(p[1:])

    plates = {r: collections.defaultdict(dict) for r in regions}  # region → (district, street) → {no: (lat, lon)}
    dist_box = {r: {} for r in regions}  # region → district → [s, w, n, e](門牌的範圍)
    roads = {r: collections.defaultdict(list) for r in regions}  # region → name → [[(node id, lat, lon)]]

    def add_plate(tags, lat, lon):
        r = city_region.get(norm(tags.get("addr:city")))
        if not r:
            return
        d = norm(tags.get("addr:district"))
        b = dist_box[r].get(d)
        if b is None:
            dist_box[r][d] = [lat, lon, lat, lon]
        else:
            b[0], b[1], b[2], b[3] = min(b[0], lat), min(b[1], lon), max(b[2], lat), max(b[3], lon)
        st = zh_section(norm(tags.get("addr:street")))
        if st in need_streets[r].get(d, ()):
            plates[r][(d, st)][hn_norm(tags.get("addr:housenumber"))] = (lat, lon)

    def region_at(lat, lon):
        for r in regions:
            w, s, e, n = SOURCES[r]["box"]
            if s <= lat <= n and w <= lon <= e:
                return r
        return None

    fp = osmium.FileProcessor(PBF, osmium.osm.NODE | osmium.osm.WAY).with_locations().with_filter(osmium.filter.KeyFilter("highway", "addr:housenumber"))
    for o in fp:
        if o.is_node():
            if "addr:housenumber" in o.tags and o.location.valid():
                add_plate(o.tags, o.location.lat, o.location.lon)
            continue
        pts = [(n.ref, n.location.lat, n.location.lon) for n in o.nodes if n.location.valid()]
        if not pts:
            continue
        if "addr:housenumber" in o.tags:
            add_plate(o.tags, sum(p[1] for p in pts) / len(pts), sum(p[2] for p in pts) / len(pts))
        name = zh_section(norm(o.tags.get("name")))
        if "highway" in o.tags and name:
            r = region_at(pts[len(pts) // 2][1], pts[len(pts) // 2][2])
            if r and name in need_roads[r]:
                roads[r][name].append(pts)
    print(f"OSM 索引:門牌街段 { {r: len(v) for r, v in plates.items()} }、道路 { {r: len(v) for r, v in roads.items()} }({time.time() - t0:.0f}s)")

    def in_district(r, d, lat, lon, pad=0.004):
        b = dist_box[r].get(d)
        return b is not None and b[0] - pad <= lat <= b[2] + pad and b[1] - pad <= lon <= b[3] + pad

    def crossing(r, d, a, b):
        """兩條路共用的節點(限這個區);散在好幾處(> 150m)就不算"""
        na = {nid: (lat, lon) for way in roads[r].get(a, []) for nid, lat, lon in way}
        xs = [na[nid] for way in roads[r].get(b, []) for nid, _, _ in way if nid in na]
        xs = [x for x in xs if in_district(r, d, *x)]
        if not xs:
            return None
        lat = sum(x[0] for x in xs) / len(xs)
        lon = sum(x[1] for x in xs) / len(xs)
        if max(abs(x[0] - lat) * 110540 + abs(x[1] - lon) * 101000 for x in xs) > 150:
            return None
        return lat, lon

    def plate(r, d, street, no):
        idx = plates[r].get((d, street))
        if not idx:
            return None
        if no in idx:
            return idx[no], "門牌"
        base = no.split("之")[0]
        if base in idx:
            return idx[base], "門牌"
        if not base.isdigit():
            return None
        n = int(base)
        for step in range(2, NEAR_NUMBERS + 1, 2):  # 同側(單 / 雙號)由近到遠
            for cand in (n - step, n + step):
                if str(cand) in idx:
                    return idx[str(cand)], "相鄰門牌"
        return None

    def locate(r, d, p):
        if p[0] == "no":
            return plate(r, d, p[1], p[2])
        if p[0] == "cross":
            x = crossing(r, d, p[1], p[2])
            return (x, "路口") if x else None
        x = crossing(r, d, p[1], p[2])
        if x:
            return x, "巷口"
        idx = plates[r].get((d, p[2]))
        nums = sorted(int(k) for k in (idx or {}) if k.isdigit())
        if nums and nums[0] <= LANE_MOUTH_MAX_NO:
            return idx[str(nums[0])], "巷口(巷內第一戶)"
        return None

    if "--check" in args:
        # 拿對得到的門牌測「相鄰門牌」:假裝那一號不存在,看替代的門牌離真正的位置多遠
        for r in regions:
            ds = []
            for (d, st), idx in plates[r].items():
                for no, (lat, lon) in list(idx.items())[:40]:
                    if not no.isdigit():
                        continue
                    n = int(no)
                    for step in range(2, NEAR_NUMBERS + 1, 2):
                        c = next((idx[str(k)] for k in (n - step, n + step) if str(k) in idx), None)
                        if c:
                            ds.append(abs(c[0] - lat) * 110540 + abs(c[1] - lon) * 101000)
                            break
            ds.sort()
            if ds:
                print(f"{SOURCES[r]['city']} 相鄰門牌替代的誤差({len(ds)} 個樣本):中位數 {ds[len(ds) // 2]:.0f}m、九成內 {ds[int(len(ds) * 0.9)]:.0f}m、九成九內 {ds[int(len(ds) * 0.99)]:.0f}m")

    for r in regions:
        out = []
        how = collections.Counter()
        miss = collections.Counter()
        miss_samples = collections.defaultdict(list)
        for x, p in zip(raw[r], parsed[r]):
            hit = locate(r, norm(x.get("area")), p) if p else None
            if not hit:
                kind = "寫法看不懂" if not p else {"no": "門牌對不到", "cross": "路口對不到", "lane": "巷口對不到"}[p[0]]
                miss[kind] += 1
                if len(miss_samples[kind]) < 5:
                    miss_samples[kind].append(f"{x.get('area')}{x.get('caption')}")
                continue
            (lat, lon), h = hit
            how[h] += 1
            out.append({**x, "lat": round(lat, 6), "lng": round(lon, 6), "how": h})
        total = len(raw[r])
        path = os.path.join(DIR, f"{r}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"city": SOURCES[r]["city"], "total": total, "located": len(out), "rows": out}, f, ensure_ascii=False)
        print(f"\n{SOURCES[r]['city']}:{total} 列(有收一般垃圾)→ 定位到 {len(out)}({len(out) * 100 / total:.1f}%)→ {os.path.relpath(path, ROOT)}")
        print("  方法:", "、".join(f"{k} {v}" for k, v in how.most_common()))
        for k, v in miss.most_common():
            print(f"  沒定位:{k} {v}({v * 100 / total:.1f}%)例:{miss_samples[k][:4]}")
    print(f"\n總時間 {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
