import { describe, expect, it } from "vitest";
import { defaultKwh, monthlyCost, parseUtilities, taipowerBill, TPASS } from "../../src/shared/cost";
import { utilitiesNote } from "../../collector/sources/five91";
import { computeFit, EMPTY_REQUIREMENTS } from "../../src/shared/fit";

const flat = { rent: 20000, kind: "整層住家", size_ping: 20, mgmt_fee: 1000, utilities_note: "水:臺水繳費 電:臺電繳費", has_internet: false };
const brief = (kind: "mrt" | "bus+mrt" | "walk") => ({ kind, total_min: 30, transfers: 0, summary: "" });

describe("monthly cost", () => {
  it("parses how utilities are charged", () => {
    expect(parseUtilities("水:臺水繳費 電:每度5元")).toEqual({ electricity: { mode: "rate", rate: 5 }, water: { mode: "taipower" } });
    expect(parseUtilities("水:包含在租金 電:4.5元/度")).toEqual({ electricity: { mode: "rate", rate: 4.5 }, water: { mode: "included" } });
    expect(parseUtilities("水:自訂 200元/月 電:台電計價")).toEqual({ electricity: { mode: "taipower" }, water: { mode: "fixed", amount: 200 } });
    expect(parseUtilities(null)).toEqual({ electricity: { mode: "unknown" }, water: { mode: "unknown" } });
  });

  it("591 note keeps the landlord's per-kWh price", () => {
    expect(utilitiesNote({ water_fee_type: "臺水繳費", electric_fee_type: "自訂", electric_fee: 5 })).toBe("水:臺水繳費 電:每度5元");
    expect(utilitiesNote({ water_fee_type: "自訂", water_fee: 200, electric_fee_type: "臺電繳費", electric_fee: 0 })).toBe("水:自訂 200元/月 電:臺電繳費");
    expect(utilitiesNote(undefined)).toBeUndefined();
  });

  it("taipower progressive rates", () => {
    expect(taipowerBill(100)).toBe(178);
    // 120×1.78 + 80×(2.55×4 + 2.26×8)/12
    expect(taipowerBill(200)).toBe(Math.round(120 * 1.78 + 80 * ((2.55 * 4 + 2.26 * 8) / 12)));
    expect(defaultKwh("獨立套房", 8)).toBe(120);
    expect(defaultKwh("整層住家", 20)).toBe(270);
  });

  it("adds everything up; landlord rate × kWh; commute capped by TPASS", () => {
    const c = monthlyCost(flat, { commute: { place: "公司", go: brief("mrt"), back: brief("mrt") }, days: 5 })!;
    const by = Object.fromEntries(c.lines.map((l) => [l.key, l.amount]));
    expect(by).toMatchObject({ rent: 20000, mgmt: 1000, electricity: taipowerBill(270), water: 100, internet: 500 });
    expect(by.commute).toBe(Math.round((50 * 5 * 52) / 12)); // 1083 < 1200
    expect(c.total).toBe(Object.values(by).reduce((a, b) => a + b, 0));

    const far = monthlyCost(flat, { commute: { place: "公司", go: brief("bus+mrt"), back: brief("bus+mrt") } })!;
    expect(far.lines.find((l) => l.key === "commute")!.amount).toBe(TPASS);
    const walk = monthlyCost(flat, { commute: { place: "公司", go: brief("walk"), back: brief("walk") } })!;
    expect(walk.lines.find((l) => l.key === "commute")!.amount).toBe(0);

    const suite = monthlyCost({ ...flat, kind: "獨立套房", utilities_note: "電:每度5元", has_internet: true }, { kwh: 150 })!;
    expect(suite.lines.find((l) => l.key === "electricity")!.amount).toBe(750);
    expect(suite.lines.find((l) => l.key === "internet")!.amount).toBe(0);
    expect(suite.lines.find((l) => l.key === "commute")).toBeUndefined(); // 沒設地點
    expect(monthlyCost({ ...flat, rent: null })).toBeNull();
  });

  it("fit: budget against total spending when asked", () => {
    const p = { rent: 20000, kind: "整層住家", rooms: 2, size_ping: 20, building_age: 10, has_elevator: true, pet_allowed: null, cooking_allowed: null };
    const r = { ...EMPTY_REQUIREMENTS, budget_max: 22000 };
    expect(computeFit(p, r, { total: 23500 })!.fails).toEqual([]);
    expect(computeFit(p, { ...r, budget_total: true }, { total: 23500 })!.fails).toEqual(["每月支出 $23,500 超過預算 $22,000"]);
    // 總支出還沒算出來:先比房租
    expect(computeFit(p, { ...r, budget_total: true }, {})!.fails).toEqual([]);
  });
});
