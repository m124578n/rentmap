/**
 * 公開的「各區行情」頁(不用登入;搜尋引擎、AI 搜尋讀得到的內容):Worker 直接輸出 HTML,不載 SPA。
 *
 *   GET /area                        生活圈 → 縣市 → 行政區的目錄
 *   GET /area/:city                  一個縣市各區的對照表
 *   GET /area/:city/:district        一個區:租金(租賃實價登錄)、房價(買賣實價登錄)、竊盜件數
 *   GET /sitemap.xml                 介紹頁、條款頁、各區行情頁(沒有任何資料的區不列,頁面也標 noindex)
 *
 * 只用公開資料的彙總,不碰任何人的筆記。快取:Cache API,key 帶 rent_stats / sale_stats 的版本與治安檔期間。
 * wrangler.jsonc 的 assets.run_worker_first 要有 /area、/area/*、/sitemap.xml(不然會被 SPA 的 index.html 接走)。
 */
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { cachedBody, tableSig } from "../cache";
import { loadPools, poolKey } from "./market";
import { loadSalePools } from "./sale";
import { rentRows, saleRows, vsCity, type RentRow, type SaleRow } from "@shared/area";
import { CITY_INFO, hasCoverage, normalizeCity, REGION_KEYS, REGIONS, regionOfCity, type CityName } from "@shared/regions";
import { CRIME_KIND_LABEL, districtRank, type CrimeDistricts, type CrimeKind } from "@shared/crime";
import { LEGAL_DOC_KEYS, LEGAL_DOCS } from "@shared/legal";
import { wan } from "@shared/price";
import crimeJson from "../../../public/crime-districts.json";

const crime = crimeJson as CrimeDistricts;
export const area = new Hono<AppEnv>();

const OPEN = REGION_KEYS.filter((k) => REGIONS[k].enabled);
const openCity = (s: string): CityName | null => {
  const c = normalizeCity(s);
  return c && OPEN.some((k) => REGIONS[k].cities.includes(c)) ? c : null;
};
const areaUrl = (city?: string, district?: string) => ["/area", city, district].filter(Boolean).map((p, i) => (i ? encodeURIComponent(p!) : p)).join("/");

async function sigs(DB: D1Database) {
  const [rent, sale] = await Promise.all([tableSig(DB, "rent_stats", "id"), tableSig(DB, "sale_stats", "id")]);
  return [rent, sale, crime.to];
}
const PUBLIC_CACHE = "public, max-age=3600";
const html = (c: Parameters<typeof cachedBody>[0], parts: (string | number)[], compute: () => Promise<string>) =>
  cachedBody(c, ["area", "v1", ...parts], "text/html; charset=utf-8", PUBLIC_CACHE, compute);

interface Data {
  rent: RentRow[];
  sale: SaleRow[];
}
async function districtData(DB: D1Database, city: CityName, district: string): Promise<Data> {
  const [pools, sale] = await Promise.all([loadPools(DB), loadSalePools(DB, city)]);
  return {
    rent: rentRows(
      (k) => pools.get(poolKey(city, district, k)) ?? [],
      (k) => pools.get(poolKey(city, "*", k)) ?? [],
    ),
    sale: saleRows(sale.byDistrict.get(district) ?? [], sale.all),
  };
}

// ---- 路由 ----

area.get("/area", async (c) =>
  html(c, ["index", ...(await sigs(c.env.DB))], async () => {
    const body = OPEN.map((k) => {
      const r = REGIONS[k];
      return `<section><h2>${esc(r.label)}</h2>${r.cities
        .map(
          (city) =>
            `<h3><a href="${areaUrl(city)}">${esc(city)}</a></h3><p class="links">${CITY_INFO[city].districts
              .map((d) => `<a href="${areaUrl(city, d)}">${esc(d)}</a>`)
              .join("")}</p>`,
        )
        .join("")}</section>`;
    }).join("");
    return page(c.env.APP_ORIGIN, {
      path: "/area",
      title: "各區租金、房價與治安|落腳筆記",
      description: `${OPEN.map((k) => REGIONS[k].label).join("、")}各行政區的租金行情、房價(每坪單價)與竊盜件數,資料來自內政部實價登錄與警察機關統計。`,
      crumbs: [],
      h1: "各區租金、房價與治安",
      body: `<p class="lead">選一個縣市看各區對照,或直接點行政區。數字來自內政部不動產租賃與買賣實價登錄(近一年)與警察機關的竊盜統計。</p>${body}`,
    });
  }),
);

