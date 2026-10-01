import { useSyncExternalStore } from "react";

/**
 * 用途(偏好設定,存在這台瀏覽器):租屋 / 買房 / 只看附近。地址報告依它決定行情卡(租金 / 買賣)與能不能存成租屋筆記。
 * 方向文件 §9「不限租屋」:報告本身跟租或買無關,只有行情、支出、筆記欄位不同。
 */
export const PURPOSES = ["rent", "buy", "look"] as const;
export type Purpose = (typeof PURPOSES)[number];
export const PURPOSE_LABEL: Record<Purpose, string> = { rent: "租屋", buy: "買房", look: "只看附近" };

const KEY = "rentmap.purpose";
const listeners = new Set<() => void>();
function read(): Purpose {
  try {
    const v = localStorage.getItem(KEY);
    if (v && (PURPOSES as readonly string[]).includes(v)) return v as Purpose;
  } catch {
    /* 私密模式 */
  }
  return "rent";
}
let current = read();

export function setPurpose(p: Purpose) {
  try {
    localStorage.setItem(KEY, p);
  } catch {
    /* 只在這次有效 */
  }
  current = p;
  for (const l of listeners) l();
}

export function usePurpose(): Purpose {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}
