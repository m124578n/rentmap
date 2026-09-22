/**
 * 每日 sync(collector/searches.json),各來源共用同一套流程:
 *   1. 每組搜尋條件掃前 N 頁列表。新物件、或超過 detailRefreshDays 沒檢查的 → 抓物件頁推 ingest;
 *      其餘只回報 /api/ingest/seen(更新 last_seen_at,不重抓),每天省掉幾百次抓取
 *   2. 列表沒掃到、且超過 recheck.hours 沒確認的活躍物件 → 重抓物件頁:
 *        不存在 → removed;頁面帶「已成交」→ parser 回 removed;正常 → 推 ingest 更新
 *   3. 印出摘要(新增 / 更新 / 下架 / 失敗 / 耗時)
 * 安全閥:同一來源本輪「解析失敗」比例太高(可能改版),就不做下架標記,避免整批誤判。
 */
import fs from "node:fs";
import path from "node:path";
import type { ImportedListing } from "../src/shared/schemas";
import { sourceById, type Source } from "./sources";

interface Search {
  name: string;
  source?: string; // 預設 591
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
interface ActiveItem {
  source_listing_id: string;
  source_url: string | null;
  last_checked_at: string | null;
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

export async function runSync(api: Api, cfg: Config, log: (s: string) => void = console.log): Promise<SyncSummary> {
  const t0 = Date.now();
  const sum: SyncSummary = { scannedUrls: 0, skipped: 0, created: 0, updated: 0, removed: 0, rechecked: 0, failed: 0, parseErrors: 0, seconds: 0 };
  const freshCutoff = Date.now() - (cfg.recheck.detailRefreshDays ?? 3) * 86400_000;
  const staleCutoff = Date.now() - cfg.recheck.hours * 3600_000;

  const push = async (items: ImportedListing[]) => {
    if (items.length === 0) return;
    const r = await apiJson<{ created: number; updated: number }>(api, "/api/ingest/listings", { method: "POST", body: JSON.stringify({ items }) });
    sum.created += r.created;
    sum.updated += r.updated;
    log(`  → 推入:新 ${r.created}、更新 ${r.updated}`);
  };

  // 依來源分組處理(各來源自己的活躍清單、seen、下架)
  const bySource = new Map<Source, Search[]>();
  for (const s of cfg.searches) {
    const src = sourceById(s.source ?? "591");
    if (!src) {
      log(`✗ 未知來源 ${s.source}:${s.name}`);
      continue;
    }
    bySource.set(src, [...(bySource.get(src) ?? []), s]);
  }

  for (const [src, searches] of bySource) {
    const seen = new Set<string>();
    let parseErrors = 0;
    let fetched = 0;
    let consecutiveNet = 0;
    let tripped = false; // 斷路器:連續網路失敗 / 被擋就停掉這個來源,不再硬打
    const active = await apiJson<{ items: ActiveItem[] }>(api, `/api/ingest/active?source=${src.id}`);
    const checkedAt = new Map(active.items.map((it) => [it.source_listing_id, it.last_checked_at ? Date.parse(it.last_checked_at) : 0]));

    const fetchInto = async (url: string, batch: ImportedListing[], gone: string[]) => {
      fetched++;
      const r = await src.fetchDetail(url);
      if (r.kind === "ok") {
        batch.push(r.listing);
        seen.add(r.listing.source_listing_id);
      } else if (r.kind === "gone") {
        const id = src.idFromUrl(url);
        if (id) gone.push(id);
      } else {
        if (r.kind === "parse_error") {
          parseErrors++;
          sum.parseErrors++;
        } else sum.failed++;
        log(`  ✗ ${url} ${r.kind} ${r.error.slice(0, 120)}`);
      }
      if (r.kind === "net_error") {
        consecutiveNet++;
        if (/blocked/.test(r.error) || consecutiveNet >= 3) {
          tripped = true;
          log(`!! [${src.label}] 連續失敗 / 被擋,本輪停止這個來源`);
        }
      } else consecutiveNet = 0;
    };

    // 1. 掃列表
    for (const s of searches) {
      if (tripped) break;
      for (let page = 1; page <= s.pages; page++) {
        if (tripped) break;
        let urls: string[];
        try {
          urls = await src.listUrls(s.url, page);
        } catch (e) {
          log(`✗ 列表失敗 ${s.name} p${page}:${String(e).slice(0, 120)}`);
          sum.failed++;
          if (/blocked/.test(String(e)) || ++consecutiveNet >= 3) {
            tripped = true;
            log(`!! [${src.label}] 列表連續失敗 / 被擋,本輪停止這個來源`);
          }
          continue;
        }
        log(`=== [${src.label}] ${s.name} 第 ${page} 頁:${urls.length} 筆 ===`);
        if (urls.length === 0) break;
        const batch: ImportedListing[] = [];
        const seenOnly: string[] = [];
        const gone: string[] = [];
        for (const u of urls) {
          if (tripped) break;
          sum.scannedUrls++;
          const id = src.idFromUrl(u) ?? "";
          const last = checkedAt.get(id);
          if (last != null && last > freshCutoff) {
            seen.add(id);
            seenOnly.push(id);
            sum.skipped++;
            continue;
          }
          await fetchInto(u, batch, gone);
        }
        await push(batch);
        if (seenOnly.length) await apiJson(api, "/api/ingest/seen", { method: "POST", body: JSON.stringify({ source: src.id, ids: seenOnly }) });
      }
    }

    // 2. 重抓列表沒掃到的活躍物件
    const stale = active.items
      .filter((it) => !seen.has(it.source_listing_id) && (!it.last_checked_at || Date.parse(it.last_checked_at) < staleCutoff))
      .sort((a, b) => (a.last_checked_at ?? "").localeCompare(b.last_checked_at ?? ""))
      .slice(0, cfg.recheck.maxPerRun);
    log(`=== [${src.label}] 重抓:活躍 ${active.items.length},列表沒掃到且逾期 ${stale.length} ===`);
    const gone: string[] = [];
    const batch: ImportedListing[] = [];
    for (const it of stale) {
      if (tripped) break;
      if (!it.source_url) continue;
      sum.rechecked++;
      await fetchInto(it.source_url, batch, gone);
      if (batch.length >= 30) await push(batch.splice(0));
    }
    await push(batch);

    // 3. 下架(安全閥)
    const errRate = fetched ? parseErrors / fetched : 0;
    if (gone.length > 0 && errRate > 0.2) {
      log(`!! [${src.label}] 解析失敗率 ${(errRate * 100).toFixed(0)}%,疑似改版,本輪不標記 ${gone.length} 筆下架`);
    } else if (gone.length > 0) {
      const r = await apiJson<{ updated: number }>(api, "/api/ingest/status", {
        method: "POST",
        body: JSON.stringify({ items: gone.map((id) => ({ source: src.id, source_listing_id: id, status: "removed" })) }),
      });
      sum.removed += r.updated;
      log(`  → [${src.label}] 標記下架 ${r.updated} 筆`);
    }
  }

  sum.seconds = Math.round((Date.now() - t0) / 1000);
  log(`\n合計 ${JSON.stringify(sum)}`);
  return sum;
}
