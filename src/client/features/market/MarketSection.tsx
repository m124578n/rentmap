import { Pending } from "@/components/Pending";
import { useState } from "react";
import { PlanLock } from "@/features/plan/PlanLock";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Scale } from "lucide-react";
import type { MarketBrief, MarketResponse, MarketResult } from "@shared/market";
import { api } from "@/lib/api";
import type { Kind } from "@shared/constants";

const fmt = (n: number) => `$${n.toLocaleString()}`;

/** 「比行情 +6%」:高 10% 以上紅、低 10% 以上綠,樣本不足灰 */
export function MarketBadge({ b, className = "" }: { b: MarketBrief | null | undefined; className?: string }) {
  if (!b || b.diff_pct == null) return null;
  const d = b.diff_pct;
  const tone = !b.enough
    ? "bg-neutral-100 text-neutral-500 dark:bg-neutral-800"
    : d >= 10
      ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
      : d <= -10
        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
        : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] whitespace-nowrap tabular-nums ${tone} ${className}`} title={b.sale ? `買賣實價登錄同區同型態每坪中位數 ${Math.round(b.median / 1e4)} 萬(${b.count} 筆${b.enough ? "" : ",樣本不足"})` : `實價登錄同區同房型中位數 ${fmt(b.median)}(${b.count} 筆${b.enough ? "" : ",樣本不足"})`}>
      比行情 {d > 0 ? "+" : ""}
      {d}%
    </span>
  );
}

/** 房源面板的「租金行情」:實價登錄同區同房型的四分位、這間落在哪、最像的幾筆 */
export function MarketSection({ propertyId, city, district, kind, rent }: { propertyId: number; city: string; district: string; kind: string | null; rent: number | null }) {
  const q = useQuery({ queryKey: ["property-market", propertyId, rent], queryFn: () => api.propertyMarket(propertyId), staleTime: 10 * 60_000 });
  if (q.isLoading || !q.data) return null;
  return <MarketView data={q.data} city={city} district={district} kind={kind} rent={rent} />;
}

/** 地址即報告:還沒存成房源的點,選房型(可填坪數、租金)看行情 */
export function PointMarketSection({ city, district }: { city: string; district: string }) {
  const [kind, setKind] = useState<Kind>("獨立套房");
  const q = useQuery({ queryKey: ["market-at", city, district, kind], queryFn: () => api.marketAt({ city, district, kind }), staleTime: 10 * 60_000 });
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap gap-1 text-xs">
        {POINT_KINDS.map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={`rounded-full border px-2 py-0.5 ${kind === k ? "border-emerald-600 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "border-neutral-200 text-neutral-600 dark:border-neutral-700 dark:text-neutral-300"}`}
          >
            {k}
          </button>
        ))}
      </div>
      {q.data ? <MarketView data={q.data} city={city} district={district} kind={kind} rent={null} /> : <p className="text-xs text-neutral-500">{q.isError ? "行情載入失敗" : "載入行情…"}</p>}
    </div>
  );
}

const POINT_KINDS = ["整層住家", "獨立套房", "分租套房", "雅房"] as const satisfies readonly Kind[];

