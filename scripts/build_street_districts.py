"""實價登錄沒有分區的縣市(新竹市:「鄉鎮市區」欄就是「新竹市」,地址寫成「新竹市新竹市武陵路…」)→ 用路名推回行政區。

做法:台灣 OSM 檔(data/osm/taiwan.osm.pbf,build_osm_pois.py 下載)裡的門牌是各市政府門牌資料匯進去的,同時有 addr:street 與 addr:district;
統計每條路(含「段」,不含巷弄)的門牌落在哪一區,多數決;最多的那區不到 60% 就不歸區(跨區的長路,留給「全市」)。
輸出 collector/rentstats/street-districts.json(進 git;採集時 transform.ts 用來補行政區)。

    python scripts/build_street_districts.py
"""

import collections
import json
import os
import re

import osmium

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PBF = os.path.join(ROOT, "data", "osm", "taiwan.osm.pbf")
OUT = os.path.join(ROOT, "collector", "rentstats", "street-districts.json")
CITIES = {"新竹市"}
MIN_SHARE = 0.6
MIN_PLATES = 3
FW = str.maketrans("０１２３４５６７８９", "0123456789")


def norm(s):
    return (s or "").translate(FW).replace("臺", "台").replace(" ", "")


def base_road(street: str) -> str | None:
    m = re.match(r"(.+?(?:大道|路|街)(?:[一二三四五六七八九十]+段)?)", norm(street))
    return m.group(1) if m else None


counts: dict[str, dict[str, collections.Counter]] = {c: collections.defaultdict(collections.Counter) for c in CITIES}
for o in osmium.FileProcessor(PBF, osmium.osm.NODE | osmium.osm.WAY).with_filter(osmium.filter.KeyFilter("addr:street")):
    city = norm(o.tags.get("addr:city"))
    if city not in CITIES:
        continue
    district = norm(o.tags.get("addr:district"))
    road = base_road(o.tags.get("addr:street"))
    if district and road and district != city:
        counts[city][road][district] += 1

out: dict[str, dict[str, str]] = {}
for city, roads in counts.items():
    m: dict[str, str] = {}
    for road, c in roads.items():
        (d, n), total = c.most_common(1)[0], sum(c.values())
        if total >= MIN_PLATES and n / total >= MIN_SHARE:
            m[road] = d
    out[city] = dict(sorted(m.items()))
    by = collections.Counter(m.values())
    print(f"{city}:{len(roads)} 條路有門牌 → 歸得到區 {len(m)} 條 {dict(by)}")
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=0)
print(f"寫入 {os.path.relpath(OUT, ROOT)} {os.path.getsize(OUT)} bytes")
