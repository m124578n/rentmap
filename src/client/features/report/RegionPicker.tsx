import { MapPinned } from "lucide-react";
import { OPEN_REGIONS, setRegion, useRegion } from "@/lib/region";
import { REGIONS, REGION_KEYS } from "@shared/regions";

/**
 * 生活圈切換(偏好設定,存在這台瀏覽器)。只開一個生活圈時不顯示;還沒開的列出來標「準備中」。
 * 房源與我的地點依座標歸區,切換不會刪任何東西。
 */
export function RegionPicker() {
  const region = useRegion();
  if (OPEN_REGIONS.length < 2) return null;
  return (
    <label className="flex items-center gap-1 rounded-lg border border-neutral-200 bg-white/95 px-2 py-1 text-xs shadow-sm dark:border-neutral-800 dark:bg-neutral-900/95">
      <MapPinned size={13} className="text-neutral-500 dark:text-neutral-300" />
      <span className="text-neutral-500 dark:text-neutral-300">找哪裡</span>
      <select value={region.key} onChange={(e) => setRegion(e.target.value as typeof region.key)} className="bg-transparent text-neutral-900 dark:text-neutral-100" aria-label="生活圈">
        {REGION_KEYS.map((k) => (
          <option key={k} value={k} disabled={!REGIONS[k].enabled}>
            {REGIONS[k].label}
            {REGIONS[k].enabled ? "" : "(準備中)"}
          </option>
        ))}
      </select>
    </label>
  );
}
