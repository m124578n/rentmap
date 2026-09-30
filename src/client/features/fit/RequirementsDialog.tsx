import { useState } from "react";
import { X } from "lucide-react";
import { EMPTY_REQUIREMENTS, FIT_DIM_LABEL, type FitDimKey, type Requirements } from "@shared/fit";
import { KINDS } from "@shared/constants";
import { AVOIDABLE_CATS, poiLabel } from "@shared/poi";
import { useRequirements, useRequirementsDialogOpen, useSaveRequirements } from "./fit";
import { usePlaces } from "@/features/places/places";
import { coverageCities } from "@shared/regions";
import { useRegion } from "@/lib/region";

export function RequirementsDialogHost() {
  const [open, setOpen] = useRequirementsDialogOpen();
  const rq = useRequirements();
  if (!open || !rq.data) return null;
  return <RequirementsDialog initial={rq.data.requirements} onClose={() => setOpen(false)} />;
}

const WEIGHT_KEYS: FitDimKey[] = ["price", "market", "commute", "size", "age"];

/** 我的需求:硬性條件(不符就紅)+ 軟性目標與權重(算分數) */
function RequirementsDialog({ initial, onClose }: { initial: Requirements; onClose: () => void }) {
  const [r, setR] = useState<Requirements>(initial);
  const save = useSaveRequirements();
  const places = usePlaces();
  const region = useRegion();
  const set = (patch: Partial<Requirements>) => setR((x) => ({ ...x, ...patch }));
  // 坪數可以有小數,其他(元、分、年)存整數
  const num = (v: string) => (v === "" ? null : Math.round(Math.max(0, Number(v))) || null);
  const dec = (v: string) => (v === "" ? null : Math.max(0, Number(v)) || null);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="max-h-[92dvh] w-full overflow-auto rounded-t-xl bg-white p-4 text-sm shadow-xl sm:max-w-lg sm:rounded-xl dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="我的需求"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">我的需求</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label="關閉">
            <X size={16} />
          </button>
        </div>
        <p className="mb-3 text-xs text-neutral-500">
          「上限 / 必要」是硬性條件,不符的房源標紅;「理想」和權重用來算分數:≥75% 綠、≥50% 黃。空白 = 不限。
        </p>

        <Group title="租金">
          <Pair label="預算上限" suffix="元" value={r.budget_max} onChange={(v) => set({ budget_max: v })} num={num} step={1000} />
          <Pair label="理想" suffix="元以內" value={r.budget_ideal} onChange={(v) => set({ budget_ideal: v })} num={num} step={1000} />
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={r.budget_total} onChange={(e) => set({ budget_total: e.target.checked })} /> 預算比「每月總支出」
            <span className="text-neutral-500">(房租 + 管理費 + 水電網路 + 通勤,估)</span>
          </label>
        </Group>
        <Group title="每月支出怎麼估">
          <label className="flex items-center gap-1">
            通勤費算到
            <select className="input !w-auto" value={r.cost_place_id ?? ""} onChange={(e) => set({ cost_place_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">第一個地點</option>
              {(places.data?.items ?? []).map((pl) => (
                <option key={pl.id} value={pl.id}>
                  {pl.name}
                </option>
              ))}
            </select>
            ,每週
            <select className="input !w-auto" value={r.commute_days} onChange={(e) => set({ commute_days: Number(e.target.value) })}>
              {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            天
          </label>
          <Pair label="每月用電" suffix="度(空白 = 依房型估)" value={r.kwh} onChange={(v) => set({ kwh: v != null && v >= 10 ? v : null })} num={num} step={10} />
        </Group>
        <Group title="通勤(每個地點的上班、下班取最久的一段)">
          <Pair label="上限" suffix="分" value={r.commute_max} onChange={(v) => set({ commute_max: v })} num={num} step={5} />
          <Pair label="理想" suffix="分內" value={r.commute_ideal} onChange={(v) => set({ commute_ideal: v })} num={num} step={5} />
        </Group>
        <Group title="空間">
          <Pair label="最小" suffix="坪" value={r.size_min} onChange={(v) => set({ size_min: v })} num={dec} step={1} />
          <Pair label="理想" suffix="坪以上" value={r.size_ideal} onChange={(v) => set({ size_ideal: v })} num={dec} step={1} />
          <label className="flex items-center gap-1">
            至少
            <select className="input !w-auto" value={r.rooms_min ?? ""} onChange={(e) => set({ rooms_min: e.target.value ? Number(e.target.value) : null })}>
              <option value="">不限</option>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n} 房
                </option>
              ))}
            </select>
          </label>
          <Pair label="屋齡上限" suffix="年" value={r.age_max} onChange={(v) => set({ age_max: v })} num={num} step={5} />
        </Group>
        <Group title="房型(不選 = 都可以)">
          <div className="flex flex-wrap gap-1">
            {KINDS.filter((k) => k !== "其他").map((k) => {
              const on = r.kinds.includes(k);
              return (
                <button
                  key={k}
                  onClick={() => set({ kinds: on ? r.kinds.filter((x) => x !== k) : [...r.kinds, k] })}
                  className={`rounded-full border px-2.5 py-1 text-xs ${on ? "border-emerald-600 bg-emerald-600 text-white" : "border-neutral-300 dark:border-neutral-700"}`}
                >
                  {k}
                </button>
              );
            })}
          </div>
        </Group>
        <Group title="必要">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {(
              [
                ["need_elevator", "電梯"],
                ["need_pet", "可養寵物"],
                ["need_cooking", "可開伙"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="flex items-center gap-1">
                <input type="checkbox" checked={r[k]} onChange={(e) => set({ [k]: e.target.checked })} /> {label}
              </label>
            ))}
          </div>
        </Group>
        <Group title="不要太近(嫌惡設施、噪音源)">
          <select className="input !w-auto" value={r.avoid_m} onChange={(e) => set({ avoid_m: Number(e.target.value) })}>
            {[50, 100, 200, 300].map((m) => (
              <option key={m} value={m}>
                {m}m
              </option>
            ))}
          </select>
          <span>內不要有</span>
          <div className="flex flex-wrap gap-1">
            {AVOIDABLE_CATS.map((c) => {
              const on = r.avoid.includes(c);
              return (
                <button
                  key={c}
                  onClick={() => set({ avoid: on ? r.avoid.filter((x) => x !== c) : [...r.avoid, c] })}
                  className={`rounded-full border px-2.5 py-1 text-xs ${on ? "border-red-600 bg-red-600 text-white" : "border-neutral-300 dark:border-neutral-700"}`}
                >
                  {poiLabel(c)}
                </button>
              );
            })}
          </div>
        </Group>
        <Group title="災害風險">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={r.avoid_flood} onChange={(e) => set({ avoid_flood: e.target.checked })} /> 避開淹水潛勢區
            <span className="text-neutral-500">(颱風情境 0.5m 以上,或短時強降雨就會淹)</span>
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={r.avoid_liquefaction} onChange={(e) => set({ avoid_liquefaction: e.target.checked })} /> 避開土壤液化高潛勢
            <span className="text-neutral-500">(只有{coverageCities("liquefaction", region.key)}有資料)</span>
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={r.avoid_airnoise} onChange={(e) => set({ avoid_airnoise: e.target.checked })} /> 避開航空噪音區
            <span className="text-neutral-500">(松山機場周邊第二級以上,65 dB+)</span>
          </label>
        </Group>
        <Group title="垃圾車(房東沒寫代收時,要追得到車)">
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={r.garbage_after != null}
              onChange={(e) => set({ garbage_after: e.target.checked ? (r.garbage_after ?? "19:00") : null })}
            />
            走
          </label>
          <select className="input !w-auto" value={r.garbage_max_m} disabled={r.garbage_after == null} onChange={(e) => set({ garbage_max_m: Number(e.target.value) })}>
            {[100, 200, 300, 500].map((m) => (
              <option key={m} value={m}>
                {m}m
              </option>
            ))}
          </select>
          <span>內要有</span>
          <input
            type="time"
            className="input !w-auto"
            step={900}
            disabled={r.garbage_after == null}
            value={r.garbage_after ?? "19:00"}
            onChange={(e) => e.target.value && set({ garbage_after: e.target.value })}
          />
          <span className="text-neutral-500">以後的車(平日至少 3 天)</span>
        </Group>
        <Group title="權重(0 = 不算,5 = 最在意)">
          <div className="grid gap-1">
            {WEIGHT_KEYS.map((k) => (
              <label key={k} className="grid grid-cols-[4rem_1fr_1.5rem] items-center gap-2">
                <span>{FIT_DIM_LABEL[k]}</span>
                <input type="range" min={0} max={5} value={r.weights[k]} onChange={(e) => set({ weights: { ...r.weights, [k]: Number(e.target.value) } })} />
                <span className="text-right tabular-nums">{r.weights[k]}</span>
              </label>
            ))}
          </div>
        </Group>

        {save.error && <p className="mb-2 text-xs text-red-600">存不起來:{String(save.error)}</p>}
        <div className="mt-2 flex items-center justify-between">
          <button onClick={() => setR({ ...EMPTY_REQUIREMENTS, weights: r.weights })} className="text-xs text-neutral-500 underline">
            全部清除
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost">
              取消
            </button>
            <button onClick={() => save.mutate(r, { onSuccess: onClose })} disabled={save.isPending} className="btn-primary">
              {save.isPending ? "儲存中…" : "儲存"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="mb-3">
      <legend className="mb-1 text-xs font-medium text-neutral-500">{title}</legend>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">{children}</div>
    </fieldset>
  );
}

function Pair({
  label,
  suffix,
  value,
  onChange,
  num,
  step,
}: {
  label: string;
  suffix: string;
  value: number | null;
  onChange: (v: number | null) => void;
  num: (v: string) => number | null;
  step: number;
}) {
  return (
    <label className="flex items-center gap-1">
      {label}
      <input type="number" className="input !w-24" min={0} step={step} value={value ?? ""} onChange={(e) => onChange(num(e.target.value))} />
      <span className="text-neutral-500">{suffix}</span>
    </label>
  );
}
