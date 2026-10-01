import { useQuery } from "@tanstack/react-query";
import { UNLIMITED, type PlanDenied, type PlanState } from "@shared/plan";
import { ApiError, api } from "./api";

/**
 * 目前的方案與權限(/api/me)。只拿來決定畫面怎麼顯示;真正的限制在伺服器(src/worker/plan.ts),
 * 前端改這裡也拿不到資料。還沒載入時當成不限(免得一閃而過的鎖),伺服器照樣會擋。
 */
export function usePlan(): PlanState {
  const q = useQuery({ queryKey: ["me"], queryFn: api.me, staleTime: 60_000 });
  return q.data?.plan ?? { plan: "free", until: null, ent: UNLIMITED, enforced: false };
}

/** API 回 402(方案不含這個功能)時的說明;其他錯誤回 null */
export function planError(e: unknown): string | null {
  if (e instanceof ApiError && e.status === 402) return (e.body as PlanDenied | null)?.message ?? "這是完整版的功能。";
  return null;
}
