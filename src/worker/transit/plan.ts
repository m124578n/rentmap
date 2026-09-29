/**
 * 通勤規劃(最多轉乘一次),從目的地往回算,算一次就能套到所有房源:
 *
 *   最後一段(直接到目的地):
 *     finalBus[站]  在這站上某路公車,坐到目的地附近下車再走過去,要幾分
 *     mrtFinal      捷運從各站到目的地附近的站(含系統內換線)再走過去
 *   第一段(之後還要轉乘一次):
 *     firstBusB/M[站] 在這站上公車,之後下車走到另一路公車(B)/ 捷運站(M)接最後一段
 *     mrtFirst        捷運坐到某站,出站走到公車站接最後一段公車
 *
 * 房源只要看「走得到的站」:公車站(半徑內)、捷運站(1km 內),加上走路的分鐘,取最小。
 * 時間都是估計:等車抓「那個時段」的班距一半(沒車的路線不算)、轉乘另加 2 分緩衝。
 *
 * 時段(when):上班 dir=to(住處 → 地點)直接算;下班 dir=from(地點 → 住處)用 reverseNet 的反向公車網路
 * 把住處當目的地算(捷運圖本來就雙向對稱),buildTrip 最後把行程翻回正向。
 */
import { haversine, serviceWait, toMin, walkMin } from "@shared/bus";
import { COMMUTE_DEFAULT, type CommuteWhen, type Trip, type TripKind, type TripLeg } from "@shared/trip";
import { mrtGraph, mrtLabels, mrtPath, mrtWait, type MrtGraph, type MrtLabels } from "./mrt";
import { nearStops, reverseNet, type BusNet } from "./network";

export const DEST_BUS_R = 500;
export const MRT_WALK_R = 1000;
const BUS_TRANSFER_R = 200;
const BUS_MRT_TRANSFER_R = 350;
const TRANSFER_PENALTY = 2;
const WALK_ONLY_M = 1500;
/** 沒有班表資料的公車路線,等車當 10 分 */
const UNKNOWN_BUS_WAIT = 10;

export interface Plan {
  net: BusNet;
  g: MrtGraph;
  when: CommuteWhen;
  /** 每條路線方向在這個時段的等車分鐘;Infinity = 這時段沒車 */
  waits: Float64Array;
  mrtW: (line: string) => number;
  dest: { lat: number; lng: number; name: string };
  finalBus: Float64Array;
  finalBusAlight: Int32Array;
  mrtFinal: MrtLabels;
  /** 公車第一段:下車站 q 的轉乘去處與成本 */
  firstBusB: Float64Array;
  firstBusBAlight: Int32Array;
  viaBus: Int32Array; // q → 轉乘上車的公車站
  firstBusM: Float64Array;
  firstBusMAlight: Int32Array;
  viaMrt: Int32Array; // q → 轉乘進的捷運節點
  mrtFirst: MrtLabels; // sourceOf = 出站後接的公車站
}

const inf = (n: number) => new Float64Array(n).fill(Infinity);
const neg = (n: number) => new Int32Array(n).fill(-1);
const distM = (net: BusNet, i: number, lat: number, lng: number) => haversine(lat, lng, net.sLat[i]!, net.sLng[i]!);

/** 捷運站上車(含等車)的最佳節點 */
function mrtBoard(p: Pick<Plan, "g" | "mrtW">, L: MrtLabels, station: number): { cost: number; node: number } {
  const { g } = p;
  let best = { cost: Infinity, node: -1 };
  for (const node of g.nodesOfStation[station] ?? []) {
    const c = L.dist[node]! + p.mrtW(g.nodes[node]!.line);
    if (c < best.cost) best = { cost: c, node };
  }
  return best;
}

/**
 * 每條路線方向由後往前掃:label[q] 是在 q 下車之後還要幾分,
 * out[y] = 等車 + min_{q 在 y 之後}(T[q] − T[y] + label[q])
 */
