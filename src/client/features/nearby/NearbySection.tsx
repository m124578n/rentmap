import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Star, Store } from "lucide-react";
import { googleNearbyUrl, isCrime, isNuisance, NUISANCE_CATS, POI_CATEGORIES, POI_CATS, POI_SUBTYPE_LABEL, poiLabel, type NearbyPoi, type PoiCat } from "@shared/poi";
import { api } from "@/lib/api";
import type { BusOverlay } from "@/features/map/busLayer";
import { hasCoverage, normalizeCity } from "@shared/regions";

/** 半徑圈(給地圖畫虛線) */
function circle(lat: number, lng: number, r: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * 2 * Math.PI;
    out.push([lng + (r * Math.cos(a)) / (111320 * Math.cos((lat * Math.PI) / 180)), lat + (r * Math.sin(a)) / 111320]);
  }
  return out;
}

/**
 * 房源面板的「生活機能」:半徑內每類幾個(主要類別常駐、其他收在「更多」),
 * 點一類列出最近 5 個並畫到地圖上。資料 OSM(小店會缺)+ menmap 拉麵,餐飲給 Google Maps 出口。
 */
export function NearbySection({
  lat,
  lng,
  onOverlay,
  garbageService,
  city,
}: {
  lat: number;
  lng: number;
  onOverlay?: (o: BusOverlay | null) => void;
  /** 房東有沒有寫垃圾代收(true 有寫、false 寫明要自己追、null 沒寫) */
  garbageService?: boolean | null;
  /** 縣市:垃圾車、YouBike 各縣市各自的資料,沒有的顯示「無資料」而不是 0 */
  city?: string;
}) {
  const [radius, setRadius] = useState(500);
  const [open, setOpen] = useState<PoiCat | null>(null);
  const [more, setMore] = useState(false);
  const q = useQuery({ queryKey: ["nearby", lat, lng, radius], queryFn: () => api.nearby({ lat, lng, radius }), staleTime: 30 * 60_000 });
  const items = open ? (q.data?.items[open] ?? []) : [];

  useEffect(() => {
    if (!onOverlay) return;
    if (!open || !items.length) return onOverlay(null);
    onOverlay({
      lines: [{ coords: circle(lat, lng, radius), kind: "walk", color: "#6b7280" }],
      stops: items.map((p) => ({ name: p.name ?? POI_SUBTYPE_LABEL[p.subtype ?? ""] ?? poiLabel(open), lat: p.lat, lng: p.lng, role: "transfer" as const })),
      focus: [[lng, lat], ...items.map((p): [number, number] => [p.lng, p.lat])],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, q.data, onOverlay]);
  useEffect(() => () => onOverlay?.(null), [onOverlay]);

  if (!q.data) return null;
  const d = q.data;
  const cats = POI_CATS.filter((c) => !isNuisance(c) && !isCrime(c) && (more || POI_CATEGORIES[c].main || (c === "ramen" && (d.counts.ramen ?? 0) > 0)));
  // 嫌惡設施:半徑內有的才列,顯示最近距離
  const nuisances = NUISANCE_CATS.map((c) => ({ c, d: d.items[c]?.[0]?.distance_m })).filter((x): x is { c: PoiCat; d: number } => x.d != null).sort((a, b) => a.d - b.d);

  return (
    <section className="text-sm">
      <div className="mb-1.5 flex items-center justify-between">
        <h2 className="flex items-center gap-1 text-xs font-medium text-neutral-500">
          <Store size={14} /> 生活機能
        </h2>
        <div className="flex items-center gap-1 text-[11px] text-neutral-500">
          走路
          {[500, 1000].map((r) => (
            <button
              key={r}
              onClick={() => setRadius(r)}
              className={`rounded px-1.5 py-0.5 ${radius === r ? "bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
            >
              {r === 500 ? "500m" : "1km"}
            </button>
          ))}
          內
        </div>
      </div>
      {!d.has_data ? (
        <p className="text-xs text-neutral-500">還沒匯入生活機能資料(家裡跑 npm run collect -- pois)。</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1">
            {cats.map((c) => {
              const n = d.counts[c] ?? 0;
              const noData = !!city && (c === "garbage" || c === "youbike") && !hasCoverage(city, c);
              return (
                <button
                  title={noData ? `${city}還沒有這項資料` : undefined}
                  key={c}
                  onClick={() => setOpen(open === c ? null : c)}
                  disabled={n === 0}
                  className={`rounded-full border px-2 py-0.5 text-xs tabular-nums ${
                    open === c
                      ? "border-amber-500 bg-amber-500 text-white"
                      : n === 0
                        ? "border-neutral-200 text-neutral-400 dark:border-neutral-800"
                        : "border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                  }`}
                >
                  {poiLabel(c)} {noData ? "無資料" : n}
                </button>
              );
            })}
            <button onClick={() => setMore(!more)} className="px-1 text-xs text-neutral-500 underline">
              {more ? "收起" : "更多"}
            </button>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <span className="text-[11px] text-neutral-500">注意</span>
            {nuisances.length === 0 && <span className="text-[11px] text-emerald-700 dark:text-emerald-400">{radius === 500 ? "500m" : "1km"} 內沒有加油站、變電所、殯葬、快速道路等</span>}
            {nuisances.map(({ c, d: dist }) => (
              <button
                key={c}
                onClick={() => setOpen(open === c ? null : c)}
                title="最近的距離"
                className={`rounded-full border px-2 py-0.5 text-xs tabular-nums ${
                  open === c
                    ? "border-amber-500 bg-amber-500 text-white"
                    : dist <= 100
                      ? "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
                      : dist <= 300
                        ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
                        : "border-neutral-300 text-neutral-600 dark:border-neutral-700 dark:text-neutral-300"
                }`}
              >
                {poiLabel(c)} {dist}m
              </button>
            ))}
          </div>
          {open === "garbage" && <GarbageList items={items} service={garbageService ?? null} city={city} />}
          {open && open !== "garbage" && (
            <ul className="mt-1.5 grid gap-0.5 rounded bg-neutral-50 p-2 text-xs dark:bg-neutral-800/60">
              {items.map((p, i) => (
                <PoiRow key={i} p={p} cat={open} />
              ))}
              {(d.counts[open] ?? 0) > items.length && <li className="text-neutral-400">…共 {d.counts[open]} 個,列最近的 {items.length} 個</li>}
            </ul>
          )}
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-neutral-400">
            <span>資料:OpenStreetMap(小店可能缺)、麵咩撲拉麵、雙北環保局垃圾車</span>
            <a href={googleNearbyUrl("餐廳", lat, lng)} target="_blank" rel="noreferrer" className="flex items-center gap-0.5 text-emerald-700 underline dark:text-emerald-400">
              Google Maps 看附近餐廳 <ExternalLink size={10} />
            </a>
          </p>
        </>
      )}
    </section>
  );
}

/** 垃圾車:同一地點合併成一行(午、晚兩班),依距離;上面標房東有沒有寫代收 */
function GarbageList({ items, service, city }: { items: NearbyPoi[]; service: boolean | null; city?: string }) {
  const places = new Map<string, { name: string; distance_m: number; walk_min: number; times: { minute: number; note: string }[] }>();
  for (const p of items) {
    const k = p.name ?? `${p.lat},${p.lng}`;
    const cur = places.get(k) ?? places.set(k, { name: p.name ?? "(沒有名稱)", distance_m: p.distance_m, walk_min: p.walk_min, times: [] }).get(k)!;
    if (p.minute != null && !cur.times.some((t) => t.minute === p.minute)) cur.times.push({ minute: p.minute, note: p.note ?? "" });
  }
  const list = [...places.values()].slice(0, 6);
  const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return (
    <div className="mt-1.5 grid gap-1 rounded bg-neutral-50 p-2 text-xs dark:bg-neutral-800/60">
      {service === true && <p className="text-emerald-700 dark:text-emerald-400">房東有寫垃圾代收 / 集中處理,不用追車</p>}
      {service === false && <p className="text-amber-700 dark:text-amber-400">房東寫明要自己追垃圾車</p>}
      <ul className="grid gap-0.5">
        {list.map((p) => {
          const days = p.times[0]?.note.split(" · ")[1];
          return (
            <li key={p.name} className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate">
                {p.name}
                <span className="ml-1 font-medium tabular-nums">{p.times.sort((a, b) => a.minute - b.minute).map((t) => fmt(t.minute)).join("、")}</span>
                {days && <span className="ml-1 text-neutral-400">{days}</span>}
              </span>
              <span className="shrink-0 text-neutral-500 tabular-nums">
                走 {p.walk_min} 分 · {p.distance_m}m
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-[11px] text-neutral-400">表定時間,實際可能早晚幾分鐘{normalizeCity(city) === "台北市" ? ";台北市週三、週日不收一般垃圾" : ""}。</p>
    </div>
  );
}

function PoiRow({ p, cat }: { p: NearbyPoi; cat: PoiCat }) {
  const kind = POI_SUBTYPE_LABEL[p.subtype ?? ""] ?? p.subtype ?? poiLabel(cat);
  const name = p.name ?? <span className="text-neutral-400">(沒有名稱的{kind})</span>;
  return (
    <li className="flex items-baseline justify-between gap-2">
      <span className="min-w-0 truncate">
        {p.url ? (
          <a href={p.url} target="_blank" rel="noreferrer" className="underline">
            {name}
          </a>
        ) : (
          name
        )}
        {p.name && kind !== p.name && kind !== poiLabel(cat) && <span className="ml-1 text-neutral-400">{kind}</span>}
        {p.rating != null && (
          <span className="ml-1 inline-flex items-center text-amber-600">
            <Star size={10} className="fill-amber-400 text-amber-400" />
            {p.rating.toFixed(1)}
          </span>
        )}
      </span>
      <span className="shrink-0 text-neutral-500 tabular-nums">
        走 {p.walk_min} 分 · {p.distance_m}m
      </span>
    </li>
  );
}
