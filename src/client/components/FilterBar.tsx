import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bus, ChevronDown, Route, SlidersHorizontal, X } from "lucide-react";
import { api } from "@/lib/api";
import { useAlong } from "@/features/bus/useAlong";
import { openRequirementsDialog, useFit } from "@/features/fit/fit";
import { activeCount, resetFilters, setFilters, useFilters, type Filters } from "@/lib/filters";
import { DISTRICTS, STAGES, STAGE_LABEL, type City } from "@shared/constants";
import { useRegion } from "@/lib/region";
import type { Place } from "@shared/schemas";
import { DAY_LABEL, DAY_TYPES, type DayType } from "@shared/bus";
import { COMMUTE_SIDE_LABEL, type CommuteSide } from "@shared/trip";
import { openPlacesDialog, usePlaces } from "@/features/places/places";
import { COMMUTE_MODES, COMMUTE_MODE_LABEL } from "@shared/drive";

const KINDS = ["整層住家", "獨立套房", "分租套房", "雅房"] as const;

/** 篩選列:一排 chip,點開展開細項。地圖與列表共用同一份條件。 */
export function FilterBar({ shown, total }: { shown: number; total: number }) {
  const f = useFilters();
  const places = usePlaces();
  const placeList = places.data?.items ?? [];
  const [open, setOpen] = useState(false);
  const [commuteOpen, setCommuteOpen] = useState(false);
  const [alongOpen, setAlongOpen] = useState(false);
  const n = activeCount(f);
  const toggleIn = (key: "kinds" | "districts" | "stages", v: string) => {
    const cur = f[key];
    setFilters({ [key]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] });
  };

  return (
    <div className="border-b border-neutral-200 bg-white/95 text-sm backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/95">
      <div className="flex items-center gap-1.5 px-3 py-2">
        <button onClick={() => setOpen(!open)} className={`btn-ghost shrink-0 !px-2.5 !py-1.5 ${n ? "border-emerald-500 text-emerald-700 dark:text-emerald-400" : ""}`}>
          <SlidersHorizontal size={14} /> 篩選{n ? ` ${n}` : ""}
          <ChevronDown size={14} className={open ? "rotate-180 transition" : "transition"} />
        </button>
        {/* 手機:chip 一行左右滑;桌機:換行 */}
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] sm:flex-wrap sm:overflow-visible [&>*]:shrink-0">
        {places.isSuccess && <CommuteChip f={f} hasPlaces={placeList.length > 0} places={placeList} open={commuteOpen} onToggle={() => setCommuteOpen(!commuteOpen)} />}
        <FitChip f={f} />
        <button
          onClick={() => setAlongOpen(!alongOpen)}
          className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${f.alongRoutes.length ? "border-emerald-600 bg-emerald-600 text-white" : "border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"}`}
          title="只看走得到這些公車 / 捷運路線的房源(任一條)"
        >
          <Route size={12} /> {f.alongRoutes.length ? `經過 ${f.alongRoutes.join("、")}` : "經過路線"}
          <ChevronDown size={12} className={alongOpen ? "rotate-180" : ""} />
        </button>
        <Chip on={f.favOnly} onClick={() => setFilters({ favOnly: !f.favOnly })}>
          ♥ 只看收藏
        </Chip>
        <Chip on={f.newOnly} onClick={() => setFilters({ newOnly: !f.newOnly })}>
          新上架
        </Chip>
        <Chip on={f.priceDrop} onClick={() => setFilters({ priceDrop: !f.priceDrop })}>
          ↓ 降過價
        </Chip>
        {KINDS.map((k) => (
          <Chip key={k} on={f.kinds.includes(k)} onClick={() => toggleIn("kinds", k)}>
            {k}
          </Chip>
        ))}
        <Chip on={f.elevator} onClick={() => setFilters({ elevator: !f.elevator })}>
          電梯
        </Chip>
        <Chip on={f.pet} onClick={() => setFilters({ pet: !f.pet })}>
          可養寵物
        </Chip>
        <Chip on={f.cooking} onClick={() => setFilters({ cooking: !f.cooking })}>
          可開伙
        </Chip>
        </div>
        <span className="shrink-0 text-xs whitespace-nowrap text-neutral-500">
          {shown}/{total} 間
        </span>
        {n > 0 && (
          <button onClick={resetFilters} className="shrink-0 text-xs text-neutral-500 underline">
            清除
          </button>
        )}
      </div>

      {commuteOpen && placeList.length > 0 && <CommuteRow f={f} places={placeList} />}
      {alongOpen && <AlongRow f={f} />}

      {open && (
        <div className="grid gap-3 border-t border-neutral-200 px-3 py-3 sm:grid-cols-2 lg:grid-cols-4 dark:border-neutral-800">
          <Field label="租金">
            <div className="flex items-center gap-1">
              <NumInput value={f.rentMin} onChange={(v) => setFilters({ rentMin: v })} placeholder="最低" step={1000} />
              <span>–</span>
              <NumInput value={f.rentMax} onChange={(v) => setFilters({ rentMax: v })} placeholder="最高" step={1000} />
            </div>
          </Field>
          <Field label="房數 / 坪數">
            <div className="flex items-center gap-1">
              <select className="input" value={f.roomsMin ?? ""} onChange={(e) => setFilters({ roomsMin: e.target.value ? Number(e.target.value) : null })}>
                <option value="">房數</option>
                <option value="1">1 房+</option>
                <option value="2">2 房+</option>
                <option value="3">3 房+</option>
              </select>
              <NumInput value={f.sizeMin} onChange={(v) => setFilters({ sizeMin: v })} placeholder="坪數 ≥" step={1} />
            </div>
          </Field>
          <Field label="狀態">
            <div className="flex flex-wrap gap-1">
              {STAGES.map((s) => (
                <Chip key={s} on={f.stages.includes(s)} onClick={() => toggleIn("stages", s)} small>
                  {STAGE_LABEL[s]}
                </Chip>
              ))}
              <label className="ml-1 flex items-center gap-1 text-xs">
                <input type="checkbox" checked={f.hideRejected} onChange={(e) => setFilters({ hideRejected: e.target.checked })} /> 隱藏淘汰
              </label>
            </div>
          </Field>
          <Field label="行政區">
            <DistrictPicker f={f} toggle={(d) => toggleIn("districts", d)} />
          </Field>
        </div>
      )}
    </div>
  );
}

const COMMUTE_STEPS = [20, 30, 40, 50, 60];

/** 通勤上限:沒設地點時只給「先設公司地址」的入口 */
function CommuteChip({ f, hasPlaces, places, open, onToggle }: { f: Filters; hasPlaces: boolean; places: Place[]; open: boolean; onToggle: () => void }) {
  if (!hasPlaces)
    return (
      <button onClick={openPlacesDialog} className="flex items-center gap-1 rounded-full border border-dashed border-blue-400 px-2.5 py-1 text-xs text-blue-700 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950">
        <Bus size={12} /> 通勤:先設公司地址
      </button>
    );
  const on = f.commuteMax != null;
  const picked = places.filter((p) => f.commutePlaces.includes(p.id));
  const who = places.length > 1 && picked.length > 0 && picked.length < places.length ? `(${picked.map((p) => p.name).join("、")})` : "";
  const side = COMMUTE_SIDE_LABEL[f.commuteSide];
  return (
    <button
      onClick={onToggle}
      className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${on ? "border-emerald-600 bg-emerald-600 text-white" : "border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"}`}
      title="公車 + 捷運、轉乘一次內的最快搭法(含走路、紅綠燈與那個時段的等車);搭不到的房源會被濾掉"
    >
      {f.commuteMode === "transit" ? <Bus size={12} /> : <span>{COMMUTE_MODE_LABEL[f.commuteMode]}</span>} {side}
      {on ? ` ≤ ${f.commuteMax} 分${who}` : ` ${f.commuteTimes[f.commuteSide].time}`}
      <ChevronDown size={12} className={open ? "rotate-180" : ""} />
    </button>
  );
}

