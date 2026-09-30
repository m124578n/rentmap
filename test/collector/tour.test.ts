import { describe, expect, it } from "vitest";
import { bestTourOrder } from "../../src/shared/trip";

describe("tour order", () => {
  it("tries every order from the start; open path, no return", () => {
    // 節點 0 = 起點,1..3 = 看房點;起點離 3 最近,3→1→2 最順
    const m = [
      [null, 30, 40, 5],
      [null, null, 5, 30],
      [null, 5, null, 30],
      [null, 10, 20, null],
    ];
    expect(bestTourOrder(m, true)).toEqual({ order: [2, 0, 1], total: 20 });
  });

  it("without a start, any first stop; unreachable legs are avoided", () => {
    const m = [
      [null, 10, null],
      [10, null, 3],
      [null, 3, null],
    ];
    expect(bestTourOrder(m, false)).toEqual({ order: [0, 1, 2], total: 13 });
    expect(bestTourOrder([[null, null], [null, null]], false)).toBeNull();
  });
});