function MarketView({ data, city, district, kind, rent }: { data: MarketResponse; city: string; district: string; kind: string | null; rent: number | null }) {
  const [open, setOpen] = useState(false);
  const { has_data, market: m, asking } = data;
  const head = (
    <h2 className="mb-1.5 flex items-center gap-1 text-xs font-medium text-neutral-500">
      <Scale size={14} /> 租金行情(實價登錄)
    </h2>
  );
  if (!has_data)
    return (
      <section className="text-sm">
        {head}
        <Pending what="租賃實價登錄" cmd="npm run collect -- rent-stats" />
        <Asking a={asking} m={null} city={city} district={district} kind={kind} />
      </section>
    );
  if (!m)
    return (
      <section className="text-sm">
        {head}
        <p className="text-xs text-neutral-500">{kind ? `${district}最近一年沒有${kind}的租賃登錄。` : "這間沒有房型資料,算不出行情。"}</p>
        <Asking a={asking} m={null} city={city} district={district} kind={kind} />
      </section>
    );

  // 範圍條:p25–p75 的框、中位數的線、這間的點
  const lo = Math.min(m.p25, rent ?? m.p25) * 0.85;
  const hi = Math.max(m.p75, rent ?? m.p75) * 1.15;
  const pos = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  return (
    <section className="text-sm">
      {head}
      <div className="rounded border border-neutral-200 p-2 dark:border-neutral-700">
        <div className="flex items-baseline justify-between gap-2">
          <span>
            中位數 <b className="tabular-nums">{fmt(m.median)}</b>
            <span className="ml-1.5 text-xs text-neutral-500 tabular-nums">
              多數在 {fmt(m.p25)}–{fmt(m.p75)}
            </span>
          </span>
          <MarketBadge b={m} />
        </div>
        <div className="relative mt-2 mb-1 h-2 rounded bg-neutral-100 dark:bg-neutral-800">
          <div className="absolute inset-y-0 rounded bg-sky-200 dark:bg-sky-900" style={{ left: pos(m.p25), right: `calc(100% - ${pos(m.p75)})` }} />
          <div className="absolute -inset-y-0.5 w-0.5 bg-sky-700 dark:bg-sky-300" style={{ left: pos(m.median) }} />
          {rent != null && <div className="absolute -top-1 h-4 w-1.5 -translate-x-1/2 rounded-sm bg-emerald-600" style={{ left: pos(rent) }} title={`這間 ${fmt(rent)}`} />}
        </div>
        <p className="text-[11px] text-neutral-500">
          {m.scope === "city" ? `同區樣本不夠,改比全${city}` : district}
          {kind}
          {m.criteria.length ? `、${m.criteria.join("、")}` : ""} · {m.count} 筆({m.from.slice(0, 7)}~{m.to.slice(0, 7)})
          {m.per_ping_median != null && ` · 每坪中位 ${fmt(m.per_ping_median)}`}
          {!m.enough && <span className="text-amber-700 dark:text-amber-400"> · 樣本不足,僅供參考</span>}
        </p>
        {data.detail_locked ? (
          <PlanLock className="mt-1">最像的幾筆成交明細是完整版的功能。</PlanLock>
        ) : (
          <button onClick={() => setOpen(!open)} className="mt-1 flex items-center gap-0.5 text-[11px] text-emerald-700 underline dark:text-emerald-400">
            最像的 {m.comparables.length} 筆
            <ChevronDown size={12} className={open ? "rotate-180" : ""} />
          </button>
        )}
        {open && !data.detail_locked && (
          <table className="mt-1 w-full text-[11px] tabular-nums">
            <tbody>
              {m.comparables.map((c, i) => (
                <tr key={i} className="border-t border-neutral-100 dark:border-neutral-800">
                  <td className="py-0.5 pr-1 text-neutral-500">{c.date.slice(0, 7)}</td>
                  <td className="pr-1">{c.road ?? "—"}</td>
                  <td className="pr-1 text-neutral-500">
                    {c.floor != null ? `${c.floor}${c.total_floors ? `/${c.total_floors}` : ""}F` : ""}
                  </td>
                  <td className="pr-1 text-neutral-500">{c.size_ping != null ? `${c.size_ping}坪` : ""}</td>
                  <td className="pr-1 text-neutral-500">{c.rooms != null ? `${c.rooms}房` : ""}</td>
                  <td className="text-right">{fmt(c.rent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-1 text-[11px] text-neutral-400">內政部租賃實價登錄(簽約租金),近一年;不含社宅包租代管與含車位的案件。</p>
        <Asking a={asking} m={m} city={city} district={district} kind={kind} />
      </div>
    </section>
  );
}

/**
 * 目前開價:系統裡還在刊登的相似房源(591 / 好房)。刊登價通常比簽約價高,
 * 所以跟實價登錄並列、標出「開價比成交高幾 %」,讓人知道殺價空間大概多少。
 */
function Asking({ a, m, city, district, kind }: { a: MarketResponse["asking"]; m: MarketResult | null; city: string; district: string; kind: string | null }) {
  if (!a) return null;
  const gap = m && m.median > 0 ? Math.round(((a.median - m.median) / m.median) * 100) : null;
  return (
    <div className="mt-2 border-t border-neutral-100 pt-1.5 text-xs dark:border-neutral-800">
      <div className="flex items-baseline justify-between gap-2">
        <span>
          目前開價中位數 <b className="tabular-nums">{fmt(a.median)}</b>
          <span className="ml-1.5 text-neutral-500 tabular-nums">
            多數在 {fmt(a.p25)}–{fmt(a.p75)}
          </span>
        </span>
        {a.diff_pct != null && (
          <span className="text-[11px] whitespace-nowrap text-neutral-500 tabular-nums">
            這間 {a.diff_pct > 0 ? "+" : ""}
            {a.diff_pct}%
          </span>
        )}
      </div>
      <p className="text-[11px] text-neutral-500">
        系統裡刊登中的{a.scope === "city" ? `全${city}` : district}
        {kind}
        {a.criteria.length ? `、${a.criteria.join("、")}` : ""} · {a.count} 間
        {gap != null && ` · 開價比成交${gap >= 0 ? "高" : "低"} ${Math.abs(gap)}%`}
        {!a.enough && <span className="text-amber-700 dark:text-amber-400"> · 樣本不足</span>}
      </p>
    </div>
  );
}
