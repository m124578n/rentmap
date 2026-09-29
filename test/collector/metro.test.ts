import { describe, expect, it } from "vitest";
import { buildMrtTimes } from "../../collector/metro-transform";
import { mrtPairKey, mrtRefKey } from "../../src/shared/trip";

describe("TDX metro S2STravelTime", () => {
  it("mrtRefKey 對齊 TDX 與 mrt.json 的編號", () => {
    expect(mrtRefKey("A01")).toBe("A1");
    expect(mrtRefKey("A14a")).toBe("A14A");
    expect(mrtRefKey("R22A")).toBe("R22A");
    expect(mrtPairKey("BL13", "BL12")).toBe(mrtPairKey("BL12", "BL13"));
  });
  it("不分方向取最大、略過直達車與無效段", () => {
    const { edges } = buildMrtTimes([
      { TrainType: 1, TravelTimes: [{ FromStationID: "BL12", ToStationID: "BL13", RunTime: 100, StopTime: 20 }] },
      { TrainType: 1, TravelTimes: [{ FromStationID: "BL13", ToStationID: "BL12", RunTime: 110, StopTime: 25 }] },
      { TrainType: 2, TravelTimes: [{ FromStationID: "A1", ToStationID: "A2", RunTime: 999 }] },
      { TrainType: 1, TravelTimes: [{ FromStationID: "A1", ToStationID: "A2", RunTime: 300, StopTime: 0 }, { FromStationID: "A3", ToStationID: "A3", RunTime: 5 }] },
    ]);
    expect(edges).toEqual({ "A1-A2": 300, "BL12-BL13": 135 });
  });
});
