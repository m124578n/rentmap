import { useMemo, useState } from "react";
import { useNarrow } from "@/lib/useNarrow";
import { Bike, Bus, Car, ChevronDown, Crosshair, ExternalLink, Link2, MapPin, Scale, SlidersHorizontal, Trash2, TrainFront, X } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CommuteWhen } from "@shared/trip";
import { api } from "@/lib/api";
import { COMBINE_LABEL, COMBINES, DEFAULT_RINGS, RING_COLOR, RING_LABEL, SCORE_KEYS, SCORE_LABEL, lifeSentence, rentOf, scoreDistricts, type ZoneDistrict, type ZonesResponse } from "@shared/zones";
import { useCrimeDistricts } from "@/features/crime/CrimeSection";
import { useRequirements } from "@/features/fit/fit";
import { openPlacesDialog } from "@/features/places/places";
import { planError } from "@/lib/plan";
import { usePurpose } from "@/lib/purpose";
import { DEAL_LABEL, areaLinks, stationSearch, type Deal } from "./links";
import { setZonesSettings, type ZonesSettings } from "./useZones";

const MODES = [
  { k: "transit", label: "大眾運輸", icon: <Bus size={13} /> },
  { k: "scooter", label: "機車", icon: <Bike size={13} /> },
  { k: "car", label: "開車", icon: <Car size={13} /> },
] as const;
const RENT_KINDS = ["整層住家", "獨立套房", "分租套房", "雅房"];
const $ = (n: number) => `$${Math.round(n).toLocaleString()}`;
const wan = (n: number) => `${(n / 10000).toFixed(1)} 萬`;

/**
 * 「適合你落腳的地方」:依到我的地點的通勤時間分圈,列出圈內的區(落腳分數排名)、車站、行情與外部搜尋連結,可以挑兩區比較。
 */
