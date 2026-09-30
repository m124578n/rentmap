import { ArrowDown, ArrowUp } from "lucide-react";
import type { PropertySummary } from "@shared/schemas";
import { usePrivatePool } from "@/lib/useAuth";
import { ageOf, fmtMoney, priceOf } from "./age";

/** 卡片上的小標:新上架 / 刊登 N 天 / 降價 / 漲價。沒有資料就什麼都不畫;公開版(沒有每日採集)不畫 */
export function ListingBadges({ p }: { p: Pick<PropertySummary, "posted_at" | "first_seen_at" | "price_history"> }) {
  const pool = usePrivatePool();
  const age = ageOf(p);
  const price = priceOf(p);
  const drop = price && price.totalDelta < 0;
  const rise = price && price.totalDelta > 0;
  if (!pool || (!age && !drop && !rise)) return null;
  return (
    <span className="flex flex-wrap items-center gap-1 text-[11px]">
      {age?.isNew && <span className="rounded bg-sky-100 px-1.5 py-0.5 font-medium text-sky-800 dark:bg-sky-900 dark:text-sky-200">新上架</span>}
      {drop && (
        <span
          className="flex items-center rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200"
          title={`從 ${fmtMoney(price.first)} 降到 ${fmtMoney(price.current)}(變價 ${price.changes} 次)`}
        >
          <ArrowDown size={11} />
          降 {fmtMoney(price.totalDelta)}
        </span>
      )}
      {rise && (
        <span className="flex items-center rounded bg-rose-100 px-1.5 py-0.5 font-medium text-rose-800 dark:bg-rose-900 dark:text-rose-200" title={`從 ${fmtMoney(price.first)} 漲到 ${fmtMoney(price.current)}`}>
          <ArrowUp size={11} />
          漲 {fmtMoney(price.totalDelta)}
        </span>
      )}
      {age && !age.isNew && (
        <span className="text-neutral-500" title={age.kind === "posted" ? "來源寫的刊登日到今天" : "來源沒寫刊登日;這是我們第一次看到它到今天,實際在架上只會更久"}>
          {age.kind === "posted" ? `刊登 ${age.days} 天` : `收錄 ${age.days} 天`}
        </span>
      )}
    </span>
  );
}