/** 通勤條件:看上班或下班(各自的日子、出發時間)+ 上限分鐘 + 要算哪些地點(多個地點時每個都要在上限內) */
function CommuteRow({ f, places }: { f: Filters; places: Place[] }) {
  const cur = f.commuteTimes[f.commuteSide];
  const setTime = (patch: Partial<{ day: DayType; time: string }>) =>
    setFilters({ commuteTimes: { ...f.commuteTimes, [f.commuteSide]: { ...cur, ...patch } } });
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-neutral-200 px-3 py-2 text-xs dark:border-neutral-800">
      <div className="flex flex-wrap items-center gap-1">
        {(["go", "back"] as CommuteSide[]).map((s) => (
          <Chip key={s} small on={f.commuteSide === s} onClick={() => setFilters({ commuteSide: s })}>
            {COMMUTE_SIDE_LABEL[s]} {DAY_LABEL[f.commuteTimes[s].day]} {f.commuteTimes[s].time}
          </Chip>
        ))}
        <span className="text-neutral-400">{f.commuteSide === "go" ? "住處 → 地點" : "地點 → 住處"}</span>
        <select className="input !w-auto !py-0.5 text-xs" value={cur.day} onChange={(e) => setTime({ day: e.target.value as DayType })} aria-label="日子">
          {DAY_TYPES.map((d) => (
            <option key={d} value={d}>
              {DAY_LABEL[d]}
            </option>
          ))}
        </select>
        <input
          type="time"
          className="input !w-auto !py-0.5 text-xs"
          value={cur.time}
          step={600}
          onChange={(e) => e.target.value && setTime({ time: e.target.value })}
          aria-label="出發時間"
        />
        <span className="text-neutral-400">出發</span>
        {f.commuteMode === "transit" && (
          <label className="ml-1 flex items-center gap-1" title="騎 YouBike 到目的地、或騎到捷運站旁再轉捷運(騎 5km / 3km 內)">
            <input type="checkbox" checked={f.commuteBike} onChange={(e) => setFilters({ commuteBike: e.target.checked })} /> 含 YouBike
          </label>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-neutral-500">方式</span>
        {COMMUTE_MODES.map((m) => (
          <Chip key={m} small on={f.commuteMode === m} onClick={() => setFilters({ commuteMode: m })}>
            {COMMUTE_MODE_LABEL[m]}
          </Chip>
        ))}
        {f.commuteMode !== "transit" && <span className="text-neutral-400">(用距離與尖峰 / 離峰時速估,不是導航)</span>}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-neutral-500">通勤上限</span>
        <Chip small on={f.commuteMax == null} onClick={() => setFilters({ commuteMax: null })}>
          不限
        </Chip>
        {COMMUTE_STEPS.map((m) => (
          <Chip key={m} small on={f.commuteMax === m} onClick={() => setFilters({ commuteMax: m })}>
            {m} 分
          </Chip>
        ))}
      </div>
      {places.length > 1 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-neutral-500">算哪些地點</span>
          {places.map((p) => {
            const all = f.commutePlaces.length === 0;
            const on = all || f.commutePlaces.includes(p.id);
            return (
              <Chip
                key={p.id}
                small
                on={on}
                onClick={() => {
                  const cur = all ? places.map((x) => x.id) : f.commutePlaces;
                  const next = cur.includes(p.id) ? cur.filter((x) => x !== p.id) : [...cur, p.id];
                  // 全選或全不選都當「全部」
                  setFilters({ commutePlaces: next.length === places.length || next.length === 0 ? [] : next });
                }}
              >
                {p.name}
              </Chip>
            );
          })}
          <span className="text-neutral-400">(勾到的每個都要在上限內)</span>
        </div>
      )}
    </div>
  );
}

