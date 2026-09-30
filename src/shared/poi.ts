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
});
export type PoiIn = z.infer<typeof PoiIn>;

export interface NearbyPoi {
  name: string | null;
  subtype: string | null;
  lat: number;
  lng: number;
  distance_m: number;
  walk_min: number;
  rating: number | null;
  url: string | null;
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
