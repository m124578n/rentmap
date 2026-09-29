import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "@/lib/api";
import { useTheme } from "@/lib/useTheme";
import { applyFilters, useFilters, worstCommute } from "@/lib/filters";
import { useCommute } from "@/features/commute/useCommute";
import { useAlong } from "@/features/bus/useAlong";
import { FilterBar } from "@/components/FilterBar";
import { MapView } from "@/features/map/MapView";
import { useMrt } from "@/features/map/mrt";
import { PropertyDetail } from "@/features/property/PropertyDetail";
import type { BusOverlay } from "@/features/map/busLayer";
import type { PropertySummary } from "@shared/schemas";
import { BottomSheet, type Snap } from "@/components/BottomSheet";
import { useNarrow } from "@/lib/useNarrow";
import { openPlacesDialog, usePlaces } from "@/features/places/places";

const PANEL_W = 400;

/** 首頁:篩選列 + 地圖 + 點標記後左側詳細面板(手機改成下方抽屜) */
export function MapPage() {
  const { theme } = useTheme();
  const q = useQuery({ queryKey: ["properties"], queryFn: api.listProperties });
  const mrt = useMrt();
  const filters = useFilters();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [busOverlay, setBusOverlay] = useState<BusOverlay | null>(null);
  const narrow = useNarrow();
  const [snap, setSnap] = useState<Snap>("half");
  const [sheetH, setSheetH] = useState(0);
  // 手機:選了路線 / 行程就把抽屜縮到露一點,讓出地圖
  const onOverlayMobile = useCallback((o: BusOverlay | null) => {
    setBusOverlay(o);
    if (o) setSnap("peek");
  }, []);
  // 換一間房就回到一半高
  useEffect(() => {
    if (selectedId != null) setSnap("half");
  }, [selectedId]);
  const places = usePlaces();
  const all = q.data?.items ?? [];
  const commute = useCommute();
  const along = useAlong();
  const items = useMemo(() => applyFilters(all, filters, commute.ctx, along.ids), [all, filters, commute.ctx, along.ids]);
  const [colorMode, setColorMode] = useColorMode();
  const byCommute = colorMode === "commute" && commute.places.length > 0;
  const colorOf = useMemo(
    () => (byCommute ? (p: PropertySummary) => commuteColor(worstCommute(p, filters, commute.ctx)) : undefined),
    [byCommute, filters, commute.ctx],
  );
  const noCoords = items.filter((p) => p.lat == null || p.lng == null).length;
  const panelOpen = selectedId != null;

  return (
    <div className="flex h-full flex-col">
      <FilterBar shown={items.length} total={all.length} />
      <div className="relative flex min-h-0 flex-1">
        {panelOpen && !narrow && (
          <aside className="absolute inset-y-0 left-0 z-10 w-[400px] overflow-auto border-r border-neutral-200 bg-white shadow-xl dark:border-neutral-800 dark:bg-neutral-900">
            <PropertyDetail id={selectedId} onClose={() => setSelectedId(null)} onBusOverlay={setBusOverlay} />
          </aside>
        )}
        {panelOpen && narrow && (
          <BottomSheet snap={snap} onSnap={setSnap} onHeight={setSheetH}>
            <PropertyDetail id={selectedId} onClose={() => setSelectedId(null)} onBusOverlay={onOverlayMobile} />
          </BottomSheet>
        )}
        <div className="relative min-w-0 flex-1">
          <MapView
            items={items}
            selectedId={selectedId}
            onSelect={setSelectedId}
            theme={theme}
            mrt={mrt.data ?? null}
            padLeft={panelOpen && !narrow ? PANEL_W : 0}
            padBottom={panelOpen && narrow ? sheetH : 0}
            busOverlay={busOverlay}
            places={places.data?.items ?? []}
            onPlaceClick={openPlacesDialog}
            colorOf={colorOf}
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
          {commute.places.length > 0 && (
            <div className={`absolute left-3 z-[5] rounded-lg border border-neutral-200 bg-white/95 px-2 py-1.5 text-xs shadow-sm dark:border-neutral-800 dark:bg-neutral-900/95 ${noCoords > 0 ? "top-10" : "top-3"}`}>
              <div className="flex gap-1">
                <span className="self-center text-neutral-500">標記顏色</span>
                {(["stage", "commute"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setColorMode(m)}
                    className={`rounded px-1.5 py-0.5 ${colorMode === m ? "bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
                  >
                    {m === "stage" ? "找房狀態" : "通勤時間"}
                  </button>
                ))}
              </div>
              {byCommute && (
                <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                  {COMMUTE_LEGEND.map(([label, c]) => (
                    <span key={label} className="flex items-center gap-1">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />
                      {label}
                    </span>
                  ))}
                </div>
              )}
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

// ---- 標記依通勤上色 ----

const COMMUTE_LEGEND: [string, string][] = [
  ["≤20 分", "#059669"],
  ["≤30", "#65a30d"],
  ["≤45", "#d97706"],
  [">45", "#dc2626"],
  ["搭不到", "#9ca3af"],
];

/** 最久那個地點的通勤分鐘 → 顏色;undefined(還在算)用預設 */
function commuteColor(min: number | null | undefined): string | undefined {
  if (min === undefined) return undefined;
  if (min === null) return "#9ca3af";
  return min <= 20 ? "#059669" : min <= 30 ? "#65a30d" : min <= 45 ? "#d97706" : "#dc2626";
}

type ColorMode = "stage" | "commute";
const COLOR_KEY = "rentmap.markerColor";

/** 標記上色方式:這台瀏覽器的偏好 */
function useColorMode(): [ColorMode, (m: ColorMode) => void] {
  const [mode, setMode] = useState<ColorMode>(() => {
    try {
      return localStorage.getItem(COLOR_KEY) === "commute" ? "commute" : "stage";
    } catch {
      return "stage";
    }
  });
  return [
    mode,
    (m) => {
      setMode(m);
      try {
        localStorage.setItem(COLOR_KEY, m);
      } catch {
        /* 私密模式,忽略 */
      }
    },
  ];
}
