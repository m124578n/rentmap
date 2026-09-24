import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "@/lib/api";
import { useTheme } from "@/lib/useTheme";
import { applyFilters, useFilters } from "@/lib/filters";
import { FilterBar } from "@/components/FilterBar";
import { MapView } from "@/features/map/MapView";
import { useMrt } from "@/features/map/mrt";
import { PropertyDetail } from "@/features/property/PropertyDetail";
import type { BusOverlay } from "@/features/map/busLayer";
import { setCommuteTarget, usePlaceMutations, usePlaces } from "@/features/bus/places";

const PANEL_W = 400;

/** 首頁:篩選列 + 地圖 + 點標記後左側詳細面板(手機改成下方抽屜) */
export function MapPage() {
  const { theme } = useTheme();
  const q = useQuery({ queryKey: ["properties"], queryFn: api.listProperties });
  const mrt = useMrt();
  const filters = useFilters();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [busOverlay, setBusOverlay] = useState<BusOverlay | null>(null);
  const places = usePlaces();
  const placeMut = usePlaceMutations();
  const all = q.data?.items ?? [];
  const items = useMemo(() => applyFilters(all, filters), [all, filters]);
  const noCoords = items.filter((p) => p.lat == null || p.lng == null).length;
  const panelOpen = selectedId != null;

  return (
    <div className="flex h-full flex-col">
      <FilterBar shown={items.length} total={all.length} />
      <div className="relative flex min-h-0 flex-1">
        {panelOpen && (
          <aside className="absolute inset-x-0 bottom-0 z-10 max-h-[60%] overflow-auto border-t border-neutral-200 bg-white shadow-xl sm:inset-y-0 sm:right-auto sm:max-h-none sm:border-t-0 sm:border-r dark:border-neutral-800 dark:bg-neutral-900">
            <div className="sm:w-[400px]">
              <PropertyDetail id={selectedId} onClose={() => setSelectedId(null)} onBusOverlay={setBusOverlay} />
            </div>
          </aside>
        )}
        <div className="relative min-w-0 flex-1">
          <MapView
            items={items}
            selectedId={selectedId}
            onSelect={setSelectedId}
            theme={theme}
            mrt={mrt.data ?? null}
            padLeft={panelOpen ? PANEL_W : 0}
            busOverlay={busOverlay}
            places={places.data?.items ?? []}
            onContextMenu={(pt) => {
              const name = prompt("把這裡存成「我的地點」(例如:公司),房源面板會算直達的公車", "公司")?.trim();
              if (!name) return;
              placeMut.create.mutate(
                { name: name.slice(0, 30), lat: pt.lat, lng: pt.lng },
                { onSuccess: ({ place }) => setCommuteTarget(place.id), onError: () => alert("存不進去(要在雙北範圍內)") },
              );
            }}
            onPlaceClick={(pl) => {
              if (confirm(`刪除我的地點「${pl.name}」?`)) placeMut.remove.mutate(pl.id);
            }}
          />

          {q.isSuccess && all.length === 0 && (
            <div className="card absolute top-3 left-1/2 -translate-x-1/2 text-sm text-neutral-600 dark:text-neutral-300">
              還沒有房源。
              <Link to="/new" className="ml-1 text-emerald-600 underline">
                手動新增
              </Link>
              ,或在終端機 <code>npm run collect -- add &lt;591網址&gt;</code>
            </div>
          )}
          {noCoords > 0 && (
            <div className="absolute top-3 left-3 rounded bg-amber-100 px-2 py-1 text-xs text-amber-800 dark:bg-amber-900 dark:text-amber-200">
              {noCoords} 間沒有座標,只在
              <Link to="/list" className="underline">
                列表
              </Link>
              看得到
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
