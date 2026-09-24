/**
 * TDX 市區公車 JSON → 匯入格式(shared/bus.ts 的 BusRouteIn / BusStopIn)。純函式,不碰網路;測試在 test/collector/bus.test.ts。
 *
 * 用到四個資料集(都是 `/v2/Bus/{…}/City/{Taipei|NewTaipei}`):
 *   Route        路線名、起訖站名、子路線
 *   StopOfRoute  每個子路線 × 方向的站序(主角:決定有哪些 key 和站)
 *   Shape        線形 WKT(LINESTRING / MULTILINESTRING)
 *   Schedule     Timetables(每班發車)或 Frequencys(班距區間),兩種都可能有
 */
import { DAY_TYPES, haversine, toMin, type BusRouteIn, type BusStopIn, type DayType, type Schedule } from "../../src/shared/bus";

type Name = { Zh_tw?: string; En?: string } | undefined;
type ServiceDay = Partial<Record<"Sunday" | "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday", number>>;

export interface TdxRoute {
  RouteUID: string;
  RouteName?: Name;
  DepartureStopNameZh?: string;
  DestinationStopNameZh?: string;
  City?: string;
}
export interface TdxStopOfRoute {
  RouteUID: string;
  RouteName?: Name;
  SubRouteUID?: string;
  SubRouteName?: Name;
  Direction?: number;
  City?: string;
  Stops: {
    StopUID: string;
    StationID?: string;
    StopName?: Name;
    StopSequence: number;
    StopPosition?: { PositionLat?: number; PositionLon?: number };
  }[];
}
export interface TdxShape {
  RouteUID: string;
  SubRouteUID?: string;
  Direction?: number;
  Geometry?: string;
}
export interface TdxSchedule {
  RouteUID: string;
  SubRouteUID?: string;
  Direction?: number;
  Timetables?: { ServiceDay?: ServiceDay; StopTimes?: { StopSequence?: number; ArrivalTime?: string; DepartureTime?: string }[] }[];
  Frequencys?: { StartTime?: string; EndTime?: string; MinHeadwayMins?: number; MaxHeadwayMins?: number; ServiceDay?: ServiceDay }[];
}
export interface TdxCity {
  routes: TdxRoute[];
  stopOfRoute: TdxStopOfRoute[];
  shapes: TdxShape[];
  schedules: TdxSchedule[];
}

const zh = (n: Name) => n?.Zh_tw?.trim() || "";

/** 「307去程」「307(返)」→「307」 */
export function cleanRouteName(s: string) {
  return s.replace(/[((]?(去程|返程|去|返)[))]?$/, "").trim();
}

/** WKT 取出所有 [lng, lat](MULTILINESTRING 各段接起來) */
export function parseWkt(wkt: string | undefined): [number, number][] {
  if (!wkt) return [];
  const out: [number, number][] = [];
  for (const m of wkt.matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)) out.push([Number(m[1]), Number(m[2])]);
  return out;
}

/** Douglas-Peucker,容許誤差 tolM 公尺;座標四捨五入到 5 位(約 1m) */
export function simplify(pts: [number, number][], tolM = 8): [number, number][] {
  if (pts.length <= 2) return pts.map(round5);
  const lat0 = pts[0]![1];
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110540;
  const xy = pts.map(([x, y]) => [x * kx, y * ky] as const);
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = xy[a]!;
    const [bx, by] = xy[b]!;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let maxD = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = xy[i]!;
      let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > tolM) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]).map(round5);
}
const round5 = ([x, y]: [number, number]): [number, number] => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5];

function lineLength(pts: [number, number][]) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += haversine(pts[i - 1]![1], pts[i - 1]![0], pts[i]![1], pts[i]![0]);
  return s;
}

function dayTypes(sd: ServiceDay | undefined): DayType[] {
  if (!sd) return [...DAY_TYPES];
  const out: DayType[] = [];
  if (sd.Monday || sd.Tuesday || sd.Wednesday || sd.Thursday || sd.Friday) out.push("wd");
  if (sd.Saturday) out.push("sat");
  if (sd.Sunday) out.push("sun");
  return out;
}

const validTime = (t: string | undefined): t is string => !!t && /^\d{1,2}:\d{2}$/.test(t);