/** 符合需求:設了需求 → 切換「隱藏不符(紅)」+ 齒輪改需求;沒設 → 設定入口 */
function FitChip({ f }: { f: Filters }) {
  const { configured, loaded } = useFit();
  if (!loaded) return null;
  if (!configured)
    return (
      <button
        onClick={openRequirementsDialog}
        className="flex items-center gap-1 rounded-full border border-dashed border-emerald-500 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950"
      >
        <SlidersHorizontal size={12} /> 設定需求
      </button>
    );
  return (
    <span className={`flex items-center rounded-full border text-xs ${f.fitOnly ? "border-emerald-600 bg-emerald-600 text-white" : "border-neutral-300 dark:border-neutral-700"}`}>
      <button onClick={() => setFilters({ fitOnly: !f.fitOnly })} className="py-1 pl-2.5" title="隱藏不符需求(紅)的房源">
        符合需求
      </button>
      <button onClick={openRequirementsDialog} className="px-1.5 py-1 opacity-80 hover:opacity-100" aria-label="調整需求">
        <SlidersHorizontal size={12} />
      </button>
    </span>
  );
}

/** 經過路線:輸入公車主路線名(307、紅30)或捷運線名(板南線),任一條走得到就留下 */
function AlongRow({ f }: { f: Filters }) {
  const names = useQuery({ queryKey: ["bus-names"], queryFn: api.busNames, staleTime: 60 * 60_000 });
  const along = useAlong();
  const [text, setText] = useState("");
  const info = new Map((along.data?.queries ?? []).map((q) => [q.q, q]));
  const add = () => {
    const v = text.trim();
    if (v && !f.alongRoutes.includes(v)) setFilters({ alongRoutes: [...f.alongRoutes, v] });
    setText("");
  };
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-neutral-200 px-3 py-2 text-xs dark:border-neutral-800">
      <span className="text-neutral-500">經過路線(任一條;公車站 400m、捷運站 800m 內)</span>
      {f.alongRoutes.map((n) => {
        const q = info.get(n);
        const missing = q != null && q.kind == null;
        return (
          <span
            key={n}
            className={`flex items-center gap-1 rounded-full border px-2 py-0.5 ${missing ? "border-red-400 text-red-600 dark:text-red-400" : "border-emerald-600 bg-emerald-600 text-white"}`}
          >
            {q?.label ?? n}
            {missing && " · 找不到"}
            <button onClick={() => setFilters({ alongRoutes: f.alongRoutes.filter((x) => x !== n) })} aria-label={`移除 ${n}`}>
              <X size={12} />
            </button>
          </span>
        );
      })}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
        className="flex items-center gap-1"
      >
        <input className="input !w-36 !py-0.5 text-xs" list="rh-route-names" value={text} onChange={(e) => setText(e.target.value)} placeholder="307、紅30、板南線…" />
        <button type="submit" className="rounded border border-neutral-300 px-2 py-0.5 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
          加入
        </button>
      </form>
      <datalist id="rh-route-names">
        {[...(names.data?.mrt ?? []), ...(names.data?.bus ?? [])].map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      {f.alongRoutes.length > 0 && along.data && <span className="text-neutral-400">共 {along.data.ids.length} 間走得到</span>}
    </div>
  );
}

