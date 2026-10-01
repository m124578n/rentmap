/**
 * 家裡採集機 CLI(Node + TypeScript,和 Worker 共用 src/shared 的 Zod schema)。
 *
 *   npm run collect -- add <url> [--dry]                 抓一個物件頁(591 / 好房自動判斷)→ 推 ingest(--dry 只印 JSON)
 *   npm run collect -- list <listUrl> [--pages=1-5] [--dry] 抓列表(可多頁)→ 逐筆抓物件頁 → 每頁推一次
 *   npm run collect -- sync [--group=taipei]             每日同步(collector/searches.json);不給 group 就全部
 *   npm run collect -- bus [--dry] [--refresh]           下載雙北公車(TDX)→ 覆蓋式推入(一個月一次就好)
 *   npm run collect -- rent-stats [--seasons=4] [--dry]  下載內政部租賃實價登錄(雙北、最近 N 季)→ 推入(每季公布後一次)
 *   npm run collect -- sale-stats [--region=…] [--seasons=4] [--dry]  內政部買賣實價登錄 → sale_stats(買房行情)
 *   npm run collect -- pois [--only=food,park] [--dry]    生活機能:OSM(Overpass)+ menmap 拉麵 → 推入(一個月一次)
 *   npm run collect -- hazards [--dry]                    災害潛勢(淹水、液化)多邊形 → 推入(先跑 python scripts/build_hazards.py)
 *   npm run collect -- crime [--years=3] [--dry]           臺北市竊盜點位(門牌轉座標)+ 雙北各區件數 → 推入 / public/crime-districts.json(每季一次)
 *   npm run collect -- metro [--dry]                     下載捷運官方站間時間(TDX)→ public/mrt-times.json(進 git)
 *   npm run collect -- tra [--dry] [--date=YYYY-MM-DD]     下載台鐵車站與區間車時刻(TDX)→ public/tra.json(進 git)
 *   npm run collect -- grant <email> <pro30|pro60|pro90> <ref>   手動開通方案(收到匯款等;ref 是訂單編號,重送不會重複加)
 *   npm run collect -- revoke <ref>                        退款:取消那一筆開通(扣回天數)
 *
 * 設定讀 .env:RENTMAP_API(預設 http://localhost:5173)、INGEST_SECRET;公車另讀 TDX_CLIENT_ID / TDX_CLIENT_SECRET。
 */
import fs from "node:fs";
import path from "node:path";
import type { ImportedListing } from "../src/shared/schemas";
import { closeBrowser } from "./lib/browser";
import { sourceFor } from "./sources";

const ROOT = path.resolve(import.meta.dirname, "..");
if (fs.existsSync(path.join(ROOT, ".env"))) process.loadEnvFile(path.join(ROOT, ".env"));
const API = process.env.RENTMAP_API ?? "http://localhost:5173";
const SECRET = process.env.INGEST_SECRET ?? "";

async function fetchListing(url: string): Promise<ImportedListing> {
  const src = sourceFor(url);
  if (!src) throw new Error(`不支援的網址(目前支援 591、好房):${url}`);
  const r = await src.fetchDetail(url);
  if (r.kind === "ok") return r.listing;
  if (r.kind === "gone") throw new Error("物件不存在 / 已下架");
  throw new Error(`${r.kind}:${r.error}`);
}

async function push(items: ImportedListing[]): Promise<{ created: number; updated: number; ids: number[] }> {
  if (!SECRET) throw new Error(".env 沒有 INGEST_SECRET");
  const res = await fetch(`${API}/api/ingest/listings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}` },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) throw new Error(`ingest ${res.status}: ${await res.text()}`);
  return (await res.json()) as { created: number; updated: number; ids: number[] };
}

function summary(l: ImportedListing) {
  return `[${l.source}] ${l.title} | ${l.city}${l.district}${l.road ?? ""} | $${l.rent} | ${l.kind ?? "?"} ${l.size_ping ?? "?"}坪 ${l.rooms ?? "?"}房 | ${l.floor ?? "?"}/${l.total_floors ?? "?"}F | 電梯:${l.has_elevator ?? "?"} | ${l.lat ?? "?"},${l.lng ?? "?"}`;
}

