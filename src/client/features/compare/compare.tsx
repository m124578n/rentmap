import { useSyncExternalStore } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Columns3, Plus, Check, X } from "lucide-react";

/** 比較清單(最多 4 間),存 localStorage,重新整理不會掉 */
export const COMPARE_MAX = 4;
const KEY = "rent-compare";
let ids: number[] = load();
const listeners = new Set<() => void>();

function load(): number[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is number => Number.isInteger(x)).slice(0, COMPARE_MAX) : [];
  } catch {
    return [];
  }
}

export function setCompare(next: number[]) {
  ids = next.slice(0, COMPARE_MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function toggleCompare(id: number) {
  setCompare(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
}

export function useCompare(): number[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => ids,
  );
}

/** 「加入比較」按鈕;在 <Link> 裡面也能按(擋掉導覽) */
export function CompareToggle({ id, className = "" }: { id: number; className?: string }) {
  const list = useCompare();
  const on = list.includes(id);
  const full = !on && list.length >= COMPARE_MAX;
  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!full) toggleCompare(id);
      }}
      disabled={full}
      title={full ? `最多比較 ${COMPARE_MAX} 間` : on ? "從比較移除" : "加入比較"}
      className={`inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-xs ${
        on
          ? "border-sky-600 bg-sky-600 text-white"
          : "border-neutral-300 text-neutral-600 hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      } ${className}`}
    >
      {on ? <Check size={12} /> : <Plus size={12} />} 比較
    </button>
  );
}

/** 有勾選時浮在右下角:「比較 3 間」;在比較頁本身不顯示 */
export function CompareBar() {
  const list = useCompare();
  const path = useRouterState({ select: (s) => s.location.pathname });
  if (!list.length || path === "/compare") return null;
  return (
    <div className="pointer-events-none fixed right-3 bottom-16 z-30 flex justify-end sm:bottom-4">
      <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-sky-600 py-1 pr-1 pl-3 text-sm text-white shadow-lg">
        <Link to="/compare" className="flex items-center gap-1 font-medium">
          <Columns3 size={16} /> 比較 {list.length} 間{list.length < 2 ? "(再選一間)" : ""}
        </Link>
        <button onClick={() => setCompare([])} className="rounded-full p-1 hover:bg-sky-700" aria-label="清空比較">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
