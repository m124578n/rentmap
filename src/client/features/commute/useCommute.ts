import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { CommuteCtx } from "@/lib/filters";
import { usePlaces } from "@/features/places/places";

/** 所有房源 × 我的地點 的通勤(公車 + 捷運,轉乘一次內);沒有地點就不查 */
export function useCommute() {
  const places = usePlaces();
  const list = places.data?.items ?? [];
  const sig = list.map((p) => `${p.id}@${p.lat},${p.lng}`).join("|");
  const q = useQuery({ queryKey: ["commute", sig], queryFn: () => api.commute(), enabled: list.length > 0, staleTime: 5 * 60_000 });
  const ctx: CommuteCtx = useMemo(() => ({ matrix: q.data, placeIds: list.map((p) => p.id) }), [q.data, sig]); // eslint-disable-line react-hooks/exhaustive-deps
  return { places: list, placesLoaded: places.isSuccess, matrix: q.data, ctx, isLoading: q.isLoading && list.length > 0 };
}
