/**
 * 591 租屋 parser。
 *
 * 探測結果(2026-09-20,見 docs/design/2026-09-20-collector-spike.md):
 * - 列表頁 https://rent.591.com.tw/list?region=1&kind=1,2 與物件頁 https://rent.591.com.tw/<id>
 *   都是 Nuxt 3 SSR,純 fetch 帶一般瀏覽器 UA 就是完整 HTML,不用 Playwright。
 * - 物件頁的 <script>window.__NUXT__=(function(a,b,…){return {…}})(…)</script> 是所有結構化資料,
 *   含座標、地址、租金、格局、屋齡、電梯、設備、聯絡方式。用 node:vm 執行那段 JS 就拿到純物件。
 * - 列表頁的 JSON-LD ItemList 有該頁 30 筆物件 URL。
 */
import vm from "node:vm";
import type { ImportedListing } from "../../src/shared/schemas";

const DETAIL_URL = /^https?:\/\/rent\.591\.com\.tw\/(\d+)/;

export function is591(url: string) {
  return DETAIL_URL.test(url) || /^https?:\/\/rent\.591\.com\.tw\/list/.test(url);
}

export function listingIdFromUrl(url: string): string | null {
  return url.match(DETAIL_URL)?.[1] ?? null;
}

/** 列表頁 → 物件 URL(JSON-LD ItemList;沒有就退回掃 href) */
export function parse591List(html: string): string[] {
  const urls = new Set<string>();
  for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const j = JSON.parse(m[1]!);
      for (const node of j["@graph"] ?? [j]) {
        if (node["@type"] !== "ItemList") continue;
        for (const it of node.itemListElement ?? []) if (typeof it.url === "string" && DETAIL_URL.test(it.url)) urls.add(it.url.split("?")[0]!);
      }
    } catch {
      /* 不是合法 JSON 就跳過 */
    }
  }
  if (urls.size === 0) for (const m of html.matchAll(/https:\/\/rent\.591\.com\.tw\/(\d{6,})/g)) urls.add(`https://rent.591.com.tw/${m[1]}`);
  return [...urls];
}

/** 取出並執行 window.__NUXT__,回傳純物件 */
export function extractNuxt(html: string): unknown {
  const m = html.match(/<script>window\.__NUXT__=([\s\S]*?)<\/script>/);
  if (!m) throw new Error("找不到 window.__NUXT__(頁面改版或被擋)");
  const ctx: { window: { __NUXT__?: unknown } } = { window: {} };
  vm.runInNewContext(`window.__NUXT__=${m[1]}`, ctx, { timeout: 2000 });
  return ctx.window.__NUXT__;
}

type Detail = {
  title: string;
  status?: number;
  kind?: number;
  price?: string;
  deposit?: string;
  regionId?: number;
  sectionId?: number;
  publish?: { postTime?: string; updateTime?: string };
  info?: { name: string; value: string; key: string }[];
  infoData?: { data?: { name: string; value: string; key: string }[] };
  service?: { facility?: { key: string; active: number; name: string }[]; descData?: { label: string; value: string }[] };
  positionRound?: { address?: string; lat?: string | number; lng?: string | number; data?: { key: string; children?: { type: string; name: string; distance: number }[] }[] };
  linkInfo?: { name?: string; roleName?: string; mobile?: string; phone?: string; line?: string };
  favData?: { address?: string; price?: number; layout?: string; area?: number; kindTxt?: string; other?: { desc?: string } };
  gtm_detail_data?: { region_name?: string; section_name?: string; shape_name?: string; floor_name?: string; kind_name?: string };
  rent_calculation_data?: { manage_fee?: number; manage_fee_text?: string; water_fee_type?: string; electric_fee_type?: string; service_fee?: string };
  remark?: { content?: string };
  dealText?: string;
  dealTime?: string;
  endTime?: string;
};

function findDetail(nuxt: unknown): Detail {
  const data = (nuxt as { data?: Record<string, { data?: unknown }> })?.data ?? {};
  for (const v of Object.values(data)) {
    const d = v?.data as Detail | undefined;
    if (d && typeof d === "object" && typeof d.title === "string" && d.positionRound) return d;
  }
  throw new Error("__NUXT__ 裡找不到物件資料(可能已下架或改版)");
}

