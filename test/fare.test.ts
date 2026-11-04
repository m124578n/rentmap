import { describe, expect, it } from "vitest";
import { bikeFare, metroFare, traFare, tripFare } from "../src/shared/fare";
import type { Trip } from "../src/shared/trip";

describe("fare", () => {
  it("metro by distance: 20 within 5 km, +5 per 3 km, capped at 65", () => {
    expect(metroFare(3)).toBe(20);
    expect(metroFare(5)).toBe(20);
    expect(metroFare(6)).toBe(25);
    expect(metroFare(11)).toBe(30);
    expect(metroFare(80)).toBe(65);
  });
  it("TRA min 15; YouBike 5 within 30 min", () => {
    expect(traFare(3)).toBe(15);
    expect(traFare(20)).toBe(29);
    expect(bikeFare(20)).toBe(5);
    expect(bikeFare(45)).toBe(15);
  });
  it("sums legs; brief falls back to the flat table; driving uses km", () => {
    const trip: Trip = {
      kind: "bus+mrt",
      total_min: 30,
      transfers: 1,
      summary: "262 → 板南線",
      legs: [
        { mode: "walk", min: 3, m: 200, to: "站" },
        { mode: "bus", min: 10, wait: 4, name: "262", variant: null, key: "k", to_name: null, from: "a", to: "b", board_seq: 1, alight_seq: 5, from_pt: [121.5, 25], to_pt: [121.51, 25], stops: 4, exact: true },
        // 約 1.1 km 的捷運段 → 20
        { mode: "mrt", min: 5, wait: 3, lines: ["板南線"], colors: ["#0070bd"], from: "A", to: "B", stops: 2, path: [{ lat: 25.04, lng: 121.5, color: "" }, { lat: 25.04, lng: 121.51, color: "" }] },
      ],
    };
    expect(tripFare(trip)).toBe(35);
    expect(tripFare({ kind: "mrt", total_min: 10, transfers: 0, summary: "" })).toBe(25);
    expect(tripFare({ kind: "scooter", total_min: 10, transfers: 0, summary: "", km: 8.4 })).toBe(8);
    expect(tripFare({ kind: "walk", total_min: 10, transfers: 0, summary: "" })).toBe(0);
  });
});
