/**
 * 開區驗證:每個生活圈切過去,看地圖範圍、右鍵市中心出報告,截圖 + 收集錯誤。
 *   node scripts/verify-regions.mjs [taichung tainan kaohsiung north]
 * 需要 dev server 開著。
 */
import { chromium } from "playwright";

const base = "http://localhost:5173";
const want = process.argv.slice(2);
// 市中心附近、一定在陸地上的點
const SPOT = {
  north: { label: "台北 大安", lat: 25.0335, lng: 121.5436 },
  taichung: { label: "台中 市政府", lat: 24.1618, lng: 120.6469 },
  tainan: { label: "台南 火車站前", lat: 22.9955, lng: 120.2095 },
  kaohsiung: { label: "高雄 美麗島", lat: 22.6313, lng: 120.3019 },
};
const regions = (want.length ? want : ["taichung", "tainan", "kaohsiung", "north"]).filter((k) => SPOT[k]);

const browser = await chromium.launch();
for (const key of regions) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("response", (r) => {
    if (r.status() >= 400 && r.url().startsWith(base)) errors.push(`${r.status()} ${r.url().slice(base.length, base.length + 110)}`);
  });
  await page.goto(`${base}/api/auth/dev`, { waitUntil: "domcontentloaded" });
  await page.evaluate((k) => localStorage.setItem("rentmap.region", k), key);
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  const info = await page.evaluate(async (spot) => {
    const m = window.__map;
    if (!m) return { map: false };
    for (let i = 0; i < 40 && !(m.loaded() && m.areTilesLoaded()); i++) await new Promise((r) => setTimeout(r, 500));
    const c = m.getCenter();
    const before = { lat: +c.lat.toFixed(3), lng: +c.lng.toFixed(3), zoom: +m.getZoom().toFixed(1) };
    m.jumpTo({ center: [spot.lng, spot.lat], zoom: 15 });
    for (let i = 0; i < 40 && !(m.loaded() && m.areTilesLoaded()); i++) await new Promise((r) => setTimeout(r, 500));
    const p = m.project([spot.lng, spot.lat]);
    const rect = m.getCanvas().getBoundingClientRect();
    return { map: true, before, x: rect.left + p.x, y: rect.top + p.y, region: localStorage.getItem("rentmap.region") };
  }, SPOT[key]);
  let panel = "";
  if (info.map) {
    await page.mouse.click(info.x, info.y, { button: "right" });
    await page.waitForTimeout(9000); // 反查地址(Nominatim)+ 各區塊查詢
    panel = await page.evaluate(() => {
      const el = [...document.querySelectorAll("aside, [role=dialog], .card")].sort((a, b) => b.textContent.length - a.textContent.length)[0];
      return (el?.textContent ?? "").replace(/\s+/g, " ").slice(0, 1500);
    });
  }
  const out = `data/verify-${key}.png`;
  await page.screenshot({ path: out });
  console.log(`\n=== ${key}(${SPOT[key].label})===`);
  console.log("一開始的地圖中心:", JSON.stringify(info.before), "localStorage:", info.region);
  console.log("面板文字:", panel || "(沒有面板)");
  console.log("錯誤:", errors.length ? [...new Set(errors)].slice(0, 12).join(" | ") : "無", "→", out);
  await page.close();
}
await browser.close();
