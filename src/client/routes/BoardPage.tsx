import { useMemo, useState, type DragEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Star } from "lucide-react";
import { api } from "@/lib/api";
import type { PropertySummary } from "@shared/schemas";
import { STAGES, STAGE_LABEL, type Stage } from "@shared/constants";

/** 找房看板:收藏的房源依狀態分欄,拖曳換狀態(原生 HTML5 DnD,手機用卡片上的「移到」選單)。 */
export function BoardPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["properties"], queryFn: api.listProperties });
  const move = useMutation({
    mutationFn: ({ id, stage }: { id: number; stage: Stage }) => api.setFavorite(id, { stage }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["properties"] }),
  });
  const [dragId, setDragId] = useState<number | null>(null);
  const [over, setOver] = useState<Stage | null>(null);

  const cols = useMemo(() => {
    const favs = (q.data?.items ?? []).filter((p) => p.stage);
    const m = new Map<Stage, PropertySummary[]>(STAGES.map((s) => [s, []]));
    for (const p of favs) m.get(p.stage as Stage)?.push(p);
    for (const list of m.values()) list.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || (b.fav_updated_at ?? "").localeCompare(a.fav_updated_at ?? ""));
    return m;
  }, [q.data]);
  const total = [...cols.values()].reduce((n, l) => n + l.length, 0);

  const onDrop = (stage: Stage) => (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const id = dragId ?? Number(e.dataTransfer.getData("text/plain"));
    setDragId(null);
    if (id) move.mutate({ id, stage });
  };

  if (q.isLoading) return <p className="p-4 text-neutral-500">載入中…</p>;
  if (total === 0)
    return (
      <div className="card m-4 text-center text-neutral-500">
        還沒有收藏。到
        <Link to="/" className="mx-1 text-emerald-600 underline">
          地圖
        </Link>
        點房源按「收藏這間」。
      </div>
    );

  return (
    <div className="flex h-full gap-3 overflow-x-auto p-4">
      {STAGES.map((stage) => {
        const list = cols.get(stage) ?? [];
        return (
          <section
            key={stage}
            onDragOver={(e) => {
              e.preventDefault();
              if (over !== stage) setOver(stage);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={onDrop(stage)}
            className={`flex w-64 min-w-0 shrink-0 flex-col rounded-lg border ${over === stage ? "border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/30" : "border-neutral-200 bg-neutral-100/60 dark:border-neutral-800 dark:bg-neutral-900/60"}`}
          >
            <h2 className="flex items-center justify-between px-3 py-2 text-sm font-medium">
              {STAGE_LABEL[stage]}
              <span className="rounded-full bg-white px-1.5 text-xs text-neutral-500 dark:bg-neutral-800">{list.length}</span>
            </h2>
            <div className="flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
              {list.map((p) => (
                <Card key={p.id} p={p} onDragStart={() => setDragId(p.id)} onMove={(s) => move.mutate({ id: p.id, stage: s })} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Card({ p, onDragStart, onMove }: { p: PropertySummary; onDragStart: () => void; onMove: (s: Stage) => void }) {
  return (
    <article
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", String(p.id));
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      className="min-w-0 cursor-grab rounded-md border border-neutral-200 bg-white p-2.5 text-sm shadow-sm active:cursor-grabbing dark:border-neutral-700 dark:bg-neutral-800"
    >
      <div className="flex items-start justify-between gap-1">
        <Link to="/p/$id" params={{ id: String(p.id) }} className="min-w-0 font-medium leading-snug break-words hover:underline">
          {p.title}
        </Link>
        <span className="shrink-0 font-semibold text-emerald-700 dark:text-emerald-400">{p.rent != null ? `$${p.rent.toLocaleString()}` : "—"}</span>
      </div>
      <p className="mt-0.5 text-xs text-neutral-500">
        {p.district}
        {p.road ? ` ${p.road}` : ""} · {p.kind ?? ""} {p.size_ping != null ? `${p.size_ping}坪` : ""} {p.rooms != null ? `${p.rooms}房` : ""}
      </p>
      {(p.priority ?? 0) > 0 && (
        <p className="mt-1 flex gap-0.5">
          {Array.from({ length: p.priority ?? 0 }).map((_, i) => (
            <Star key={i} size={12} className="fill-amber-400 text-amber-400" />
          ))}
        </p>
      )}
      {p.tags.length > 0 && (
        <p className="mt-1 flex flex-wrap gap-1">
          {p.tags.map((t) => (
            <span key={t} className="rounded bg-neutral-100 px-1 text-[11px] dark:bg-neutral-700">
              {t}
            </span>
          ))}
        </p>
      )}
      {p.fav_note && <p className="mt-1 line-clamp-2 text-xs text-neutral-600 dark:text-neutral-400">{p.fav_note}</p>}
      {p.listing_status === "removed" && <p className="mt-1 text-xs text-red-600">已下架</p>}
      <select
        className="mt-2 w-full rounded border border-neutral-200 bg-transparent px-1 py-0.5 text-xs text-neutral-500 sm:hidden dark:border-neutral-700"
        value={p.stage ?? ""}
        onChange={(e) => onMove(e.target.value as Stage)}
        aria-label="移到"
      >
        {STAGES.map((s) => (
          <option key={s} value={s}>
            {STAGE_LABEL[s]}
          </option>
        ))}
      </select>
    </article>
  );
}
