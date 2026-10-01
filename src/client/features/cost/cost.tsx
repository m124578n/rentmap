import { useCallback } from "react";
import { usePlan } from "@/lib/plan";
import { PlanLock } from "@/features/plan/PlanLock";
import { Wallet } from "lucide-react";
import type { PropertySummary } from "@shared/schemas";
import type { Requirements } from "@shared/fit";
import { monthlyCost, type MonthlyCost } from "@shared/cost";
import { useCommute } from "@/features/commute/useCommute";

const fmt = (n: number) => `$${n.toLocaleString()}`;

/**
 * 每間房的每月支出(估)。通勤費算到需求設定的「通勤地點」(沒設就第一個我的地點),上班 + 下班都用最快搭法。
 * 需求從外面傳進來(useRequirements 在 fit.tsx,避免互相 import)。
 */
export function useMonthlyCost(r: Pick<Requirements, "cost_place_id" | "commute_days" | "kwh">) {
  const go = useCommute("go");
  const back = useCommute("back");
  const place = go.places.find((p) => p.id === r.cost_place_id) ?? go.places[0];
  const costOf = useCallback(
    (p: PropertySummary): MonthlyCost | null => {
      const commute =
        place && p.lat != null && p.lng != null
          ? {
              place: place.name,
              go: go.matrix ? (go.matrix.items[p.id]?.[place.id] ?? null) : undefined,
              back: back.matrix ? (back.matrix.items[p.id]?.[place.id] ?? null) : undefined,
            }
          : undefined;
      return monthlyCost(p, { kwh: r.kwh, days: r.commute_days, commute });
    },
    [place, go.matrix, back.matrix, r.kwh, r.commute_days],
  );
  return { costOf, place };
}

/** 房源面板「每月支出(估)」:每一項金額與怎麼算的 */
export function CostSection({ cost }: { cost: MonthlyCost | null }) {
  const detail = usePlan().ent.costDetail;
  if (!cost) return null;
  return (
    <section className="text-sm">
      <h2 className="mb-1.5 flex items-center gap-1 text-xs font-medium text-neutral-500">
        <Wallet size={14} /> 每月支出(估)
      </h2>
      <div className="rounded border border-neutral-200 p-2 dark:border-neutral-700">
        <ul className="grid gap-0.5 text-xs">
          {(detail ? cost.lines : []).map((l) => (
            <li key={l.key} className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate">
                <span className="text-neutral-600 dark:text-neutral-400">{l.label}</span>
                {l.note && <span className="ml-1.5 text-[11px] text-neutral-400">{l.note}</span>}
              </span>
              <span className={`shrink-0 tabular-nums ${l.estimated ? "text-neutral-500" : ""}`}>
                {l.estimated && l.amount > 0 ? "≈" : ""}
                {fmt(l.amount)}
              </span>
            </li>
          ))}
          <li className="mt-0.5 flex items-baseline justify-between border-t border-neutral-100 pt-1 font-medium dark:border-neutral-800">
            <span>合計</span>
            <span className="tabular-nums">{fmt(cost.total)}</span>
          </li>
        </ul>
        {!detail && <PlanLock className="mt-1">每一項怎麼算(房租或房貸、管理費、水電、網路、通勤票價)是付費功能。</PlanLock>}
        <p className="mt-1 text-[11px] text-neutral-400">「≈」是估的:電費依台電累進或房東每度價、度數依房型估;通勤以 TPASS 1200 封頂。度數、通勤地點與天數可在「我的需求」改。</p>
      </div>
    </section>
  );
}
