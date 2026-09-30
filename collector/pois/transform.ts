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

// ---- 垃圾車(雙北環保局開放資料)----

/** 「1630」「16:30」→ 990 */
export function hhmm(s: string | undefined): number | null {
  const m = /^(\d{1,2}):?(\d{2})$/.exec((s ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h < 24 && mi < 60 ? h * 60 + mi : null;
}
const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const WEEK = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
/** 台北市一般垃圾週三、週日不收(資料裡沒有星期,全市一致) */
export const TAIPEI_DAYS = 0b1110110; // 一二四五六
const W = "日一二三四五六";
const daysText = (bits: number) => [1, 2, 3, 4, 5, 6, 0].filter((d) => bits & (1 << d)).map((d) => W[d]).join("");
const inTpe = (lat: number, lng: number) => lat > 24.6 && lat < 25.4 && lng > 121.2 && lng < 122.1;

export interface TaipeiGarbageRow {
  局編?: string;
  車次?: string;
  路線?: string;
  抵達時間?: string;
  離開時間?: string;
  地點?: string;
  經度?: string;
  緯度?: string;
}
export function fromTaipeiGarbage(rows: TaipeiGarbageRow[]): PoiIn[] {
  const out = new Map<string, PoiIn>();
  for (const r of rows) {
    const lat = Number(r.緯度);
    const lng = Number(r.經度);
    const t0 = hhmm(r.抵達時間);
    if (!inTpe(lat, lng) || t0 == null) continue;
    const t1 = hhmm(r.離開時間);
    const key = `t${r.局編 ?? ""}:${r.車次 ?? ""}:${t0}`.slice(0, 80);
    out.set(key, {
      key,
      category: "garbage",
      subtype: r.路線?.slice(0, 40) || null,
      name: (r.地點 ?? "").replace(/^臺北市\S*?區/, "").slice(0, 120) || null,
      lat,
      lng,
      rating: null,
      url: null,
      note: `${fmt(t0)}${t1 != null && t1 > t0 ? `–${fmt(t1)}` : ""} · ${daysText(TAIPEI_DAYS)}`,
      minute: t0,
      days: TAIPEI_DAYS,
    });
  }
  return [...out.values()];
}

export type NtpcGarbageRow = Record<string, string | undefined> & { lineid?: string; linename?: string; rank?: string; name?: string; longitude?: string; latitude?: string; time?: string };
export function fromNtpcGarbage(rows: NtpcGarbageRow[]): PoiIn[] {
  const out = new Map<string, PoiIn>();
  for (const r of rows) {
    const lat = Number(r.latitude);
    const lng = Number(r.longitude);
    const t0 = hhmm(r.time);
    if (!inTpe(lat, lng) || t0 == null) continue;
    const days = WEEK.reduce((b, d, i) => (r[`garbage${d}`] === "Y" ? b | (1 << i) : b), 0);
    if (!days) continue; // 只收回收 / 廚餘的點
    const recycle = WEEK.reduce((b, d, i) => (r[`recycling${d}`] === "Y" ? b | (1 << i) : b), 0);
    const key = `n${r.lineid ?? ""}:${r.rank ?? ""}`.slice(0, 80);
    out.set(key, {
      key,
      category: "garbage",
      subtype: r.linename?.slice(0, 40) || null,
      name: r.name?.slice(0, 120) || null,
      lat,
      lng,
      rating: null,
      url: null,
      note: `${fmt(t0)} · ${daysText(days)}${recycle ? `(回收 ${daysText(recycle)})` : ""}`.slice(0, 120),
      minute: t0,
      days,
    });
  }
  return [...out.values()];
}
