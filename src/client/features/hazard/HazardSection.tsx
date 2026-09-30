import { useQuery } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { HAZARD_KINDS, HAZARD_LABEL, HAZARD_NOTE, hazardLevelLabel, type HazardKind } from "@shared/hazard";
import { api } from "@/lib/api";

/** 淹水級距 1–5、液化 1–3 → 顏色:越嚴重越紅 */
function tone(kind: HazardKind, level: number | undefined) {
  if (!level) return "text-emerald-700 dark:text-emerald-400";
  const bad = kind === "liquefaction" ? level >= 3 : kind === "flood6" ? level >= 1 : level >= 2;
  return bad ? "text-red-600 dark:text-red-400 font-medium" : "text-amber-700 dark:text-amber-400";
}

/** 房源面板的「災害風險」:淹水(兩種降雨情境)、土壤液化 */
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
                  {none ? "沒有資料" : level ? (k === "liquefaction" ? hazardLevelLabel(k, level) : `可能淹 ${hazardLevelLabel(k, level)}`) : "不在潛勢區"}
                </span>
              </li>
            );
          })}
          <li className="text-[11px] text-neutral-400">
            水利署淹水潛勢圖(防洪設施正常運作下的模擬)、臺北市土壤液化潛勢圖;看的是這個點,一樓 / 地下室更要注意。
          </li>
        </ul>
      )}
    </section>
  );
}
