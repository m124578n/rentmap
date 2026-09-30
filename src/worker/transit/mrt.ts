/**
 * 捷運網路(public/mrt.json → 圖)。站間分鐘:
 *   有官方站間時間(public/mrt-times.json,`npm run collect -- metro` 從 TDX 產生)就用;
 *   沒有(淡海、安坑輕軌)用距離估 = 直線距離 × 1.1 ÷ 速度 + 停站,不同系統速度不同(輕軌慢、機捷快)
 *   換線 +4 分(走路 + 等車),上車先等半個班距
 * 站序從 refs 編號來(BL12、R22A…),相鄰編號相連;支線手動接。
 *
 * 台鐵(public/tra.json,`npm run collect -- tra`)也放進同一張圖:線代碼 TRA、站名前面加「台鐵」,
 * 站間用區間車實際時刻、班距用區間車班次算;台鐵站與 350m 內的捷運站可以互轉(+6 分)。
 */
import mrtJson from "../../../public/mrt.json";
import mrtTimes from "../../../public/mrt-times.json";
import traJson from "../../../public/tra.json";
import { haversine, type DayType } from "@shared/bus";
import { mrtPairKey } from "@shared/trip";
import { DEFAULT_REGION, regionAt, type RegionKey } from "@shared/regions";

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
  /** 捷運(含輕軌、機捷)或台鐵 */
  rail: "mrt" | "tra";
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
/** 台鐵 ↔ 捷運出站走過去再進站 */
export const TRA_TRANSFER_MIN = 6;
const TRA_TRANSFER_R = 350;
export const TRA_LINE = "TRA";

export interface TraFile {
  updated: string | null;
  headway: [number, number, number];
  stations: { id: string; name: string; lat: number; lng: number }[];
  edges: Record<string, number>;
}
const tra = traJson as unknown as TraFile;
/** 班距(分):[平日尖峰, 離峰 / 假日, 23 點後];大約值,依北捷公告的班距區間取中間 */
const MRT_HEADWAY: Record<string, [number, number, number]> = {
  V: [15, 15, 20],
  K: [15, 15, 20],
  LB: [10, 12, 15],
  A: [12, 15, 15],
  Y: [6, 10, 12],
  [TRA_LINE]: tra.headway,
};
const MRT_HEADWAY_DEFAULT: [number, number, number] = [5, 7, 12];

