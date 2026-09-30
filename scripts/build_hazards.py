"""
災害潛勢圖資 → data/hazard/hazards.json(給 `npm run collect -- hazards` 推進 D1)。一次性,資料很少更新(淹水 2018、液化 2019)。

  pip install py7zr pyshp pyproj
  python scripts/build_hazards.py

來源:
  淹水潛勢(經濟部水利署第四代,data.gov.tw 25766):每縣市一個 7z,內含各降雨情境的 SHP。
    目前收七個縣市:基隆、台北、新北、桃園、台中、台南、高雄(FLOOD_CITIES;各縣市檔名與級距欄位不同,見 flood_level)。
    取兩種情境:6 小時 150 毫米(短時強降雨,最常見)、24 小時 500 毫米(颱風等級)。
    台北市 WGS84、GRIDCODE 1–5 = 0.3–0.5 / 0.5–1 / 1–2 / 2–3 / >3 公尺;
    新北市 TWD97 TM2、GRIDCODE 1–6 = 0–0.3 / 0.3–0.5 / …(0–0.3 幾乎整個新北都是,不收)→ 統一成 1–5 級。
  土壤液化潛勢(臺北市工務局,data.taipei):GeoJSON WGS84,class 1 高 / 2 中 / 3 低 → 存成 level 3 / 2 / 1(越大越嚴重)。
    新北市沒有可下載的開放資料(只有查詢網站),先不收。
  航空噪音防制區(松山機場;新北林口下福里是桃園機場):環保局是「依里公告」級別,不是等噪音線,
    所以用里界多邊形(臺北市民政局、新北市民政局的里界 SHP,TWD97 TM2)對上公告的里名。
    臺北市:data.taipei CSV(Big5)行政區 / 級別 / 里;新北市:公告全文 CSV,從「(一)級別:第N級」與「N、XX區:甲里、乙里…」解析。
    第一級 Ldn 60–65 dB、第二級 65–75、第三級 75 以上 → level 1 / 2 / 3。

輸出:{ "zones": [{ "kind": "flood6|flood24|liquefaction", "level": 1-5, "city": "...", "rings": [[[lng, lat], ...], ...] }] }
  每個多邊形一筆(第一個 ring 是外框、其餘是洞);Douglas-Peucker 簡化 5 公尺、面積 < 200 m² 的碎塊丟掉。
"""
import csv
import io
import json
import math
import os
import re
import sys
import urllib.request
import zipfile

import py7zr
import shapefile
from pyproj import Transformer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR = os.path.join(ROOT, "data", "hazard")
FLOOD = "https://opendata.wra.gov.tw/cloud/25766InundationProbabilityMaps/207-{}.7z"
LIQ_TPE = "https://soil.taipei/Taipei2019/Main/pages/TPLiquid_84.GeoJSON"
NOISE_TPE = "https://data.taipei/api/dataset/23563182-fcc6-463e-8830-68be687b7f66/resource/7ec3c2bc-983b-4db6-881b-ae1e22ea8fc7/download"
NOISE_NTPC = "https://data.ntpc.gov.tw/api/datasets/ccfa18a7-b045-49cf-8940-0e5f80a9f1a3/csv/file"
VILLAGE_TPE = "https://data.taipei/api/dataset/6b17b31d-4e16-495e-95b1-9fd1f47c80d8/resource/145e30da-58f3-45db-a125-8adc3fde2620/download"
VILLAGE_NTPC = "https://data.ntpc.gov.tw/api/datasets/8bbd1aca-752c-4df0-b515-1cfd88b36274/csv/zip"
SIMPLIFY_M = 5
MIN_AREA_M2 = 200

twd97 = Transformer.from_crs("EPSG:3826", "EPSG:4326", always_xy=True)


def download(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 1000:
        return path
    print("下載", url)
    tmp = path + ".part"
    req = urllib.request.Request(url, headers={"User-Agent": "rentmap/0.1"})
    with urllib.request.urlopen(req, timeout=900) as r, open(tmp, "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    os.replace(tmp, path)
    return path


def to_m(lat0):
    kx = 111320 * math.cos(math.radians(lat0))
    return kx, 110540


def simplify(ring, kx, ky, tol):
    """Douglas-Peucker(公尺)"""
    if len(ring) <= 4:
        return ring
    pts = [(x * kx, y * ky) for x, y in ring]
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a]
        bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        l2 = dx * dx + dy * dy
        best, idx = 0.0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            t = 0 if l2 == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / l2))
            d = math.hypot(px - (ax + t * dx), py - (ay + t * dy))
            if d > best:
                best, idx = d, i
        if idx >= 0 and best > tol:
            keep[idx] = True
            stack += [(a, idx), (idx, b)]
    out = [p for p, k in zip(ring, keep) if k]
    return out if len(out) >= 4 else ring


