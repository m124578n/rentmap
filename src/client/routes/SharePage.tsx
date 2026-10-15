import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { REGIONS } from "@shared/regions";
import { DEFAULT_WEIGHTS } from "@shared/zones";
import { api } from "@/lib/api";
import { useTheme } from "@/lib/useTheme";
import { useNarrow } from "@/lib/useNarrow";
import { MapView } from "@/features/map/MapView";
import { useMrt } from "@/features/map/mrt";
import { ZonesPanel } from "@/features/zones/ZonesPanel";
import type { ZonesSettings } from "@/features/zones/useZones";

const NONE: never[] = [];

/** 落腳圈的分享頁(/s/:token):不用登入、唯讀;地圖 + 圈內的區 */
export function SharePage() {
  const { token } = useParams({ from: "/s/$token" });
  const { theme } = useTheme();
  const narrow = useNarrow();
  const mrt = useMrt();
  const q = useQuery({ queryKey: ["share", token], queryFn: () => api.sharedZones(token), retry: false });
  const [fitTo, setFitTo] = useState<{ bbox: [number, number, number, number]; n: number } | null>(null);
  const focus = useCallback((bbox: [number, number, number, number]) => setFitTo((f) => ({ bbox, n: (f?.n ?? 0) + 1 })), []);
  const noop = useCallback(() => {}, []);

  if (q.isLoading) return <p className="p-6 text-sm text-neutral-500">載入中…(第一次計算約需幾秒)</p>;
  if (!q.data)
    return (
      <div className="p-6 text-sm">
        <p className="text-neutral-600">這個分享連結不存在或已被刪除。</p>
        <Link to="/about" className="text-emerald-700 underline">
          落腳筆記是什麼?
        </Link>
      </div>
    );
  const d = q.data;
  const s: ZonesSettings = { on: true, mode: d.mode, combine: d.combine, rings: d.rings, weights: DEFAULT_WEIGHTS, rentKind: "整層住家", budgetOnly: false };
  const panel = (
    <>
      <p className="border-b border-neutral-100 px-4 pt-3 pb-2 text-[11px] text-neutral-500 dark:border-neutral-800">
        別人分享的落腳圈({d.created_at.slice(0, 10)} 建立;地點:{d.places.map((p) => p.name).join("、")})。
        <Link to="/about" className="ml-1 text-emerald-700 underline">
          自己也做一份
        </Link>
      </p>
      <ZonesPanel s={s} data={d} loading={false} error={null} nPlaces={d.places.length} onFocus={focus} readOnly />
    </>
  );
  return (
    <div className={`flex h-full ${narrow ? "flex-col" : ""}`}>
      {!narrow && <aside className="w-[400px] shrink-0 overflow-auto border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">{panel}</aside>}
      <div className={`relative ${narrow ? "h-[50vh]" : "min-w-0 flex-1"}`}>
        <MapView items={NONE} selectedId={null} onSelect={noop} theme={theme} mrt={mrt.data ?? null} view={REGIONS[d.region].view} zones={d} fitTo={fitTo} />
      </div>
      {narrow && <div className="min-h-0 flex-1 overflow-auto">{panel}</div>}
    </div>
  );
}
