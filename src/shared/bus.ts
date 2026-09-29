/**
 * 公車(TDX 雙北市區公車)前後端 + 採集機共用:匯入格式、API 回傳型別、距離 / 步行 / 班距小工具。
 *
 * 一條「路線方向」= 一個 key(`{SubRouteUID 或 RouteUID}:{Direction}`),例如 307 去程、307 返程是兩個 key。
 * 時刻表分三種日子:wd 平日、sat 週六、sun 週日;每種日子有
 *   deps  → 起點站發車時刻(有 Timetables 的路線)
 *   bands → 班距區間(只有 Frequencys 的路線,台北多半是這種)
 */
import { z } from "zod";

export const DAY_TYPES = ["wd", "sat", "sun"] as const;
export type DayType = (typeof DAY_TYPES)[number];
export const DAY_LABEL: Record<DayType, string> = { wd: "平日", sat: "週六", sun: "週日" };

const HHMM = z.string().regex(/^\d{1,2}:\d{2}$/);
export const Band = z.object({ s: HHMM, e: HHMM, min: z.number().int().min(0), max: z.number().int().min(0) });
export type Band = z.infer<typeof Band>;
export const DaySchedule = z.object({ deps: z.array(HHMM).optional(), bands: z.array(Band).optional() });
export type DaySchedule = z.infer<typeof DaySchedule>;
export const Schedule = z.object({ wd: DaySchedule.optional(), sat: DaySchedule.optional(), sun: DaySchedule.optional() });
export type Schedule = z.infer<typeof Schedule>;

/** 採集機推入的一條路線方向 */
export const BusRouteIn = z.object({
  key: z.string().min(1).max(80),
  route_uid: z.string().min(1).max(40),
  name: z.string().min(1).max(60), // 顯示名(307、紅30、307莒光…)
  city: z.string().max(20),
  direction: z.number().int().min(0).max(2),
  from_name: z.string().max(60).nullable(),
  to_name: z.string().max(60).nullable(),
  stop_count: z.number().int().min(0),
  length_m: z.number().int().min(0),
  shape: z.array(z.tuple([z.number(), z.number()])).max(20000), // [lng, lat]
  schedule: Schedule.nullable(),
});
export type BusRouteIn = z.infer<typeof BusRouteIn>;

/** 採集機推入的一個「路線方向上的站」 */
export const BusStopIn = z.object({
  route_key: z.string().min(1).max(80),
  seq: z.number().int().min(0),
  stop_uid: z.string().max(40),
  station_id: z.string().max(40).nullable(),
  name: z.string().max(60),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  dist_m: z.number().int().min(0), // 從起點沿路線的累計距離(估)
  t_min: z.number().int().min(0).nullable(), // 從起點發車到這站的分鐘(時刻表有給才有)
});
export type BusStopIn = z.infer<typeof BusStopIn>;

/** 班距摘要(一種日子) */
export interface DaySummary {
  first: string | null;
  last: string | null;
  /** 尖峰(07–09)/ 離峰(10–16)班距 [最短, 最長] 分鐘 */
  peak: [number, number] | null;
  offpeak: [number, number] | null;
  /** 有時刻表時的總班次 */
  trips: number | null;
}

export interface NearbyStop {
  name: string;
  seq: number;
  lat: number;
  lng: number;
  distance_m: number;
  walk_min: number;
}

/** GET /api/bus/nearby 每條路線方向 */
export interface NearbyRouteDir {
  key: string;
  direction: number;
  from_name: string | null;
  to_name: string | null;
  stop: NearbyStop;
  wd: DaySummary | null;
}
export interface NearbyRoute {
  route_uid: string;
  name: string;
  city: string;
  /** 最近一個方向的站距離,排序用 */
  distance_m: number;
  dirs: NearbyRouteDir[];
}

export interface NearbyBusResponse {
  radius: number;
  routes: NearbyRoute[];
  /** 資料庫裡有沒有公車資料(沒有 → 前端提示先跑 collect bus) */
  has_data: boolean;
}

export interface BusRouteDetail {
  route: {
    key: string;
    route_uid: string;
    name: string;
    city: string;
    direction: number;
    from_name: string | null;
    to_name: string | null;
    length_m: number;
    shape: [number, number][];
    schedule: Schedule | null;
  };
  stops: { seq: number; name: string; lat: number; lng: number; dist_m: number; t_min: number | null }[];
}

// ---- 小工具 ----

