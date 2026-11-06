import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "@/features/map/maplibreWorker";
import type { FeatureCollection } from "geojson";
import { localizeBasemap, STYLE } from "@/features/map/basemap";
import { overlayPoints, setBusOverlay } from "@/features/map/busLayer";
import { useTheme } from "@/lib/useTheme";
import { api } from "@/lib/api";
import type { BusRouteDetail } from "@shared/bus";
import type { Trip } from "@shared/trip";
import { tripOverlay } from "./tripOverlay";

type Pt = [number, number]; // [lng, lat]

export interface MapTrip {
  key: string;
  trip: Trip;
  color: string;
}

const SRC_ALL = "go-all";
const LAYER_ALL = ["go-all-casing", "go-all"];

/**
 * 「怎麼去」的地圖:所有搭法同時畫出來(各一色、半透明),選中的那條用完整樣式(公車沿線形、捷運線色、走路虛線、上下車點)。
 * 點地圖上的線 = 選那一種。機車 / 開車沒有路線形狀,不畫。
 */
export function TripsMap({ start, end, trips, selected, onSelect }: { start: Pt; end: Pt; trips: MapTrip[]; selected: string | null; onSelect: (key: string) => void }) {
  const { theme } = useTheme();
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // 公車段要線形才畫得沿路(跟面板共用快取)
  const busKeys = useMemo(() => [...new Set(trips.flatMap((t) => t.trip.legs.flatMap((l) => (l.mode === "bus" ? [l.key] : []))))], [trips]);
  const shapes = useQueries({ queries: busKeys.map((k) => ({ queryKey: ["bus-route", k], queryFn: () => api.busRoute(k), staleTime: 60 * 60_000 })) });
  const shapesReady = shapes.map((s) => s.data?.route.key ?? "").join("|");
  const shapeMap = useMemo(
    () => new Map<string, BusRouteDetail>(shapes.flatMap((s) => (s.data ? [[s.data.route.key, s.data] as const] : []))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shapesReady],
  );
  const overlays = useMemo(() => trips.map((t) => ({ ...t, o: tripOverlay(t.trip, start, end, shapeMap) })), [trips, start, end, shapeMap]);

  useEffect(() => {
    if (!ref.current) return;
    const map = new maplibregl.Map({
      container: ref.current,
      style: STYLE[theme],
      bounds: new maplibregl.LngLatBounds(start, start).extend(end),
      fitBoundsOptions: { padding: 40 },
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    new maplibregl.Marker({ color: "#059669" }).setLngLat(start).addTo(map);
    new maplibregl.Marker({ color: "#2563eb" }).setLngLat(end).addTo(map);
    map.on("load", () => {
      localizeBasemap(map);
      setReady(true);
    });
    map.on("click", (e) => {
      if (!map.getLayer("go-all")) return;
      const hit = map.queryRenderedFeatures([
        [e.point.x - 6, e.point.y - 6],
        [e.point.x + 6, e.point.y + 6],
      ], { layers: ["go-all"] })[0];
      const key = hit?.properties?.key;
      if (typeof key === "string") onSelectRef.current(key);
    });
    map.on("mouseenter", "go-all", () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", "go-all", () => (map.getCanvas().style.cursor = ""));
    return () => {
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
    // 起訖點換了就重建(主題在這頁不會變)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start[0], start[1], end[0], end[1]]);

  // 全部搭法(淡)+ 選中的(完整樣式)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    for (const id of LAYER_ALL) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(SRC_ALL)) map.removeSource(SRC_ALL);
    const data: FeatureCollection = {
      type: "FeatureCollection",
      features: overlays
        .filter((t) => t.key !== selected)
        .flatMap((t) =>
          t.o.lines
            .filter((l) => l.coords.length >= 2)
            .map((l) => ({ type: "Feature" as const, geometry: { type: "LineString" as const, coordinates: l.coords }, properties: { key: t.key, color: t.color, walk: l.kind === "walk" } })),
        ),
    };
    map.addSource(SRC_ALL, { type: "geojson", data });
    const halo = theme === "dark" ? "#111" : "#fff";
    map.addLayer({ id: "go-all-casing", type: "line", source: SRC_ALL, filter: ["!", ["get", "walk"]], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": halo, "line-width": 7, "line-opacity": 0.6 } });
    map.addLayer({
      id: "go-all",
      type: "line",
      source: SRC_ALL,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": ["get", "color"], "line-width": ["case", ["get", "walk"], 2.5, 4.5], "line-opacity": selected ? 0.45 : 0.85 },
    });
    const sel = overlays.find((t) => t.key === selected);
    setBusOverlay(map, sel ? sel.o : null, theme);
  }, [overlays, selected, ready, theme]);

  // 框進全部路線(換起訖或搭法數變了才重框,選來選去不跳)
  const fitKey = `${start}|${end}|${overlays.length}|${shapesReady}`;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const pts: Pt[] = [start, end, ...overlays.flatMap((t) => overlayPoints(t.o))];
    const b = pts.reduce((acc, p) => acc.extend(p), new maplibregl.LngLatBounds(start, start));
    map.fitBounds(b, { padding: 40, duration: 300, maxZoom: 16 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, ready]);

  return <div ref={ref} className="h-64 w-full overflow-hidden rounded border border-neutral-300 sm:h-80 dark:border-neutral-700" />;
}
