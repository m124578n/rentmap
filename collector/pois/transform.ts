/**
 * 生活機能資料轉換(純函式,測試在 test/collector/pois.test.ts)。
 *   Overpass JSON(`out center tags`)→ PoiIn:node 用自己的座標,way / relation 用 center(公園、醫院是面)
 *   menmap shops.json → PoiIn(拉麵,只收雙北、營業中,帶 Google 評分與地圖連結)
 */
import { POI_CATEGORIES, type PoiCat, type PoiIn } from "../../src/shared/poi";
import { normalizeCity, OPEN_CITIES, regionBbox, type CityName, type RegionKey } from "../../src/shared/regions";

type Bbox = { s: number; w: number; n: number; e: number };

/** 生活圈的外框(已開放縣市的聯集,regions.ts);目前 north = 雙北(南到烏來、北到石門、東到貢寮、西到林口) */
export function bboxOf(region: RegionKey): Bbox {
  const [w, s, e, n] = regionBbox(region);
  return { s, w, n, e };
}

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
  const def = POI_CATEGORIES[cat] as { osm?: [string, string[]][]; line?: boolean };
  const sels: readonly (readonly [string, readonly string[]])[] = def.osm ?? [];
  if (!sels.length) throw new Error(`${cat} 不是 OSM 類別`);
  const box = [b.s, b.w, b.n, b.e].map((x) => x.toFixed(4)).join(",");
  if (def.line) {
    // 線:只要 way、不要隧道(地下段沒有噪音),帶線形
    const parts = sels.flatMap(([k, vs]) => vs.map((v) => `way["${k}"="${v}"]["tunnel"!~"^(yes|building_passage|covered)$"](${box});`)).join("");
    return `[out:json][timeout:180];(${parts});out geom tags;`;
  }
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
  /** out geom:way 的每個節點 */
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
}

const LINE_STEP_M = 40;
const distM = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const kx = 111320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot((b.lon - a.lon) * kx, (b.lat - a.lat) * 110540);
};
/** 線每 LINE_STEP_M 公尺取一點(含兩端) */
export function sampleLine(g: { lat: number; lon: number }[]): { lat: number; lon: number }[] {
  if (g.length < 2) return g.slice();
  const out = [g[0]!];
  let carry = 0;
  for (let i = 1; i < g.length; i++) {
    const a = g[i - 1]!;
    const b = g[i]!;
    const seg = distM(a, b);
    let t = LINE_STEP_M - carry;
    while (t < seg) {
      out.push({ lat: a.lat + ((b.lat - a.lat) * t) / seg, lon: a.lon + ((b.lon - a.lon) * t) / seg });
      t += LINE_STEP_M;
    }
    carry = seg - (t - LINE_STEP_M);
  }
  out.push(g[g.length - 1]!);
  return out;
}

/** 名稱:name → name:zh-Hant / name:zh → brand → name:en */
export function osmName(t: Record<string, string> = {}): string | null {
  const n = t.name ?? t["name:zh-Hant"] ?? t["name:zh-TW"] ?? t["name:zh"] ?? t.brand ?? t["name:en"];
  return n?.trim().slice(0, 120) || null;
}

export function fromOverpass(cat: PoiCat, elements: OsmElement[]): PoiIn[] {
  const def = POI_CATEGORIES[cat] as { osm?: [string, string[]][]; line?: boolean };
  const sels = def.osm ?? [];
  const out = new Map<string, PoiIn>();
  if (def.line) {
    for (const el of elements) {
      const t = el.tags ?? {};
      if (!el.geometry?.length) continue;
      // 渡線、側線、機廠線(service=*)都貼在主線旁邊、沒名字,只會多一筆「?」
      if (t.railway && t.service) continue;
      const hit = sels.find(([k, vs]) => vs.includes(t[k] ?? ""));
      const name = (t.name ?? t.ref ?? null)?.slice(0, 120) ?? null;
      sampleLine(el.geometry).forEach((p, i) => {
        const key = `w${el.id}:${i}`;
        out.set(key, { key, category: cat, subtype: hit ? t[hit[0]]! : null, name, lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lon * 1e6) / 1e6, rating: null, url: null });
      });
    }
    return [...out.values()];
  }
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null) continue;
    const t = el.tags ?? {};
    // 私人的(社區游泳池、公司健身房)不算
    if (t.access === "private" || t.access === "no") continue;
    // 變電所:路邊的小型配電箱、地下 / 室內的不算嫌惡
    if (cat === "substation" && (t.substation === "minor_distribution" || /underground|indoor/.test(t.location ?? ""))) continue;
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

