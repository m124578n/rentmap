/**
 * 公車網路整份放進 Worker 記憶體(雙北約數萬個「路線 × 站」),以 bus_routes 的 version 為快取鍵:
 * 同一個 isolate 只在公車資料重新匯入後重讀一次。轉乘要看「任何路線在任何站附近」,逐次查 D1 太多次。
 */
import { BUS_M_PER_MIN, type Schedule } from "@shared/bus";
import { parseSchedule } from "../busdata";

export interface BusRoute {
  key: string;
  name: string;
  toName: string | null;
  /** 班表(等車依時段在 plan.ts 算) */
  schedule: Schedule | null;
  /** 這條路線方向的站在 stop 陣列中的範圍 [start, end),依站序 */
  start: number;
  end: number;
}

export interface BusNet {
  version: string | null;
  routes: BusRoute[];
  routeIdx: Map<string, number>;
  sRoute: Int32Array;
  sSeq: Int32Array;
  sLat: Float64Array;
  sLng: Float64Array;
  /** 從起點發車到這站的分鐘(整條都有時刻表用時刻表,否則用距離估) */
  sT: Float64Array;
  sExact: Uint8Array;
  sName: string[];
  grid: Map<string, number[]>;
}

const CELL = 0.002; // 約 220m

const cellKey = (y: number, x: number) => `${y}:${x}`;

export function nearStops(net: BusNet, lat: number, lng: number, r: number, cb: (i: number) => void) {
  const dLat = r / 111320;
  const dLng = r / (111320 * Math.cos((lat * Math.PI) / 180));
  const y0 = Math.floor((lat - dLat) / CELL);
  const y1 = Math.floor((lat + dLat) / CELL);
  const x0 = Math.floor((lng - dLng) / CELL);
  const x1 = Math.floor((lng + dLng) / CELL);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (const i of net.grid.get(cellKey(y, x)) ?? []) cb(i);
}

let cache: BusNet | null = null;

const EMPTY: BusNet = {
  version: null,
  routes: [],
  routeIdx: new Map(),
  sRoute: new Int32Array(0),
  sSeq: new Int32Array(0),
  sLat: new Float64Array(0),
  sLng: new Float64Array(0),
  sT: new Float64Array(0),
  sExact: new Uint8Array(0),
  sName: [],
  grid: new Map(),
};

export async function loadBusNet(DB: D1Database): Promise<BusNet> {
  const head = await DB.prepare("SELECT MAX(version) AS v, COUNT(*) AS n FROM bus_routes").first<{ v: string | null; n: number }>();
  if (head?.v == null) return EMPTY;
  const v = `${head.v}#${head.n}`;
  if (cache && cache.version === v) return cache;

  const { results: rrows } = await DB.prepare("SELECT key, name, to_name, schedule_json FROM bus_routes").all<{
    key: string;
    name: string;
    to_name: string | null;
    schedule_json: string | null;
  }>();
  const { results: srows } = await DB.prepare("SELECT route_key, seq, name, lat, lng, dist_m, t_min FROM bus_route_stops ORDER BY route_key, seq").all<{
    route_key: string;
    seq: number;
    name: string;
    lat: number;
    lng: number;
    dist_m: number;
    t_min: number | null;
  }>();

  const routes: BusRoute[] = [];
  const routeIdx = new Map<string, number>();
  for (const r of rrows) {
    routeIdx.set(r.key, routes.length);
    routes.push({ key: r.key, name: r.name, toName: r.to_name, schedule: parseSchedule(r.schedule_json), start: 0, end: 0 });
  }
  const n = srows.length;
  const net: BusNet = {
    version: v,
    routes,
    routeIdx,
    sRoute: new Int32Array(n),
    sSeq: new Int32Array(n),
    sLat: new Float64Array(n),
    sLng: new Float64Array(n),
    sT: new Float64Array(n),
    sExact: new Uint8Array(n),
    sName: new Array<string>(n),
    grid: new Map(),
  };
  let i = 0;
  while (i < n) {
    const key = srows[i]!.route_key;
    let j = i;
    while (j < n && srows[j]!.route_key === key) j++;
    const ri = routeIdx.get(key);
    const exact = srows.slice(i, j).every((s) => s.t_min != null);
    for (let k = i; k < j; k++) {
      const s = srows[k]!;
      net.sRoute[k] = ri ?? -1;
      net.sSeq[k] = s.seq;
      net.sLat[k] = s.lat;
      net.sLng[k] = s.lng;
      net.sT[k] = exact ? s.t_min! : s.dist_m / BUS_M_PER_MIN;
      net.sExact[k] = exact ? 1 : 0;
      net.sName[k] = s.name;
    }
    if (ri != null) {
      routes[ri]!.start = i;
      routes[ri]!.end = j;
    }
    i = j;
  }
  buildGrid(net);
  cache = net;
  return net;
}

function buildGrid(net: BusNet) {
  net.grid = new Map();
  for (let k = 0; k < net.sLat.length; k++) {
    const g = cellKey(Math.floor(net.sLat[k]! / CELL), Math.floor(net.sLng[k]! / CELL));
    const cell = net.grid.get(g);
    if (cell) cell.push(k);
    else net.grid.set(g, [k]);
  }
}

let revCache: { src: BusNet; net: BusNet } | null = null;

/**
 * 反方向網路(下班「地點 → 住處」用):每條路線方向的站序倒過來、sT 改成「從終點往回」,
 * 這樣「從目的地往回算」的 plan.ts 拿住處當目的地就等於正向從地點出發;算完的行程在 plan.ts 翻回來。
 * 路線本身(key、名稱、班表)不變,sSeq 保留原本的站序。
 */
export function reverseNet(net: BusNet): BusNet {
  if (revCache?.src === net) return revCache.net;
  const n = net.sLat.length;
  const rev: BusNet = {
    ...net,
    sRoute: net.sRoute.slice(),
    sSeq: net.sSeq.slice(),
    sLat: net.sLat.slice(),
    sLng: net.sLng.slice(),
    sT: net.sT.slice(),
    sExact: net.sExact.slice(),
    sName: net.sName.slice(),
    grid: new Map(),
  };
  for (const r of net.routes) {
    if (r.end <= r.start) continue;
    const last = net.sT[r.end - 1]!;
    for (let k = r.start; k < r.end; k++) {
      const j = r.start + r.end - 1 - k;
      rev.sSeq[j] = net.sSeq[k]!;
      rev.sLat[j] = net.sLat[k]!;
      rev.sLng[j] = net.sLng[k]!;
      rev.sT[j] = last - net.sT[k]!;
      rev.sName[j] = net.sName[k]!;
    }
  }
  if (n) buildGrid(rev);
  revCache = { src: net, net: rev };
  return rev;
}