area.get("/area/:city", async (c) => {
  const city = openCity(c.req.param("city"));
  if (!city) return notFound(c);
  return html(c, ["city", city, ...(await sigs(c.env.DB))], async () => {
    const [pools, sale] = await Promise.all([loadPools(c.env.DB), loadSalePools(c.env.DB, city)]);
    const rows = CITY_INFO[city].districts.map((d) => {
      const pick = (k: string) => pools.get(poolKey(city, d, k)) ?? [];
      const rent = rentRows(pick, () => []);
      const sl = saleRows(sale.byDistrict.get(d) ?? [], []);
      const r = (k: string) => rent.find((x) => x.kind === k);
      const s = (t: string) => sl.find((x) => x.type === t);
      const house = crime.items[`${city}|${d}`]?.house;
      return `<tr><th><a href="${areaUrl(city, d)}">${esc(d)}</a></th>
        <td>${r("整層住家") ? money(r("整層住家")!.median) : "—"}</td>
        <td>${r("獨立套房") ? money(r("獨立套房")!.median) : "—"}</td>
        <td>${s("電梯大樓") ? wan1(s("電梯大樓")!.unit_median) : "—"}</td>
        <td>${s("公寓") ? wan1(s("公寓")!.unit_median) : "—"}</td>
        ${hasCoverage(city, "crimeDistricts") ? `<td>${house ?? 0}</td>` : ""}</tr>`;
    });
    const crimeCol = hasCoverage(city, "crimeDistricts");
    const table = `<div class="scroll"><table><thead><tr><th>行政區</th><th>整層住家<br><small>月租中位數</small></th><th>獨立套房<br><small>月租中位數</small></th>
      <th>電梯大樓<br><small>每坪</small></th><th>公寓<br><small>每坪</small></th>${crimeCol ? "<th>住宅竊盜<br><small>近一年件數</small></th>" : ""}</tr></thead>
      <tbody>${rows.join("")}</tbody></table></div>`;
    return page(c.env.APP_ORIGIN, {
      path: areaUrl(city),
      title: `${city}各區租金、房價${crimeCol ? "與治安" : ""}比較|落腳筆記`,
      description: `${city}${CITY_INFO[city].districts.length} 個行政區的月租中位數、每坪房價${crimeCol ? "與竊盜件數" : ""}一次比較,資料來自內政部實價登錄近一年成交。`,
      crumbs: [{ name: city, path: areaUrl(city) }],
      h1: `${city}各區租金、房價${crimeCol ? "與治安" : ""}`,
      body: `<p class="lead">近一年實價登錄的中位數(樣本少於 5 筆的不列)。點行政區看多數落在哪個區間、和全市比高還低。</p>${table}${sourcesNote(city)}`,
    });
  });
});

area.get("/area/:city/:district", async (c) => {
  const city = openCity(c.req.param("city"));
  const district = c.req.param("district");
  if (!city || !(CITY_INFO[city].districts as readonly string[]).includes(district)) return notFound(c);
  return html(c, ["district", city, district, ...(await sigs(c.env.DB))], async () => {
    const data = await districtData(c.env.DB, city, district);
    const name = `${city}${district}`;
    const crimeHtml = crimeSection(city, district);
    const lead = leadText(city, district, data);
    const empty = !data.rent.length && !data.sale.length;
    const others = CITY_INFO[city].districts.filter((d) => d !== district);
    const body = `
      <p class="lead">${esc(lead || `${name}近一年的實價登錄樣本還不夠,先不列行情。`)}</p>
      ${rentSection(city, data.rent)}
      ${saleSection(city, data.sale)}
      ${crimeHtml}
      <section class="cta"><h2>看一個地址的完整報告</h2>
        <p>輸入地址,算上下班通勤(公車、捷運、台鐵、YouBike)、附近生活機能與垃圾車、淹水與液化潛勢、每月實際支出(房租或房貸),看中的房子存成筆記。</p>
        <p><a class="btn" href="/">打開落腳筆記</a></p></section>
      <section><h2>${esc(city)}其他行政區</h2><p class="links">${others.map((d) => `<a href="${areaUrl(city, d)}">${esc(d)}</a>`).join("")}</p>
        <p><a href="${areaUrl(city)}">${esc(city)}各區對照表 →</a></p></section>
      ${sourcesNote(city)}`;
    return page(c.env.APP_ORIGIN, {
      path: areaUrl(city, district),
      title: `${name}租金行情、房價${hasCoverage(city, "crimeDistricts") ? "與治安" : ""}|落腳筆記`,
      description: lead ? lead.slice(0, 150) : `${name}的租金行情、房價與治安,資料來自內政部實價登錄與警察機關統計。`,
      crumbs: [
        { name: city, path: areaUrl(city) },
        { name: district, path: areaUrl(city, district) },
      ],
      h1: `${name} 租金、房價${hasCoverage(city, "crimeDistricts") ? "與治安" : ""}`,
      body,
      noindex: empty,
      place: { name, city },
    });
  });
});

