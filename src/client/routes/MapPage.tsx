import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "@/lib/api";
import { useTheme } from "@/lib/useTheme";
import { useRegion } from "@/lib/region";
import { usePrivatePool } from "@/lib/useAuth";
import { applyFilters, useFilters, worstCommute } from "@/lib/filters";
import { useCommute } from "@/features/commute/useCommute";
import { useAlong } from "@/features/bus/useAlong";
import { FIT_COLOR, useFit } from "@/features/fit/fit";
import { FilterBar } from "@/components/FilterBar";
import { MapView } from "@/features/map/MapView";
import { useMrt } from "@/features/map/mrt";
import { PropertyDetail } from "@/features/property/PropertyDetail";
import { PointDetail, type MapPoint } from "@/features/map/PointDetail";
import { AddressSearch } from "@/features/report/AddressSearch";
import { RegionPicker } from "@/features/report/RegionPicker";
import type { BusOverlay } from "@/features/map/busLayer";
import type { PropertySummary } from "@shared/schemas";
import { regionBbox } from "@shared/regions";
import { BottomSheet, type Snap } from "@/components/BottomSheet";
import { useNarrow } from "@/lib/useNarrow";
import { openPlacesDialog, usePlaces } from "@/features/places/places";
import { COMMUTE_LEGEND, commuteColor, HEAT_LABEL, HEAT_MODES, useHeat, type HeatMode, type HeatResult, type Viewport } from "@/features/map/heat";
import { Layers, Store } from "lucide-react";
import { POI_LAYER_CATS, poiColor, usePoiLayer } from "@/features/map/poiLayer";
import { POI_ICON } from "@/features/map/poiIcons";
import { MultiPick } from "@/components/MultiPick";
import { poiLabel, type PoiCat } from "@shared/poi";

const PANEL_W = 400;

