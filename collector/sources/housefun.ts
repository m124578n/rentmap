/**
 * 好房快租(rent.housefun.com.tw)parser。
 *
 * 探測(2026-09-22):
 * - 純 fetch 不行(站方憑證缺 SKI + 內容靠 JS),要 Playwright。
 * - 列表 https://rent.housefun.com.tw/region/<縣市>/ 每頁約 10 筆,分頁是頁內 JS `PM(n)`(AJAX POST search.ashx),
 *   所以在 Playwright 裡 evaluate PM(n) 再等內容換掉。卡片 <article class="DataList"> 有標題 / 地址 / 格局 / 樓層 / 租金 / 坪數。
 * - 物件頁 /rent/house/<id>/:欄位是 <li class="list"><span class="title">租　　金：</span><span class="value">…</span>,
 *   「政府公開資訊」兩張表(屋齡、最短租期、開伙、養寵物…),設備 <span class="tableData has|nohas">,照片 ul.imageWrap img。
 *   沒有座標、沒有房型(整層 / 套房)→ 座標用 Nominatim 以「縣市+行政區+路名」定位;房型從標題 / 格局推。
 * - 不存在的物件導到 /errorPage?ch=rent_404。
 */
import type { ImportedListing } from "../../src/shared/schemas";

const DETAIL_URL = /^https?:\/\/rent\.housefun\.com\.tw\/rent\/house\/(\d+)\/?/;
const LIST_URL = /^https?:\/\/rent\.housefun\.com\.tw\/region\//;

export function isHousefun(url: string) {
  return DETAIL_URL.test(url) || LIST_URL.test(url);
}
export function housefunIdFromUrl(url: string): string | null {
  return url.match(DETAIL_URL)?.[1] ?? null;
}

const strip = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;|　/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const num = (s: string | undefined | null): number | undefined => {
  if (!s) return undefined;
  const m = s.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : undefined;
};

export interface HousefunListItem {
  url: string;
  id: string;
  title: string;
  address: string;
  rent?: number;
  size_ping?: number;
  layout?: string;
  floor?: string;
}

/** 列表頁 HTML → 卡片(含租金,之後可以先用租金過濾再抓物件頁) */
export function parseHousefunList(html: string): HousefunListItem[] {
  const out: HousefunListItem[] = [];
  for (const m of html.matchAll(/<article class="DataList[^"]*">([\s\S]*?)<\/article>/g)) {
    const a = m[1]!;
    const link = a.match(/<h3 class="title">\s*<a href="(\/rent\/house\/(\d+)\/)"[^>]*>([\s\S]*?)<\/a>/);
    if (!link) continue;
    const field = (label: string) => strip(a.match(new RegExp(`<span class="title">${label}：</span>\\s*<span class="infos[^"]*">([\\s\\S]*?)</span>`))?.[1] ?? "");
    out.push({
      url: `https://rent.housefun.com.tw${link[1]}`,
      id: link[2]!,
      title: strip(link[3]!),
      address: strip(a.match(/<address class="addr">([\s\S]*?)<\/address>/)?.[1] ?? ""),
      rent: num(field("租金")),
      size_ping: num(field("坪數")),
      layout: strip(a.match(/<span class="level">([\s\S]*?)<\/span>/)?.[1] ?? "") || undefined,
      floor: strip(a.match(/<span class="pattern">樓層：([\s\S]*?)<\/span>/)?.[1] ?? "") || undefined,
    });
  }
  return out;
}

/** 物件頁是否已不存在(導到 errorPage) */
export function isHousefunGone(finalUrl: string, html: string) {
  return /errorPage/.test(finalUrl) || /rent_404/.test(html.slice(0, 5000));
}

