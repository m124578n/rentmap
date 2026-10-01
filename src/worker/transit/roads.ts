/**
 * 機車 / 開車的道路圖(road_graphs 表,base64 分段)整份進記憶體:一個生活圈一份,依 version 換新。
 * 圖本身與最短時間在 src/shared/roads.ts;這裡負責載入、反向圖、最近路口索引,以及把結果換成通勤的 TripBrief。
 */
import { COMMUTE_MODE_LABEL, OVERHEAD, roadFactor, type DriveMode } from "@shared/drive";
import { costTable, decodeRoads, indexRoads, reverseRoads, roadTimes, snapRoad, type RoadGraph, type RoadIndex, type RoadTimes } from "@shared/roads";
import type { RegionKey } from "@shared/regions";
import type { CommuteWhen, TripBrief } from "@shared/trip";

export interface RoadNet {
  version: string | null;
  g: RoadGraph | null;
  rev: RoadGraph | null;
  idx: RoadIndex | null;
}
const EMPTY: RoadNet = { version: null, g: null, rev: null, idx: null };
const cache = new Map<RegionKey, RoadNet>();

/** 門口騎到最近路口(巷弄、牽車出巷子):每分鐘幾公尺 */
const ACCESS_M_PER_MIN = 200;
/** 最近的路口超過這個距離就當成不在路網上(山區、海邊) */
const SNAP_MAX_M = 1500;

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function loadRoads(DB: D1Database, region: RegionKey): Promise<RoadNet> {
  // 只看完整的那一版(commit 過、段數齊)
  const head = await DB.prepare(
    "SELECT version, COUNT(*) AS n, MAX(total) AS total FROM road_graphs WHERE region = ?1 GROUP BY version HAVING n = total ORDER BY version DESC LIMIT 1",
  )
    .bind(region)
    .first<{ version: string; n: number; total: number }>();
  if (!head) {
    cache.set(region, EMPTY);
    return EMPTY;
  }
  const hit = cache.get(region);
  if (hit?.version === head.version) return hit;
  const { results } = await DB.prepare("SELECT data FROM road_graphs WHERE region = ?1 AND version = ?2 ORDER BY chunk")
    .bind(region, head.version)
    .all<{ data: string }>();
  const parts = results.map((r) => fromBase64(r.data));
  const buf = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) (buf.set(p, o), (o += p.length));
  const g = decodeRoads(buf);
  const net: RoadNet = { version: head.version, g, rev: reverseRoads(g), idx: indexRoads(g) };
  cache.set(region, net);
  return net;
}

export interface DriveRun {
  mode: DriveMode;
  times: RoadTimes;
  /** 地點(或查詢的那個點)到最近路口的距離 */
  originM: number;
}

/**
 * 以一個點為中心算到(或從)所有路口的最短時間:
 *   dir = to(住處 → 地點,上班):用反向圖從地點出發 = 各路口到地點的時間
 *   dir = from(地點 → 住處,下班):用正向圖從地點出發
 * aroundPoint = true 時反過來(中心是住處,算到各地點),給面板查單一地址用。
 */
export function runRoads(net: RoadNet, mode: DriveMode, when: CommuteWhen, region: RegionKey, at: { lat: number; lng: number }, aroundPoint = false, targets?: number[]): DriveRun | null {
  if (!net.g || !net.rev || !net.idx) return null;
  const snap = snapRoad(net.g, net.idx, mode, at.lat, at.lng, SNAP_MAX_M);
  if (!snap) return null;
  const toPlace = when.dir === "to";
  // 中心是地點:上班要「各點到地點」→ 反向圖;中心是住處:上班要「住處到各點」→ 正向圖
  const useRev = aroundPoint ? !toPlace : toPlace;
  const times = roadTimes(useRev ? net.rev : net.g, costTable(mode, roadFactor(mode, when, region)), snap.node, 3 * 3600, targets);
  return { mode, times, originM: snap.m };
}

/** 一個點的結果;點不在路網上、或到不了 → null */
export function briefOf(net: RoadNet, run: DriveRun, at: { lat: number; lng: number }): TripBrief | null {
  if (!net.g || !net.idx) return null;
  const snap = snapRoad(net.g, net.idx, run.mode, at.lat, at.lng, SNAP_MAX_M);
  if (!snap) return null;
  const sec = run.times.sec[snap.node]!;
  if (!Number.isFinite(sec)) return null;
  const roadM = run.times.m[snap.node]!;
  const km = Math.round((roadM + run.originM + snap.m) / 100) / 10;
  const min = Math.max(1, Math.round(OVERHEAD[run.mode] + (run.originM + snap.m) / ACCESS_M_PER_MIN + sec / 60));
  return { kind: run.mode, total_min: min, transfers: 0, summary: `${COMMUTE_MODE_LABEL[run.mode]} ${km} km`, km };
}

/** 面板查單一地址要先知道各地點最近的路口,好讓最短路徑提早停 */
export function snapNode(net: RoadNet, mode: DriveMode, at: { lat: number; lng: number }) {
  return net.g && net.idx ? (snapRoad(net.g, net.idx, mode, at.lat, at.lng, SNAP_MAX_M)?.node ?? null) : null;
}
