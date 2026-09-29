import { describe, expect, it } from "vitest";
import { daysBetween, parsePostedAt, summarizePrice } from "../../src/shared/listing";

const now = new Date("2026-09-30T05:00:00Z"); // 台灣 9/30 13:00

describe("parsePostedAt", () => {
  it("591 month-day without year", () => {
    expect(parsePostedAt("此房屋在7月28日發佈", now)).toBe("2026-07-28");
    // 比今天晚的月日 → 去年
    expect(parsePostedAt("此房屋在12月3日發佈", now)).toBe("2025-12-03");
  });
  it("full dates and relative", () => {
    expect(parsePostedAt("2026/09/22 16:51", now)).toBe("2026-09-22");
    expect(parsePostedAt("24天前更新", now)).toBe("2026-09-06");
    expect(parsePostedAt("3小時前", now)).toBe("2026-09-30");
    expect(parsePostedAt("昨天", now)).toBe("2026-09-29");
    expect(parsePostedAt("不知道", now)).toBeNull();
    expect(parsePostedAt(undefined, now)).toBeNull();
  });
  it("uses Taiwan date near midnight", () => {
    expect(parsePostedAt("剛剛", new Date("2026-09-30T17:30:00Z"))).toBe("2026-10-01");
  });
});

describe("daysBetween", () => {
  it("counts Taiwan calendar days", () => {
    expect(daysBetween("2026-07-28", now)).toBe(64);
    expect(daysBetween("2026-09-30T01:00:00Z", now)).toBe(0);
    expect(daysBetween("2026-09-29T15:59:00Z", now)).toBe(1); // 台灣 9/29 23:59
  });
});

describe("summarizePrice", () => {
  it("merges repeats and reports last and total change", () => {
    const s = summarizePrice([
      { rent: 20000, at: "2026-08-01T00:00:00Z" },
      { rent: 20000, at: "2026-08-05T00:00:00Z" },
      { rent: 19000, at: "2026-09-01T00:00:00Z" },
      { rent: 18500, at: "2026-09-20T00:00:00Z" },
    ])!;
    expect(s).toEqual({ current: 18500, first: 20000, prev: 19000, changedAt: "2026-09-20T00:00:00Z", lastDelta: -500, totalDelta: -1500, changes: 2 });
  });
  it("no change", () => {
    expect(summarizePrice([{ rent: 15000, at: "2026-09-01T00:00:00Z" }])).toMatchObject({ prev: null, changedAt: null, lastDelta: 0, totalDelta: 0, changes: 0 });
    expect(summarizePrice([])).toBeNull();
  });
});
