/**
 * 機車 / 開車的道路圖(scripts/build_roads.py 從台灣 OSM 檔產生,`collect -- roads` 推進 D1 的 road_graphs,Worker 整份進記憶體):
 * 路口是節點、兩個路口之間的路段是有向邊(單行只有一個方向)。這裡放格式、速度表與最短時間,純函式,前後端與測試共用。
 *
 * 二進位格式(little endian;改了 build_roads.py 要一起改):
 *   "RDG1" · N u32 · E u32 · lat i32[N](×1e6)· lng i32[N] · off u32[N+1](CSR,邊依起點排)· to u32[E] · len u16[E](公尺)· flags u8[E]
 *   flags 低 4 位元 = ROAD_CLASSES 的索引;16 = 機車不能走(國道、快速道路、禁行機車);32 = 汽車不能走
 *
 * 時間 = 路段長 ÷ 類別時速(各車種一張表,是「中南部離峰、含紅綠燈」的平均),再乘生活圈與尖峰的係數(shared/drive.ts 的平均時速比例),
 * 加上出門牽車 / 停車的固定時間與「門口到最近路口」那一小段。不是導航(沒有即時路況、轉向延遲),介面標「道路估算」。
 */
import type { DriveMode } from "./drive";

export const ROAD_CLASSES = [
  "motorway",
  "motorway_link",
  "trunk",
  "trunk_link",
  "primary",
  "primary_link",
  "secondary",
  "secondary_link",
  "tertiary",
  "tertiary_link",
  "unclassified",
  "residential",
  "living_street",
  "service",
  "road",
] as const;
export const NO_SCOOTER = 16;
export const NO_CAR = 32;

/** 各類道路的平均時速(km/h,含紅綠燈;中南部離峰的感覺)。機車不能上國道,motorway 那格不會用到 */
export const CLASS_KMH: Record<DriveMode, Record<(typeof ROAD_CLASSES)[number], number>> = {
  scooter: {
    motorway: 0,
    motorway_link: 0,
    trunk: 45,
    trunk_link: 32,
    primary: 36,
    primary_link: 28,
    secondary: 33,
    secondary_link: 26,
    tertiary: 29,
    tertiary_link: 24,
    unclassified: 26,
    residential: 20,
    living_street: 12,
    service: 14,
    road: 20,
  },
  car: {
    motorway: 85,
    motorway_link: 45,
    trunk: 55,
    trunk_link: 38,
    primary: 38,
    primary_link: 28,
    secondary: 34,
    secondary_link: 26,
    tertiary: 28,
    tertiary_link: 22,
    unclassified: 26,
    residential: 16,
    living_street: 10,
    service: 12,
    road: 18,
  },
};

export interface RoadGraph {
  n: number;
  e: number;
  lat: Int32Array;
  lng: Int32Array;
  off: Uint32Array;
  to: Uint32Array;
  len: Uint16Array;
  flags: Uint8Array;
}

/** 二進位 → 圖(各陣列直接指到同一塊記憶體,不複製;offset 不對齊時才複製) */
export function decodeRoads(buf: Uint8Array): RoadGraph {
  const magic = String.fromCharCode(buf[0]!, buf[1]!, buf[2]!, buf[3]!);
  if (magic !== "RDG1") throw new Error(`道路圖格式不認得:${magic}`);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const n = dv.getUint32(4, true);
  const e = dv.getUint32(8, true);
  let p = 12;
  const take = <T>(Ctor: { new (b: ArrayBuffer, o: number, l: number): T; BYTES_PER_ELEMENT: number }, count: number): T => {
    const bytes = count * Ctor.BYTES_PER_ELEMENT;
    const abs = buf.byteOffset + p;
    const arr =
      abs % Ctor.BYTES_PER_ELEMENT === 0 ? new Ctor(buf.buffer as ArrayBuffer, abs, count) : new Ctor(buf.slice(p, p + bytes).buffer as ArrayBuffer, 0, count);
    p += bytes;
    return arr;
  };
  const g = { n, e, lat: take(Int32Array, n), lng: take(Int32Array, n), off: take(Uint32Array, n + 1), to: take(Uint32Array, e), len: take(Uint16Array, e), flags: take(Uint8Array, e) };
  if (p !== buf.byteLength) throw new Error(`道路圖長度不對:讀到 ${p},檔案 ${buf.byteLength}`);
  return g;
}