async function main() {
  const [cmd, arg, ...rest] = process.argv.slice(2);
  const dry = rest.includes("--dry") || arg === "--dry";
  if (cmd === "add" && arg) {
    const l = await fetchListing(arg);
    console.log(summary(l));
    if (dry) return console.log(JSON.stringify(l, null, 1));
    console.log(await push([l]));
    return;
  }
  if (cmd === "list" && arg) {
    const src = sourceFor(arg);
    if (!src) throw new Error(`不支援的列表網址:${arg}`);
    const pagesArg = rest.find((r) => r.startsWith("--pages="))?.slice(8) ?? "1";
    const [a, b] = pagesArg.split("-").map(Number);
    const from = a || 1;
    const to = b ?? from;
    let total = { created: 0, updated: 0, failed: 0 };
    for (let page = from; page <= to; page++) {
      const urls = await src.listUrls(arg, page);
      console.log(`\n=== [${src.label}] 第 ${page} 頁:${urls.length} 筆 ===`);
      if (urls.length === 0) break;
      const items: ImportedListing[] = [];
      for (const u of urls) {
        try {
          const l = await fetchListing(u);
          console.log("  ✓", summary(l));
          items.push(l);
        } catch (e) {
          total.failed++;
          console.log("  ✗", u, String(e));
        }
      }
      if (dry || items.length === 0) continue;
      const r = await push(items);
      total = { ...total, created: total.created + r.created, updated: total.updated + r.updated };
      console.log(`  → 推入:新 ${r.created}、更新 ${r.updated}`);
    }
    console.log("\n合計", total);
    return;
  }
  if (cmd === "sync") {
    const { loadConfig, runSync } = await import("./sync");
    if (!SECRET) throw new Error(".env 沒有 INGEST_SECRET");
    const group = [arg, ...rest].find((r) => r?.startsWith("--group="))?.slice(8);
    await runSync({ base: API, secret: SECRET }, loadConfig(), console.log, group);
    return;
  }
  if (cmd === "bus") {
    const { runBus } = await import("./bus/index");
    await runBus({ base: API, secret: SECRET, args: [arg, ...rest].filter((x): x is string => !!x) });
    return;
  }
  if (cmd === "rent-stats") {
    const { runRentStats } = await import("./rentstats/index");
    await runRentStats({ base: API, secret: SECRET, args: [arg, ...rest].filter((x): x is string => !!x) });
    return;
  }
  if (cmd === "sale-stats") {
    const { runSaleStats } = await import("./rentstats/sale");
    await runSaleStats({ base: API, secret: SECRET, args: [arg, ...rest].filter((x): x is string => !!x) });
    return;
  }
  if (cmd === "pois") {
    const { runPois } = await import("./pois/index");
    await runPois({ base: API, secret: SECRET, args: [arg, ...rest].filter((x): x is string => !!x) });
    return;
  }
  if (cmd === "hazards") {
    const { runHazards } = await import("./hazards");
    await runHazards({ base: API, secret: SECRET, args: [arg, ...rest].filter((x): x is string => !!x) });
    return;
  }
  if (cmd === "crime") {
    const { runCrime } = await import("./crime/index");
    await runCrime({ base: API, secret: SECRET, args: [arg, ...rest].filter((x): x is string => !!x) });
    return;
  }
  if (cmd === "tra") {
    const { runTra } = await import("./tra");
    await runTra([arg, ...rest].filter((x): x is string => !!x));
    return;
  }
  if (cmd === "metro") {
    const { runMetro } = await import("./metro");
    await runMetro([arg, ...rest].filter((x): x is string => !!x));
    return;
  }
  if (cmd === "grant" || cmd === "revoke") {
    if (!SECRET) throw new Error(".env 沒有 INGEST_SECRET");
    const [email, offer, ref] = [arg, ...rest];
    const body = cmd === "grant" ? { email, offer, ref } : { ref: arg };
    if (cmd === "grant" ? !email || !offer || !ref : !arg) throw new Error("用法:collect grant <email> <pro30|pro60|pro90> <ref>|collect revoke <ref>");
    const res = await fetch(`${API}/api/ingest/plan${cmd === "revoke" ? "/revoke" : ""}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}` },
      body: JSON.stringify(body),
    });
    console.log(res.status, await res.text());
    if (!res.ok) process.exitCode = 1;
    return;
  }
  console.log("用法:collect add <url> [--dry] | collect list <listUrl> [--pages=1-5] [--dry] | collect sync [--group=taipei|newtaipei|recheck|housefun] | collect bus [--dry] | collect metro [--dry] | collect tra [--dry] | collect rent-stats [--dry] | collect sale-stats [--dry] | collect pois [--dry] | collect hazards [--dry] | collect crime [--dry] | collect grant <email> <offer> <ref> | collect revoke <ref>");
  process.exit(1);
}

main()
  .catch((e) => {
    console.error(String(e));
    process.exitCode = 1;
  })
  .finally(() => closeBrowser());
