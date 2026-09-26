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
