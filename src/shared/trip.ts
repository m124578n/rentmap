/**
 * 通勤行程(公車 + 捷運,最多轉乘一次)。/api/commute 與 /api/commute/trips 共用。
 * 「轉乘」指換交通工具(公車→公車、公車↔捷運);捷運系統內換線不算轉乘,但會算進時間。
 */
import type { DayType } from "./bus";

/** 通勤時段:哪種日子、幾點出發、方向(to = 住處 → 地點,from = 地點 → 住處) */
export type CommuteDir = "to" | "from";
export interface CommuteWhen {
  day: DayType;
  time: string; // HH:MM
  dir: CommuteDir;
}
export type CommuteSide = "go" | "back";
export const COMMUTE_SIDE_LABEL: Record<CommuteSide, string> = { go: "上班", back: "下班" };
export const COMMUTE_DEFAULT: Record<CommuteSide, CommuteWhen> = {
  go: { day: "wd", time: "08:00", dir: "to" },
  back: { day: "wd", time: "18:00", dir: "from" },
};
export const whenParams = (w: CommuteWhen) => `day=${w.day}&time=${encodeURIComponent(w.time)}&dir=${w.dir}`;

/** scooter / car:有道路圖時是 Worker 用道路圖算的最短時間(/api/commute/drive),沒有時前端用距離估(shared/drive.ts) */
export type TripKind = "walk" | "bus" | "mrt" | "bus+bus" | "bus+mrt" | "mrt+bus" | "bike" | "bike+mrt" | "mrt+bike" | "scooter" | "car";
export const TRIP_KIND_LABEL: Record<TripKind, string> = {
  walk: "步行",
  bus: "公車直達",
  mrt: "捷運",
  "bus+bus": "公車轉公車",
  "bus+mrt": "公車轉捷運",
  "mrt+bus": "捷運轉公車",
  bike: "YouBike",
  "bike+mrt": "YouBike 轉捷運",
  "mrt+bike": "捷運轉 YouBike",
  scooter: "機車(估)",
  car: "開車(估)",
};

export type TripLeg =
  | { mode: "walk"; min: number; m: number; to: string }
  | {
      mode: "bus";
      min: number;
      wait: number;
      name: string;
      /** 子路線說明(莒光、區間…) */
      variant: string | null;
      key: string;
      to_name: string | null;
      from: string;
      to: string;
      board_seq: number;
      alight_seq: number;
      /** [lng, lat] */
      from_pt: [number, number];
      to_pt: [number, number];
      stops: number;
      /** 坐車分鐘是時刻表算的(true)還是距離估的 */
      exact: boolean;
    }
  | {
      mode: "mrt";
      min: number;
      wait: number;
      /** 依序搭的線(中文線名);換線時超過一條 */
      lines: string[];
      colors: string[];
      from: string;
      to: string;
      stops: number;
      /** 經過的站 [lng, lat](畫地圖用)與每段的線色 */
      path: { lng: number; lat: number; color: string }[];
    }
  | {
      mode: "bike";
      min: number;
      /** 租車 + 還車 */
      wait: number;
      /** YouBike 站名 */
      from: string;
      to: string;
      from_pt: [number, number];
      to_pt: [number, number];
      /** 直線距離(公尺) */
      m: number;
    };

export interface Trip {
  kind: TripKind;
  total_min: number;
  transfers: number;
  /** 一句話:「262 → 捷運板南線」 */
  summary: string;
  legs: TripLeg[];
}

/** 列表 / 篩選用的精簡版(整張表幾千格,不帶 legs) */
export interface TripBrief {
  kind: TripKind;
  total_min: number;
  transfers: number;
  summary: string;
  /** 機車 / 開車:道路公里數(估),算油錢用 */
  km?: number;
}

export interface CommuteMatrix {
  radius: number;
  when: CommuteWhen;
  has_bus: boolean;
  /** items[propertyId][placeId];null = 算不出(太遠、沒座標) */
  items: Record<string, Record<string, TripBrief | null>>;
}

