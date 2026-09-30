import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useFilters } from "@/lib/filters";
import { useRegion } from "@/lib/region";

/** 篩選「經過路線」:走得到任一條的房源 id;沒設就不查 */
export function useAlong() {
  const f = useFilters();
  const names = f.alongRoutes;
  const region = useRegion();
  const q = useQuery({
    queryKey: ["along", region.key, names.join(",")],
    queryFn: () => api.busAlong(names, region.key),
    enabled: names.length > 0,
    staleTime: 5 * 60_000,
  });
  const ids = useMemo(() => (q.data ? new Set(q.data.ids) : undefined), [q.data]);
  return { data: q.data, ids };
}
