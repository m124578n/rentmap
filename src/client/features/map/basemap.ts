import type * as maplibregl from "maplibre-gl";

/** CARTO 免金鑰向量底圖(與 menmap 相同)。條款:端側快取不得超過 30 天。 */
export const STYLE = {
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
} as const;
export type Theme = keyof typeof STYLE;

/** 雙北大致範圍 */
export const TW_BOUNDS: [[number, number], [number, number]] = [
  [121.28, 24.88],
  [121.75, 25.22],
];

/**
 * 底圖標籤在地化(搬自 menmap)。CARTO 樣式的地名在中低縮放用拼音,且會畫出 OSM 的鄰里名,對本地使用者是雜訊:
 * - 地名、水名一律用中文(name:zh → name)
 * - 鄰里(place_hamlet)關掉;村落(place_villages)放到很大才顯示
 * - 區(place_suburbs)字放大、放大到街道等級也留著當定位
 * 換主題會重載樣式,所以 load 與 styledata 後都要再套一次。
 */
export function localizeBasemap(map: maplibregl.Map) {
  const zh: maplibregl.ExpressionSpecification = ["coalesce", ["get", "name:zh"], ["get", "name"]];
  for (const layer of map.getStyle().layers ?? []) {
    if (layer.type !== "symbol") continue;
    const srcLayer = (layer as maplibregl.SymbolLayerSpecification)["source-layer"];
    if (srcLayer !== "place" && srcLayer !== "water_name" && srcLayer !== "waterway") continue;
    map.setLayoutProperty(layer.id, "text-field", zh);
  }
  if (map.getLayer("place_hamlet")) map.setLayoutProperty("place_hamlet", "visibility", "none");
  if (map.getLayer("place_villages")) map.setLayerZoomRange("place_villages", 14, 16);
  if (map.getLayer("place_suburbs")) {
    map.setLayerZoomRange("place_suburbs", 12, 18);
    map.setLayoutProperty("place_suburbs", "text-size", ["interpolate", ["linear"], ["zoom"], 12, 13, 15, 16]);
  }
}
