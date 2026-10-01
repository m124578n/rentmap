import { useMemo, useSyncExternalStore } from "react";
import { usePlan } from "./plan";
import type { PropertySummary } from "@shared/schemas";
import type { DayType } from "@shared/bus";
import { COMMUTE_DEFAULT, type CommuteMatrix, type CommuteSide, type CommuteWhen } from "@shared/trip";
import type { CommuteMode } from "@shared/drive";
import type { MarketMatrix } from "@shared/market";
import type { FitResult } from "@shared/fit";
import { ageOf, priceOf } from "@/features/listing/age";

/** 地圖與列表共用的篩選條件。存 localStorage,重新整理不會掉。 */
export interface Filters {
  kinds: string[]; // 空 = 全部;值:整層住家 / 獨立套房 / 分租套房 / 雅房 / 其他
  /** 只看租屋 / 買房筆記;null = 都看 */
  deal: "rent" | "buy" | null;
  rentMin: number | null;
  rentMax: number | null;
  districts: string[]; // 「台北市中正區」(縣市 + 行政區,不同縣市有同名的區);舊資料只有「中正區」也認得;空 = 全部
  roomsMin: number | null; // 1 / 2 / 3(3 = 3 以上)
  sizeMin: number | null;
  elevator: boolean; // true = 只要有電梯
  pet: boolean;
  cooking: boolean;
  hideRejected: boolean;
  stages: string[]; // 空 = 全部
  favOnly: boolean; // 只看收藏(有 stage 的)
  priceDrop: boolean; // 只看降過價的
  newOnly: boolean; // 只看新上架(來源刊登 7 天內)
  /** 通勤上限(分,公車 + 捷運轉乘一次內);算的地點見 commutePlaces。搭不到的房源會被濾掉 */
  commuteMax: number | null;
  commutePlaces: number[]; // 空 = 我的全部地點(每個都要在上限內)
  /** 列表 / 地圖 / 篩選看上班還是下班(兩個分開看,上下班路線常不一樣) */
  commuteSide: CommuteSide;
  /** 上班、下班各自的日子與出發時間(方向固定:上班 住處 → 地點,下班 地點 → 住處) */
  commuteTimes: Record<CommuteSide, { day: DayType; time: string }>;
  /** 通勤算不算 YouBike(騎到目的地或捷運站旁) */
  commuteBike: boolean;
  /** 通勤方式:大眾運輸(路網算)或機車 / 開車(距離估,shared/drive.ts);篩選、排序、上色、符合度都跟著它 */
  commuteMode: CommuteMode;
  /** 經過這些路線(任一條):公車主路線名(307)或捷運線名(板南線);走得到才留 */
  alongRoutes: string[];
  /** 隱藏不符需求(紅)的房源;沒設需求時無效 */
  fitOnly: boolean;
  /** 列表排序 */
  sort: SortKey;
}

export type SortKey = "updated" | "rent" | "commute" | "newest" | "drop" | "market" | "fit";
export type FitOf = (p: PropertySummary) => FitResult | null;

