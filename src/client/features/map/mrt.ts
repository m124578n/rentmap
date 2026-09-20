import { useQuery } from "@tanstack/react-query";
import type * as maplibregl from "maplibre-gl";
import type { FeatureCollection } from "geojson";

/** public/mrt.json(從 menmap 複製,只留雙北路線) */
export interface MrtData {
  lines: { code: string; name: string; color: string; geometry: number[][][] }[];
  stations: { id: string; name: string; en: string | null; lines: string[]; refs: string[]; lat: number; lng: number }[];
}

export function useMrt() {
  return useQuery({
    queryKey: ["mrt"],
    queryFn: async () => (await fetch("/mrt.json")).json() as Promise<MrtData>,
    staleTime: Infinity,
  });
}

const LINES_SRC = "mrt-lines";
const STATIONS_SRC = "mrt-stations";

function linesGeoJSON(mrt: MrtData): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: mrt.lines.map((l) => ({
      type: "Feature",
      geometry: { type: "MultiLineString", coordinates: l.geometry },
      properties: { code: l.code, color: l.color },
    })),
  };
}

function stationsGeoJSON(mrt: MrtData): FeatureCollection {
  const colorOf = new Map(mrt.lines.map((l) => [l.code, l.color]));
  return {
    type: "FeatureCollection",
    features: mrt.stations.map((s) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [s.lng, s.lat] },
      properties: { name: s.name, color: colorOf.get(s.lines[0]!) ?? "#888", transfer: s.lines.length > 1 },
    })),
  };
}

/** 捷運路線(z≥11)與站點(z≥12,z≥13.5 帶站名)。style 重載後要再呼叫一次。 */
export function addMrtLayers(map: maplibregl.Map, mrt: MrtData, theme: "light" | "dark") {
  if (map.getSource(LINES_SRC)) return;
  const halo = theme === "dark" ? "#111" : "#fff";
  map.addSource(LINES_SRC, { type: "geojson", data: linesGeoJSON(mrt) });
  map.addLayer({
    id: "mrt-lines-casing",
    type: "line",
    source: LINES_SRC,
    minzoom: 11,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": halo, "line-width": ["interpolate", ["linear"], ["zoom"], 11, 3, 14, 5.5, 17, 9], "line-opacity": 0.9 },
  });
  map.addLayer({
    id: "mrt-lines",
    type: "line",
    source: LINES_SRC,
    minzoom: 11,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": ["get", "color"], "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1.5, 14, 3, 17, 5], "line-opacity": 0.85 },
  });
  map.addSource(STATIONS_SRC, { type: "geojson", data: stationsGeoJSON(mrt) });
  map.addLayer({
    id: "mrt-stations",
    type: "circle",
    source: STATIONS_SRC,
    minzoom: 12,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, ["case", ["get", "transfer"], 4.5, 3], 16, ["case", ["get", "transfer"], 7, 5.5]],
      "circle-color": halo,
      "circle-stroke-color": ["case", ["get", "transfer"], theme === "dark" ? "#eee" : "#333", ["get", "color"]],
      "circle-stroke-width": 2,
    },
  });
  map.addLayer({
    id: "mrt-station-names",
    type: "symbol",
    source: STATIONS_SRC,
    minzoom: 13.5,
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Open Sans Semibold", "Noto Sans Regular"],
      "text-size": 11,
      "text-anchor": "top",
      "text-offset": [0, 0.9],
      "text-optional": true,
    },
    paint: { "text-color": theme === "dark" ? "#ddd" : "#333", "text-halo-color": halo, "text-halo-width": 1.3 },
  });
}
