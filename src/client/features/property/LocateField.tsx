import { lazy, Suspense, useState } from "react";
import { MapPin, Search } from "lucide-react";
import { searchAddress } from "@/features/places/geocode";
import { regionBbox } from "@shared/regions";
import { useRegion } from "@/lib/region";
// 小地圖要載地圖引擎,按了定位才載
const PinMap = lazy(() => import("@/features/places/PinMap").then((m) => ({ default: m.PinMap })));

type Pin = { lat: number; lng: number };

/**
 * 筆記的位置:用表單上的地址查座標(瀏覽器查 Nominatim),再拖圖釘對到門口。
 * 沒定位的筆記不會出現在地圖上,也算不了通勤。
 */
export function LocateField({ value, onChange, address }: { value: Pin | null; onChange: (p: Pin | null) => void; address: () => string }) {
  const region = useRegion();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function locate() {
    const q = address().trim();
    setOpen(true);
    setMsg(null);
    if (!q) return setMsg("先填路段或地址,或直接在地圖上點位置");
    setBusy(true);
    try {
      const hits = await searchAddress(q, regionBbox(region.key));
      if (!hits.length) setMsg("找不到這個地址,直接在地圖上點位置");
      else {
        onChange({ lat: hits[0]!.lat, lng: hits[0]!.lng });
        setMsg(hits[0]!.level === "road" ? "只找到路段,把圖釘拖到門口" : "拖曳圖釘可以微調");
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "地址搜尋失敗");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`flex items-center gap-1 ${value ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}>
          <MapPin size={15} /> {value ? "已定位" : "還沒定位(不會出現在地圖、不能算通勤)"}
        </span>
        <button type="button" className="btn-ghost ml-auto" onClick={() => void locate()} disabled={busy}>
          <Search size={15} /> {busy ? "查詢中…" : value ? "重新用地址定位" : "用地址定位"}
        </button>
      </div>
      {msg && <p className="text-xs text-neutral-500">{msg}</p>}
      {(open || value) && (
        <Suspense fallback={<div className="h-64 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800" />}>
          <PinMap value={value} onChange={onChange} />
        </Suspense>
      )}
    </div>
  );
}
