import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "@/lib/api";
import { useTheme } from "@/lib/useTheme";
import { applyFilters, useFilters, worstCommute } from "@/lib/filters";
import { useCommute } from "@/features/commute/useCommute";
import { useAlong } from "@/features/bus/useAlong";
import { FIT_COLOR, useFit } from "@/features/fit/fit";
import { FilterBar } from "@/components/FilterBar";
import { MapView } from "@/features/map/MapView";
import { useMrt } from "@/features/map/mrt";
import { PropertyDetail } from "@/features/property/PropertyDetail";
import { PointDetail, type MapPoint } from "@/features/map/PointDetail";
import type { BusOverlay } from "@/features/map/busLayer";
import type { PropertySummary } from "@shared/schemas";
import { BottomSheet, type Snap } from "@/components/BottomSheet";
import { useNarrow } from "@/lib/useNarrow";
import { openPlacesDialog, usePlaces } from "@/features/places/places";
import { COMMUTE_LEGEND, commuteColor, HEAT_LABEL, HEAT_MODES, useHeat, type HeatMode, type Viewport } from "@/features/map/heat";
import { Layers } from "lucide-react";

const PANEL_W = 400;

/** 首頁:篩選列 + 地圖 + 點標記後左側詳細面板(手機改成下方抽屜) */
export function MapPage() {
  const { theme } = useTheme();
  const q = useQuery({ queryKey: ["properties"], queryFn: api.listProperties });
  const mrt = useMrt();
  const filters = useFilters();
  const [selectedId, setSelected] = useState<number | null>(null);
  // 右鍵 / 長按的點;和選中房源互斥
  const [point, setPoint] = useState<MapPoint | null>(null);
  const setSelectedId = useCallback((id: number | null) => {
    setSelected(id);
    setPoint(null);
  }, []);
  const pickPoint = useCallback((p: MapPoint) => {
    setSelected(null);
    setBusOverlay(null);
    setPoint(p);
    setSnap("half");
  }, []);
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
  const fit = useFit();
  const fitOf = fit.configured ? fit.fitOf : undefined;
  const items = useMemo(() => applyFilters(all, filters, commute.ctx, along.ids, fitOf), [all, filters, commute.ctx, along.ids, fitOf]);
  const [colorMode, setColorMode] = useColorMode();
  const modes: ColorMode[] = ["stage", ...(commute.places.length ? (["commute"] as const) : []), ...(fit.configured ? (["fit"] as const) : [])];
  const byCommute = colorMode === "commute" && commute.places.length > 0;
  const byFit = colorMode === "fit" && fit.configured;
  const colorOf = useMemo(() => {
    if (byCommute) return (p: PropertySummary) => commuteColor(worstCommute(p, filters, commute.ctx));
    if (byFit && fitOf) return (p: PropertySummary) => { const r = fitOf(p); return r ? FIT_COLOR[r.level] : undefined; };
    return undefined;
  }, [byCommute, byFit, fitOf, filters, commute.ctx]);
  const [heatMode, setHeatMode] = useHeatMode();
  const [view, setView] = useState<Viewport | null>(null);
  // 看區域圖層時標記會擋住,可以先藏起來(不記)
  const [hideMarkers, setHideMarkers] = useState(false);
  const shownOnMap = heatMode !== "none" && hideMarkers ? NO_ITEMS : items;
  const heat = useHeat(heatMode, view, items);
  const noCoords = items.filter((p) => p.lat == null || p.lng == null).length;
  const panelOpen = selectedId != null || point != null;
  const panel = (onOverlay: (o: BusOverlay | null) => void) =>
    point ? (
      <PointDetail point={point} items={items} onClose={() => setPoint(null)} onSelect={setSelectedId} onBusOverlay={onOverlay} />
    ) : selectedId != null ? (
      <PropertyDetail id={selectedId} onClose={() => setSelectedId(null)} onBusOverlay={onOverlay} />
    ) : null;

  const [layersOpen, setLayersOpen] = useState(false);
  const colorControls = modes.length > 1 && (
    <div className={BOX}>
      <div className="flex flex-wrap gap-1">
        <span className="self-center text-neutral-500">標記顏色</span>
        {modes.map((m) => (
          <button key={m} onClick={() => setColorMode(m)} className={chip(colorMode === m)}>
            {m === "stage" ? "找房狀態" : m === "commute" ? "通勤時間" : "需求符合度"}
          </button>
        ))}
      </div>
      {byFit && (
        <Legend
          items={[
            ["符合", FIT_COLOR.green],
            ["普通", FIT_COLOR.yellow],
            ["不符", FIT_COLOR.red],
          ]}
        />
      )}
      {byCommute && <Legend items={COMMUTE_LEGEND} />}
    </div>
  );
  const heatControls = (
  <div className={BOX}>
    <label className="flex items-center gap-1">
      <Layers size={13} className="text-neutral-500" />
      <span className="text-neutral-500">區域圖層</span>
      <select value={heatMode} onChange={(e) => setHeatMode(e.target.value as HeatMode)} className="rounded border border-neutral-200 bg-transparent px-1 py-0.5 dark:border-neutral-700">
        {HEAT_MODES.map((m) => (
          <option key={m} value={m}>
            {HEAT_LABEL[m]}
          </option>
        ))}
      </select>
      {heat.loading && <span className="text-neutral-400">計算中…</span>}
    </label>
    {heatMode !== "none" && (
      <label className="mt-1 flex items-center gap-1 text-neutral-600 dark:text-neutral-400">
        <input type="checkbox" checked={hideMarkers} onChange={(e) => setHideMarkers(e.target.checked)} /> 隱藏房源標記
      </label>
    )}
    {heat.legend.length > 0 && <Legend items={heat.legend} square />}
    {heat.note && <p className="mt-0.5 text-[11px] text-neutral-500">{heat.note}</p>}
  </div>
  );

  return (
    <div className="flex h-full flex-col">
      <FilterBar shown={items.length} total={all.length} />
      <div className="relative flex min-h-0 flex-1">
        {panelOpen && !narrow && (
          <aside className="absolute inset-y-0 left-0 z-10 w-[400px] overflow-auto border-r border-neutral-200 bg-white shadow-xl dark:border-neutral-800 dark:bg-neutral-900">
            {panel(setBusOverlay)}
          </aside>
        )}
        {panelOpen && narrow && (
          <BottomSheet snap={snap} onSnap={setSnap} onHeight={setSheetH}>
            {panel(onOverlayMobile)}
          </BottomSheet>
        )}
        <div className="relative min-w-0 flex-1">
          <MapView
            items={shownOnMap}
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
            onPoint={pickPoint}
            point={point}
            heat={heat.fc}
            onViewport={setView}
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
          {!panelOpen && (
            <div className="pointer-events-none absolute bottom-8 left-2 rounded bg-white/85 px-1.5 py-0.5 text-[11px] text-neutral-500 dark:bg-neutral-900/85">
              {narrow ? "長按" : "右鍵"}地圖任一點:看那裡的通勤、生活機能、災害
            </div>
          )}
          <div className="absolute top-3 left-3 z-[5] grid max-w-[min(20rem,calc(100%-4.5rem))] justify-items-start gap-1 text-xs">
            {noCoords > 0 && (
              <div className="rounded bg-amber-100 px-2 py-1 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                {noCoords} 間沒有座標,只在
                <Link to="/list" className="underline">
                  列表
                </Link>
                看得到
              </div>
            )}
            {narrow ? (
              <>
                <button
                  onClick={() => setLayersOpen(true)}
                  className="flex items-center gap-1 rounded-lg border border-neutral-200 bg-white/95 px-2.5 py-2 text-xs font-medium shadow-sm dark:border-neutral-800 dark:bg-neutral-900/95"
                  aria-haspopup="dialog"
                >
                  <Layers size={15} /> 圖層
                  {(heatMode !== "none" || colorMode !== "stage") && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
                </button>
                {/* 手機:開著的圖層只留圖例 */}
                {!layersOpen && (heat.legend.length > 0 || byCommute || byFit) && (
                  <div className={`${BOX} !py-1 text-[11px]`}>
                    {heat.legend.length > 0 ? (
                      <Legend items={heat.legend} square />
                    ) : (
                      <Legend items={byFit ? [["符合", FIT_COLOR.green], ["普通", FIT_COLOR.yellow], ["不符", FIT_COLOR.red]] : COMMUTE_LEGEND} />
                    )}
                  </div>
                )}
                {layersOpen && (
                  <div className="fixed inset-0 z-50 flex items-end bg-black/30" onClick={() => setLayersOpen(false)}>
                    <div
                      role="dialog"
                      aria-label="圖層"
                      className="grid w-full gap-2 rounded-t-2xl bg-white p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] text-sm shadow-xl dark:bg-neutral-900 [&>div]:border-0 [&>div]:p-0 [&>div]:shadow-none"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="mx-auto h-1 w-10 rounded-full bg-neutral-300 dark:bg-neutral-700" />
                      {colorControls}
                      {heatControls}
                      <button onClick={() => setLayersOpen(false)} className="btn-primary justify-center">
                        完成
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                {colorControls}
                {heatControls}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const NO_ITEMS: PropertySummary[] = [];
const BOX = "rounded-lg border border-neutral-200 bg-white/95 px-2 py-1.5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/95";
const chip = (on: boolean) =>
  `rounded px-1.5 py-0.5 ${on ? "bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`;

function Legend({ items, square = false }: { items: [string, string][]; square?: boolean }) {
  return (
    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
      {items.map(([label, c]) => (
        <span key={label} className="flex items-center gap-1">
          <span className={`h-2.5 w-2.5 ${square ? "rounded-sm opacity-70" : "rounded-full"}`} style={{ background: c }} />
          {label}
        </span>
      ))}
    </div>
  );
}

const HEAT_KEY = "rentmap.heatLayer";

/** 區域圖層:這台瀏覽器的偏好 */
function useHeatMode(): [HeatMode, (m: HeatMode) => void] {
  const [mode, setMode] = useState<HeatMode>(() => {
    try {
      const v = localStorage.getItem(HEAT_KEY) as HeatMode | null;
      return v && (HEAT_MODES as readonly string[]).includes(v) ? v : "none";
    } catch {
      return "none";
    }
  });
  return [
    mode,
    (m) => {
      setMode(m);
      try {
        localStorage.setItem(HEAT_KEY, m);
      } catch {
        /* 私密模式,忽略 */
      }
    },
  ];
}

type ColorMode = "stage" | "commute" | "fit";
const COLOR_KEY = "rentmap.markerColor";

/** 標記上色方式:這台瀏覽器的偏好 */
function useColorMode(): [ColorMode, (m: ColorMode) => void] {
  const [mode, setMode] = useState<ColorMode>(() => {
    try {
      const v = localStorage.getItem(COLOR_KEY);
      return v === "commute" || v === "fit" ? v : "stage";
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
