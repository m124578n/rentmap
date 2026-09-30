import { describe, expect, it } from "vitest";
import { CITY_INFO, regionAt, coverageCities, hasCoverage, normalizeCity, OPEN_CITIES, regionBbox, regionOfCity, REGIONS } from "../../src/shared/regions";
import { CITIES, DISTRICTS } from "../../src/shared/constants";

describe("regions", () => {
  it("only north (北北基桃) is open for now", () => {
    expect(OPEN_CITIES).toEqual(["台北市", "新北市", "桃園市", "基隆市"]);
    expect(CITIES).toEqual(["台北市", "新北市", "桃園市", "基隆市"]);
    expect(Object.values(REGIONS).filter((r) => r.enabled).map((r) => r.key)).toEqual(["north"]);
  });

  it("district lists per city", () => {
    const n = Object.fromEntries(Object.entries(CITY_INFO).map(([k, v]) => [k, v.districts.length]));
    expect(n).toEqual({ 台北市: 12, 新北市: 29, 桃園市: 13, 基隆市: 7, 台中市: 29, 台南市: 37, 高雄市: 38 });
    for (const v of Object.values(CITY_INFO)) expect(new Set(v.districts).size).toBe(v.districts.length);
    expect(DISTRICTS.台北市).toContain("大安區");
  });

  it("city names, region lookup, coordinates", () => {
    expect(normalizeCity("臺北市")).toBe("台北市");
    expect(normalizeCity("台中市")).toBe("台中市");
    expect(normalizeCity("東京都")).toBeNull();
    expect(regionOfCity("臺中市")).toBe("taichung");
    expect(regionOfCity("基隆市")).toBe("north");
    expect(regionAt(25.033, 121.565)).toBe("north"); // 台北
    expect(regionAt(25.012, 121.465)).toBe("north"); // 板橋
    expect(regionAt(24.957, 121.225)).toBe("north"); // 中壢
    expect(regionAt(24.15, 120.67)).toBe("taichung"); // 還沒開,但歸得出來
    expect(regionAt(22.63, 120.3)).toBe("kaohsiung");
    expect(regionAt(35.68, 139.76)).toBeNull();
    expect(regionBbox("north")).toEqual([120.98, 24.58, 122.01, 25.3]);
  });

  it("data coverage replaces hard-coded Taipei checks", () => {
    expect(hasCoverage("臺北市", "liquefaction")).toBe(true);
    expect(hasCoverage("新北市", "liquefaction")).toBe(false);
    expect(hasCoverage("新北市", "crimeDistricts")).toBe(true);
    expect(coverageCities("theftPoints")).toBe("台北市");
    expect(coverageCities("garbage")).toBe("台北市、新北市");
  });
});
