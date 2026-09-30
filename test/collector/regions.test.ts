import { describe, expect, it } from "vitest";
import { CITY_INFO, cityAt, regionAt, coverageCities, hasCoverage, normalizeCity, OPEN_CITIES, regionBbox, regionOfCity, REGIONS } from "../../src/shared/regions";
import { CITIES, DISTRICTS } from "../../src/shared/constants";

describe("regions", () => {
  it("四個生活圈都開放(六都 + 基隆)", () => {
    expect(OPEN_CITIES).toEqual(["台北市", "新北市", "桃園市", "基隆市", "台中市", "台南市", "高雄市"]);
    expect(CITIES).toEqual(OPEN_CITIES);
    expect(Object.values(REGIONS).filter((r) => r.enabled).map((r) => r.key)).toEqual(["north", "taichung", "tainan", "kaohsiung"]);
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
    expect(regionAt(24.15, 120.67)).toBe("taichung");
    expect(regionAt(22.63, 120.3)).toBe("kaohsiung");
    expect(regionAt(35.68, 139.76)).toBeNull();
    expect(regionBbox("north")).toEqual([120.98, 24.58, 122.01, 25.3]);
  });

  it("縣市界:新北包著台北、高雄北邊伸進台南外框都分得對", () => {
    const cases: [number, number, string | null][] = [
      [25.0339, 121.5645, "台北市"], // 101
      [25.0143, 121.4638, "新北市"], // 板橋
      [25.0636, 121.4833, "新北市"], // 三重
      [24.9537, 121.2254, "桃園市"], // 中壢
      [25.1283, 121.7419, "基隆市"],
      [24.1377, 120.6869, "台中市"],
      [22.9971, 120.2127, "台南市"], // 台南市區
      [22.9067, 120.1826, "高雄市"], // 茄萣(在台南外框裡)
      [23.0833, 120.5874, "高雄市"], // 甲仙
      [22.6273, 120.3014, "高雄市"],
      [35.68, 139.76, null],
    ];
    for (const [lat, lng, city] of cases) expect(cityAt(lat, lng), `${lat},${lng}`).toBe(city);
    expect(regionAt(22.9067, 120.1826)).toBe("kaohsiung");
  });

  it("data coverage replaces hard-coded Taipei checks", () => {
    expect(hasCoverage("臺北市", "liquefaction")).toBe(true);
    expect(hasCoverage("新北市", "liquefaction")).toBe(false);
    expect(hasCoverage("新北市", "crimeDistricts")).toBe(true);
    expect(coverageCities("theftPoints")).toBe("台北市");
    expect(coverageCities("garbage")).toBe("台北市、新北市、台中市、台南市、高雄市");
    expect(coverageCities("garbage", "north")).toBe("台北市、新北市");
    expect(coverageCities("garbage", "taichung")).toBe("台中市");
    expect(coverageCities("theftPoints", "taichung")).toBe("");
  });
});
