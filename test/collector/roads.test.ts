import { describe, expect, it } from "vitest";
import { costTable, decodeRoads, encodeRoads, indexRoads, NO_CAR, NO_SCOOTER, reverseRoads, roadTimes, ROAD_CLASSES, snapRoad } from "../../src/shared/roads";
import { roadFactor } from "../../src/shared/drive";

const C = (name: (typeof ROAD_CLASSES)[number]) => ROAD_CLASSES.indexOf(name);

/**
 *   0 ──primary 1km── 1 ──primary 1km── 2
 *   │                                   │
 *   └───────── motorway 1.5km(只能開車)┘   (0 → 2 單向)
 *   3 ──residential 300m── 1,1 → 3 單行(3 → 1 不行)
 */
const nodes: [number, number][] = [
  [25.0, 121.5],
  [25.0, 121.51],
  [25.0, 121.52],
  [25.003, 121.51],
];
const edges: [number, number, number, number][] = [
  [0, 1, 1000, C("primary")],
  [1, 0, 1000, C("primary")],
  [1, 2, 1000, C("primary")],
  [2, 1, 1000, C("primary")],
  [0, 2, 1500, C("motorway") | NO_SCOOTER],
  [1, 3, 300, C("residential")],
];
const g = decodeRoads(encodeRoads(nodes, edges));

describe("道路圖格式", () => {
  it("編碼 / 解碼一致,邊依起點排(CSR)", () => {
    expect(g.n).toBe(4);
    expect(g.e).toBe(6);
    expect([...g.off]).toEqual([0, 2, 5, 6, 6]);
    expect(g.lat[3]).toBe(25003000);
    expect(() => decodeRoads(new Uint8Array([1, 2, 3, 4, 0, 0, 0, 0, 0, 0, 0, 0]))).toThrow(/格式/);
  });
});

describe("最短時間", () => {
  it("機車不能上國道、汽車可以", () => {
    const s = roadTimes(g, costTable("scooter"), 0);
    const c = roadTimes(g, costTable("car"), 0);
    expect(s.m[2]).toBe(2000); // 繞平面道路
    expect(c.m[2]).toBe(1500); // 走國道
    expect(c.sec[2]).toBeCloseTo((1500 * 3.6) / 85, 5);
  });

  it("單行:1 → 3 可以,3 出不去;反向圖算「各點到目的地」", () => {
    const fwd = roadTimes(g, costTable("scooter"), 3);
    expect(fwd.sec[1]).toBe(Infinity);
    const toThree = roadTimes(reverseRoads(g), costTable("scooter"), 3);
    expect(toThree.m[0]).toBe(1300); // 0 → 1 → 3
    expect(Number.isFinite(toThree.sec[2]!)).toBe(true);
  });

  it("係數:平面道路整個乘,國道只乘平方根;北區尖峰比中南部離峰慢", () => {
    const f = 1.44;
    expect(costTable("car", f)[C("primary")]! / costTable("car")[C("primary")]!).toBeCloseTo(1.44, 5);
    expect(costTable("car", f)[C("motorway")]! / costTable("car")[C("motorway")]!).toBeCloseTo(1.2, 5);
    expect(costTable("scooter")[C("motorway") | NO_SCOOTER]).toBe(Infinity);
    expect(costTable("car")[C("primary") | NO_CAR]).toBe(Infinity);
    const peak = { day: "wd" as const, time: "08:00" };
    const off = { day: "sun" as const, time: "08:00" };
    expect(roadFactor("scooter", peak, "north")).toBeGreaterThan(roadFactor("scooter", off, "north"));
    expect(roadFactor("scooter", off, "north")).toBeGreaterThan(roadFactor("scooter", off, "tainan"));
    expect(roadFactor("scooter", off, "tainan")).toBe(1);
  });

  it("只要幾個目標時提早停,目標的結果一樣", () => {
    const all = roadTimes(g, costTable("scooter"), 0);
    const some = roadTimes(g, costTable("scooter"), 0, 3 * 3600, [1]);
    expect(some.sec[1]).toBe(all.sec[1]);
  });
});

describe("最近的路口", () => {
  it("只找這個車種能進出的節點", () => {
    // 加一個只有國道經過的點 4,在 0 旁邊
    const g2 = decodeRoads(
      encodeRoads(
        [...nodes, [25.0001, 121.5001]],
        [...edges, [4, 2, 1400, C("motorway") | NO_SCOOTER]],
      ),
    );
    const idx = indexRoads(g2);
    expect(snapRoad(g2, idx, "car", 25.0001, 121.5001)!.node).toBe(4);
    expect(snapRoad(g2, idx, "scooter", 25.0001, 121.5001)!.node).toBe(0);
    expect(snapRoad(g2, idx, "scooter", 26, 122)).toBeNull();
  });
});
