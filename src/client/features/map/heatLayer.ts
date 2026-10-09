import type * as maplibregl from "maplibre-gl";
import type { FeatureCollection } from "geojson";

/**
 * 區域圖層(通勤網格、每坪租金網格、災害多邊形):可以同時開好幾層,每層一個 source + fill(id 帶圖層名)。
 * 每個 feature 自帶 properties.color。疊越多越透明,底下的還看得出來。
 */
const PREFIX = "heat-";
const fillId = (id: string) => `${PREFIX}fill-${id}`;
const srcId = (id: string) => `${PREFIX}src-${id}`;

/** 畫 / 換 / 清掉;style 重載(切主題)後要再呼叫一次。放在捷運底下,不擋線與站名 */
export function setHeats(map: maplibregl.Map, layers: { id: string; fc: FeatureCollection }[]) {
  const want = new Set(layers.map((l) => l.id));
  // 關掉的拿掉
  for (const l of map.getStyle()?.layers ?? []) {
    if (!l.id.startsWith(`${PREFIX}fill-`)) continue;
    const id = l.id.slice(`${PREFIX}fill-`.length);
    if (want.has(id)) continue;
    map.removeLayer(l.id);
    if (map.getSource(srcId(id))) map.removeSource(srcId(id));
  }
  const opacity = layers.length > 1 ? 0.3 : 0.4;
  const before = map.getLayer("mrt-lines-casing") ? "mrt-lines-casing" : undefined;
  for (const { id, fc } of layers) {
    const src = map.getSource(srcId(id)) as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData(fc);
      map.setPaintProperty(fillId(id), "fill-opacity", opacity);
      continue;
    }
    map.addSource(srcId(id), { type: "geojson", data: fc });
    map.addLayer({ id: fillId(id), type: "fill", source: srcId(id), paint: { "fill-color": ["get", "color"], "fill-opacity": opacity, "fill-antialias": false } }, before);
  }
}
