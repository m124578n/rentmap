/**
 * 視覺確認用:開 headless Chromium,本機登入,截指定路徑的圖。
 *   node scripts/shot.mjs [--route=/list] [--out=data/shot.png] [--dark] [--click=.rh-marker]
 * (路徑用 --route= 傳,因為 Git Bash 會把開頭的 / 轉成 C:/Program Files/Git/)
 * 需要 `npm run dev` 開著。只在版面 / 視覺改動後用,一張就好(省 token)。
 */
import { chromium } from "playwright";

const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("=")));
// Git Bash 會把 --route=/x 轉成 C:/Program Files/Git/x,這裡還原(或跑之前設 MSYS_NO_PATHCONV=1)
const route = (flags.route ?? "/").replace(/^[A-Za-z]:\/Program Files\/Git/, "") || "/";
const out = flags.out ?? "data/shot.png";
const base = process.env.RENT_HOUSE_API ?? "http://localhost:5173";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("requestfailed", (r) => errors.push("FAILED " + r.url().slice(0, 120)));
await page.goto(`${base}/api/auth/dev`, { waitUntil: "domcontentloaded" });
if ("dark" in flags) await page.evaluate(() => localStorage.setItem("rent-theme", "dark"));
await page.goto(`${base}${route}`, { waitUntil: "networkidle" });
// 地圖頁:等圖磚載完
await page.evaluate(async () => {
  const m = window.__map;
  if (!m) return;
  for (let i = 0; i < 40 && !(m.loaded() && m.areTilesLoaded()); i++) await new Promise((r) => setTimeout(r, 500));
});
if (flags.click) {
  await page.locator(flags.click).first().click();
  await page.waitForTimeout(1200);
}
await page.screenshot({ path: out });
console.log(`→ ${out}`, errors.length ? `\nerrors: ${errors.join("\n")}` : "(no errors)");
await browser.close();
