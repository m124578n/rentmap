import { useSyncExternalStore } from "react";
import type { PropertySummary } from "@shared/schemas";

/** 地圖與列表共用的篩選條件。存 localStorage,重新整理不會掉。 */
export interface Filters {
  kinds: string[]; // 空 = 全部;值:整層住家 / 獨立套房 / 分租套房 / 雅房 / 其他
  rentMin: number | null;
  rentMax: number | null;
  districts: string[]; // 空 = 全部
  roomsMin: number | null; // 1 / 2 / 3(3 = 3 以上)
  sizeMin: number | null;
  elevator: boolean; // true = 只要有電梯
  pet: boolean;
  cooking: boolean;
  hideRejected: boolean;
  stages: string[]; // 空 = 全部
  favOnly: boolean; // 只看收藏(有 stage 的)
}

export const EMPTY: Filters = {
  kinds: [],
  rentMin: null,
  rentMax: null,
  districts: [],
  roomsMin: null,
  sizeMin: null,
  elevator: false,
  pet: false,
  cooking: false,
  hideRejected: true,
  stages: [],
  favOnly: false,
};

const KEY = "rent-filters";
let current: Filters = load();
const listeners = new Set<() => void>();

function load(): Filters {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...EMPTY, ...(JSON.parse(raw) as Partial<Filters>) };
  } catch {
    /* ignore */
  }
  return EMPTY;
}

export function setFilters(patch: Partial<Filters>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function resetFilters() {
  setFilters(EMPTY);
}

export function useFilters(): Filters {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

/** 有幾個條件在作用中(hideRejected 是預設,不算) */
export function activeCount(f: Filters): number {
  let n = 0;
  if (f.kinds.length) n++;
  if (f.rentMin != null || f.rentMax != null) n++;
  if (f.districts.length) n++;
  if (f.roomsMin != null) n++;
  if (f.sizeMin != null) n++;
  if (f.elevator) n++;
  if (f.pet) n++;
  if (f.cooking) n++;
  if (f.stages.length) n++;
  if (!f.hideRejected) n++;
  if (f.favOnly) n++;
  return n;
}

export function applyFilters(items: PropertySummary[], f: Filters): PropertySummary[] {
  return items.filter((p) => {
    if (f.kinds.length && !(p.kind && f.kinds.includes(p.kind))) return false;
    if (f.rentMin != null && (p.rent == null || p.rent < f.rentMin)) return false;
    if (f.rentMax != null && (p.rent == null || p.rent > f.rentMax)) return false;
    if (f.districts.length && !f.districts.includes(p.district)) return false;
    if (f.roomsMin != null && (p.rooms == null || p.rooms < f.roomsMin)) return false;
    if (f.sizeMin != null && (p.size_ping == null || p.size_ping < f.sizeMin)) return false;
    if (f.elevator && p.has_elevator !== true) return false;
    if (f.pet && p.pet_allowed !== true) return false;
    if (f.cooking && p.cooking_allowed !== true) return false;
    if (f.favOnly && !p.stage) return false;
    if (f.hideRejected && p.stage === "rejected") return false;
    if (f.stages.length && !(p.stage && f.stages.includes(p.stage))) return false;
    return true;
  });
}