function sweepRoutes(net: BusNet, waits: Float64Array, label: Float64Array, out: Float64Array, outAlight: Int32Array) {
  for (let ri = 0; ri < net.routes.length; ri++) {
    const r = net.routes[ri]!;
    const wait = waits[ri]!;
    if (wait === Infinity) continue;
    let best = Infinity;
    let bestQ = -1;
    for (let i = r.end - 1; i >= r.start; i--) {
      if (best < Infinity) {
        const c = wait + best - net.sT[i]!;
        if (c < out[i]!) {
          out[i] = c;
          outAlight[i] = bestQ;
        }
      }
      const v = label[i]! + net.sT[i]!;
      if (v < best) {
        best = v;
        bestQ = i;
      }
    }
  }
}

/** 每條路線方向在這個時段的等車分鐘 */
export function busWaits(net: BusNet, when: CommuteWhen): Float64Array {
  const t = toMin(when.time);
  return Float64Array.from(net.routes, (r) => {
    const w = serviceWait(r.schedule, when.day, t);
    return w === undefined ? UNKNOWN_BUS_WAIT : w === null ? Infinity : w;
  });
}

/**
 * dest = 我的地點;上班(dir=to)算「住處 → 地點」,下班(dir=from)算「地點 → 住處」。
 * 兩個方向都是「以地點為錨、一次算完所有房源」,查詢量不因房源數增加。
 */
export function buildPlan(fwd: BusNet, dest: { lat: number; lng: number; name: string }, when: CommuteWhen = COMMUTE_DEFAULT.go): Plan {
  const g = mrtGraph();
  const net = when.dir === "from" ? reverseNet(fwd) : fwd;
  const n = net.sLat.length;
  const waits = busWaits(net, when);
  const t = toMin(when.time);
  const mrtW = (line: string) => mrtWait(line, when.day, t);

  // 最後一段:公車
  const alightCost = inf(n);
  nearStops(net, dest.lat, dest.lng, DEST_BUS_R, (i) => {
    const d = distM(net, i, dest.lat, dest.lng);
    if (d <= DEST_BUS_R) alightCost[i] = walkMin(d);
  });
  const finalBus = inf(n);
  const finalBusAlight = neg(n);
  sweepRoutes(net, waits, alightCost, finalBus, finalBusAlight);

  // 最後一段:捷運
  const destStations = g.stations
    .map((s) => ({ station: s.idx, d: haversine(dest.lat, dest.lng, s.lat, s.lng) }))
    .filter((x) => x.d <= MRT_WALK_R)
    .map((x) => ({ station: x.station, cost: walkMin(x.d), tag: x.station }));
  const mrtFinal = mrtLabels(g, destStations);

  // 轉乘:公車下車站 q → 走到最後一段的公車站 x / 捷運站
  const toBus = inf(n);
  const viaBus = neg(n);
  for (let x = 0; x < n; x++) {
    if (finalBus[x] === Infinity) continue;
    const nameX = net.routes[net.sRoute[x]!]?.name;
    nearStops(net, net.sLat[x]!, net.sLng[x]!, BUS_TRANSFER_R, (q) => {
      if (net.routes[net.sRoute[q]!]?.name === nameX) return; // 同一路(含反方向)不算轉乘
      const d = haversine(net.sLat[x]!, net.sLng[x]!, net.sLat[q]!, net.sLng[q]!);
      if (d > BUS_TRANSFER_R) return;
      const c = walkMin(d) + TRANSFER_PENALTY + finalBus[x]!;
      if (c < toBus[q]!) {
        toBus[q] = c;
        viaBus[q] = x;
      }
    });
  }
  const toMrt = inf(n);
  const viaMrt = neg(n);
  for (const st of g.stations) {
    const b = mrtBoard({ g, mrtW }, mrtFinal, st.idx);
    if (b.cost === Infinity) continue;
    nearStops(net, st.lat, st.lng, BUS_MRT_TRANSFER_R, (q) => {
      const d = haversine(st.lat, st.lng, net.sLat[q]!, net.sLng[q]!);
      if (d > BUS_MRT_TRANSFER_R) return;
      const c = walkMin(d) + TRANSFER_PENALTY + b.cost;
      if (c < toMrt[q]!) {
        toMrt[q] = c;
        viaMrt[q] = b.node;
      }
    });
  }
  const firstBusB = inf(n);
  const firstBusBAlight = neg(n);
  sweepRoutes(net, waits, toBus, firstBusB, firstBusBAlight);
  const firstBusM = inf(n);
  const firstBusMAlight = neg(n);
  sweepRoutes(net, waits, toMrt, firstBusM, firstBusMAlight);

  // 捷運第一段:出站走到最後一段的公車站
  const mrtToBus: { station: number; cost: number; tag: number }[] = [];
  for (const st of g.stations) {
    let best = { cost: Infinity, tag: -1 };
    nearStops(net, st.lat, st.lng, BUS_MRT_TRANSFER_R, (x) => {
      if (finalBus[x] === Infinity) return;
      const d = haversine(st.lat, st.lng, net.sLat[x]!, net.sLng[x]!);
      if (d > BUS_MRT_TRANSFER_R) return;
      const c = walkMin(d) + TRANSFER_PENALTY + finalBus[x]!;
      if (c < best.cost) best = { cost: c, tag: x };
    });
    if (best.tag >= 0) mrtToBus.push({ station: st.idx, cost: best.cost, tag: best.tag });
  }
  const mrtFirst = mrtLabels(g, mrtToBus);

  return { net, g, when, waits, mrtW, dest, finalBus, finalBusAlight, mrtFinal, firstBusB, firstBusBAlight, viaBus, firstBusM, firstBusMAlight, viaMrt, mrtFirst };
}

