import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CommuteMatrix, CommuteSide } from "@shared/trip";
import { haversine } from "@shared/bus";
import { driveBrief } from "@shared/drive";
import { api } from "@/lib/api";
import { useRegion } from "@/lib/region";
import { useFilters, whenOf, type CommuteCtx } from "@/lib/filters";
import { usePlaces } from "@/features/places/places";
import { usePlan } from "@/lib/plan";

/**
 * 所有房源 × 我的地點 的通勤;沒有地點就不查。
 *   大眾運輸:後端算(公車 + 捷運 + 台鐵,轉乘一次內)
 *   機車 / 開車:前端用距離估(shared/drive.ts),做成同一個形狀,篩選 / 排序 / 符合度 / 支出照用
 * side 省略 = 篩選列目前選的(上班 / 下班);時段設定改了會重查。
 */
export function useCommute(side?: CommuteSide) {
  const places = usePlaces();
  const f = useFilters();
  const region = useRegion();
  const when = whenOf(f, side);
  const list = places.data?.items ?? [];
  const sig = list.map((p) => `${p.id}@${p.lat},${p.lng}`).join("|");
  const mode = f.commuteMode;
  // 下班時段是付費功能:免費方案不查(伺服器會回 402),畫面顯示鎖
  const locked = (side ?? f.commuteSide) === "back" && !usePlan().ent.commuteCustom;
  const q = useQuery({
    queryKey: ["commute", region.key, sig, when.day, when.time, when.dir, f.commuteBike],
    queryFn: () => api.commute(when, f.commuteBike, region.key),
    enabled: list.length > 0 && mode === "transit" && !locked,
    staleTime: 5 * 60_000,
  });
  const props = useQuery({ queryKey: ["properties"], queryFn: api.listProperties, enabled: list.length > 0 && mode !== "transit" && !locked });
  const matrix = useMemo((): CommuteMatrix | undefined => {
    if (locked) return undefined;
    if (mode === "transit") return q.data;
    if (!props.data) return undefined;
    const items: CommuteMatrix["items"] = {};
    for (const p of props.data.items) {
      if (p.lat == null || p.lng == null) continue;
      const row: CommuteMatrix["items"][string] = {};
      for (const pl of list) row[pl.id] = driveBrief(mode, haversine(p.lat, p.lng, pl.lat, pl.lng), when, region.key);
      items[p.id] = row;
    }
    return { radius: 0, when, has_bus: true, items };
  }, [locked, mode, q.data, props.data, sig, when.day, when.time, when.dir, region.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const ctx: CommuteCtx = useMemo(() => ({ matrix, placeIds: list.map((p) => p.id) }), [matrix, sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const loading = !locked && (mode === "transit" ? q.isLoading : props.isLoading);
  return { places: list, placesLoaded: places.isSuccess, matrix, ctx, when, mode, locked, isLoading: loading && list.length > 0 };
}
