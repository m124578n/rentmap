import { useEffect, useSyncExternalStore } from "react";
import type { Theme } from "@/features/map/basemap";

/** 亮暗主題(搬自 menmap):localStorage 記住,沒有就跟系統。存成一個全域 store 讓地圖與頂欄同步。 */
const KEY = "rent-theme";
let current: Theme = initial();
const listeners = new Set<() => void>();

function initial(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* localStorage 不可用 */
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function set(t: Theme) {
  current = t;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* 忽略 */
  }
  listeners.forEach((l) => l());
}

export function useTheme() {
  const theme = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);
  return { theme, toggle: () => set(theme === "dark" ? "light" : "dark") };
}