def area_m2(ring, kx, ky):
    s = 0.0
    for i in range(len(ring)):
        x1, y1 = ring[i - 1]
        x2, y2 = ring[i]
        s += (x1 * kx) * (y2 * ky) - (x2 * kx) * (y1 * ky)
    return abs(s) / 2


def parts_to_polygons(shape):
    """SHP 的 parts:順時針是外框、逆時針是洞(ESRI 慣例)"""
    pts = shape.points
    idx = list(shape.parts) + [len(pts)]
    polys = []
    for a, b in zip(idx, idx[1:]):
        ring = pts[a:b]
        signed = sum(ring[i - 1][0] * ring[i][1] - ring[i][0] * ring[i - 1][1] for i in range(len(ring)))
        if signed < 0 or not polys:  # 順時針(或第一個)= 外框
            polys.append([ring])
        else:
            polys[-1].append(ring)
    return polys


def emit(zones, kind, level, city, polys, project=None):
    n = 0
    for poly in polys:
        rings = []
        for ring in poly:
            if project:
                ring = [project(x, y) for x, y in ring]
            kx, ky = to_m(ring[0][1])
            if area_m2(ring, kx, ky) < MIN_AREA_M2:
                if not rings:
                    break  # 外框太小整個不要
                continue
            ring = simplify(ring, kx, ky, SIMPLIFY_M)
            rings.append([[round(x, 6), round(y, 6)] for x, y in ring])
        if rings:
            zones.append({"kind": kind, "level": level, "city": city, "rings": rings})
            n += 1
    return n


LEVEL_ZH = {"一": 1, "二": 2, "三": 3}


def airnoise_villages():
    """{(城市, 區, 里): 級別}"""
    out = {}
    raw = open(download(NOISE_TPE, os.path.join(DIR, "tp_airnoise.csv")), "rb").read().decode("big5", errors="replace")
    for row in csv.reader(io.StringIO(raw)):
        if len(row) < 5 or not row[0].strip().isdigit():
            continue
        m = re.search(r"第([一二三])級", row[3])
        if m:
            out[("台北市", row[2].strip(), row[4].strip())] = LEVEL_ZH[m.group(1)]
    text = open(download(NOISE_NTPC, os.path.join(DIR, "ntpc_airnoise.csv")), encoding="utf-8-sig").read()
    level = None
    for line in text.splitlines():
        m = re.search(r"級別[:：]第([一二三])級", line)
        if m:
            level = LEVEL_ZH[m.group(1)]
            continue
        m = re.search(r"範圍[:：]\s*(\S+?區)[^\s,]*?((?:\S+?里[、,，\s]*)+)", line) or re.search(r"\d+、(\S+?區)[:：](.+)", line)
        if m and level:
            district = m.group(1)
            for v in re.findall(r"([^\s、,，:：]+?里)", m.group(2).split("等")[0]):
                out[("新北市", district, v)] = level
    return out


def village_shapes(url, path, city):
    """里界 SHP(zip 內)→ [(區, 里, shape)]"""
    z = zipfile.ZipFile(download(url, path))
    base = next(n for n in z.namelist() if n.lower().endswith(".shp"))[:-4]
    r = shapefile.Reader(shp=io.BytesIO(z.read(base + ".shp")), dbf=io.BytesIO(z.read(base + ".dbf")), shx=io.BytesIO(z.read(base + ".shx")), encoding="utf-8")
    names = [f[0] for f in r.fields[1:]]
    di, vi = (names.index("TNAME"), names.index("VNAME")) if city == "台北市" else (names.index("ADMIT"), names.index("ADMIV"))
    return [(rec[di].strip(), rec[vi].strip(), shp) for rec, shp in zip(r.records(), r.shapes())]


def airnoise(zones):
    want = airnoise_villages()
    hit = set()
    for city, url, fn in [("台北市", VILLAGE_TPE, "tp_village.zip"), ("新北市", VILLAGE_NTPC, "ntpc_village.zip")]:
        n = 0
        for district, village, shape in village_shapes(url, os.path.join(DIR, fn), city):
            level = want.get((city, district, village))
            if not level:
                continue
            hit.add((city, district, village))
            n += emit(zones, "airnoise", level, city, parts_to_polygons(shape), lambda x, y: twd97.transform(x, y))
        print(f"{city} airnoise:{n} 個多邊形")
    miss = sorted(set(want) - hit)
    if miss:
        print("航空噪音:這些里在里界圖找不到(里界調整過?)", miss)


# 淹水潛勢:水利署每縣市一個 7z(207-{代碼}.7z)。代碼 2026-09-30 逐一下載確認過。
FLOOD_CITIES = [("01", "基隆市"), ("02", "台北市"), ("03", "新北市"), ("04", "桃園市"), ("07", "台中市"), ("12", "台南市"), ("13", "高雄市")]
# 各縣市檔名不一:tp_06h_r150_polygon_class_1、6h150r、ty_06h_150mm、6Hr150r、6h150…
FLOOD_FILE = {"flood6": re.compile(r"(?<!\d)0?6hr?_?r?_?150", re.I), "flood24": re.compile(r"24hr?_?r?_?500", re.I)}
DEPTH_LEVEL = {0.0: 0, 0.3: 1, 0.5: 2, 1.0: 3, 2.0: 4, 3.0: 5}


