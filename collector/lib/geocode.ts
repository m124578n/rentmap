/**
 * 地址 → 座標(Nominatim / OSM,免金鑰)。好房只給到路名,所以結果是「路的中點」,精度 approx。
 * 同名路在不同區很常見(新生北路、中正路…),所以取前 5 個結果,只接受 display_name 含該行政區的;
 * 都不含就退回「縣市+行政區」(區中心),至少不會跑到別的縣市。
 * 規則:1 秒一次、帶 UA、結果存 data/geocode-cache.json(同一個 key 只查一次)。
 */
import fs from "node:fs";
import path from "node:path";

const CACHE = path.resolve(import.meta.dirname, "../../data/geocode-cache.json");
type Hit = { lat: number; lng: number; level: "road" | "district" };
let cache: Record<string, Hit | null> | null = null;
let lastAt = 0;

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(CACHE, "utf8"));
  } catch {
    cache = {};
  }
  return cache!;
}
function save() {
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, JSON.stringify(cache));
}

async function query(q: string): Promise<{ lat: number; lon: number; display_name: string }[]> {
  const wait = lastAt + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=tw&q=${encodeURIComponent(q)}`, {
    headers: { "User-Agent": "rent-house/0.1 (personal rental notes; local)", "Accept-Language": "zh-TW" },
    signal: AbortSignal.timeout(15000),
  });
  return ((await res.json()) as { lat: string; lon: string; display_name: string }[]).map((r) => ({ lat: Number(r.lat), lon: Number(r.lon), display_name: r.display_name }));
}

/** @param city 台北市 / 新北市  @param district 行政區  @param road 路名(可空) */
export async function geocode(city: string, district: string, road?: string): Promise<Hit | null> {
  const c = load();
  const key = `${city}${district}${road ?? ""}`;
  if (key in c) return c[key] ?? null;
  const cityAlt = city.replace("台", "臺"); // OSM 用「臺北市」
  const mentions = (name: string) => name.includes(district) && (name.includes(city) || name.includes(cityAlt));
  try {
    let hit: Hit | null = null;
    if (road) {
      const rs = await query(key);
      const ok = rs.find((r) => mentions(r.display_name));
      if (ok) hit = { lat: ok.lat, lng: ok.lon, level: "road" };
    }
    if (!hit) {
      const dkey = `${city}${district}`;
      const cached = c[dkey];
      if (cached !== undefined) hit = cached;
      else {
        const rs = await query(dkey);
        const ok = rs.find((r) => mentions(r.display_name)) ?? rs[0];
        hit = ok ? { lat: ok.lat, lng: ok.lon, level: "district" } : null;
        c[dkey] = hit;
      }
    }
    c[key] = hit;
    save();
    return hit;
  } catch {
    return null; // 不寫入快取,下次再試
  }
}