// ---- 從房源出發 ----

type Cand =
  | { kind: "walk"; cost: number; m: number }
  | { kind: "bus" | "bus+bus" | "bus+mrt"; cost: number; stop: number; m: number }
  | { kind: "mrt" | "mrt+bus"; cost: number; station: number; node: number; m: number };

/** 房源出發的所有候選:每種搭法留最快的,公車直達再多留幾條不同路線 */
export function candidates(p: Plan, lat: number, lng: number, busR: number, directKeep = 1): Cand[] {
  const { net, g } = p;
  const best = new Map<string, Cand>();
  const direct: Cand[] = [];
  const put = (k: string, c: Cand) => {
    const cur = best.get(k);
    if (!cur || c.cost < cur.cost) best.set(k, c);
  };
  const dWalk = haversine(lat, lng, p.dest.lat, p.dest.lng);
  if (dWalk <= WALK_ONLY_M) put("walk", { kind: "walk", cost: walkMin(dWalk), m: dWalk });

  nearStops(net, lat, lng, busR, (y) => {
    const m = distM(net, y, lat, lng);
    if (m > busR) return;
    const w = walkMin(m);
    if (p.finalBus[y]! < Infinity) direct.push({ kind: "bus", cost: w + p.finalBus[y]!, stop: y, m });
    if (p.firstBusB[y]! < Infinity) put("bus+bus", { kind: "bus+bus", cost: w + p.firstBusB[y]!, stop: y, m });
    if (p.firstBusM[y]! < Infinity) put("bus+mrt", { kind: "bus+mrt", cost: w + p.firstBusM[y]!, stop: y, m });
  });
  for (const st of g.stations) {
    const m = haversine(lat, lng, st.lat, st.lng);
    if (m > MRT_WALK_R) continue;
    const w = walkMin(m);
    const a = mrtBoard(p, p.mrtFinal, st.idx);
    if (a.cost < Infinity) put("mrt", { kind: "mrt", cost: w + a.cost, station: st.idx, node: a.node, m });
    const b = mrtBoard(p, p.mrtFirst, st.idx);
    if (b.cost < Infinity) put("mrt+bus", { kind: "mrt+bus", cost: w + b.cost, station: st.idx, node: b.node, m });
  }
  // 公車直達:同一路線只留最快的上車站,取前 directKeep 條
  direct.sort((a, b) => a.cost - b.cost);
  const seen = new Set<string>();
  const out: Cand[] = [...best.values()];
  for (const c of direct) {
    if (c.kind !== "bus") continue;
    const name = net.routes[net.sRoute[c.stop]!]!.name;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(c);
    if (seen.size >= directKeep) break;
  }
  return out.sort((a, b) => a.cost - b.cost);
}

