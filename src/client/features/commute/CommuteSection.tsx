import { useEffect, useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Bike, Bus, ChevronDown, ChevronUp, Footprints, Route, TrainFront } from "lucide-react";
import { COMMUTE_SIDE_LABEL, TRIP_KIND_LABEL, type CommuteSide, type CommuteWhen, type Trip, type TripBrief, type TripLeg } from "@shared/trip";
import { DAY_LABEL } from "@shared/bus";
import { useFilters, whenOf } from "@/lib/filters";
import type { Place } from "@shared/schemas";
import { api } from "@/lib/api";
import type { BusOverlay } from "@/features/map/busLayer";
import { openPlacesDialog, useCommuteTarget, usePlaces } from "@/features/places/places";
import { RouteTimes } from "@/features/bus/BusSection";
import { useCommute } from "./useCommute";
import { tripOverlay } from "./tripOverlay";

interface Props {
  lat: number;
  lng: number;
  /** 沒給 = 地圖上任意一點(「看附近」):逐個地點打 /api/commute/trips 算最快的 */
  propertyId?: number;
  /** 地圖頁才有:選了哪種搭法就畫到地圖上 */
  onOverlay?: (o: BusOverlay | null) => void;
}

/**
 * 房源面板的「通勤」:我的每個地點一行,上班(住處 → 地點)、下班(地點 → 住處)各列最快的搭法;
 * 點開看每種搭法(上下班分開切換)(公車直達 / 捷運 / 轉乘一次 / 走路),
 * 再點一種看每段怎麼走,地圖畫出整趟。沒設地點前只顯示「輸入公司地址」。
 */
