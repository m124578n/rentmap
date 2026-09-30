/**
 * `npm run collect -- pois [--only=convenience,food] [--dry] [--refresh]`
 *
 * 生活機能:OpenStreetMap(Overpass)雙北一類一類抓 + menmap 拉麵店 + 雙北環保局垃圾車清運點 → 推 /api/ingest/pois(每類覆蓋式:推完該類再 commit,舊版刪掉)。
 * Overpass 公用伺服器連續查會 429 / 504:每次查詢之間歇 10 秒、失敗退避重試;餐飲量大切 3×3 塊查。
 * 原始回應快取在 data/osm/{類別}[-{塊}].json(30 天內不重抓,中斷後重跑會從沒抓完的那塊繼續;--refresh 全部重抓)。
 * 一個月跑一次就夠。
 */
import fs from "node:fs";
import path from "node:path";
import { POI_CATEGORIES, POI_CATS, type PoiCat, type PoiIn } from "../../src/shared/poi";
import { fromMenmap, fromNtpcGarbage, fromOverpass, fromTaipeiGarbage, fromYoubike, nightMarkets, overpassQuery, tiles, bboxOf, type MenmapShop, type NtpcGarbageRow, type OsmElement, type TaipeiGarbageRow, type YoubikeRow } from "./transform";

const ROOT = path.resolve(import.meta.dirname, "../..");
const CACHE_DIR = path.join(ROOT, "data", "osm");
const CACHE_DAYS = 30;
const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const MENMAP_URL = "https://menmap.shunzz.com/shops.json";
/** 垃圾車清運點:臺北市資料大平臺、新北市政府資料開放平台(每日更新) */
const TAIPEI_GARBAGE = "https://data.taipei/api/v1/dataset/a6e90031-7ec4-4089-afb5-361a4efe7202?scope=resourceAquire";
const NTPC_GARBAGE = "https://data.ntpc.gov.tw/api/datasets/edc3ad26-8ae7-4916-a00b-bc6048d19bf8/json";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  return (await res.json()) as T;
}

/** YouBike 2.0 站點:台北市(交通局即時 JSON)、新北市資料開放平台 */
const YOUBIKE_TPE = "https://tcgbusfs.blob.core.windows.net/dotapp/youbike/v2/youbike_immediate.json";
const YOUBIKE_NTPC = "https://data.ntpc.gov.tw/api/datasets/010e5b15-3823-4b20-b401-b1cf000550c5/json";
async function fetchYoubike(): Promise<PoiIn[]> {
  const tpe = await getJson<YoubikeRow[]>(YOUBIKE_TPE);
  const ntpc: YoubikeRow[] = [];
  for (let page = 0; page < 20; page++) {
    const rows = await getJson<YoubikeRow[]>(`${YOUBIKE_NTPC}?size=1000&page=${page}`);
    ntpc.push(...rows);
    if (rows.length < 1000) break;
    await sleep(1000);
  }
  const items = fromYoubike([...tpe, ...ntpc]);
  console.log(`    台北市 ${tpe.length} 站、新北市 ${ntpc.length} 站 → ${items.length}`);
  return items;
}

async function fetchGarbage(): Promise<PoiIn[]> {
  const tpe: TaipeiGarbageRow[] = [];
  for (let offset = 0; offset < 100_000; offset += 1000) {
    const page = await getJson<{ result: { count: number; results: TaipeiGarbageRow[] } }>(`${TAIPEI_GARBAGE}&limit=1000&offset=${offset}`);
    tpe.push(...page.result.results);
    if (tpe.length >= page.result.count || !page.result.results.length) break;
    await sleep(1000);
  }
  const ntpc: NtpcGarbageRow[] = [];
  for (let page = 0; page < 100; page++) {
    const rows = await getJson<NtpcGarbageRow[]>(`${NTPC_GARBAGE}?size=5000&page=${page}`);
    ntpc.push(...rows);
    if (rows.length < 5000) break;
    await sleep(1000);
  }
  const a = fromTaipeiGarbage(tpe);
  const b = fromNtpcGarbage(ntpc);
  console.log(`    台北市 ${tpe.length} 列 → ${a.length} 點;新北市 ${ntpc.length} 列 → ${b.length} 點(只收一般垃圾的點)`);
  return [...a, ...b];
}
/** 量大的類別切塊查,避免 Overpass 逾時 */
const TILES: Partial<Record<PoiCat, [number, number]>> = { food: [3, 3], park: [2, 2], school: [2, 2], worship: [2, 2], highway: [2, 2], railway: [2, 2] };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 保險:fetch 的 signal 在某些 proxy 下不會中斷讀取,另外用計時器把整個請求(含讀 body)包起來 */
function withTimeout<T>(p: Promise<T>, ms: number, ctl: AbortController): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([
    p,
    new Promise<T>((_, rej) => {
      t = setTimeout(() => {
        ctl.abort();
        rej(new Error(`逾時 ${ms / 1000} 秒`));
      }, ms);
    }),
  ]).finally(() => clearTimeout(t));
}

