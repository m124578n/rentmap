"""機車 / 開車的道路圖:從台灣 OSM 檔(data/osm/taiwan.osm.pbf)抽出各生活圈的車道,收縮成「路口 → 路口」的邊,存成二進位給 Worker 算最短時間。

    pip install osmium
    python scripts/build_roads.py                    # 四個生活圈
    python scripts/build_roads.py --region=north

輸出 data/roads/{region}.bin(格式見 src/shared/roads.ts 的 decodeRoads;改格式兩邊一起改),再 `npm run collect -- roads` 推進 D1。
平常不用直接跑:`npm run data:refresh` 的 roads 步驟會先跑這支(台灣檔由 build_osm_pois.py 下載,25 天內不重抓)。

規則:
  道路:highway = motorway / trunk / primary / secondary / tertiary(含 _link)、unclassified、residential、living_street、road、
        service(停車場走道、車道出入口不算);access = no / private 不收。
  機車不能走:motorway(國道)、motorroad = yes(快速道路)、motorcycle = no / motor_vehicle = no;但 motorcycle = yes / designated 可以。
  汽車不能走:motorcar = no / motor_vehicle = no。
  單行:oneway = yes / -1;motorway 與圓環預設單行(oneway = no 例外)。機車也照單行。
  收縮:每條 way 只在「路口」(被兩條以上 way 用到、或 way 的端點)切開;一段太長(> 60 km)中間補切,長度用 Uint16 公尺存得下。
"""

from __future__ import annotations

import array
import math
import os
import struct
import sys
import time

import osmium

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PBF = os.path.join(ROOT, "data", "osm", "taiwan.osm.pbf")
OUT = os.path.join(ROOT, "data", "roads")
# 跟 src/shared/regions.ts 的生活圈外框一致([w, s, e, n],已開放縣市 bbox 的聯集)
REGIONS = {
    "north": (120.98, 24.58, 122.01, 25.3),
    "taichung": (120.46, 24.0, 121.46, 24.45),
    "tainan": (120.02, 22.88, 120.66, 23.42),
    "kaohsiung": (120.17, 22.47, 121.05, 23.47),
}
# 類別代碼(低 4 位元);順序要跟 src/shared/roads.ts 的 ROAD_CLASSES 一樣
CLASSES = ["motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link", "unclassified", "residential", "living_street", "service", "road"]
CLS = {c: i for i, c in enumerate(CLASSES)}
NO_SCOOTER = 16
NO_CAR = 32
MAX_EDGE_M = 60000
MAGIC = b"RDG1"


def flags_of(tags) -> int | None:
    h = tags.get("highway")
    if h not in CLS:
        return None
    if h == "service" and tags.get("service") in ("parking_aisle", "driveway", "drive-through", "emergency_access"):
        return None
    if tags.get("access") in ("no", "private"):
        return None
    f = CLS[h]
    mc = tags.get("motorcycle")
    mv = tags.get("motor_vehicle")
    scooter_no = h in ("motorway", "motorway_link") or tags.get("motorroad") == "yes" or mc == "no" or mv in ("no", "private")
    if mc in ("yes", "designated", "permissive"):
        scooter_no = False
    car_no = tags.get("motorcar") == "no" or mv in ("no", "private")
    if scooter_no and car_no:
        return None
    return f | (NO_SCOOTER if scooter_no else 0) | (NO_CAR if car_no else 0)


def oneway_of(tags) -> int:
    """1 = 照畫的方向、-1 = 反向、0 = 雙向"""
    o = tags.get("oneway")
    if o in ("yes", "true", "1"):
        return 1
    if o == "-1":
        return -1
    if o == "no":
        return 0
    if tags.get("highway") in ("motorway", "motorway_link") or tags.get("junction") in ("roundabout", "circular"):
        return 1
    return 0


def dist_m(a, b) -> float:
    ky = 110540.0
    kx = 111320.0 * math.cos(math.radians((a[0] + b[0]) / 2))
    return math.hypot((a[0] - b[0]) * ky, (a[1] - b[1]) * kx)


