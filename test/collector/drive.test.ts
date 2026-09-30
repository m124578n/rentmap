import { describe, expect, it } from "vitest";
import { driveBrief, driveMin, isPeak, roadKm } from "../../src/shared/drive";
import { monthlyCost } from "../../src/shared/cost";

const PEAK = { day: "wd", time: "08:00" } as const;
const OFF = { day: "wd", time: "11:00" } as const;

describe("機車 / 開車通勤(估)", () => {
  it("尖峰判斷:平日 7–9:30、17–19:30", () => {
    expect(isPeak(PEAK)).toBe(true);
    expect(isPeak({ day: "wd", time: "18:30" })).toBe(true);
    expect(isPeak(OFF)).toBe(false);
    expect(isPeak({ day: "sat", time: "08:00" })).toBe(false);
  });

  it("5km 直線:道路 6.5km;機車尖峰 24km/h + 牽車 4 分", () => {
    expect(roadKm(5000)).toBe(6.5);
    expect(driveMin("scooter", 5000, PEAK)).toBe(4 + Math.round((6.5 / 24) * 60));
    expect(driveMin("scooter", 5000, OFF)).toBeLessThan(driveMin("scooter", 5000, PEAK));
    expect(driveMin("car", 5000, PEAK)).toBeGreaterThan(driveMin("scooter", 5000, PEAK));
    // 台中路比較空
    expect(driveMin("scooter", 5000, PEAK, "taichung")).toBeLessThan(driveMin("scooter", 5000, PEAK, "north"));
    expect(driveMin("scooter", 0, PEAK)).toBe(4);
  });

  it("每月支出:依公里算油錢,不套 TPASS", () => {
    const go = driveBrief("scooter", 5000, PEAK);
    const back = driveBrief("scooter", 5000, { day: "wd", time: "18:00" });
    expect(go).toMatchObject({ kind: "scooter", transfers: 0, km: 6.5 });
    const c = monthlyCost({ rent: 10000, size_ping: 8, mgmt_fee: 0 }, { commute: { go, back, place: "公司" }, days: 5 })!;
    const line = c.lines.find((l) => l.key === "commute")!;
    expect(line.amount).toBe(Math.round((13 * 5 * 52) / 12));
    expect(line.note).toContain("油錢");
  });
});
