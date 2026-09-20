/**
 * 家裡採集機 CLI(Node + TypeScript,和 Worker 共用 src/shared 的 Zod schema)。
 *
 *   npm run collect -- add <url> [--dry]     抓一個物件頁 → 驗證 → 推到 /api/ingest/listings(--dry 只印 JSON)
 *   npm run collect -- list <listUrl> [--dry] 抓一頁列表 → 逐筆抓物件頁 → 推上去
 *
 * 設定讀 .env:RENT_HOUSE_API(預設 http://localhost:5173)、INGEST_SECRET。
 */
import fs from "node:fs";
import path from "node:path";
import { ImportedListing } from "../src/shared/schemas";
import { fetchHtml } from "./lib/http";
import { is591, parse591Detail, parse591List } from "./sources/five91";

const ROOT = path.resolve(import.meta.dirname, "..");
if (fs.existsSync(path.join(ROOT, ".env"))) process.loadEnvFile(path.join(ROOT, ".env"));
const API = process.env.RENT_HOUSE_API ?? "http://localhost:5173";
const SECRET = process.env.INGEST_SECRET ?? "";

async function fetchListing(url: string): Promise<ImportedListing> {
  if (!is591(url)) throw new Error(`目前只支援 591 物件頁:${url}`);
  const { status, html } = await fetchHtml(url);
  if (status !== 200) throw new Error(`HTTP ${status}`);
  const parsed = ImportedListing.safeParse(parse591Detail(html, url));
  if (!parsed.success) throw new Error(`解析結果不合 schema:${JSON.stringify(parsed.error.issues.slice(0, 5))}`);
  return parsed.data;
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
  return `${l.title} | ${l.city}${l.district}${l.road ?? ""} | $${l.rent} | ${l.size_ping ?? "?"}坪 ${l.rooms ?? "?"}房 | ${l.floor ?? "?"}/${l.total_floors ?? "?"}F | 電梯:${l.has_elevator ?? "?"} | ${l.lat},${l.lng}`;
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
    const { html } = await fetchHtml(arg);
    const urls = parse591List(html);
    console.log(`列表 ${urls.length} 筆`);
    const items: ImportedListing[] = [];
    for (const u of urls) {
      try {
        const l = await fetchListing(u);
        console.log("  ✓", summary(l));
        items.push(l);
      } catch (e) {
        console.log("  ✗", u, String(e));
      }
    }
    if (dry) return;
    console.log(await push(items));
    return;
  }
  console.log("用法:collect add <url> [--dry] | collect list <listUrl> [--dry]");
  process.exit(1);
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
