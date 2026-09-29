/**
 * 捷運網路(public/mrt.json → 圖)。沒有官方站間時間,用距離估:
 *   站間分鐘 = 直線距離 × 1.1 ÷ 速度 + 停站;不同系統速度不同(輕軌慢、機捷快)
 *   換線 +4 分(走路 + 等車),上車先等半個班距
 * 站序從 refs 編號來(BL12、R22A…),相鄰編號相連;支線手動接。
 */
import mrtJson from "../../../public/mrt.json";
import { haversine } from "@shared/bus";

interface RawStation {
  id: string;
  name: string;
  lines: string[];
  refs: string[];
  lat: number;
  lng: number;
}
interface RawLine {
  code: string;
  name: string;
  color: string;
}

export interface MrtStation {
  idx: number;
  id: string;
  name: string;
  lat: number;
  lng: number;
  lines: string[];
}
export interface MrtEdge {
  to: number; // node index
  min: number;
}
/** 節點 = (站, 線) */
export interface MrtGraph {
  stations: MrtStation[];
  nodes: { station: number; line: string }[];
  adj: MrtEdge[][];
  nodesOfStation: number[][];
  lineName: Record<string, string>;
  lineColor: Record<string, string>;
}

const SPEED_M_PER_MIN: Record<string, number> = { V: 330, K: 330, LB: 450, A: 800 };
const DWELL: Record<string, number> = { A: 0.8 };
export const MRT_TRANSFER_MIN = 4;
/** 上車平均等車(半個班距) */
export function mrtWait(line: string) {
  return line === "V" || line === "K" ? 7 : line === "LB" ? 5 : line === "A" ? 6 : 3;
}
/** 支線 / 編號不連續的接點 */
const JOINS: [string, string][] = [
  ["R22A", "R22"],
  ["G03A", "G03"],
  ["O50", "O12"],
  ["V28", "V11"],
];

function parseRef(ref: string) {
  const m = /^([A-Z]+?)(\d+)([A-Z]?)$/.exec(ref);
  return m ? { line: m[1]!, n: Number(m[2]), suffix: m[3]! } : null;
}

let cached: MrtGraph | null = null;

export function mrtGraph(): MrtGraph {
  if (cached) return cached;
  const raw = mrtJson as unknown as { lines: RawLine[]; stations: RawStation[] };
  const stations: MrtStation[] = raw.stations.map((s, idx) => ({ idx, id: s.id, name: s.name, lat: s.lat, lng: s.lng, lines: s.lines }));
  const nodes: MrtGraph["nodes"] = [];
  const nodeIdx = new Map<string, number>();
  const nodesOfStation: number[][] = stations.map(() => []);
  const byRef = new Map<string, { station: number; line: string }>();
  raw.stations.forEach((s, i) => {
    for (const ref of s.refs) {
      const p = parseRef(ref);
      if (!p) continue;
      byRef.set(ref, { station: i, line: p.line });
      const k = `${i}|${p.line}`;
      if (!nodeIdx.has(k)) {
        nodeIdx.set(k, nodes.length);
        nodesOfStation[i]!.push(nodes.length);
        nodes.push({ station: i, line: p.line });
      }
    }
  });
  const adj: MrtEdge[][] = nodes.map(() => []);
  const link = (a: number, b: number, line: string) => {
    const na = nodeIdx.get(`${a}|${line}`);
    const nb = nodeIdx.get(`${b}|${line}`);
    if (na == null || nb == null) return;
    const sa = stations[a]!;
    const sb = stations[b]!;
    const d = haversine(sa.lat, sa.lng, sb.lat, sb.lng) * 1.1;
    const min = d / (SPEED_M_PER_MIN[line] ?? 600) + (DWELL[line] ?? 0.5);
    adj[na]!.push({ to: nb, min });
    adj[nb]!.push({ to: na, min });
  };
  // 同線、同後綴、編號相差 ≤2(機捷 A13→A15 中間沒站)的相連
  const groups = new Map<string, { n: number; station: number }[]>();
  for (const [ref, v] of byRef) {
    const p = parseRef(ref)!;
    const g = `${p.line}|${p.suffix}`;
    groups.set(g, [...(groups.get(g) ?? []), { n: p.n, station: v.station }]);
  }
  for (const [g, list] of groups) {
    const line = g.split("|")[0]!;
    list.sort((a, b) => a.n - b.n);
    for (let i = 1; i < list.length; i++) if (list[i]!.n - list[i - 1]!.n <= 2) link(list[i - 1]!.station, list[i]!.station, line);
  }
  for (const [a, b] of JOINS) {
    const x = byRef.get(a);
    const y = byRef.get(b);
    if (x && y) link(x.station, y.station, x.line);
  }
  // 同站換線
  for (const ns of nodesOfStation)
    for (const a of ns) for (const b of ns) if (a !== b) adj[a]!.push({ to: b, min: MRT_TRANSFER_MIN });

  const lineName: Record<string, string> = {};
  const lineColor: Record<string, string> = {};
  for (const l of raw.lines) {
    lineName[l.code] = l.name;
    lineColor[l.code] = l.color;
  }
  cached = { stations, nodes, adj, nodesOfStation, lineName, lineColor };
  return cached;
}

