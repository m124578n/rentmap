import { History } from "lucide-react";
import { priceSteps, twDate, type PricePoint } from "@shared/listing";
import { ListingBadges } from "./ListingBadges";

/** 日期(YYYY-MM-DD 或 ISO 時間)→ 台灣日期「9/24」,不是今年才加年份;不受瀏覽器時區影響 */
const md = (iso: string) => {
  const [y, m, d] = (iso.length === 10 ? iso : twDate(new Date(iso))).split("-").map(Number);
  return `${y === Number(twDate(new Date()).slice(0, 4)) ? "" : `${y}/`}${m}/${d}`;
};

/** 面板的「價格與刊登」:小標 + 價格時間軸 + 刊登 / 收錄 / 最後看到 */
export function PriceAgeSection({
  history,
  postedAt,
  firstSeenAt,
  lastSeenAt,
  status,
}: {
  history: PricePoint[];
  postedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  status: string;
}) {
  const steps = priceSteps(history);
  return (
    <section className="text-sm">
      <h2 className="mb-1.5 flex items-center gap-1 text-xs font-medium text-neutral-500">
        <History size={14} /> 價格與刊登
      </h2>
      <ListingBadges p={{ posted_at: postedAt, first_seen_at: firstSeenAt, price_history: history }} />
      {steps.length > 1 && (
        <ol className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
          {steps.map((s, i) => {
            const d = i > 0 ? s.rent - steps[i - 1]!.rent : 0;
            return (
              <li key={s.at} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-neutral-400">→</span>}
                <span>
                  <span className="text-neutral-500">{md(s.at)}</span> <b className="tabular-nums">${s.rent.toLocaleString()}</b>
                  {d !== 0 && (
                    <span className={d < 0 ? "ml-0.5 text-emerald-700 dark:text-emerald-400" : "ml-0.5 text-rose-700 dark:text-rose-400"}>
                      ({d > 0 ? "+" : "−"}
                      {Math.abs(d).toLocaleString()})
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <p className="mt-1 text-xs text-neutral-500">
        {postedAt ? `來源刊登 ${md(postedAt)} · ` : ""}收錄 {md(firstSeenAt)} · {status === "active" ? `最後看到 ${md(lastSeenAt)}` : `下架前最後看到 ${md(lastSeenAt)}`}
        {steps.length <= 1 && " · 收錄以來沒變價"}
      </p>
    </section>
  );
}