export const EMPTY: Filters = {
  kinds: [],
  deal: null,
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
  priceDrop: false,
  newOnly: false,
  commuteMax: null,
  commutePlaces: [],
  alongRoutes: [],
  fitOnly: false,
  commuteSide: "go",
  commuteBike: true,
  commuteMode: "transit",
  commuteTimes: {
    go: { day: COMMUTE_DEFAULT.go.day, time: COMMUTE_DEFAULT.go.time },
    back: { day: COMMUTE_DEFAULT.back.day, time: COMMUTE_DEFAULT.back.time },
  },
  sort: "updated",
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

/** 清除篩選;排序與上下班時間是設定,不跟著清 */
export function resetFilters() {
  setFilters({ ...EMPTY, sort: current.sort, commuteSide: current.commuteSide, commuteTimes: current.commuteTimes, commuteBike: current.commuteBike, commuteMode: current.commuteMode });
}

/** 某一邊(上班 / 下班)的完整時段 */
export function whenOf(f: Filters, side: CommuteSide = f.commuteSide): CommuteWhen {
  return { ...f.commuteTimes[side], dir: COMMUTE_DEFAULT[side].dir };
}

export function useFilters(): Filters {
  const f = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  // 方案沒有自訂通勤:只算平日 08:00 上班、不含 YouBike(伺服器也是這樣擋;存著的設定不動,升級後就回來)
  const custom = usePlan().ent.commuteCustom;
  return useMemo(
    () =>
      custom
        ? f
        : { ...f, commuteSide: "go", commuteBike: false, commuteTimes: { ...f.commuteTimes, go: { day: COMMUTE_DEFAULT.go.day, time: COMMUTE_DEFAULT.go.time } } },
    [f, custom],
  );
}

/** 有幾個條件在作用中(hideRejected 是預設,不算) */
export function activeCount(f: Filters): number {
  let n = 0;
  if (f.kinds.length) n++;
  if (f.deal) n++;
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
  if (f.priceDrop) n++;
  if (f.newOnly) n++;
  if (f.commuteMax != null) n++;
  if (f.alongRoutes.length) n++;
  if (f.fitOnly) n++;
  return n;
}

/** 通勤篩選 / 排序要用的資料(useCommute 的結果 + 我的全部地點) */
export interface CommuteCtx {
  matrix: CommuteMatrix | undefined;
  placeIds: number[];
}

/** 這間房到「要算的地點」裡最久的那個(分);任何一個搭不到 → null;沒資料 → undefined */
export function worstCommute(p: PropertySummary, f: Filters, ctx: CommuteCtx | undefined): number | null | undefined {
  if (!ctx?.matrix || ctx.placeIds.length === 0) return undefined;
  const ids = f.commutePlaces.filter((id) => ctx.placeIds.includes(id));
  const use = ids.length ? ids : ctx.placeIds;
  const row = ctx.matrix.items[p.id];
  if (!row) return null;
  let worst = 0;
  for (const id of use) {
    const b = row[id];
    if (!b) return null;
    worst = Math.max(worst, b.total_min);
  }
  return worst;
}

/** along = 走得到 alongRoutes 的房源 id(useAlong);undefined = 還沒查到,先不濾 */
export function applyFilters(items: PropertySummary[], f: Filters, ctx?: CommuteCtx, along?: Set<number>, fitOf?: FitOf): PropertySummary[] {
  return items.filter((p) => {
    if (f.fitOnly && fitOf?.(p)?.level === "red") return false;
    if (f.alongRoutes.length && along && !along.has(p.id)) return false;
    if (f.commuteMax != null) {
      const w = worstCommute(p, f, ctx);
      // 資料還沒到(undefined)先不濾,免得畫面閃空
      if (w === null || (w !== undefined && w > f.commuteMax)) return false;
    }
    if (f.deal && (p.deal ?? "rent") !== f.deal) return false;
    if (f.kinds.length && !(p.kind && f.kinds.includes(p.kind))) return false;
    if (f.rentMin != null && (p.rent == null || p.rent < f.rentMin)) return false;
    if (f.rentMax != null && (p.rent == null || p.rent > f.rentMax)) return false;
    if (f.districts.length && !f.districts.includes(`${p.city}${p.district}`) && !f.districts.includes(p.district)) return false;
    if (f.roomsMin != null && (p.rooms == null || p.rooms < f.roomsMin)) return false;
    if (f.sizeMin != null && (p.size_ping == null || p.size_ping < f.sizeMin)) return false;
    if (f.elevator && p.has_elevator !== true) return false;
    if (f.pet && p.pet_allowed !== true) return false;
    if (f.cooking && p.cooking_allowed !== true) return false;
    if (f.favOnly && !p.stage) return false;
    if (f.priceDrop && !((priceOf(p)?.totalDelta ?? 0) < 0)) return false;
    if (f.newOnly && !ageOf(p)?.isNew) return false;
    if (f.hideRejected && p.stage === "rejected") return false;
    if (f.stages.length && !(p.stage && f.stages.includes(p.stage))) return false;
    return true;
  });
}

export function sortItems(items: PropertySummary[], f: Filters, ctx?: CommuteCtx, market?: MarketMatrix, fitOf?: FitOf): PropertySummary[] {
  if (f.sort === "fit" && fitOf) {
    // 符合度高的在前:不符(紅)排後面,紅的裡面再比分數;沒分數(只有硬性條件、都過)當滿分
    const key = (p: PropertySummary) => {
      const r = fitOf(p);
      if (!r) return 0;
      return (r.fails.length ? 10 : 0) + (1 - (r.score ?? 1));
    };
    return [...items].sort((a, b) => key(a) - key(b));
  }
  if (f.sort === "market") {
    // 比行情便宜最多的在前;樣本不足的排在有把握的後面,算不出的最後
    const key = (p: PropertySummary) => {
      const b = market?.items[p.id];
      return b?.diff_pct == null ? Infinity : b.diff_pct + (b.enough ? 0 : 1000);
    };
    return [...items].sort((a, b) => key(a) - key(b));
  }
  if (f.sort === "rent") return [...items].sort((a, b) => (a.rent ?? Infinity) - (b.rent ?? Infinity));
  if (f.sort === "newest") {
    const key = (p: PropertySummary) => ageOf(p)?.days ?? Infinity;
    return [...items].sort((a, b) => key(a) - key(b));
  }
  if (f.sort === "drop") {
    const key = (p: PropertySummary) => priceOf(p)?.totalDelta ?? 0;
    return [...items].sort((a, b) => key(a) - key(b));
  }
  if (f.sort === "commute") {
    const key = (p: PropertySummary) => commuteSortKey(p, f, ctx);
    return [...items].sort((a, b) => key(a) - key(b));
  }
  return items; // API 已經依更新時間排好
}

/** 排序用:先比「幾個地點搭不到」(少的在前),再比搭得到的地點裡最久的分鐘。全部搭不到 / 沒座標排最後 */
function commuteSortKey(p: PropertySummary, f: Filters, ctx?: CommuteCtx): number {
  if (!ctx?.matrix || ctx.placeIds.length === 0) return 0;
  const ids = f.commutePlaces.filter((id) => ctx.placeIds.includes(id));
  const use = ids.length ? ids : ctx.placeIds;
  const row = ctx.matrix.items[p.id];
  if (!row) return Infinity;
  let missing = 0;
  let worst = 0;
  for (const id of use) {
    const b = row[id];
    if (b) worst = Math.max(worst, b.total_min);
    else missing++;
  }
  return missing === use.length ? Infinity : missing * 10000 + worst;
}
