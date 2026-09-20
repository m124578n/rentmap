import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "@/lib/api";
import { SOURCE_LABEL, STAGE_LABEL, type Source, type Stage } from "@shared/constants";

export function ListPage() {
  const q = useQuery({ queryKey: ["properties"], queryFn: api.listProperties });
  if (q.isLoading) return <p className="text-neutral-500">載入中…</p>;
  if (q.error) return <p className="text-red-600">讀取失敗</p>;
  const items = q.data?.items ?? [];
  if (items.length === 0)
    return (
      <div className="card m-4 text-center text-neutral-500">
        還沒有房源。
        <Link to="/new" className="ml-1 text-emerald-600 underline">
          新增第一間
        </Link>
      </div>
    );
  return (
    <ul className="mx-auto grid max-w-5xl gap-3 p-4 sm:grid-cols-2">
      {items.map((p) => (
        <li key={p.id}>
          <Link to="/p/$id" params={{ id: String(p.id) }} className="card block hover:border-emerald-500">
            <div className="flex items-start justify-between gap-2">
              <h2 className="font-medium">{p.title}</h2>
              <span className="whitespace-nowrap text-lg font-semibold text-emerald-700 dark:text-emerald-400">
                {p.rent != null ? `$${p.rent.toLocaleString()}` : "—"}
              </span>
            </div>
            <p className="mt-1 text-sm text-neutral-500">
              {p.city}
              {p.district}
              {p.road ? ` ${p.road}` : ""}
            </p>
            <p className="mt-1 flex flex-wrap gap-x-3 text-sm text-neutral-600 dark:text-neutral-400">
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
            <p className="mt-2 flex gap-2 text-xs">
              {p.stage && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">{STAGE_LABEL[p.stage as Stage] ?? p.stage}</span>}
              {p.source && <span className="rounded bg-neutral-100 px-1.5 py-0.5 dark:bg-neutral-800">{SOURCE_LABEL[p.source as Source] ?? p.source}</span>}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
