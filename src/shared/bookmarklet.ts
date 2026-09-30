/**
 * 瀏覽器書籤小工具(方向文件 §5.2):使用者在 591 物件頁按一下書籤,由**他自己的瀏覽器**讀出頁面上的事實欄位,
 * 開新分頁到 /new#import=…(資料放在 # 後面,不經過伺服器),在表單上確認後才存。伺服器不碰外站。
 *
 * 只取事實:租金、坪數、樓層、格局、地址 / 座標、電梯、寵物、開伙、管理費、水電計價、來源連結。
 * 不取:照片、屋況介紹文字、房東 / 仲介姓名電話。
 *
 * extractFacts 會用 Function.prototype.toString() 塞進 javascript: 網址(src/client/lib/bookmarklet.ts),
 * 所以**不能引用函式以外的任何東西**,型別之外一律寫在函式裡面。
 */

/** 書籤帶過來的欄位(都是選填;表單上使用者再確認) */
export interface ImportedFacts {
  title?: string;
  city?: string;
  district?: string;
  road?: string;
  address_text?: string;
  lat?: number;
  lng?: number;
  kind?: string;
  building_type?: string;
  floor?: number;
  total_floors?: number;
  building_age?: number;
  size_ping?: number;
  rooms?: number;
  living_rooms?: number;
  bathrooms?: number;
  has_elevator?: boolean;
  has_parking?: boolean;
  pet_allowed?: boolean;
  cooking_allowed?: boolean;
  has_washer?: boolean;
  has_internet?: boolean;
  mgmt_fee?: number;
  deposit_months?: number;
  utilities_note?: string;
  rent?: number;
  source?: string;
  source_url?: string;
}