/** 時刻表 / 班距 → Schedule;另外回傳「從起點到第 n 站幾分鐘」(拿站最多的一班算) */
export function buildSchedule(items: TdxSchedule[]): { schedule: Schedule | null; tMin: Map<number, number> } {
  const deps: Record<DayType, Set<string>> = { wd: new Set(), sat: new Set(), sun: new Set() };
  const bands: Record<DayType, { s: string; e: string; min: number; max: number }[]> = { wd: [], sat: [], sun: [] };
  let bestTrip: { seq: number; t: string }[] = [];
  for (const it of items) {
    for (const tt of it.Timetables ?? []) {
      const times = (tt.StopTimes ?? [])
        .map((s) => ({ seq: s.StopSequence ?? 0, t: s.DepartureTime || s.ArrivalTime }))
        .filter((s): s is { seq: number; t: string } => validTime(s.t))
        .sort((a, b) => a.seq - b.seq);
      if (!times.length) continue;
      for (const d of dayTypes(tt.ServiceDay)) deps[d].add(times[0]!.t.padStart(5, "0"));
      if (times.length > bestTrip.length) bestTrip = times;
    }
    for (const f of it.Frequencys ?? []) {
      if (!validTime(f.StartTime) || !validTime(f.EndTime)) continue;
      const min = Math.max(0, Math.round(f.MinHeadwayMins ?? f.MaxHeadwayMins ?? 0));
      const max = Math.max(min, Math.round(f.MaxHeadwayMins ?? min));
      for (const d of dayTypes(f.ServiceDay)) bands[d].push({ s: f.StartTime, e: f.EndTime, min, max });
    }
  }
  const schedule: Schedule = {};
  for (const d of DAY_TYPES) {
    const ds = [...deps[d]].sort((a, b) => toMin(a) - toMin(b));
    const bs = bands[d].sort((a, b) => toMin(a.s) - toMin(b.s));
    if (ds.length || bs.length) schedule[d] = { ...(ds.length ? { deps: ds } : {}), ...(bs.length ? { bands: bs } : {}) };
  }
  const tMin = new Map<number, number>();
  if (bestTrip.length > 1) {
    const t0 = toMin(bestTrip[0]!.t);
    for (const s of bestTrip) {
      let t = toMin(s.t) - t0;
      if (t < 0) t += 1440; // 過午夜
      tMin.set(s.seq, t);
    }
  }
  return { schedule: Object.keys(schedule).length ? schedule : null, tMin };
}

/** 站與站直線距離的繞路係數(路線沿街走) */
const DETOUR = 1.15;

export function transformCity(city: string, data: TdxCity): { routes: BusRouteIn[]; stops: BusStopIn[] } {
  const routeByUid = new Map(data.routes.map((r) => [r.RouteUID, r]));
  const shapeBy = new Map<string, TdxShape>();
  for (const s of data.shapes) {
    const dir = s.Direction ?? 0;
    if (s.SubRouteUID) shapeBy.set(`${s.SubRouteUID}:${dir}`, s);
    if (!shapeBy.has(`${s.RouteUID}:${dir}`)) shapeBy.set(`${s.RouteUID}:${dir}`, s);
    // 沒標方向的線形才當整條路線共用;有方向的不能拿去給反方向用(走的街常不同)
    if (s.Direction == null && !shapeBy.has(s.RouteUID)) shapeBy.set(s.RouteUID, s);
  }
  const schedBy = new Map<string, TdxSchedule[]>();
  for (const s of data.schedules) {
    const k = `${s.SubRouteUID ?? s.RouteUID}:${s.Direction ?? 0}`;
    schedBy.set(k, [...(schedBy.get(k) ?? []), s]);
  }

  const routes: BusRouteIn[] = [];
  const stops: BusStopIn[] = [];
  const seen = new Set<string>();
  for (const sor of data.stopOfRoute) {
    const dir = sor.Direction ?? 0;
    const key = `${sor.SubRouteUID ?? sor.RouteUID}:${dir}`;
    if (seen.has(key)) continue;
    const pts = [...sor.Stops]
      .filter((s) => s.StopPosition?.PositionLat && s.StopPosition?.PositionLon)
      .sort((a, b) => a.StopSequence - b.StopSequence);
    if (pts.length < 2) continue;
    seen.add(key);

    const route = routeByUid.get(sor.RouteUID);
    const name = cleanRouteName(zh(sor.SubRouteName)) || cleanRouteName(zh(sor.RouteName)) || zh(route?.RouteName) || sor.RouteUID;
    const sched = buildSchedule(schedBy.get(key) ?? schedBy.get(`${sor.RouteUID}:${dir}`) ?? []);

    let dist = 0;
    pts.forEach((s, i) => {
      const lat = s.StopPosition!.PositionLat!;
      const lng = s.StopPosition!.PositionLon!;
      if (i > 0) {
        const p = pts[i - 1]!.StopPosition!;
        dist += haversine(p.PositionLat!, p.PositionLon!, lat, lng) * DETOUR;
      }
      stops.push({
        route_key: key,
        seq: s.StopSequence,
        stop_uid: s.StopUID,
        station_id: s.StationID ?? null,
        name: zh(s.StopName) || "?",
        lat,
        lng,
        dist_m: Math.round(dist),
        t_min: sched.tMin.get(s.StopSequence) ?? null,
      });
    });

    const shapeRaw = parseWkt((shapeBy.get(key) ?? shapeBy.get(`${sor.RouteUID}:${dir}`) ?? shapeBy.get(sor.RouteUID))?.Geometry);
    const line: [number, number][] = shapeRaw.length >= 2 ? shapeRaw : pts.map((s) => [s.StopPosition!.PositionLon!, s.StopPosition!.PositionLat!]);
    routes.push({
      key,
      route_uid: sor.RouteUID,
      name,
      city,
      direction: dir,
      from_name: zh(pts[0]!.StopName) || null,
      to_name: zh(pts[pts.length - 1]!.StopName) || null,
      stop_count: pts.length,
      length_m: Math.round(shapeRaw.length >= 2 ? lineLength(shapeRaw) : dist),
      shape: simplify(line),
      schedule: sched.schedule,
    });
  }
  return { routes, stops };
}
