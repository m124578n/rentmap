import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ExternalLink, X } from "lucide-react";
import { api } from "@/lib/api";
import { useTheme } from "@/lib/useTheme";
import { MapView } from "@/features/map/MapView";
import { useMrt } from "@/features/map/mrt";
import { SOURCE_LABEL, STAGE_LABEL, type Source, type Stage } from "@shared/constants";

/** 首頁:地圖 + 點標記後的摘要卡 */
export function MapPage() {
  const { theme } = useTheme();
  const q = useQuery({ queryKey: ["properties"], queryFn: api.listProperties });
  const mrt = useMrt();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const items = q.data?.items ?? [];
  const selected = items.find((p) => p.id === selectedId) ?? null;
  const noCoords = items.filter((p) => p.lat == null || p.lng == null).length;

  return (
    <div className="relative h-full w-full">
      <MapView items={items} selectedId={selectedId} onSelect={setSelectedId} theme={theme} mrt={mrt.data ?? null} />

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

      {selected && (
        <aside className="card absolute right-3 bottom-3 left-3 max-h-[45%] overflow-auto shadow-lg sm:left-auto sm:w-80">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-lg font-semibold text-emerald-700 dark:text-emerald-400">{selected.rent != null ? `$${selected.rent.toLocaleString()}` : "—"}</div>
              <h2 className="font-medium">{selected.title}</h2>
            </div>
            <button onClick={() => setSelectedId(null)} className="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label="關閉">
              <X size={16} />
            </button>
          </div>
          <p className="mt-1 text-sm text-neutral-500">
            {selected.city}
            {selected.district}
            {selected.road ? ` ${selected.road}` : ""}
          </p>
          <p className="mt-1 flex flex-wrap gap-x-3 text-sm text-neutral-600 dark:text-neutral-400">
            {selected.size_ping != null && <span>{selected.size_ping} 坪</span>}
            {selected.rooms != null && <span>{selected.rooms} 房</span>}
            {selected.floor != null && (
              <span>
                {selected.floor}
                {selected.total_floors != null ? `/${selected.total_floors}` : ""}F
              </span>
            )}
            {selected.has_elevator != null && <span>{selected.has_elevator ? "有電梯" : "無電梯"}</span>}
            {selected.mgmt_fee != null && <span>管理費 {selected.mgmt_fee}</span>}
          </p>
          <p className="mt-2 flex gap-2 text-xs">
            {selected.stage && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">{STAGE_LABEL[selected.stage as Stage] ?? selected.stage}</span>}
            {selected.source && <span className="rounded bg-neutral-100 px-1.5 py-0.5 dark:bg-neutral-800">{SOURCE_LABEL[selected.source as Source] ?? selected.source}</span>}
          </p>
          <div className="mt-3 flex gap-2">
            <Link to="/p/$id" params={{ id: String(selected.id) }} className="btn-primary">
              詳細
            </Link>
            {selected.source_url && (
              <a href={selected.source_url} target="_blank" rel="noreferrer" className="btn-ghost">
                原始連結 <ExternalLink size={14} />
              </a>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
