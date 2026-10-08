import type * as maplibregl from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import { useQuery } from "@tanstack/react-query";
import { POI_CATEGORIES, POI_CATS, POI_SUBTYPE_LABEL, isCrime, isNuisance, poiLabel, type PoiCat } from "@shared/poi";
import { api } from "@/lib/api";
import type { Theme } from "./basemap";
import type { Viewport } from "./heat";

/**
 * 地圖「生活機能」圖層:畫面範圍內某一類的點(/api/nearby/box)。只在放大到街區(zoom ≥ MIN_ZOOM)時查,
 * 名字在更近(zoom ≥ 16)才顯示,免得整片字疊在一起。選項:主要的生活機能 + 嫌惡設施(點狀的)。
 */
export const POI_LAYER_MIN_ZOOM = 14;
/** 圖層可選的類別:主要生活機能在前,其他生活機能,再來是點狀的嫌惡設施(道路、鐵道是線,不放) */
export const POI_LAYER_CATS: PoiCat[] = [
  ...POI_CATS.filter((c) => !isNuisance(c) && !isCrime(c) && POI_CATEGORIES[c].main),
  ...POI_CATS.filter((c) => !isNuisance(c) && !isCrime(c) && !POI_CATEGORIES[c].main),
  ...POI_CATS.filter((c) => isNuisance(c) && !(POI_CATEGORIES[c] as { line?: boolean }).line),
];

const COLORS = ["#0ea5e9", "#22c55e", "#f97316", "#a855f7", "#ef4444", "#14b8a6", "#eab308", "#ec4899", "#6366f1", "#84cc16"];
export const poiColor = (cat: PoiCat) => (isNuisance(cat) ? "#b91c1c" : COLORS[POI_LAYER_CATS.indexOf(cat) % COLORS.length]!);

/** 畫面範圍內某一類的點;沒選類別或還沒放大就不查 */
export function usePoiLayer(cat: PoiCat | null, view: Viewport | null) {
  const zoomOk = !!view && view.zoom >= POI_LAYER_MIN_ZOOM;
  // 範圍取到小數 3 位當 key,地圖小幅移動不會一直重查
  const r = (x: number) => Math.round(x * 1000) / 1000;
  const box = view ? { w: r(view.w), s: r(view.s), e: r(view.e), n: r(view.n) } : null;
  const q = useQuery({
    queryKey: ["poi-box", cat, box?.w, box?.s, box?.e, box?.n],
    queryFn: () => api.poiBox(box!, cat!),
    enabled: !!cat && zoomOk && !!box,
    staleTime: 10 * 60_000,
    placeholderData: (prev) => (prev?.cat === cat ? prev : undefined),
  });
  if (!cat) return { fc: null, note: null, loading: false };
  if (!zoomOk) return { fc: null, note: `放大到街區才畫${poiLabel(cat)}`, loading: false };
  const d = q.data;
  if (d?.too_big) return { fc: null, note: `放大一點才畫${poiLabel(cat)}`, loading: q.isFetching };
  const fc: FeatureCollection | null = d
    ? {
        type: "FeatureCollection",
        features: d.items.map((p) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [p.lng, p.lat] },
          properties: { name: p.name ?? POI_SUBTYPE_LABEL[p.subtype ?? ""] ?? "", note: p.note ?? "" },
        })),
      }
    : null;
  const note = d ? `畫面內 ${d.items.length}${d.truncated ? "+" : ""} 個${poiLabel(cat)}` : null;
  return { fc, note, loading: q.isFetching };
}

const SRC = "poi-layer";
const DOT = "poi-layer-dot";
const LABEL = "poi-layer-label";

/** 畫 / 換 / 清掉;style 重載(切主題)後要再呼叫一次。放在最上層(房源標記是 HTML,不受影響) */
export function setPoiLayer(map: maplibregl.Map, layer: { fc: FeatureCollection; color: string } | null, theme: Theme) {
  if (!layer) {
    for (const id of [LABEL, DOT]) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(SRC)) map.removeSource(SRC);
    return;
  }
  const src = map.getSource(SRC) as maplibregl.GeoJSONSource | undefined;
  if (src) {
    src.setData(layer.fc);
    if (map.getLayer(DOT)) map.setPaintProperty(DOT, "circle-color", layer.color);
    return;
  }
  map.addSource(SRC, { type: "geojson", data: layer.fc });
  map.addLayer({
    id: DOT,
    type: "circle",
    source: SRC,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 3.5, 17, 6],
      "circle-color": layer.color,
      "circle-stroke-width": 1.5,
      "circle-stroke-color": theme === "dark" ? "#0a0a0a" : "#ffffff",
    },
  });
  map.addLayer({
    id: LABEL,
    type: "symbol",
    source: SRC,
    minzoom: 16,
    layout: { "text-field": ["get", "name"], "text-size": 11, "text-offset": [0, 0.9], "text-anchor": "top", "text-max-width": 8, "text-optional": true },
    paint: {
      "text-color": theme === "dark" ? "#e5e5e5" : "#262626",
      "text-halo-color": theme === "dark" ? "#0a0a0a" : "#ffffff",
      "text-halo-width": 1.2,
    },
  });
}
