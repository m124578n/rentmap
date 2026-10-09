import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";

export interface PickOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

/**
 * 多選下拉:按鈕顯示選了哪些,點開是一排可勾選的項目(點外面或按 Esc 關)。地圖的區域圖層、生活機能圖層用。
 * 原生 <select multiple> 在手機與暗色模式都不好用,所以自己做。
 */
export function MultiPick<T extends string>({
  label,
  icon,
  options,
  value,
  onChange,
  emptyText = "不顯示",
}: {
  label: string;
  icon?: ReactNode;
  options: PickOption<T>[];
  value: T[];
  onChange: (v: T[]) => void;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const picked = options.filter((o) => value.includes(o.value));
  const summary = picked.length === 0 ? emptyText : picked.length <= 2 ? picked.map((o) => o.label).join("、") : `${picked[0]!.label} 等 ${picked.length} 項`;
  const toggle = (v: T) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

  return (
    <div ref={ref} className="relative flex items-center gap-1">
      {icon}
      <span className="shrink-0 text-neutral-500 dark:text-neutral-300">{label}</span>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex min-w-0 max-w-[11rem] items-center gap-0.5 rounded border border-neutral-200 bg-white px-1.5 py-0.5 text-left text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
      >
        <span className="truncate">{summary}</span>
        <ChevronDown size={12} className={`shrink-0 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          role="listbox"
          aria-multiselectable
          className="absolute top-full left-0 z-30 mt-1 max-h-72 w-56 overflow-auto rounded-lg border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
        >
          {value.length > 0 && (
            <button type="button" onClick={() => onChange([])} className="mb-0.5 w-full rounded px-2 py-1 text-left text-[11px] text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800">
              全部取消
            </button>
          )}
          {options.map((o) => {
            const on = value.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => toggle(o.value)}
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-neutral-800 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800"
              >
                <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${on ? "border-emerald-600 bg-emerald-600 text-white" : "border-neutral-300 dark:border-neutral-600"}`}>
                  {on && <Check size={10} strokeWidth={3} />}
                </span>
                {o.icon}
                <span className="truncate">{o.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
