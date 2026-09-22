/**
 * 來源註冊表:cli / sync 只透過這個介面抓,各站細節在各自檔案。
 *   - "591":純 fetch(SSR)+ __NUXT__
 *   - "hb" (好房):Playwright + Nominatim geocode
 */
import { ImportedListing } from "../../src/shared/schemas";
import { fetchHtml, politeDelay } from "../lib/http";
import { withPage } from "../lib/browser";
import { geocode } from "../lib/geocode";
import { is591, parse591Detail, parse591List } from "./five91";
import { isHousefun, isHousefunGone, parseHousefunDetail, parseHousefunList } from "./housefun";

export type FetchResult = { kind: "ok"; listing: ImportedListing } | { kind: "gone" } | { kind: "parse_error"; error: string } | { kind: "net_error"; error: string };

export interface Source {
  id: "591" | "hb";
  label: string;
  matches(url: string): boolean;
  /** 一頁列表 → 物件 URL(page 從 1 起) */
  listUrls(listUrl: string, page: number): Promise<string[]>;
  fetchDetail(url: string): Promise<FetchResult>;
  /** 從物件 URL 取來源 id(不用抓頁面) */
  idFromUrl(url: string): string | null;
}

function validate(raw: unknown): FetchResult {
  const parsed = ImportedListing.safeParse(raw);
  if (!parsed.success) return { kind: "parse_error", error: JSON.stringify(parsed.error.issues.slice(0, 3)) };
  return { kind: "ok", listing: parsed.data };
}

export const five91: Source = {
  id: "591",
  label: "591",
  matches: is591,
  idFromUrl: (u) => u.match(/rent\.591\.com\.tw\/(\d+)/)?.[1] ?? null,
  async listUrls(listUrl, page) {
    const url = page === 1 ? listUrl : `${listUrl}${listUrl.includes("?") ? "&" : "?"}page=${page}`;
    return parse591List((await fetchHtml(url)).html);
  },
  async fetchDetail(url) {
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
      return validate(parse591Detail(html, url));
    } catch (e) {
      return { kind: "parse_error", error: String(e) };
    }
  },
};

/** 好房(CloudFront)一輪約 100 次載入就會回 403 一陣子:每次載入之間歇 6–10 秒,遇到 403 立刻停 */
const HB_GAP_MS = 6000;
async function hbBlocked(status: number | undefined, p: import("playwright").Page) {
  if (status === 403 || status === 429 || status === 503) return true;
  return /could not be satisfied|Access Denied/i.test(await p.title());
}

/** 好房分頁靠頁內 PM(n):第 1 頁直接 goto,之後在同一個 page 上 evaluate PM(n) 等內容換掉 */
export const housefun: Source = {
  id: "hb",
  label: "好房",
  matches: isHousefun,
  idFromUrl: (u) => u.match(/\/rent\/house\/(\d+)/)?.[1] ?? null,
  async listUrls(listUrl, page) {
    await politeDelay(HB_GAP_MS);
    return withPage(async (p) => {
      const resp = await p.goto(listUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
      if (await hbBlocked(resp?.status(), p)) throw new Error("blocked: 好房回 403(CloudFront 限速),本輪停止");
      await p.waitForSelector("article.DataList", { timeout: 20000 });
      if (page > 1) {
        const before = await p.$$eval("article.DataList h3.title a", (as) => as.map((a) => (a as HTMLAnchorElement).href).join(","));
        await p.evaluate((n) => (window as unknown as { PM: (n: number) => void }).PM(n), page);
        await p.waitForFunction((prev) => document.querySelectorAll("article.DataList h3.title a").length > 0 && [...document.querySelectorAll("article.DataList h3.title a")].map((a) => (a as HTMLAnchorElement).href).join(",") !== prev, before, { timeout: 20000 }).catch(() => {});
        await p.waitForTimeout(800);
      }
      return parseHousefunList(await p.content()).map((i) => i.url);
    });
  },
  async fetchDetail(url) {
    let html: string;
    let finalUrl: string;
    try {
      await politeDelay(HB_GAP_MS);
      ({ html, finalUrl } = await withPage(async (p) => {
        const resp = await p.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
        if (resp && resp.status() === 404) return { html: "", finalUrl: "/errorPage" };
        if (await hbBlocked(resp?.status(), p)) throw new Error("blocked");
        await p.waitForTimeout(1200);
        return { html: await p.content(), finalUrl: p.url() };
      }));
    } catch (e) {
      return { kind: "net_error", error: String(e) };
    }
    if (isHousefunGone(finalUrl, html)) return { kind: "gone" };
    try {
      const { geocode_query, ...rest } = parseHousefunDetail(html, url);
      const geo = geocode_query && rest.city && rest.district ? await geocode(rest.city, rest.district, rest.road) : null;
      return validate({ ...rest, lat: geo?.lat, lng: geo?.lng });
    } catch (e) {
      return { kind: "parse_error", error: String(e) };
    }
  },
};

export const SOURCES: Source[] = [five91, housefun];

export function sourceFor(url: string): Source | undefined {
  return SOURCES.find((s) => s.matches(url));
}
export function sourceById(id: string): Source | undefined {
  return SOURCES.find((s) => s.id === id);
}
