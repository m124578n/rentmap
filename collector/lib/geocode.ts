/**
 * 地址 → 座標(Nominatim / OSM,免金鑰)。好房只給到路名,所以結果是「路的中點」,精度 approx。
 * 規則:1 秒一次、帶 UA、結果存 data/geocode-cache.json(同一條路只查一次)。
 */
import fs from "node:fs";
import path from "node:path";

const CACHE = path.resolve(import.meta.dirname, "../../data/geocode-cache.json");
let cache: Record<string, { lat: number; lng: number } | null> | null = null;
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
  fs.writeFileSync(CACHE, JSON.stringify(cache, null, 0));
}

export async function geocode(query: string): Promise<{ lat: number; lng: number } | null> {
  const c = load();
  const key = query.trim();
  if (key in c) return c[key] ?? null;
  const wait = lastAt + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=tw&q=${encodeURIComponent(key)}`, {
      headers: { "User-Agent": "rent-house/0.1 (personal rental notes; local)", "Accept-Language": "zh-TW" },
      signal: AbortSignal.timeout(15000),
    });
    const arr = (await res.json()) as { lat: string; lon: string }[];
    const hit = arr[0] ? { lat: Number(arr[0].lat), lng: Number(arr[0].lon) } : null;
    c[key] = hit;
    save();
    return hit;
  } catch {
    return null; // 不寫入快取,下次再試
  }
}
