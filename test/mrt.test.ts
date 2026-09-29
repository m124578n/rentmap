import { describe, expect, it } from "vitest";
import { mrtGraph, mrtLabels, mrtPath } from "../src/worker/transit/mrt";

const g = mrtGraph();
const st = (name: string) => g.stations.find((s) => s.name === name)!.idx;
/** 從 from 站上車到 to 站下車:最佳節點與路徑 */
function ride(from: string, to: string) {
  const L = mrtLabels(g, [{ station: st(to), cost: 0, tag: 0 }]);
  const node = g.nodesOfStation[st(from)]!.reduce((a, b) => (L.dist[a]! <= L.dist[b]! ? a : b));
  return { min: L.dist[node]!, ...mrtPath(g, L, node) };
}

describe("MRT graph from mrt.json", () => {
  it("every station reachable from 台北車站", () => {
    const L = mrtLabels(g, [{ station: st("台北車站"), cost: 0, tag: 0 }]);
    const unreachable = g.stations.filter((s) => g.nodesOfStation[s.idx]!.every((n) => L.dist[n] === Infinity)).map((s) => s.name);
    expect(unreachable).toEqual([]);
  });

  it("branches join the trunk", () => {
    expect(ride("新北投", "淡水").path.length).toBeGreaterThan(5);
    expect(ride("小碧潭", "新店").lines).toEqual(["松山新店線"]);
    expect(ride("蘆洲", "大橋頭").stops).toBe(5); // O54→O50 四站,再到 O12
    expect(ride("淡水漁人碼頭", "紅樹林").lines).toEqual(["淡海輕軌"]);
  });

  it("line change inside the MRT", () => {
    const r = ride("龍山寺", "台大醫院");
    expect(r.lines).toEqual(["板南線", "淡水信義線"]);
    expect(r.to).toBe("台大醫院");
    expect(r.min).toBeGreaterThan(8);
    expect(r.min).toBeLessThan(15);
  });

  it("plausible travel times", () => {
    const r = ride("台北車站", "市政府");
    expect(r.stops).toBe(6);
    expect(r.min).toBeGreaterThan(9);
    expect(r.min).toBeLessThan(16);
    expect(ride("淡水", "象山").min).toBeGreaterThan(45);
    expect(ride("淡水", "象山").min).toBeLessThan(65);
  });
});
