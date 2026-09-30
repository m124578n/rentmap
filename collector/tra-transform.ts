/**
 * TDX 台鐵(Rail/TRA)站點 + 某個平日的每日時刻表 → public/tra.json。純函式,測試在 test/collector/tra.test.ts。
 *
 * 通勤只看區間車(區間、區間快):自強、莒光要對號、班次少,算進來會低估等車。
 * - 站:生活圈外框內的車站
 * - 站間秒數:每班車相鄰兩停靠站「前站發車 → 後站發車」(含停站),同一段取中位數;區間快跳站就多一條捷徑邊
 * - 班距:每站每方向每小時幾班 → 取各站中位數,換成分鐘;[平日尖峰 7–9 點, 離峰 10–16 點, 晚上 21–24 點]
 * v3 的欄位名與 v2 不完全一樣,兩種都認。
 */

export interface TdxTraStation {
  StationID: string;
  StationName?: { Zh_tw?: string };
  StationPosition?: { PositionLat?: number; PositionLon?: number };
}
interface TdxStopTime {
  StopSequence?: number;
  StationID: string;
  ArrivalTime?: string;
  DepartureTime?: string;
}
interface TdxTrainInfo {
  TrainNo?: string;
  Direction?: number;
  TrainTypeName?: { Zh_tw?: string };
}
export interface TdxTraTimetable {
  TrainInfo?: TdxTrainInfo;
  DailyTrainInfo?: TdxTrainInfo;
  StopTimes?: TdxStopTime[];
}

export interface TraData {
  /** 捷運圖用的班距(分):[平日尖峰, 離峰, 晚上] */
  headway: [number, number, number];
  stations: { id: string; name: string; lat: number; lng: number }[];
  /** "小id-大id" → 秒 */
  edges: Record<string, number>;
}

export const traPairKey = (a: string, b: string) => (a < b ? `${a}-${b}` : `${b}-${a}`);

const hhmm = (s: string | undefined) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(s ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : null;
};

export function isCommuterTrain(t: TdxTraTimetable) {
  const name = (t.TrainInfo ?? t.DailyTrainInfo)?.TrainTypeName?.Zh_tw ?? "";
  return name.includes("區間");
}

/** @param bbox [w, s, e, n] */
export function buildTra(stations: TdxTraStation[], trains: TdxTraTimetable[], bbox: [number, number, number, number]): TraData {
  const [w, s, e, n] = bbox;
  const inBox = new Map<string, TraData["stations"][number]>();
  for (const st of stations) {
    const lat = st.StationPosition?.PositionLat;
    const lng = st.StationPosition?.PositionLon;
    if (lat == null || lng == null || lng < w || lng > e || lat < s || lat > n) continue;
    inBox.set(st.StationID, { id: st.StationID, name: (st.StationName?.Zh_tw ?? st.StationID).replace(/^臺/, "台"), lat, lng });
  }

  const runs = new Map<string, number[]>();
  // 站 × 方向 × 時段 → 班次數
  const deps = new Map<string, number>();
  const WINDOWS = { peak: [7 * 60, 9 * 60], off: [10 * 60, 16 * 60], late: [21 * 60, 24 * 60] } as const;
  const used = new Set<string>();
  for (const t of trains) {
    if (!isCommuterTrain(t)) continue;
    const dir = (t.TrainInfo ?? t.DailyTrainInfo)?.Direction ?? 0;
    const stops = [...(t.StopTimes ?? [])].sort((a, b) => (a.StopSequence ?? 0) - (b.StopSequence ?? 0));
    let prev: { id: string; dep: number } | null = null;
    for (const st of stops) {
      const dep = hhmm(st.DepartureTime) ?? hhmm(st.ArrivalTime);
      if (!inBox.has(st.StationID) || dep == null) {
        prev = null; // 出了範圍就斷開(不跨出生活圈連邊)
        continue;
      }
      for (const [k, [a, b]] of Object.entries(WINDOWS)) if (dep >= a && dep < b) deps.set(`${st.StationID}|${dir}|${k}`, (deps.get(`${st.StationID}|${dir}|${k}`) ?? 0) + 1);
      if (prev) {
        let min = dep - prev.dep;
        if (min < 0) min += 1440; // 過午夜
        if (min > 0 && min < 180) {
          const key = traPairKey(prev.id, st.StationID);
          (runs.get(key) ?? runs.set(key, []).get(key)!).push(min * 60);
          used.add(prev.id).add(st.StationID);
        }
      }
      prev = { id: st.StationID, dep };
    }
  }

  const edges: Record<string, number> = {};
  for (const [k, xs] of [...runs].sort(([a], [b]) => a.localeCompare(b))) edges[k] = median(xs)!;
  const headwayOf = (k: keyof typeof WINDOWS, fallback: number) => {
    const [a, b] = WINDOWS[k];
    const hours = (b - a) / 60;
    const perHour: number[] = [];
    for (const id of used) for (const dir of [0, 1]) {
      const c = deps.get(`${id}|${dir}|${k}`) ?? 0;
      if (c > 0) perHour.push(c / hours);
    }
    const tph = median(perHour);
    return tph ? Math.max(5, Math.round(60 / tph)) : fallback;
  };
  return {
    headway: [headwayOf("peak", 15), headwayOf("off", 20), headwayOf("late", 30)],
    stations: [...inBox.values()].filter((x) => used.has(x.id)).sort((a, b) => a.id.localeCompare(b.id)),
    edges,
  };
}
