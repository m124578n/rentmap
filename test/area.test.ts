import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { RentStatIn } from "../src/shared/market";
import type { SaleStatIn } from "../src/shared/sale";

const ORIGIN = "http://localhost:5173";
const post = (path: string, body: unknown) =>
  SELF.fetch(`${ORIGIN}/api/ingest/${path}`, { method: "POST", headers: { Authorization: "Bearer test-ingest", "Content-Type": "application/json" }, body: JSON.stringify(body) });
const get = (path: string) => SELF.fetch(ORIGIN + path);
const enc = (s: string) => encodeURIComponent(s);

const rent = (serial: string, r: number, size: number, extra: Partial<RentStatIn> = {}): RentStatIn => ({
  serial, city: "台北市", district: "大安區", road: `路${serial}`, kind: "整層住家", building_type: "華廈", floor: 3, total_floors: 7, building_age: 30,
  size_ping: size, rooms: 2, livings: 1, baths: 1, rent: r, date: "2026-03-01", has_elevator: false, furnished: true, has_mgmt: false, has_parking: false, social: false, ...extra,
});
const sale = (serial: string, unit: number, extra: Partial<SaleStatIn> = {}): SaleStatIn => ({
  serial, city: "台北市", district: "大安區", road: `路${serial}`, building_type: "電梯大樓", floor: 8, total_floors: 15, building_age: 20, size_ping: 30,
  price: unit * 30, unit_price: unit, rooms: 3, has_parking: false, parking_price: null, date: "2026-04-01", has_elevator: true, has_mgmt: true, ...extra,
});

beforeAll(async () => {
  const rents = [30000, 32000, 34000, 36000, 40000].map((r, i) => rent(`R${i}`, r, 25 + i));
  // 同市別區(全市中位數對照用)
  rents.push(...[20000, 22000, 24000].map((r, i) => rent(`W${i}`, r, 25, { district: "萬華區" })));
  expect((await post("rent-stats", { items: rents })).status).toBe(200);
  const sales = [1_000_000, 1_100_000, 1_200_000, 1_300_000, 1_400_000].map((u, i) => sale(`S${i}`, u));
  expect((await post("sale-stats", { items: sales })).status).toBe(200);
});

describe("公開的各區行情頁", () => {
  it("行政區頁:不用登入、租金與房價中位數、和全市比、竊盜件數、結構化資料", async () => {
    const r = await get(`/area/${enc("台北市")}/${enc("大安區")}`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/html");
    expect(r.headers.get("cache-control")).toBe("public, max-age=3600");
    const html = await r.text();
    expect(html).toContain("<h1>台北市大安區 租金、房價與治安</h1>");
    expect(html).toContain("整層住家月租中位數 $34,000(多數 $32,000–$36,000)");
    // 全市 8 筆中位數 (30000+32000)/2 → 31000;34000 比它高 10%
    expect(html).toContain("比台北市整體高 10%");
    expect(html).toContain("電梯大樓成交每坪中位數 120.0 萬");
    expect(html).toContain("住宅竊盜");
    expect(html).toContain('"@type":"BreadcrumbList"');
    expect(html).toContain(`<link rel="canonical" href="${ORIGIN}/area/${enc("台北市")}/${enc("大安區")}">`);
    expect(html).not.toContain("noindex");
    // 第二次走快取
    expect((await get(`/area/${enc("台北市")}/${enc("大安區")}`)).headers.get("x-cache")).toBe("hit");
  });

  it("沒資料的區 noindex;臺 / 台都認;不存在的縣市或區 404", async () => {
    const html = await (await get(`/area/${enc("臺北市")}/${enc("北投區")}`)).text();
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain("先不列");
    expect((await get(`/area/${enc("台北市")}/${enc("不存在區")}`)).status).toBe(404);
    expect((await get(`/area/${enc("火星市")}`)).status).toBe(404);
  });

  it("縣市頁與目錄", async () => {
    const city = await (await get(`/area/${enc("台北市")}`)).text();
    expect(city).toContain(`href="/area/${enc("台北市")}/${enc("大安區")}"`);
    expect(city).toContain("$34,000");
    const index = await (await get("/area")).text();
    expect(index).toContain("北北基桃");
    expect(index).toContain(`href="/area/${enc("高雄市")}"`);
  });

  it("sitemap:介紹頁、條款頁、有資料的區(沒資料的不列)", async () => {
    const r = await get("/sitemap.xml");
    expect(r.headers.get("content-type")).toContain("application/xml");
    const xml = await r.text();
    expect(xml).toContain(`<loc>${ORIGIN}/</loc>`);
    expect(xml).toContain(`<loc>${ORIGIN}/legal/terms</loc>`);
    expect(xml).toContain(`<loc>${ORIGIN}/area/${enc("台北市")}/${enc("大安區")}</loc>`);
    expect(xml).not.toContain(enc("北投區"));
    expect(xml).not.toContain(enc("萬華區")); // 3 筆不到 5 筆
  });
});
