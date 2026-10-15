import { useSyncExternalStore } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { DEFAULT_RINGS, DEFAULT_WEIGHTS, type Combine, type ScoreKey } from "@shared/zones";
import type { CommuteWhen } from "@shared/trip";
import { api } from "@/lib/api";

/**
 * 落腳圈的設定(這台瀏覽器;面板與地圖共用):通勤方式、多地點怎麼合成、各圈門檻、排名權重、看哪種房型的租金、只看預算內。
 */
export interface ZonesSettings {
  on: boolean;
  mode: "transit" | "scooter" | "car";
  combine: Combine;
  rings: number[];
  weights: Record<ScoreKey, number>;
  rentKind: string;
  budgetOnly: boolean;
}
// 主打功能:沒設定過的人預設打開(有地點才會算)
const DEFAULTS: ZonesSettings = { on: true, mode: "transit", combine: "max", rings: [...DEFAULT_RINGS], weights: DEFAULT_WEIGHTS, rentKind: "整層住家", budgetOnly: false };
const KEY = "rentmap.zones";
const listeners = new Set<() => void>();

function read(): ZonesSettings {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<ZonesSettings> | null;
    return { ...DEFAULTS, ...(v ?? {}), weights: { ...DEFAULTS.weights, ...(v?.weights ?? {}) } };
  } catch {
    return DEFAULTS;
  }
}
let current = read();

export function setZonesSettings(patch: Partial<ZonesSettings>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* 私密模式:只在這次有效 */
  }
  for (const l of listeners) l();
}

export function useZonesSettings(): ZonesSettings {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

/** 落腳圈的結果;沒打開或沒有地點就不查 */
export function useZones(s: ZonesSettings, region: string, when: CommuteWhen, nPlaces: number) {
  return useQuery({
    queryKey: ["zones", region, s.mode, s.combine, s.rings.join(","), when.day, when.time, when.dir, nPlaces],
    queryFn: () => api.zones({ region, mode: s.mode, combine: s.combine, rings: s.rings, when }),
    enabled: s.on && nPlaces > 0,
    staleTime: 10 * 60_000,
    placeholderData: keepPreviousData,
  });
}