/** 591 物件頁的 window.__NUXT__ → 事實欄位;不是 591 或找不到資料回 null */
export function extractFacts(nuxt: unknown, url: string): ImportedFacts | null {
  const id = (url.match(/^https?:\/\/rent\.591\.com\.tw\/(\d+)/) || [])[1];
  if (!id || !nuxt || typeof nuxt !== "object") return null;
  type KV = { key: string; value: string };
  type D = {
    title: string;
    price?: string;
    deposit?: string;
    info?: KV[];
    infoData?: { data?: KV[] };
    service?: { facility?: { key: string; active: number }[]; descData?: { label: string; value: string }[] };
    positionRound?: { address?: string; lat?: string | number; lng?: string | number };
    favData?: { address?: string; price?: number; layout?: string; area?: number; kindTxt?: string };
    gtm_detail_data?: { region_name?: string; section_name?: string; shape_name?: string; floor_name?: string; kind_name?: string };
    rent_calculation_data?: { manage_fee?: number; manage_fee_text?: string; water_fee_type?: string; water_fee?: number; electric_fee_type?: string; electric_fee?: number };
  };
  let d: D | null = null;
  const data = (nuxt as { data?: Record<string, { data?: unknown }> }).data || {};
  for (const k of Object.keys(data)) {
    const v = data[k] && (data[k]!.data as D | undefined);
    if (v && typeof v === "object" && typeof v.title === "string" && v.positionRound) {
      d = v;
      break;
    }
  }
  if (!d) return null;
  const num = (s: unknown): number | undefined => {
    if (s == null || !/\d/.test(String(s))) return undefined;
    const n = Number(String(s).replace(/[^\d.]/g, ""));
    return Number.isFinite(n) ? n : undefined;
  };
  const toMap = (xs: KV[] | undefined) => {
    const o: Record<string, string> = {};
    for (const x of xs || []) o[x.key] = x.value;
    return o;
  };
  const info = toMap(d.info);
  const infoData = toMap(d.infoData && d.infoData.data);
  const facility: Record<string, boolean> = {};
  for (const f of (d.service && d.service.facility) || []) facility[f.key] = f.active === 1;
  const desc: Record<string, string> = {};
  for (const x of (d.service && d.service.descData) || []) desc[x.label] = x.value;
  const g = d.gtm_detail_data || {};
  const city = (g.region_name || "").replace("臺", "台");
  const addr = (d.positionRound && d.positionRound.address) || ((d.favData && d.favData.address) || "").replace(city, "");
  const district = g.section_name || (addr.match(/^(.+?區)/) || [])[1] || "";
  const layout = ((d.favData && d.favData.layout) || info.layout || "").match(/(\d+)房(?:(\d+)廳)?(?:(\d+)衛)?/);
  const floor = (info.floor || g.floor_name || "").match(/(\d+)F(?:\/(\d+)F)?/);
  const shape = g.shape_name || info.shape;
  const types = ["公寓", "電梯大樓", "華廈", "透天", "套房"];
  const kindTxt = (d.favData && d.favData.kindTxt) || g.kind_name;
  const kinds = ["整層住家", "獨立套房", "分租套房", "雅房"];
  const fee = d.rent_calculation_data || {};
  const water = fee.water_fee_type ? `水:${fee.water_fee_type}${fee.water_fee ? ` ${fee.water_fee}元/月` : ""}` : "";
  const elec = fee.electric_fee_type ? `電:${fee.electric_fee && !/[臺台]電/.test(fee.electric_fee_type) ? `每度${fee.electric_fee}元` : fee.electric_fee_type}` : "";
  const cn: Record<string, number> = { 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
  const dep = ((d.deposit || "").match(/([一二兩三四五六\d.]+)個月/) || [])[1];
  const yes = (s: string | undefined) => (s ? !s.includes("不可") : undefined);
  const out: ImportedFacts = {
    title: d.title,
    city,
    district,
    road: addr.replace(/^.+?區/, "").trim() || undefined,
    address_text: addr || undefined,
    lat: num(d.positionRound && d.positionRound.lat),
    lng: num(d.positionRound && d.positionRound.lng),
    kind: kinds.find((k) => kindTxt && kindTxt.includes(k)) || (kindTxt ? "其他" : undefined),
    building_type: types.find((t) => shape && shape.includes(t)) || (shape ? "其他" : undefined),
    floor: floor ? Number(floor[1]) : undefined,
    total_floors: floor && floor[2] ? Number(floor[2]) : undefined,
    building_age: num(infoData.age),
    size_ping: num(info.area) ?? (d.favData && d.favData.area),
    rooms: layout ? Number(layout[1]) : kindTxt && kindTxt.includes("套房") ? 1 : undefined,
    living_rooms: layout && layout[2] ? Number(layout[2]) : undefined,
    bathrooms: layout && layout[3] ? Number(layout[3]) : undefined,
    has_elevator: infoData.lift ? infoData.lift === "有" : facility.lift,
    has_parking: facility.park,
    pet_allowed: yes(desc["養寵物"]),
    cooking_allowed: yes(desc["開伙"]),
    has_washer: facility.washer,
    has_internet: facility.net,
    mgmt_fee: fee.manage_fee || (fee.manage_fee_text === "無" ? 0 : undefined),
    deposit_months: dep ? (cn[dep] ?? (Number.isFinite(Number(dep)) ? Number(dep) : undefined)) : undefined,
    utilities_note: [water, elec].filter(Boolean).join(" ") || undefined,
    rent: num((d.favData && d.favData.price) ?? d.price),
    source: "591",
    source_url: `https://rent.591.com.tw/${id}`,
  };
  for (const k of Object.keys(out) as (keyof ImportedFacts)[]) if (out[k] === undefined) delete out[k];
  return out;
}

/** /new#import=… → 欄位;壞掉的回 null */
export function parseImportHash(hash: string): ImportedFacts | null {
  const m = hash.match(/(?:^#|&)import=([^&]*)/);
  if (!m) return null;
  try {
    const v = JSON.parse(decodeURIComponent(m[1]!));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as ImportedFacts) : null;
  } catch {
    return null;
  }
}
