import { useQuery } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { HAZARD_KINDS, HAZARD_LABEL, HAZARD_NOTE, hazardSevere, hazardText, type HazardKind } from "@shared/hazard";
import { api } from "@/lib/api";

/** 顏色:不在區內綠、嚴重紅、其他黃 */
function tone(kind: HazardKind, level: number | undefined) {
  if (!level) return "text-emerald-700 dark:text-emerald-400";
  return hazardSevere(kind, level) ? "text-red-600 dark:text-red-400 font-medium" : "text-amber-700 dark:text-amber-400";
}

/** 房源面板的「災害風險」:淹水(兩種降雨情境)、土壤液化、航空噪音 */
export function HazardSection({ lat, lng, city }: { lat: number; lng: number; city: string }) {
  const q = useQuery({ queryKey: ["hazards", lat, lng, city], queryFn: () => api.hazards(lat, lng, city), staleTime: 60 * 60_000 });
  if (!q.data) return null;
  const d = q.data;
  return (
    <section className="text-sm">
      <h2 className="mb-1.5 flex items-center gap-1 text-xs font-medium text-neutral-500">
        <ShieldAlert size={14} /> 災害風險
      </h2>
      {!d.has_data ? (
        <p className="text-xs text-neutral-500">還沒匯入災害潛勢圖資(家裡跑 python scripts/build_hazards.py 再 npm run collect -- hazards)。</p>
      ) : (
        <ul className="grid gap-0.5 text-xs">
          {HAZARD_KINDS.map((k) => {
            const level = d.levels[k];
            const none = d.no_coverage.includes(k);
            return (
              <li key={k} className="flex items-baseline justify-between gap-2" title={HAZARD_NOTE[k]}>
                <span className="text-neutral-600 dark:text-neutral-400">{HAZARD_LABEL[k]}</span>
                <span className={none ? "text-neutral-400" : tone(k, level)}>
                  {none ? "沒有資料" : hazardText(k, level)}
                </span>
              </li>
            );
          })}
          <li className="text-[11px] text-neutral-400">
            水利署淹水潛勢圖(防洪設施正常運作下的模擬)、臺北市土壤液化潛勢圖、環保局航空噪音防制區(依里公告);看的是這個點,一樓 / 地下室更要注意淹水。
          </li>
        </ul>
      )}
    </section>
  );
}
