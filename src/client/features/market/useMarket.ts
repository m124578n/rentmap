import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

/** 所有房源的行情摘要(列表卡片的「比行情 ±N%」) */
export function useMarket() {
  return useQuery({ queryKey: ["market"], queryFn: api.market, staleTime: 10 * 60_000 });
}
