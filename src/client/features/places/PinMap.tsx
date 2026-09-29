import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { localizeBasemap, STYLE, TW_BOUNDS } from "@/features/map/basemap";
import { useTheme } from "@/lib/useTheme";

interface Props {
  /** 目前圖釘位置;null = 還沒放(地圖顯示雙北,點一下放圖釘) */
  value: { lat: number; lng: number } | null;
  onChange: (p: { lat: number; lng: number }) => void;
}

/** 小地圖 + 可拖曳的圖釘:地址搜尋的結果常只到路段,讓使用者自己對到門口。點地圖也會把圖釘移過去。 */
export function PinMap({ value, onChange }: Props) {
  const { theme } = useTheme();
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!ref.current) return;
    const map = new maplibregl.Map({
      container: ref.current,
      style: STYLE[theme],
      ...(value ? { center: [value.lng, value.lat] as [number, number], zoom: 16.5 } : { bounds: TW_BOUNDS }),
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => localizeBasemap(map));
    map.on("click", (e) => onChangeRef.current({ lat: e.lngLat.lat, lng: e.lngLat.lng }));
    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // 主題在對話框開著時不會變,只建一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !value) return;
    if (!markerRef.current) {
      markerRef.current = new maplibregl.Marker({ color: "#1d4ed8", draggable: true }).setLngLat([value.lng, value.lat]).addTo(map);
      markerRef.current.on("dragend", () => {
        const p = markerRef.current!.getLngLat();
        onChangeRef.current({ lat: p.lat, lng: p.lng });
      });
    } else {
      markerRef.current.setLngLat([value.lng, value.lat]);
    }
    if (!map.getBounds().contains([value.lng, value.lat]) || map.getZoom() < 14) map.easeTo({ center: [value.lng, value.lat], zoom: 16.5, duration: 400 });
  }, [value]);

  return <div ref={ref} className="h-64 w-full overflow-hidden rounded border border-neutral-300 dark:border-neutral-700" />;
}
