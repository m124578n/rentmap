import { describe, expect, it } from "vitest";
import { addressQueries, normalizeAddress, rankHits, roadOf, shortLabel } from "../../src/shared/address";

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

describe("rankHits (real Nominatim quirk)", () => {
  it("roadOf", () => {
    expect(roadOf("臺北市信義區市府路")).toBe("市府路");
    expect(roadOf("台北市大安區復興南路一段390號")).toBe("復興南路一段");
    expect(roadOf("臺北市內湖區瑞光路513巷22弄")).toBe("瑞光路513巷22弄");
    expect(roadOf("新北市板橋區")).toBeNull();
  });
  it("drops a neighbouring road Nominatim ranked first", () => {
    const hits = [
      { display_name: "基隆路一段, 興隆里, 信義區, 興雅, 臺北市, 110206, 臺灣" },
      { display_name: "市府路, 西村里, 信義區, 信義商圈, 臺北市, 11001, 臺灣" },
      { display_name: "市府路, 興隆里, 信義區, 信義商圈, 臺北市, 11008, 臺灣" },
    ];
    expect(rankHits("臺北市信義區市府路", hits).map((h) => h.display_name.split(",")[0])).toEqual(["市府路", "市府路"]);
  });
  it("keeps everything when nothing matches", () => {
    const hits = [{ display_name: "某某大樓, 信義區, 臺北市, 臺灣" }];
    expect(rankHits("臺北市信義區市府路", hits)).toEqual(hits);
  });
});
