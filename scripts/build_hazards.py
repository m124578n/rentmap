"""
災害潛勢圖資 → data/hazard/hazards.json(給 `npm run collect -- hazards` 推進 D1)。一次性,資料很少更新(淹水 2018、液化 2019)。

  pip install py7zr pyshp pyproj
  python scripts/build_hazards.py

來源:
  淹水潛勢(經濟部水利署第四代,data.gov.tw 25766):每縣市一個 7z,內含各降雨情境的 SHP。
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


def main():
    os.makedirs(DIR, exist_ok=True)
    zones = []
    scenarios = {"flood6": ("06h_r150", "6h150r"), "flood24": ("24h_r500", "24h500r")}
    for code, city in [("02", "台北市"), ("03", "新北市")]:
        arc = download(FLOOD.format(code), os.path.join(DIR, f"207-{code}.7z"))
        with py7zr.SevenZipFile(arc) as z:
            names = z.getnames()
            want = [n for n in names if re.search(r"(06h_r150|24h_r500|6h150r|24h500r)(_polygon_class_1)?\.(shp|dbf|shx|prj)$", n)]
            z.extract(path=os.path.join(DIR, "x"), targets=want)
        for kind, keys in scenarios.items():
            shp = next(os.path.join(DIR, "x", n) for n in want if n.endswith(".shp") and any(k in n for k in keys))
            r = shapefile.Reader(shp, encoding="big5")
            project = None if "GCS_WGS_1984" in open(shp[:-4] + ".prj").read() else (lambda x, y: twd97.transform(x, y))
            total = 0
            for rec, shape in zip(r.records(), r.shapes()):
                code_ = int(rec[0])
                # 新北市多一級 0–0.3m(幾乎全市),其餘往前對齊
                level = code_ - 1 if city == "新北市" else code_
                if level < 1:
                    continue
                total += emit(zones, kind, min(level, 5), city, parts_to_polygons(shape), project)
            print(f"{city} {kind}:{total} 個多邊形")
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
