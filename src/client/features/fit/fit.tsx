import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, CircleAlert, CircleX, SlidersHorizontal } from "lucide-react";
import { computeFit, EMPTY_REQUIREMENTS, FIT_DIM_LABEL, hasRequirements, type FitLevel, type FitResult, type Requirements } from "@shared/fit";
import type { PropertySummary } from "@shared/schemas";
import { api } from "@/lib/api";
import { useCommute } from "@/features/commute/useCommute";
import { useMarket } from "@/features/market/useMarket";

export function useRequirements() {
  return useQuery({ queryKey: ["requirements"], queryFn: api.getRequirements, staleTime: 10 * 60_000 });
}
export function useSaveRequirements() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: api.putRequirements, onSuccess: (d) => qc.setQueryData(["requirements"], d) });
}

// 需求對話框:任何地方都能叫出來,Layout 放一個 RequirementsDialogHost
const OPEN_EVT = "rentmap:requirements-dialog";
export function openRequirementsDialog() {
  window.dispatchEvent(new Event(OPEN_EVT));
}
export function useRequirementsDialogOpen(): [boolean, (v: boolean) => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener(OPEN_EVT, on);
    return () => window.removeEventListener(OPEN_EVT, on);
  }, []);
  return [open, setOpen];
}

/**
 * 每間房的符合度。通勤取「每個地點的上班、下班」裡最久的一段(任何一段搭不到 = 搭不到);
 * 行情只用樣本足夠的。沒設需求 → configured=false、fitOf 一律 null。
 */
export function useFit() {
  const rq = useRequirements();
  const r = rq.data?.requirements ?? EMPTY_REQUIREMENTS;
  const configured = hasRequirements(r);
  const market = useMarket();
  const garbage = useQuery({
    queryKey: ["garbage-fit", r.garbage_max_m, r.garbage_after],
    queryFn: () => api.garbageFit(r.garbage_max_m, r.garbage_after!),
    enabled: r.garbage_after != null,
    staleTime: 30 * 60_000,
  });
  const nearby = useQuery({
    queryKey: ["nearby-summary", 500],
    queryFn: () => api.nearbySummary(500),
    enabled: r.avoid.length > 0,
    staleTime: 30 * 60_000,
  });
  const go = useCommute("go");
  const back = useCommute("back");
  const fitOf = useCallback(
    (p: PropertySummary): FitResult | null => {
      if (!configured) return null;
      let commuteMin: number | null | undefined;
      if (go.places.length && go.matrix && back.matrix) {
        if (p.lat == null || p.lng == null) commuteMin = undefined;
        else {
          commuteMin = 0;
          for (const m of [go.matrix, back.matrix])
            for (const pl of go.places) {
              const b = m.items[p.id]?.[pl.id];
              if (!b) commuteMin = null;
              else if (commuteMin !== null) commuteMin = Math.max(commuteMin, b.total_min);
            }
        }
      }
      const mb = market.data?.items[p.id];
      return computeFit(p, r, { commuteMin, marketDiff: mb?.enough ? mb.diff_pct : null, garbage: garbage.data?.items[p.id],
        nearest: nearby.data ? (nearby.data.nearest[p.id] ?? {}) : undefined,
      });
    },
    [configured, r, go.places, go.matrix, back.matrix, market.data, garbage.data, nearby.data],
  );
  return { configured, requirements: r, loaded: rq.isSuccess, fitOf };
}

export const FIT_COLOR: Record<FitLevel, string> = { green: "#059669", yellow: "#d97706", red: "#dc2626" };
const TONE: Record<FitLevel, string> = {
  green: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  yellow: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  red: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
};
const ICON = { green: CircleCheck, yellow: CircleAlert, red: CircleX };

export function fitLabel(f: FitResult) {
  if (f.fails.length) return "不符需求";
  return f.score == null ? "符合需求" : `符合 ${Math.round(f.score * 100)}%`;
}

/** 列表 / 比較表用的小標籤 */
export function FitBadge({ f, className = "" }: { f: FitResult | null | undefined; className?: string }) {
  if (!f) return null;
  const Icon = ICON[f.level];
  const tip = [...f.fails, ...f.dims.map((d) => `${FIT_DIM_LABEL[d.key]} ${Math.round(d.score * 100)}%:${d.note}`), ...(f.unknown.length ? [`不確定:${f.unknown.join("、")}`] : [])].join("\n");
  return (
    <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] whitespace-nowrap ${TONE[f.level]} ${className}`} title={tip}>
      <Icon size={11} />
      {fitLabel(f)}
    </span>
  );
}

/** 房源面板的「需求符合度」:不符的原因、各維度分數、不確定的欄位 */
export function FitSection({ p }: { p: PropertySummary | undefined }) {
  const { configured, loaded, fitOf } = useFit();
  if (!loaded || !p) return null;
  const head = (
    <div className="mb-1.5 flex items-center justify-between">
      <h2 className="flex items-center gap-1 text-xs font-medium text-neutral-500">
        <SlidersHorizontal size={14} /> 需求符合度
      </h2>
      <button onClick={openRequirementsDialog} className="text-xs text-neutral-500 underline">
        {configured ? "調整需求" : "設定需求"}
      </button>
    </div>
  );
  if (!configured)
    return (
      <section className="text-sm">
        {head}
        <p className="text-xs text-neutral-500">設定預算、坪數、通勤上限、必要設備後,每間房會標出符合度(綠 / 黃 / 紅)。</p>
      </section>
    );
  const f = fitOf(p);
  if (!f) return null;
  return (
    <section className="text-sm">
      {head}
      <div className="grid gap-1 rounded border border-neutral-200 p-2 dark:border-neutral-700">
        <div>
          <FitBadge f={f} />
        </div>
        {f.fails.map((x) => (
          <p key={x} className="flex items-center gap-1 text-xs text-red-700 dark:text-red-400">
            <CircleX size={12} /> {x}
          </p>
        ))}
        {f.dims.map((d) => (
          <div key={d.key} className="grid grid-cols-[3.5rem_1fr_auto] items-center gap-2 text-xs">
            <span className="text-neutral-500">{FIT_DIM_LABEL[d.key]}</span>
            <span className="h-1.5 rounded bg-neutral-100 dark:bg-neutral-800">
              <span className="block h-full rounded" style={{ width: `${Math.round(d.score * 100)}%`, background: d.score >= 0.75 ? FIT_COLOR.green : d.score >= 0.5 ? FIT_COLOR.yellow : FIT_COLOR.red }} />
            </span>
            <span className="text-neutral-600 dark:text-neutral-400">{d.note}</span>
          </div>
        ))}
        {f.unknown.length > 0 && <p className="text-[11px] text-neutral-500">不確定(房源沒寫):{f.unknown.join("、")}</p>}
      </div>
    </section>
  );
}
