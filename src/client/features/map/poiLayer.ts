import type * as maplibregl from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import { useQueries } from "@tanstack/react-query";
import { POI_CATEGORIES, POI_CATS, POI_SUBTYPE_LABEL, isCrime, isNuisance, poiLabel, type PoiCat } from "@shared/poi";
import { api } from "@/lib/api";
import type { Theme } from "./basemap";
import type { Viewport } from "./heat";
import { POI_ICON, poiIconImage } from "./poiIcons";

/**
 * 地圖「生活機能」圖層:畫面範圍內選的幾類(/api/nearby/box,一類一個請求,各自快取)。
 * 只在放大到街區(zoom ≥ MIN_ZOOM)時查;每類一個圖示(poiIcons.tsx),名字在更近(zoom ≥ 16)才顯示。
 */
export const POI_LAYER_MIN_ZOOM = 14;
/** 圖層可選的類別:主要生活機能在前,其他生活機能,再來是點狀的嫌惡設施(道路、鐵道是線,不放) */
export const POI_LAYER_CATS: PoiCat[] = [
  ...POI_CATS.filter((c) => !isNuisance(c) && !isCrime(c) && POI_CATEGORIES[c].main),
  ...POI_CATS.filter((c) => !isNuisance(c) && !isCrime(c) && !POI_CATEGORIES[c].main),
  ...POI_CATS.filter((c) => isNuisance(c) && !(POI_CATEGORIES[c] as { line?: boolean }).line),
].filter((c) => POI_ICON[c]);

const COLORS = ["#0284c7", "#16a34a", "#ea580c", "#9333ea", "#e11d48", "#0d9488", "#ca8a04", "#db2777", "#4f46e5", "#65a30d"];
export const poiColor = (cat: PoiCat) => (isNuisance(cat) ? "#991b1b" : COLORS[POI_LAYER_CATS.indexOf(cat) % COLORS.length]!);

/** 畫面範圍內選的那幾類;沒選或還沒放大就不查 */
export function usePoiLayer(cats: PoiCat[], view: Viewport | null) {
  const zoomOk = !!view && view.zoom >= POI_LAYER_MIN_ZOOM;
  // 範圍取到小數 3 位當 key,地圖小幅移動不會一直重查
  const r = (x: number) => Math.round(x * 1000) / 1000;
  const box = view ? { w: r(view.w), s: r(view.s), e: r(view.e), n: r(view.n) } : null;
  const qs = useQueries({
    queries: cats.map((cat) => ({
      queryKey: ["poi-box", cat, box?.w, box?.s, box?.e, box?.n],
      queryFn: () => api.poiBox(box!, cat),
      enabled: zoomOk && !!box,
      staleTime: 10 * 60_000,
    })),
  });
  if (!cats.length) return { fc: null, note: null, loading: false };
  if (!zoomOk) return { fc: null, note: "放大到街區才畫生活機能", loading: false };
  if (qs.some((q) => q.data?.too_big)) return { fc: null, note: "放大一點才畫生活機能", loading: qs.some((q) => q.isFetching) };
  const done = qs.map((q, i) => ({ cat: cats[i]!, d: q.data })).filter((x) => x.d);
  const fc: FeatureCollection | null = done.length
    ? {
        type: "FeatureCollection",
        features: done.flatMap(({ cat, d }) =>
          d!.items.map((p) => ({
            type: "Feature" as const,
            geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
            properties: {
              cat,
              name: p.name ?? POI_SUBTYPE_LABEL[p.subtype ?? ""] ?? poiLabel(cat),
              note: p.note ?? "",
              // 垃圾車最重要的是幾點來:標籤直接放時間(note 是「16:30–16:40 · 一二四五六」)
              label: cat === "garbage" ? `${(p.note ?? "").split(" · ")[0]}${p.name ? `
${p.name}` : ""}` : (p.name ?? ""),
              garbage: cat === "garbage",
            },
          })),
        ),
      }
    : null;
  const note = done.length ? `畫面內 ${done.map(({ cat, d }) => `${poiLabel(cat)} ${d!.items.length}${d!.truncated ? "+" : ""}`).join("、")}` : null;
  return { fc, note, loading: qs.some((q) => q.isFetching) };
}

const SRC = "poi-layer";
const ICONS = "poi-layer-icon";
const LABEL = "poi-layer-label";
const LABEL_G = "poi-layer-label-garbage";
/** 點圖示跳說明用 */
export const POI_ICON_LAYER = "poi-layer-icon";
const imageId = (cat: PoiCat, theme: Theme) => `poi-${cat}-${theme}`;

/** 畫 / 換 / 清掉;style 重載(切主題)後要再呼叫一次。圖示圖片非同步產生,好了才畫 */
export async function setPoiLayer(map: maplibregl.Map, fc: FeatureCollection | null, theme: Theme) {
  if (!fc) {
    for (const id of [LABEL, LABEL_G, ICONS]) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(SRC)) map.removeSource(SRC);
    return;
  }
  const cats = [...new Set(fc.features.map((f) => f.properties!.cat as PoiCat))];
  const imgs = await Promise.all(cats.map(async (c) => [c, await poiIconImage(c, poiColor(c), theme === "dark")] as const));
  // 等圖示的時候樣式可能換過(切主題)或圖層被關掉:圖片照補,資料以呼叫當下的為準
  for (const [c, img] of imgs) if (img && !map.hasImage(imageId(c, theme))) map.addImage(imageId(c, theme), img, { pixelRatio: 2 });
  const src = map.getSource(SRC) as maplibregl.GeoJSONSource | undefined;
  if (src) {
    src.setData(fc);
    if (map.getLayer(ICONS)) map.setLayoutProperty(ICONS, "icon-image", ["concat", "poi-", ["get", "cat"], `-${theme}`]);
    return;
  }
  map.addSource(SRC, { type: "geojson", data: fc });
  map.addLayer({
    id: ICONS,
    type: "symbol",
    source: SRC,
    layout: {
      "icon-image": ["concat", "poi-", ["get", "cat"], `-${theme}`],
      "icon-size": ["interpolate", ["linear"], ["zoom"], 14, 0.75, 17, 1],
      "icon-allow-overlap": true,
    },
  });
  // 名字:一般地點 zoom 16 才標;垃圾車 15 就標(標的是時間)
  for (const [id, minzoom, garbage] of [
    [LABEL, 16, false],
    [LABEL_G, 15, true],
  ] as const)
    map.addLayer({
      id,
      type: "symbol",
      source: SRC,
      minzoom,
      filter: ["==", ["get", "garbage"], garbage],
      layout: { "text-field": ["get", "label"], "text-size": 11, "text-offset": [0, 1.2], "text-anchor": "top", "text-max-width": 9, "text-optional": true },
      paint: {
        "text-color": theme === "dark" ? "#e5e5e5" : "#262626",
        "text-halo-color": theme === "dark" ? "#0a0a0a" : "#ffffff",
        "text-halo-width": 1.2,
      },
    });
}
