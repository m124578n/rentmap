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
  TravelTimes?: { FromStationID: string; ToStationID: string; FromStationName?: { Zh_tw?: string }; ToStationName?: { Zh_tw?: string }; RunTime?: number; StopTime?: number }[];
}

/**
 * TDX 站號 → mrt.json 的 ref。北捷 / 新北 / 機捷一樣;高雄捷運(R10、O5)與輕軌(C1)在 mrt.json 加 K 前綴(KR10、KO5、KC1),
 * 高雄 2026-09-30 對過 mrt.json(KR / KO / KC 都有段)。台中捷運的站號兩邊對不起來,改用站名對(見 tmrtNameMap);這裡的 TG 前綴只是沒有站名表時的後備。
 */
export function tdxRef(op: string | undefined, id: string) {
  if (op === "KRTC" || op === "KLRT") return /^K/.test(id) ? id : `K${id}`;
  if (op === "TMRT") return /^\d/.test(id) ? `TG${id}` : id;
  return id;
}

/** 站名正規化(臺 → 台、去掉結尾的「站」與括號註記),給「用站名對站號」用 */
export const normStationName = (s: string) => s.replace(/臺/g, "台").replace(/\(.*\)$/, "").replace(/站$/, "").replace(/\s/g, "");

/**
 * 台中捷運:TDX 的站號是 G0、G3、G8a…,mrt.json(OSM)是 TG103A、TG103、TG109…,兩套編號對不起來
 * (2026-09-30 實測 18 站用站名全部對得上),所以用站名對。回傳 正規化站名 → mrt.json 的站號。
 */
export function tmrtNameMap(stations: { name: string; refs: string[] }[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const st of stations) {
    const ref = st.refs.find((r) => r.startsWith("TG"));
    if (ref) m.set(normStationName(st.name), ref);
  }
  return m;
}

export function buildMrtTimes(items: (TdxS2S & { op?: string })[], tmrtByName?: Map<string, string>): { edges: Record<string, number> } {
  const ref = (op: string | undefined, id: string, name?: { Zh_tw?: string }) =>
    (op === "TMRT" && tmrtByName && name?.Zh_tw ? tmrtByName.get(normStationName(name.Zh_tw)) : undefined) ?? tdxRef(op, id);
  const edges: Record<string, number> = {};
  for (const r of items) {
    if (r.TrainType === 2) continue; // 機捷直達車
    for (const t of r.TravelTimes ?? []) {
      const sec = (t.RunTime ?? 0) + (t.StopTime ?? 0);
      if (!t.FromStationID || !t.ToStationID || t.FromStationID === t.ToStationID || sec <= 0) continue;
      const k = mrtPairKey(ref(r.op, t.FromStationID, t.FromStationName), ref(r.op, t.ToStationID, t.ToStationName));
      edges[k] = Math.max(edges[k] ?? 0, sec);
    }
  }
  return { edges: Object.fromEntries(Object.entries(edges).sort(([a], [b]) => a.localeCompare(b))) };
}
