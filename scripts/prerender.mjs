/**
 * 建置後把「沒登入時看到的頁面」預先產成 HTML(`npm run build` 的最後一步),讓不跑 JS 的爬蟲(多數 AI 搜尋)也讀得到內容:
 *   /             → dist/client/index.html(介紹頁;SPA 的其他網址也回這份)
 *   /legal/<doc>  → dist/client/legal/<doc>.html(條款頁從介紹頁底部的連結找,不另外列)
 * sitemap.xml 由 Worker 動態產生(src/worker/routes/area.ts,含各區行情頁)。
 *
 * 做法:用 Node 起一個靜態伺服器服務 dist/client(找不到檔案回 index.html),Playwright 以「沒登入、正式站」的樣子開頁
 * (/api/me 換成 user=null,其他 /api 一律擋掉),抓 #root 的 HTML 塞回模板。
 * 行內 script:localStorage 有「登入過」旗標(Layout 設的 loka_in)就先清空,登入的人不會閃一下介紹頁;沒有就設 __PRERENDERED__,
 * Layout 在 /api/me 回來前照畫介紹頁(不閃「載入中」)。
 *
 * 沙盒 / 沒裝 Playwright 瀏覽器時:PW_CHROMIUM=/path/to/chrome npm run build
 * 只想快速建置、不在乎 SEO:SKIP_PRERENDER=1 npm run build
 */
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const SITE = "https://lokanote.shunzz.com";
const DIST = path.resolve(import.meta.dirname, "../dist/client");
const HINT = "loka_in"; // localStorage key,跟 src/client/components/Layout.tsx 的 SIGNED_IN_HINT 同名

if (process.env.SKIP_PRERENDER) {
  console.log("prerender: SKIP_PRERENDER,跳過");
  process.exit(0);
}

const template = await readFile(path.join(DIST, "index.html"), "utf8");
if (!template.includes('<div id="root"></div>')) throw new Error('dist/client/index.html 沒有空的 <div id="root"></div>(重複跑 prerender?先重新 vite build)');

const TYPES = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const file = path.join(DIST, decodeURIComponent(url.pathname));
  try {
    if (!file.startsWith(DIST) || url.pathname === "/") throw new Error("spa");
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(template);
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
// Service Worker 會接手 fetch,page.route 就攔不到 /api/me
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
const page = await context.newPage();
await page.route("**/api/**", (r) =>
  new URL(r.request().url()).pathname === "/api/me"
    ? r.fulfill({ json: { user: null, enabled: true, dev: false, private_pool: false, consent_needed: [] } })
    : r.abort(),
);

/** 開一頁、等內容出來,回傳 #root 的 HTML、標題、站內連結 */
async function render(route) {
  await page.goto(base + route, { waitUntil: "networkidle" });
  await page.waitForSelector("main h1");
  return page.evaluate(() => ({
    html: document.getElementById("root").innerHTML,
    h1: document.querySelector("main h1").textContent.trim(),
    links: [...document.querySelectorAll("a[href^='/legal/']")].map((a) => a.getAttribute("href")),
  }));
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const inline = `<script>try{if(localStorage.getItem("${HINT}"))document.getElementById("root").textContent="";else window.__PRERENDERED__=true}catch(e){window.__PRERENDERED__=true}</script>`;

function fill(html, route, title) {
  let out = template.replace('<div id="root"></div>', `<div id="root">${html}</div>${inline}`);
  if (route !== "/") {
    const url = SITE + route;
    out = out
      .replace(/<link rel="canonical" href="[^"]*"/, `<link rel="canonical" href="${url}"`)
      .replace(/<meta property="og:url" content="[^"]*"/, `<meta property="og:url" content="${url}"`)
      .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
      .replace(/<meta property="og:title" content="[^"]*"/, `<meta property="og:title" content="${esc(title)}"`);
  }
  return out;
}

const home = await render("/");
const legal = [...new Set(home.links)];
const pages = [{ route: "/", out: "index.html", html: home.html, title: "" }];
for (const route of legal) {
  const r = await render(route);
  pages.push({ route, out: `${route.slice(1)}.html`, html: r.html, title: `${r.h1}|落腳筆記` });
}
await browser.close();
server.close();

for (const p of pages) {
  const file = path.join(DIST, p.out);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, fill(p.html, p.route, p.title));
  console.log(`prerender: ${p.route} → dist/client/${p.out}(${Math.round(p.html.length / 1024)} KB)`);
}
