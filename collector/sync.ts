/**
 * 每日 sync(collector/searches.json):
 *   1. 每組搜尋條件掃前 N 頁列表。新物件、或超過 detailRefreshDays 沒檢查的 → 抓物件頁推 ingest;
 *      其餘只回報 /api/ingest/seen(更新 last_seen_at,不重抓),每天省掉幾百次抓取
 *   2. 列表沒掃到、且超過 recheck.hours 沒確認的活躍物件 → 重抓物件頁:
 *        404 → removed;頁面帶「已成交」→ parser 回 removed;正常 → 推 ingest 更新
 *   3. 印出摘要(新增 / 更新 / 下架 / 失敗 / 耗時)
 * 安全閥:同一輪裡如果物件頁「解析失敗」比例太高(可能 591 改版),就不做下架標記,避免整批誤判。
 */
import fs from "node:fs";
import path from "node:path";
import { ImportedListing } from "../src/shared/schemas";
import { fetchHtml } from "./lib/http";
import { parse591Detail, parse591List } from "./sources/five91";

interface Search {
  name: string;
  url: string;
  pages: number;
}
interface Config {
  searches: Search[];
  recheck: { hours: number; maxPerRun: number; detailRefreshDays: number };
}
interface Api {
  base: string;
  secret: string;
}

export interface SyncSummary {
  scannedUrls: number;
  skipped: number;
  created: number;
  updated: number;
  removed: number;
  rechecked: number;
  failed: number;
  parseErrors: number;
  seconds: number;
}

export function loadConfig(): Config {
  return JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "searches.json"), "utf8")) as Config;
}

