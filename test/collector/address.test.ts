import { describe, expect, it } from "vitest";
import { addressQueries, normalizeAddress, shortLabel } from "../../src/shared/address";

describe("address → Nominatim queries", () => {
  it("normalizes full-width digits, zip code, 台→臺", () => {
    expect(normalizeAddress("100 台北市中正區忠孝西路一段４９號")).toBe("臺北市中正區忠孝西路一段49號");
  });

  it("falls back from floor → number → lane → road", () => {
    expect(addressQueries("台北市大安區復興南路一段390巷2弄5號3樓").map((x) => x.q)).toEqual([
      "臺北市大安區復興南路一段390巷2弄5號3樓",
      "臺北市大安區復興南路一段390巷2弄5號",
      "臺北市大安區復興南路一段390巷",
      "臺北市大安區復興南路一段",
    ]);
  });

  it("marks levels", () => {
    const q = addressQueries("新北市板橋區文化路一段100號");
    expect(q[0]).toEqual({ q: "新北市板橋區文化路一段100號", level: "exact" });
    expect(q.at(-1)).toEqual({ q: "新北市板橋區文化路一段", level: "road" });
  });

  it("road-only input stays one query", () => {
    expect(addressQueries("信義路五段")).toEqual([{ q: "信義路五段", level: "road" }]);
    expect(addressQueries("  ")).toEqual([]);
  });

  it("shortLabel reorders Nominatim display_name", () => {
    expect(shortLabel("49, 忠孝西路一段, 黎明里, 中正區, 臺北市, 100, 臺灣")).toBe("臺北市 中正區 黎明里 忠孝西路一段 49");
  });
});
