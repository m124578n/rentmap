/**
 * 印出「每個生活圈 × 每個 OSM 類別」要產生的快取檔與範圍(JSON),給 scripts/build_osm_pois.py 用。
 * 類別的 OSM 標籤、分塊方式、檔名規則都沿用 collector 的定義,兩邊不會各寫一份。
 *
 *   npx tsx scripts/osm-spec.ts [--region=north]
 */
import { POI_CATEGORIES, POI_CATS } from "../src/shared/poi";
import { REGION_KEYS, type RegionKey } from "../src/shared/regions";
import { TILES } from "../collector/pois/index";
import { bboxOf, tiles } from "../collector/pois/transform";

const only = process.argv.find((a) => a.startsWith("--region="))?.slice(9);
const regions = (only ? [only] : [...REGION_KEYS]) as RegionKey[];

const out: { region: string; cat: string; file: string; box: { s: number; w: number; n: number; e: number }; line: boolean; sels: [string, string[]][] }[] = [];
for (const region of regions) {
  // 與 collector/pois/index.ts 的 loadCategory 同一套檔名:北區沒有前綴,其他生活圈加「{region}-」
  const prefix = region === "north" ? "" : `${region}-`;
  for (const cat of POI_CATS) {
    const def = POI_CATEGORIES[cat] as { osm?: [string, string[]][]; line?: boolean };
    if (!def.osm?.length) continue; // 垃圾車、YouBike、拉麵、治安不是 OSM 來源
    const [rows, cols] = TILES[cat] ?? [1, 1];
    const boxes = tiles(bboxOf(region), rows, cols);
    boxes.forEach((box, i) => out.push({ region, cat, file: boxes.length > 1 ? `${prefix}${cat}-${i}.json` : `${prefix}${cat}.json`, box, line: !!def.line, sels: def.osm! }));
  }
}
console.log(JSON.stringify(out));
