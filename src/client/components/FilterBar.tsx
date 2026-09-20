import { useState } from "react";
import { ChevronDown, SlidersHorizontal, X } from "lucide-react";
import { activeCount, resetFilters, setFilters, useFilters, type Filters } from "@/lib/filters";
import { DISTRICTS, STAGES, STAGE_LABEL } from "@shared/constants";

const KINDS = ["整層住家", "獨立套房", "分租套房", "雅房"] as const;
const DISTRICT_OPTIONS = [...DISTRICTS.台北市.map((d) => ({ city: "台北市", d })), ...DISTRICTS.新北市.map((d) => ({ city: "新北市", d }))];

/** 篩選列:一排 chip,點開展開細項。地圖與列表共用同一份條件。 */
export function FilterBar({ shown, total }: { shown: number; total: number }) {
  const f = useFilters();
  const [open, setOpen] = useState(false);
  const n = activeCount(f);
  const toggleIn = (key: "kinds" | "districts" | "stages", v: string) => {
    const cur = f[key];
    setFilters({ [key]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] });
  };

  return (
    <div className="border-b border-neutral-200 bg-white/95 text-sm backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/95">
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
        <button onClick={() => setOpen(!open)} className={`btn-ghost ${n ? "border-emerald-500 text-emerald-700 dark:text-emerald-400" : ""}`}>
          <SlidersHorizontal size={14} /> 篩選{n ? ` ${n}` : ""}
          <ChevronDown size={14} className={open ? "rotate-180 transition" : "transition"} />
        </button>
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
        <span className="ml-auto text-xs text-neutral-500">
          {shown} / {total} 間
        </span>
        {n > 0 && (
          <button onClick={resetFilters} className="text-xs text-neutral-500 underline">
            清除
          </button>
        )}
      </div>

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

function DistrictPicker({ f, toggle }: { f: Filters; toggle: (d: string) => void }) {
  const [city, setCity] = useState<"台北市" | "新北市">("台北市");
  return (
    <div>
      <div className="mb-1 flex gap-1">
        {(["台北市", "新北市"] as const).map((c) => (
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
        {DISTRICT_OPTIONS.filter((o) => o.city === city).map(({ d }) => (
          <Chip key={d} on={f.districts.includes(d)} onClick={() => toggle(d)} small>
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