/** 測試用:跟 build_roads.py 一樣的格式。edges = [from, to, 公尺, flags](會依起點排序) */
export function encodeRoads(nodes: [number, number][], edges: [number, number, number, number][]): Uint8Array {
  const n = nodes.length;
  const es = [...edges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const e = es.length;
  const out = new Uint8Array(12 + n * 8 + (n + 1) * 4 + e * 4 + e * 2 + e);
  out.set([82, 68, 71, 49]); // RDG1
  const dv = new DataView(out.buffer);
  dv.setUint32(4, n, true);
  dv.setUint32(8, e, true);
  let p = 12;
  for (const [la] of nodes) (dv.setInt32(p, Math.round(la * 1e6), true), (p += 4));
  for (const [, lo] of nodes) (dv.setInt32(p, Math.round(lo * 1e6), true), (p += 4));
  const off = new Array<number>(n + 1).fill(0);
  for (const [a] of es) off[a + 1]!++;
  for (let i = 0; i < n; i++) off[i + 1]! += off[i]!;
  for (const o of off) (dv.setUint32(p, o, true), (p += 4));
  for (const [, b] of es) (dv.setUint32(p, b, true), (p += 4));
  for (const [, , m] of es) (dv.setUint16(p, m, true), (p += 2));
  for (const [, , , f] of es) out[p++] = f;
  return out;
}

/**
 * 每個 flags 值 → 每公尺幾秒(不能走 = Infinity)。factor = 生活圈 × 尖峰的時間係數(drive.ts 的 roadFactor);
 * 國道與快速道路比較不受市區紅綠燈影響,只乘係數的平方根。
 */
export function costTable(mode: DriveMode, factor = 1): Float64Array {
  const t = new Float64Array(256).fill(Infinity);
  for (let f = 0; f < 256; f++) {
    if (mode === "scooter" && f & NO_SCOOTER) continue;
    if (mode === "car" && f & NO_CAR) continue;
    const kmh = CLASS_KMH[mode][ROAD_CLASSES[f & 15] ?? "road"];
    const cls = f & 15;
    const k = cls <= 3 ? Math.sqrt(factor) : factor; // motorway / motorway_link / trunk / trunk_link
    if (kmh > 0) t[f] = (3.6 / kmh) * k;
  }
  return t;
}

/** 反向圖(算「各點到目的地」用):同樣的 CSR,邊的方向反過來,flags / len 跟著搬 */
export function reverseRoads(g: RoadGraph): RoadGraph {
  const off = new Uint32Array(g.n + 1);
  for (let i = 0; i < g.e; i++) off[g.to[i]! + 1]!++;
  for (let i = 0; i < g.n; i++) off[i + 1]! += off[i]!;
  const fill = off.slice(0, g.n);
  const to = new Uint32Array(g.e);
  const len = new Uint16Array(g.e);
  const flags = new Uint8Array(g.e);
  for (let u = 0; u < g.n; u++)
    for (let i = g.off[u]!; i < g.off[u + 1]!; i++) {
      const v = g.to[i]!;
      const j = fill[v]!++;
      to[j] = u;
      len[j] = g.len[i]!;
      flags[j] = g.flags[i]!;
    }
  return { ...g, off, to, len, flags };
}

export interface RoadTimes {
  /** 每個節點的秒數(Infinity = 到不了);係數之前的原始值 */
  sec: Float64Array;
  /** 每個節點的道路公尺數 */
  m: Float64Array;
}

/**
 * 從一個節點出發的最短時間(Dijkstra,二元堆積)。g 用正向圖 = 從 source 出發到各點;用反向圖 = 各點到 source。
 * maxSec 以後不再展開(太遠的通勤沒意義,也省 CPU)。
 */
export function roadTimes(g: RoadGraph, cost: Float64Array, source: number, maxSec = 3 * 3600, targets?: Iterable<number>): RoadTimes {
  // 只要幾個點(面板查一個地址):那幾個都定案就停
  const want = targets ? new Set(targets) : null;
  const sec = new Float64Array(g.n).fill(Infinity);
  const m = new Float64Array(g.n);
  const heapNode = new Uint32Array(Math.max(16, g.e + 1));
  const heapKey = new Float64Array(heapNode.length);
  let size = 0;
  const push = (v: number, k: number) => {
    let i = size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapKey[p]! <= k) break;
      heapNode[i] = heapNode[p]!;
      heapKey[i] = heapKey[p]!;
      i = p;
    }
    heapNode[i] = v;
    heapKey[i] = k;
  };
  const pop = () => {
    const top = heapNode[0]!;
    const lastN = heapNode[--size]!;
    const lastK = heapKey[size]!;
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= size) break;
      if (c + 1 < size && heapKey[c + 1]! < heapKey[c]!) c++;
      if (heapKey[c]! >= lastK) break;
      heapNode[i] = heapNode[c]!;
      heapKey[i] = heapKey[c]!;
      i = c;
    }
    heapNode[i] = lastN;
    heapKey[i] = lastK;
    return top;
  };
  sec[source] = 0;
  push(source, 0);
  const done = new Uint8Array(g.n);
  while (size > 0) {
    const u = pop();
    if (done[u]) continue;
    done[u] = 1;
    const su = sec[u]!;
    if (su > maxSec) break;
    if (want && want.delete(u) && want.size === 0) break;
    for (let i = g.off[u]!; i < g.off[u + 1]!; i++) {
      const c = cost[g.flags[i]!]!;
      if (c === Infinity) continue;
      const v = g.to[i]!;
      const s = su + g.len[i]! * c;
      if (s < sec[v]!) {
        sec[v] = s;
        m[v] = m[u]! + g.len[i]!;
        if (size >= heapNode.length) break; // 不會發生(每條邊最多推一次)
        push(v, s);
      }
    }
  }
  return { sec, m };
}

