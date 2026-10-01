import { useQuery } from "@tanstack/react-query";
import { Database } from "lucide-react";
import { api } from "@/lib/api";
import type { StatusItem } from "@shared/status";
import { useCrimeDistricts } from "@/features/crime/CrimeSection";
import { useRegion } from "@/lib/region";
import { RegionPicker } from "@/features/report/RegionPicker";

const GROUPS: StatusItem["group"][] = ["房源", "交通", "生活機能", "行情", "災害", "治安"];

function when(i: StatusItem) {
  if (!i.updated) return "還沒匯入";
  const d = i.updated.slice(0, 10);
  if (i.age_days == null) return d;
  return `${d}(${i.age_days === 0 ? "今天" : `${i.age_days} 天前`})`;
}

/**
 * 資料狀態:每份資料多少筆、什麼時候更新的、多久該跑一次;過期或還沒匯入的標紅並列出在家要跑的指令。
 * 房源看「最後一次看到」(每日同步有沒有在跑),實價登錄看最新的租賃日。
 */
export function StatusPage() {
  const region = useRegion();
  const q = useQuery({ queryKey: ["status", region.key], queryFn: () => api.status(region.key), staleTime: 60_000 });
  const crime = useCrimeDistricts();
  // 治安各區件數:只數這個生活圈的縣市
  const crimeDistricts = crime.data ? Object.keys(crime.data.items).filter((k) => (region.cities as readonly string[]).includes(k.split("|")[0]!)).length : 0;
  if (q.isLoading) return <p className="p-4 text-neutral-500">載入中…</p>;
  if (!q.data) return <p className="p-4 text-red-600">讀不到資料狀態</p>;
  const items = q.data.items;
  const stale = items.filter((i) => i.stale);
  return (
    <div className="mx-auto grid max-w-4xl gap-4 p-4 text-sm">
      <div>
        <h1 className="flex items-center gap-1.5 text-lg font-semibold">
          <Database size={18} /> 資料狀態
        </h1>
        <p className="text-xs text-neutral-500">各份資料最後更新時間;紅色的是過期或還沒匯入,在家那台跑右邊的指令。</p>
        <div className="mt-2 flex items-center gap-2 text-xs">
          <span className="text-neutral-500">目前看的是「{region.label}」</span>
          <RegionPicker />
        </div>
      </div>

      {stale.length > 0 ? (
        <section className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          <p className="mb-1 font-medium">{stale.length} 份要重跑</p>
          <ul className="grid gap-0.5">
            {[...new Set(stale.map((i) => i.command))].map((c) => (
              <li key={c}>
                <code className="rounded bg-white/70 px-1 dark:bg-black/30">{c}</code>
                <span className="ml-1.5 text-red-700/80 dark:text-red-300/80">({stale.filter((i) => i.command === c).map((i) => i.label).join("、")})</span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">全部都是新的。</p>
      )}

      {GROUPS.map((g) => {
        const rows = items.filter((i) => i.group === g);
        if (!rows.length) return null;
        return (
          <section key={g} className="card overflow-x-auto">
            <h2 className="mb-1.5 text-xs font-medium text-neutral-500">{g}</h2>
            <table className="w-full text-xs">
              <tbody>
                {rows.map((i) => (
                  <tr key={i.key} className="border-t border-neutral-100 align-top dark:border-neutral-800">
                    <td className="py-1 pr-2 whitespace-nowrap">
                      {i.stale && <span className="mr-1 inline-block h-2 w-2 rounded-full bg-red-500" title="要重跑" />}
                      {i.label}
                    </td>
                    <td className="py-1 pr-2 text-right whitespace-nowrap tabular-nums">{i.count.toLocaleString()}</td>
                    <td className={`py-1 pr-2 whitespace-nowrap ${i.stale ? "text-red-600 dark:text-red-400" : "text-neutral-600 dark:text-neutral-400"}`}>{when(i)}</td>
                    <td className="py-1 pr-2 whitespace-nowrap text-neutral-500">{i.every}</td>
                    <td className="py-1 text-neutral-500">
                      <code className="text-[11px]">{i.command}</code>
                      {i.note && <div className="text-[11px] text-neutral-400">{i.note}</div>}
                    </td>
                  </tr>
                ))}
                {g === "治安" && crime.data && (
                  <tr className="border-t border-neutral-100 dark:border-neutral-800">
                    <td className="py-1 pr-2">各區件數({region.label})</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{crimeDistricts} 區</td>
                    <td className="py-1 pr-2 text-neutral-600 dark:text-neutral-400">
                      {crime.data.from} ~ {crime.data.to}
                    </td>
                    <td className="py-1 pr-2 text-neutral-500">每季</td>
                    <td className="py-1 text-neutral-500">
                      <code className="text-[11px]">npm run collect -- crime</code>
                      <div className="text-[11px] text-neutral-400">public/crime-districts.json,跑完要 commit</div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}
