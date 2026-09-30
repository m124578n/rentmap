import { describe, expect, it } from "vitest";
import { buildTra, type TdxTraStation, type TdxTraTimetable } from "../../collector/tra-transform";

const st = (id: string, name: string, lat: number, lng: number): TdxTraStation => ({ StationID: id, StationName: { Zh_tw: name }, StationPosition: { PositionLat: lat, PositionLon: lng } });
const train = (type: string, dir: number, stops: [string, string][]): TdxTraTimetable => ({
  TrainInfo: { TrainTypeName: { Zh_tw: type }, Direction: dir },
  StopTimes: stops.map(([id, t], i) => ({ StopSequence: i + 1, StationID: id, DepartureTime: t })),
});
const BBOX: [number, number, number, number] = [121.0, 24.8, 121.8, 25.3];

describe("台鐵 TDX → tra.json", () => {
  const stations = [st("1000", "臺北", 25.0478, 121.517), st("1020", "板橋", 25.0141, 121.4638), st("1080", "桃園", 24.9892, 121.3136), st("3300", "臺中", 24.137, 120.686)];

  it("區間車的站間時間取中位數;區間快跳站多一條邊;自強號不算;出了範圍斷開", () => {
    const trains = [
      train("區間", 1, [["1000", "07:00"], ["1020", "07:09"], ["1080", "07:29"]]),
      train("區間", 1, [["1000", "07:20"], ["1020", "07:30"], ["1080", "07:50"]]),
      train("區間", 1, [["1000", "07:40"], ["1020", "07:48"], ["1080", "08:10"]]),
      train("區間快", 1, [["1000", "08:00"], ["1080", "08:25"]]),
      train("自強(普悠瑪)", 1, [["1000", "08:05"], ["1080", "08:20"]]),
      train("區間", 1, [["1080", "09:00"], ["3300", "10:30"]]),
    ];
    const out = buildTra(stations, trains, BBOX);
    expect(out.stations.map((s) => s.name)).toEqual(["台北", "板橋", "桃園"]);
    expect(out.edges).toEqual({ "1000-1020": 540, "1020-1080": 1200, "1000-1080": 1500 });
  });

  it("班距:每站每方向每小時班次的中位數", () => {
    // 尖峰 7–9 點兩小時,每站單向 4 班 → 每小時 2 班 → 30 分
    const trains = [0, 30, 60, 90].map((m) => train("區間", 0, [["1000", `0${7 + Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`], ["1020", `0${7 + Math.floor((m + 9) / 60)}:${String((m + 9) % 60).padStart(2, "0")}`]]));
    const out = buildTra(stations, trains, BBOX);
    expect(out.headway[0]).toBe(30);
    expect(out.headway[1]).toBe(20); // 離峰沒車:用預設
  });
});
