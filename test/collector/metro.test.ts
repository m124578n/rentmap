import { describe, expect, it } from "vitest";
import { buildMrtTimes, tdxRef } from "../../collector/metro-transform";
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
  it("高雄、台中的站號對上 mrt.json(不跟台北的 R10 撞)", () => {
    expect(tdxRef("KRTC", "R10")).toBe("KR10");
    expect(tdxRef("KLRT", "C14")).toBe("KC14");
    expect(tdxRef("TMRT", "103a")).toBe("TG103a");
    expect(tdxRef("TRTC", "R10")).toBe("R10");
    const { edges } = buildMrtTimes([{ op: "KRTC", TrainType: 1, TravelTimes: [{ FromStationID: "R10", ToStationID: "R11", RunTime: 90, StopTime: 30 }] }]);
    expect(edges).toEqual({ "KR10-KR11": 120 });
  });
});

describe("台中捷運用站名對站號", () => {
  it("TDX 的 G0 / G3 / G8a 對到 mrt.json 的 TG103A / TG103 / TG109", async () => {
    const { buildMrtTimes, tmrtNameMap } = await import("../../collector/metro-transform");
    const map = tmrtNameMap([
      { name: "北屯總站", refs: ["TG103A"] },
      { name: "舊社", refs: ["TG103"] },
      { name: "高鐵台中站", refs: ["TG119"] },
      { name: "烏日", refs: ["TG118"] },
      { name: "市政府", refs: ["BL18"] }, // 台北的市政府不是 TG,不會混進來
    ]);
    expect(map.get("市政府")).toBeUndefined();
    const seg = (a: string, an: string, b: string, bn: string, s: number) => ({ FromStationID: a, FromStationName: { Zh_tw: an }, ToStationID: b, ToStationName: { Zh_tw: bn }, RunTime: s, StopTime: 0 });
    const out = buildMrtTimes([{ op: "TMRT", TravelTimes: [seg("G0", "北屯總站", "G3", "舊社", 124), seg("G16", "烏日", "G17", "高鐵臺中站", 150)] }], map);
    expect(Object.keys(out.edges).sort()).toEqual(["TG103-TG103A", "TG118-TG119"].sort());
  });
});
