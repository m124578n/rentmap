import { useMemo, useState } from "react";
import { usePlan } from "@/lib/plan";
import { PlanLock } from "@/features/plan/PlanLock";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bike, Bus, Footprints, MapPin, Route, TrainFront } from "lucide-react";
import { api } from "@/lib/api";
import type { PropertySummary } from "@shared/schemas";
import { STAGE_LABEL, type Stage } from "@shared/constants";
import { DAY_LABEL, DAY_TYPES, type DayType } from "@shared/bus";
import { bestTourOrder, TRIP_KIND_LABEL, type TourResponse, type Trip } from "@shared/trip";
import { usePlaces } from "@/features/places/places";
import { priceText } from "@shared/price";

const MAX = 8;
const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(Math.round(min) % 60).padStart(2, "0")}`;
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/**
 * 看房路線:挑幾間(預設「已約看」的),從哪出發、幾點出門、每間看多久 → 排出交通時間最短的順序,
 * 列出每間幾點到、幾點走、中間怎麼搭。交通時間用出門那個時段的班距估(不是即時)。
 */
export function TourPage() {
  const q = useQuery({ queryKey: ["properties"], queryFn: api.listProperties });
  const tourOk = usePlan().ent.tour;
  const places = usePlaces();
  const favs = useMemo(
    () =>
      (q.data?.items ?? [])
        .filter((p) => p.stage && p.stage !== "rejected" && p.lat != null && p.lng != null)
        .sort((a, b) => Number(b.stage === "scheduled") - Number(a.stage === "scheduled") || (b.priority ?? 0) - (a.priority ?? 0)),
    [q.data],
  );
  const [picked, setPicked] = useState<Set<number> | null>(null);
  const sel = picked ?? new Set(favs.filter((p) => p.stage === "scheduled").slice(0, MAX).map((p) => p.id));
  const [startId, setStartId] = useState<number | "">("");
  const [day, setDay] = useState<DayType>(new Date().getDay() === 6 ? "sat" : new Date().getDay() === 0 ? "sun" : "wd");
  const [time, setTime] = useState("10:00");
  const [stay, setStay] = useState(20);

  const chosen = favs.filter((p) => sel.has(p.id));
  const start = places.data?.items.find((p) => p.id === startId) ?? null;
  // 按下「排路線」當下的房源、出門時間與起點(之後改勾選會 reset);排好的存在這台,離線也看得到上次的
  const run = useMutation({
    mutationFn: async (v: { props: PropertySummary[]; time: string }): Promise<Ran> => ({
      props: v.props,
      time: v.time,
      day,
      startName: start?.name ?? null,
      at: new Date().toISOString(),
      res: await api.tour({
        points: v.props.map((p) => ({ lat: p.lat!, lng: p.lng!, name: p.title.slice(0, 60) })),
        start: start ? { lat: start.lat, lng: start.lng, name: start.name } : null,
        day,
        time: v.time,
      }),
    }),
    onSuccess: saveLast,
  });
  const [last] = useState(loadLast);
  const shown = run.data ?? (run.isIdle ? last : null);
  const plan = useMemo(() => (shown ? schedule(shown.res, shown.props, stay, shown.time) : undefined), [shown, stay]);

  const toggle = (id: number) => {
    const s = new Set(sel);
    if (s.has(id)) s.delete(id);
    else if (s.size < MAX) s.add(id);
    setPicked(s);
    run.reset();
  };

  if (q.isLoading) return <p className="p-4 text-neutral-500">載入中…</p>;
  if (!tourOk)
    return (
      <div className="card m-4 grid gap-2 text-sm">
        <h1 className="flex items-center gap-1.5 text-lg font-semibold">
          <Route size={18} /> 看房路線
        </h1>
        <p className="text-neutral-600 dark:text-neutral-400">挑幾間約好的房,排出交通時間最短的順序,每間幾點到、怎麼搭。</p>
        <PlanLock>看房路線是付費功能。</PlanLock>
      </div>
    );
  return (
    <div className="mx-auto grid max-w-3xl gap-4 p-4 text-sm">
      <div>
        <h1 className="flex items-center gap-1.5 text-lg font-semibold">
          <Route size={18} /> 看房路線
        </h1>
        <p className="text-xs text-neutral-500">挑要看的房(最多 {MAX} 間),排出交通時間最短的順序;交通用出門那個時段的班次估。</p>
      </div>

      <section className="card grid gap-2">
        <h2 className="text-xs font-medium text-neutral-500">要看哪幾間({sel.size}/{MAX})</h2>
        {favs.length === 0 ? (
          <p className="text-neutral-500">
            還沒有收藏的房源。先在
            <Link to="/" className="mx-1 text-emerald-600 underline">
              地圖
            </Link>
            收藏,並在看板把約好的移到「已約看」。
          </p>
        ) : (
          <ul className="grid max-h-72 gap-1 overflow-auto">
            {favs.map((p) => (
              <li key={p.id}>
                <label className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-neutral-50 dark:hover:bg-neutral-800">
                  <input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} disabled={!sel.has(p.id) && sel.size >= MAX} />
                  <span className="min-w-0 flex-1 truncate">{p.title}</span>
                  <span className="shrink-0 text-xs text-neutral-500">
                    {p.district} · {priceText(p)} · {STAGE_LABEL[p.stage as Stage]}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-1">
          從
          <select className="input !w-auto" value={startId} onChange={(e) => (setStartId(e.target.value ? Number(e.target.value) : ""), run.reset())}>
            <option value="">第一間(不指定)</option>
            {(places.data?.items ?? []).map((pl) => (
              <option key={pl.id} value={pl.id}>
                {pl.name}
              </option>
            ))}
          </select>
          出發
        </label>
        <label className="flex items-center gap-1">
          <select className="input !w-auto" value={day} onChange={(e) => (setDay(e.target.value as DayType), run.reset())}>
            {DAY_TYPES.map((d) => (
              <option key={d} value={d}>
                {DAY_LABEL[d]}
              </option>
            ))}
          </select>
          <input type="time" className="input !w-auto" value={time} onChange={(e) => (setTime(e.target.value), run.reset())} />
          出門
        </label>
        <label className="flex items-center gap-1">
          每間看
          <input type="number" className="input !w-16" min={5} max={120} step={5} value={stay} onChange={(e) => setStay(Math.max(5, Number(e.target.value) || 20))} />分
        </label>
        <button className="btn-primary" disabled={chosen.length < 2 || run.isPending} onClick={() => run.mutate({ props: chosen, time })}>
          {run.isPending ? "計算中…" : "排路線"}
        </button>
        {chosen.length < 2 && <span className="text-xs text-neutral-500">至少挑 2 間</span>}
      </section>

      {run.error && <p className="text-red-600">算不出來:{String(run.error)}</p>}
      {plan === null && <p className="text-red-600">有房源之間搭不到車(轉乘一次內),換掉那間再試。</p>}
      {plan && (
        <section className="card">
          <h2 className="mb-2 flex items-baseline justify-between text-xs font-medium text-neutral-500">
            <span>
              {run.data ? "建議順序" : `上次排的(${shown!.at.slice(5, 10).replace("-", "/")})`} · 交通共約 {plan.travel} 分,{hhmm(plan.end)} 看完
            </span>
            <span>
              {DAY_LABEL[shown!.day]} {shown!.time} 出門
            </span>
          </h2>
          <ol className="grid gap-1">
            {shown!.startName && (
              <li className="flex items-center gap-2">
                <span className="w-12 shrink-0 text-right tabular-nums text-neutral-500">{shown!.time}</span>
                <MapPin size={14} className="shrink-0 text-blue-600" />
                <span className="font-medium">{shown!.startName} 出發</span>
              </li>
            )}
            {plan.stops.map((s, i) => (
              <li key={s.p.id} className="grid gap-1">
                {s.trip && (
                  <div className="ml-14 flex items-center gap-1.5 border-l-2 border-dashed border-neutral-300 py-1 pl-3 text-xs text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">
                    <TripIcon t={s.trip} />
                    約 {s.trip.total_min} 分 · {TRIP_KIND_LABEL[s.trip.kind]}
                    {s.trip.summary && s.trip.summary !== TRIP_KIND_LABEL[s.trip.kind] ? ` · ${s.trip.summary}` : ""}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span className="w-12 shrink-0 text-right tabular-nums">{hhmm(s.arrive)}</span>
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[11px] font-semibold text-white">{i + 1}</span>
                  <Link to="/p/$id" params={{ id: String(s.p.id) }} className="min-w-0 flex-1 truncate font-medium hover:underline">
                    {s.p.title}
                  </Link>
                  <span className="shrink-0 text-xs text-neutral-500">
                    {s.p.district}
                    {s.p.road ? ` ${s.p.road}` : ""} · 看到 {hhmm(s.leave)}
                  </span>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[11px] text-neutral-400">順序是交通時間最短的走法(不回起點);時間是估的,抓一點緩衝,出發前再確認一次班次。</p>
        </section>
      )}
    </div>
  );
}

function TripIcon({ t }: { t: Trip }) {
  const k = t.kind;
  const Icon = k === "walk" ? Footprints : k.startsWith("bike") || k.endsWith("bike") ? Bike : k.includes("mrt") ? TrainFront : Bus;
  return <Icon size={13} className="shrink-0" />;
}

/** 算最佳順序,排出每間抵達 / 離開時間(分鐘,從 0 點算) */
function schedule(r: TourResponse, props: PropertySummary[], stay: number, time: string) {
  const minutes = r.trips.map((row) => row.map((t) => (t ? t.total_min : null)));
  const best = bestTourOrder(minutes, r.has_start);
  if (!best) return null;
  const off = r.has_start ? 1 : 0;
  let t = toMin(time);
  let prev = r.has_start ? 0 : -1;
  const stops = best.order.map((k) => {
    const trip = prev >= 0 ? r.trips[prev]![k + off]! : null;
    if (trip) t += trip.total_min;
    const arrive = t;
    t += stay;
    prev = k + off;
    return { p: props[k]!, trip, arrive, leave: t };
  });
  return { stops, travel: best.total, end: t };
}

interface Ran {
  props: PropertySummary[];
  time: string;
  day: DayType;
  startName: string | null;
  at: string;
  res: TourResponse;
}
const LAST_KEY = "rentmap.lastTour";
function saveLast(r: Ran) {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(r));
  } catch {
    /* 容量滿或私密模式:不記 */
  }
}
function loadLast(): Ran | null {
  try {
    const v = localStorage.getItem(LAST_KEY);
    return v ? (JSON.parse(v) as Ran) : null;
  } catch {
    return null;
  }
}
