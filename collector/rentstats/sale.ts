/**
 * `npm run collect -- sale-stats [--region=…] [--seasons=4] [--dry] [--refresh]`
 *
 * 內政部不動產買賣實價登錄:跟租賃同一個季度壓縮檔(data/lvr/{季}.zip 共用快取),取 {代碼}_lvr_land_a.csv
 * → transformSale → 推 /api/ingest/sale-stats(用編號 upsert),最後刪掉比最舊一季還舊的。每季公布後跑一次(約 1、4、7、10 月)。
 */
import { CITY_INFO, collectCities } from "../../src/shared/regions";
import type { SaleStatIn } from "../../src/shared/sale";
import { loadSeason, readZipEntry, recentSeasons } from "./index";
import { transformSale } from "./transform";

async function post(base: string, secret: string, p: string, body: unknown) {
  const res = await fetch(`${base}/api/ingest/sale-stats${p}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ingest sale-stats${p} ${res.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text) as Record<string, unknown>;
}

export async function runSaleStats(opts: { base: string; secret: string; args: string[] }) {
  const { args } = opts;
  const dry = args.includes("--dry");
  const refresh = args.includes("--refresh");
  const want = Number(args.find((a) => a.startsWith("--seasons="))?.slice(10) ?? 4) || 4;

  const got: { season: string; zip: Buffer }[] = [];
  for (const s of recentSeasons(new Date(), want + 2)) {
    if (got.length >= want) break;
    const zip = await loadSeason(s, refresh && got.length === 0);
    console.log(`  ${s}:${zip ? `${(zip.length / 1e6).toFixed(1)} MB` : "還沒公布"}`);
    if (zip) got.push({ season: s, zip });
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (!got.length) throw new Error("一季都下載不到");

  const items: SaleStatIn[] = [];
  for (const { season, zip } of got)
    for (const city of collectCities(args)) {
      const file = `${CITY_INFO[city].lvr}_lvr_land_a.csv`;
      const csv = readZipEntry(zip, file);
      if (!csv) throw new Error(`${season} 找不到 ${file}`);
      const r = transformSale(city, csv.toString("utf8"));
      console.log(`  ${season} ${city}:${r.items.length} 筆(略過 ${JSON.stringify(r.skipped)})`);
      items.push(...r.items);
    }
  const dates = items.map((x) => x.date).sort();
  const byType: Record<string, number> = {};
  for (const x of items) byType[x.building_type] = (byType[x.building_type] ?? 0) + 1;
  console.log(`合計 ${items.length} 筆(${dates[0]} ~ ${dates[dates.length - 1]});${JSON.stringify(byType)}`);
  if (dry) return console.log(JSON.stringify(items.slice(0, 2), null, 1));
  if (!opts.secret) throw new Error(".env 沒有 INGEST_SECRET");

  for (let i = 0; i < items.length; i += 1000) {
    await post(opts.base, opts.secret, "", { items: items.slice(i, i + 1000) });
    process.stdout.write(`\r推入 ${Math.min(i + 1000, items.length)} / ${items.length}`);
  }
  console.log();
  console.log("prune", await post(opts.base, opts.secret, "/prune", { before: dates[0] }));
}