// ---- 組成行程 ----

function busLeg(p: Plan, y: number, a: number, extraWait = 0): TripLeg {
  const { net } = p;
  const r = net.routes[net.sRoute[y]!]!;
  return {
    mode: "bus",
    min: Math.max(1, Math.round(net.sT[a]! - net.sT[y]!)),
    wait: p.waits[net.sRoute[y]!]! + extraWait,
    name: r.name,
    key: r.key,
    to_name: r.toName,
    from: net.sName[y]!,
    to: net.sName[a]!,
    board_seq: net.sSeq[y]!,
    alight_seq: net.sSeq[a]!,
    from_pt: [net.sLng[y]!, net.sLat[y]!],
    to_pt: [net.sLng[a]!, net.sLat[a]!],
    stops: Math.abs(net.sSeq[a]! - net.sSeq[y]!),
    exact: net.sExact[y] === 1,
  };
}
function mrtLeg(p: Plan, L: MrtLabels, node: number, extraWait = 0): { leg: TripLeg; alightNode: number } {
  const { g } = p;
  const path = mrtPath(g, L, node);
  return {
    leg: {
      mode: "mrt",
      min: Math.max(1, Math.round(L.dist[node]! - L.dist[path.alightNode]!)),
      wait: p.mrtW(g.nodes[node]!.line) + extraWait,
      lines: path.lines,
      colors: path.colors,
      from: path.from,
      to: path.to,
      stops: path.stops,
      path: path.path,
    },
    alightNode: path.alightNode,
  };
}
const walkLeg = (m: number, to: string): TripLeg => ({ mode: "walk", min: walkMin(m), m: Math.round(m), to });
const stationLabel = (g: MrtGraph, node: number) => `捷運${g.stations[g.nodes[node]!.station]!.name}站`;
/** 公車站牌名常已經帶「站」(捷運公館站、臺北車站),不要變成「捷運公館站站」 */
const stopLabel = (name: string) => (name.endsWith("站") ? name : `${name}站`);