export interface MrtLabels {
  /** 每個節點到終點(含終點之後的部分)的分鐘 */
  dist: Float64Array;
  /** 往終點方向的下一個節點(-1 = 在這個節點下車) */
  next: Int32Array;
  /** 下車節點對應的來源標記(呼叫端自己的資料) */
  sourceOf: Int32Array;
}

/**
 * 多起點 Dijkstra(邊雙向對稱,所以「從終點往回算」和正向一樣):
 * sources = 在某站下車之後還要多久(走到目的地、或轉公車)。回傳每個節點上車後到終點的分鐘(不含上車等車)。
 */
export function mrtLabels(g: MrtGraph, sources: { station: number; cost: number; tag: number }[]): MrtLabels {
  const n = g.nodes.length;
  const dist = new Float64Array(n).fill(Infinity);
  const next = new Int32Array(n).fill(-1);
  const sourceOf = new Int32Array(n).fill(-1);
  for (const s of sources)
    for (const node of g.nodesOfStation[s.station] ?? [])
      if (s.cost < dist[node]!) {
        dist[node] = s.cost;
        sourceOf[node] = s.tag;
        next[node] = -1;
      }
  const done = new Uint8Array(n);
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i]! < Infinity && (u < 0 || dist[i]! < dist[u]!)) u = i;
    if (u < 0) break;
    done[u] = 1;
    for (const e of g.adj[u]!) {
      const alt = dist[u]! + e.min;
      if (alt < dist[e.to]!) {
        dist[e.to] = alt;
        next[e.to] = u;
        sourceOf[e.to] = sourceOf[u]!;
      }
    }
  }
  return { dist, next, sourceOf };
}

/** 從上車節點沿 next 走到下車節點,整理成搭乘的線 / 經過的站 */
export function mrtPath(g: MrtGraph, labels: MrtLabels, board: number) {
  const lines: string[] = [];
  const path: { lng: number; lat: number; color: string }[] = [];
  let stops = 0;
  let cur = board;
  let last = board;
  for (let guard = 0; cur >= 0 && guard < 500; guard++) {
    const node = g.nodes[cur]!;
    const st = g.stations[node.station]!;
    if (lines[lines.length - 1] !== node.line) lines.push(node.line);
    const prev = path[path.length - 1];
    if (!prev || prev.lng !== st.lng || prev.lat !== st.lat) {
      if (prev) stops++;
      path.push({ lng: st.lng, lat: st.lat, color: g.lineColor[node.line] ?? "#888" });
    }
    last = cur;
    cur = labels.next[cur]!;
  }
  return {
    lines: lines.map((l) => g.lineName[l] ?? l),
    colors: lines.map((l) => g.lineColor[l] ?? "#888"),
    from: g.stations[g.nodes[board]!.station]!.name,
    to: g.stations[g.nodes[last]!.station]!.name,
    alightNode: last,
    stops,
    path,
  };
}