def flood_level(rec, n_classes):
    """一筆紀錄 → 1–5 級(0.3–0.5 / 0.5–1 / 1–2 / 2–3 / >3 公尺);0–0.3 公尺回 0(不收)。
    各縣市格式:深度區間文字('0.3-0.5'、'>3'、'0.3公尺>淹水深度>0.5公尺'、'淹水深度>3.0公尺'),或只有 GRIDCODE。"""
    for v in rec:
        if not isinstance(v, str):
            continue
        t = v.replace(" ", "").replace("m", "").replace("M", "")
        m = re.fullmatch(r"(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)", t) or re.match(r"(\d+(?:\.\d+)?)公尺>淹水深度>", t)
        if m and float(m.group(1)) in DEPTH_LEVEL:
            return DEPTH_LEVEL[float(m.group(1))]
        if re.fullmatch(r">3(?:\.0)?", t) or re.match(r"淹水深度>3", t):
            return 5
    code = next((int(v) for v in rec if isinstance(v, (int, float)) and 1 <= v <= 6), None)
    if code is None:
        raise ValueError(f"看不懂的淹水級距:{list(rec)}")
    # 只有 GRIDCODE:六級的第一級是 0–0.3(幾乎全市,不收),五級的從 0.3 起
    return code - 1 if n_classes >= 6 else code


def flood(zones, only):
    for code, city in FLOOD_CITIES:
        if only and city not in only:
            continue
        arc = download(FLOOD.format(code), os.path.join(DIR, f"207-{code}.7z"))
        with py7zr.SevenZipFile(arc) as z:
            names = z.getnames()
            picked = {}
            for kind, rx in FLOOD_FILE.items():
                shps = [n for n in names if n.lower().endswith(".shp") and rx.search(os.path.basename(n))]
                if len(shps) != 1:
                    raise SystemExit(f"{city} {kind}:預期 1 個 SHP,找到 {shps}")
                picked[kind] = shps[0]
            want = [n for n in names if any(n[:-4] == s[:-4] for s in picked.values()) and n[-4:].lower() in (".shp", ".dbf", ".shx", ".prj")]
            # 壓縮檔裡的檔案帶唯讀屬性:重跑時覆寫會 PermissionError,先把舊的解除唯讀並刪掉
            for n in want:
                old = os.path.join(DIR, "x", n)
                if os.path.exists(old):
                    os.chmod(old, 0o666)
                    os.remove(old)
            z.extract(path=os.path.join(DIR, "x"), targets=want)
        for kind, name in picked.items():
            shp = os.path.join(DIR, "x", name)
            # 台南的壓縮檔沒有附 .prj:沒有就當 TWD97 TM2(除了台北市,其他縣市都是)
            prj = open(shp[:-4] + ".prj").read() if os.path.exists(shp[:-4] + ".prj") else ""
            project = None if "GCS_WGS_1984" in prj else (lambda x, y: twd97.transform(x, y))
            total = 0
            with shapefile.Reader(shp, encoding="big5") as r:
                recs = r.records()
                n_classes = len(recs)
                for rec, shape in zip(recs, r.shapes()):
                    level = flood_level(rec, n_classes)
                    if level < 1:
                        continue
                    total += emit(zones, kind, min(level, 5), city, parts_to_polygons(shape), project)
            print(f"{city} {kind}:{total} 個多邊形")


def main():
    os.makedirs(DIR, exist_ok=True)
    zones = []
    # --cities=台中市,高雄市 只重建某些縣市的淹水(其餘照舊全部);液化、航空噪音目前只有雙北來源
    only = next((a[9:].split(",") for a in sys.argv[1:] if a.startswith("--cities=")), None)
    flood(zones, only)
    liq = json.loads(open(download(LIQ_TPE, os.path.join(DIR, "tp_liquefaction.geojson")), encoding="utf-8-sig").read())
    total = 0
    for f in liq["features"]:
        level = {"1": 3, "2": 2, "3": 1}[str(f["properties"]["class"])]
        g = f["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        total += emit(zones, "liquefaction", level, "台北市", polys)
    print(f"台北市 liquefaction:{total} 個多邊形")
    airnoise(zones)
    out = os.path.join(DIR, "hazards.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump({"zones": zones}, fh, ensure_ascii=False, separators=(",", ":"))
    pts = sum(len(r) for z in zones for r in z["rings"])
    print(f"寫入 {out}:{len(zones)} 個多邊形、{pts} 個頂點、{os.path.getsize(out) // 1024} KB")


if __name__ == "__main__":
    sys.exit(main())