export function CommuteSection({ lat, lng, propertyId, onOverlay }: Props) {
  const places = usePlaces();
  const go = useCommute("go");
  const back = useCommute("back");
  const f = useFilters();
  const [openId, setOpenId] = useCommuteTarget();
  const [radius, setRadius] = useState(400);
  const [side, setSide] = useState<CommuteSide>(f.commuteSide);
  useEffect(() => setSide(f.commuteSide), [f.commuteSide]);
  const list = places.data?.items ?? [];
  const pointRows = usePointBriefs(propertyId == null ? lat : null, lng, list, { go: whenOf(f, "go"), back: whenOf(f, "back") }, f.commuteBike);
  const rows = propertyId != null ? { go: go.matrix?.items[propertyId], back: back.matrix?.items[propertyId] } : pointRows;
  // 摘要:undefined = 還在算、null = 搭不到
  const briefOf = (s: CommuteSide, placeId: number) =>
    propertyId != null ? ((s === "go" ? go : back).matrix ? (rows[s]?.[placeId] ?? null) : undefined) : rows[s]?.[placeId];

  useEffect(() => () => onOverlay?.(null), [onOverlay]);

  if (!places.isSuccess) return null;
  return (
    <section className="min-w-0 text-sm">
      <div className="mb-1.5 flex items-center justify-between">
        <h2 className="flex items-center gap-1 text-xs font-medium text-neutral-500">
          <Route size={14} /> 通勤
        </h2>
        {list.length > 0 && (
          <button onClick={openPlacesDialog} className="text-xs text-neutral-500 underline">
            管理地點
          </button>
        )}
      </div>

      {list.length === 0 ? (
        <div className="rounded border border-blue-200 bg-blue-50 p-2.5 text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200">
          <p>看通勤要先設定公司地址:設好後這裡會算出公車、捷運(含轉乘一次)要多久。</p>
          <button onClick={openPlacesDialog} className="mt-2 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
            輸入公司地址
          </button>
        </div>
      ) : (
        <ul className="grid gap-1 rounded border border-blue-200 p-1.5 dark:border-blue-900 [&>*]:min-w-0">
          {list.map((pl) => {
            const open = pl.id === openId;
            return (
              <li key={pl.id}>
                <button
                  onClick={() => {
                    setOpenId(open ? null : pl.id);
                    onOverlay?.(null);
                  }}
                  className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left ${open ? "bg-blue-50 dark:bg-blue-950" : "hover:bg-neutral-50 dark:hover:bg-neutral-800"}`}
                >
                  <span className="shrink-0 self-start rounded-full bg-blue-600 px-2 py-0.5 text-xs text-white">{pl.name}</span>
                  <span className="grid min-w-0 flex-1 text-xs">
                    {(["go", "back"] as CommuteSide[]).map((s) => (
                      <span key={s} className="truncate">
                        <span className="mr-1 text-neutral-500">{COMMUTE_SIDE_LABEL[s]}</span>
                        <BriefText b={briefOf(s, pl.id)} />
                      </span>
                    ))}
                  </span>
                  {open ? <ChevronUp size={14} className="shrink-0 text-neutral-400" /> : <ChevronDown size={14} className="shrink-0 text-neutral-400" />}
                </button>
                {open && (
                  <Trips
                    lat={lat}
                    lng={lng}
                    place={pl}
                    radius={radius}
                    setRadius={setRadius}
                    side={side}
                    setSide={(s) => {
                      setSide(s);
                      onOverlay?.(null);
                    }}
                    when={whenOf(f, side)}
                    onOverlay={onOverlay}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const tripsQuery = (lat: number, lng: number, place: Place, radius: number, when: CommuteWhen, bike: boolean) => ({
  queryKey: ["commute-trips", lat, lng, place.id, place.lat, place.lng, radius, when.day, when.time, when.dir, bike],
  queryFn: () => api.commuteTrips({ lat, lng, placeId: place.id, radius, when, bike }),
  staleTime: 10 * 60_000,
});

/** 任意點:每個地點 × 上下班各打一次 trips(和點開的搭法共用快取),取最快的當摘要;還沒算完的地點不放 */
function usePointBriefs(lat: number | null, lng: number, places: Place[], when: Record<CommuteSide, CommuteWhen>, bike: boolean) {
  const sides: CommuteSide[] = ["go", "back"];
  const qs = useQueries({
    queries: lat == null ? [] : sides.flatMap((s) => places.map((pl) => ({ ...tripsQuery(lat, lng, pl, 400, when[s], bike) }))),
  });
  const out: Record<CommuteSide, Record<string, TripBrief | null> | undefined> = { go: {}, back: {} };
  sides.forEach((s, si) =>
    places.forEach((pl, pi) => {
      const d = qs[si * places.length + pi]?.data;
      if (!d) return;
      const t = d.trips[0];
      out[s]![pl.id] = t ? { kind: t.kind, total_min: t.total_min, transfers: t.transfers, summary: t.summary } : null;
    }),
  );
  return out;
}

export function BriefText({ b }: { b: TripBrief | null | undefined }) {
  if (b === undefined) return <span className="text-neutral-400">計算中…</span>;
  if (!b) return <span className="text-neutral-400">太遠或搭不到(1 次轉乘內)</span>;
  return (
    <>
      <b className="tabular-nums">約 {b.total_min} 分</b> · {b.summary}
    </>
  );
}

function Trips({
  lat,
  lng,
  place,
  radius,
  setRadius,
  side,
  setSide,
  when,
  onOverlay,
}: {
  lat: number;
  lng: number;
  place: Place;
  radius: number;
  setRadius: (r: number) => void;
  side: CommuteSide;
  setSide: (s: CommuteSide) => void;
  when: CommuteWhen;
  onOverlay?: (o: BusOverlay | null) => void;
}) {
  const bike = useFilters().commuteBike;
  const q = useQuery(tripsQuery(lat, lng, place, radius, when, bike));
  const [sel, setSel] = useState<number | null>(null);
  useEffect(() => setSel(null), [side, when.day, when.time]);
  const trips = q.data?.trips ?? [];
  const trip = sel != null ? trips[sel] : undefined;

  // 選中的行程:公車段要線形才畫得沿路
  const busKeys = useMemo(() => [...new Set((trip?.legs ?? []).flatMap((l) => (l.mode === "bus" ? [l.key] : [])))], [trip]);
  const shapes = useQueries({ queries: busKeys.map((k) => ({ queryKey: ["bus-route", k], queryFn: () => api.busRoute(k), staleTime: 60 * 60_000 })) });
  const shapesReady = shapes.map((s) => s.data?.route.key ?? "").join("|");
  useEffect(() => {
    if (!onOverlay) return;
    if (!trip) return onOverlay(null);
    const m = new Map(shapes.flatMap((s) => (s.data ? [[s.data.route.key, s.data] as const] : [])));
    const home: [number, number] = [lng, lat];
    const dest: [number, number] = [place.lng, place.lat];
    onOverlay(when.dir === "from" ? tripOverlay(trip, dest, home, m) : tripOverlay(trip, home, dest, m));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip, shapesReady, onOverlay]);

  return (
    <div className="mt-1 grid gap-1 border-l-2 border-blue-200 pl-1.5 dark:border-blue-900 [&>*]:min-w-0">
      <div className="flex flex-wrap items-center gap-1 text-[11px] text-neutral-500">
        {(["go", "back"] as CommuteSide[]).map((s) => (
          <button
            key={s}
            onClick={() => setSide(s)}
            className={`rounded px-1.5 py-0.5 ${side === s ? "bg-blue-600 text-white" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
          >
            {COMMUTE_SIDE_LABEL[s]}
          </button>
        ))}
        <span className="min-w-0 truncate">
          {DAY_LABEL[when.day]} {when.time} 從{when.dir === "to" ? "住處" : place.name}出發
        </span>
      </div>
      <div className="flex items-center justify-end gap-1 text-[11px] text-neutral-500">
        公車站找
        {[400, 800].map((r) => (
          <button
            key={r}
            onClick={() => {
              setRadius(r);
              setSel(null);
            }}
            className={`rounded px-1.5 py-0.5 ${radius === r ? "bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
          >
            {r}m
          </button>
        ))}
        內
      </div>
      {q.isLoading && <p className="px-1.5 text-xs text-neutral-500">計算中…</p>}
      {q.data && trips.length === 0 && (
        <p className="px-1.5 text-xs text-neutral-500">
          這個時段搭不到(轉乘一次內):可能那時沒車,或離捷運 / 公車太遠。試試 800m,或在篩選列改出發時間。
        </p>
      )}
      {trips.map((t, i) => (
        <div key={i}>
          <button
            onClick={() => setSel(sel === i ? null : i)}
            className={`w-full rounded px-1.5 py-1 text-left ${sel === i ? "bg-blue-50 dark:bg-blue-950" : "hover:bg-neutral-50 dark:hover:bg-neutral-800"}`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate">
                <b>{t.summary}</b>
                <span className="ml-1.5 text-[11px] text-neutral-500">{TRIP_KIND_LABEL[t.kind]}</span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums">約 {t.total_min} 分</span>
            </div>
            <LegStrip legs={t.legs} />
          </button>
          {sel === i && <TripDetail trip={t} />}
        </div>
      ))}
      {q.data && !q.data.has_bus && <p className="px-1.5 text-[11px] text-amber-700 dark:text-amber-400">還沒匯入公車資料,只算捷運與走路(家裡跑 npm run collect -- bus)。</p>}
      {trips.length > 0 && <p className="px-1.5 text-[11px] text-neutral-400">估計值:等車抓這個時段的班距一半(那時沒開的路線不算)、走路含等紅綠燈、轉乘另加 2 分;時間在篩選列「通勤」調整。</p>}
    </div>
  );
}

/** 一行看完:走3′ → 🚌262 12′ → 走2′ → 🚇板南線 8′ → 走4′ */
function LegStrip({ legs }: { legs: TripLeg[] }) {
  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[11px] text-neutral-600 dark:text-neutral-400">
      {legs.map((l, i) => (
        <span key={i} className="flex items-center gap-0.5">
          {i > 0 && <span className="text-neutral-300 dark:text-neutral-600">›</span>}
          {l.mode === "walk" ? (
            <>
              <Footprints size={11} />
              {l.min}′
            </>
          ) : l.mode === "bus" ? (
            <>
              <Bus size={11} />
              {l.name} {l.min}′
            </>
          ) : l.mode === "bike" ? (
            <>
              <Bike size={11} className="text-lime-600" />
              YouBike {l.min}′
            </>
          ) : (
            <>
              <TrainFront size={11} style={{ color: l.colors[0] }} />
              {l.lines.join("→")} {l.min}′
            </>
          )}
        </span>
      ))}
    </div>
  );
}

function TripDetail({ trip }: { trip: Trip }) {
  const [times, setTimes] = useState<number | null>(null);
  return (
    <ol className="mt-1 grid gap-1 rounded bg-neutral-50 p-2 text-xs dark:bg-neutral-800/60">
      {trip.legs.map((l, i) => (
        <li key={i}>
          {l.mode === "walk" ? (
            <span className="text-neutral-600 dark:text-neutral-400">
              <Footprints size={12} className="mr-1 inline" />
              走 {l.min} 分({l.m}m)到 {l.to}
            </span>
          ) : l.mode === "bus" ? (
            <div>
              <Bus size={12} className="mr-1 inline" />
              等約 {l.wait} 分,搭 <b>{l.name}</b>
              {l.variant && <span className="text-neutral-500">({l.variant})</span>}
              {l.to_name && <span className="text-neutral-500">(往{l.to_name})</span>}:{l.from} → {l.to},{l.stops} 站 {l.exact ? "" : "約 "}
              {l.min} 分
              <button onClick={() => setTimes(times === i ? null : i)} className="ml-1.5 text-emerald-700 underline dark:text-emerald-400">
                {times === i ? "收起班次" : "班次"}
              </button>
              {times === i && <RouteTimes pick={{ key: l.key, boardSeq: l.board_seq, alightSeq: l.alight_seq }} />}
            </div>
          ) : l.mode === "bike" ? (
            <div>
              <Bike size={12} className="mr-1 inline text-lime-600" />
              租 YouBike(租還約 {l.wait} 分):{l.from} → {l.to},{(l.m / 1000).toFixed(1)} km 約 {l.min} 分
            </div>
          ) : (
            <div>
              <TrainFront size={12} className="mr-1 inline" style={{ color: l.colors[0] }} />
              等約 {l.wait} 分,搭{l.lines.every((x) => x === "台鐵") ? "" : "捷運"} <b>{l.lines.join(" → ")}</b>:{l.from} → {l.to},{l.stops} 站約 {l.min} 分{l.lines.length > 1 ? "(含換線)" : ""}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
