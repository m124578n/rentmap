/**
 * 生活機能(附近地點)。資料來源:OpenStreetMap(Overpass,家裡採集機一類一類抓)+ menmap 拉麵店(有 Google 評分)。
 * 設計:docs/design/2026-09-23-nearby-poi-design.md
 */
import { z } from "zod";

/** Overpass 選擇器:[tag key, 可接受的值](同一類任一條符合就算) */
type Sel = [string, string[]];
export interface PoiCategory {
  label: string;
  /** 面板 / 比較表上的順序與要不要預設顯示 */
  main: boolean;
  osm?: Sel[];
}

export const POI_CATEGORIES = {
  convenience: { label: "超商", main: true, osm: [["shop", ["convenience"]]] },
  supermarket: { label: "超市量販", main: true, osm: [["shop", ["supermarket", "greengrocer", "department_store", "mall", "wholesale"]]] },
  food: { label: "餐飲", main: true, osm: [["amenity", ["restaurant", "fast_food", "cafe", "food_court"]]] },
  ramen: { label: "拉麵", main: false },
  // 雙北環保局開放資料(表定清運點與時間),不是 OSM
  garbage: { label: "垃圾車", main: true },
  market: { label: "市場", main: true, osm: [["amenity", ["marketplace"]]] },
  park: { label: "公園", main: true, osm: [["leisure", ["park", "playground"]]] },
  clinic: { label: "診所", main: true, osm: [["amenity", ["clinic", "doctors", "dentist"]]] },
  pharmacy: { label: "藥局", main: false, osm: [["amenity", ["pharmacy"]], ["healthcare", ["pharmacy"]]] },
  hospital: { label: "醫院", main: false, osm: [["amenity", ["hospital"]]] },
  gym: { label: "運動", main: true, osm: [["leisure", ["fitness_centre", "sports_centre", "swimming_pool"]]] },
  laundry: { label: "洗衣", main: false, osm: [["shop", ["laundry", "dry_cleaning"]]] },
  bank: { label: "郵局銀行", main: false, osm: [["amenity", ["bank", "post_office"]]] },
  school: { label: "學校", main: false, osm: [["amenity", ["school", "kindergarten", "university", "college"]]] },
  worship: { label: "宮廟教堂", main: false, osm: [["amenity", ["place_of_worship"]]] },
  police: { label: "警察局", main: false, osm: [["amenity", ["police"]]] },
} as const satisfies Record<string, PoiCategory>;
export type PoiCat = keyof typeof POI_CATEGORIES;
export const POI_CATS = Object.keys(POI_CATEGORIES) as PoiCat[];
export const poiLabel = (c: PoiCat) => POI_CATEGORIES[c].label;

export const PoiIn = z.object({
  /** OSM:n123 / w456 / r789;menmap:m{ftid} */
  key: z.string().min(1).max(80),
  category: z.enum(POI_CATS as [PoiCat, ...PoiCat[]]),
  subtype: z.string().max(40).nullable(),
  name: z.string().max(120).nullable(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  rating: z.number().min(0).max(5).nullable(),
  url: z.string().url().max(500).nullable(),
  /** 給人看的補充(垃圾車:「19:30–19:40 · 一二四五六」) */
  note: z.string().max(120).nullable().optional(),
  /** 一天中的第幾分鐘(垃圾車抵達時間) */
  minute: z.number().int().min(0).max(1439).nullable().optional(),
  /** 星期位元:bit0 = 週日 … bit6 = 週六(垃圾車收一般垃圾的日子) */
  days: z.number().int().min(0).max(127).nullable().optional(),
});
export type PoiIn = z.infer<typeof PoiIn>;

/** 星期位元 → 「一二四五六」 */
export function daysLabel(bits: number) {
  const w = "日一二三四五六";
  const on = [1, 2, 3, 4, 5, 6, 0].filter((d) => bits & (1 << d)).map((d) => w[d]);
  return on.length === 7 ? "每天" : on.join("");
}
/** 平日(週一到五)有沒有收 */
export const weekdayCount = (bits: number) => [1, 2, 3, 4, 5].filter((d) => bits & (1 << d)).length;

export interface NearbyPoi {
  name: string | null;
  subtype: string | null;
  lat: number;
  lng: number;
  distance_m: number;
  walk_min: number;
  rating: number | null;
  url: string | null;
  note: string | null;
  minute: number | null;
  days: number | null;
}
/** GET /api/nearby */
export interface NearbyResponse {
  radius: number;
  has_data: boolean;
  counts: Partial<Record<PoiCat, number>>;
  /** 每類最近的幾個 */
  items: Partial<Record<PoiCat, NearbyPoi[]>>;
}
/** GET /api/nearby/summary:每間房源半徑內每類幾個 */
export interface NearbySummary {
  radius: number;
  has_data: boolean;
  items: Record<string, Partial<Record<PoiCat, number>>>;
}

/** 在 Google Maps 搜附近(餐飲 OSM 缺小店,給個全量的出口) */
export const googleNearbyUrl = (q: string, lat: number, lng: number) =>
  `https://www.google.com/maps/search/${encodeURIComponent(q)}/@${lat.toFixed(6)},${lng.toFixed(6)},17z`;

/** OSM 子類別的中文(面板列出最近幾個時顯示) */
export const POI_SUBTYPE_LABEL: Record<string, string> = {
  restaurant: "餐廳",
  fast_food: "速食",
  cafe: "咖啡",
  food_court: "美食街",
  supermarket: "超市",
  greengrocer: "蔬果",
  department_store: "百貨",
  mall: "商場",
  wholesale: "量販",
  park: "公園",
  playground: "遊戲場",
  clinic: "診所",
  doctors: "診所",
  dentist: "牙醫",
  fitness_centre: "健身房",
  sports_centre: "運動中心",
  swimming_pool: "游泳池",
  laundry: "洗衣",
  dry_cleaning: "乾洗",
  bank: "銀行",
  post_office: "郵局",
  school: "學校",
  kindergarten: "幼兒園",
  university: "大學",
  college: "大專",
  marketplace: "市場",
  place_of_worship: "宮廟教堂",
  pharmacy: "藥局",
  hospital: "醫院",
  police: "警察局",
  convenience: "超商",
};

/**
 * 房東有沒有寫垃圾代收:591 沒有這個欄位,看屋況介紹 / 標籤的關鍵字。
 * 有寫代收 → true;寫明要自己追垃圾車 → false;都沒寫 → null(不確定,不是「沒有」)。
 */
export const GARBAGE_SERVICE_RE = /垃圾(代收|集中|統一收|子母車|不落地|由管理|管理員代收|每日收|免追)|代收垃圾|子母車|垃圾(間|室|集中區)|收垃圾服務/;
export const GARBAGE_NONE_RE = /(自行|需|要|得)追垃圾車|無垃圾代收|沒有垃圾代收|垃圾(需)?自理/;
export function garbageService(text: string | null | undefined): boolean | null {
  if (!text) return null;
  if (GARBAGE_NONE_RE.test(text)) return false;
  return GARBAGE_SERVICE_RE.test(text) ? true : null;
}

/** GET /api/garbage/fit:每間房源在需求條件下最好的垃圾車點(沒設條件不用查) */
export interface GarbageFit {
  max_m: number;
  after: string;
  items: Record<string, { ok: boolean; service: boolean; best: { distance_m: number; minute: number; name: string | null } | null }>;
}
