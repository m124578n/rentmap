import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "@/lib/api";
import { useTheme } from "@/lib/useTheme";
import { MapView } from "@/features/map/MapView";
import { useMrt } from "@/features/map/mrt";
import { PropertyDetail } from "@/features/property/PropertyDetail";

const PANEL_W = 400;

/** 首頁:地圖 + 點標記後左側詳細面板(手機改成下方抽屜) */
export function MapPage() {
  const { theme } = useTheme();
  const q = useQuery({ queryKey: ["properties"], queryFn: api.listProperties });
  const mrt = useMrt();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const items = q.data?.items ?? [];
  const noCoords = items.filter((p) => p.lat == null || p.lng == null).length;
  const panelOpen = selectedId != null;

  return (
    <div className="relative flex h-full w-full">
      {panelOpen && (
        <aside
          className="absolute inset-x-0 bottom-0 z-10 max-h-[60%] overflow-auto border-t border-neutral-200 bg-white shadow-xl sm:inset-y-0 sm:right-auto sm:max-h-none sm:border-t-0 sm:border-r dark:border-neutral-800 dark:bg-neutral-900"
        >
          <div className="sm:w-[400px]">
            <PropertyDetail id={selectedId} onClose={() => setSelectedId(null)} />
          </div>
        </aside>
      )}
      <div className="relative min-w-0 flex-1">
        <MapView items={items} selectedId={selectedId} onSelect={setSelectedId} theme={theme} mrt={mrt.data ?? null} padLeft={panelOpen ? PANEL_W : 0} />

        {q.isSuccess && items.length === 0 && (
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
  );
}
