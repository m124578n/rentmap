import { describe, expect, it } from "vitest";
import { buildRailGraph, mrtGraph, mrtLabels, mrtPath, mrtWait, TRA_TRANSFER_MIN } from "../src/worker/transit/mrt";
import { railLines, railStop } from "../src/shared/trip";

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

describe("台鐵併進軌道圖", () => {
  // 台北(1000)— 板橋(1020)— 桃園(1080);台北、板橋旁邊有捷運站
  const tra = {
    updated: "2026-10-01",
    headway: [12, 20, 30] as [number, number, number],
    stations: [
      { id: "1000", name: "台北", lat: 25.0478, lng: 121.5170 },
      { id: "1020", name: "板橋", lat: 25.0141, lng: 121.4638 },
      { id: "1080", name: "桃園", lat: 24.9892, lng: 121.3136 },
    ],
    edges: { "1000-1020": 540, "1020-1080": 1200 },
  };
  const rg = buildRailGraph(tra);
  const idx = (name: string) => rg.stations.find((s) => s.name === name)!.idx;

  it("台鐵站帶前綴、跟附近捷運站互轉", () => {
    expect(rg.stations.filter((s) => s.rail === "tra").map((s) => s.name)).toEqual(["台鐵台北", "台鐵板橋", "台鐵桃園"]);
    const L = mrtLabels(rg, [{ station: idx("台鐵桃園"), cost: 0, tag: 0 }]);
    // 捷運龍山寺 → 板南線到板橋 → 轉台鐵到桃園
    const node = rg.nodesOfStation[idx("龍山寺")]!.reduce((a, b) => (L.dist[a]! <= L.dist[b]! ? a : b));
    const p = mrtPath(rg, L, node);
    expect(p.lines).toEqual(["板南線", "台鐵"]);
    expect(p.to).toBe("台鐵桃園");
    expect(L.dist[node]).toBeGreaterThan(20 + TRA_TRANSFER_MIN);
  });

  it("沒有台鐵資料時跟原本一樣", () => {
    const empty = buildRailGraph({ updated: null, headway: [15, 20, 30], stations: [], edges: {} });
    // g 讀的是 repo 裡的 public/tra.json(抓過台鐵後就有站),所以只比捷運站數,不假設那個檔是空的
    expect(empty.stations.filter((s) => s.rail === "tra")).toEqual([]);
    expect(empty.stations.length).toBe(g.stations.filter((s) => s.rail !== "tra").length);
  });

  it("摘要與站名", () => {
    expect(railLines(["板南線", "文湖線"])).toBe("捷運板南線→文湖線");
    expect(railLines(["台鐵"])).toBe("台鐵");
    expect(railLines(["高雄捷運橘線", "高雄捷運紅線"])).toBe("高雄捷運橘線→高雄捷運紅線");
    expect(railLines(["台鐵", "台中捷運綠線"])).toBe("台鐵→台中捷運綠線");
    expect(railLines(["淡海輕軌", "淡水信義線"])).toBe("淡海輕軌→淡水信義線");
    expect(railLines(["板南線", "台鐵", "淡水信義線"])).toBe("捷運板南線→台鐵→捷運淡水信義線");
    expect(railStop("台鐵板橋")).toBe("台鐵板橋站");
    expect(railStop("公館")).toBe("捷運公館站");
    expect(mrtWait("TRA", "wd", 8 * 60)).toBeGreaterThan(0);
  });
});

describe("台中、高雄的軌道圖", () => {
  it("高雄紅橘線在美麗島換線、輕軌環狀;台中綠線整條連通", () => {
    const kh = buildRailGraph({ updated: null, headway: [15, 20, 30], stations: [], edges: {} }, "kaohsiung");
    const tc = buildRailGraph({ updated: null, headway: [15, 20, 30], stations: [], edges: {} }, "taichung");
    expect(kh.stations.every((s) => s.lat < 23.5)).toBe(true);
    for (const gg of [kh, tc]) {
      const L = mrtLabels(gg, [{ station: 0, cost: 0, tag: 0 }]);
      const unreachable = gg.stations.filter((s) => gg.nodesOfStation[s.idx]!.every((n) => L.dist[n] === Infinity)).map((s) => s.name);
      expect(unreachable).toEqual([]);
    }
    const idx = (name: string) => kh.stations.find((s) => s.name === name)!.idx;
    const L = mrtLabels(kh, [{ station: idx("大東"), cost: 0, tag: 0 }]);
    const node = kh.nodesOfStation[idx("小港")]!.reduce((a, b) => (L.dist[a]! <= L.dist[b]! ? a : b));
    expect(mrtPath(kh, L, node).lines).toEqual(["高雄捷運紅線", "高雄捷運橘線"]);
    // 北區的圖不會混進台中、高雄的站
    expect(mrtGraph("north").stations.some((s) => s.lat < 24.5)).toBe(false);
  });
});
