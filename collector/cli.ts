/**
 * 家裡採集機 CLI(Node + TypeScript,和 Worker 共用 src/shared 的 Zod schema)。
 *
 *   npm run collect -- add <url> [--dry]                 抓一個物件頁(591 / 好房自動判斷)→ 推 ingest(--dry 只印 JSON)
 *   npm run collect -- list <listUrl> [--pages=1-5] [--dry] 抓列表(可多頁)→ 逐筆抓物件頁 → 每頁推一次
 *   npm run collect -- sync                              每日同步(collector/searches.json)
 *
 * 設定讀 .env:RENTMAP_API(預設 http://localhost:5173)、INGEST_SECRET。
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
    await runSync({ base: API, secret: SECRET }, loadConfig());
    return;
  }
  console.log("用法:collect add <url> [--dry] | collect list <listUrl> [--pages=1-5] [--dry] | collect sync");
  process.exit(1);
}

main()
  .catch((e) => {
    console.error(String(e));
    process.exitCode = 1;
  })
  .finally(() => closeBrowser());