/** GET /api/commute/drive:所有房源 × 我的地點,機車或開車(道路圖);has_roads = false 時 items 是空的,前端改用距離估 */
export interface DriveMatrix extends CommuteMatrix {
  has_roads: boolean;
}

/** GET /api/commute/drive/at:一個點到每個地點的機車 / 開車(面板用) */
export interface DriveAtResponse {
  when: CommuteWhen;
  has_roads: boolean;
  items: Record<string, { scooter: TripBrief | null; car: TripBrief | null }>;
}

/** 地圖「通勤」圖層:網格中心點到每個地點最快幾分(null = 搭不到);順序同 places */
export interface CommuteGrid {
  /** 格子高(緯度度數)、寬(經度度數) */
  step: number;
  step_lng: number;
  places: number[];
  cells: { lat: number; lng: number; mins: (number | null)[] }[];
}

export interface TripsResponse {
  has_bus: boolean;
  when: CommuteWhen;
  /** 依總時間排序,每種搭法(kind)留最快的,公車直達多留幾條不同路線 */
  trips: Trip[];
}

/** 捷運站編號正規化(TDX「A1」「A14a」、mrt.json「A01」「R22A」→「A1」「A14A」),站間時間表的 key 用 */
export function mrtRefKey(ref: string) {
  const m = /^([A-Z]+?)(\d+)([A-Za-z]?)$/.exec(ref);
  return m ? `${m[1]}${Number(m[2])}${m[3]!.toUpperCase()}` : ref;
}
/** 兩站不分方向的 key */
export const mrtPairKey = (a: string, b: string) => [mrtRefKey(a), mrtRefKey(b)].sort().join("-");

/** POST /api/tour:節點 = [起點?, ...看房點];trips[i][j] = i → j 最快搭法 */
export interface TourResponse {
  when: CommuteWhen;
  has_start: boolean;
  trips: (Trip | null)[][];
}

/**
 * 看房順序:從起點(或任一間)出發、每間都去一次、不用回來,總交通時間最短。最多 8 間,直接試全部排列(8! = 40320)。
 * minutes[i][j] 是節點 i → j 的分鐘(null = 到不了)。回傳看房點的順序(0-based,不含起點);都到不了回 null。
 */
export function bestTourOrder(minutes: (number | null)[][], hasStart: boolean): { order: number[]; total: number } | null {
  const off = hasStart ? 1 : 0;
  const n = minutes.length - off;
  const idx = Array.from({ length: n }, (_, i) => i);
  let best: { order: number[]; total: number } | null = null;
  const walk = (path: number[], used: boolean[], cost: number) => {
    if (best && cost >= best.total) return;
    if (path.length === n) {
      best = { order: [...path], total: cost };
      return;
    }
    for (const k of idx) {
      if (used[k]) continue;
      const prev = path.length ? path[path.length - 1]! + off : hasStart ? 0 : -1;
      const m = prev < 0 ? 0 : minutes[prev]![k + off];
      if (m == null) continue;
      used[k] = true;
      path.push(k);
      walk(path, used, cost + m);
      path.pop();
      used[k] = false;
    }
  };
  walk([], new Array(n).fill(false), 0);
  return best;
}

/** 軌道站名(台鐵站在圖裡已經帶「台鐵」前綴):「捷運公館站」「台鐵板橋站」 */
export const railStop = (name: string) => (name.startsWith("台鐵") ? `${name}站` : `捷運${name}站`);

/** 摘要用的線名:「捷運板南線→文湖線」「台鐵」「捷運板南線→台鐵」 */
export function railLines(lines: string[]) {
  let out = "";
  let prevMrt = false;
  for (const l of lines) {
    const tra = l === "台鐵";
    // 線名本身就帶「捷運 / 輕軌」的(機場捷運、高雄捷運紅線、淡海輕軌)不再加前綴
    out += (out ? "→" : "") + (tra || prevMrt || /捷運|輕軌/.test(l) ? l : `捷運${l}`);
    prevMrt = !tra;
  }
  return out;
}