async function apiJson<T>(api: Api, p: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${api.base}${p}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${api.secret}`, ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${p} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

type FetchResult = { kind: "ok"; listing: ImportedListing } | { kind: "gone" } | { kind: "parse_error"; error: string } | { kind: "net_error"; error: string };

async function fetchOne(url: string): Promise<FetchResult> {
  let status: number;
  let html: string;
  try {
    ({ status, html } = await fetchHtml(url));
  } catch (e) {
    return { kind: "net_error", error: String(e) };
  }
  if (status === 404 || status === 410) return { kind: "gone" };
  if (status !== 200) return { kind: "net_error", error: `HTTP ${status}` };
  try {
    const parsed = ImportedListing.safeParse(parse591Detail(html, url));
    if (!parsed.success) return { kind: "parse_error", error: JSON.stringify(parsed.error.issues.slice(0, 3)) };
    return { kind: "ok", listing: parsed.data };
  } catch (e) {
    return { kind: "parse_error", error: String(e) };
  }
}

export async function runSync(api: Api, cfg: Config, log: (s: string) => void = console.log): Promise<SyncSummary> {
  const t0 = Date.now();
  const sum: SyncSummary = { scannedUrls: 0, skipped: 0, created: 0, updated: 0, removed: 0, rechecked: 0, failed: 0, parseErrors: 0, seconds: 0 };
  const seen = new Set<string>(); // source_listing_id(本輪列表上看到的)

  // 先拿活躍清單,決定列表上的哪些要重抓物件頁
  const active = await apiJson<{ items: { source_listing_id: string; source_url: string | null; last_checked_at: string | null }[] }>(api, "/api/ingest/active?source=591");
  const checkedAt = new Map(active.items.map((it) => [it.source_listing_id, it.last_checked_at ? Date.parse(it.last_checked_at) : 0]));
  const freshCutoff = Date.now() - (cfg.recheck.detailRefreshDays ?? 3) * 86400_000;

  const push = async (items: ImportedListing[]) => {
    if (items.length === 0) return;
    const r = await apiJson<{ created: number; updated: number }>(api, "/api/ingest/listings", { method: "POST", body: JSON.stringify({ items }) });
    sum.created += r.created;
    sum.updated += r.updated;
    log(`  → 推入:新 ${r.created}、更新 ${r.updated}`);
  };

  // 1. 掃搜尋條件
  for (const s of cfg.searches) {
    for (let page = 1; page <= s.pages; page++) {
      const url = page === 1 ? s.url : `${s.url}${s.url.includes("?") ? "&" : "?"}page=${page}`;
      let urls: string[];
      try {
        urls = parse591List((await fetchHtml(url)).html);
      } catch (e) {
        log(`✗ 列表失敗 ${s.name} p${page}:${String(e)}`);
        sum.failed++;
        continue;
      }
      log(`=== ${s.name} 第 ${page} 頁:${urls.length} 筆 ===`);
      if (urls.length === 0) break;
      const batch: ImportedListing[] = [];
      const seenOnly: string[] = [];
      for (const u of urls) {
        sum.scannedUrls++;
        const id = u.match(/\/(\d+)$/)?.[1] ?? "";
        const last = checkedAt.get(id);
        if (last != null && last > freshCutoff) {
          // 近期檢查過、列表上還在 → 不重抓
          seen.add(id);
          seenOnly.push(id);
          sum.skipped++;
          continue;
        }
        const r = await fetchOne(u);
        if (r.kind === "ok") {
          batch.push(r.listing);
          seen.add(r.listing.source_listing_id);
        } else {
          if (r.kind === "parse_error") sum.parseErrors++;
          else if (r.kind !== "gone") sum.failed++;
          log(`  ✗ ${u} ${r.kind}${"error" in r ? " " + r.error.slice(0, 120) : ""}`);
        }
      }
      await push(batch);
      if (seenOnly.length) await apiJson(api, "/api/ingest/seen", { method: "POST", body: JSON.stringify({ source: "591", ids: seenOnly }) });
    }
  }

  // 2. 重抓沒掃到的活躍物件
  const cutoff = Date.now() - cfg.recheck.hours * 3600_000;
  const stale = active.items
    .filter((it) => !seen.has(it.source_listing_id) && (!it.last_checked_at || Date.parse(it.last_checked_at) < cutoff))
    .sort((a, b) => (a.last_checked_at ?? "").localeCompare(b.last_checked_at ?? ""))
    .slice(0, cfg.recheck.maxPerRun);
  log(`=== 重抓:活躍 ${active.items.length},列表沒掃到且逾期 ${stale.length} ===`);

  const gone: string[] = [];
  const okBatch: ImportedListing[] = [];
  for (const it of stale) {
    const url = it.source_url ?? `https://rent.591.com.tw/${it.source_listing_id}`;
    sum.rechecked++;
    const r = await fetchOne(url);
    if (r.kind === "ok") okBatch.push(r.listing);
    else if (r.kind === "gone") gone.push(it.source_listing_id);
    else if (r.kind === "parse_error") sum.parseErrors++;
    else sum.failed++;
    if (okBatch.length >= 30) {
      await push(okBatch.splice(0));
    }
  }
  await push(okBatch);

  // 安全閥:解析失敗太多 → 可能改版,不標下架
  const total = sum.scannedUrls + sum.rechecked;
  const errRate = total ? sum.parseErrors / total : 0;
  if (gone.length > 0 && errRate > 0.2) {
    log(`!! 解析失敗率 ${(errRate * 100).toFixed(0)}%,疑似 591 改版,本輪不標記 ${gone.length} 筆下架`);
  } else if (gone.length > 0) {
    const r = await apiJson<{ updated: number }>(api, "/api/ingest/status", {
      method: "POST",
      body: JSON.stringify({ items: gone.map((id) => ({ source: "591", source_listing_id: id, status: "removed" })) }),
    });
    sum.removed = r.updated;
    log(`  → 標記下架 ${r.updated} 筆`);
  }

  sum.seconds = Math.round((Date.now() - t0) / 1000);
  log(`\n合計 ${JSON.stringify(sum)}`);
  return sum;
}