/** 物件頁 HTML → ImportedListing(座標另外 geocode;呼叫端再 Zod 驗證) */
export function parseHousefunDetail(html: string, url: string): Omit<ImportedListing, "lat" | "lng"> & { geocode_query?: string } {
  const id = housefunIdFromUrl(url);
  if (!id) throw new Error(`不是好房物件網址:${url}`);

  // 每個 <li class="list …"> 一個欄位:標題在 <span class="title">,值是其餘文字(地址用的是 <address class="value">,不能只認 span)
  const fields: Record<string, string> = {};
  for (const m of html.matchAll(/<li class="list[^"]*">([\s\S]*?)<\/li>/g)) {
    const li = m[1]!;
    const t = li.match(/<span class="title">([\s\S]*?)<\/span>/);
    if (!t) continue;
    const k = strip(t[1]!).replace(/[\s：:]/g, "");
    if (k) fields[k] = strip(li.replace(t[0], "").replace(/<a [^>]*>[\s\S]*?<\/a>/g, ""));
  }
  // 政府公開資訊表:<td class="title">屋　　齡</td><td class="value(s)">17.7年</td>
  for (const m of html.matchAll(/<td class="title">([\s\S]*?)<\/td>\s*<td class="values?">([\s\S]*?)<\/td>/g)) {
    const k = strip(m[1]!).replace(/[\s：:]/g, "");
    if (k && !(k in fields)) fields[k] = strip(m[2]!);
  }
  const equip: Record<string, boolean> = {};
  for (const m of html.matchAll(/<span class="tableData (has|nohas)">([\s\S]*?)<\/span>/g)) equip[strip(m[2]!)] = m[1] === "has";

  const titleRaw = strip(html.match(/<h2 class="title">([\s\S]*?)<\/h2>/)?.[1] ?? "");
  const title = titleRaw.replace(/\(房屋編號[:：]\s*\d+\)\s*$/, "").trim() || titleRaw || `好房 ${id}`;

  const addrRaw = (fields["地址"] ?? "").replace(/租金行情.*$/, "").trim();
  const cityM = addrRaw.match(/^(台北市|臺北市|新北市)/);
  const city = (cityM?.[1] ?? "").replace("臺", "台");
  const rest = addrRaw.slice(cityM?.[1]?.length ?? 0);
  const district = rest.match(/^(.+?區)/)?.[1] ?? "";
  const road = rest.replace(/^.+?區/, "").trim() || undefined;

  const layout = (fields["建物格局"] ?? "").match(/(\d+)房(?:\(室\))?(?:(\d+)廳)?(?:(\d+)衛)?/);
  const floor = (fields["樓層"] ?? "").match(/(\d+)\s*\/\s*(\d+)/);
  const shape = fields["型態"] ?? "";
  const buildingType = (["公寓", "電梯大樓", "華廈", "透天", "套房", "其他"] as const).find((t) => shape.includes(t)) ?? (shape ? "其他" : undefined);

  const text = `${title} ${shape}`;
  const rooms = layout ? Number(layout[1]) : undefined;
  const kind = /雅房/.test(text) ? "雅房" : /分租/.test(text) ? "分租套房" : /套房/.test(text) || (rooms === 1 && !layout?.[2]) ? "獨立套房" : rooms != null ? "整層住家" : undefined;

  const photos = [...html.matchAll(/<ul class="imageWrap both">([\s\S]*?)<\/ul>/g)]
    .flatMap((m) => [...m[1]!.matchAll(/<img src="([^"]+)"/g)].map((x) => x[1]!))
    .map((s) => (s.startsWith("//") ? "https:" + s : s))
    .map((s) => s.replace(/\/qs\/w=\d+&(amp;)?h=\d+.*$/, "/qs/w=1000&h=0"));

  const deposit = fields["押金"] ?? "";
  const depositMonths = deposit.match(/([一二兩三\d])個月/)?.[1];
  const CN: Record<string, number> = { 一: 1, 二: 2, 兩: 2, 三: 3 };
  const updated = html.match(/更新日期[:：]\s*([\d/]+\s*[\d:]*)/)?.[1];

  const raw = {
    fields,
    equip,
    kindGuess: kind,
    market_hint: undefined,
    remark_html: html.match(/<div class="(?:content|desc)[^"]*">([\s\S]{0,4000}?)<\/div>/)?.[1],
  };

  return {
    title,
    city: city as ImportedListing["city"],
    district,
    road,
    address_text: addrRaw || undefined,
    kind,
    building_type: buildingType,
    floor: floor ? Number(floor[1]) : undefined,
    total_floors: floor ? Number(floor[2]) : undefined,
    building_age: fields["屋齡"] ? Math.round(num(fields["屋齡"]) ?? NaN) || undefined : undefined,
    size_ping: num(fields["坪數"]),
    rooms,
    living_rooms: layout?.[2] ? Number(layout[2]) : undefined,
    bathrooms: layout?.[3] ? Number(layout[3]) : undefined,
    has_elevator: "電梯" in equip ? equip["電梯"] : shape.includes("電梯") ? true : undefined,
    has_parking: undefined,
    pet_allowed: fields["養寵物"] ? !/不可/.test(fields["養寵物"]) : undefined,
    cooking_allowed: fields["開伙"] ? !/不可/.test(fields["開伙"]) : undefined,
    has_washer: "洗衣機" in equip ? equip["洗衣機"] : undefined,
    has_internet: "寬頻網路" in equip ? equip["寬頻網路"] : undefined,
    mgmt_fee: undefined,
    utilities_note: fields["其他費用"] ? `另付:${fields["其他費用"]}` : undefined,
    note: undefined,
    source: "hb",
    source_url: `https://rent.housefun.com.tw/rent/house/${id}/`,
    source_listing_id: id,
    rent: num(fields["租金"]) ?? 0,
    deposit_months: depositMonths ? (CN[depositMonths] ?? Number(depositMonths)) : undefined,
    contact_name: fields["聯絡人"] && fields["聯絡人"] !== "--" ? fields["聯絡人"] : undefined,
    contact_phone: undefined, // 好房的電話要點「顯示聯絡方式」才出現,先不抓
    contact_line: undefined,
    photos,
    raw_json: JSON.stringify(raw),
    source_posted_at: undefined,
    source_updated_at: updated?.trim(),
    status: "active",
    geocode_query: city && district ? `${city}${district}${road ?? ""}` : undefined,
  };
}
