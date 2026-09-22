import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Heart, HeartOff, Star } from "lucide-react";
import { api, type Favorite } from "@/lib/api";
import { STAGES, STAGE_LABEL, type Stage } from "@shared/constants";

/**
 * 收藏區塊:收藏 / 取消、狀態、優先度(0–3 星)、標籤、私人備註(離開欄位自動存)。
 * 沒收藏時只顯示「收藏」鈕;其餘欄位收藏後才出現。
 */
export function FavoritePanel({ id, favorite }: { id: number; favorite: Favorite | null }) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["property", id] });
    qc.invalidateQueries({ queryKey: ["properties"] });
  };
  const save = useMutation({ mutationFn: (input: Parameters<typeof api.setFavorite>[1]) => api.setFavorite(id, input), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: () => api.removeFavorite(id), onSuccess: invalidate });

  const [note, setNote] = useState(favorite?.note ?? "");
  const [tagInput, setTagInput] = useState("");
  useEffect(() => setNote(favorite?.note ?? ""), [favorite?.note]);
  const tags = safeTags(favorite?.tagsJson);

  if (!favorite) {
    return (
      <button onClick={() => save.mutate({ stage: "saved" })} className="btn-primary w-full justify-center" disabled={save.isPending}>
        <Heart size={16} /> 收藏這間
      </button>
    );
  }

  return (
    <section className="grid gap-2 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1" title="優先度">
          {[1, 2, 3].map((n) => (
            <button key={n} onClick={() => save.mutate({ priority: favorite.priority === n ? 0 : n })} className="p-0.5" aria-label={`${n} 星`}>
              <Star size={18} className={(favorite.priority ?? 0) >= n ? "fill-amber-400 text-amber-400" : "text-neutral-300 dark:text-neutral-600"} />
            </button>
          ))}
          {(favorite.priority ?? 0) >= 3 && <span className="ml-1 text-xs text-amber-700 dark:text-amber-300">必看</span>}
        </div>
        <button onClick={() => confirm("取消收藏?狀態、備註、標籤會一起清掉。") && remove.mutate()} className="flex items-center gap-1 text-xs text-neutral-500 hover:text-red-600">
          <HeartOff size={14} /> 取消收藏
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {STAGES.map((s) => (
          <button
            key={s}
            onClick={() => save.mutate({ stage: s as Stage })}
            className={`rounded-full px-2.5 py-0.5 text-xs ${favorite.stage === s ? "bg-emerald-600 text-white" : "border border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"}`}
          >
            {STAGE_LABEL[s]}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {tags.map((t) => (
          <span key={t} className="flex items-center gap-0.5 rounded bg-white px-1.5 py-0.5 text-xs dark:bg-neutral-800">
            {t}
            <button onClick={() => save.mutate({ tags: tags.filter((x) => x !== t) })} className="text-neutral-400 hover:text-red-600" aria-label="移除標籤">
              ×
            </button>
          </span>
        ))}
        <input
          className="input h-7 w-28 py-0 text-xs"
          placeholder="+ 標籤"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && tagInput.trim()) {
              e.preventDefault();
              if (!tags.includes(tagInput.trim())) save.mutate({ tags: [...tags, tagInput.trim()] });
              setTagInput("");
            }
          }}
        />
      </div>

      <textarea
        className="input text-sm"
        rows={3}
        placeholder="私人備註(只有你看得到):房東說法、疑慮、要問的事…"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => {
          if (note !== (favorite.note ?? "")) save.mutate({ note: note || null });
        }}
      />
      {save.isPending && <span className="text-xs text-neutral-400">儲存中…</span>}
    </section>
  );
}

export function safeTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