export function ZonesPanel({
  s,
  data,
  loading,
  error,
  nPlaces,
  onFocus,
  onClose,
  readOnly = false,
  share,
}: {
  s: ZonesSettings;
  data: ZonesResponse | undefined;
  loading: boolean;
  error: unknown;
  nPlaces: number;
  onFocus: (bbox: [number, number, number, number]) => void;
  onClose?: () => void;
  /** 分享頁:不能改設定、不看預算、不能分享 */
  readOnly?: boolean;
  /** 建立分享連結要用的(目前的生活圈與時段) */
  share?: { region: string; when: CommuteWhen };
}) {
  const purpose = usePurpose();
  const deal = purpose === "buy" ? "buy" : "rent";
  const req = useRequirements(!readOnly).data?.requirements;
  const budget = deal === "rent" && !readOnly ? (req?.budget_max ?? null) : null;
  const crime = useCrimeDistricts().data;
  const [showWeights, setShowWeights] = useState(false);
  // 手機:設定預設收成一行,排名清單往上
  const narrow = useNarrow();
  const [showSettings, setShowSettings] = useState(!narrow);
  const [pick, setPick] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  const ranked = useMemo(() => {
    if (!data) return [];
    const ds = data.districts;
    const scores = scoreDistricts(ds, s.weights, {
      rentKind: s.rentKind,
      crimeOf: (d) => crime?.items[`${d.city}|${d.district}`]?.house ?? null,
    });
    return ds
      .map((d, i) => ({ d, score: scores[i] ?? null, over: budget != null && (rentOf(d, s.rentKind) ?? 0) > budget }))
      .filter((x) => !(s.budgetOnly && x.over))
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.d.median - b.d.median);
  }, [data, s.weights, s.rentKind, s.budgetOnly, crime, budget]);
  const keyOf = (d: ZoneDistrict) => `${d.city}|${d.district}`;
  const picked = ranked.filter((x) => pick.includes(keyOf(x.d)));

  return (
    <div className="grid gap-3 p-4 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1 font-semibold">
            <MapPin size={16} className="text-emerald-600" /> 適合你落腳的地方
          </h2>
          <p className="text-xs text-neutral-500">{readOnly ? "依到這些地點的通勤時間分圈。" : "依到「我的地點」的通勤時間分圈;時段跟著篩選列的上班 / 下班。"}</p>
        </div>
        {onClose && (
          <button onClick={onClose} className="btn-ghost !p-1" aria-label="關閉">
            <X size={16} />
          </button>
        )}
      </div>

      {nPlaces === 0 ? (
        <div className="grid gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-900 dark:bg-emerald-950/40">
          <p className="text-lg leading-snug font-bold">
            公司在這,
            <span className="text-emerald-700 dark:text-emerald-400">住哪裡最剛好?</span>
          </p>
          <ol className="grid gap-1.5 text-xs text-neutral-700 dark:text-neutral-300">
            <li>1. 輸入公司(或學校、家人住處)的地址</li>
            <li>2. 地圖畫出 {DEFAULT_RINGS.join(" / ")} 分鐘通勤圈:公車捷運、機車或開車</li>
            <li>3. 圈裡的行政區、車站周邊依租金、生活機能、治安、淹水排名</li>
            <li>4. 看中哪一區,一鍵到 Google、591 搜租屋或買房</li>
          </ol>
          <button className="btn-primary w-full justify-center py-2.5 text-base" onClick={openPlacesDialog}>
            <MapPin size={16} /> 輸入公司地址
          </button>
          <p className="text-[11px] text-neutral-500">兩個人上班地點不同?都加進來,依每週去幾天加權。</p>
        </div>
      ) : (
        <>
          {/* 設定(分享頁不能改) */}
          {!readOnly && !showSettings && (
            <button
              onClick={() => setShowSettings(true)}
              className="flex items-center gap-1 rounded-lg border border-neutral-200 px-2 py-1.5 text-left text-xs text-neutral-600 dark:border-neutral-800 dark:text-neutral-300"
            >
              <SlidersHorizontal size={12} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                {MODES.find((m) => m.k === s.mode)?.label} · {s.rings.join(" / ")} 分{nPlaces > 1 ? ` · ${COMBINE_LABEL[s.combine]}` : ""}
                {deal === "rent" ? ` · ${s.rentKind}` : ""}
              </span>
              <ChevronDown size={12} className="shrink-0" />
            </button>
          )}
          {!readOnly && showSettings && (
            <div className="grid gap-2 rounded-lg border border-neutral-200 p-2 text-xs dark:border-neutral-800">
              {narrow && (
                <button onClick={() => setShowSettings(false)} className="flex items-center justify-end gap-1 text-neutral-500">
                  收起設定 <ChevronDown size={12} className="rotate-180" />
                </button>
              )}
              <div className="flex flex-wrap gap-1">
                {MODES.map((m) => (
                  <button key={m.k} onClick={() => setZonesSettings({ mode: m.k })} className={pill(s.mode === m.k)}>
                    {m.icon} {m.label}
                  </button>
                ))}
              </div>
              {nPlaces > 1 && (
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-neutral-500">多個地點:</span>
                  {COMBINES.map((c) => (
                    <button key={c} onClick={() => setZonesSettings({ combine: c })} className={pill(s.combine === c)}>
                      {COMBINE_LABEL[c]}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-neutral-500">分圈(分鐘):</span>
                {s.rings.map((r, i) => (
                  <label key={i} className="flex items-center gap-0.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: RING_COLOR[i] }} />
                    <input
                      type="number"
                      min={5}
                      max={120}
                      step={5}
                      value={r}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (!Number.isFinite(v) || v < 5 || v > 120) return;
                        const next = [...s.rings];
                        next[i] = v;
                        setZonesSettings({ rings: next.sort((a, b) => a - b) });
                      }}
                      className="w-12 rounded border border-neutral-200 bg-white px-1 py-0.5 dark:border-neutral-700 dark:bg-neutral-800"
                    />
                  </label>
                ))}
              </div>
              {deal === "rent" && (
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-neutral-500">租金看:</span>
                  {RENT_KINDS.map((k) => (
                    <button key={k} onClick={() => setZonesSettings({ rentKind: k })} className={pill(s.rentKind === k)}>
                      {k}
                    </button>
                  ))}
                </div>
              )}
              {deal === "rent" &&
                (budget != null ? (
                  <label className="flex items-center gap-1">
                    <input type="checkbox" checked={s.budgetOnly} onChange={(e) => setZonesSettings({ budgetOnly: e.target.checked })} />
                    只看預算內({s.rentKind}行情 ≤ {$(budget)})
                  </label>
                ) : (
                  <p className="text-neutral-500">在「我的需求」設預算,就能篩掉住不起的區。</p>
                ))}
              <button className="flex items-center gap-1 text-left text-neutral-600 dark:text-neutral-300" onClick={() => setShowWeights(!showWeights)}>
                <SlidersHorizontal size={12} /> 排名權重 <ChevronDown size={12} className={showWeights ? "rotate-180" : ""} />
              </button>
              {showWeights && (
                <div className="grid gap-1">
                  {SCORE_KEYS.map((k) => (
                    <label key={k} className="grid grid-cols-[4.5rem_1fr_1.5rem] items-center gap-2">
                      <span>{SCORE_LABEL[k]}</span>
                      <input type="range" min={0} max={5} value={s.weights[k]} onChange={(e) => setZonesSettings({ weights: { ...s.weights, [k]: Number(e.target.value) } })} />
                      <span className="tabular-nums text-neutral-500">{s.weights[k]}</span>
                    </label>
                  ))}
                  <p className="text-[11px] text-neutral-400">0 = 不看。分數是在這次圈內的區之間比,不是絕對值。</p>
                </div>
              )}
            </div>
          )}
          {!readOnly && share && <ShareBox s={s} share={share} />}

          {error ? (
            <p className="text-xs text-red-600 dark:text-red-400">{planError(error) ?? "算不出來,稍後再試"}</p>
          ) : !data ? (
            <p className="text-xs text-neutral-500">{loading ? "計算中…(第一次約需幾秒)" : ""}</p>
          ) : (
            <>
              {!data.has_data && <p className="text-xs text-amber-700 dark:text-amber-400">這一區的交通資料還在準備中,圈只是參考。</p>}
              <div className="flex flex-wrap gap-2 text-[11px] text-neutral-600 dark:text-neutral-400">
                {data.rings.map((r, i) => (
                  <span key={i} className="flex items-center gap-1">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: RING_COLOR[i] }} />
                    {RING_LABEL[i]} ≤ {r} 分
                  </span>
                ))}
                {loading && <span className="text-neutral-400">更新中…</span>}
              </div>
              {ranked.length === 0 ? (
                <p className="text-xs text-neutral-500">圈內沒有符合的區。可以放寬分圈時間、或取消「只看預算內」。</p>
              ) : (
                <>
                  {picked.length === 2 && <Compare a={picked[0]!} b={picked[1]!} places={data.places} kind={s.rentKind} deal={deal} crime={crime} />}
                  {pick.length > 0 && pick.length < 2 && <p className="text-[11px] text-neutral-500">再勾一個區就能比較。</p>}
                  <ol className="grid gap-2">
                    {ranked.map(({ d, score, over }, i) => {
                      const k = keyOf(d);
                      const isOpen = open === k;
                      const rent = rentOf(d, s.rentKind);
                      return (
                        <li key={k} className={`rounded-lg border p-2 ${over ? "border-neutral-200 opacity-60 dark:border-neutral-800" : "border-neutral-200 dark:border-neutral-700"}`}>
                          <div className="flex items-start gap-2">
                            <span className="mt-0.5 w-5 shrink-0 text-right text-xs tabular-nums text-neutral-400">{i + 1}</span>
                            <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(isOpen ? null : k)}>
                              <div className="flex flex-wrap items-center gap-x-2">
                                <span className="font-medium">
                                  {d.city}
                                  {d.district}
                                </span>
                                <span className="rounded px-1 text-[10px] text-white" style={{ background: RING_COLOR[d.best_ring] }}>
                                  {RING_LABEL[d.best_ring]}
                                </span>
                                {score != null && <span className="text-xs text-emerald-700 dark:text-emerald-400">落腳分數 {score}</span>}
                              </div>
                              <p className="text-xs text-neutral-600 dark:text-neutral-400">
                                通勤約 {d.median} 分(最快 {d.min})
                                {deal === "rent" ? (rent != null ? ` · ${s.rentKind} ${$(rent)}` : ` · ${s.rentKind}樣本不足`) : d.sale_unit != null ? ` · 每坪 ${wan(d.sale_unit)}` : ""}
                                {over && "(超出預算)"}
                              </p>
                              <p className="text-[11px] text-neutral-500">{lifeSentence(d, data.stations)}</p>
                            </button>
                            <div className="flex shrink-0 flex-col items-end gap-1">
                              <button className="btn-ghost !p-1" title="在地圖上看這區" onClick={() => onFocus(d.bbox)}>
                                <Crosshair size={14} />
                              </button>
                              <label className="flex items-center gap-0.5 text-[10px] text-neutral-500" title="勾兩區比較">
                                <input type="checkbox" checked={pick.includes(k)} onChange={(e) => setPick(e.target.checked ? [...pick, k].slice(-2) : pick.filter((x) => x !== k))} />
                                比較
                              </label>
                            </div>
                          </div>
                          {isOpen && <Detail d={d} data={data} deal={deal} crime={crime} />}
                        </li>
                      );
                    })}
                  </ol>
                </>
              )}
              {data.stations.length > 0 && (
                <section>
                  <h3 className="mb-1 flex items-center gap-1 text-xs font-medium text-neutral-500">
                    <TrainFront size={13} /> 圈內車站(住車站旁;點名字縮放,<ExternalLink size={10} className="inline" /> 搜附近{DEAL_LABEL[deal]})
                  </h3>
                  <ul className="flex flex-wrap gap-1 text-[11px]">
                    {data.stations.slice(0, 24).map((st, i) => (
                      <li key={i} className="flex items-center rounded-full border border-neutral-200 dark:border-neutral-700">
                        <button
                          className="rounded-l-full py-0.5 pr-1 pl-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                          onClick={() => onFocus([st.lng - 0.008, st.lat - 0.006, st.lng + 0.008, st.lat + 0.006])}
                        >
                          <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: RING_COLOR[st.ring] }} />
                          {st.rail === "tra" ? "台鐵" : ""}
                          {st.name} {st.min} 分
                        </button>
                        <a
                          href={stationSearch(st.name, st.rail, deal)}
                          target="_blank"
                          rel="noreferrer"
                          title={`Google 搜尋${st.name}附近${DEAL_LABEL[deal]}`}
                          aria-label={`Google 搜尋${st.name}附近${DEAL_LABEL[deal]}`}
                          className="rounded-r-full py-1 pr-2 pl-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                        >
                          <ExternalLink size={10} />
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

type Crime = ReturnType<typeof useCrimeDistricts>["data"];

function Detail({ d, data, deal, crime }: { d: ZoneDistrict; data: ZonesResponse; deal: Deal; crime: Crime }) {
  const [linkDeal, setLinkDeal] = useState<Deal>(deal);
  const c = crime?.items[`${d.city}|${d.district}`];
  return (
    <div className="mt-2 grid gap-1.5 border-t border-neutral-100 pt-2 text-xs dark:border-neutral-800">
      {data.places.length > 1 && (
        <p>
          {data.places.map((p, i) => (
            <span key={p.id} className="mr-2">
              到{p.name} 約 {d.per_place[i] ?? "—"} 分
            </span>
          ))}
        </p>
      )}
      <p className="text-neutral-600 dark:text-neutral-400">
        圈內約佔全區 {Math.round(d.share * 100)}%{d.ring_cells.map((n, i) => (n ? ` · ${RING_LABEL[i]} ${Math.round((n / d.ring_cells.reduce((a, b) => a + b, 0)) * 100)}%` : "")).join("")}
      </p>
      {deal === "rent" ? (
        <p>
          租金行情(近一年實價登錄):
          {d.rent.length ? d.rent.map((r) => `${r.kind} ${$(r.median)}`).join(" · ") : "樣本不足"}
        </p>
      ) : (
        <p>房價:{d.sale_unit != null ? `每坪中位數 ${wan(d.sale_unit)}(${d.sale_count} 筆)` : "樣本不足"}</p>
      )}
      <p className="text-neutral-600 dark:text-neutral-400">
        圈內:超商 {d.pois.convenience ?? 0} · 超市 {d.pois.supermarket ?? 0} · 公園 {d.pois.park ?? 0} · 診所 {d.pois.clinic ?? 0}
        {d.flood_share > 0 && ` · 約 ${Math.round(d.flood_share * 100)}% 有淹水潛勢`}
        {c?.house != null && ` · 住宅竊盜近一年 ${c.house} 件`}
      </p>
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-neutral-500">找房:</span>
        {(["rent", "buy"] as const).map((k) => (
          <button key={k} onClick={() => setLinkDeal(k)} className={pill(linkDeal === k)}>
            {DEAL_LABEL[k]}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1">
        {areaLinks(d.city, d.district, linkDeal).map((l) => (
          <a
            key={l.label}
            href={l.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-0.5 rounded-full bg-neutral-100 px-2 py-0.5 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700"
          >
            {l.label} <ExternalLink size={10} />
          </a>
        ))}
        <a
          href={`/area/${encodeURIComponent(d.city)}/${encodeURIComponent(d.district)}`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-0.5 rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
        >
          本區行情頁 <ExternalLink size={10} />
        </a>
      </div>
    </div>
  );
}

function Compare({
  a,
  b,
  places,
  kind,
  deal,
  crime,
}: {
  a: { d: ZoneDistrict; score: number | null };
  b: { d: ZoneDistrict; score: number | null };
  places: ZonesResponse["places"];
  kind: string;
  deal: "rent" | "buy";
  crime: Crime;
}) {
  const life = (d: ZoneDistrict) => (d.km2 > 0 ? Math.round(((d.pois.convenience ?? 0) + (d.pois.supermarket ?? 0) + (d.pois.park ?? 0) + (d.pois.clinic ?? 0)) / d.km2) : 0);
  const rows: [string, (d: ZoneDistrict, sc: number | null) => string][] = [
    ["落腳分數", (_, sc) => (sc == null ? "—" : String(sc))],
    ["通勤(中位)", (d) => `${d.median} 分`],
    ...places.map((p, i): [string, (d: ZoneDistrict) => string] => [`到${p.name}`, (d) => (d.per_place[i] == null ? "—" : `${d.per_place[i]} 分`)]),
    deal === "rent" ? [`${kind}租金`, (d) => (rentOf(d, kind) == null ? "樣本不足" : $(rentOf(d, kind)!))] : ["每坪房價", (d) => (d.sale_unit == null ? "樣本不足" : wan(d.sale_unit))],
    ["生活機能密度", (d) => `${life(d)} 個 / km²`],
    ["淹水潛勢", (d) => `${Math.round(d.flood_share * 100)}%`],
    ["住宅竊盜(近一年)", (d) => String(crime?.items[`${d.city}|${d.district}`]?.house ?? "—")],
  ];
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-2 text-xs dark:border-emerald-900 dark:bg-emerald-950/30">
      <p className="mb-1 flex items-center gap-1 font-medium">
        <Scale size={13} /> 比較
      </p>
      <table className="w-full">
        <thead>
          <tr className="text-left">
            <th className="font-normal text-neutral-500" />
            <th className="py-0.5 font-medium">{a.d.district}</th>
            <th className="py-0.5 font-medium">{b.d.district}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, f]) => (
            <tr key={label} className="border-t border-emerald-100 dark:border-emerald-900">
              <td className="py-0.5 pr-2 text-neutral-500">{label}</td>
              <td className="py-0.5 pr-2 tabular-nums">{f(a.d, a.score)}</td>
              <td className="py-0.5 tabular-nums">{f(b.d, b.score)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const pill = (on: boolean) =>
  `flex items-center gap-1 rounded-full border px-2 py-0.5 ${on ? "border-emerald-600 bg-emerald-600 text-white" : "border-neutral-200 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"}`;

/** 分享連結:建立(把目前的地點與設定存成快照)、複製、刪除 */
function ShareBox({ s, share }: { s: ZonesSettings; share: { region: string; when: CommuteWhen } }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const list = useQuery({ queryKey: ["shares"], queryFn: api.listShares, enabled: open });
  const create = useMutation({
    mutationFn: () => api.createShare({ region: share.region, mode: s.mode, combine: s.combine, rings: s.rings, when: share.when }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shares"] }),
  });
  const del = useMutation({ mutationFn: api.deleteShare, onSuccess: () => qc.invalidateQueries({ queryKey: ["shares"] }) });
  const url = (t: string) => `${window.location.origin}/s/${t}`;
  const copy = (t: string) => void navigator.clipboard?.writeText(url(t));
  return (
    <div className="text-xs">
      <button className="flex items-center gap-1 text-neutral-600 dark:text-neutral-300" onClick={() => setOpen(!open)}>
        <Link2 size={12} /> 分享給家人 / 另一半 <ChevronDown size={12} className={open ? "rotate-180" : ""} />
      </button>
      {open && (
        <div className="mt-1 grid gap-1.5 rounded-lg border border-neutral-200 p-2 dark:border-neutral-800">
          <p className="text-[11px] text-neutral-500">對方不用登入就能看這份落腳圈(唯讀)。連結會包含你的地點名稱與位置;之後改地點,已分享的不會跟著變。</p>
          <button className="btn-primary justify-center" disabled={create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? "建立中…" : "建立分享連結"}
          </button>
          {create.data && (
            <div className="flex items-center gap-1">
              <input readOnly value={url(create.data.token)} className="input !py-0.5 text-[11px]" onFocus={(e) => e.target.select()} />
              <button className="btn-ghost shrink-0 !px-2 !py-0.5" onClick={() => copy(create.data!.token)}>
                複製
              </button>
            </div>
          )}
          {create.error && <p className="text-red-600">{planError(create.error) ?? "建立失敗"}</p>}
          {(list.data?.items.length ?? 0) > 0 && (
            <ul className="grid gap-0.5 border-t border-neutral-100 pt-1 dark:border-neutral-800">
              {list.data!.items.map((it) => (
                <li key={it.token} className="flex items-center justify-between gap-1">
                  <a href={url(it.token)} target="_blank" rel="noreferrer" className="truncate text-emerald-700 underline dark:text-emerald-400">
                    {it.created_at.slice(0, 10)} · {it.places.map((p) => p.name).join("、")}
                  </a>
                  <button className="btn-ghost shrink-0 !p-1" title="刪除這個連結" onClick={() => confirm("刪除這個分享連結?對方就打不開了。") && del.mutate(it.token)}>
                    <Trash2 size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
