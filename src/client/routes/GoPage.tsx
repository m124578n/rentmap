import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import { Bike, Car, MapPin, Navigation, Search } from "lucide-react";
import { api } from "@/lib/api";
import { usePlan } from "@/lib/plan";
import { useFilters, whenOf } from "@/lib/filters";
import { useRegion } from "@/lib/region";
import { openPlacesDialog, useCommutePlaces } from "@/features/places/places";
import { searchAddress } from "@/features/places/geocode";
import { LegStrip, TripDetail, tripsQuery } from "@/features/commute/CommuteSection";
import { Pending } from "@/components/Pending";
import { COMMUTE_SIDE_LABEL, TRIP_KIND_LABEL, type CommuteSide, type Trip, type TripBrief } from "@shared/trip";
import { DAY_LABEL, haversine } from "@shared/bus";
import { driveMin, roadKm, DRIVE_COST_PER_KM } from "@shared/drive";
import { fareText, tripFare } from "@shared/fare";
import { regionBbox } from "@shared/regions";
import type { Place } from "@shared/schemas";

type Origin = { lat: number; lng: number; label: string };
type Option = { key: string; label: string; summary: string; min: number; fare: number; trip?: Trip; estimated?: boolean };

/**
 * 怎麼去:選起點(我的筆記或任一地址)、選我的地點,列出每種去法要多久、大概多少錢。
 * 時間用篩選列「通勤」的上班時段;公車 + 捷運最多轉乘一次,另附機車 / 開車。
 */
export function GoPage() {
  const places = useCommutePlaces();
  const list = places.data?.items ?? [];
  const notes = useQuery({ queryKey: ["properties"], queryFn: api.listProperties });
  const located = (notes.data?.items ?? []).filter((p) => p.lat != null && p.lng != null);
  const region = useRegion();
  const f = useFilters();
  const custom = usePlan().ent.commuteCustom;

  // ?from=<筆記 id>:從筆記頁點「怎麼去」帶過來
  const [fromId, setFromId] = useState<string>(useSearch({ from: "/go" }).from ?? "");
  const [addr, setAddr] = useState("");
  const [addrPin, setAddrPin] = useState<Origin | null>(null);
  const [searching, setSearching] = useState(false);
  const [addrErr, setAddrErr] = useState<string | null>(null);
  const [placeId, setPlaceId] = useState<number | null>(null);
  const [side, setSide] = useState<CommuteSide>("go");
  const [sort, setSort] = useState<"time" | "fare">("time");

  const note = located.find((p) => String(p.id) === fromId) ?? (fromId === "addr" ? undefined : located[0]);
  const origin: Origin | null = fromId === "addr" ? addrPin : note ? { lat: note.lat!, lng: note.lng!, label: note.title } : null;
  const place = list.find((p) => p.id === placeId) ?? list[0];

  async function search() {
    if (!addr.trim()) return;
    setSearching(true);
    setAddrErr(null);
    try {
      const hit = (await searchAddress(addr, regionBbox(region.key)))[0];
      if (hit) setAddrPin({ lat: hit.lat, lng: hit.lng, label: hit.label });
      else setAddrErr("找不到這個地址,試著只打到路名");
    } catch (e) {
      setAddrErr(e instanceof Error ? e.message : "地址搜尋失敗");
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-2xl gap-4 p-4">
      <h1 className="flex items-center gap-1.5 text-xl font-semibold">
        <Navigation size={20} /> 怎麼去
      </h1>

      <section className="card grid gap-3 text-sm">
        <label className="grid gap-1">
          <span className="text-xs text-neutral-500">從</span>
          <select className="input" value={note && fromId !== "addr" ? String(note.id) : fromId} onChange={(e) => setFromId(e.target.value)}>
            {located.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}({p.district})
              </option>
            ))}
            <option value="addr">輸入地址…</option>
          </select>
        </label>
        {fromId === "addr" && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
          >
            <input className="input" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="例:台北市大安區信義路四段1號" autoFocus />
            <button type="submit" className="btn-ghost shrink-0" disabled={searching || !addr.trim()}>
              <Search size={15} /> {searching ? "搜尋中" : "搜尋"}
            </button>
          </form>
        )}
        {fromId === "addr" && (addrErr ? <p className="text-xs text-red-600">{addrErr}</p> : addrPin && <p className="text-xs text-neutral-500">找到:{addrPin.label}</p>)}

        <div className="grid gap-1">
          <span className="text-xs text-neutral-500">到</span>
          {places.isSuccess && list.length === 0 ? (
            <button className="btn-primary justify-self-start" onClick={openPlacesDialog}>
              <MapPin size={15} /> 先設定常去的地點(公司、學校…)
            </button>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {list.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPlaceId(p.id)}
                  className={`rounded-full border px-3 py-1 ${place?.id === p.id ? "border-emerald-600 bg-emerald-600 text-white" : "border-neutral-300 dark:border-neutral-700"}`}
                >
                  {p.name}
                </button>
              ))}
              <button className="rounded-full px-2 py-1 text-xs text-neutral-500 underline" onClick={openPlacesDialog}>
                管理地點
              </button>
            </div>
          )}
        </div>
      </section>

      {!origin && fromId !== "addr" && notes.isSuccess && (
        <p className="text-sm text-neutral-500">
          還沒有定位好的筆記,選「輸入地址…」或先
          <Link to="/new" className="mx-1 text-emerald-600 underline">
            新增筆記
          </Link>
          。
        </p>
      )}

      {origin && place && (
        <Results origin={origin} place={place} side={side} setSide={custom ? setSide : undefined} sort={sort} setSort={setSort} when={whenOf(f, side)} bike={f.commuteBike} />
      )}
    </div>
  );
}