/** 上車平均等車(半個班距);t = 出發時刻(分)。00:00–06:00 沒營運 → Infinity */
export function mrtWait(line: string, day: DayType = "wd", t = 8 * 60) {
  const m = ((t % 1440) + 1440) % 1440;
  if (m < 6 * 60) return Infinity;
  const [peak, off, late] = MRT_HEADWAY[line] ?? MRT_HEADWAY_DEFAULT;
  const isPeak = day === "wd" && ((m >= 7 * 60 && m < 9 * 60) || (m >= 17 * 60 && m < 19 * 60 + 30));
  return Math.round((m >= 23 * 60 ? late : isPeak ? peak : off) / 2);
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

const cached = new Map<RegionKey, MrtGraph>();

/** 一個生活圈一張圖(站依座標歸區);北區是雙北捷運 + 機捷 + 輕軌 + 台鐵 */
export function mrtGraph(region: RegionKey = DEFAULT_REGION): MrtGraph {
  let g = cached.get(region);
  if (!g) cached.set(region, (g = buildRailGraph(tra, region)));
  return g;
}

/** 捷運 + 台鐵的圖;traData 可換(測試用) */
export function buildRailGraph(traData: TraFile, region: RegionKey = DEFAULT_REGION): MrtGraph {
  const raw = mrtJson as unknown as { lines: RawLine[]; stations: RawStation[] };
  const rawStations = raw.stations.filter((s) => regionAt(s.lat, s.lng) === region);
  const stations: MrtStation[] = rawStations.map((s, idx) => ({ idx, id: s.id, name: s.name, lat: s.lat, lng: s.lng, lines: s.lines, rail: "mrt" }));
  const nodes: MrtGraph["nodes"] = [];
  const nodeIdx = new Map<string, number>();
  const nodesOfStation: number[][] = stations.map(() => []);
  const byRef = new Map<string, { station: number; line: string }>();
  rawStations.forEach((s, i) => {
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
  const official = (mrtTimes as { edges: Record<string, number> }).edges;
  const link = (a: number, b: number, line: string, refA: string, refB: string) => {
    const na = nodeIdx.get(`${a}|${line}`);
    const nb = nodeIdx.get(`${b}|${line}`);
    if (na == null || nb == null) return;
    const sa = stations[a]!;
    const sb = stations[b]!;
    const sec = official[mrtPairKey(refA, refB)];
    const d = haversine(sa.lat, sa.lng, sb.lat, sb.lng) * 1.1;
    const min = sec ? sec / 60 : d / (SPEED_M_PER_MIN[line] ?? 600) + (DWELL[line] ?? 0.5);
    adj[na]!.push({ to: nb, min });
    adj[nb]!.push({ to: na, min });
  };
  // 同線、同後綴、編號相差 ≤2(機捷 A13→A15 中間沒站)的相連
  const groups = new Map<string, { n: number; station: number; ref: string }[]>();
  for (const [ref, v] of byRef) {
    const p = parseRef(ref)!;
    const g = `${p.line}|${p.suffix}`;
    groups.set(g, [...(groups.get(g) ?? []), { n: p.n, station: v.station, ref }]);
  }
  for (const [g, list] of groups) {
    const line = g.split("|")[0]!;
    list.sort((a, b) => a.n - b.n);
    for (let i = 1; i < list.length; i++) if (list[i]!.n - list[i - 1]!.n <= 2) link(list[i - 1]!.station, list[i]!.station, line, list[i - 1]!.ref, list[i]!.ref);
  }
  for (const [a, b] of JOINS) {
    const x = byRef.get(a);
    const y = byRef.get(b);
    if (x && y) link(x.station, y.station, x.line, a, b);
  }
  // 同站換線
  for (const ns of nodesOfStation)
    for (const a of ns) for (const b of ns) if (a !== b) adj[a]!.push({ to: b, min: MRT_TRANSFER_MIN });

  // 台鐵:每站一個節點(線 TRA),邊用時刻表的站間秒數;附近的捷運站可以轉
  const mrtCount = stations.length;
  const traNode = new Map<string, number>();
  for (const t of traData.stations.filter((x) => regionAt(x.lat, x.lng) === region)) {
    const idx = stations.length;
    stations.push({ idx, id: `TRA${t.id}`, name: `台鐵${t.name}`, lat: t.lat, lng: t.lng, lines: [TRA_LINE], rail: "tra" });
    traNode.set(t.id, nodes.length);
    nodesOfStation.push([nodes.length]);
    nodes.push({ station: idx, line: TRA_LINE });
    adj.push([]);
  }
  for (const [k, sec] of Object.entries(traData.edges)) {
    const [a, b] = k.split("-");
    const na = traNode.get(a!);
    const nb = traNode.get(b!);
    if (na == null || nb == null) continue;
    adj[na]!.push({ to: nb, min: sec / 60 });
    adj[nb]!.push({ to: na, min: sec / 60 });
  }
  for (let i = mrtCount; i < stations.length; i++) {
    const t = stations[i]!;
    for (let j = 0; j < mrtCount; j++) {
      const m = stations[j]!;
      if (Math.abs(m.lat - t.lat) > 0.005 || haversine(t.lat, t.lng, m.lat, m.lng) > TRA_TRANSFER_R) continue;
      for (const a of nodesOfStation[i]!)
        for (const b of nodesOfStation[j]!) {
          adj[a]!.push({ to: b, min: TRA_TRANSFER_MIN });
          adj[b]!.push({ to: a, min: TRA_TRANSFER_MIN });
        }
    }
  }

  const lineName: Record<string, string> = { [TRA_LINE]: "台鐵" };
  const lineColor: Record<string, string> = { [TRA_LINE]: "#1d4f91" };
  for (const l of raw.lines) {
    lineName[l.code] = l.name;
    lineColor[l.code] = l.color;
  }
  return { stations, nodes, adj, nodesOfStation, lineName, lineColor };
}

/** 路網資料版本(彙總快取的 key 要帶:改了捷運時間或台鐵時刻,結果就不同) */
export const RAIL_VERSION = `${(mrtTimes as { updated?: string }).updated ?? ""}+${tra.updated ?? ""}`;

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
