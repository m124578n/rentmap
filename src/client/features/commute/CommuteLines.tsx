import { Route } from "lucide-react";
import type { CommuteMatrix } from "@shared/trip";
import type { Place } from "@shared/schemas";
import { BriefText } from "./CommuteSection";

/** 列表卡片上每個地點一行:「公司 約 25 分 · 262 → 捷運板南線」 */
export function CommuteLines({ propertyId, places, matrix, hasCoords }: { propertyId: number; places: Place[]; matrix: CommuteMatrix | undefined; hasCoords: boolean }) {
  const row = matrix?.items[propertyId];
  return (
    <div className="mt-1.5 grid gap-0.5 text-xs">
      {places.map((pl) => (
        <div key={pl.id} className="flex items-baseline gap-1.5">
          <Route size={12} className="shrink-0 self-center text-neutral-400" />
          <span className="shrink-0 text-neutral-500">{pl.name}</span>
          <span className="min-w-0 truncate">{!hasCoords ? <span className="text-neutral-400">沒有座標</span> : <BriefText b={matrix ? (row?.[pl.id] ?? null) : undefined} />}</span>
        </div>
      ))}
    </div>
  );
}
