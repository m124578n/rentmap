"""
六都 + 基隆的行政區(鄉鎮市區)界 → src/shared/district-bounds.json(落腳圈把格子歸到哪個區用,shared/districts.ts)。

來源:taiwan-atlas 的 towns-10t.json(內政部村里界圖合併而成,TopoJSON、已簡化;MIT)
  https://cdn.jsdelivr.net/npm/taiwan-atlas@2021.9.20/towns-10t.json
跟 build_city_bounds.py 同一套做法:每條 arc 各自簡化(相鄰的區共用 arc,不會有縫或重疊)、四捨五入到小數 3 位(約 100m)。
只用來判斷「這個點在哪個區」,不拿來畫圖。區名用「台」不用「臺」,跟 regions.ts 的 districts 一致。
用法:python scripts/build_district_bounds.py(會自己下載)
"""
import json, os, urllib.request

URL = "https://cdn.jsdelivr.net/npm/taiwan-atlas@2021.9.20/towns-10t.json"
OUT = os.path.join(os.path.dirname(__file__), "..", "src", "shared", "district-bounds.json")
WANT = {"台北市", "新北市", "桃園市", "基隆市", "新竹市", "新竹縣", "台中市", "台南市", "高雄市"}
TOL = 0.0008  # Douglas-Peucker 容許誤差(度,約 80m)

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
for g in topo["objects"]["towns"]["geometries"]:
    city = g["properties"]["COUNTYNAME"].replace("臺", "台")
    if city not in WANT:
        continue
    town = g["properties"]["TOWNNAME"].replace("臺", "台")
    polys = g["arcs"] if g["type"] == "MultiPolygon" else [g["arcs"]]
    rings = [[ring(r) for r in poly] for poly in polys if len(ring(poly[0])) >= 4]
    if rings:
        res.setdefault(city, {})[town] = rings
json.dump(res, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print({k: len(v) for k, v in res.items()}, os.path.getsize(OUT), "bytes")
