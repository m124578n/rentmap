import { addressQueries, shortLabel, type AddressQuery } from "@shared/address";

export interface GeoHit {
  lat: number;
  lng: number;
  label: string;
  level: AddressQuery["level"];
}

// 雙北範圍(含一點邊界):left, top, right, bottom
const VIEWBOX = "121.28,25.31,122.02,24.66";
let lastAt = 0;

/**
 * 地址 → 候選座標。瀏覽器直接問 Nominatim(OSM,免金鑰;Worker 不抓外站所以不經過後端)。
 * 使用規範:1 秒最多一次、不做邊打邊查,所以只在按「搜尋」時呼叫;由細到粗試,找到就停。
 */
export async function searchAddress(input: string): Promise<GeoHit[]> {
  for (const aq of addressQueries(input)) {
    const wait = lastAt + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
    const p = new URLSearchParams({ format: "jsonv2", limit: "5", countrycodes: "tw", viewbox: VIEWBOX, bounded: "1", "accept-language": "zh-TW", q: aq.q });
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${p}`);
    if (!res.ok) throw new Error(`地址搜尋失敗(${res.status})`);
    const rows = (await res.json()) as { lat: string; lon: string; display_name: string }[];
    if (rows.length) return rows.map((r) => ({ lat: Number(r.lat), lng: Number(r.lon), label: shortLabel(r.display_name), level: aq.level }));
  }
  return [];
}