/** cities:只收這些縣市的店(一個生活圈匯一次,commit 只換那個生活圈) */
export function fromMenmap(shops: MenmapShop[], cities: readonly CityName[] = OPEN_CITIES): PoiIn[] {
  return shops
    .filter((s) => cities.includes(normalizeCity(s.city)!) && s.status === "OPERATIONAL" && Number.isFinite(s.lat) && Number.isFinite(s.lng))
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

/** 夜市:從市場裡挑名字有「夜市」的,另成一類(同一個 OSM key 可以屬於兩類) */
export function nightMarkets(market: PoiIn[]): PoiIn[] {
  return market.filter((x) => x.name && /夜市/.test(x.name)).map((x) => ({ ...x, category: "nightmarket" as const, subtype: "night_market" }));
}

// ---- YouBike 2.0 站點 ----

export interface YoubikeRow {
  sno?: string;
  sna?: string;
  sarea?: string;
  ar?: string;
  act?: string;
  /** 台北:latitude / longitude / Quantity;新北:lat / lng / tot_quantity */
  latitude?: number | string;
  longitude?: number | string;
  lat?: number | string;
  lng?: number | string;
  Quantity?: number | string;
  tot_quantity?: number | string;
  total?: number | string;
}
export function fromYoubike(rows: YoubikeRow[]): PoiIn[] {
  const out = new Map<string, PoiIn>();
  for (const r of rows) {
    const lat = Number(r.latitude ?? r.lat);
    const lng = Number(r.longitude ?? r.lng);
    if (!r.sno || !inTpe(lat, lng)) continue;
    const docks = Number(r.Quantity ?? r.tot_quantity ?? r.total);
    const key = `y${r.sno}`;
    out.set(key, {
      key,
      category: "youbike",
      subtype: r.act === "0" ? "暫停營運" : null,
      name: (r.sna ?? "").replace(/^YouBike2\.0_/, "").slice(0, 120) || null,
      lat,
      lng,
      rating: null,
      url: null,
      note: Number.isFinite(docks) && docks > 0 ? `${docks} 格` : null,
      minute: null,
      days: null,
    });
  }
  return [...out.values()];
}

/** TDX 公共自行車站(v2/Bike/Station/City/{City});雙北以外的縣市用這個 */
export interface TdxBikeStation {
  StationUID: string;
  StationName?: { Zh_tw?: string };
  StationPosition?: { PositionLat?: number; PositionLon?: number };
  BikesCapacity?: number;
}

export function fromTdxBike(rows: TdxBikeStation[]): PoiIn[] {
  const out: PoiIn[] = [];
  for (const r of rows) {
    const lat = r.StationPosition?.PositionLat;
    const lng = r.StationPosition?.PositionLon;
    if (!r.StationUID || lat == null || lng == null || !lat || !lng) continue;
    out.push({
      key: `t${r.StationUID}`,
      category: "youbike",
      subtype: null,
      name: (r.StationName?.Zh_tw ?? "").replace(/^YouBike2\.0_/, "").slice(0, 120) || null,
      lat,
      lng,
      rating: null,
      url: null,
      note: r.BikesCapacity ? `${r.BikesCapacity} 格` : null,
      minute: null,
      days: null,
    });
  }
  return out;
}

/** 台南市垃圾清運點(市府開放資料;一點一個時間,收運日是「一、二、四、六」這種字串) */
export interface TainanGarbageRow {
  AREA?: string;
  ROUTEID?: string;
  ROUTEORDER?: number | string;
  VILLAGE?: string;
  POINTNAME?: string;
  TIME?: string;
  LONGITUDE?: number | string;
  LATITUDE?: number | string;
  WORKDAY?: string;
  RECYCLEDAY?: string;
}
const daysBits = (s: string | undefined) => [...(s ?? "")].reduce((b, ch) => (W.includes(ch) ? b | (1 << W.indexOf(ch)) : b), 0);
const inTainan = (lat: number, lng: number) => lat > 22.8 && lat < 23.5 && lng > 120.0 && lng < 120.7;
export function fromTainanGarbage(rows: TainanGarbageRow[]): PoiIn[] {
  const out = new Map<string, PoiIn>();
  for (const r of rows) {
    const lat = Number(r.LATITUDE);
    const lng = Number(r.LONGITUDE);
    const t0 = hhmm(r.TIME);
    if (!inTainan(lat, lng) || t0 == null) continue;
    const days = daysBits(r.WORKDAY);
    if (!days) continue;
    const recycle = daysBits(r.RECYCLEDAY); // 「無清運」→ 0
    // 同一路線、同一順序偶爾有兩筆(不同里),加時間才不會互蓋
    const key = `tn${r.ROUTEID ?? ""}:${r.ROUTEORDER ?? ""}:${t0}`.slice(0, 80);
    out.set(key, {
      key,
      category: "garbage",
      subtype: `${r.AREA ?? ""}${r.ROUTEID ? ` 路線 ${r.ROUTEID}` : ""}`.trim().slice(0, 40) || null,
      name: r.POINTNAME?.trim().slice(0, 120) || null,
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

/**
 * 台中、高雄的定時定點收運地點(兩市同一套系統):市府資料沒有座標,scripts/locate_garbage.py 用 OSM 門牌對出 lat / lng 後的列。
 * g_d1…g_d7 = 週一…週日的一般垃圾起迄時間(台中欄位名多一個 _time),r_d* 是資源回收。
 */
export type LocatedGarbageRow = Record<string, string | number | undefined> & { area?: string; car_licence?: string; caption?: string; lat?: number; lng?: number };
export function fromLocatedGarbage(rows: LocatedGarbageRow[], prefix: string): PoiIn[] {
  const at = (r: LocatedGarbageRow, kind: "g" | "r", d: number, edge: "s" | "e") => hhmm(String(r[`${kind}_d${d}_${edge}`] ?? r[`${kind}_d${d}_time_${edge}`] ?? ""));
  const out = new Map<string, PoiIn>();
  for (const r of rows) {
    const lat = Number(r.lat);
    const lng = Number(r.lng);
    if (!(lat > 21 && lat < 26.5 && lng > 118 && lng < 123)) continue;
    let days = 0;
    let recycle = 0;
    let t0: number | null = null;
    let t1: number | null = null;
    for (let d = 1; d <= 7; d++) {
      const bit = 1 << (d % 7); // d7 = 週日 = bit 0
      const s = at(r, "g", d, "s");
      if (s != null) {
        days |= bit;
        if (t0 == null) {
          t0 = s;
          t1 = at(r, "g", d, "e");
        }
      }
      if (at(r, "r", d, "s") != null) recycle |= bit;
    }
    if (!days || t0 == null) continue; // 只收回收的點
    const caption = String(r.caption ?? "").trim();
    const key = `${prefix}${r.car_licence ?? ""}:${t0}:${caption}`.slice(0, 80);
    out.set(key, {
      key,
      category: "garbage",
      subtype: `${r.area ?? ""} ${r.car_licence ?? ""}`.trim().slice(0, 40) || null,
      name: caption.slice(0, 120) || null,
      lat,
      lng,
      rating: null,
      url: null,
      note: `${fmt(t0)}${t1 != null && t1 > t0 ? `–${fmt(t1)}` : ""} · ${daysText(days)}${recycle ? `(回收 ${daysText(recycle)})` : ""}`.slice(0, 120),
      minute: t0,
      days,
    });
  }
  return [...out.values()];
}
