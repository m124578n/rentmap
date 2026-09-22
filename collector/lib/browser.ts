/** 共用一個 headless Chromium(好房需要 JS 渲染 + 站方憑證問題,純 fetch 不行)。用完呼叫 closeBrowser()。 */
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { UA } from "./http";

let browser: Browser | null = null;
let context: BrowserContext | null = null;

async function ctx(): Promise<BrowserContext> {
  if (!browser) browser = await chromium.launch();
  if (!context) context = await browser.newContext({ userAgent: UA, locale: "zh-TW", viewport: { width: 1280, height: 900 } });
  return context;
}

export async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const page = await (await ctx()).newPage();
  // 圖片 / 字型 / 廣告不載,快很多
  await page.route("**/*", (route) => {
    const t = route.request().resourceType();
    if (t === "image" || t === "font" || t === "media") return route.abort();
    const u = route.request().url();
    if (/doubleclick|googlesyndication|googletagmanager|facebook|analytics/.test(u)) return route.abort();
    return route.continue();
  });
  try {
    return await fn(page);
  } finally {
    await page.close();
  }
}

export async function closeBrowser() {
  await context?.close();
  await browser?.close();
  context = null;
  browser = null;
}
