import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BusRouteIn, BusStopIn, summarizeDay } from "../../src/shared/bus";
import { cleanRouteName, parseWkt, simplify, transformCity, type TdxCity } from "../../collector/bus/transform";

const data = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "fixtures", "tdx-mini.json"), "utf8")) as TdxCity;
const { routes, stops } = transformCity("Taipei", data);
const byKey = new Map(routes.map((r) => [r.key, r]));

describe("TDX bus transform", () => {
  it("passes the shared ingest schemas", () => {
    for (const r of routes) expect(BusRouteIn.safeParse(r).success, r.key).toBe(true);
    for (const s of stops) expect(BusStopIn.safeParse(s).success, `${s.route_key}#${s.seq}`).toBe(true);
  });

  it("one key per subroute × direction, names cleaned", () => {
    expect([...byKey.keys()].sort()).toEqual(["TPE107230:0", "TPE107230:1", "TPE15680:0"]);
    expect(byKey.get("TPE107230:0")).toMatchObject({ name: "307", route_uid: "TPE10723", direction: 0, from_name: "撫遠街", to_name: "松山高中", stop_count: 3 });
    expect(byKey.get("TPE15680:0")!.name).toBe("紅30");
  });

  it("stops sorted by sequence, zero coordinates dropped, distance accumulates", () => {
    const s = stops.filter((x) => x.route_key === "TPE107230:0");
    expect(s.map((x) => x.name)).toEqual(["撫遠街", "松山車站", "松山高中"]);
    expect(s[0]!.dist_m).toBe(0);
    expect(s[1]!.dist_m).toBeGreaterThan(500);
    expect(s[2]!.dist_m).toBeGreaterThan(s[1]!.dist_m);
  });

  it("uses the TDX shape when present, falls back to stops", () => {
    expect(byKey.get("TPE107230:0")!.shape.length).toBeGreaterThanOrEqual(2);
    expect(byKey.get("TPE107230:0")!.length_m).toBeGreaterThan(1500);
    // 返程沒有 shape → 用站連線
    expect(byKey.get("TPE107230:1")!.shape).toEqual([
      [121.5652, 25.0452],
      [121.5702, 25.0612],
    ]);
    // MULTILINESTRING 接起來
    expect(byKey.get("TPE15680:0")!.shape[0]).toEqual([121.533, 25.042]);
  });

  it("frequency bands → headway summary per day type", () => {
    const sch = byKey.get("TPE107230:0")!.schedule!;
    expect(sch.wd!.bands).toHaveLength(3);
    expect(sch.sat!.bands).toHaveLength(1);
    expect(summarizeDay(sch.wd)).toEqual({ first: "05:30", last: "23:00", peak: [3, 6], offpeak: [8, 15], trips: null });
  });

  it("timetables → first-stop departures and per-stop minutes", () => {
    const sch = byKey.get("TPE15680:0")!.schedule!;
    expect(sch.wd!.deps).toEqual(["07:10", "07:40"]);
    expect(sch.sat!.deps).toEqual(["09:00"]);
    expect(sch.sun).toBeUndefined();
    const s = stops.filter((x) => x.route_key === "TPE15680:0");
    expect(s.map((x) => x.t_min)).toEqual([0, 6]);
    expect(summarizeDay(sch.wd)).toMatchObject({ first: "07:10", last: "07:40", peak: [30, 30], trips: 2 });
  });
});

describe("helpers", () => {
  it("cleanRouteName", () => {
    expect(cleanRouteName("307去程")).toBe("307");
    expect(cleanRouteName("藍7(返)")).toBe("藍7");
    expect(cleanRouteName("307莒光")).toBe("307莒光");
  });
  it("parseWkt + simplify drops collinear points", () => {
    const pts = parseWkt("LINESTRING(121.5 25.0, 121.5005 25.0, 121.501 25.0, 121.501 25.001)");
    expect(pts).toHaveLength(4);
    expect(simplify(pts)).toEqual([
      [121.5, 25],
      [121.501, 25],
      [121.501, 25.001],
    ]);
  });
});
