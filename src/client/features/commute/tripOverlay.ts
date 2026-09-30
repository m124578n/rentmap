import { haversine, type BusRouteDetail } from "@shared/bus";
import type { Trip } from "@shared/trip";
import type { BusOverlay, OverlayLine } from "@/features/map/busLayer";

type Pt = [number, number]; // [lng, lat]

/** 沿公車線形切出上車到下車那段;線形對不上(環狀、缺線形)就直接連兩點 */
export function sliceShape(shape: Pt[], from: Pt, to: Pt): Pt[] {
  const near = (p: Pt) => {
    let best = 0;
    let bestD = Infinity;
    shape.forEach(([x, y], i) => {
      const d = haversine(p[1], p[0], y, x);
      if (d < bestD) (bestD = d), (best = i);
    });
    return best;
  };
  const a = near(from);
  const b = near(to);
  return a < b ? [from, ...shape.slice(a, b + 1), to] : [from, to];
}

/** 一個行程 → 地圖圖層:公車段(沿線形)、捷運段(線色)、走路(虛線)、上車 / 轉乘 / 下車點 */
export function tripOverlay(trip: Trip, start: Pt, end: Pt, shapes: Map<string, BusRouteDetail>): BusOverlay {
  const lines: OverlayLine[] = [];
  const stops: BusOverlay["stops"] = [];
  let cur = start;
  const rides = trip.legs.filter((l) => l.mode !== "walk");
  trip.legs.forEach((leg, i) => {
    if (leg.mode === "walk") {
      // 走路的終點 = 下一段的起點,最後一段走到目的地
      const next = trip.legs[i + 1];
      const to: Pt = next?.mode === "bus" || next?.mode === "bike" ? next.from_pt : next?.mode === "mrt" ? [next.path[0]!.lng, next.path[0]!.lat] : end;
      lines.push({ coords: [cur, to], kind: "walk" });
      cur = to;
      return;
    }
    const role = (idx: number): "board" | "transfer" => (rides.indexOf(leg) === 0 && idx === 0 ? "board" : "transfer");
    if (leg.mode === "bike") {
      lines.push({ coords: [leg.from_pt, leg.to_pt], kind: "mrt", color: "#65a30d" });
      stops.push({ name: `YouBike ${leg.from}`, lng: leg.from_pt[0], lat: leg.from_pt[1], role: role(0) });
      stops.push({ name: `YouBike ${leg.to}`, lng: leg.to_pt[0], lat: leg.to_pt[1], role: rides.indexOf(leg) === rides.length - 1 ? "alight" : "transfer" });
      cur = leg.to_pt;
    } else if (leg.mode === "bus") {
      const d = shapes.get(leg.key);
      lines.push({ coords: d ? sliceShape(d.route.shape, leg.from_pt, leg.to_pt) : [leg.from_pt, leg.to_pt], kind: "segment" });
      stops.push({ name: `${leg.from}(${leg.name})`, lng: leg.from_pt[0], lat: leg.from_pt[1], role: role(0) });
      stops.push({ name: leg.to, lng: leg.to_pt[0], lat: leg.to_pt[1], role: rides.indexOf(leg) === rides.length - 1 ? "alight" : "transfer" });
      cur = leg.to_pt;
    } else {
      // 同色的連續站接成一段
      let seg: Pt[] = [];
      let color = leg.path[0]?.color ?? "#888";
      for (const p of leg.path) {
        if (p.color !== color && seg.length) {
          lines.push({ coords: [...seg, [p.lng, p.lat]], kind: "mrt", color });
          seg = [];
          color = p.color;
        }
        seg.push([p.lng, p.lat]);
      }
      if (seg.length >= 2) lines.push({ coords: seg, kind: "mrt", color });
      const first = leg.path[0]!;
      const last = leg.path[leg.path.length - 1]!;
      stops.push({ name: leg.from.startsWith("台鐵") ? leg.from : `捷運${leg.from}`, lng: first.lng, lat: first.lat, role: role(0) });
      stops.push({ name: leg.to.startsWith("台鐵") ? leg.to : `捷運${leg.to}`, lng: last.lng, lat: last.lat, role: rides.indexOf(leg) === rides.length - 1 ? "alight" : "transfer" });
      cur = [last.lng, last.lat];
    }
  });
  return { lines, stops, focus: [start, end, ...lines.flatMap((l) => l.coords)] };
}
