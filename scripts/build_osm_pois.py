"""從 Geofabrik 的台灣 OSM 檔(.osm.pbf)抽出生活機能 / 嫌惡設施,寫成 collector 的快取檔。

為什麼:Overpass 公用伺服器常常限速、逾時,甚至整晚連不上(2026-09-30 就是)。
Geofabrik 每天出一份全台灣的檔(約 330 MB),下載一次、本機處理,四個生活圈一起產,不必打 Overpass。

輸出:data/osm/{檔名}.json(檔名、範圍、標籤由 scripts/osm-spec.ts 依 collector 的定義產生),
內容是 Overpass JSON 的 elements 陣列(out center tags;線是 out geom tags),
所以之後照常跑 `npm run collect -- pois [--region=…]`,它看到 30 天內的快取就不會打 Overpass。

    pip install osmium
    python scripts/build_osm_pois.py                 # 四個生活圈
    python scripts/build_osm_pois.py --region=north  # 只產一個
    python scripts/build_osm_pois.py --refresh       # 重新下載台灣檔(預設 25 天內不重抓)

平常不用直接跑:`npm run data:refresh` 的 pois 步驟會先跑這支。
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
import urllib.request

import osmium

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR = os.path.join(ROOT, "data", "osm")
PBF = os.path.join(DIR, "taiwan.osm.pbf")
INDEX = "https://download.geofabrik.de/asia/taiwan.html"
BASE = "https://download.geofabrik.de/asia/"
PBF_MAX_AGE_DAYS = 25
UA = {"User-Agent": "rentmap/0.1 (personal rental notes)"}
TUNNEL = {"yes", "building_passage", "covered"}


def download(refresh: bool) -> None:
    os.makedirs(DIR, exist_ok=True)
    if os.path.exists(PBF) and not refresh and time.time() - os.path.getmtime(PBF) < PBF_MAX_AGE_DAYS * 86400:
        print(f"台灣檔:用現有的({os.path.getsize(PBF) / 1e6:.0f} MB,{(time.time() - os.path.getmtime(PBF)) / 86400:.0f} 天前)")
        return
    # taiwan-latest.osm.pbf 這個別名會一直 301 轉址(2026-09 實測),改從頁面找最新的帶日期檔名
    html = urllib.request.urlopen(urllib.request.Request(INDEX, headers=UA), timeout=60).read().decode("utf-8", "replace")
    dated = sorted(set(re.findall(r'href="(taiwan-\d{6}\.osm\.pbf)"', html)))
    if not dated:
        raise SystemExit("Geofabrik 頁面上找不到 taiwan-YYMMDD.osm.pbf")
    url = BASE + dated[-1]
    print(f"下載 {url}(約 330 MB,Geofabrik 限速,可能要 20–40 分鐘)")
    part = PBF + ".part"
    # curl 支援續傳;沒有 curl 就用 urllib
    try:
        subprocess.run(["curl", "-sS", "-L", "--fail", "-C", "-", "-o", part, url], check=True)
    except (FileNotFoundError, subprocess.CalledProcessError):
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r, open(part, "wb") as f:
            while chunk := r.read(1 << 20):
                f.write(chunk)
    os.replace(part, PBF)
    print(f"台灣檔:{os.path.getsize(PBF) / 1e6:.0f} MB")


def load_spec(region: str | None) -> list[dict]:
    cmd = "npx tsx scripts/osm-spec.ts" + (f" --region={region}" if region else "")
    out = subprocess.run(cmd, shell=True, cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    if out.returncode != 0:
        raise SystemExit(f"osm-spec 失敗:{out.stderr[-500:]}")
    return json.loads(out.stdout.strip().splitlines()[-1])


def main() -> None:
    args = sys.argv[1:]
    region = next((a[9:] for a in args if a.startswith("--region=")), None)
    download("--refresh" in args)
    if "--download-only" in args:  # 道路圖步驟只要台灣檔
        return
    spec = load_spec(region)

    # (key, value) → 類別;點類與線類分開
    point_kv: dict[tuple[str, str], set[str]] = {}
    line_kv: dict[tuple[str, str], set[str]] = {}
    for s in spec:
        for k, vs in s["sels"]:
            for v in vs:
                (line_kv if s["line"] else point_kv).setdefault((k, v), set()).add(s["cat"])
    keys = sorted({k for k, _ in point_kv} | {k for k, _ in line_kv})
    # 每個類別有哪些輸出檔(跨生活圈、跨分塊)
    targets: dict[str, list[dict]] = {}
    for s in spec:
        targets.setdefault(s["cat"], []).append({"file": s["file"], "box": s["box"], "line": s["line"], "els": []})

    def cats_of(tags, table) -> set[str]:
        hit: set[str] = set()
        for k in keys:
            v = tags.get(k)
            if v is not None and (k, v) in table:
                hit |= table[(k, v)]
        return hit

    def inside(box, lat, lon) -> bool:
        return box["s"] <= lat <= box["n"] and box["w"] <= lon <= box["e"]

    def put_point(cats, el, lat, lon) -> None:
        for c in cats:
            for t in targets[c]:
                if inside(t["box"], lat, lon):
                    t["els"].append(el)

    t0 = time.time()
    # 第 1 趟:有目標標籤的 relation(大公園、醫院、大學多半是 multipolygon)→ 記下成員 way,第 2 趟拿座標算中心
    rel_members: dict[int, list[int]] = {}
    rel_info: dict[int, tuple[set[str], dict]] = {}
    for o in osmium.FileProcessor(PBF, osmium.osm.RELATION).with_filter(osmium.filter.KeyFilter(*keys)):
        cats = cats_of(o.tags, point_kv)
        if not cats:
            continue
        ways = [m.ref for m in o.members if m.type == "w"]
        if ways:
            rel_members[o.id] = ways
            rel_info[o.id] = (cats, dict(o.tags))
    way_to_rels: dict[int, list[int]] = {}
    for rid, ways in rel_members.items():
        for w in ways:
            way_to_rels.setdefault(w, []).append(rid)
    rel_bbox: dict[int, list[float]] = {}
    print(f"relation:{len(rel_info)} 個({time.time() - t0:.0f}s)")

    # 第 2 趟:node(沒標籤的先濾掉)+ way(全部看,因為 relation 的成員 way 常常沒標籤)
    n_node = n_way = n_line = 0
    fp = osmium.FileProcessor(PBF, osmium.osm.NODE | osmium.osm.WAY).with_locations().with_filter(osmium.filter.EmptyTagFilter().enable_for(osmium.osm.NODE))
    for o in fp:
        if o.is_node():
            cats = cats_of(o.tags, point_kv)
            if cats and o.location.valid():
                put_point(cats, {"type": "node", "id": o.id, "lat": o.location.lat, "lon": o.location.lon, "tags": dict(o.tags)}, o.location.lat, o.location.lon)
                n_node += 1
            continue
        in_rel = way_to_rels.get(o.id)
        pcats = cats_of(o.tags, point_kv)
        lcats = cats_of(o.tags, line_kv)
        if not (in_rel or pcats or lcats):
            continue
        pts = [(n.location.lat, n.location.lon) for n in o.nodes if n.location.valid()]
        if not pts:
            continue
        lats = [p[0] for p in pts]
        lons = [p[1] for p in pts]
        if in_rel:
            for rid in in_rel:
                b = rel_bbox.get(rid)
                if b is None:
                    rel_bbox[rid] = [min(lats), min(lons), max(lats), max(lons)]
                else:
                    b[0], b[1], b[2], b[3] = min(b[0], *lats), min(b[1], *lons), max(b[2], *lats), max(b[3], *lons)
        if pcats:
            # Overpass 的 out center = 外框中心
            clat, clon = (min(lats) + max(lats)) / 2, (min(lons) + max(lons)) / 2
            put_point(pcats, {"type": "way", "id": o.id, "center": {"lat": clat, "lon": clon}, "tags": dict(o.tags)}, clat, clon)
            n_way += 1
        if lcats and o.tags.get("tunnel") not in TUNNEL:
            el = {"type": "way", "id": o.id, "geometry": [{"lat": a, "lon": b} for a, b in pts], "tags": dict(o.tags)}
            for c in lcats:
                for t in targets[c]:
                    # 線:有任何一點落在這一塊就算(跟 Overpass 的 bbox 行為一樣),之後 collector 會依座標去重
                    if any(inside(t["box"], a, b) for a, b in pts):
                        t["els"].append(el)
            n_line += 1
    n_rel = 0
    for rid, b in rel_bbox.items():
        cats, tags = rel_info[rid]
        clat, clon = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
        put_point(cats, {"type": "relation", "id": rid, "center": {"lat": clat, "lon": clon}, "tags": tags}, clat, clon)
        n_rel += 1
    print(f"掃完:node {n_node}、way {n_way}、relation {n_rel}、線 {n_line}({time.time() - t0:.0f}s)")

    total = 0
    by_region: dict[str, int] = {}
    for s in spec:
        t = next(x for x in targets[s["cat"]] if x["file"] == s["file"])
        with open(os.path.join(DIR, s["file"]), "w", encoding="utf-8") as f:
            json.dump(t["els"], f, ensure_ascii=False)
        total += len(t["els"])
        by_region[s["region"]] = by_region.get(s["region"], 0) + len(t["els"])
    print(f"寫出 {len(spec)} 個快取檔、{total} 筆:{by_region}")


if __name__ == "__main__":
    main()