function DistrictPicker({ f, toggle }: { f: Filters; toggle: (d: string) => void }) {
  const region = useRegion();
  const [picked, setCity] = useState<string>(region.cities[0] ?? "");
  const city = (region.cities as readonly string[]).includes(picked) ? (picked as City) : region.cities[0]!;
  return (
    <div>
      <div className="mb-1 flex gap-1">
        {region.cities.map((c) => (
          <button key={c} onClick={() => setCity(c)} className={`rounded px-2 py-0.5 text-xs ${city === c ? "bg-neutral-200 dark:bg-neutral-700" : "text-neutral-500"}`}>
            {c}
          </button>
        ))}
        {f.districts.length > 0 && (
          <button onClick={() => setFilters({ districts: [] })} className="ml-auto flex items-center gap-0.5 text-xs text-neutral-500">
            <X size={12} /> 全部
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {DISTRICTS[city].map((d) => (
          <Chip key={d} on={f.districts.includes(`${city}${d}`) || f.districts.includes(d)} onClick={() => toggle(f.districts.includes(d) ? d : `${city}${d}`)} small>
            {d}
          </Chip>
        ))}
      </div>
    </div>
  );
}

function Chip({ on, onClick, children, small }: { on: boolean; onClick: () => void; children: React.ReactNode; small?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border ${small ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs"} ${
        on ? "border-emerald-600 bg-emerald-600 text-white" : "border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
      }`}
    >
      {children}
    </button>
  );
}

function NumInput({ value, onChange, placeholder, step }: { value: number | null; onChange: (v: number | null) => void; placeholder: string; step: number }) {
  return (
    <input
      type="number"
      className="input"
      value={value ?? ""}
      step={step}
      min={0}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
    />
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <span className="text-xs text-neutral-500">{label}</span>
      {children}
    </div>
  );
}
