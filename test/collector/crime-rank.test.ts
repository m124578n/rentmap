import { describe, expect, it } from "vitest";
import { districtRank } from "../../src/shared/crime";
import { CITY_INFO } from "../../src/shared/regions";

describe("治安排名的分母", () => {
  it("沒件數的區算 0 件,分母是該縣市全部行政區", () => {
    // 台南只有 3 個區有件數
    const items = { "台南市|東區": { house: 50 }, "台南市|北區": { house: 30 }, "台南市|安平區": { house: 10 } };
    const all = () => true;
    expect(districtRank(items, ["台南市"], "臺南市", "北區", "house", all)).toEqual({ n: 2, of: CITY_INFO.台南市.districts.length });
    expect(districtRank(items, ["台南市"], "台南市", "左鎮區", "house", all)).toBeNull(); // 0 件不排名
    // 縣市還沒有治安資料:不排名
    expect(districtRank(items, ["台南市"], "台南市", "北區", "house", () => false)).toBeNull();
  });

  it("生活圈裡沒治安資料的縣市不算", () => {
    const items = { "台北市|大安區": { house: 100 }, "新北市|板橋區": { house: 200 } };
    const north = ["台北市", "新北市", "桃園市", "基隆市"];
    // 假設只有雙北有資料(2026-10-01 以前的狀況)
    const twoCities = (c: string) => c === "台北市" || c === "新北市";
    expect(districtRank(items, north, "台北市", "大安區", "house", twoCities)).toEqual({ n: 2, of: CITY_INFO.台北市.districts.length + CITY_INFO.新北市.districts.length });
    // 四個縣市都有資料:分母是四市全部行政區
    const all = () => true;
    const of = north.reduce((n, c) => n + CITY_INFO[c as keyof typeof CITY_INFO].districts.length, 0);
    expect(districtRank(items, north, "台北市", "大安區", "house", all)).toEqual({ n: 2, of });
  });

  it("同件數同名次", () => {
    const items = { "台北市|大安區": { moto: 5 }, "台北市|中正區": { moto: 5 }, "台北市|信義區": { moto: 9 } };
    expect(districtRank(items, ["台北市"], "台北市", "中正區", "moto")!.n).toBe(2);
    expect(districtRank(items, ["台北市"], "台北市", "大安區", "moto")!.n).toBe(2);
  });
});
