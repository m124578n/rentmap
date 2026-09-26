import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bus, ChevronDown, ChevronUp } from "lucide-react";
import { api } from "@/lib/api";
import {
  BUS_M_PER_MIN,
  DAY_LABEL,
  DAY_TYPES,
  dayTypeOf,
  fmtHeadway,
  fmtMin,
  haversine,
  toMin,
  type BusRouteDetail,
  type CommuteOption,
  type DaySummary,
  type DayType,
  type NearbyRoute,
} from "@shared/bus";
import type { BusOverlay } from "@/features/map/busLayer";
import { openPlacesDialog, useCommuteTarget, usePlaces } from "@/features/places/places";

interface Props {
  lat: number;
  lng: number;
  /** 地圖頁才有:把選中的路線畫到地圖上 */
  onOverlay?: (o: BusOverlay | null) => void;
}

/** 選中的路線方向:從哪站上車、(通勤)在哪站下車 */
interface Pick {
  key: string;
  boardSeq: number;
  alightSeq?: number;
}

const BADGES_SHOWN = 16;

/**
 * 房源面板的「公車」區塊:
 *   通勤 → 選了目的地(我的地點)就列出直達的路線,依「走路 + 等車 + 坐車 + 走路」排序
 *   附近路線 → 徽章,點了看方向、班距、預估經過時刻,地圖畫整條路線
 */