export function buildTrip(p: Plan, c: Cand): Trip {
  const { net, g, dest } = p;
  const legs: TripLeg[] = [];
  const toDest = (lat: number, lng: number) => walkLeg(haversine(lat, lng, dest.lat, dest.lng), dest.name);
  if (c.kind === "walk") {
    legs.push(walkLeg(c.m, dest.name));
  } else if (c.kind === "bus" || c.kind === "bus+bus" || c.kind === "bus+mrt") {
    const y = c.stop;
    legs.push(walkLeg(c.m, stopLabel(net.sName[y]!)));
    if (c.kind === "bus") {
      const a = p.finalBusAlight[y]!;
      legs.push(busLeg(p, y, a), toDest(net.sLat[a]!, net.sLng[a]!));
    } else if (c.kind === "bus+bus") {
      const q = p.firstBusBAlight[y]!;
      const x = p.viaBus[q]!;
      const a = p.finalBusAlight[x]!;
      legs.push(
        busLeg(p, y, q),
        walkLeg(haversine(net.sLat[q]!, net.sLng[q]!, net.sLat[x]!, net.sLng[x]!), `${stopLabel(net.sName[x]!)}(轉乘)`),
        busLeg(p, x, a, TRANSFER_PENALTY),
        toDest(net.sLat[a]!, net.sLng[a]!),
      );
    } else {
      const q = p.firstBusMAlight[y]!;
      const node = p.viaMrt[q]!;
      const st = g.stations[g.nodes[node]!.station]!;
      const m = mrtLeg(p, p.mrtFinal, node, TRANSFER_PENALTY);
      const out = g.stations[g.nodes[m.alightNode]!.station]!;
      legs.push(busLeg(p, y, q), walkLeg(haversine(net.sLat[q]!, net.sLng[q]!, st.lat, st.lng), `${stationLabel(g, node)}(轉乘)`), m.leg, toDest(out.lat, out.lng));
    }
  } else if (c.kind === "mrt" || c.kind === "mrt+bus") {
    legs.push(walkLeg(c.m, stationLabel(g, c.node)));
    if (c.kind === "mrt") {
      const m = mrtLeg(p, p.mrtFinal, c.node);
      const out = g.stations[g.nodes[m.alightNode]!.station]!;
      legs.push(m.leg, toDest(out.lat, out.lng));
    } else {
      const m = mrtLeg(p, p.mrtFirst, c.node);
      const out = g.stations[g.nodes[m.alightNode]!.station]!;
      const x = p.mrtFirst.sourceOf[m.alightNode]!;
      const a = p.finalBusAlight[x]!;
      legs.push(
        m.leg,
        walkLeg(haversine(out.lat, out.lng, net.sLat[x]!, net.sLng[x]!), `${stopLabel(net.sName[x]!)}(轉乘)`),
        busLeg(p, x, a, TRANSFER_PENALTY),
        toDest(net.sLat[a]!, net.sLng[a]!),
      );
    }
  }
  const trip = finishTrip(c.kind as TripKind, legs, c.kind === "walk" ? c.m : 0);
  return p.when.dir === "from" ? flipTrip(trip, c.kind === "walk" ? c.m : 0) : trip;
}

function finishTrip(kind: TripKind, legs: TripLeg[], walkM: number): Trip {
  const total = legs.reduce((s, l) => s + l.min + (l.mode === "walk" ? 0 : l.wait), 0);
  const rides = legs.filter((l) => l.mode !== "walk");
  const summary = rides.length
    ? rides.map((l) => (l.mode === "bus" ? l.name : `捷運${l.lines.join("→")}`)).join(" → ")
    : `步行 ${Math.round(walkM / 100) / 10} km`;
  return { kind, total_min: total, transfers: Math.max(0, rides.length - 1), summary, legs };
}

const FLIP_KIND: Partial<Record<TripKind, TripKind>> = { "bus+mrt": "mrt+bus", "mrt+bus": "bus+mrt" };
export const HOME_LABEL = "住處";

/** 反向網路算出來的行程(住處 → 地點的鏡像)翻回「地點 → 住處」:段落倒序、每段起訖對調、走路段重新標目的地 */
export function flipTrip(t: Trip, walkM: number): Trip {
  const legs: TripLeg[] = [...t.legs].reverse().map((l) => {
    if (l.mode === "bus")
      return { ...l, from: l.to, to: l.from, board_seq: l.alight_seq, alight_seq: l.board_seq, from_pt: l.to_pt, to_pt: l.from_pt };
    if (l.mode === "mrt") return { ...l, from: l.to, to: l.from, lines: [...l.lines].reverse(), colors: [...l.colors].reverse(), path: [...l.path].reverse() };
    return { ...l };
  });
  legs.forEach((l, i) => {
    if (l.mode !== "walk") return;
    const next = legs[i + 1];
    l.to = !next || next.mode === "walk" ? HOME_LABEL : `${next.mode === "bus" ? stopLabel(next.from) : `捷運${next.from}站`}${i > 0 ? "(轉乘)" : ""}`;
  });
  return finishTrip(FLIP_KIND[t.kind] ?? t.kind, legs, walkM);
}

/** 一間房到這個目的地最快的行程 */
export function bestTrip(p: Plan, lat: number, lng: number, busR: number): Trip | null {
  const c = candidates(p, lat, lng, busR)[0];
  return c ? buildTrip(p, c) : null;
}
