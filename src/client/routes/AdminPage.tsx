import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Activity, Database, FileCheck, Gift, MapPin, NotebookPen, RefreshCw, Users } from "lucide-react";
import type { AdminStats } from "@shared/admin";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/useAuth";

/** 營運儀表板(/admin):只有站長(OWNER_EMAILS)看得到;不是站長 API 回 404,這頁顯示「找不到」 */
export function AdminPage() {
  const { owner } = useAuth();
  const q = useQuery({ queryKey: ["admin-stats"], queryFn: api.adminStats, enabled: owner, refetchInterval: 5 * 60_000 });
  if (!owner) return <p className="p-6 text-sm text-neutral-500">找不到這個頁面。</p>;
  if (q.isLoading) return <p className="p-6 text-sm text-neutral-500">載入中…</p>;
  if (!q.data) return <p className="p-6 text-sm text-red-600">讀不到營運數據:{String(q.error ?? "")}</p>;
  const d = q.data;
  return (
    <div className="mx-auto grid max-w-5xl gap-4 p-4 text-sm">
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <Activity size={20} /> 營運
        </h1>
        <button className="btn-ghost text-xs" onClick={() => q.refetch()} disabled={q.isFetching}>
          <RefreshCw size={14} className={q.isFetching ? "animate-spin" : ""} /> {new Date(d.at).toLocaleString("zh-TW", { hour12: false })}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat icon={<Users size={16} />} label="使用者" value={d.users.total} sub={`近 7 天新增 ${d.users.new[1]}`} />
        <Stat icon={<Activity size={16} />} label="活躍(近 7 天)" value={d.users.active[1]} sub={`今天 ${d.users.active[0]} · 30 天 ${d.users.active[2]}`} />
        <Stat icon={<NotebookPen size={16} />} label="筆記" value={d.content.notes} sub={`${d.content.note_users} 人在用 · 買房 ${d.content.buy}`} />
        <Stat icon={<Gift size={16} />} label="付費中" value={d.users.pro} sub="不含站長" />
      </div>

      <Card title="近 30 天" icon={<Activity size={15} />}>
        <Bars series={d.series} k="signups" label="新註冊" color="#059669" />
        <Bars series={d.series} k="logins" label="最後登入(那天最後一次登入的人數)" color="#2563eb" />
        <Bars series={d.series} k="notes" label="新筆記" color="#d97706" />
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="內容" icon={<MapPin size={15} />}>
          <Rows
            rows={[
              ["筆記", d.content.notes],
              ["有筆記的人", d.content.note_users],
              ["我的地點", `${d.content.places}(${d.content.place_users} 人)`],
              ["收藏", d.content.favorites],
              ["新註冊 1 / 7 / 30 天", d.users.new.join(" / ")],
            ]}
          />
        </Card>
        <Card title="條款同意" icon={<FileCheck size={15} />}>
          <Rows rows={d.consents.map((c) => [`${c.doc === "terms" ? "服務條款" : c.doc === "privacy" ? "隱私權" : c.doc} ${c.version}${c.current ? "(目前版本)" : ""}`, `${c.n} 人`])} />
        </Card>
      </div>

      <Card title="最近登入" icon={<Users size={15} />}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-neutral-500">
              <tr>
                <th className="py-1 pr-2 font-normal">名字</th>
                <th className="py-1 pr-2 font-normal">email</th>
                <th className="py-1 pr-2 font-normal">註冊</th>
                <th className="py-1 pr-2 font-normal">最後登入</th>
                <th className="py-1 pr-2 font-normal">方案</th>
                <th className="py-1 pr-2 text-right font-normal">筆記</th>
                <th className="py-1 text-right font-normal">地點</th>
              </tr>
            </thead>
            <tbody>
              {d.recent.map((u) => (
                <tr key={u.id} className="border-t border-neutral-100 dark:border-neutral-800">
                  <td className="py-1 pr-2">{u.name ?? "—"}</td>
                  <td className="py-1 pr-2 text-neutral-600 dark:text-neutral-400">{u.email ?? "—"}</td>
                  <td className="py-1 pr-2 tabular-nums">{u.created_at.slice(0, 10)}</td>
                  <td className="py-1 pr-2 tabular-nums">{u.last_login_at.slice(0, 16).replace("T", " ")}</td>
                  <td className="py-1 pr-2">{u.plan === "free" ? "免費" : `完整版${u.plan_until ? ` 到 ${u.plan_until.slice(0, 10)}` : ""}`}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{u.notes}</td>
                  <td className="py-1 text-right tabular-nums">{u.places}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="開通紀錄(最近 10 筆)" icon={<Gift size={15} />}>
          {d.grants.length ? (
            <Rows rows={d.grants.map((g) => [`${g.created_at.slice(0, 10)} ${g.email ?? ""}`, `${g.offer} · ${g.days} 天 · $${g.price}`])} />
          ) : (
            <p className="text-xs text-neutral-500">還沒有(金流還沒串;手動開通用 npm run collect -- grant)</p>
          )}
        </Card>
        <Card title="資料庫" icon={<Database size={15} />}>
          <Rows rows={d.tables.map((t) => [t.table, t.rows.toLocaleString()])} />
          <Link to="/status" className="mt-1 inline-block text-xs text-emerald-700 underline dark:text-emerald-400">
            各生活圈的資料狀態 →
          </Link>
        </Card>
      </div>
    </div>
  );
}

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: number; sub: string }) {
  return (
    <div className="card">
      <p className="flex items-center gap-1 text-xs text-neutral-500">
        {icon} {label}
      </p>
      <p className="text-2xl font-semibold tabular-nums">{value.toLocaleString()}</p>
      <p className="text-[11px] text-neutral-500">{sub}</p>
    </div>
  );
}

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card">
      <h2 className="mb-2 flex items-center gap-1 text-xs font-medium text-neutral-500">
        {icon} {title}
      </h2>
      {children}
    </section>
  );
}

function Rows({ rows }: { rows: [string, string | number][] }) {
  return (
    <dl className="grid gap-0.5 text-xs">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-2 border-b border-neutral-100 py-0.5 last:border-0 dark:border-neutral-800">
          <dt className="text-neutral-600 dark:text-neutral-400">{k}</dt>
          <dd className="tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** 每天一根的長條(純 CSS) */
function Bars({ series, k, label, color }: { series: AdminStats["series"]; k: "signups" | "logins" | "notes"; label: string; color: string }) {
  const max = Math.max(1, ...series.map((s) => s[k]));
  const total = series.reduce((n, s) => n + s[k], 0);
  return (
    <div className="mb-3 last:mb-0">
      <p className="mb-1 flex justify-between text-[11px] text-neutral-500">
        <span>{label}</span>
        <span className="tabular-nums">30 天共 {total}</span>
      </p>
      <div className="flex h-16 items-end gap-px">
        {series.map((s) => (
          <div key={s.day} className="flex-1 rounded-t-sm" title={`${s.day}:${s[k]}`} style={{ height: `${(s[k] / max) * 100}%`, minHeight: s[k] ? 2 : 0, background: color }} />
        ))}
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] text-neutral-400">
        <span>{series[0]?.day.slice(5)}</span>
        <span>{series.at(-1)?.day.slice(5)}</span>
      </div>
    </div>
  );
}
