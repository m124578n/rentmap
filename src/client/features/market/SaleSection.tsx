import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Landmark, Scale } from "lucide-react";
import { MORTGAGE_DEFAULT, mortgage, SALE_TYPES, type SaleType } from "@shared/sale";
import { api } from "@/lib/api";
import { monthlyCost } from "@shared/cost";

const wan = (n: number) => (n >= 1e8 ? `${(n / 1e8).toFixed(2)} 億` : `${Math.round(n / 1e4).toLocaleString()} 萬`);
const fmt = (n: number) => `$${n.toLocaleString()}`;
const chip = (on: boolean) =>
  `rounded-full border px-2 py-0.5 ${on ? "border-emerald-600 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "border-neutral-200 text-neutral-600 dark:border-neutral-700 dark:text-neutral-300"}`;

/**
 * 地址報告的「買房行情」:內政部買賣實價登錄同區同型態的每坪單價;填坪數就估總價,再接房貸試算。
 * 單價是政府公布的單價(車位分開計價時已扣),不含預售屋。
 */
export function SaleSection({
  city,
  district,
  initial,
}: {
  city: string;
  district: string;
  /** 買房筆記自己的條件(詳細頁用):型態、坪數、屋齡、總價 → 算「開價比行情」 */
  initial?: { type: SaleType | null; size: number | null; age: number | null; price: number | null };
}) {
  const [type, setType] = useState<SaleType>(initial?.type ?? "電梯大樓");
  const [size, setSize] = useState(initial?.size ? String(initial.size) : "");
  const [open, setOpen] = useState(false);
  const ping = Number(size) > 0 ? Number(size) : undefined;
  const age = initial?.age ?? undefined;
  const price = initial?.price ?? undefined;
  const q = useQuery({
    queryKey: ["sale-at", city, district, type, ping, age, price],
    queryFn: () => api.saleAt({ city, district, building_type: type, size_ping: ping, building_age: age, price }),
    staleTime: 10 * 60_000,
  });
  const m = q.data?.market;
  return (
    <section className="text-sm">
      <h2 className="mb-1.5 flex items-center gap-1 text-xs font-medium text-neutral-500">
        <Scale size={14} /> 買房行情(買賣實價登錄)
      </h2>
      <div className="mb-1.5 flex flex-wrap items-center gap-1 text-xs">
        {SALE_TYPES.map((t) => (
          <button key={t} onClick={() => setType(t)} className={chip(type === t)}>
            {t}
          </button>
        ))}
        <label className="ml-1 flex items-center gap-1 text-neutral-500">
          坪數
          <input value={size} onChange={(e) => setSize(e.target.value)} inputMode="decimal" className="input !w-16 !py-0.5 text-xs" placeholder="選填" />
        </label>
      </div>
      {!q.data ? (
        <p className="text-xs text-neutral-500">{q.isError ? "行情載入失敗" : "載入行情…"}</p>
      ) : !q.data.has_data ? (
        <p className="text-xs text-neutral-500">{city}還沒匯入買賣實價登錄(家裡跑 npm run collect -- sale-stats)。</p>
      ) : !m ? (
        <p className="text-xs text-neutral-500">
          {district}最近一年沒有{type}的買賣登錄。
        </p>
      ) : (
        <div className="rounded border border-neutral-200 p-2 dark:border-neutral-700">
          <p>
            每坪中位數 <b className="tabular-nums">{wan(m.unit_median)}</b>
            <span className="ml-1.5 text-xs text-neutral-500 tabular-nums">
              多數在 {wan(m.unit_p25)}–{wan(m.unit_p75)}
            </span>
          </p>
          {m.diff_pct != null && (
            <p className="mt-0.5">
              這間每坪約 {wan(Math.round(price! / ping!))},
              <span className={m.diff_pct >= 10 ? "text-red-700 dark:text-red-400" : m.diff_pct <= -10 ? "text-emerald-700 dark:text-emerald-400" : ""}>
                比行情 {m.diff_pct > 0 ? "+" : ""}
                {m.diff_pct}%
              </span>
            </p>
          )}
          {m.est_total != null && (
            <p className="mt-0.5">
              {ping} 坪約 <b className="tabular-nums">{wan(m.est_total)}</b>
              <span className="ml-1 text-xs text-neutral-500">(不含車位)</span>
            </p>
          )}
          <p className="mt-1 text-[11px] text-neutral-500">
            {m.scope === "city" ? `同區樣本不夠,改比全${city}` : district}
            {m.criteria.length ? ` · ${m.criteria.join("、")}` : ""} · {m.count} 筆({m.from.slice(0, 7)}~{m.to.slice(0, 7)})
            {!m.enough && <span className="text-amber-700 dark:text-amber-400"> · 樣本不足,僅供參考</span>}
          </p>
          <button onClick={() => setOpen(!open)} className="mt-1 flex items-center gap-0.5 text-[11px] text-emerald-700 underline dark:text-emerald-400">
            最像的 {m.comparables.length} 筆
            <ChevronDown size={12} className={open ? "rotate-180" : ""} />
          </button>
          {open && (
            <table className="mt-1 w-full text-[11px] tabular-nums">
              <tbody>
                {m.comparables.map((c, i) => (
                  <tr key={i} className="border-t border-neutral-100 dark:border-neutral-800">
                    <td className="py-0.5 pr-1 text-neutral-500">{c.date.slice(0, 7)}</td>
                    <td className="pr-1">{c.road ?? "—"}</td>
                    <td className="pr-1 text-neutral-500">{c.floor != null ? `${c.floor}${c.total_floors ? `/${c.total_floors}` : ""}F` : ""}</td>
                    <td className="pr-1 text-neutral-500">{c.size_ping != null ? `${c.size_ping}坪` : ""}</td>
                    <td className="pr-1 text-neutral-500">{c.building_age != null ? `${c.building_age}年` : ""}</td>
                    <td className="text-right">{wan(c.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-1 text-[11px] text-neutral-400">內政部不動產買賣實價登錄,近一年;不含預售屋、親友等特殊交易與整批多棟。</p>
        </div>
      )}
      {/* 筆記詳細頁已經有「每月支出」區塊,這裡只給房貸試算本身 */}
      <Mortgage defaultPrice={price ?? m?.est_total ?? null} sizePing={ping ?? null} showTotal={!initial} />
    </section>
  );
}

/** 房貸試算:本息平均攤還(可設寬限期);總價預設用上面估的總價 */
function Mortgage({ defaultPrice, sizePing, showTotal }: { defaultPrice: number | null; sizePing: number | null; showTotal: boolean }) {
  const [price, setPrice] = useState("");
  const [down, setDown] = useState(String(MORTGAGE_DEFAULT.down * 100));
  const [rate, setRate] = useState(String(MORTGAGE_DEFAULT.rate));
  const [years, setYears] = useState(String(MORTGAGE_DEFAULT.years));
  const [grace, setGrace] = useState("0");
  const total = Number(price) > 0 ? Number(price) * 1e4 : defaultPrice;
  const ok = total != null && Number(years) > 0 && Number(rate) >= 0 && Number(down) >= 0 && Number(down) < 100;
  const terms = { down: Number(down) / 100, rate: Number(rate), years: Number(years), grace: Number(grace) || 0 };
  const r = ok ? mortgage({ price: total!, ...terms }) : null;
  // 每月支出(估):房貸 + 水電 + 網路(同一套 shared/cost.ts;管理費、通勤看筆記本身)
  const cost = ok ? monthlyCost({ deal: "buy", price: total!, rent: null, size_ping: sizePing, mgmt_fee: null }, { mortgage: terms }) : null;
  const extra = cost ? cost.lines.filter((l) => l.key === "electricity" || l.key === "water" || l.key === "internet").reduce((a, l) => a + l.amount, 0) : 0;
  const field = "flex items-center gap-1 text-neutral-500";
  return (
    <div className="mt-2 rounded border border-neutral-200 p-2 text-xs dark:border-neutral-700">
      <p className="mb-1 flex items-center gap-1 font-medium text-neutral-600 dark:text-neutral-300">
        <Landmark size={13} /> 房貸試算
      </p>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        <label className={field}>
          總價
          <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="numeric" className="input !w-20 !py-0.5 text-xs" placeholder={defaultPrice ? String(Math.round(defaultPrice / 1e4)) : "萬"} />萬
        </label>
        <label className={field}>
          自備
          <input value={down} onChange={(e) => setDown(e.target.value)} inputMode="decimal" className="input !w-12 !py-0.5 text-xs" />%
        </label>
        <label className={field}>
          利率
          <input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" className="input !w-14 !py-0.5 text-xs" />%
        </label>
        <label className={field}>
          <input value={years} onChange={(e) => setYears(e.target.value)} inputMode="numeric" className="input !w-12 !py-0.5 text-xs" />年
        </label>
        <label className={field}>
          寬限
          <input value={grace} onChange={(e) => setGrace(e.target.value)} inputMode="numeric" className="input !w-10 !py-0.5 text-xs" />年
        </label>
      </div>
      {r ? (
        <p className="mt-1.5">
          貸 {wan(r.loan)}、自備 {wan(r.downPayment)}:每月約 <b className="tabular-nums">{fmt(r.monthly)}</b>
          {r.graceMonthly != null && <span className="text-neutral-500">(寬限期內 {fmt(r.graceMonthly)})</span>}
          <span className="ml-1 text-neutral-500">· 總利息約 {wan(r.totalInterest)}</span>
          {showTotal && extra > 0 && (
            <span className="block text-neutral-600 dark:text-neutral-300">
              加上水電、網路約 {fmt(extra)},每月約 <b className="tabular-nums">{fmt(r.monthly + extra)}</b>
              <span className="text-neutral-500">(不含管理費、通勤;存成筆記後會一起算)</span>
            </span>
          )}
        </p>
      ) : (
        <p className="mt-1.5 text-neutral-500">填總價(或上面填坪數估總價)就會算每月房貸。</p>
      )}
      <p className="mt-0.5 text-[11px] text-neutral-400">本息平均攤還的估算;實際利率、成數依銀行與個人條件,另有管理費、稅費、裝修。</p>
    </div>
  );
}
