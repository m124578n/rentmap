import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Columns3, ExternalLink, Star, X } from "lucide-react";
import { api } from "@/lib/api";
import { useFilters } from "@/lib/filters";
import type { PropertySummary } from "@shared/schemas";
import { DAY_LABEL } from "@shared/bus";
import { STAGE_LABEL, type Stage } from "@shared/constants";
import type { TripBrief } from "@shared/trip";
import { useCommute } from "@/features/commute/useCommute";
import { useMarket } from "@/features/market/useMarket";
import { MarketBadge } from "@/features/market/MarketSection";
import { ageOf, fmtMoney, priceOf } from "@/features/listing/age";
import { COMPARE_MAX, setCompare, toggleCompare, useCompare } from "@/features/compare/compare";
import { FitBadge, openRequirementsDialog, useFit } from "@/features/fit/fit";
import { useMonthlyCost } from "@/features/cost/cost";
import { FIT_DIM_LABEL } from "@shared/fit";
import { CRIME_CATS, NUISANCE_CATS, POI_CATEGORIES, POI_CATS, poiLabel } from "@shared/poi";
import { useCrimeDistricts } from "@/features/crime/CrimeSection";
import { HAZARD_KINDS, HAZARD_LABEL, hazardSevere, hazardText } from "@shared/hazard";

/** 一格:畫面上顯示什麼 + 比大小用的數字(null = 沒資料,不參與) */
interface Cell {
  node: ReactNode;
  v?: number | null;
}
interface Row {
  label: ReactNode;
  cells: Cell[];
  /** low = 越小越好、high = 越大越好;省略 = 不比 */
  better?: "low" | "high";
}

const dash = <span className="text-neutral-400">—</span>;
const yn = (b: boolean | null): Cell => ({ node: b == null ? dash : b ? "有" : "無", v: b == null ? null : b ? 1 : 0 });

/** 每列最好的是哪幾格;至少兩格有值、而且不是全部一樣才標 */
function bestOf(row: Row): Set<number> {
  const vals = row.cells.map((c) => c.v).filter((v): v is number => v != null);
  if (!row.better || vals.length < 2) return new Set();
  const best = row.better === "low" ? Math.min(...vals) : Math.max(...vals);
  if (vals.every((v) => v === best)) return new Set();
  return new Set(row.cells.flatMap((c, i) => (c.v === best ? [i] : [])));
}

function tripCell(b: TripBrief | null | undefined, hasCoords: boolean, loading: boolean): Cell {
  if (!hasCoords) return { node: <span className="text-neutral-400">沒有座標</span>, v: null };
  if (b === undefined && loading) return { node: <span className="text-neutral-400">計算中…</span>, v: null };
  if (!b) return { node: <span className="text-neutral-400">搭不到</span>, v: null };
  return {
    node: (
      <>
        <b className="tabular-nums">{b.total_min} 分</b>
        <div className="truncate text-[11px] text-neutral-500">{b.summary}</div>
      </>
    ),
    v: b.total_min,
  };
}

