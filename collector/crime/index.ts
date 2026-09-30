/**
 * npm run collect -- crime [--years=3] [--dry] [--force] [--limit=N]
 *
 * 臺北市住宅 / 機車 / 汽車竊盜點位 → 巷 / 路段轉座標(Nominatim,1 秒一次,快取 data/geocode-cache.json;第一次約 20–40 分鐘,
 * 之後只查新的)→ 推入 pois(theft_house / theft_moto / theft_car,每類覆蓋式)。
 * 雙北各區近一年件數(臺北市點位 + 新北市「犯罪資料」)→ public/crime-districts.json(進 git,面板比較各區用)。
 * 原始 CSV 快取 data/crime/(30 天內不重抓)。資料約每季更新,跟著實價登錄一起跑就好。
 */
import fs from "node:fs";
import path from "node:path";
import type { PoiCat, PoiIn } from "../../src/shared/poi";
import { geocode } from "../lib/geocode";
import { push } from "../pois/index";
import { districtStats, parseNpaCrime, parseNtpcCrime, parseTaipeiTheft, THEFT_KINDS, type CrimeDistricts, type NpaCrimeRow, type TaipeiTheftRow, type TheftKind } from "./transform";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DIR = path.join(ROOT, "data", "crime");
const TP_URL: Record<TheftKind, string> = {
  house: "https://data.taipei/api/dataset/68785231-d6c5-47a1-b001-77eec70bec02/resource/93d9bc2d-af08-4db7-a56b-9f0a49226fa3/download",
  car: "https://data.taipei/api/dataset/f87ad53e-79c7-48c4-aec4-f0fd8f99bfb2/resource/967faed7-ea9b-4698-970a-d335d5e4ccc3/download",
  moto: "https://data.taipei/api/dataset/3a0e2289-a605-4eac-af30-f4af613f456d/resource/ac508aeb-9f26-409c-9fb0-20c65a973498/download",
};
const NTPC_URL = "https://data.ntpc.gov.tw/api/datasets/8a32c6b5-46fc-4fac-b3a4-317b9998bfd7/csv/file";
/** 警政署全國「犯罪資料」(data.gov.tw 14200):每季一個 CSV,從資料集的中繼資料找最近幾季的下載網址 */
const NPA_META = "https://data.gov.tw/api/v2/rest/dataset/14200";
export const CRIME_CAT: Record<TheftKind, PoiCat> = { house: "theft_house", moto: "theft_moto", car: "theft_car" };

/** 下載(30 天內用快取);臺北市是 Big5 */
async function fetchText(url: string, file: string, encoding: "big5" | "utf-8" | "auto"): Promise<string> {
  const p = path.join(DIR, file);
  if (!fs.existsSync(p) || Date.now() - fs.statSync(p).mtimeMs > 30 * 86400_000) {
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`${file} ${res.status}`);
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(p, Buffer.from(await res.arrayBuffer()));
  }
  const buf = fs.readFileSync(p);
  if (encoding !== "auto") return new TextDecoder(encoding).decode(buf);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("big5").decode(buf);
  }
}

/** 警政署全國資料最近 quarters 季(雙北以外的縣市算各區件數用) */
async function fetchNpa(quarters = 4): Promise<NpaCrimeRow[]> {
  const res = await fetch(NPA_META, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`data.gov.tw ${res.status}`);
  const meta = (await res.json()) as { result?: { distribution?: { resourceDescription?: string; resourceDownloadUrl?: string }[] } };
  const files = (meta.result?.distribution ?? [])
    .map((d) => ({ range: /^\d{5}-\d{5}/.exec(d.resourceDescription ?? "")?.[0], url: d.resourceDownloadUrl }))
    .filter((x): x is { range: string; url: string } => !!x.range && !!x.url)
    .sort((a, b) => a.range.localeCompare(b.range))
    .slice(-quarters);
  if (!files.length) throw new Error("資料集裡找不到每季的檔");
  const rows: NpaCrimeRow[] = [];
  for (const f of files) rows.push(...parseNpaCrime(await fetchText(f.url, `npa_${f.range}.csv`, "auto")));
  console.log(`警政署全國犯罪資料 ${files[0]!.range.slice(0, 5)}~${files.at(-1)!.range.slice(6)}:${rows.length} 列(regions.ts 有列的縣市)`);
  return rows;
}