export function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLng = (lng2 - lng1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** 直線距離 → 步行分鐘(繞路係數 1.3、每分鐘 80m) */
/**
 * 走路分鐘:直線距離 × 1.3(沿街繞路)、每分鐘 80m,
 * 另外算紅綠燈:平均每 300m(沿街)過一個有號誌的路口、平均等 0.6 分。
 */
export function walkMin(m: number) {
  const path = m * 1.3;
  return Math.max(1, Math.round(path / 80 + (path / 300) * 0.6));
}

/** 市區公車含停站平均約 14 km/h */
export const BUS_M_PER_MIN = 233;

export function toMin(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h! * 60 + m!;
}
export function fmtMin(n: number) {
  const h = Math.floor(n / 60) % 24;
  const m = ((n % 60) + 60) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** 某個時段 [from, to) 內的班距範圍 */
function headwayIn(day: DaySchedule, from: number, to: number): [number, number] | null {
  if (day.deps && day.deps.length >= 2) {
    const ts = day.deps.map(toMin).sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let i = 1; i < ts.length; i++) if (ts[i]! > from && ts[i - 1]! < to) gaps.push(ts[i]! - ts[i - 1]!);
    if (gaps.length) return [Math.min(...gaps), Math.max(...gaps)];
  }
  const hit = (day.bands ?? []).filter((b) => toMin(b.s) < to && toMin(b.e) > from && b.max > 0);
  if (hit.length) return [Math.min(...hit.map((b) => b.min || b.max)), Math.max(...hit.map((b) => b.max))];
  return null;
}

export function summarizeDay(day: DaySchedule | undefined): DaySummary | null {
  if (!day || (!day.deps?.length && !day.bands?.length)) return null;
  let first: string | null = null;
  let last: string | null = null;
  if (day.deps?.length) {
    const ts = day.deps.map(toMin).sort((a, b) => a - b);
    first = fmtMin(ts[0]!);
    last = fmtMin(ts[ts.length - 1]!);
  } else if (day.bands?.length) {
    first = fmtMin(Math.min(...day.bands.map((b) => toMin(b.s))));
    last = fmtMin(Math.max(...day.bands.map((b) => toMin(b.e))));
  }
  return {
    first,
    last,
    peak: headwayIn(day, 7 * 60, 9 * 60),
    offpeak: headwayIn(day, 10 * 60, 16 * 60),
    trips: day.deps?.length ?? null,
  };
}

export function dayTypeOf(d: Date): DayType {
  const w = d.getDay();
  return w === 0 ? "sun" : w === 6 ? "sat" : "wd";
}

export function fmtHeadway(h: [number, number] | null) {
  if (!h) return null;
  return h[0] === h[1] ? `${h[0]} 分` : `${h[0]}–${h[1]} 分`;
}

// ---- 依時段的等車 ----

/** 看起點發車時刻的範圍:出發前 60 分 ~ 後 30 分(公車從起點開到你這站要一段時間,所以往前多看) */
export const SERVICE_BEFORE = 60;
export const SERVICE_AFTER = 30;
const clampWait = (w: number) => Math.min(30, Math.max(1, Math.round(w)));

/**
 * 某種日子、某個時刻(分)搭這條路線的平均等車分鐘(班距一半,最多 30):
 *   null      = 那段時間沒車(當天不開、還沒發車、已收班)
 *   undefined = 這條路線沒有班表資料(呼叫端自己給預設)
 */
export function serviceWait(s: Schedule | null | undefined, day: DayType, t: number): number | null | undefined {
  if (!s) return undefined;
  const d = s[day];
  if (!d || (!d.deps?.length && !d.bands?.length)) return null;
  const lo = t - SERVICE_BEFORE;
  const hi = t + SERVICE_AFTER;
  if (d.deps?.length) {
    const ts = d.deps
      .map(toMin)
      .filter((x) => x >= lo && x <= hi)
      .sort((a, b) => a - b);
    if (ts.length >= 2) return clampWait((ts[ts.length - 1]! - ts[0]!) / (ts.length - 1) / 2);
    if (ts.length === 1) return clampWait((hi - lo) / 2);
    if (!d.bands?.length) return null;
  }
  const hit = (d.bands ?? []).filter((b) => toMin(b.s) < hi && toMin(b.e) > lo && b.max > 0);
  if (!hit.length) return null;
  const dist = (b: Band) => (t < toMin(b.s) ? toMin(b.s) - t : t >= toMin(b.e) ? t - toMin(b.e) + 1 : 0);
  const b = hit.reduce((x, y) => (dist(y) < dist(x) ? y : x));
  return clampWait(((b.min || b.max) + b.max) / 4);
}