/** M8 比較表:2–4 間並排,每列標出最好的 */
export function ComparePage() {
  const ids = useCompare();
  const q = useQuery({ queryKey: ["properties"], queryFn: api.listProperties });
  const market = useMarket();
  const go = useCommute("go");
  const back = useCommute("back");
  const f = useFilters();
  const fit = useFit();
  const cost = useMonthlyCost(fit.requirements);
  const crimeDist = useCrimeDistricts();
  const hazards = useQuery({ queryKey: ["hazard-summary"], queryFn: api.hazardSummary, staleTime: 60 * 60_000 });
  const nearby = useQuery({ queryKey: ["nearby-summary", 500], queryFn: () => api.nearbySummary(500), staleTime: 30 * 60_000 });
  const byId = new Map((q.data?.items ?? []).map((p) => [p.id, p]));
  const props = ids.map((id) => byId.get(id)).filter((p): p is PropertySummary => !!p);

  if (q.isLoading) return <p className="p-4 text-neutral-500">載入中…</p>;
  if (props.length < 2)
    return (
      <div className="card m-4 text-sm">
        <p className="mb-2 flex items-center gap-1 font-medium">
          <Columns3 size={16} /> 比較表
        </p>
        <p className="text-neutral-600 dark:text-neutral-400">
          在列表或房源面板按「比較」,選 2–{COMPARE_MAX} 間就能並排比租金、行情、坪數、通勤…目前選了 {props.length} 間。
        </p>
        <Link to="/list" className="btn-primary mt-3 inline-flex">
          去列表挑
        </Link>
      </div>
    );

  const mk = (id: number) => market.data?.items[id];
  const groups: { title: string; rows: Row[] }[] = [
    {
      title: "需求",
      rows: fit.configured
        ? [
            {
              label: "符合度",
              better: "high",
              cells: props.map((p) => {
                const r = fit.fitOf(p);
                if (!r) return { node: dash, v: null };
                return {
                  node: (
                    <>
                      <FitBadge f={r} />
                      {r.fails.map((x) => (
                        <div key={x} className="text-[11px] text-red-600 dark:text-red-400">
                          {x}
                        </div>
                      ))}
                      {!r.fails.length && r.dims.length > 0 && (
                        <div className="text-[11px] text-neutral-500">
                          {r.dims.map((d) => `${FIT_DIM_LABEL[d.key]} ${Math.round(d.score * 100)}`).join(" · ")}
                        </div>
                      )}
                    </>
                  ),
                  // 不符的一律最低,其他比分數
                  v: r.fails.length ? -1 : (r.score ?? 1),
                };
              }),
            },
          ]
        : [
            {
              label: "符合度",
              cells: props.map((_, i) => ({
                node:
                  i === 0 ? (
                    <button onClick={openRequirementsDialog} className="text-xs text-emerald-700 underline dark:text-emerald-400">
                      設定需求就能比符合度
                    </button>
                  ) : (
                    ""
                  ),
              })),
            },
          ],
    },
    {
      title: "價格",
      rows: [
        { label: "租金", better: "low", cells: props.map((p) => ({ node: p.rent != null ? <b className="tabular-nums">{fmtMoney(p.rent)}</b> : dash, v: p.rent })) },
        {
          label: "比行情",
          better: "low",
          cells: props.map((p) => {
            const b = mk(p.id);
            if (!b || b.diff_pct == null) return { node: dash, v: null };
            return {
              node: (
                <>
                  <MarketBadge b={b} />
                  <div className="text-[11px] text-neutral-500 tabular-nums">
                    中位 {fmtMoney(b.median)}({b.count} 筆)
                  </div>
                </>
              ),
              v: b.enough ? b.diff_pct : null,
            };
          }),
        },
        {
          label: "每坪",
          better: "low",
          cells: props.map((p) => {
            const v = p.rent != null && p.size_ping ? Math.round(p.rent / p.size_ping) : null;
            return { node: v != null ? <span className="tabular-nums">{fmtMoney(v)}</span> : dash, v };
          }),
        },
        { label: "管理費", better: "low", cells: props.map((p) => ({ node: p.mgmt_fee != null ? fmtMoney(p.mgmt_fee) : dash, v: p.mgmt_fee })) },
        {
          label: "每月支出(估)",
          better: "low",
          cells: props.map((p) => {
            const c = cost.costOf(p);
            if (!c) return { node: dash, v: null };
            const tip = c.lines.map((l) => `${l.label} ${fmtMoney(l.amount)}${l.note ? `(${l.note})` : ""}`).join("\n");
            return { node: <span className="tabular-nums" title={tip}>{fmtMoney(c.total)}</span>, v: c.total };
          }),
        },
        {
          label: "價格變化",
          cells: props.map((p) => {
            const s = priceOf(p);
            if (!s || !s.totalDelta) return { node: <span className="text-neutral-400">沒變過</span> };
            return {
              node: <span className={s.totalDelta < 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-600"}>{`${s.totalDelta < 0 ? "降" : "漲"} ${fmtMoney(s.totalDelta)}`}</span>,
            };
          }),
        },
      ],
    },
    {
      title: "空間",
      rows: [
        { label: "房型", cells: props.map((p) => ({ node: p.kind ?? dash })) },
        { label: "坪數", better: "high", cells: props.map((p) => ({ node: p.size_ping != null ? `${p.size_ping} 坪` : dash, v: p.size_ping })) },
        { label: "房數", better: "high", cells: props.map((p) => ({ node: p.rooms != null ? `${p.rooms} 房` : dash, v: p.rooms })) },
        { label: "樓層", cells: props.map((p) => ({ node: p.floor != null ? `${p.floor}${p.total_floors != null ? ` / ${p.total_floors}` : ""} F` : dash })) },
        { label: "屋齡", better: "low", cells: props.map((p) => ({ node: p.building_age != null ? `${p.building_age} 年` : dash, v: p.building_age })) },
        { label: "型態", cells: props.map((p) => ({ node: p.building_type ?? dash })) },
      ],
    },
    {
      title: "設備與規定",
      rows: [
        { label: "電梯", better: "high", cells: props.map((p) => yn(p.has_elevator)) },
        { label: "可養寵物", better: "high", cells: props.map((p) => yn(p.pet_allowed)) },
        { label: "可開伙", better: "high", cells: props.map((p) => yn(p.cooking_allowed)) },
      ],
    },
    {
      title: "通勤",
      rows: go.places.length
        ? go.places.flatMap((pl): Row[] => [
            {
              label: (
                <>
                  上班 → {pl.name}
                  <div className="text-[11px] font-normal text-neutral-400">
                    {DAY_LABEL[f.commuteTimes.go.day]} {f.commuteTimes.go.time}
                  </div>
                </>
              ),
              better: "low",
              cells: props.map((p) => tripCell(go.matrix?.items[p.id]?.[pl.id], p.lat != null, go.isLoading)),
            },
            {
              label: (
                <>
                  下班 ← {pl.name}
                  <div className="text-[11px] font-normal text-neutral-400">
                    {DAY_LABEL[f.commuteTimes.back.day]} {f.commuteTimes.back.time}
                  </div>
                </>
              ),
              better: "low",
              cells: props.map((p) => tripCell(back.matrix?.items[p.id]?.[pl.id], p.lat != null, back.isLoading)),
            },
          ])
        : [{ label: "通勤", cells: props.map(() => ({ node: <span className="text-neutral-400">先設「我的地點」</span> })) }],
    },
    {
      title: "生活機能(走路 500m 內)",
      rows: nearby.data?.has_data
        ? POI_CATS.filter((c) => POI_CATEGORIES[c].main).map(
            (c): Row => ({
              label: poiLabel(c),
              better: "high",
              cells: props.map((p) => {
                const n = p.lat == null ? null : (nearby.data.items[p.id]?.[c] ?? 0);
                return { node: n == null ? dash : <span className="tabular-nums">{n}</span>, v: n };
              }),
            }),
          )
        : [],
    },
    {
      title: "治安(500m 內竊盜,近 3 年;只有台北市有點位)",
      rows:
        nearby.data?.has_data && crimeDist.data
          ? CRIME_CATS.map(
              (c): Row => ({
                label: poiLabel(c),
                better: "low",
                cells: props.map((p) => {
                  if (p.lat == null) return { node: dash, v: null };
                  if (!/^[台臺]北/.test(p.city)) return { node: <span className="text-neutral-400">沒有點位</span>, v: null };
                  const n = nearby.data.items[p.id]?.[c] ?? 0;
                  return { node: <span className="tabular-nums">{n}</span>, v: n };
                }),
              }),
            )
          : [],
    },
    {
      title: "嫌惡設施(最近距離,500m 內)",
      rows: nearby.data?.has_data
        ? NUISANCE_CATS.filter((c) => props.some((p) => nearby.data.nearest[p.id]?.[c] != null)).map(
            (c): Row => ({
              label: poiLabel(c),
              better: "high",
              cells: props.map((p) => {
                if (p.lat == null) return { node: dash, v: null };
                const d = nearby.data.nearest[p.id]?.[c];
                return d == null
                  ? { node: <span className="text-emerald-700 dark:text-emerald-400">500m 外</span>, v: 501 }
                  : { node: <span className={`tabular-nums ${d <= 100 ? "text-red-600" : d <= 300 ? "text-amber-700 dark:text-amber-400" : ""}`}>{d}m</span>, v: d };
              }),
            }),
          )
        : [],
    },
    {
      title: "災害風險",
      rows: hazards.data?.has_data
        ? HAZARD_KINDS.map(
            (k): Row => ({
              label: HAZARD_LABEL[k],
              better: "low",
              cells: props.map((p) => {
                if (p.lat == null) return { node: dash, v: null };
                // 液化只有台北市有資料:其他縣市不能說「不在潛勢區」
                if (k === "liquefaction" && !/^[台臺]北/.test(p.city ?? "")) return { node: <span className="text-neutral-400">沒有資料</span>, v: null };
                const lv = hazards.data.items[p.id]?.[k] ?? 0;
                const cls = !lv ? "text-emerald-700 dark:text-emerald-400" : hazardSevere(k, lv) ? "text-red-600 dark:text-red-400" : "text-amber-700 dark:text-amber-400";
                return { node: <span className={cls}>{hazardText(k, lv)}</span>, v: lv };
              }),
            }),
          )
        : [],
    },
    {
      title: "刊登",
      rows: [
        {
          label: "上架",
          cells: props.map((p) => {
            const a = ageOf(p);
            return { node: a ? `${a.kind === "posted" ? "刊登" : "收錄"} ${a.days} 天` : dash };
          }),
        },
        { label: "狀態", cells: props.map((p) => ({ node: p.listing_status === "removed" ? <span className="text-red-600">已下架</span> : p.listing_status === "active" ? "刊登中" : dash })) },
      ],
    },
    {
      title: "我的筆記",
      rows: [
        { label: "進度", cells: props.map((p) => ({ node: p.stage ? (STAGE_LABEL[p.stage as Stage] ?? p.stage) : <span className="text-neutral-400">未收藏</span> })) },
        {
          label: "星等",
          better: "high",
          cells: props.map((p) => ({
            node: p.priority ? (
              <span className="flex">
                {Array.from({ length: p.priority }, (_, i) => (
                  <Star key={i} size={13} className="fill-amber-400 text-amber-400" />
                ))}
              </span>
            ) : (
              dash
            ),
            v: p.priority,
          })),
        },
        { label: "標籤", cells: props.map((p) => ({ node: p.tags.length ? p.tags.join("、") : dash })) },
        { label: "備註", cells: props.map((p) => ({ node: p.fav_note ? <span className="text-xs whitespace-pre-wrap">{p.fav_note}</span> : dash })) },
      ],
    },
  ];
  // 整列都沒資料的不顯示
  for (const g of groups) g.rows = g.rows.filter((r) => r.cells.some((c) => c.node !== dash));
  const bests = groups.map((g) => g.rows.map(bestOf));
  const wins = props.map((_, i) => bests.flat().filter((s) => s.has(i)).length);

  return (
    <div className="p-3 sm:p-4">
      <div className="mb-2 flex items-center justify-between">
        <h1 className="flex items-center gap-1 font-semibold">
          <Columns3 size={18} /> 比較 {props.length} 間
        </h1>
        <button onClick={() => setCompare([])} className="text-xs text-neutral-500 underline">
          清空
        </button>
      </div>
      <div className="overflow-x-auto rounded border border-neutral-200 dark:border-neutral-800">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 w-24 bg-neutral-50 dark:bg-neutral-900" />
              {props.map((p, i) => (
                <th key={p.id} className="min-w-40 border-l border-neutral-200 bg-neutral-50 p-2 text-left align-top font-normal dark:border-neutral-800 dark:bg-neutral-900">
                  <div className="flex items-start justify-between gap-1">
                    <Link to="/p/$id" params={{ id: String(p.id) }} className="font-medium hover:underline">
                      {p.title}
                    </Link>
                    <button onClick={() => toggleCompare(p.id)} className="shrink-0 rounded p-0.5 text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700" aria-label="移出比較">
                      <X size={14} />
                    </button>
                  </div>
                  <div className="text-xs text-neutral-500">
                    {p.district}
                    {p.road ? ` ${p.road}` : ""}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs">
                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">勝出 {wins[i]} 項</span>
                    {p.source_url && (
                      <a href={p.source_url} target="_blank" rel="noreferrer" className="flex items-center gap-0.5 text-neutral-500 hover:underline">
                        原網頁 <ExternalLink size={11} />
                      </a>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g, gi) =>
              g.rows.length ? (
                <GroupRows key={g.title} title={g.title} rows={g.rows} bests={bests[gi]!} span={props.length + 1} />
              ) : null,
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-neutral-400">
        綠底 = 這一列最好的(租金、比行情、每坪、屋齡、通勤越低越好;坪數、房數、設備、星等越高越好)。比行情只算樣本足夠的;通勤時間跟著篩選列「通勤」的設定。
      </p>
    </div>
  );
}

function GroupRows({ title, rows, bests, span }: { title: string; rows: Row[]; bests: Set<number>[]; span: number }) {
  return (
    <>
      <tr>
        <td colSpan={span} className="bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-500 dark:bg-neutral-800">
          {title}
        </td>
      </tr>
      {rows.map((r, ri) => (
        <tr key={ri} className="border-t border-neutral-100 dark:border-neutral-800">
          <th className="sticky left-0 z-10 bg-white px-2 py-1.5 text-left align-top text-xs font-medium text-neutral-600 dark:bg-neutral-950 dark:text-neutral-400">{r.label}</th>
          {r.cells.map((c, i) => (
            <td
              key={i}
              className={`max-w-56 border-l border-neutral-100 px-2 py-1.5 align-top dark:border-neutral-800 ${bests[ri]!.has(i) ? "bg-emerald-50 dark:bg-emerald-950/60" : ""}`}
            >
              {c.node}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
