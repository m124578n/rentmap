import type * as maplibregl from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import { useQuery } from "@tanstack/react-query";
import type { BusLine } from "@shared/bus";
import { api } from "@/lib/api";
import type { Theme } from "./basemap";
import type { Viewport } from "./heat";

/**
 * 地圖「公車路線」圖層:畫面內有站的公車線(/api/bus/lines),放大到街區才查。
 * 每條線一個顏色(依路線名雜湊,同一條線換畫面顏色不變),線上標路線名;點線跳起訖與尖峰班距。
 */
export const BUS_LINES_MIN_ZOOM = 14;

export function useBusLines(on: boolean, view: Viewport | null) {
  const zoomOk = !!view && view.zoom >= BUS_LINES_MIN_ZOOM;
  const r = (x: number) => Math.round(x * 1000) / 1000;
  const box = view ? { w: r(view.w), s: r(view.s), e: r(view.e), n: r(view.n) } : null;
  const q = useQuery({
    queryKey: ["bus-lines", box?.w, box?.s, box?.e, box?.n],
    queryFn: () => api.busLines(box!),
    enabled: on && zoomOk && !!box,
    staleTime: 30 * 60_000,
  });
  if (!on) return { fc: null, note: null, loading: false };
  if (!zoomOk) return { fc: null, note: "放大到街區才畫公車路線", loading: false };
  if (q.data?.too_big) return { fc: null, note: "放大一點才畫公車路線", loading: q.isFetching };
  const fc = q.data ? linesFC(q.data.lines) : null;
  return { fc, note: q.data ? `畫面內公車 ${q.data.lines.length} 條` : null, loading: q.isFetching };
}

// 跟捷運線色錯開的顏色(偏深、彼此好分)
const COLORS = ["#0f766e", "#7c2d12", "#4338ca", "#a16207", "#be185d", "#15803d", "#1d4ed8", "#9333ea", "#b45309", "#0e7490", "#4d7c0f", "#c2410c"];
function colorOf(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length]!;
}

function linesFC(lines: BusLine[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: lines.map((l) => ({
      type: "Feature" as const,
      geometry: { type: "MultiLineString" as const, coordinates: l.segs },
      properties: {
        key: l.key,
        name: l.name,
        label: l.variant ? `${l.name}(${l.variant})` : l.name,
        ends: l.from_name && l.to_name ? `${l.from_name} — ${l.to_name}` : "",
        peak: l.peak ? (l.peak[0] === l.peak[1] ? `尖峰約 ${l.peak[0]} 分一班` : `尖峰 ${l.peak[0]}–${l.peak[1]} 分一班`) : "",
        color: colorOf(l.name),
      },
    })),
  };
}

const SRC = "bus-lines";
/** 點線跳說明用 */
export const BUS_LINES_LAYER = "bus-lines";
const HIT = "bus-lines-hit";
const HL = "bus-lines-hl";
const LABEL = "bus-lines-label";

/** 畫 / 換 / 清掉;style 重載(切主題)後要再呼叫一次 */
export function setBusLines(map: maplibregl.Map, fc: FeatureCollection | null, theme: Theme) {
  if (!fc) {
    for (const id of [LABEL, HL, HIT, BUS_LINES_LAYER]) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(SRC)) map.removeSource(SRC);
    return;
  }
  const src = map.getSource(SRC) as maplibregl.GeoJSONSource | undefined;
  if (src) return void src.setData(fc);
  map.addSource(SRC, { type: "geojson", data: fc });
  // 插在生活機能圖示、選中路線(busLayer)下面:那些是點了才出現的,要蓋在一般公車線上
  const above = new Set(["poi-layer-icon", "poi-layer-label", "poi-layer-label-garbage", "bus-line-casing"]);
  const before = map.getStyle().layers.find((l) => above.has(l.id))?.id;
  map.addLayer({
    id: BUS_LINES_LAYER,
    type: "line",
    source: SRC,
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": ["get", "color"], "line-width": ["interpolate", ["linear"], ["zoom"], 14, 1.8, 17, 3.5], "line-opacity": 0.75 },
  }, before);
  // 點的範圍比線寬,手機比較點得到
  map.addLayer({ id: HIT, type: "line", source: SRC, paint: { "line-color": "#000", "line-width": 14, "line-opacity": 0 } }, before);
  map.addLayer({
    id: HL,
    type: "line",
    source: SRC,
    filter: ["==", ["get", "key"], ""],
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": ["get", "color"], "line-width": 6, "line-opacity": 0.95 },
  }, before);
  map.addLayer({
    id: LABEL,
    type: "symbol",
    source: SRC,
    layout: {
      "symbol-placement": "line",
      "symbol-spacing": 260,
      "text-field": ["get", "label"],
      "text-size": 11,
      "text-font": ["Open Sans Semibold", "Noto Sans Regular"],
      "text-allow-overlap": false,
    },
    paint: { "text-color": ["get", "color"], "text-halo-color": theme === "dark" ? "#111" : "#fff", "text-halo-width": 1.6 },
  }, before);
}

/** 點到的線加粗;空字串 = 取消 */
export function highlightBusLine(map: maplibregl.Map, key: string) {
  if (map.getLayer(HL)) map.setFilter(HL, ["==", ["get", "key"], key]);
}
export const BUS_LINES_HIT = HIT;
