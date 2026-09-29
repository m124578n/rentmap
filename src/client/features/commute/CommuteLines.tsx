import { Bus } from "lucide-react";
import type { CommuteMatrix } from "@shared/bus";
import type { Place } from "@shared/schemas";

/** 列表卡片上每個地點一行:「公司 約 17 分 · 262(另有 紅30)」 */
export function CommuteLines({ propertyId, places, matrix, hasCoords }: { propertyId: number; places: Place[]; matrix: CommuteMatrix | undefined; hasCoords: boolean }) {
  const row = matrix?.items[propertyId];
  return (
    <div className="mt-1.5 grid gap-0.5 text-xs">
      {places.map((pl) => {
        const b = row?.[pl.id];
        return (
          <div key={pl.id} className="flex items-baseline gap-1.5">
            <Bus size={12} className="shrink-0 self-center text-neutral-400" />
            <span className="shrink-0 text-neutral-500">{pl.name}</span>
            {!matrix ? (
              <span className="text-neutral-400">計算中…</span>
            ) : !matrix.has_bus ? (
              <span className="text-neutral-400">還沒有公車資料</span>
            ) : !hasCoords ? (
              <span className="text-neutral-400">沒有座標</span>
            ) : b ? (
              <span className="min-w-0 truncate" title={`走 ${b.board_walk} 分到 ${b.board} · 等 ${b.wait_min} · 坐 ${b.stops} 站 ${b.ride_min} 分到 ${b.alight} · 走 ${b.alight_walk} 分`}>
                <b className="tabular-nums">約 {b.total_min} 分</b> · {b.name}
                {b.others.length > 0 && <span className="text-neutral-400">(另有 {b.others.join("、")})</span>}
              </span>
            ) : (
              <span className="text-neutral-400">沒有直達公車</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
