"""
六都 + 基隆的縣市界 → src/shared/city-bounds.json(regions.ts 的 cityAt / regionAt 用)。

來源:taiwan-atlas 的 counties-10t.json(內政部村里界圖合併而成,TopoJSON、已簡化;MIT)
  https://cdn.jsdelivr.net/npm/taiwan-atlas@2021.9.20/counties-10t.json
再四捨五入到小數 3 位(約 100m)、去掉連續重複點,只給「這個點在哪個縣市」用,不拿來畫圖。
用法:python scripts/build_city_bounds.py(會自己下載)
"""
import json, os, urllib.request

URL = "https://cdn.jsdelivr.net/npm/taiwan-atlas@2021.9.20/counties-10t.json"
OUT = os.path.join(os.path.dirname(__file__), "..", "src", "shared", "city-bounds.json")
WANT = {"台北市", "新北市", "桃園市", "基隆市", "台中市", "台南市", "高雄市"}
TOL = 0.0012  # Douglas-Peucker 容許誤差(度,約 120m)

topo = json.load(urllib.request.urlopen(URL))
sx, sy = topo["transform"]["scale"]
tx, ty = topo["transform"]["translate"]
arcs = []
for arc in topo["arcs"]:
    x = y = 0
    pts = []
    for dx, dy in arc:
        x += dx
        y += dy
        pts.append((x * sx + tx, y * sy + ty))
    arcs.append(pts)

def simplify(pts):
    """Douglas-Peucker(平面近似)"""
    if len(pts) < 3:
        return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]
    dx, dy = x2 - x1, y2 - y1
    L = (dx * dx + dy * dy) ** 0.5
    best, bi = -1.0, 0
    for i in range(1, len(pts) - 1):
        x, y = pts[i]
        d = abs(dy * x - dx * y + x2 * y1 - y2 * x1) / L if L else ((x - x1) ** 2 + (y - y1) ** 2) ** 0.5
        if d > best:
            best, bi = d, i
    if best <= TOL:
        return [pts[0], pts[-1]]
    return simplify(pts[: bi + 1])[:-1] + simplify(pts[bi:])

# 每條 arc 各自簡化(相鄰縣市共用 arc,邊界兩邊一致,不會出現縫隙或重疊)
arcs = [simplify(a) for a in arcs]

def ring(idx):
    out = []
    for i in idx:
        pts = arcs[i] if i >= 0 else arcs[~i][::-1]
        out.extend(pts if not out else pts[1:])
    r = []
    for lng, lat in out:
        p = [round(lng, 3), round(lat, 3)]
        if not r or r[-1] != p:
            r.append(p)
    return r

res = {}
for g in topo["objects"]["counties"]["geometries"]:
    name = g["properties"]["COUNTYNAME"].replace("臺", "台")
    if name not in WANT:
        continue
    polys = g["arcs"] if g["type"] == "MultiPolygon" else [g["arcs"]]
    res[name] = [[ring(r) for r in poly] for poly in polys if len(ring(poly[0])) >= 4]
    # 太小的離島(< 4 點)不要
json.dump(res, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print({k: sum(len(r) for p in v for r in p) for k, v in res.items()}, os.path.getsize(OUT), "bytes")
