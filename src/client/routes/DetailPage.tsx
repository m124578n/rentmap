import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { ExternalLink, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { SOURCE_LABEL, STAGES, STAGE_LABEL, type Source, type Stage } from "@shared/constants";

export function DetailPage() {
  const { id: idStr } = useParams({ from: "/p/$id" });
  const id = Number(idStr);
  const qc = useQueryClient();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["property", id], queryFn: () => api.getProperty(id), enabled: Number.isInteger(id) });
  const setStage = useMutation({
    mutationFn: (stage: Stage) => api.setStage(id, { stage }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["property", id] });
      qc.invalidateQueries({ queryKey: ["properties"] });
    },
  });
  const del = useMutation({
    mutationFn: () => api.deleteProperty(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["properties"] });
      nav({ to: "/" });
    },
  });

  if (q.isLoading) return <p className="text-neutral-500">載入中…</p>;
  if (q.error || !q.data) return <p className="text-red-600">找不到這間房源</p>;
  const { property: p, listings, favorite } = q.data;
  const main = listings[0];

  return (
    <div className="mx-auto grid max-w-3xl gap-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{p.title}</h1>
          <p className="text-sm text-neutral-500">
            {p.city}
            {p.district}
            {p.road ? ` ${p.road}` : ""}
            {p.addressText ? ` · ${p.addressText}` : ""}
          </p>
        </div>
        <div className="text-2xl font-semibold text-emerald-700 dark:text-emerald-400">{main ? `$${main.rent.toLocaleString()}` : "—"}</div>
      </div>

      <section className="card">
        <h2 className="mb-2 text-sm font-medium text-neutral-500">狀態</h2>
        <div className="flex flex-wrap gap-2">
          {STAGES.map((s) => (
            <button
              key={s}
              onClick={() => setStage.mutate(s)}
              className={`rounded-full px-3 py-1 text-sm ${
                favorite?.stage === s
                  ? "bg-emerald-600 text-white"
                  : "border border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
              }`}
            >
              {STAGE_LABEL[s]}
            </button>
          ))}
        </div>
      </section>

      <section className="card grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        <Row k="坪數" v={p.sizePing != null ? `${p.sizePing} 坪` : null} />
        <Row k="格局" v={fmtLayout(p.rooms, p.livingRooms, p.bathrooms)} />
        <Row k="樓層" v={p.floor != null ? `${p.floor}${p.totalFloors != null ? ` / ${p.totalFloors}` : ""} F` : null} />
        <Row k="屋齡" v={p.buildingAge != null ? `${p.buildingAge} 年` : null} />
        <Row k="型態" v={p.buildingType} />
        <Row k="管理費" v={p.mgmtFee != null ? `$${p.mgmtFee} / 月` : null} />
        <Row k="押金" v={main?.depositMonths != null ? `${main.depositMonths} 個月` : null} />
        <Row k="電梯" v={yn(p.hasElevator)} />
        <Row k="停車" v={yn(p.hasParking)} />
        <Row k="寵物" v={yn(p.petAllowed)} />
        <Row k="開伙" v={yn(p.cookingAllowed)} />
        <Row k="洗衣機" v={yn(p.hasWasher)} />
        <Row k="網路" v={yn(p.hasInternet)} />
        <Row k="水電" v={p.utilitiesNote} />
      </section>

      {main && (
        <section className="card text-sm">
          <h2 className="mb-2 text-sm font-medium text-neutral-500">來源與聯絡</h2>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
            <Row k="來源" v={SOURCE_LABEL[main.source as Source] ?? main.source} />
            <Row k="聯絡人" v={main.contactName} />
            <Row k="電話" v={main.contactPhone} />
            <Row k="LINE" v={main.contactLine} />
            <Row k="首次看到" v={main.firstSeenAt.slice(0, 10)} />
            <Row k="狀態" v={main.status} />
          </div>
          {main.sourceUrl && (
            <a href={main.sourceUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-emerald-700 underline dark:text-emerald-400">
              原始連結 <ExternalLink size={14} />
            </a>
          )}
        </section>
      )}

      {p.note && (
        <section className="card text-sm whitespace-pre-wrap">
          <h2 className="mb-2 text-sm font-medium text-neutral-500">備註</h2>
          {p.note}
        </section>
      )}

      <div className="flex justify-end">
        <button
          className="btn-ghost text-red-600"
          onClick={() => {
            if (confirm("確定刪除這間房源?")) del.mutate();
          }}
        >
          <Trash2 size={16} /> 刪除
        </button>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string | null | undefined }) {
  if (v == null || v === "") return null;
  return (
    <div>
      <span className="text-neutral-500">{k}</span>
      <div>{v}</div>
    </div>
  );
}
function yn(v: boolean | null) {
  return v == null ? null : v ? "有" : "無";
}
function fmtLayout(r: number | null, l: number | null, b: number | null) {
  const parts = [r != null && `${r} 房`, l != null && `${l} 廳`, b != null && `${b} 衛`].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}
