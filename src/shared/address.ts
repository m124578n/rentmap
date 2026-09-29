/**
 * 台灣地址 → Nominatim 查詢字串。OSM 在台灣門牌不齊,所以由細到粗準備幾個版本,找不到就退一層:
 *   完整 → 去掉樓層 → 到「號」→ 到「巷」→ 只到路 / 街 / 段
 * 全形數字轉半形;「台」與「臺」OSM 用「臺」。
 */
export interface AddressQuery {
  q: string;
  /** exact = 有門牌號;road = 只到巷 / 路 */
  level: "exact" | "road";
}

export function normalizeAddress(s: string) {
  return s
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s,，]+/g, "")
    .replace(/^\d{3,6}/, "") // 郵遞區號
    .replace(/台(北|中|南|東)/g, "臺$1");
}

export function addressQueries(input: string): AddressQuery[] {
  const s = normalizeAddress(input);
  if (!s) return [];
  const out: AddressQuery[] = [];
  const push = (q: string | undefined, level: AddressQuery["level"]) => {
    if (q && q.length >= 2 && !out.some((x) => x.q === q)) out.push({ q, level });
  };
  push(s, /\d+號/.test(s) ? "exact" : "road");
  const noFloor = s.replace(/(\d+號).*$/, "$1");
  push(noFloor, /\d+號/.test(noFloor) ? "exact" : "road");
  push(s.match(/^.*?\d+號/)?.[0], "exact");
  push(s.match(/^.*?\d+巷/)?.[0], "road");
  push(s.match(/^.*?(路|街|大道)(\S段)?/)?.[0], "road");
  return out;
}

/** Nominatim 的 display_name 是「門牌, 路, 里, 區, 市, 郵遞區號, 臺灣」→ 反過來組成台灣習慣的寫法,去掉國名與郵遞區號 */
export function shortLabel(displayName: string) {
  const parts = displayName
    .split(/,\s*/)
    .filter((p) => p && p !== "臺灣" && p !== "Taiwan" && !/^\d{3,6}$/.test(p));
  return parts.slice(0, 5).reverse().join(" ");
}

/** 查詢字串裡最細的路名:「…390巷2弄」→「390巷2弄」前面的路 + 巷弄;「…復興南路一段」→「復興南路一段」 */
export function roadOf(q: string): string | null {
  const s = normalizeAddress(q).replace(/^(臺北市|新北市)?[^市]*?區/, "");
  const m = /([^\d號樓]+?(?:路|街|大道)(?:[一二三四五六七八九十]段)?)((?:\d+巷)?(?:\d+弄)?)/.exec(s);
  return m ? m[1]! + m[2]! : null;
}

/**
 * Nominatim 常把附近的大路排第一(查「市府路」回「基隆路一段」)。
 * 候選的第一段(路名)含查詢路名的排前面、不含的丟掉;全都不含就原樣回傳,免得什麼都沒有。
 */
export function rankHits<T extends { display_name: string }>(q: string, hits: T[]): T[] {
  const road = roadOf(q);
  if (!road) return hits;
  const norm = (x: string) => x.replace(/台/g, "臺");
  const ok = hits.filter((h) => norm(h.display_name.split(",")[0]!.trim()).includes(norm(road)));
  return ok.length ? ok : hits;
}
