import { addressQueries, rankHits, shortLabel, type AddressQuery } from "@shared/address";

export interface GeoHit {
  lat: number;
  lng: number;
  label: string;
  level: AddressQuery["level"];
}

let lastAt = 0;

/**
 * 地址 → 候選座標。瀏覽器直接問 Nominatim(OSM,免金鑰;Worker 不抓外站所以不經過後端)。
 * 使用規範:1 秒最多一次、不做邊打邊查,所以只在按「搜尋」時呼叫;由細到粗試,找到就停。
 */
/** @param bbox 只在這個範圍找(目前生活圈,regionBbox)[w, s, e, n] */
export async function searchAddress(input: string, bbox: [number, number, number, number]): Promise<GeoHit[]> {
  const viewbox = `${bbox[0]},${bbox[3]},${bbox[2]},${bbox[1]}`; // Nominatim:left, top, right, bottom
  for (const aq of addressQueries(input)) {
    const wait = lastAt + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
    const p = new URLSearchParams({ format: "jsonv2", limit: "5", countrycodes: "tw", viewbox, bounded: "1", "accept-language": "zh-TW", q: aq.q });
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${p}`);
    if (!res.ok) throw new Error(`地址搜尋失敗(${res.status})`);
    // Nominatim 常把附近的大路排第一,只留路名對得上的
    const rows = rankHits(aq.q, (await res.json()) as { lat: string; lon: string; display_name: string }[]);
    if (rows.length) return rows.map((r) => ({ lat: Number(r.lat), lng: Number(r.lon), label: shortLabel(r.display_name), level: aq.level }));
  }
  return [];
}

export interface ReverseHit {
  label: string;
  /** 台北市 / 新北市 …(臺 統一成 台);查不到是 "" */
  city: string;
  district: string;
}

/** 座標 → 地址(地圖「看附近」用);同樣 1 秒最多一次 */
export async function reverseGeocode(lat: number, lng: number): Promise<ReverseHit> {
  const wait = lastAt + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  const p = new URLSearchParams({ format: "jsonv2", zoom: "18", "accept-language": "zh-TW", lat: lat.toFixed(6), lon: lng.toFixed(6) });
  const res = await fetch(`https://nominatim.openstreetmap.org/reverse?${p}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`地址查詢失敗(${res.status})`);
  const j = (await res.json()) as { display_name?: string; address?: Record<string, string> };
  const a = j.address ?? {};
  const city = (a.city ?? a.state ?? a.county ?? "").replace("臺", "台");
  const district = a.suburb ?? a.city_district ?? a.town ?? "";
  const road = [a.road, a.house_number ? `${a.house_number}號` : ""].join("");
  return { label: `${city}${district}${road}` || (j.display_name ? shortLabel(j.display_name) : ""), city, district };
}
