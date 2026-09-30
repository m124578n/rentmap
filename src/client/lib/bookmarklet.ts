import { extractFacts, type ImportedFacts } from "@shared/bookmarklet";

/**
 * 書籤本體:在使用者開著的頁面上跑,讀完開新分頁到我們的 /new#import=…。
 * 會被 toString() 塞進 javascript: 網址,只能用參數與瀏覽器全域變數。
 */
export function runBookmarklet(origin: string, extract: typeof extractFacts) {
  const w = window as unknown as { __NUXT__?: unknown };
  let facts: ImportedFacts | null = null;
  try {
    facts = extract(w.__NUXT__, location.href);
  } catch {
    facts = null;
  }
  if (!facts) {
    // 不認得的網站:只帶標題與網址,其他在表單上自己填
    if (!confirm("這個頁面讀不到房源欄位,只帶標題與網址過去,其他自己填。要繼續嗎?")) return;
    facts = { title: document.title.slice(0, 100), source_url: location.href.split("#")[0] };
  }
  window.open(`${origin}/new#import=${encodeURIComponent(JSON.stringify(facts))}`, "_blank");
}

/** 產生 javascript: 網址(拖到書籤列用) */
export function bookmarkletHref(origin: string) {
  return `javascript:(${runBookmarklet.toString()})(${JSON.stringify(origin)},${extractFacts.toString()});void 0`;
}
