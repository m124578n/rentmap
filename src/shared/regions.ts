/**
 * 生活圈(region)與縣市定義:整個產品「有哪些城市、地圖看哪裡、每個城市有哪些資料」都從這裡來,不要在別處寫死縣市。
 * 方向文件:docs/business/2026-09-30-direction-notes-and-regions.md
 *
 * 生活圈依通勤範圍切(不是北中南):north 北北基桃 / taichung / tainan / kaohsiung。一次只載一個生活圈。
 * 縣市表先把六都 + 基隆都列好;「開了哪些」看 REGIONS[x].cities 與 enabled。
 */

/** 各縣市有沒有某項資料(沒有的要在介面標「此區沒有這項資料」,不能當成「不在範圍內 / 0 件」) */
export type Coverage = "liquefaction" | "theftPoints" | "crimeDistricts" | "garbage" | "youbike" | "airnoise" | "flood";

export interface CityInfo {
  /** 內部與資料庫用的名字(「台」不用「臺」) */
  name: string;
  /** TDX 的 City 參數 */
  tdx: string;
  /** 內政部實價登錄檔名的縣市代碼(a_lvr_land_c.csv 的 a) */
  lvr: string;
  /** [west, south, east, north] */
  bbox: [number, number, number, number];
  districts: readonly string[];
  coverage: readonly Coverage[];
}

export const CITY_INFO = {
  台北市: {
    name: "台北市",
    tdx: "Taipei",
    lvr: "a",
    bbox: [121.45, 24.96, 121.67, 25.21],
    districts: ["中正區", "大同區", "中山區", "松山區", "大安區", "萬華區", "信義區", "士林區", "北投區", "內湖區", "南港區", "文山區"],
    coverage: ["liquefaction", "theftPoints", "crimeDistricts", "garbage", "youbike", "airnoise", "flood"],
  },
  新北市: {
    name: "新北市",
    tdx: "NewTaipei",
    lvr: "f",
    bbox: [121.28, 24.67, 122.01, 25.3],
    districts: [
      "板橋區", "三重區", "中和區", "永和區", "新莊區", "新店區", "土城區", "蘆洲區", "樹林區", "汐止區", "鶯歌區", "三峽區",
      "淡水區", "瑞芳區", "五股區", "泰山區", "林口區", "深坑區", "石碇區", "坪林區", "三芝區", "石門區", "八里區", "平溪區",
      "雙溪區", "貢寮區", "金山區", "萬里區", "烏來區",
    ],
    coverage: ["crimeDistricts", "garbage", "youbike", "airnoise", "flood"],
  },
  桃園市: {
    name: "桃園市",
    tdx: "Taoyuan",
    lvr: "h",
    bbox: [120.98, 24.58, 121.48, 25.13],
    districts: ["桃園區", "中壢區", "平鎮區", "八德區", "楊梅區", "蘆竹區", "大溪區", "龍潭區", "龜山區", "大園區", "觀音區", "新屋區", "復興區"],
    coverage: [],
  },
  基隆市: {
    name: "基隆市",
    tdx: "Keelung",
    lvr: "c",
    bbox: [121.62, 25.05, 121.81, 25.2],
    districts: ["仁愛區", "信義區", "中正區", "中山區", "安樂區", "暖暖區", "七堵區"],
    coverage: [],
  },
  台中市: {
    name: "台中市",
    tdx: "Taichung",
    lvr: "b",
    bbox: [120.46, 24.0, 121.46, 24.45],
    districts: [
      "中區", "東區", "南區", "西區", "北區", "北屯區", "西屯區", "南屯區", "太平區", "大里區", "霧峰區", "烏日區", "豐原區", "后里區", "石岡區",
      "東勢區", "和平區", "新社區", "潭子區", "大雅區", "神岡區", "大肚區", "沙鹿區", "龍井區", "梧棲區", "清水區", "大甲區", "外埔區", "大安區",
    ],
    coverage: [],
  },
  台南市: {
    name: "台南市",
    tdx: "Tainan",
    lvr: "d",
    bbox: [120.02, 22.88, 120.66, 23.42],
    districts: [
      "中西區", "東區", "南區", "北區", "安平區", "安南區", "永康區", "歸仁區", "新化區", "左鎮區", "玉井區", "楠西區", "南化區", "仁德區", "關廟區",
      "龍崎區", "官田區", "麻豆區", "佳里區", "西港區", "七股區", "將軍區", "學甲區", "北門區", "新營區", "後壁區", "白河區", "東山區", "六甲區",
      "下營區", "柳營區", "鹽水區", "善化區", "大內區", "山上區", "新市區", "安定區",
    ],
    coverage: [],
  },
  高雄市: {
    name: "高雄市",
    tdx: "Kaohsiung",
    lvr: "e",
    bbox: [120.17, 22.47, 121.05, 23.47],
    districts: [
      "楠梓區", "左營區", "鼓山區", "三民區", "鹽埕區", "前金區", "新興區", "苓雅區", "前鎮區", "旗津區", "小港區", "鳳山區", "大寮區",
      "鳥松區", "林園區", "仁武區", "大樹區", "大社區", "岡山區", "路竹區", "橋頭區", "梓官區", "彌陀區", "永安區", "燕巢區", "田寮區",
      "阿蓮區", "茄萣區", "湖內區", "旗山區", "美濃區", "內門區", "杉林區", "甲仙區", "六龜區", "茂林區", "桃源區", "那瑪夏區",
    ],
    coverage: [],
  },
} as const satisfies Record<string, CityInfo>;