/** 首頁:篩選列 + 地圖 + 點標記後左側詳細面板(手機改成下方抽屜) */
export function MapPage() {
  const { theme } = useTheme();
  const region = useRegion();
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
  const [storedHeats, setHeatModes] = useStoredList<HeatMode>(HEAT_KEY, HEAT_LAYERS, "rentmap.heatLayer");
  // 每坪開價圖層靠共用房源池,公開版沒有(記住的選擇有 rent 就略過)
  const pool = usePrivatePool();
  const heatModes = storedHeats.filter((m) => m !== "rent" || pool);
  const [view, setView] = useState<Viewport | null>(null);
  // 看區域圖層時標記會擋住,可以先藏起來(不記)
  const [hideMarkers, setHideMarkers] = useState(false);
  const shownOnMap = heatModes.length > 0 && hideMarkers ? NO_ITEMS : items;
  const heatsAll = useHeats(heatModes, view, items);
  const heatsShown = useMemo(() => heatsAll.flatMap((h) => (h.fc ? [{ id: h.mode, fc: h.fc }] : [])), [heatsAll]);
  const firstLegend = heatsAll.find((h) => h.legend.length > 0)?.legend ?? [];
  const [poiCats, setPoiCats] = useStoredList<PoiCat>(POI_KEY, POI_LAYER_CATS, "rentmap.poiLayer");
  const poi = usePoiLayer(poiCats, view);
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
        <span className="self-center text-neutral-500 dark:text-neutral-300">標記顏色</span>
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
      <MultiPick
        label="區域圖層"
        icon={<Layers size={13} className="text-neutral-500 dark:text-neutral-300" />}
        options={HEAT_LAYERS.filter((m) => m !== "rent" || pool).map((m) => ({ value: m, label: HEAT_LABEL[m] }))}
        value={heatModes}
        onChange={setHeatModes}
      />
      {heatsAll.some((h) => h.loading) && <p className="text-[11px] text-neutral-400">計算中…</p>}
      {heatModes.length > 0 && (
        <label className="mt-1 flex items-center gap-1 text-neutral-600 dark:text-neutral-400">
          <input type="checkbox" checked={hideMarkers} onChange={(e) => setHideMarkers(e.target.checked)} /> 隱藏房源標記
        </label>
      )}
      {heatsAll.map((h) => (
        <div key={h.mode} className="mt-1">
          {heatsAll.length > 1 && <p className="text-[11px] font-medium text-neutral-600 dark:text-neutral-300">{HEAT_LABEL[h.mode]}</p>}
          {h.legend.length > 0 && <Legend items={h.legend} square />}
          {h.note && <p className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">{h.note}</p>}
        </div>
      ))}
      <div className="mt-1.5">
        <MultiPick
          label="生活機能"
          icon={<Store size={13} className="text-neutral-500 dark:text-neutral-300" />}
          options={POI_LAYER_CATS.map((c) => {
            const Icon = POI_ICON[c]!;
            return {
              value: c,
              label: poiLabel(c),
              icon: (
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-white" style={{ background: poiColor(c) }}>
                  <Icon size={10} strokeWidth={2.5} />
                </span>
              ),
            };
          })}
          value={poiCats}
          onChange={setPoiCats}
        />
      </div>
      {poi.loading && <p className="text-[11px] text-neutral-400">載入中…</p>}
      {poi.note && <p className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">{poi.note}</p>}
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
            view={region.view}
            fitWithin={regionBbox(region.key)}
            heats={heatsShown}
            poiLayer={poi.fc}
            onViewport={setView}
          />

          {q.isSuccess && all.length === 0 && !panelOpen && (
            <div className="card absolute bottom-16 left-1/2 w-[min(22rem,calc(100%-2rem))] -translate-x-1/2 text-sm text-neutral-600 dark:text-neutral-300">
              還沒有筆記。左上輸入地址、或{narrow ? "長按" : "右鍵"}地圖任一點,先看那裡的通勤、行情、機能、災害;覺得可以再「存成筆記」。
              <Link to="/new" className="ml-1 text-emerald-600 underline">
                也可以手動新增
              </Link>
              {pool && (
                <>
                  ,或在終端機 <code>npm run collect -- add &lt;591網址&gt;</code>
                </>
              )}
            </div>
          )}
          {!panelOpen && (
            <div className="pointer-events-none absolute bottom-8 left-2 rounded bg-white/85 px-1.5 py-0.5 text-[11px] text-neutral-500 dark:bg-neutral-900/85">
              {narrow ? "長按" : "右鍵"}地圖任一點:看那裡的通勤、生活機能、災害
            </div>
          )}
          {/* 桌機開著左側面板時,控制列往右移,搜尋框才不會被面板蓋住 */}
          <div
            className="absolute top-3 left-3 z-[5] grid max-w-[min(20rem,calc(100%-4.5rem))] justify-items-start gap-1 text-xs"
            style={panelOpen && !narrow ? { left: PANEL_W + 12 } : undefined}
          >
            <RegionPicker />
            <AddressSearch onPick={pickPoint} />
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
                  {(heatModes.length > 0 || poiCats.length > 0 || colorMode !== "stage") && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
                </button>
                {/* 手機:開著的圖層只留圖例 */}
                {!layersOpen && (firstLegend.length > 0 || byCommute || byFit) && (
                  <div className={`${BOX} !py-1 text-[11px]`}>
                    {firstLegend.length > 0 ? (
                      <Legend items={firstLegend} square />
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

const POI_KEY = "rentmap.poiLayers";
const HEAT_KEY = "rentmap.heatLayers";
/** 區域圖層可選的(不含「不顯示」) */
const HEAT_LAYERS = HEAT_MODES.filter((m): m is Exclude<HeatMode, "none"> => m !== "none");

/** 多選的偏好(這台瀏覽器;JSON 陣列)。legacyKey 是以前單選時存的,讀到就轉過來 */
function useStoredList<T extends string>(key: string, allowed: readonly string[], legacyKey?: string): [T[], (v: T[]) => void] {
  const [list, setList] = useState<T[]>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return (JSON.parse(raw) as string[]).filter((x): x is T => allowed.includes(x));
      const old = legacyKey ? localStorage.getItem(legacyKey) : null;
      return old && allowed.includes(old) ? [old as T] : [];
    } catch {
      return [];
    }
  });
  return [
    list,
    (v) => {
      setList(v);
      try {
        localStorage.setItem(key, JSON.stringify(v));
      } catch {
        /* 私密模式,忽略 */
      }
    },
  ];
}

/**
 * 每個區域圖層各算一份。HEAT_LAYERS 是固定的清單,所以 hook 的呼叫次數每次都一樣(沒選的傳 "none",不會查資料)。
 */
function useHeats(modes: HeatMode[], view: Viewport | null, items: PropertySummary[]) {
  const out: (HeatResult & { mode: Exclude<HeatMode, "none"> })[] = [];
  for (const m of HEAT_LAYERS) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const r = useHeat(modes.includes(m) ? m : "none", view, items);
    if (modes.includes(m)) out.push({ ...r, mode: m });
  }
  return out;
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
