import { useState, type FormEvent } from "react";
import { Search, X } from "lucide-react";
import { regionBbox } from "@shared/regions";
import { useRegion } from "@/lib/region";
import { searchAddress, type GeoHit } from "@/features/places/geocode";

/**
 * 地址即報告的入口:輸入地址 → 瀏覽器查 Nominatim(只找目前生活圈)→ 選一筆就打開那個點的報告。
 * Nominatim 規範 1 秒一次、不能邊打邊查,所以只在按搜尋時查。
 */
export function AddressSearch({ onPick }: { onPick: (p: { lat: number; lng: number }) => void }) {
  const region = useRegion();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<GeoHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const text = q.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await searchAddress(text, regionBbox(region.key));
      if (r.length === 1) {
        onPick(r[0]!);
        setHits(null);
      } else setHits(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : "搜尋失敗");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-72 max-w-full">
      <form onSubmit={onSubmit} className="flex items-center gap-1 rounded-lg border border-neutral-200 bg-white/95 px-2 py-1 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/95">
        <Search size={15} className="shrink-0 text-neutral-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`輸入${region.label}的地址,看那裡的報告`}
          className="min-w-0 flex-1 bg-transparent py-1 text-sm outline-none"
          enterKeyHint="search"
          aria-label="地址"
        />
        {hits && (
          <button type="button" onClick={() => setHits(null)} className="text-neutral-400" aria-label="清除結果">
            <X size={14} />
          </button>
        )}
        <button type="submit" disabled={busy} className="shrink-0 rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-60">
          {busy ? "查詢中" : "查"}
        </button>
      </form>
      {error && <p className="mt-1 rounded bg-red-50 px-2 py-1 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
      {hits && (
        <ul className="mt-1 max-h-60 overflow-auto rounded-lg border border-neutral-200 bg-white text-sm shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          {hits.length === 0 && <li className="px-2 py-1.5 text-xs text-neutral-500">找不到;試試少打一點(例:只到路名與門牌),或在地圖上右鍵 / 長按那個位置</li>}
          {hits.map((h, i) => (
            <li key={i}>
              <button
                onClick={() => {
                  onPick(h);
                  setHits(null);
                }}
                className="block w-full px-2 py-1.5 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800"
              >
                {h.label}
                {h.level !== "exact" && <span className="ml-1 text-[11px] text-neutral-400">(大概位置)</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