export type CityName = keyof typeof CITY_INFO;
export const ALL_CITIES = Object.keys(CITY_INFO) as CityName[];

export interface RegionInfo {
  key: RegionKey;
  label: string;
  /** 已開放的縣市(資料齊了才加進來) */
  cities: readonly CityName[];
  /** 之後會加進來的縣市(還沒開) */
  planned: readonly CityName[];
  enabled: boolean;
  /** 地圖一開始看的範圍(都會核心,不是整個縣市) [[w, s], [e, n]] */
  view: [[number, number], [number, number]];
}

export const REGION_KEYS = ["north", "taichung", "tainan", "kaohsiung"] as const;
export type RegionKey = (typeof REGION_KEYS)[number];

export const REGIONS: Record<RegionKey, RegionInfo> = {
  north: {
    key: "north",
    label: "北北基桃",
    // 桃園、基隆 2026-09-30 開放:公車、實價登錄、生活機能、台鐵照全國一致的來源補;垃圾車、治安、災害等各縣市資料還沒有(coverage 空的會標「無資料」)
    cities: ["台北市", "新北市", "桃園市", "基隆市"],
    planned: [],
    enabled: true,
    view: [
      [121.28, 24.88],
      [121.75, 25.22],
    ],
  },
  taichung: { key: "taichung", label: "台中", cities: [], planned: ["台中市"], enabled: false, view: [[120.55, 24.05], [120.8, 24.3]] },
  tainan: { key: "tainan", label: "台南", cities: [], planned: ["台南市"], enabled: false, view: [[120.13, 22.93], [120.3, 23.08]] },
  kaohsiung: { key: "kaohsiung", label: "高雄", cities: [], planned: ["高雄市"], enabled: false, view: [[120.25, 22.55], [120.42, 22.75]] },
};

export const DEFAULT_REGION: RegionKey = "north";

/** 所有已開放的縣市(跨生活圈);表單驗證、資料匯入用 */
export const OPEN_CITIES = REGION_KEYS.filter((k) => REGIONS[k].enabled).flatMap((k) => REGIONS[k].cities) as CityName[];

/** 「臺北市」「台北市」都認得;不認得回 null */
export function normalizeCity(s: string | null | undefined): CityName | null {
  const c = (s ?? "").trim().replace(/^臺/, "台");
  return c in CITY_INFO ? (c as CityName) : null;
}

export function regionOfCity(city: string): RegionKey | null {
  const c = normalizeCity(city);
  if (!c) return null;
  return REGION_KEYS.find((k) => REGIONS[k].cities.includes(c) || REGIONS[k].planned.includes(c)) ?? null;
}

/** 生活圈的外框(已開放縣市 bbox 的聯集)[w, s, e, n] */
export function regionBbox(key: RegionKey): [number, number, number, number] {
  const cs = REGIONS[key].cities.length ? REGIONS[key].cities : REGIONS[key].planned;
  const bs = cs.map((c) => CITY_INFO[c].bbox);
  return [Math.min(...bs.map((b) => b[0])), Math.min(...bs.map((b) => b[1])), Math.max(...bs.map((b) => b[2])), Math.max(...bs.map((b) => b[3]))];
}

/**
 * 座標屬於哪個生活圈(房源、我的地點依座標歸區用)。生活圈彼此離很遠,用外框判斷就夠;
 * 但「哪個縣市」不能這樣判斷(新北市包著台北市),縣市要從地址或反查地址來。
 */
export function regionAt(lat: number, lng: number): RegionKey | null {
  // 已開放 + 規劃中的縣市都算(桃園還沒開,中壢的點也要歸 north)
  return REGION_KEYS.find((k) => [...REGIONS[k].cities, ...REGIONS[k].planned].some((c) => {
    const [w, s, e, n] = CITY_INFO[c].bbox;
    return lng >= w && lng <= e && lat >= s && lat <= n;
  })) ?? null;
}

export function hasCoverage(city: string | null | undefined, what: Coverage): boolean {
  const c = normalizeCity(city);
  return !!c && (CITY_INFO[c].coverage as readonly Coverage[]).includes(what);
}

/** 生活圈裡有這項資料的縣市,例:「台北市」「台北市、新北市」;給「只有 X 有資料」這種說明用 */
export function coverageCities(what: Coverage, region: RegionKey = DEFAULT_REGION): string {
  return REGIONS[region].cities.filter((c) => hasCoverage(c, what)).join("、");
}
