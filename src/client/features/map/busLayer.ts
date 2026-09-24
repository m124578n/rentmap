import type * as maplibregl from "maplibre-gl";
import type { FeatureCollection } from "geojson";

/** 地圖上要畫的一條公車路線(面板選了哪條就畫哪條) */
export interface BusOverlay {
  /** [lng, lat] */
  shape: [number, number][];
  stops: { name: string; lat: number; lng: number; role: "board" | "alight" | "stop" }[];
  /** 上車 → 下車那段(通勤模式才有),畫粗一點 */
  segment?: [number, number][];
}

const SRC_LINE = "bus-line";
const SRC_STOPS = "bus-stops";
const LAYERS = ["bus-line-casing", "bus-line", "bus-segment", "bus-stops", "bus-stop-names"];

function stopsGeoJSON(o: BusOverlay): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: o.stops.map((s) => ({ type: "Feature", geometry: { type: "Point", coordinates: [s.lng, s.lat] }, properties: { name: s.name, role: s.role } })),
  };
}
function lineGeoJSON(o: BusOverlay): FeatureCollection {
  const features: FeatureCollection["features"] = [{ type: "Feature", geometry: { type: "LineString", coordinates: o.shape }, properties: { kind: "full" } }];
  if (o.segment && o.segment.length >= 2) features.push({ type: "Feature", geometry: { type: "LineString", coordinates: o.segment }, properties: { kind: "segment" } });
  return { type: "FeatureCollection", features };
}

/** 畫 / 換 / 清掉公車路線圖層。style 重載(切主題)後要再呼叫一次。 */
export function setBusOverlay(map: maplibregl.Map, o: BusOverlay | null, theme: "light" | "dark") {
  for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id);
  for (const id of [SRC_LINE, SRC_STOPS]) if (map.getSource(id)) map.removeSource(id);
  if (!o) return;
  const halo = theme === "dark" ? "#111" : "#fff";
  // 深灰(暗色主題用淺灰):捷運已經用掉紅橘黃綠藍紫棕,公車用無彩色才分得出來
  const COLOR = theme === "dark" ? "#e5e7eb" : "#1f2937";
  map.addSource(SRC_LINE, { type: "geojson", data: lineGeoJSON(o) });
  map.addSource(SRC_STOPS, { type: "geojson", data: stopsGeoJSON(o) });
  map.addLayer({
    id: "bus-line-casing",
    type: "line",
    source: SRC_LINE,
    filter: ["==", ["get", "kind"], "full"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": halo, "line-width": 7, "line-opacity": 0.9 },
  });
  map.addLayer({
    id: "bus-line",
    type: "line",
    source: SRC_LINE,
    filter: ["==", ["get", "kind"], "full"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": COLOR, "line-width": 3.5, "line-opacity": o.segment ? 0.45 : 0.9 },
  });
  map.addLayer({
    id: "bus-segment",
    type: "line",
    source: SRC_LINE,
    filter: ["==", ["get", "kind"], "segment"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": COLOR, "line-width": 6 },
  });
  map.addLayer({
    id: "bus-stops",
    type: "circle",
    source: SRC_STOPS,
    paint: {
      "circle-radius": ["match", ["get", "role"], "stop", 3.5, 7],
      "circle-color": ["match", ["get", "role"], "board", "#059669", "alight", "#2563eb", halo],
      "circle-stroke-color": ["match", ["get", "role"], "stop", COLOR, halo],
      "circle-stroke-width": 2,
    },
  });
  map.addLayer({
    id: "bus-stop-names",
    type: "symbol",
    source: SRC_STOPS,
    // 上下車站一直顯示名字,其他站放大才顯示
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
