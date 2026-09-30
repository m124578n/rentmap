/**
 * 生活機能資料轉換(純函式,測試在 test/collector/pois.test.ts)。
 *   Overpass JSON(`out center tags`)→ PoiIn:node 用自己的座標,way / relation 用 center(公園、醫院是面)
 *   menmap shops.json → PoiIn(拉麵,只收雙北、營業中,帶 Google 評分與地圖連結)
 */
import { POI_CATEGORIES, type PoiCat, type PoiIn } from "../../src/shared/poi";

/** 雙北(南到烏來、北到石門、東到貢寮、西到林口) */
export const TPE_BBOX = { s: 24.67, w: 121.28, n: 25.3, e: 122.01 } as const;
type Bbox = { s: number; w: number; n: number; e: number };

/** 大類(餐飲)一次查會逾時,切成 rows × cols 塊 */
export function tiles(b: Bbox, rows: number, cols: number): Bbox[] {
  const out: Bbox[] = [];
  const dy = (b.n - b.s) / rows;
  const dx = (b.e - b.w) / cols;
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++) out.push({ s: b.s + i * dy, w: b.w + j * dx, n: b.s + (i + 1) * dy, e: b.w + (j + 1) * dx });
  return out;
}

export function overpassQuery(cat: PoiCat, b: Bbox): string {
  const sels: readonly (readonly [string, readonly string[]])[] = (POI_CATEGORIES[cat] as { osm?: [string, string[]][] }).osm ?? [];
  if (!sels.length) throw new Error(`${cat} 不是 OSM 類別`);
  const box = [b.s, b.w, b.n, b.e].map((x) => x.toFixed(4)).join(",");
  // 一個值一段精確比對:Overpass 對 k=v 有索引,正規式 ~"^(a|b)$" 要掃全部、慢很多(雙北超市實測會 504)
  const parts = sels.flatMap(([k, vs]) => vs.map((v) => `nwr["${k}"="${v}"](${box});`)).join("");
  return `[out:json][timeout:180];(${parts});out center tags;`;
}

export interface OsmElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/** 名稱:name → name:zh-Hant / name:zh → brand → name:en */
export function osmName(t: Record<string, string> = {}): string | null {
  const n = t.name ?? t["name:zh-Hant"] ?? t["name:zh-TW"] ?? t["name:zh"] ?? t.brand ?? t["name:en"];
  return n?.trim().slice(0, 120) || null;
}

export function fromOverpass(cat: PoiCat, elements: OsmElement[]): PoiIn[] {
  const sels = (POI_CATEGORIES[cat] as { osm?: [string, string[]][] }).osm ?? [];
  const out = new Map<string, PoiIn>();
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null) continue;
    const t = el.tags ?? {};
    // 私人的(社區游泳池、公司健身房)不算
    if (t.access === "private" || t.access === "no") continue;
    const hit = sels.find(([k, vs]) => vs.includes(t[k] ?? ""));
    const key = `${el.type[0]}${el.id}`;
    out.set(key, {
      key,
      category: cat,
      subtype: hit ? t[hit[0]]! : null,
      name: osmName(t),
      lat: Math.round(lat * 1e6) / 1e6,
      lng: Math.round(lng * 1e6) / 1e6,
      rating: null,
      url: null,
    });
  }
  return [...out.values()];
}

export interface MenmapShop {
  ftid: string;
  name: string;
  lat: number;
  lng: number;
  city?: string;
  status?: string;
  rating?: number | null;
  maps_url?: string | null;
}

export function fromMenmap(shops: MenmapShop[]): PoiIn[] {
  return shops
    .filter((s) => (s.city === "台北市" || s.city === "新北市") && s.status === "OPERATIONAL" && Number.isFinite(s.lat) && Number.isFinite(s.lng))
    .map((s) => ({
      key: `m${s.ftid}`.slice(0, 80),
      category: "ramen" as const,
      subtype: "拉麵",
      name: s.name.slice(0, 120),
      lat: Math.round(s.lat * 1e6) / 1e6,
      lng: Math.round(s.lng * 1e6) / 1e6,
      rating: s.rating != null && s.rating >= 0 && s.rating <= 5 ? s.rating : null,
      url: s.maps_url && /^https:\/\//.test(s.maps_url) ? s.maps_url.slice(0, 500) : `https://www.google.com/maps?ftid=${encodeURIComponent(s.ftid)}`,
    }));
}
