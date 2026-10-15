import type * as maplibregl from "maplibre-gl";
import type { Feature, FeatureCollection } from "geojson";
import { RING_COLOR, type ZonesResponse } from "@shared/zones";
import type { Theme } from "@/features/map/basemap";

/**
 * 落腳圈畫在地圖上:每圈一個顏色的色塊(格子拼起來)+ 每圈的外框線(第一圈的框包住第一圈、第二圈的框包住一二圈…),
 * 圈內的車站畫成小圓點、放大才標站名。
 */
const FILL_SRC = "zones-fill";
const LINE_SRC = "zones-line";
const ST_SRC = "zones-stations";
const LAYERS = ["zones-fill", "zones-line", "zones-st", "zones-st-name"];

function build(d: ZonesResponse) {
  const { step, step_lng: sl } = d;
  const idx = (c: [number, number, number, number]) => [Math.round(c[0] / step - 0.5), Math.round(c[1] / sl - 0.5)] as const;
  const ringOf = new Map<string, number>();
  for (const c of d.cells) {
    const [iy, ix] = idx(c);
    ringOf.set(`${iy}:${ix}`, c[2]);
  }
  const fill: Feature[] = d.cells.map((c) => {
    const [iy, ix] = idx(c);
    const [s, n, w, e] = [iy * step, (iy + 1) * step, ix * sl, (ix + 1) * sl];
    return { type: "Feature", geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] }, properties: { color: RING_COLOR[c[2]] ?? "#999" } };
  });
  // 外框:第 k 圈的範圍 = 圈號 ≤ k 的格子;相鄰格子不在範圍內的那一邊就是框
  const lines: Feature[] = d.rings.map((_, k) => {
    const segs: [number, number][][] = [];
    const inK = (iy: number, ix: number) => {
      const r = ringOf.get(`${iy}:${ix}`);
      return r != null && r <= k;
    };
    for (const [key, r] of ringOf) {
      if (r > k) continue;
      const [iy, ix] = key.split(":").map(Number) as [number, number];
      const [s, n, w, e] = [iy * step, (iy + 1) * step, ix * sl, (ix + 1) * sl];
      if (!inK(iy - 1, ix)) segs.push([[w, s], [e, s]]);
      if (!inK(iy + 1, ix)) segs.push([[w, n], [e, n]]);
      if (!inK(iy, ix - 1)) segs.push([[w, s], [w, n]]);
      if (!inK(iy, ix + 1)) segs.push([[e, s], [e, n]]);
    }
    return { type: "Feature", geometry: { type: "MultiLineString", coordinates: segs }, properties: { color: RING_COLOR[k] ?? "#999", ring: k } };
  });
  const st: Feature[] = d.stations.map((s) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [s.lng, s.lat] },
    properties: { name: `${s.rail === "tra" ? "台鐵" : ""}${s.name} ${s.min}分`, color: RING_COLOR[s.ring] ?? "#999" },
  }));
  const fc = (features: Feature[]): FeatureCollection => ({ type: "FeatureCollection", features });
  return { fill: fc(fill), line: fc(lines.reverse()), st: fc(st) };
}

/** 畫 / 換 / 清掉;style 重載(切主題)後要再呼叫一次。放在捷運底下,不擋線與站名 */
export function setZones(map: maplibregl.Map, d: ZonesResponse | null, theme: Theme) {
  if (!d || !d.cells.length) {
    for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id);
    for (const id of [FILL_SRC, LINE_SRC, ST_SRC]) if (map.getSource(id)) map.removeSource(id);
    return;
  }
  const g = build(d);
  const fillSrc = map.getSource(FILL_SRC) as maplibregl.GeoJSONSource | undefined;
  if (fillSrc) {
    fillSrc.setData(g.fill);
    (map.getSource(LINE_SRC) as maplibregl.GeoJSONSource).setData(g.line);
    (map.getSource(ST_SRC) as maplibregl.GeoJSONSource).setData(g.st);
    return;
  }
  const before = map.getLayer("mrt-lines-casing") ? "mrt-lines-casing" : undefined;
  map.addSource(FILL_SRC, { type: "geojson", data: g.fill });
  map.addSource(LINE_SRC, { type: "geojson", data: g.line });
  map.addSource(ST_SRC, { type: "geojson", data: g.st });
  map.addLayer({ id: "zones-fill", type: "fill", source: FILL_SRC, paint: { "fill-color": ["get", "color"], "fill-opacity": 0.22, "fill-antialias": false } }, before);
  map.addLayer({
    id: "zones-line",
    type: "line",
    source: LINE_SRC,
    paint: { "line-color": ["get", "color"], "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.5, 14, 2.5], "line-opacity": 0.9 },
  });
  map.addLayer({
    id: "zones-st",
    type: "circle",
    source: ST_SRC,
    minzoom: 11,
    paint: { "circle-radius": 4, "circle-color": theme === "dark" ? "#0a0a0a" : "#ffffff", "circle-stroke-color": ["get", "color"], "circle-stroke-width": 2.5 },
  });
  map.addLayer({
    id: "zones-st-name",
    type: "symbol",
    source: ST_SRC,
    minzoom: 13,
    layout: { "text-field": ["get", "name"], "text-size": 11, "text-offset": [0, 1], "text-anchor": "top", "text-optional": true },
    paint: { "text-color": theme === "dark" ? "#e5e5e5" : "#262626", "text-halo-color": theme === "dark" ? "#0a0a0a" : "#ffffff", "text-halo-width": 1.2 },
  });
}