def main() -> None:
    args = sys.argv[1:]
    only = next((a[9:] for a in args if a.startswith("--region=")), None)
    regions = {k: v for k, v in REGIONS.items() if not only or k == only}
    if not regions:
        raise SystemExit(f"--region 只能是 {' / '.join(REGIONS)}")
    if not os.path.exists(PBF):
        raise SystemExit("沒有 data/osm/taiwan.osm.pbf:先跑 python scripts/build_osm_pois.py")
    os.makedirs(OUT, exist_ok=True)
    t0 = time.time()

    # 第 1 趟:道路 way(節點 id、類別、單行)與每個節點被幾條 way 用到
    ways: list[tuple[array.array, int, int]] = []
    use: dict[int, int] = {}
    for o in osmium.FileProcessor(PBF, osmium.osm.WAY).with_filter(osmium.filter.KeyFilter("highway")):
        f = flags_of(o.tags)
        if f is None:
            continue
        refs = array.array("q", (n.ref for n in o.nodes))
        if len(refs) < 2:
            continue
        ways.append((refs, f, oneway_of(o.tags)))
        for r in refs:
            use[r] = use.get(r, 0) + 1
    print(f"道路 {len(ways)} 條、節點 {len(use)}({time.time() - t0:.0f}s)")

    # 第 2 趟:節點座標(只要道路上的)
    loc: dict[int, tuple[float, float]] = {}

    class Loc(osmium.SimpleHandler):
        def node(self, n):
            if n.id in use:
                loc[n.id] = (n.location.lat, n.location.lon)

    Loc().apply_file(PBF)
    print(f"座標 {len(loc)}({time.time() - t0:.0f}s)")

    for region, (w, s, e, n) in regions.items():
        inside = lambda p: s <= p[0] <= n and w <= p[1] <= e  # noqa: E731
        idx: dict[int, int] = {}
        lat = array.array("i")
        lng = array.array("i")
        edges: list[tuple[int, int, int, int]] = []  # (from, to, 長度 m, 旗標)

        def node_id(ref: int) -> int:
            i = idx.get(ref)
            if i is None:
                i = idx[ref] = len(lat)
                p = loc[ref]
                lat.append(round(p[0] * 1e6))
                lng.append(round(p[1] * 1e6))
            return i

        for refs, f, oneway in ways:
            pts = [loc.get(r) for r in refs]
            if any(p is None for p in pts) or not any(inside(p) for p in pts):
                continue
            start = 0
            acc = 0.0
            for k in range(1, len(refs)):
                acc += dist_m(pts[k - 1], pts[k])
                last = k == len(refs) - 1
                if last or use[refs[k]] > 1 or acc > MAX_EDGE_M:
                    a, b = node_id(refs[start]), node_id(refs[k])
                    m = min(65535, max(1, round(acc)))
                    if a != b:
                        if oneway >= 0:
                            edges.append((a, b, m, f))
                        if oneway <= 0:
                            edges.append((b, a, m, f))
                    start = k
                    acc = 0.0
        edges.sort()
        N, E = len(lat), len(edges)
        off = array.array("I", [0] * (N + 1))
        for a, _, _, _ in edges:
            off[a + 1] += 1
        for i in range(N):
            off[i + 1] += off[i]
        to = array.array("I", (b for _, b, _, _ in edges))
        ln = array.array("H", (m for _, _, m, _ in edges))
        fl = array.array("B", (f for _, _, _, f in edges))
        path = os.path.join(OUT, f"{region}.bin")
        with open(path, "wb") as fh:
            fh.write(MAGIC + struct.pack("<II", N, E))
            for arr in (lat, lng, off, to, ln, fl):
                if sys.byteorder != "little":
                    arr.byteswap()
                fh.write(arr.tobytes())
        km = sum(ln) / 1000
        print(f"{region}:路口 {N}、有向邊 {E}(約 {km:,.0f} km)→ {os.path.relpath(path, ROOT)} {os.path.getsize(path) / 1e6:.1f} MB")
    print(f"總時間 {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
