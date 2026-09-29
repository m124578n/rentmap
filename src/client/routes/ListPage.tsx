import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "@/lib/api";
import { applyFilters, setFilters, sortItems, useFilters, type SortKey } from "@/lib/filters";
import { useCommute } from "@/features/commute/useCommute";
import { useAlong } from "@/features/bus/useAlong";
import { useMarket } from "@/features/market/useMarket";
import { MarketBadge } from "@/features/market/MarketSection";
import { CommuteLines } from "@/features/commute/CommuteLines";
import { ListingBadges } from "@/features/listing/ListingBadges";
import { FilterBar } from "@/components/FilterBar";
import { SOURCE_LABEL, STAGE_LABEL, type Source, type Stage } from "@shared/constants";

export function ListPage() {
  const q = useQuery({ queryKey: ["properties"], queryFn: api.listProperties });
  const filters = useFilters();
  const all = q.data?.items ?? [];
  const commute = useCommute();
  const along = useAlong();
  const market = useMarket();
  const items = useMemo(
    () => sortItems(applyFilters(all, filters, commute.ctx, along.ids), filters, commute.ctx, market.data),
    [all, filters, commute.ctx, along.ids, market.data],
  );

  return (
    <div className="flex h-full flex-col">
      <FilterBar shown={items.length} total={all.length} />
      <div className="min-h-0 flex-1 overflow-auto">
        {all.length > 0 && (
          <div className="mx-auto flex max-w-5xl items-center justify-end gap-1.5 px-4 pt-3 text-xs text-neutral-500">
            排序
            <select value={filters.sort} onChange={(e) => setFilters({ sort: e.target.value as SortKey })} className="rounded border border-neutral-300 bg-transparent px-1.5 py-1 dark:border-neutral-700">
              <option value="updated">最近更新</option>
              <option value="rent">租金低 → 高</option>
              <option value="newest">剛刊登的在前</option>
              <option value="drop">降價最多的在前</option>
              <option value="market">比行情便宜的在前</option>
              <option value="commute" disabled={commute.places.length === 0}>
                通勤短 → 長{commute.places.length > 1 ? "(取最久的地點)" : ""}
              </option>
            </select>
          </div>
        )}
        {q.isLoading ? (
          <p className="p-4 text-neutral-500">載入中…</p>
        ) : q.error ? (
          <p className="p-4 text-red-600">讀取失敗</p>
        ) : all.length === 0 ? (
          <div className="card m-4 text-center text-neutral-500">
            還沒有房源。
            <Link to="/new" className="ml-1 text-emerald-600 underline">
              新增第一間
            </Link>
          </div>
        ) : items.length === 0 ? (
          <p className="p-4 text-center text-neutral-500">沒有符合篩選條件的房源</p>
        ) : (
          <ul className="mx-auto grid max-w-5xl gap-3 p-4 sm:grid-cols-2">
            {items.map((p) => (
              <li key={p.id}>
                <Link to="/p/$id" params={{ id: String(p.id) }} className="card block hover:border-emerald-500">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-medium">{p.title}</h2>
                    <span className="flex flex-col items-end gap-0.5">
                      <span className="whitespace-nowrap text-lg font-semibold text-emerald-700 dark:text-emerald-400">
                        {p.rent != null ? `$${p.rent.toLocaleString()}` : "—"}
                      </span>
                      <MarketBadge b={market.data?.items[p.id]} />
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-neutral-500">
                    {p.city}
                    {p.district}
                    {p.road ? ` ${p.road}` : ""}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-x-3 text-sm text-neutral-600 dark:text-neutral-400">
                    {p.kind && <span>{p.kind}</span>}
                    {p.size_ping != null && <span>{p.size_ping} 坪</span>}
                    {p.rooms != null && <span>{p.rooms} 房</span>}
                    {p.floor != null && (
                      <span>
                        {p.floor}
                        {p.total_floors != null ? `/${p.total_floors}` : ""}F
                      </span>
                    )}
                    {p.has_elevator != null && <span>{p.has_elevator ? "有電梯" : "無電梯"}</span>}
                    {p.mgmt_fee != null && <span>管理費 {p.mgmt_fee}</span>}
                  </p>
                  {commute.places.length > 0 && <CommuteLines propertyId={p.id} places={commute.places} matrix={commute.matrix} hasCoords={p.lat != null && p.lng != null} />}
                  <div className="mt-1.5">
                    <ListingBadges p={p} />
                  </div>
                  <p className="mt-2 flex gap-2 text-xs">
                    {p.stage && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">{STAGE_LABEL[p.stage as Stage] ?? p.stage}</span>}
                    {p.source && <span className="rounded bg-neutral-100 px-1.5 py-0.5 dark:bg-neutral-800">{SOURCE_LABEL[p.source as Source] ?? p.source}</span>}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
