import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { PropertySummary } from "@shared/schemas";
import { localizeBasemap, STYLE, TW_BOUNDS, type Theme } from "./basemap";
import { addMrtLayers, type MrtData } from "./mrt";

interface Props {
  items: PropertySummary[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  theme: Theme;
  mrt: MrtData | null;
  /** 左側面板寬度(px),平移到選中標記時避開它;手機面板在下方,傳 0 */
  padLeft?: number;
}

/** 房源價格標記的顏色,依找房狀態 */
const STAGE_COLOR: Record<string, string> = {
  saved: "#059669",
  contacted: "#d97706",
  scheduled: "#d97706",
  visited: "#2563eb",
  considering: "#2563eb",
  finalist: "#7c3aed",
  rejected: "#9ca3af",
  signed: "#111827",
};

function priceLabel(rent: number | null) {
  if (rent == null) return "—";
  return rent >= 10000 ? `${(rent / 10000).toFixed(rent % 10000 === 0 ? 0 : 1)}萬` : `$${rent.toLocaleString()}`;
}

/**
 * 地圖:CARTO 底圖 + 捷運圖層 + 房源價格標記(HTML marker,幾百筆內夠用;之後量大再改 symbol layer + cluster)。
 * 只負責畫,選中狀態由父層管。
 */
export function MapView({ items, selectedId, onSelect, theme, mrt, padLeft = 0 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<number, { marker: maplibregl.Marker; el: HTMLButtonElement }>>(new Map());
  const fittedRef = useRef(false);
  const onSelectRef = useRef(onSelect);
  const mrtRef = useRef(mrt);
  const themeRef = useRef(theme);
  const padRef = useRef(padLeft);
  padRef.current = padLeft;
  onSelectRef.current = onSelect;
  mrtRef.current = mrt;
  themeRef.current = theme;

  // 初始化一次
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE[theme],
      bounds: TW_BOUNDS,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    if (import.meta.env.DEV) (window as unknown as { __map?: maplibregl.Map }).__map = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: false }), "top-right");
    map.on("load", () => {
      localizeBasemap(map);
      if (mrtRef.current) addMrtLayers(map, mrtRef.current, themeRef.current);
    });
    map.on("click", () => onSelectRef.current(null));
    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 主題切換:換底圖,styledata 後重套在地化與捷運圖層
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    map.setStyle(STYLE[theme]);
    map.once("styledata", () => {
      localizeBasemap(map);
      if (mrtRef.current) addMrtLayers(map, mrtRef.current, theme);
    });
  }, [theme]);

  // 捷運資料到了才加圖層
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mrt) return;
    if (map.isStyleLoaded()) addMrtLayers(map, mrt, theme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mrt]);

  // 房源標記:依 id 差異新增 / 更新 / 移除
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers = markersRef.current;
    const seen = new Set<number>();
    const bounds = new maplibregl.LngLatBounds();
    for (const p of items) {
      if (p.lat == null || p.lng == null) continue;
      seen.add(p.id);
      bounds.extend([p.lng, p.lat]);
      const color = STAGE_COLOR[p.stage ?? "saved"] ?? STAGE_COLOR.saved!;
      let entry = markers.get(p.id);
      if (!entry) {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "rh-marker";
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          onSelectRef.current(p.id);
        });
        const marker = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([p.lng, p.lat]).addTo(map);
        entry = { marker, el };
        markers.set(p.id, entry);
      } else {
        entry.marker.setLngLat([p.lng, p.lat]);
      }
      entry.el.textContent = priceLabel(p.rent);
      entry.el.title = p.title;
      entry.el.style.setProperty("--c", color);
      entry.el.classList.toggle("is-rejected", p.stage === "rejected");
    }
    for (const [id, entry] of markers) {
      if (!seen.has(id)) {
        entry.marker.remove();
        markers.delete(id);
      }
    }
    if (!fittedRef.current && seen.size > 0) {
      fittedRef.current = true;
      map.fitBounds(bounds, { padding: 80, maxZoom: 15, duration: 0 });
    }
  }, [items]);

  // 選中:標記高亮 + 平移過去
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const [id, entry] of markersRef.current) entry.el.classList.toggle("is-selected", id === selectedId);
    const p = items.find((x) => x.id === selectedId);
    if (p && p.lat != null && p.lng != null) {
      const narrow = window.innerWidth < 640;
      map.easeTo({
        center: [p.lng, p.lat],
        zoom: Math.max(map.getZoom(), 15),
        duration: 500,
        // 桌機:面板在左邊;手機:面板在下面(約 60% 高)
        padding: narrow ? { top: 0, bottom: Math.round(map.getContainer().clientHeight * 0.6), left: 0, right: 0 } : { top: 0, bottom: 0, left: padRef.current, right: 0 },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  return <div ref={containerRef} className="h-full w-full" />;
}
