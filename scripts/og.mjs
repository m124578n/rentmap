/**
 * 重新產生社群分享圖 public/og.png(1200×630,介紹頁首屏截圖)。介紹頁文案改了就要重跑。
 *   npm run dev 開著,node scripts/og.mjs
 * 用「沒登入、正式站」的樣子截:/api/me 換成 user=null、dev=false,按鈕顯示「用 Google 登入」。
 * 沙盒 / 沒裝 Playwright 瀏覽器時:PW_CHROMIUM=/path/to/chrome node scripts/og.mjs
 */
import { chromium } from "playwright";

const base = process.env.RENTMAP_API ?? "http://localhost:5173";
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.route("**/api/me", (r) => r.fulfill({ json: { user: null, enabled: true, dev: false, private_pool: false, consent_needed: [] } }));
await page.goto(`${base}/about`, { waitUntil: "networkidle" });
await page.screenshot({ path: "public/og.png" });
console.log("→ public/og.png");
await browser.close();