function Results({
  origin,
  place,
  side,
  setSide,
  sort,
  setSort,
  when,
  bike,
}: {
  origin: Origin;
  place: Place;
  side: CommuteSide;
  setSide?: (s: CommuteSide) => void;
  sort: "time" | "fare";
  setSort: (s: "time" | "fare") => void;
  when: ReturnType<typeof whenOf>;
  bike: boolean;
}) {
  const region = useRegion();
  const trips = useQuery(tripsQuery(origin.lat, origin.lng, place, 400, when, bike));
  const drive = useQuery({ queryKey: ["drive-at", origin.lat, origin.lng, when.day, when.time, when.dir], queryFn: () => api.driveAt(origin.lat, origin.lng, when), staleTime: 5 * 60_000, retry: false });
  const [open, setOpen] = useState<string | null>(null);

  const options = useMemo(() => {
    const out: Option[] = (trips.data?.trips ?? []).map((t, i) => ({ key: `t${i}`, label: TRIP_KIND_LABEL[t.kind], summary: t.summary, min: t.total_min, fare: tripFare(t), trip: t }));
    const m = haversine(origin.lat, origin.lng, place.lat, place.lng);
    // 跨生活圈騎車開車沒意義
    if (m <= 100_000 && !drive.isLoading) {
      const r = drive.data?.has_roads ? drive.data.items[place.id] : undefined;
      for (const mode of ["scooter", "car"] as const) {
        const b: TripBrief | null | undefined = r?.[mode];
        if (b) out.push({ key: mode, label: mode === "scooter" ? "機車" : "開車", summary: `${b.km} km`, min: b.total_min, fare: tripFare(b) });
        else if (!r) {
          const km = roadKm(m);
          out.push({ key: mode, label: mode === "scooter" ? "機車" : "開車", summary: `約 ${km} km`, min: driveMin(mode, m, when, region.key), fare: Math.round(km * DRIVE_COST_PER_KM[mode]), estimated: true });
        }
      }
    }
    return out.sort((a, b) => (sort === "time" ? a.min - b.min || a.fare - b.fare : a.fare - b.fare || a.min - b.min));
  }, [trips.data, drive.data, drive.isLoading, origin, place, sort, when, region.key]);

  const seg = (on: boolean) => `rounded px-2 py-0.5 ${on ? "bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`;
  return (
    <section className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
        {setSide &&
          (["go", "back"] as CommuteSide[]).map((s) => (
            <button key={s} onClick={() => setSide(s)} className={seg(side === s)}>
              {COMMUTE_SIDE_LABEL[s]}
            </button>
          ))}
        <span>
          {DAY_LABEL[when.day]} {when.time} 從{when.dir === "to" ? origin.label : place.name}出發
        </span>
        <span className="ml-auto flex gap-1">
          <button onClick={() => setSort("time")} className={seg(sort === "time")}>
            最快
          </button>
          <button onClick={() => setSort("fare")} className={seg(sort === "fare")}>
            最省
          </button>
        </span>
      </div>

      {trips.isLoading && <p className="text-sm text-neutral-500">計算中…</p>}
      {trips.error && <p className="text-sm text-red-600">算不出來,稍後再試</p>}
      <ul className="grid gap-2">
        {options.map((o) => (
          <li key={o.key} className="card !p-0">
            <button className="w-full px-3 py-2.5 text-left" onClick={() => o.trip && setOpen(open === o.key ? null : o.key)}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="flex min-w-0 items-center gap-1.5">
                  {o.key === "scooter" ? <Bike size={15} /> : o.key === "car" ? <Car size={15} /> : null}
                  <b className="truncate">{o.trip ? o.summary : o.label}</b>
                  <span className="shrink-0 text-xs text-neutral-500">{o.trip ? o.label : `${o.summary}${o.estimated ? "(估)" : ""}`}</span>
                </span>
                <span className="shrink-0 text-right tabular-nums">
                  <b className="text-lg">{o.min}</b> 分
                  <span className="ml-2 text-sm text-neutral-600 dark:text-neutral-400">{o.trip ? fareText(o.fare) : `油錢約 ${o.fare} 元`}</span>
                </span>
              </div>
              {o.trip && <LegStrip legs={o.trip.legs} />}
            </button>
            {open === o.key && o.trip && (
              <div className="px-3 pb-3">
                <TripDetail trip={o.trip} />
              </div>
            )}
          </li>
        ))}
      </ul>
      {trips.data && trips.data.trips.length === 0 && <p className="text-sm text-neutral-500">這個時段公車、捷運搭不到(轉乘一次內),可以在篩選列改出發時間。</p>}
      {trips.data && !trips.data.has_bus && <Pending what="公車資料(目前只算捷運與走路)" cmd="npm run collect -- bus" className="text-xs text-amber-700 dark:text-amber-400" />}
      {options.length > 0 && (
        <p className="text-[11px] text-neutral-400">
          都是估計:票價是單趟全票(公車每段 15、捷運台鐵依距離,不含轉乘優惠與 TPASS),機車開車只算油錢不含停車費;等車抓這個時段的班距一半。
        </p>
      )}
    </section>
  );
}
