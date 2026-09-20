/** 家裡採集用的 fetch:一般瀏覽器 UA、zh-TW、逾時、失敗重試、每次之間隨機歇一下(對站方友善也不容易被擋)。 */
export const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

let lastAt = 0;
const MIN_GAP_MS = 2500;

export async function politeDelay(minGap = MIN_GAP_MS) {
  const wait = lastAt + minGap + Math.random() * 1500 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
}

export async function fetchHtml(url: string, { retries = 2, timeoutMs = 20000 }: { retries?: number; timeoutMs?: number } = {}): Promise<{ status: number; html: string }> {
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    await politeDelay();
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, "Accept-Language": "zh-TW,zh;q=0.9", Accept: "text/html,application/xhtml+xml" },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "follow",
      });
      const html = await res.text();
      if (res.status >= 500 || res.status === 429) throw new Error(`HTTP ${res.status}`);
      return { status: res.status, html };
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 5000 * (i + 1)));
    }
  }
  throw new Error(`抓取失敗 ${url}:${String(lastErr)}`);
}
