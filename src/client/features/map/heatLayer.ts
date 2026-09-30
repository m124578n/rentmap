import type * as maplibregl from "maplibre-gl";
import type { FeatureCollection } from "geojson";

/** 區域圖層(通勤網格、每坪租金網格、災害多邊形):每個 feature 自帶 properties.color */
const SRC = "heat";
const FILL = "heat-fill";

/** 畫 / 換 / 清掉;style 重載(切主題)後要再呼叫一次。放在捷運底下,不擋線與站名 */
export function setHeat(map: maplibregl.Map, fc: FeatureCollection | null) {
  if (!fc) {
    for (const id of [FILL]) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(SRC)) map.removeSource(SRC);
    return;
  }
  const src = map.getSource(SRC) as maplibregl.GeoJSONSource | undefined;
  if (src) {
    src.setData(fc);
    return;
  }
  map.addSource(SRC, { type: "geojson", data: fc });
  const before = map.getLayer("mrt-lines-casing") ? "mrt-lines-casing" : undefined;
  map.addLayer({ id: FILL, type: "fill", source: SRC, paint: { "fill-color": ["get", "color"], "fill-opacity": 0.4, "fill-antialias": false } }, before);
}