async function locate(r: TaipeiTheftRow) {
  for (const q of r.queries) {
    const hit = await geocode("台北市", r.district, q);
    if (hit?.level === "road") return { ...hit, precision: q.endsWith("巷") ? "巷" : "路段" };
  }
  return null;
}

export async function runCrime(opts: { base: string; secret: string; args: string[] }) {
  const { args } = opts;
  const dry = args.includes("--dry");
  const force = args.includes("--force");
  const years = Number(args.find((a) => a.startsWith("--years="))?.slice(8) ?? 3);
  const limit = Number(args.find((a) => a.startsWith("--limit="))?.slice(8) ?? Infinity);
  if (!dry && !opts.secret) throw new Error(".env 沒有 INGEST_SECRET");

  const tp: TaipeiTheftRow[] = [];
  for (const k of THEFT_KINDS) tp.push(...parseTaipeiTheft(await fetchText(TP_URL[k], `tp_${k}.csv`, "big5"), k));
  const ntpc = parseNtpcCrime(await fetchText(NTPC_URL, "ntpc.csv", "utf-8"));

  // 各區近一年 → public/crime-districts.json
  const out = path.join(ROOT, "public", "crime-districts.json");
  let npa: NpaCrimeRow[] = [];
  try {
    npa = await fetchNpa();
  } catch (e) {
    console.log(`警政署全國犯罪資料抓不到,雙北以外沿用上次的件數 — ${String(e).slice(0, 120)}`);
  }
  const stats = districtStats(tp, ntpc, npa);
  if (!npa.length && fs.existsSync(out)) {
    const prev = JSON.parse(fs.readFileSync(out, "utf8")) as CrimeDistricts;
    for (const [k, v] of Object.entries(prev.items)) if (!/^(台北市|新北市)\|/.test(k)) stats.items[k] = v;
    if (prev.periods) stats.periods = prev.periods;
  }
  fs.writeFileSync(out, JSON.stringify(stats) + "\n");
  console.log(`各區近一年(${stats.from}~${stats.to}):${Object.keys(stats.items).length} 區 → ${path.relative(ROOT, out)}(新北市沒寫區的 ${stats.ntpc_unknown} 件不算)`);

  // 臺北市近 N 年的點
  const last = tp.reduce((m, r) => (r.date > m ? r.date : m), "");
  const since = `${Number(last.slice(0, 4)) - years}${last.slice(4)}`;
  const recent = tp.filter((r) => r.date > since).slice(0, limit);
  console.log(`臺北市近 ${years} 年(${since} 以後):${recent.length} 件,轉座標中(新的地址 1 秒一筆)…`);
  const items: Record<TheftKind, PoiIn[]> = { house: [], moto: [], car: [] };
  let miss = 0;
  for (const [i, r] of recent.entries()) {
    const hit = await locate(r);
    if (!hit) {
      miss++;
      continue;
    }
    items[r.kind].push({
      key: `${r.kind}:${r.id}`,
      category: CRIME_CAT[r.kind],
      subtype: hit.precision,
      name: `${r.district}${r.queries[0]!}`,
      lat: Math.round(hit.lat * 1e6) / 1e6,
      lng: Math.round(hit.lng * 1e6) / 1e6,
      rating: null,
      url: null,
      note: `${r.date.slice(0, 7)} · ${r.slot} 時`,
    });
    if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${recent.length}`);
  }
  console.log(`轉不到座標(只到區)的 ${miss} 件略過`);
  const version = new Date().toISOString();
  for (const k of THEFT_KINDS) {
    console.log(`  ${CRIME_CAT[k]}:${items[k].length} 筆`);
    if (!dry && items[k].length) console.log("   ", await push(opts.base, opts.secret, version, CRIME_CAT[k], items[k], force));
  }
}