/** 最近的路口:網格索引(約 550m 一格),只找這個車種能進出的節點 */
export interface RoadIndex {
  cell: number;
  grid: Map<number, number[]>;
  /** 每個節點:bit0 機車能進出、bit1 汽車能進出 */
  modes: Uint8Array;
}
const CELL = 0.005;
const key = (y: number, x: number) => y * 100000 + x;

export function indexRoads(g: RoadGraph): RoadIndex {
  const modes = new Uint8Array(g.n);
  for (let u = 0; u < g.n; u++)
    for (let i = g.off[u]!; i < g.off[u + 1]!; i++) {
      const f = g.flags[i]!;
      const bits = (f & NO_SCOOTER ? 0 : 1) | (f & NO_CAR ? 0 : 2);
      modes[u]! |= bits;
      modes[g.to[i]!]! |= bits;
    }
  const grid = new Map<number, number[]>();
  for (let u = 0; u < g.n; u++) {
    const k = key(Math.floor(g.lat[u]! / 1e6 / CELL), Math.floor(g.lng[u]! / 1e6 / CELL));
    const list = grid.get(k);
    if (list) list.push(u);
    else grid.set(k, [u]);
  }
  return { cell: CELL, grid, modes };
}

/** 最近的可用路口與直線距離(公尺);maxM 內沒有回 null */
export function snapRoad(g: RoadGraph, idx: RoadIndex, mode: DriveMode, lat: number, lng: number, maxM = 1500): { node: number; m: number } | null {
  const bit = mode === "scooter" ? 1 : 2;
  const y0 = Math.floor(lat / CELL);
  const x0 = Math.floor(lng / CELL);
  const kx = 111320 * Math.cos((lat * Math.PI) / 180);
  let best = -1;
  let bestM = Infinity;
  const rings = Math.ceil(maxM / 500) + 1;
  for (let r = 0; r <= rings; r++) {
    for (let y = y0 - r; y <= y0 + r; y++)
      for (let x = x0 - r; x <= x0 + r; x++) {
        if (Math.max(Math.abs(y - y0), Math.abs(x - x0)) !== r) continue;
        for (const u of idx.grid.get(key(y, x)) ?? []) {
          if (!(idx.modes[u]! & bit)) continue;
          const d = Math.hypot((g.lat[u]! / 1e6 - lat) * 110540, (g.lng[u]! / 1e6 - lng) * kx);
          if (d < bestM) {
            bestM = d;
            best = u;
          }
        }
      }
    // 這一圈找到了,而且下一圈不可能更近(每圈至少約 500m)就停
    if (best >= 0 && bestM <= r * 500) break;
  }
  return best >= 0 && bestM <= maxM ? { node: best, m: bestM } : null;
}