async function overpass(query: string): Promise<OsmElement[]> {
  for (let i = 0; i < 6; i++) {
    const url = ENDPOINTS[i % ENDPOINTS.length]!;
    try {
      const ctl = new AbortController();
      const got = await withTimeout(
        (async () => {
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "rentmap/0.1 (personal rental notes)" },
            body: new URLSearchParams({ data: query }),
            signal: ctl.signal,
          });
          return { res, body: res.ok ? await res.text() : "" };
        })(),
        240_000,
        ctl,
      );
      const res = got.res;
      if (res.ok) {
        const body = JSON.parse(got.body) as { elements?: OsmElement[]; remark?: string };
        // 逾時時 Overpass 回 200 + remark,不能當成功
        if (body.remark && /timed out|runtime error/i.test(body.remark)) throw new Error(body.remark);
        return body.elements ?? [];
      }
      if (res.status !== 429 && res.status < 500) throw new Error(`Overpass ${res.status}`);
      console.log(`    ${url} HTTP ${res.status},${30 * (i + 1)} 秒後重試`);
    } catch (e) {
      if (i === 5) throw e;
      console.log(`    ${String(e).slice(0, 120)},${30 * (i + 1)} 秒後重試`);
    }
    await sleep(30_000 * (i + 1));
  }
  throw new Error("Overpass 重試仍失敗");
}

/** 一類(可能多塊)→ 元素;有新鮮快取就用 */
async function loadCategory(cat: PoiCat, refresh: boolean): Promise<{ elements: OsmElement[]; fetched: number }> {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const [rows, cols] = TILES[cat] ?? [1, 1];
  // 目前只有 north;開其他生活圈時 pois 的覆蓋式 commit 要改成依生活圈分開(不然會刪掉別區的同類資料)
  const boxes = tiles(bboxOf("north"), rows, cols);
  const elements: OsmElement[] = [];
  let fetched = 0;
  for (let i = 0; i < boxes.length; i++) {
    const file = path.join(CACHE_DIR, boxes.length > 1 ? `${cat}-${i}.json` : `${cat}.json`);
    const fresh = fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < CACHE_DAYS * 86400_000;
    if (fresh && !refresh) {
      elements.push(...(JSON.parse(fs.readFileSync(file, "utf8")) as OsmElement[]));
      continue;
    }
    if (fetched > 0) await sleep(10_000); // 別連發
    const t0 = Date.now();
    const els = await overpass(overpassQuery(cat, boxes[i]!));
    fs.writeFileSync(file, JSON.stringify(els));
    fetched++;
    console.log(`    ${cat}${boxes.length > 1 ? ` 第 ${i + 1}/${boxes.length} 塊` : ""}:${els.length} 筆(${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    elements.push(...els);
  }
  return { elements, fetched };
}

async function post(base: string, secret: string, p: string, body: unknown) {
  const res = await fetch(`${base}/api/ingest/pois${p}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ingest pois${p} ${res.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text) as Record<string, unknown>;
}

export async function push(base: string, secret: string, version: string, cat: PoiCat, items: PoiIn[], force: boolean) {
  for (let i = 0; i < items.length; i += 2000) await post(base, secret, "", { version, items: items.slice(i, i + 2000) });
  return post(base, secret, "/commit", { version, category: cat, force });
}

export async function runPois(opts: { base: string; secret: string; args: string[] }) {
  const { args } = opts;
  const dry = args.includes("--dry");
  const refresh = args.includes("--refresh");
  const force = args.includes("--force");
  const only = args.find((a) => a.startsWith("--only="))?.slice(7).split(",").filter(Boolean);
  const cats = POI_CATS.filter((c) => !only || only.includes(c));
  if (!dry && !opts.secret) throw new Error(".env 沒有 INGEST_SECRET");
  const version = new Date().toISOString();
  let waited = false;
  const failed: string[] = [];

  for (const cat of cats) {
    let items: PoiIn[];
    try {
      if (cat === "garbage") {
        items = await fetchGarbage();
      } else if (cat === "youbike") {
        items = await fetchYoubike();
      } else if (cat === "nightmarket") {
        // 用市場的資料(快取)挑出夜市,不另外查
        items = nightMarkets(fromOverpass("market", (await loadCategory("market", false)).elements));
      } else if (cat === "ramen") {
        const res = await fetch(MENMAP_URL, { signal: AbortSignal.timeout(60_000) });
        if (!res.ok) throw new Error(`menmap ${res.status}`);
        items = fromMenmap(((await res.json()) as { shops: MenmapShop[] }).shops);
      } else {
        if (!("osm" in POI_CATEGORIES[cat])) continue;
        if (waited) await sleep(10_000);
        const { elements, fetched } = await loadCategory(cat, refresh);
        waited = fetched > 0;
        items = fromOverpass(cat, elements);
      }
    } catch (e) {
      // 一類抓不到不拖累其他類;已抓到的塊都在快取,之後 --only= 補抓會接著抓
      console.log(`  ${POI_CATEGORIES[cat].label}(${cat}):抓取失敗,先跳過 — ${String(e).slice(0, 160)}`);
      failed.push(cat);
      waited = true;
      continue;
    }
    const named = items.filter((x) => x.name).length;
    console.log(`  ${POI_CATEGORIES[cat].label}(${cat}):${items.length} 筆,有名字 ${named}`);
    if (dry) continue;
    console.log("   ", await push(opts.base, opts.secret, version, cat, items, force));
  }
  if (failed.length) throw new Error(`這些類別沒抓到,稍後再跑:npm run collect -- pois --only=${failed.join(",")}`);
}
