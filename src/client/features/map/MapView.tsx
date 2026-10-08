import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./maplibreWorker";
import type { Place, PropertySummary } from "@shared/schemas";
import { localizeBasemap, STYLE, type Theme } from "./basemap";
import { addMrtLayers, type MrtData } from "./mrt";
import { overlayPoints, setBusOverlay, type BusOverlay } from "./busLayer";
import { setHeat } from "./heatLayer";
import { PriceMarkers } from "./priceMarkers";
import type { Viewport } from "./heat";
import type { FeatureCollection } from "geojson";

interface Props {
  items: PropertySummary[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  theme: Theme;
  mrt: MrtData | null;
  /** 左側面板寬度(px),平移到選中標記時避開它;手機面板在下方,傳 0 */
  padLeft?: number;
  /** 手機底部抽屜高度(px),平移 / 框選時避開 */
  padBottom?: number;
  /** 面板選中的公車路線 */
  busOverlay?: BusOverlay | null;
  /** 我的地點(公司…) */
  places?: Place[];
  onPlaceClick?: (p: Place) => void;
  /** 有給就用它決定標記顏色(例如依通勤時間),回 undefined 用預設(找房狀態) */
  colorOf?: (p: PropertySummary) => string | undefined;
  /** 右鍵 / 長按任意一點(「看附近」) */
  onPoint?: (p: { lat: number; lng: number }) => void;
  /** 「看附近」的點,畫一根圖釘 */
  point?: { lat: number; lng: number } | null;
  /** 一開始看的範圍(生活圈的都會核心);換生活圈時地圖跟著移過去 */
  view: [[number, number], [number, number]];
  /** 第一次框畫面只看這個範圍內的房源 [w, s, e, n](目前的生活圈);範圍內沒有房源就停在 view */
  fitWithin?: [number, number, number, number];
  /** 區域圖層(通勤網格、災害多邊形…) */
  heat?: FeatureCollection | null;
  /** 畫面移動結束(區域圖層依範圍抓資料) */
  onViewport?: (v: Viewport) => void;
}

/**
 * style 好了就做,否則等 idle 再做。maplibre v6 的 isStyleLoaded() 在任何 source(捷運、圖層)還在載入時也是 false,
 * 直接略過的話資料晚到就永遠畫不上去。fn 要能重複呼叫(load / 換主題也會畫)。回傳取消。
 */
function whenReady(map: maplibregl.Map, fn: () => void): (() => void) | undefined {
  if (map.isStyleLoaded()) {
    fn();
    return;
  }
  const run = () => {
    if (map.isStyleLoaded()) fn();
  };
  map.once("idle", run);
  return () => {
    map.off("idle", run);
  };
}

/**
 * 地圖:CARTO 底圖 + 捷運圖層 + 房源價格標記(HTML,縮小時群集,見 priceMarkers.ts)。
 * 只負責畫,選中狀態由父層管。
 */
export function MapView({ items, selectedId, onSelect, theme, mrt, padLeft = 0, padBottom = 0, busOverlay = null, places = [], onPlaceClick, colorOf, onPoint, point = null, heat = null, onViewport, view, fitWithin }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const priceRef = useRef<PriceMarkers | null>(null);
  const fittedRef = useRef(false);
  const onSelectRef = useRef(onSelect);
  const mrtRef = useRef(mrt);
  const themeRef = useRef(theme);
  const padRef = useRef(padLeft);
  const padBottomRef = useRef(padBottom);
  padBottomRef.current = padBottom;
  const busRef = useRef(busOverlay);
  const placeClickRef = useRef(onPlaceClick);
  const placeMarkersRef = useRef<maplibregl.Marker[]>([]);
  const onPointRef = useRef(onPoint);
  onPointRef.current = onPoint;
  const pointMarkerRef = useRef<maplibregl.Marker | null>(null);
  const heatRef = useRef(heat);
  heatRef.current = heat;
  const onViewportRef = useRef(onViewport);
  onViewportRef.current = onViewport;
  padRef.current = padLeft;
  busRef.current = busOverlay;
  placeClickRef.current = onPlaceClick;
  onSelectRef.current = onSelect;
  mrtRef.current = mrt;
  themeRef.current = theme;

  // 初始化一次
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE[theme],
      bounds: view,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    if (import.meta.env.DEV) (window as unknown as { __map?: maplibregl.Map }).__map = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: false }), "top-right");
    const emitView = () => {
      const b = map.getBounds();
      onViewportRef.current?.({ w: b.getWest(), s: b.getSouth(), e: b.getEast(), n: b.getNorth(), zoom: map.getZoom() });
    };
    priceRef.current = new PriceMarkers(map, (id) => onSelectRef.current(id));
    map.on("load", () => {
      localizeBasemap(map);
      priceRef.current?.attach();
      if (mrtRef.current) addMrtLayers(map, mrtRef.current, themeRef.current);
      if (heatRef.current) setHeat(map, heatRef.current);
      if (busRef.current) setBusOverlay(map, busRef.current, themeRef.current);
      emitView();
    });
    map.on("moveend", emitView);
    map.on("click", () => onSelectRef.current(null));
    // 看附近:桌機右鍵;手機長按(maplibre 在觸控上不一定發 contextmenu,自己計時,手指一動就取消)
    const pick = (ll: maplibregl.LngLat) => onPointRef.current?.({ lat: Math.round(ll.lat * 1e6) / 1e6, lng: Math.round(ll.lng * 1e6) / 1e6 });
    let press: ReturnType<typeof setTimeout> | null = null;
    let pressed = false;
    const cancel = () => {
      if (press) clearTimeout(press);
      press = null;
    };
    map.on("contextmenu", (e) => {
      e.preventDefault();
      if (pressed) return; // 長按已經處理過
      pick(e.lngLat);
    });
    map.on("touchstart", (e) => {
      cancel();
      pressed = false;
      if (e.points.length !== 1) return;
      press = setTimeout(() => {
        pressed = true;
        pick(e.lngLat);
      }, 550);
    });
    map.on("touchend", cancel);
    map.on("touchcancel", cancel);
    map.on("movestart", cancel);

    return () => {
      map.remove();
      mapRef.current = null;
      priceRef.current = null;
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
      priceRef.current?.attach();
      if (mrtRef.current) addMrtLayers(map, mrtRef.current, theme);
      if (heatRef.current) setHeat(map, heatRef.current);
      if (busRef.current) setBusOverlay(map, busRef.current, theme);
    });
  }, [theme]);

  // 換生活圈:移到那一區(第一次由初始化的 bounds 處理)
  const viewKey = view.flat().join(",");
  const firstView = useRef(true);
  useEffect(() => {
    if (firstView.current) {
      firstView.current = false;
      return;
    }
    mapRef.current?.fitBounds(view, { duration: 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey]);

  // 區域圖層
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    return whenReady(map, () => setHeat(map, heatRef.current));
  }, [heat]);

  // 捷運資料到了才加圖層
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mrt) return;
    return whenReady(map, () => addMrtLayers(map, mrt, themeRef.current));
  }, [mrt]);

  // 公車路線:畫上去並把整條(通勤模式是上下車那段)框進畫面
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    setBusOverlay(map, busOverlay, themeRef.current);
    const pts = busOverlay ? overlayPoints(busOverlay) : null;
    if (!pts || pts.length < 2) return;
    const b = new maplibregl.LngLatBounds();
    for (const p of pts) b.extend(p);
    const narrow = window.innerWidth < 640;
    map.fitBounds(b, {
      padding: narrow ? { top: 40, bottom: padBottomRef.current + 20, left: 30, right: 30 } : { top: 60, bottom: 60, left: padRef.current + 60, right: 60 },
      maxZoom: 16,
      duration: 500,
    });
  }, [busOverlay]);

  // 我的地點:少少幾個,每次重建
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const m of placeMarkersRef.current) m.remove();
    placeMarkersRef.current = places.map((p) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "rh-place";
      el.textContent = p.name;
      el.title = `${p.name}(點一下修改)`;
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        placeClickRef.current?.(p);
      });
      return new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([p.lng, p.lat]).addTo(map);
    });
  }, [places]);

  // 看附近的圖釘
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    pointMarkerRef.current?.remove();
    pointMarkerRef.current = null;
    if (!point) return;
    pointMarkerRef.current = new maplibregl.Marker({ color: "#2563eb" }).setLngLat([point.lng, point.lat]).addTo(map);
    const narrow = window.innerWidth < 640;
    map.easeTo({
      center: [point.lng, point.lat],
      zoom: Math.max(map.getZoom(), 15),
      duration: 500,
      padding: narrow ? { top: 0, bottom: padBottomRef.current, left: 0, right: 0 } : { top: 0, bottom: 0, left: padRef.current, right: 0 },
    });
  }, [point]);

  // 房源標記:外觀照舊,縮小時群集(priceMarkers.ts)
  useEffect(() => {
    const map = mapRef.current;
    const pm = priceRef.current;
    if (!map || !pm) return;
    pm.setItems(items, colorOf);
    const cancel = whenReady(map, () => pm.attach());
    if (!fittedRef.current) {
      const bounds = new maplibregl.LngLatBounds();
      // 只框目前生活圈裡的房源(別的生活圈、舊資料裡座標是 (0, 0) 的都不算),不然會被拉到別的城市甚至全世界
      const [w, so, e, n] = fitWithin ?? [118, 21, 123, 26.5];
      for (const p of items) if (p.lat != null && p.lng != null && p.lat >= so && p.lat <= n && p.lng >= w && p.lng <= e) bounds.extend([p.lng, p.lat]);
      if (!bounds.isEmpty()) {
        fittedRef.current = true;
        map.fitBounds(bounds, { padding: 80, maxZoom: 15, duration: 0 });
      }
    }
    return cancel;
  }, [items, colorOf]);

  // 選中:標記高亮 + 平移過去
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    priceRef.current?.setSelected(selectedId);
    const p = items.find((x) => x.id === selectedId);
    if (p && p.lat != null && p.lng != null) {
      const narrow = window.innerWidth < 640;
      map.easeTo({
        center: [p.lng, p.lat],
        zoom: Math.max(map.getZoom(), 15),
        duration: 500,
        // 桌機:面板在左邊;手機:面板在下面(約 60% 高)
        padding: narrow ? { top: 0, bottom: padBottomRef.current, left: 0, right: 0 } : { top: 0, bottom: 0, left: padRef.current, right: 0 },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  return <div ref={containerRef} className="h-full w-full" />;
}