const num = (s: string | number | null | undefined): number | undefined => {
  if (s == null) return undefined;
  const n = Number(String(s).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && String(s).match(/\d/) ? n : undefined;
};

/** 物件頁 HTML → ImportedListing(尚未經 Zod 驗證,呼叫端再 parse) */
export function parse591Detail(html: string, url: string): ImportedListing {
  const id = listingIdFromUrl(url);
  if (!id) throw new Error(`不是 591 物件網址:${url}`);
  const nuxt = extractNuxt(html);
  const d = findDetail(nuxt);

  const city = d.gtm_detail_data?.region_name?.replace("臺", "台") ?? "";
  const district = d.gtm_detail_data?.section_name ?? d.positionRound?.address?.match(/^(.+?區)/)?.[1] ?? "";
  const addr = d.positionRound?.address ?? d.favData?.address?.replace(city, "") ?? "";
  const road = addr.replace(/^.+?區/, "").trim() || undefined;

  const info = Object.fromEntries((d.info ?? []).map((i) => [i.key, i.value]));
  const infoData = Object.fromEntries((d.infoData?.data ?? []).map((i) => [i.key, i.value]));
  const facility = Object.fromEntries((d.service?.facility ?? []).map((f) => [f.key, f.active === 1]));
  const desc = Object.fromEntries((d.service?.descData ?? []).map((x) => [x.label, x.value]));

  const layout = (d.favData?.layout ?? info.layout ?? "").match(/(\d+)房(?:(\d+)廳)?(?:(\d+)衛)?/);
  const floor = (info.floor ?? d.gtm_detail_data?.floor_name ?? "").match(/(\d+)F(?:\/(\d+)F)?/);
  const shape = d.gtm_detail_data?.shape_name ?? info.shape;
  const buildingType = (["公寓", "電梯大樓", "華廈", "透天", "套房", "其他"] as const).find((t) => shape?.includes(t === "透天" ? "透天" : t)) ?? (shape ? "其他" : undefined);

  const mrt = d.positionRound?.data?.find((g) => g.key === "traffic")?.children?.find((c) => c.type === "subway");
  const lat = num(d.positionRound?.lat);
  const lng = num(d.positionRound?.lng);
  const kindTxt = d.favData?.kindTxt ?? d.gtm_detail_data?.kind_name;

  const raw = {
    kind: d.kind,
    kindTxt,
    tags: (d as { tags?: { value: string }[] }).tags?.map((t) => t.value),
    info,
    infoData,
    facility,
    desc,
    market_hint: d.favData?.other?.desc,
    mrt: mrt ? { name: mrt.name, distance_m: mrt.distance } : undefined,
    fees: d.rent_calculation_data,
    linkInfo: { name: d.linkInfo?.name, role: d.linkInfo?.roleName },
    remark_html: d.remark?.content,
    deal: d.dealText || undefined,
  };

  return {
    title: d.title,
    city: city as ImportedListing["city"],
    district,
    road,
    address_text: addr || undefined,
    lat,
    lng,
    building_type: buildingType,
    floor: floor ? Number(floor[1]) : undefined,
    total_floors: floor?.[2] ? Number(floor[2]) : undefined,
    building_age: num(infoData.age),
    size_ping: num(info.area) ?? d.favData?.area,
    rooms: layout ? Number(layout[1]) : kindTxt?.includes("套房") ? 1 : undefined,
    living_rooms: layout?.[2] ? Number(layout[2]) : undefined,
    bathrooms: layout?.[3] ? Number(layout[3]) : undefined,
    has_elevator: infoData.lift ? infoData.lift === "有" : facility.lift,
    has_parking: facility.park,
    pet_allowed: desc["養寵物"] ? !desc["養寵物"].includes("不可") : undefined,
    cooking_allowed: desc["開伙"] ? !desc["開伙"].includes("不可") : undefined,
    has_washer: facility.washer,
    has_internet: facility.net,
    mgmt_fee: d.rent_calculation_data?.manage_fee || (d.rent_calculation_data?.manage_fee_text === "無" ? 0 : undefined),
    utilities_note: [d.rent_calculation_data?.water_fee_type && `水:${d.rent_calculation_data.water_fee_type}`, d.rent_calculation_data?.electric_fee_type && `電:${d.rent_calculation_data.electric_fee_type}`]
      .filter(Boolean)
      .join(" ") || undefined,
    note: undefined,
    source: "591",
    source_url: `https://rent.591.com.tw/${id}`,
    source_listing_id: id,
    rent: num(d.favData?.price ?? d.price) ?? 0,
    deposit_months: parseDepositMonths(d.deposit),
    contact_name: d.linkInfo?.name?.replace(/^(仲介|屋主|房東|代理人):\s*/, "") || undefined,
    contact_phone: d.linkInfo?.mobile || d.linkInfo?.phone || undefined,
    contact_line: d.linkInfo?.line || undefined,
    photos: extractPhotos(html),
    raw_json: JSON.stringify(raw),
    source_posted_at: d.publish?.postTime || undefined,
    source_updated_at: d.publish?.updateTime || undefined,
    status: d.dealText || d.status === 0 ? "removed" : "active",
  };
}

const CN_NUM: Record<string, number> = { 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
function parseDepositMonths(s?: string): number | undefined {
  if (!s) return undefined;
  const m = s.match(/([一二兩三四五六\d.]+)個月/);
  if (!m) return undefined;
  const t = m[1]!;
  return CN_NUM[t] ?? (Number.isFinite(Number(t)) ? Number(t) : undefined);
}

/** JSON-LD 的 image 陣列;去掉尺寸後綴的重複 */
function extractPhotos(html: string): string[] {
  const m = html.match(/<script id="rent-detail-structured-data"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return [];
  try {
    const j = JSON.parse(m[1]!);
    const seen = new Set<string>();
    for (const node of j["@graph"] ?? [j]) {
      for (const img of node.image ?? []) {
        if (typeof img !== "string") continue;
        const base = img.replace(/!.*$/, "");
        if (!seen.has(base)) seen.add(base);
      }
    }
    return [...seen].map((b) => `${b}!1000x.water2.jpg`);
  } catch {
    return [];
  }
}
