import type * as maplibregl from "maplibre-gl";
import type { FeatureCollection } from "geojson";

/**
 * 地圖上要畫的路線:面板選了一條公車,或選了一種通勤搭法(公車段 + 捷運段 + 走路段)。
 *   full    整條公車路線(有選上下車段時變淡)
 *   segment 真正會坐的公車段
 *   mrt     捷運段(線色)
 *   walk    走路(虛線)
 */
export interface OverlayLine {
  /** [lng, lat] */
  coords: [number, number][];
  kind: "full" | "segment" | "mrt" | "walk";
  color?: string;
  faint?: boolean;
}
export interface BusOverlay {
  lines: OverlayLine[];
  stops: { name: string; lat: number; lng: number; role: "board" | "alight" | "stop" | "transfer" }[];
  /** 框進畫面的範圍;沒給就用全部線 */
  focus?: [number, number][];
}

const SRC_LINE = "bus-line";
const SRC_STOPS = "bus-stops";
const LAYERS = ["bus-line-casing", "bus-line", "bus-walk", "bus-stops", "bus-stop-names"];

function linesGeoJSON(o: BusOverlay, fallback: string): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: o.lines
      .filter((l) => l.coords.length >= 2)
      .map((l) => ({
        type: "Feature",
        geometry: { type: "LineString", coordinates: l.coords },
        properties: { kind: l.kind, color: l.color ?? fallback, faint: !!l.faint },
      })),
  };
}
function stopsGeoJSON(o: BusOverlay): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: o.stops.map((s) => ({ type: "Feature", geometry: { type: "Point", coordinates: [s.lng, s.lat] }, properties: { name: s.name, role: s.role } })),
  };
}

/** 畫 / 換 / 清掉路線圖層。style 重載(切主題)後要再呼叫一次。 */
export function setBusOverlay(map: maplibregl.Map, o: BusOverlay | null, theme: "light" | "dark") {
  for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id);
  for (const id of [SRC_LINE, SRC_STOPS]) if (map.getSource(id)) map.removeSource(id);
  if (!o) return;
  const halo = theme === "dark" ? "#111" : "#fff";
  // 公車用無彩色(深灰 / 暗色主題淺灰):捷運已經用掉紅橘黃綠藍紫棕
  const busColor = theme === "dark" ? "#e5e7eb" : "#1f2937";
  map.addSource(SRC_LINE, { type: "geojson", data: linesGeoJSON(o, busColor) });
  map.addSource(SRC_STOPS, { type: "geojson", data: stopsGeoJSON(o) });
  const width = ["match", ["get", "kind"], "segment", 6, "mrt", 5.5, 3.5] as unknown as number;
  map.addLayer({
    id: "bus-line-casing",
    type: "line",
    source: SRC_LINE,
    filter: ["!=", ["get", "kind"], "walk"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": halo, "line-width": ["+", width, 3.5] as unknown as number, "line-opacity": 0.9 },
  });
  map.addLayer({
    id: "bus-line",
    type: "line",
    source: SRC_LINE,
    filter: ["!=", ["get", "kind"], "walk"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": ["get", "color"], "line-width": width, "line-opacity": ["case", ["get", "faint"], 0.4, 0.95] },
  });
  map.addLayer({
    id: "bus-walk",
    type: "line",
    source: SRC_LINE,
    filter: ["==", ["get", "kind"], "walk"],
    layout: { "line-cap": "round" },
    paint: { "line-color": busColor, "line-width": 2.5, "line-dasharray": [1, 1.5], "line-opacity": 0.8 },
  });
  map.addLayer({
    id: "bus-stops",
    type: "circle",
    source: SRC_STOPS,
    paint: {
      "circle-radius": ["match", ["get", "role"], "stop", 3.5, 7],
      "circle-color": ["match", ["get", "role"], "board", "#059669", "alight", "#2563eb", "transfer", "#d97706", halo],
      "circle-stroke-color": ["match", ["get", "role"], "stop", busColor, halo],
      "circle-stroke-width": 2,
    },
  });
  map.addLayer({
    id: "bus-stop-names",
    type: "symbol",
    source: SRC_STOPS,
    // 上下車 / 轉乘站一直顯示名字,其他站放大才顯示
    filter: ["any", ["!=", ["get", "role"], "stop"], [">=", ["zoom"], 15]],
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Open Sans Semibold", "Noto Sans Regular"],
      "text-size": ["match", ["get", "role"], "stop", 10.5, 12.5],
      "text-anchor": "left",
      "text-offset": [0.8, 0],
      "text-optional": true,
    },
    paint: { "text-color": theme === "dark" ? "#eee" : "#222", "text-halo-color": halo, "text-halo-width": 1.5 },
  });
}

/** 框進畫面用的點 */
export function overlayPoints(o: BusOverlay): [number, number][] {
  return o.focus ?? o.lines.flatMap((l) => l.coords);
}
