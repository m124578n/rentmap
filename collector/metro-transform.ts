/**
 * TDX 捷運站間時間(Rail/Metro/S2STravelTime)→ public/mrt-times.json。純函式,測試在 test/collector/metro.test.ts。
 *
 * 實測 2026-09:TRTC 每條線分「全程 / 區間車」各一份;TYMC(機捷)是任兩站都列(普通車 TrainType 1、直達車 2);
 * NTMC 有環狀線、三鶯線;淡海、安坑輕軌 TDX 沒有,維持距離估。
 * 只收普通車,同一段兩個方向 / 多份取最大(保守),秒 = RunTime + StopTime。
 */
import { mrtPairKey } from "../src/shared/trip";

export interface TdxS2S {
  LineID?: string;
  RouteID?: string;
  TrainType?: number;
  TravelTimes?: { FromStationID: string; ToStationID: string; RunTime?: number; StopTime?: number }[];
}

export function buildMrtTimes(items: TdxS2S[]): { edges: Record<string, number> } {
  const edges: Record<string, number> = {};
  for (const r of items) {
    if (r.TrainType === 2) continue; // 機捷直達車
    for (const t of r.TravelTimes ?? []) {
      const sec = (t.RunTime ?? 0) + (t.StopTime ?? 0);
      if (!t.FromStationID || !t.ToStationID || t.FromStationID === t.ToStationID || sec <= 0) continue;
      const k = mrtPairKey(t.FromStationID, t.ToStationID);
      edges[k] = Math.max(edges[k] ?? 0, sec);
    }
  }
  return { edges: Object.fromEntries(Object.entries(edges).sort(([a], [b]) => a.localeCompare(b))) };
}
