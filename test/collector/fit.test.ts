import { describe, expect, it } from "vitest";
import { EMPTY_REQUIREMENTS, Requirements, computeFit, type FitInput } from "../../src/shared/fit";

const home: FitInput = { rent: 25000, kind: "整層住家", rooms: 2, size_ping: 25, building_age: 20, has_elevator: true, pet_allowed: null, cooking_allowed: true };
const req = (patch: Partial<Requirements>): Requirements => ({ ...EMPTY_REQUIREMENTS, ...patch });

describe("computeFit", () => {
  it("什麼都沒設 → 不評", () => {
    expect(computeFit(home, EMPTY_REQUIREMENTS)).toBeNull();
  });

  it("硬性條件不符 → 紅,列出原因;缺資料不算不符但列在不確定", () => {
    const r = computeFit(home, req({ budget_max: 22000, need_pet: true, need_elevator: true, kinds: ["獨立套房"] }))!;
    expect(r.level).toBe("red");
    expect(r.fails).toEqual(["租金 $25,000 超過預算 $22,000", "房型是整層住家"]);
    expect(r.unknown).toEqual(["可否養寵物"]);
  });

  it("通勤上限:搭不到或超過就不符;還沒算出來(undefined)不判", () => {
    const r = req({ commute_max: 40 });
    expect(computeFit(home, r, { commuteMin: 45 })!.fails).toEqual(["通勤最久 45 分(上限 40 分)"]);
    expect(computeFit(home, r, { commuteMin: null })!.level).toBe("red");
    expect(computeFit(home, r, {})!.fails).toEqual([]);
    expect(computeFit(home, r, { commuteMin: 20 })!).toMatchObject({ level: "green", score: 1 });
  });

  it("軟性分數加權平均:≥0.75 綠、≥0.5 黃、其餘紅", () => {
    const r = req({ budget_max: 30000, budget_ideal: 20000, size_ideal: 30, size_min: 20, weights: { price: 1, market: 0, commute: 0, size: 1, age: 0 } });
    const f = computeFit(home, r)!;
    // 租金 25000:在 20000–30000 中間 → 0.5;坪數 25:在 20–30 中間 → 0.5
    expect(f.dims.map((d) => [d.key, d.score])).toEqual([
      ["price", 0.5],
      ["size", 0.5],
    ]);
    expect(f).toMatchObject({ level: "yellow", score: 0.5 });
    expect(computeFit({ ...home, rent: 20000, size_ping: 30 }, r)).toMatchObject({ level: "green", score: 1 });
    expect(computeFit({ ...home, rent: 29000, size_ping: 21 }, r)).toMatchObject({ level: "red" });
  });

  it("行情:便宜 10% 以上滿分、貴 20% 以上零分;權重 0 不算", () => {
    const r = req({ budget_max: 30000, weights: { price: 0, market: 1, commute: 0, size: 0, age: 0 } });
    expect(computeFit(home, r, { marketDiff: -15 })!.score).toBe(1);
    expect(computeFit(home, r, { marketDiff: 5 })!.score).toBe(0.5);
    expect(computeFit(home, r, { marketDiff: 25 })!.score).toBe(0);
    // 只有硬性條件、沒有任何軟性維度 → 過了就綠
    expect(computeFit(home, r)).toMatchObject({ level: "green", score: null });
  });

  it("屋齡:上限 ×0.4 內滿分", () => {
    const r = req({ age_max: 40, weights: { price: 0, market: 0, commute: 0, size: 0, age: 1 } });
    expect(computeFit({ ...home, building_age: 10 }, r)!.score).toBe(1);
    expect(computeFit({ ...home, building_age: 28 }, r)!.score).toBe(0.5);
    expect(computeFit({ ...home, building_age: 45 }, r)!.level).toBe("red");
  });
});
