import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Siren } from "lucide-react";
import { CRIME_CATS, poiLabel } from "@shared/poi";
import { coverageCities, hasCoverage, REGIONS, regionOfCity } from "@shared/regions";
import { useRegion } from "@/lib/region";
import { districtRank, type CrimeDistricts } from "@shared/crime";
import { api } from "@/lib/api";

export type { CrimeDistricts } from "@shared/crime";

export function useCrimeDistricts() {
  return useQuery({
    queryKey: ["crime-districts"],
    queryFn: async () => {
      const res = await fetch("/crime-districts.json");
      if (!res.ok) return null;
      return (await res.json()) as CrimeDistricts;
    },
    staleTime: Infinity,
  });
}

const KIND_LABEL = { house: "住宅", moto: "機車", car: "汽車", bike: "自行車" } as const;

/**
 * 房源面板「治安」:
 *   臺北市:500m 內近 3 年的竊盜點(警察局點位,巷 / 路段轉座標,約略)
 *   雙北:這個區近一年的件數與在雙北各區的排名(不是每人比率,人多的區自然多)
 */
export function CrimeSection({ lat, lng, city, district }: { lat: number; lng: number; city: string; district: string }) {
  const dist = useCrimeDistricts();
  const tp = hasCoverage(city, "theftPoints");
  const region = useRegion();
  const near = useQuery({ queryKey: ["nearby", lat, lng, 500], queryFn: () => api.nearby({ lat, lng, radius: 500 }), staleTime: 30 * 60_000, enabled: tp });
  const [open, setOpen] = useState(false);
  const d = dist.data;
  if (dist.isLoading) return null;
  const key = `${city.replace("臺", "台")}|${district}`;
  const row = d?.items[key];
  const period = d?.periods?.[city.replace("臺", "台")] ?? d;
  // 排名只跟同一個生活圈、有治安資料的縣市的區比(沒件數的區算 0;見 shared/crime.ts)
  // 房源所在的生活圈(在台中看台北的房源時,要跟北北基桃比)
  const home = REGIONS[regionOfCity(city) ?? region.key];
  const rank = (k: "house" | "moto") => (d ? districtRank(d.items, home.cities, city, district, k) : null);
  const houseRank = rank("house");
  const cases = CRIME_CATS.flatMap((c) => (near.data?.items[c] ?? []).map((p) => ({ ...p, c }))).sort((a, b) => a.distance_m - b.distance_m);

  return (
    <section className="text-sm">
      <h2 className="mb-1.5 flex items-center gap-1 text-xs font-medium text-neutral-500">
        <Siren size={14} /> 治安(竊盜)
      </h2>
      {!hasCoverage(city, "crimeDistricts") ? (
        <p className="text-xs text-neutral-500">{city}還沒有治安資料{coverageCities("crimeDistricts", home.key) ? `(目前只有${coverageCities("crimeDistricts", home.key)})` : ""}。</p>
      ) : !d ? (
        <p className="text-xs text-neutral-500">治安資料準備中。</p>
      ) : (
        <div className="grid gap-1 text-xs">
          {tp && near.data && (
            <div>
              <span className="text-neutral-600 dark:text-neutral-400">500m 內近 3 年</span>
              <span className="ml-1.5">
                {CRIME_CATS.map((c) => `${poiLabel(c)} ${near.data.counts[c] ?? 0}`).join(" · ")}
              </span>
              {cases.length > 0 && (
                <button onClick={() => setOpen(!open)} className="ml-1.5 inline-flex items-center text-[11px] text-emerald-700 underline dark:text-emerald-400">
                  最近的
                  <ChevronDown size={12} className={open ? "rotate-180" : ""} />
                </button>
              )}
              {open && (
                <ul className="mt-1 grid gap-0.5 text-[11px] text-neutral-600 dark:text-neutral-400">
                  {cases.slice(0, 8).map((p, i) => (
                    <li key={i} className="flex justify-between gap-2">
                      <span className="truncate">
                        {poiLabel(p.c)} · {p.name}
                      </span>
                      <span className="shrink-0 tabular-nums text-neutral-500">
                        {p.note} · {p.distance_m}m
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div>
            <span className="text-neutral-600 dark:text-neutral-400">{district}近一年</span>
            <span className="ml-1.5">
              {row ? (["house", "moto", "car", "bike"] as const).filter((k) => row[k] != null).map((k) => `${KIND_LABEL[k]} ${row[k]}`).join(" · ") : "沒有紀錄"}
            </span>
            {houseRank && (
              <span className="ml-1.5 text-neutral-500">
                (住宅竊盜{home.label} {houseRank.of} 區第 {houseRank.n} 多)
              </span>
            )}
          </div>
          <p className="text-[11px] text-neutral-400">
            警察局開放資料 {period!.from.slice(0, 7)}~{period!.to.slice(0, 7)}。{tp ? "點位是巷或路段的中點(門牌查不到),只能看大概;" : `${city}只到行政區、沒有點位;`}區的件數不是每人比率,人多的區自然多。
          </p>
        </div>
      )}
    </section>
  );
}