export function BusSection({ lat, lng, onOverlay }: Props) {
  const [radius, setRadius] = useState(400);
  const places = usePlaces();
  const [targetId, setTarget] = useCommuteTarget();
  const target = places.data?.items.find((p) => p.id === targetId) ?? null;
  const q = useQuery({
    queryKey: ["bus-nearby", lat, lng, radius, target?.id ?? null, target?.lat, target?.lng],
    queryFn: () => api.busNearby({ lat, lng, radius, to: target }),
    staleTime: 10 * 60_000,
  });
  const [pick, setPick] = useState<Pick | null>(null);
  const [openRoute, setOpenRoute] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  // 關掉面板 / 換房源 → 清掉地圖上的路線
  useEffect(() => () => onOverlay?.(null), [onOverlay]);
  useEffect(() => {
    if (!pick) onOverlay?.(null);
  }, [pick, onOverlay]);

  const routes = q.data?.routes ?? [];
  const shown = showAll ? routes : routes.slice(0, BADGES_SHOWN);
  const open = routes.find((r) => r.name === openRoute) ?? null;

  return (
    <section className="text-sm">
      <div className="mb-1.5 flex items-center justify-between">
        <h2 className="flex items-center gap-1 text-xs font-medium text-neutral-500">
          <Bus size={14} /> 公車
          {q.data && q.data.has_data && <span>· {radius}m 內 {routes.length} 條</span>}
        </h2>
        <div className="flex gap-1">
          {[400, 800].map((r) => (
            <button
              key={r}
              onClick={() => setRadius(r)}
              className={`rounded px-1.5 py-0.5 text-xs ${radius === r ? "bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900" : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
            >
              {r}m
            </button>
          ))}
        </div>
      </div>

      {q.isLoading && <p className="text-neutral-500">載入中…</p>}
      {q.error && <p className="text-red-600">公車資料載入失敗</p>}
      {q.data && !q.data.has_data && (
        <p className="rounded bg-neutral-100 px-2 py-1.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
          還沒有公車資料。在家裡跑 <code>npm run collect -- bus</code>(從 TDX 下載雙北路線、站牌、班表)。
        </p>
      )}

      {q.data?.has_data && (
        <div className="grid gap-3">
          <Commute
            options={q.data.commute}
            places={places.data?.items ?? []}
            targetId={target?.id ?? null}
            setTarget={(id) => {
              setTarget(id);
              setPick(null);
            }}
            pick={pick}
            setPick={setPick}
            radius={radius}
            onOverlay={onOverlay}
          />

          {routes.length === 0 ? (
            <p className="text-neutral-500">{radius}m 內沒有公車站{radius < 800 ? ",試試 800m" : ""}</p>
          ) : (
            <div>
              <div className="flex flex-wrap gap-1">
                {shown.map((r) => (
                  <button
                    key={r.name}
                    onClick={() => {
                      const next = openRoute === r.name ? null : r.name;
                      setOpenRoute(next);
                      const d = r.dirs[0]!;
                      setPick(next ? { key: d.key, boardSeq: d.stop.seq } : null);
                    }}
                    title={`${r.dirs[0]!.stop.name} · 走 ${r.dirs[0]!.stop.walk_min} 分`}
                    className={`rounded border px-1.5 py-0.5 text-xs font-semibold tabular-nums ${
                      openRoute === r.name
                        ? "border-neutral-800 bg-neutral-800 text-white dark:border-neutral-200 dark:bg-neutral-200 dark:text-neutral-900"
                        : "border-neutral-300 hover:border-neutral-500 dark:border-neutral-700"
                    }`}
                  >
                    {r.name}
                    <span className="ml-1 font-normal opacity-60">{r.dirs[0]!.stop.walk_min}′</span>
                  </button>
                ))}
                {routes.length > BADGES_SHOWN && (
                  <button onClick={() => setShowAll(!showAll)} className="px-1 text-xs text-neutral-500 underline">
                    {showAll ? "收起" : `還有 ${routes.length - BADGES_SHOWN} 條`}
                  </button>
                )}
              </div>
              <p className="mt-1 text-[11px] text-neutral-400">數字′ = 走到最近站牌的分鐘</p>
              {open && <RouteCard route={open} pick={pick} setPick={setPick} onOverlay={onOverlay} />}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ---- 通勤 ----

function Commute({
  options,
  places,
  targetId,
  setTarget,
  pick,
  setPick,
  radius,
  onOverlay,
}: {
  options: CommuteOption[] | null;
  places: { id: number; name: string }[];
  targetId: number | null;
  setTarget: (id: number | null) => void;
  pick: Pick | null;
  setPick: (p: Pick | null) => void;
  radius: number;
  onOverlay?: (o: BusOverlay | null) => void;
}) {
  if (places.length === 0) {
    return (
      <div className="rounded border border-blue-200 bg-blue-50 p-2.5 text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200">
        <p>看通勤要先設定公司地址:設好後這裡會列出直達的公車、要坐多久。</p>
        <button onClick={openPlacesDialog} className="mt-2 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
          輸入公司地址
        </button>
      </div>
    );
  }
  const target = places.find((p) => p.id === targetId);
  return (
    <div className="rounded border border-blue-200 p-2 dark:border-blue-900">
      <div className="flex flex-wrap items-center gap-1 text-xs">
        <span className="text-neutral-500">通勤到</span>
        {places.map((p) => (
          <button
            key={p.id}
            onClick={() => setTarget(targetId === p.id ? null : p.id)}
            className={`rounded-full px-2 py-0.5 ${targetId === p.id ? "bg-blue-600 text-white" : "bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700"}`}
          >
            {p.name}
          </button>
        ))}
        <button onClick={openPlacesDialog} className="ml-auto text-neutral-500 underline">
          管理
        </button>
      </div>
      {target && options && options.length === 0 && (
        <p className="mt-1.5 text-xs text-neutral-500">
          {radius}m 內沒有直達「{target.name}」的公車(目的地那頭找 500m 內的站)。{radius < 800 ? "試試 800m。" : ""}
        </p>
      )}
      {target && options && options.length > 0 && (
        <ul className="mt-1.5 grid gap-1">
          {options.map((o) => {
            const active = pick?.key === o.key && pick.alightSeq === o.alight.seq;
            return (
              <li key={o.key}>
                <button
                  onClick={() => setPick(active ? null : { key: o.key, boardSeq: o.board.seq, alightSeq: o.alight.seq })}
                  className={`w-full rounded px-1.5 py-1 text-left ${active ? "bg-blue-50 dark:bg-blue-950" : "hover:bg-neutral-50 dark:hover:bg-neutral-800"}`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span>
                      <b>{o.name}</b>
                      {o.to_name && <span className="ml-1 text-xs text-neutral-500">往{o.to_name}</span>}
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">約 {o.total_min} 分</span>
                  </div>
                  <div className="text-xs text-neutral-600 dark:text-neutral-400">
                    走 {o.board.walk_min} 分 → {o.board.name} 上車 · {o.stops} 站{o.ride_exact ? "" : "約"} {o.ride_min} 分 → {o.alight.name} 下車 · 走{" "}
                    {o.alight.walk_min} 分
                  </div>
                  <div className="text-[11px] text-neutral-400">
                    {headwayLine(o.wd)} · 等車抓 {o.wait_min} 分
                  </div>
                </button>
                {active && <RouteTimes pick={pick!} onOverlay={onOverlay} />}
              </li>
            );
          })}
        </ul>
      )}
      {target && <p className="mt-1 text-[11px] text-neutral-400">只算直達(不轉乘);坐車時間有班表用班表,沒有用距離估。</p>}
    </div>
  );
}

// ---- 附近路線 ----

function RouteCard({ route, pick, setPick, onOverlay }: { route: NearbyRoute; pick: Pick | null; setPick: (p: Pick | null) => void; onOverlay?: (o: BusOverlay | null) => void }) {
  const dir = route.dirs.find((d) => d.key === pick?.key) ?? route.dirs[0]!;
  return (
    <div className="mt-2 rounded border border-neutral-300 p-2 dark:border-neutral-700">
      <div className="flex flex-wrap gap-1">
        {route.dirs.map((d) => (
          <button
            key={d.key}
            onClick={() => setPick({ key: d.key, boardSeq: d.stop.seq })}
            className={`rounded-full px-2 py-0.5 text-xs ${d.key === dir.key ? "bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900" : "bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700"}`}
          >
            往 {d.to_name ?? "?"}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-xs">
        走 {dir.stop.walk_min} 分({dir.stop.distance_m}m)到 <b>{dir.stop.name}</b>
      </p>
      <p className="text-[11px] text-neutral-500">{headwayLine(dir.wd)}</p>
      {pick && pick.key === dir.key && <RouteTimes pick={pick} onOverlay={onOverlay} />}
    </div>
  );
}

function headwayLine(s: DaySummary | null) {
  if (!s) return "沒有班表資料";
  const parts = [s.first && s.last ? `平日 ${s.first}–${s.last}` : null];
  if (s.peak) parts.push(`尖峰每 ${fmtHeadway(s.peak)}`);
  if (s.offpeak) parts.push(`離峰每 ${fmtHeadway(s.offpeak)}`);
  if (s.trips != null) parts.push(`共 ${s.trips} 班`);
  return parts.filter(Boolean).join(" · ");
}

/** 選中的路線方向:畫地圖、列這站的預估經過時刻 / 班距、全部站 */
function RouteTimes({ pick, onOverlay }: { pick: Pick; onOverlay?: (o: BusOverlay | null) => void }) {
  const q = useQuery({ queryKey: ["bus-route", pick.key], queryFn: () => api.busRoute(pick.key), staleTime: 60 * 60_000 });
  const [day, setDay] = useState<DayType>(() => dayTypeOf(new Date()));
  const [allTimes, setAllTimes] = useState(false);
  const [allStops, setAllStops] = useState(false);

  useEffect(() => {
    if (q.data && onOverlay) onOverlay(overlayOf(q.data, pick));
  }, [q.data, pick, onOverlay]);

  const info = useMemo(() => (q.data ? timesAt(q.data, pick.boardSeq, day) : null), [q.data, pick.boardSeq, day]);
  if (q.isLoading) return <p className="mt-1 text-xs text-neutral-500">載入路線…</p>;
  if (!q.data || !info) return null;
  const { route, stops } = q.data;
  const board = stops.find((s) => s.seq === pick.boardSeq);
  const alight = pick.alightSeq != null ? stops.find((s) => s.seq === pick.alightSeq) : undefined;
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const isToday = day === dayTypeOf(new Date());
  const upcoming = isToday && info.times ? info.times.filter((t) => t >= nowMin).slice(0, 4) : [];

  return (
    <div className="mt-2 grid gap-1.5 rounded bg-neutral-50 p-2 text-xs dark:bg-neutral-800/60">
      <div className="flex items-center justify-between">
        <span className="text-neutral-500">
          {route.from_name} → {route.to_name} · {stops.length} 站 · {(route.length_m / 1000).toFixed(1)} km
        </span>
        <select value={day} onChange={(e) => setDay(e.target.value as DayType)} className="rounded border border-neutral-300 bg-transparent px-1 dark:border-neutral-600">
          {DAY_TYPES.map((d) => (
            <option key={d} value={d}>
              {DAY_LABEL[d]}
            </option>
          ))}
        </select>
      </div>

      {info.times ? (
        <div>
          <p>
            預估經過 <b>{board?.name}</b>({offsetText(info.offset)})
          </p>
          {isToday && (
            <p className="mt-0.5">
              {upcoming.length ? (
                <>
                  接下來:
                  {upcoming.map((t) => (
                    <b key={t} className="ml-1.5 tabular-nums">
                      {fmtMin(t)}
                    </b>
                  ))}
                </>
              ) : (
                <span className="text-neutral-500">今天沒有班次了</span>
              )}
            </p>
          )}
          <button onClick={() => setAllTimes(!allTimes)} className="mt-0.5 text-emerald-700 underline dark:text-emerald-400">
            {allTimes ? "收起" : `${DAY_LABEL[day]}全部 ${info.times.length} 班`}
          </button>
          {allTimes && (
            <div className="mt-1 grid grid-cols-6 gap-x-2 gap-y-0.5 tabular-nums">
              {info.times.map((t, i) => (
                <span key={i} className={isToday && t < nowMin ? "text-neutral-400" : ""}>
                  {fmtMin(t)}
                </span>
              ))}
            </div>
          )}
        </div>
      ) : info.bands ? (
        <div>
          <p className="text-neutral-500">
            班距({offsetText(info.offset)})
          </p>
          <ul className="mt-0.5 grid grid-cols-2 gap-x-3 tabular-nums">
            {info.bands.map((b, i) => (
              <li key={i}>
                {b.s}–{b.e} 每 {b.min === b.max ? b.max : `${b.min}–${b.max}`} 分
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-neutral-500">{DAY_LABEL[day]}沒有班表資料(可能不營運,或 TDX 沒提供)</p>
      )}

      {board && alight && (
        <p>
          {board.name} → {alight.name}:{alight.seq - board.seq} 站,
          {alight.t_min != null && board.t_min != null ? `${alight.t_min - board.t_min} 分` : `約 ${Math.max(1, Math.round((alight.dist_m - board.dist_m) / BUS_M_PER_MIN))} 分`}
        </p>
      )}

      <button onClick={() => setAllStops(!allStops)} className="flex items-center gap-0.5 text-neutral-500">
        {allStops ? <ChevronUp size={12} /> : <ChevronDown size={12} />} 全部站
      </button>
      {allStops && (
        <ol className="max-h-48 overflow-auto">
          {stops.map((s) => (
            <li
              key={s.seq}
              className={s.seq === pick.boardSeq ? "font-semibold text-emerald-700 dark:text-emerald-400" : s.seq === pick.alightSeq ? "font-semibold text-blue-700 dark:text-blue-400" : ""}
            >
              <span className="inline-block w-6 text-right text-neutral-400 tabular-nums">{s.seq}</span> {s.name}
            </li>
          ))}
        </ol>
      )}
      <p className="text-[11px] text-neutral-400">時刻是班表推估,實際依路況;即時到站看台北等公車 / 公車動態。</p>
    </div>
  );
}

function offsetText(o: { min: number; exact: boolean }) {
  return o.min === 0 ? "起點站發車時刻" : `起點發車 + ${o.exact ? "" : "約 "}${o.min} 分`;
}

/** 某站、某種日子的預估經過時刻(有逐班時刻)或班距 */
function timesAt(d: BusRouteDetail, seq: number, day: DayType) {
  const stop = d.stops.find((s) => s.seq === seq);
  const exact = stop?.t_min != null;
  const offset = { min: exact ? stop!.t_min! : Math.round((stop?.dist_m ?? 0) / BUS_M_PER_MIN), exact };
  const sch = d.route.schedule?.[day];
  const times = sch?.deps?.length ? sch.deps.map((t) => toMin(t) + offset.min).sort((a, b) => a - b) : null;
  return { offset, times, bands: sch?.bands?.length ? sch.bands : null };
}

function overlayOf(d: BusRouteDetail, pick: Pick): BusOverlay {
  const board = d.stops.find((s) => s.seq === pick.boardSeq);
  const alight = pick.alightSeq != null ? d.stops.find((s) => s.seq === pick.alightSeq) : undefined;
  const stops: BusOverlay["stops"] = d.stops.map((s) => ({
    name: s.name,
    lat: s.lat,
    lng: s.lng,
    role: s.seq === pick.boardSeq ? "board" : s.seq === pick.alightSeq ? "alight" : "stop",
  }));
  let segment: [number, number][] | undefined;
  if (board && alight) {
    const near = (p: { lat: number; lng: number }) => {
      let best = 0;
      let bestD = Infinity;
      d.route.shape.forEach(([x, y], i) => {
        const dd = haversine(p.lat, p.lng, y, x);
        if (dd < bestD) (bestD = dd), (best = i);
      });
      return best;
    };
    const a = near(board);
    const b = near(alight);
    // 線形對得上就切線形;對不上(環狀線、線形缺)就用站連線
    segment =
      a < b
        ? [[board.lng, board.lat], ...d.route.shape.slice(a, b + 1), [alight.lng, alight.lat]]
        : d.stops.filter((s) => s.seq >= board.seq && s.seq <= alight.seq).map((s) => [s.lng, s.lat]);
  }
  return { shape: d.route.shape, stops, segment };
}
