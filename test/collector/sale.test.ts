import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { transformSale } from "../../collector/rentstats/transform";
import { computeSaleMarket, mortgage, SaleStatIn, type SaleStat } from "../../src/shared/sale";

const csv = fs.readFileSync(path.join(import.meta.dirname, "..", "fixtures", "lvr-sale-mini.csv"), "utf8");

describe("實價登錄買賣 CSV", () => {
  const r = transformSale("台北市", csv);

  it("只收一棟的住宅房地;特殊交易、土地、店面、多棟、離譜價格略過", () => {
    expect(r.items.map((x) => x.serial)).toEqual(["S1", "S2", "S3"]);
    expect(r.skipped).toEqual({ 非房地: 1, 特殊交易: 1, 非住宅: 1, 多棟: 1, 價格或面積不合理: 1 });
    for (const x of r.items) expect(SaleStatIn.safeParse(x).success).toBe(true);
  });

  it("單價換成每坪、面積扣車位、型態對到房源的名字", () => {
    const [a, b, c] = r.items;
    expect(a).toMatchObject({ building_type: "電梯大樓", size_ping: 30.3, unit_price: Math.round(300000 * 3.30579), floor: 5, total_floors: 12, building_age: 20, has_elevator: true, road: "復興南路一段" });
    expect(b).toMatchObject({ has_parking: true, parking_price: 2000000, size_ping: 30.3 });
    expect(c).toMatchObject({ building_type: "公寓", has_elevator: false, building_age: 45 });
  });
});

describe("買賣行情", () => {
  const s = (unit: number, extra: Partial<SaleStat> = {}): SaleStat => ({
    district: "大安區", road: null, building_type: "電梯大樓", floor: 5, total_floors: 12, building_age: 20, size_ping: 30, price: unit * 30, unit_price: unit, rooms: 3, has_parking: false, date: "2026-03-01", ...extra,
  });
  it("同區同型態近似的中位數、估總價、開價比行情", () => {
    const pool = [s(900000), s(1000000), s(1100000), s(1200000), s(1300000), s(500000, { building_type: "公寓" })];
    const m = computeSaleMarket({ building_type: "電梯大樓", size_ping: 30, building_age: 18, price: 36_000_000 }, pool)!;
    expect(m).toMatchObject({ level: 0, scope: "district", count: 5, unit_median: 1100000, est_total: 33_000_000, diff_pct: 9 });
  });
});

describe("房貸試算", () => {
  it("本息平均攤還;寬限期只繳利息", () => {
    const m = mortgage({ price: 10_000_000, down: 0.2, rate: 2.2, years: 30 });
    expect(m.loan).toBe(8_000_000);
    expect(m.monthly).toBe(30376); // 800 萬、2.2%、30 年
    expect(m.graceMonthly).toBeNull();
    const g = mortgage({ price: 10_000_000, down: 0.2, rate: 2.2, years: 30, grace: 3 });
    expect(g.graceMonthly).toBe(14667);
    expect(g.monthly).toBeGreaterThan(m.monthly);
    expect(mortgage({ price: 1_200_000, down: 0, rate: 0, years: 10 }).monthly).toBe(10000);
  });
});
