/**
 * `npm run collect -- rent-stats [--seasons=4] [--dry] [--refresh]`
 *
 * 從內政部不動產成交案件實際資訊(plvr.land.moi.gov.tw)下載最近 N 季的全國 CSV 壓縮檔,
 * 取雙北租賃(a_lvr_land_c.csv 臺北市、f_lvr_land_c.csv 新北市)→ transform → 推 /api/ingest/rent-stats(用編號 upsert),
 * 最後刪掉比最舊一季還舊的資料。季度檔快取在 data/lvr/{季}.zip(--refresh 重抓)。每季公布後跑一次就好(約 1、4、7、10 月)。
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import type { RentStatIn } from "../../src/shared/market";
import { transformRent } from "./transform";
import { CITY_INFO, collectCities } from "../../src/shared/regions";

const ROOT = path.resolve(import.meta.dirname, "../..");
const CACHE_DIR = path.join(ROOT, "data", "lvr");
const url = (season: string) => `https://plvr.land.moi.gov.tw/DownloadSeason?season=${season}&type=zip&fileName=lvr_landcsv.zip`;
/** 已開放縣市的租賃檔(a_lvr_land_c.csv = 台北市 …,代碼在 regions.ts) */
const filesOf = (args: string[]) => collectCities(args).map((city) => ({ file: `${CITY_INFO[city].lvr}_lvr_land_c.csv`, city }));

/** 從現在這季往回數:115S3、115S2、115S1、114S4… */
export function recentSeasons(now: Date, n: number): string[] {
  let y = now.getFullYear() - 1911;
  let q = Math.floor(now.getMonth() / 3) + 1;
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push(`${y}S${q}`);
    if (--q === 0) {
      q = 4;
      y--;
    }
  }
  return out;
}

/** 讀 zip 裡指定的檔(只支援 stored / deflate,實價登錄的檔夠用) */
export function readZipEntry(zip: Buffer, name: string): Buffer | null {
  // 找中央目錄結尾(EOCD)
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--)
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error("不是 zip 檔");
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error("zip 中央目錄壞了");
    const method = zip.readUInt16LE(p + 10);
    const csize = zip.readUInt32LE(p + 20);
    const nlen = zip.readUInt16LE(p + 28);
    const elen = zip.readUInt16LE(p + 30);
    const clen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const entry = zip.subarray(p + 46, p + 46 + nlen).toString("utf8");
    if (entry === name || entry.endsWith(`/${name}`)) {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + csize);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return zlib.inflateRawSync(data);
      throw new Error(`zip 壓縮方式 ${method} 不支援`);
    }
    p += 46 + nlen + elen + clen;
  }
  return null;
}

async function loadSeason(season: string, refresh: boolean): Promise<Buffer | null> {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, `${season}.zip`);
  if (fs.existsSync(file) && !refresh) return fs.readFileSync(file);
  const res = await fetch(url(season), { signal: AbortSignal.timeout(300_000) });
  const buf = Buffer.from(await res.arrayBuffer());
  // 還沒公布的季:回 200 但內容是網頁,不是 zip
  if (!res.ok || buf.length < 1000 || buf.readUInt32LE(0) !== 0x04034b50) return null;
  fs.writeFileSync(file, buf);
  return buf;
}

async function post(base: string, secret: string, p: string, body: unknown) {
  const res = await fetch(`${base}/api/ingest/rent-stats${p}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ingest rent-stats${p} ${res.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text) as Record<string, unknown>;
}

export async function runRentStats(opts: { base: string; secret: string; args: string[] }) {
  const { args } = opts;
  const dry = args.includes("--dry");
  const refresh = args.includes("--refresh");
  const want = Number(args.find((a) => a.startsWith("--seasons="))?.slice(10) ?? 4) || 4;

  // 最新一季常還沒公布,多往回看兩季
  const got: { season: string; zip: Buffer }[] = [];
  for (const s of recentSeasons(new Date(), want + 2)) {
    if (got.length >= want) break;
    const zip = await loadSeason(s, refresh && got.length === 0);
    console.log(`  ${s}:${zip ? `${(zip.length / 1e6).toFixed(1)} MB` : "還沒公布"}`);
    if (zip) got.push({ season: s, zip });
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (!got.length) throw new Error("一季都下載不到");

  const items: RentStatIn[] = [];
  for (const { season, zip } of got)
    for (const { file, city } of filesOf(args)) {
      const csv = readZipEntry(zip, file);
      if (!csv) throw new Error(`${season} 找不到 ${file}`);
      const r = transformRent(city, csv.toString("utf8"));
      console.log(`  ${season} ${city}:${r.items.length} 筆(略過 ${JSON.stringify(r.skipped)})`);
      items.push(...r.items);
    }
  const byKind: Record<string, number> = {};
  for (const x of items) byKind[x.kind ?? "?"] = (byKind[x.kind ?? "?"] ?? 0) + 1;
  const dates = items.map((x) => x.date).sort();
  console.log(`合計 ${items.length} 筆(${dates[0]} ~ ${dates[dates.length - 1]});社宅包租代管 ${items.filter((x) => x.social).length}、含車位 ${items.filter((x) => x.has_parking).length};${JSON.stringify(byKind)}`);
  if (dry) return console.log(JSON.stringify(items.slice(0, 2), null, 1));
  if (!opts.secret) throw new Error(".env 沒有 INGEST_SECRET");

  for (let i = 0; i < items.length; i += 1000) {
    await post(opts.base, opts.secret, "", { items: items.slice(i, i + 1000) });
    process.stdout.write(`\r推入 ${Math.min(i + 1000, items.length)} / ${items.length}`);
  }
  console.log();
  console.log("prune", await post(opts.base, opts.secret, "/prune", { before: dates[0] }));
}
