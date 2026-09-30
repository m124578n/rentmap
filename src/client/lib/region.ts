import { useSyncExternalStore } from "react";
import { DEFAULT_REGION, REGION_KEYS, REGIONS, type RegionKey } from "@shared/regions";

/**
 * 目前的生活圈(偏好設定,存在這台瀏覽器;隨時可切換,不鎖帳號)。一次只載一個生活圈的資料。
 * 只開了一個生活圈時不會出現選擇畫面。
 */
const KEY = "rentmap.region";
const listeners = new Set<() => void>();

function read(): RegionKey {
  try {
    const v = localStorage.getItem(KEY) as RegionKey | null;
    if (v && (REGION_KEYS as readonly string[]).includes(v) && REGIONS[v].enabled) return v;
  } catch {
    /* 私密模式 */
  }
  return DEFAULT_REGION;
}

export function setRegion(k: RegionKey) {
  try {
    localStorage.setItem(KEY, k);
  } catch {
    /* 私密模式:只在這次有效 */
  }
  current = k;
  for (const l of listeners) l();
}

let current = read();

export function useRegion() {
  const key = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
  return REGIONS[key];
}

/** 已開放的生活圈(>1 個才需要讓人選) */
export const OPEN_REGIONS = REGION_KEYS.filter((k) => REGIONS[k].enabled).map((k) => REGIONS[k]);
