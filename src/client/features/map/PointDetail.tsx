import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPin, X } from "lucide-react";
import type { PropertySummary } from "@shared/schemas";
import { haversine } from "@shared/bus";
import type { BusOverlay } from "@/features/map/busLayer";
import { CommuteSection } from "@/features/commute/CommuteSection";
import { NearbySection } from "@/features/nearby/NearbySection";
import { HazardSection } from "@/features/hazard/HazardSection";
import { BusSection } from "@/features/bus/BusSection";
import { CrimeSection } from "@/features/crime/CrimeSection";
import { reverseGeocode } from "@/features/places/geocode";
import { PointMarketSection } from "@/features/market/MarketSection";
import { SaveNote } from "@/features/report/SaveNote";
import { normalizeCity } from "@shared/regions";
import { usePrivatePool } from "@/lib/useAuth";

export interface MapPoint {
  lat: number;
  lng: number;
}

const NEAR_M = 500;

/**
 * 地址即報告:搜尋地址、或地圖右鍵 / 長按任意一點,還沒有房源也能先看通勤、行情、生活機能、災害、治安、公車;
 * 覺得可以再「存成筆記」變成自己的房源。
 * 地址是瀏覽器直接問 Nominatim 反查(Worker 不抓外站);城市用來判斷液化有沒有資料、行情用哪個區。
 */
export function PointDetail({
  point,
  items,
  onClose,
  onSelect,
  onBusOverlay,
}: {
  point: MapPoint;
  /** 目前篩選後的房源,列出附近的 */
  items: PropertySummary[];
  onClose: () => void;
  onSelect: (id: number) => void;
  onBusOverlay?: (o: BusOverlay | null) => void;
}) {
  const { lat, lng } = point;
  const addr = useQuery({
    queryKey: ["reverse", lat.toFixed(5), lng.toFixed(5)],
    queryFn: () => reverseGeocode(lat, lng),
    staleTime: Infinity,
    retry: false,
  });
  const near = useMemo(
    () =>
      items
        .flatMap((p) => (p.lat != null && p.lng != null ? [{ p, m: Math.round(haversine(lat, lng, p.lat, p.lng)) }] : []))
        .filter((x) => x.m <= NEAR_M)
        .sort((a, b) => a.m - b.m),
    [items, lat, lng],
  );
  const rents = near.flatMap((x) => (x.p.rent != null ? [x.p.rent] : [])).sort((a, b) => a - b);
  const median = rents.length ? rents[Math.floor(rents.length / 2)]! : null;
  const key = `${lat},${lng}`;
  // 公開版「附近的房源」只有自己的筆記,沒有就不顯示這塊
  const pool = usePrivatePool();
  const city = normalizeCity(addr.data?.city) ?? "";
  const district = addr.data?.district ?? "";

  return (
    <div className="grid gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1 text-xs text-neutral-500">
            <MapPin size={14} /> 地址報告
          </p>
          <h1 className="font-semibold leading-snug">{addr.data?.label || (addr.isLoading ? "查地址中…" : `${lat.toFixed(5)}, ${lng.toFixed(5)}`)}</h1>
        </div>
        <button onClick={onClose} className="shrink-0 rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label="關閉">
          <X size={16} />
        </button>
      </div>

      {addr.data && <SaveNote key={`s${key}`} lat={lat} lng={lng} addr={{ ...addr.data, city }} onSaved={onSelect} />}

      {city && district && <PointMarketSection key={`m${key}`} city={city} district={district} />}

      {(pool || near.length > 0) && (
        <section className="text-sm">
          <h2 className="mb-1 text-xs font-medium text-neutral-500">
            附近 {NEAR_M}m {pool ? "的房源" : "你存的"} · {near.length} 間{median != null && <> · 租金中位數 ${median.toLocaleString()}</>}
          </h2>
          {near.length > 0 && (
            <ul className="flex flex-wrap gap-1">
              {near.slice(0, 8).map(({ p, m }) => (
                <li key={p.id}>
                  <button
                    onClick={() => onSelect(p.id)}
                    className="rounded border border-neutral-200 px-1.5 py-0.5 text-xs hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
                    title={p.title}
                  >
                    {p.rent != null ? `$${p.rent.toLocaleString()}` : "—"}
                    <span className="ml-1 text-neutral-500">
                      {p.kind ?? ""} {m}m
                    </span>
                  </button>
                </li>
              ))}
              {near.length > 8 && <li className="self-center text-xs text-neutral-500">還有 {near.length - 8} 間</li>}
            </ul>
          )}
        </section>
      )}

      <CommuteSection key={`c${key}`} lat={lat} lng={lng} onOverlay={onBusOverlay} />
      <NearbySection key={`n${key}`} lat={lat} lng={lng} onOverlay={onBusOverlay} />
      {/* 等地址查完才知道城市(液化只有台北市有資料);查不到就當「沒有資料」,不要誤報「不在潛勢區」 */}
      {!addr.isLoading && <HazardSection key={`h${key}`} lat={lat} lng={lng} city={addr.data?.city || "?"} />}
      {addr.data?.city && <CrimeSection key={`cr${key}`} lat={lat} lng={lng} city={addr.data.city} district={addr.data.district} />}
      <BusSection key={`b${key}`} lat={lat} lng={lng} onOverlay={onBusOverlay} />
    </div>
  );
}
