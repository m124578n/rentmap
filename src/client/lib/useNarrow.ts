import { useSyncExternalStore } from "react";

const Q = "(max-width: 639px)"; // 對齊 Tailwind 的 sm

/** 手機寬度(< sm)。版面在 JS 裡要分支時用(例如面板改成底部抽屜) */
export function useNarrow(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(Q);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(Q).matches,
  );
}