area.get("/sitemap.xml", async (c) => {
  return cachedBody(c, ["sitemap", "v1", ...(await sigs(c.env.DB))], "application/xml; charset=utf-8", PUBLIC_CACHE, async () => {
    const pools = await loadPools(c.env.DB);
    const paths = ["/", ...LEGAL_DOC_KEYS.map((k) => `/legal/${k}`), "/area"];
    for (const k of OPEN)
      for (const city of REGIONS[k].cities) {
        paths.push(areaUrl(city));
        const sale = await loadSalePools(c.env.DB, city);
        for (const d of CITY_INFO[city].districts) {
          // 跟頁面的 noindex 同一個標準:租金或房價至少有一列(某房型 / 型態 ≥ MIN_SAMPLES 筆)
          const pick = (k: string) => pools.get(poolKey(city, d, k)) ?? [];
          if (rentRows(pick, () => []).length || saleRows(sale.byDistrict.get(d) ?? [], []).length) paths.push(areaUrl(city, d));
        }
      }
    const origin = c.env.APP_ORIGIN.replace(/\/$/, "");
    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((p) => `  <url><loc>${origin}${p}</loc></url>`).join("\n")}
</urlset>
`;
  });
});

function notFound(c: { env: Env }) {
  const body = page(c.env.APP_ORIGIN, { path: "/area", title: "找不到這個地區|落腳筆記", description: "", crumbs: [], h1: "找不到這個地區", body: `<p><a href="/area">看所有地區 →</a></p>`, noindex: true });
  return new Response(body, { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

// ---- 區塊 ----

function leadText(city: CityName, district: string, d: Data) {
  const s: string[] = [];
  const whole = d.rent.find((r) => r.kind === "整層住家");
  const suite = d.rent.find((r) => r.kind === "獨立套房");
  if (whole) s.push(`${district}近一年整層住家月租中位數 ${money(whole.median)}(多數 ${money(whole.p25)}–${money(whole.p75)})${cmp(whole.median, whole.city_median, city)}。`);
  if (suite) s.push(`獨立套房中位數 ${money(suite.median)}${cmp(suite.median, suite.city_median, city)}。`);
  const sale = d.sale.find((r) => r.type === "電梯大樓") ?? d.sale[0];
  if (sale) s.push(`${sale.type}成交每坪中位數 ${wan1(sale.unit_median)}${cmp(sale.unit_median, sale.city_unit_median, city)},總價中位數 ${wan(sale.price_median)}。`);
  const r = rankOf(city, district, "house");
  if (r) s.push(`住宅竊盜近一年 ${r.count} 件,在${r.scope}有資料的 ${r.of} 個行政區中第 ${r.n} 多。`);
  return s.join("");
}

function cmp(mine: number, cityMedian: number | null, city: string) {
  const p = vsCity(mine, cityMedian);
  if (p == null) return "";
  return Math.abs(p) < 3 ? `,和${city}整體差不多` : `,比${city}整體${p > 0 ? "高" : "低"} ${Math.abs(p)}%`;
}

function rentSection(city: string, rows: RentRow[]) {
  if (!rows.length) return `<section><h2>租金行情</h2><p class="muted">近一年同區的租賃實價登錄每種房型都不到 5 筆,先不列。</p></section>`;
  const period = span(rows.map((r) => r.from), rows.map((r) => r.to));
  return `<section><h2>租金行情<small>租賃實價登錄 · ${period}</small></h2>
    <div class="scroll"><table><thead><tr><th>房型</th><th>月租中位數</th><th>多數落在</th><th>每坪</th><th>比${esc(city)}整體</th><th>筆數</th></tr></thead><tbody>
    ${rows
      .map(
        (r) => `<tr><th>${esc(r.kind)}</th><td><b>${money(r.median)}</b></td><td>${money(r.p25)}–${money(r.p75)}</td>
          <td>${r.per_ping ? money(r.per_ping) : "—"}</td><td>${pct(vsCity(r.median, r.city_median))}</td><td>${r.count}</td></tr>`,
      )
      .join("")}
    </tbody></table></div>
    <p class="muted">排除社會住宅包租代管與含車位的租約;同一棟最多算 2 筆、離中位數 3 倍以上的不算。分租套房、雅房的登錄面積常是整戶,不算每坪。</p></section>`;
}

function saleSection(city: string, rows: SaleRow[]) {
  if (!rows.length) return `<section><h2>房價</h2><p class="muted">近一年同區的買賣實價登錄每種建物型態都不到 5 筆,先不列。</p></section>`;
  const period = span(rows.map((r) => r.from), rows.map((r) => r.to));
  return `<section><h2>房價<small>買賣實價登錄 · ${period}</small></h2>
    <div class="scroll"><table><thead><tr><th>型態</th><th>每坪中位數</th><th>多數落在</th><th>比${esc(city)}整體</th><th>總價中位數</th><th>坪數 / 屋齡</th><th>筆數</th></tr></thead><tbody>
    ${rows
      .map(
        (r) => `<tr><th>${esc(r.type)}</th><td><b>${wan1(r.unit_median)}</b></td><td>${wan1(r.unit_p25)}–${wan1(r.unit_p75)}</td>
          <td>${pct(vsCity(r.unit_median, r.city_unit_median))}</td><td>${wan(r.price_median)}</td>
          <td>${r.size_median != null ? `${r.size_median} 坪` : "—"} / ${r.age_median != null ? `${r.age_median} 年` : "—"}</td><td>${r.count}</td></tr>`,
      )
      .join("")}
    </tbody></table></div>
    <p class="muted">每坪用政府公布的單價(車位分開計價時已扣除);不含預售屋、親友等特殊交易與一次買多棟的交易。</p></section>`;
}

function rankOf(city: CityName, district: string, kind: CrimeKind) {
  if (!hasCoverage(city, "crimeDistricts")) return null;
  const rk = regionOfCity(city);
  if (!rk) return null;
  const r = districtRank(crime.items, REGIONS[rk].cities, city, district, kind);
  const count = crime.items[`${city}|${district}`]?.[kind] ?? 0;
  return r ? { ...r, count, scope: REGIONS[rk].label } : null;
}

function crimeSection(city: CityName, district: string) {
  if (!hasCoverage(city, "crimeDistricts")) return "";
  const row = crime.items[`${city}|${district}`] ?? {};
  const p = crime.periods?.[city] ?? crime;
  const kinds = (Object.keys(CRIME_KIND_LABEL) as CrimeKind[]).filter((k) => row[k] != null || k === "house");
  return `<section><h2>治安<small>竊盜件數 · ${month(p.from)}~${month(p.to)}</small></h2>
    <div class="scroll"><table><thead><tr><th>類別</th><th>件數</th><th>排名</th></tr></thead><tbody>
    ${kinds
      .map((k) => {
        const r = rankOf(city, district, k);
        return `<tr><th>${CRIME_KIND_LABEL[k]}竊盜</th><td>${row[k] ?? 0}</td><td>${r ? `${r.scope} ${r.of} 區中第 ${r.n} 多` : "—"}</td></tr>`;
      })
      .join("")}
    </tbody></table></div>
    <p class="muted">是件數不是比率:人口多、範圍大的區件數自然多。只看得出大概,實際請以警察機關公布為準。</p></section>`;
}

function sourcesNote(city: CityName) {
  const items = ["內政部不動產租賃實價登錄、買賣實價登錄(政府資料開放授權條款)"];
  if (hasCoverage(city, "crimeDistricts")) items.push("警察機關竊盜案件統計");
  return `<section class="sources"><h2>資料來源</h2><ul>${items.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
    <p class="muted">行情是近一年成交的統計,不是估價;個別房屋請看實際條件。</p></section>`;
}

// ---- 版面 ----

interface PageOpts {
  path: string;
  title: string;
  description: string;
  crumbs: { name: string; path: string }[];
  h1: string;
  body: string;
  noindex?: boolean;
  place?: { name: string; city: string };
}

function page(appOrigin: string, o: PageOpts) {
  const origin = appOrigin.replace(/\/$/, "");
  const crumbs = [{ name: "各區行情", path: "/area" }, ...o.crumbs];
  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BreadcrumbList",
        itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: origin + c.path })),
      },
      {
        "@type": "WebPage",
        name: o.title,
        url: origin + o.path,
        inLanguage: "zh-Hant-TW",
        isPartOf: { "@type": "WebSite", name: "落腳筆記", alternateName: "Loka Note", url: origin + "/" },
        ...(o.place ? { about: { "@type": "Place", name: o.place.name, containedInPlace: { "@type": "City", name: o.place.city } } } : {}),
      },
    ],
  };
  const legal = LEGAL_DOC_KEYS.map((k) => `<a href="/legal/${k}">${esc(LEGAL_DOCS[k].title)}</a>`).join(" · ");
  return `<!doctype html>
<html lang="zh-Hant-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.title)}</title>
${o.description ? `<meta name="description" content="${esc(o.description)}">` : ""}
${o.noindex ? '<meta name="robots" content="noindex">' : ""}
<link rel="canonical" href="${origin}${o.path}">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<meta name="theme-color" content="#059669">
<meta property="og:type" content="website">
<meta property="og:locale" content="zh_TW">
<meta property="og:site_name" content="落腳筆記 Loka Note">
<meta property="og:title" content="${esc(o.title)}">
${o.description ? `<meta property="og:description" content="${esc(o.description)}">` : ""}
<meta property="og:url" content="${origin}${o.path}">
<meta property="og:image" content="${origin}/og.png">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>
<style>${CSS}</style>
</head>
<body>
<header><a class="brand" href="/">落腳筆記 <small>Loka Note</small></a><a href="/area">各區行情</a></header>
<main>
<nav class="crumbs">${crumbs.map((c, i) => (i === crumbs.length - 1 && crumbs.length > 1 ? esc(c.name) : `<a href="${c.path}">${esc(c.name)}</a>`)).join(" › ")}</nav>
<h1>${esc(o.h1)}</h1>
${o.body}
</main>
<footer>落腳筆記 Loka Note · ${legal}</footer>
</body>
</html>`;
}

const CSS = `
:root{--fg:#171717;--muted:#737373;--line:#e5e5e5;--bg:#fafafa;--card:#fff;--accent:#059669;--accent-bg:#ecfdf5}
@media (prefers-color-scheme:dark){:root{--fg:#f5f5f5;--muted:#a3a3a3;--line:#262626;--bg:#0a0a0a;--card:#171717;--accent:#34d399;--accent-bg:#022c22}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.7 system-ui,-apple-system,"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif}
a{color:var(--accent)}header{display:flex;gap:16px;align-items:center;justify-content:space-between;padding:10px 16px;border-bottom:1px solid var(--line)}
.brand{font-weight:600;color:var(--fg);text-decoration:none}.brand small{color:var(--muted);font-weight:400;font-size:12px}
main{max-width:960px;margin:0 auto;padding:8px 16px 40px}h1{font-size:26px;line-height:1.3;margin:8px 0 12px}
h2{font-size:18px;margin:28px 0 8px}h2 small{font-size:12px;font-weight:400;color:var(--muted);margin-left:8px}h3{font-size:16px;margin:16px 0 4px}
.crumbs{font-size:13px;color:var(--muted);margin-top:12px}.lead{font-size:16px}.muted{color:var(--muted);font-size:13px}
.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;background:var(--card);font-variant-numeric:tabular-nums;font-size:14px}
th,td{border-bottom:1px solid var(--line);padding:6px 10px;text-align:right;white-space:nowrap}th:first-child{text-align:left}thead th{font-weight:500;color:var(--muted);font-size:13px;line-height:1.3}
thead th small{font-weight:400}.links{display:flex;flex-wrap:wrap;gap:6px 14px}
.cta{margin-top:32px;padding:16px 20px;border-radius:14px;background:var(--accent-bg)}.cta h2{margin-top:0}
.btn{display:inline-block;padding:8px 18px;border-radius:8px;background:#059669;color:#fff;text-decoration:none;font-weight:500}
.sources ul{margin:4px 0;padding-left:20px;font-size:14px}footer{max-width:960px;margin:0 auto;padding:16px;color:var(--muted);font-size:12px;border-top:1px solid var(--line)}
`;

// ---- 格式 ----

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
/** 每坪單價:43.2 萬 */
const wan1 = (n: number) => `${(n / 1e4).toFixed(1)} 萬`;
const pct = (p: number | null) => (p == null ? "—" : p === 0 ? "持平" : `${p > 0 ? "+" : ""}${p}%`);
const month = (d: string) => d.slice(0, 7).replace("-", "/");
const span = (from: string[], to: string[]) => `${month([...from].sort()[0] ?? "")}~${month([...to].sort().at(-1) ?? "")}`;
