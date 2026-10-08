/**
 * 巡檢:每一頁 × 深淺色 × 桌機 / 手機,收集頁面錯誤、console error、失敗的請求(4xx / 5xx),截圖到 data/crawl/。
 *   node scripts/crawl.mjs [--base=http://localhost:5173] [--only=/list,/p/1] [--no-shots]
 * 需要 dev server(或 vite preview)開著;用本機登入。地圖頁會右鍵一點看報告、切換生活圈。
 * 結果在畫面上印一張表;只有「有問題」的組合才列細節。
 */
import fs from "node:fs";
import { chromium } from "playwright";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const base = args.base ?? "http://localhost:5173";
const shots = !("no-shots" in args);
fs.mkdirSync("data/crawl", { recursive: true });

const browser = await chromium.launch();
const ctx0 = await browser.newContext();
const p0 = await ctx0.newPage();
await p0.goto(`${base}/api/auth/dev`);
const me = await p0.evaluate(async () => (await fetch("/api/me")).json());
const props = await p0.evaluate(async () => (await (await fetch("/api/properties")).json()).items ?? []);
await ctx0.close();
const firstId = props.find((p) => p.lat != null)?.id;
const ROUTES = (args.only?.split(",") ?? ["/", "/list", "/board", "/new", "/compare", "/tour", "/status", "/about", "/account", "/legal/terms", "/legal/sources", firstId ? `/p/${firstId}` : null, "/p/999999", "/nope"]).filter(Boolean);
console.log(`模式:${me.private_pool ? "私人" : "公開"} · 方案 ${me.plan?.plan} · 房源 ${props.length} 間`);

const VIEWS = [
  { name: "desktop", viewport: { width: 1280, height: 860 } },
  { name: "mobile", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
];
const problems = [];
for (const v of VIEWS)
  for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: v.viewport, isMobile: v.isMobile, hasTouch: v.hasTouch });
    const page = await ctx.newPage();
    await page.goto(`${base}/api/auth/dev`);
    await page.evaluate((t) => localStorage.setItem("rent-theme", t), theme);
    for (const route of ROUTES) {
      const errs = [];
      const onErr = (e) => errs.push("pageerror: " + e.message.slice(0, 200));
      const onConsole = (m) => {
        if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errs.push("console: " + m.text().slice(0, 200));
      };
      const onResp = (r) => {
        const u = r.url();
        if (r.status() >= 400 && u.startsWith(base) && !(route === "/p/999999" && r.status() === 404)) errs.push(`${r.status()} ${u.slice(base.length, base.length + 120)}`);
      };
      const onFail = (r) => {
        if (!/cartocdn|nominatim|google/.test(r.url()) && r.failure()?.errorText !== "net::ERR_ABORTED") errs.push(`FAILED ${r.url().slice(0, 120)} ${r.failure()?.errorText}`);
      };
      page.on("pageerror", onErr);
      page.on("console", onConsole);
      page.on("response", onResp);
      page.on("requestfailed", onFail);
      try {
        await page.goto(`${base}${route}`, { waitUntil: "load", timeout: 30000 });
        await page.waitForTimeout(route === "/" ? 5000 : 2500);
        if (route === "/") {
          // 右鍵 / 長按一點看報告
          const xy = await page.evaluate(() => {
            const m = window.__map;
            if (!m) return null;
            const r = m.getCanvas().getBoundingClientRect();
            return [r.left + r.width / 2, r.top + r.height / 2];
          });
          if (xy && !v.isMobile) {
            await page.mouse.click(xy[0], xy[1], { button: "right" });
            await page.waitForTimeout(5000);
          }
        }
        // 水平捲軸(手機版常見問題)
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (overflow > 2) errs.push(`水平溢出 ${overflow}px`);
        if (shots) await page.screenshot({ path: `data/crawl/${v.name}-${theme}${route.replace(/[/$]/g, "_") || "_root"}.png` });
      } catch (e) {
        errs.push("navigate: " + String(e).slice(0, 160));
      }
      page.off("pageerror", onErr);
      page.off("console", onConsole);
      page.off("response", onResp);
      page.off("requestfailed", onFail);
      const uniq = [...new Set(errs)];
      console.log(`${uniq.length ? "✗" : "✓"} ${v.name.padEnd(7)} ${theme.padEnd(5)} ${route}${uniq.length ? `  (${uniq.length})` : ""}`);
      if (uniq.length) problems.push({ view: v.name, theme, route, errs: uniq.slice(0, 8) });
    }
    await ctx.close();
  }
await browser.close();
console.log("\n=== 有問題的 ===");
for (const p of problems) console.log(`${p.view} ${p.theme} ${p.route}\n  ${p.errs.join("\n  ")}`);
if (!problems.length) console.log("沒有");
