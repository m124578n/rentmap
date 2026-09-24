import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ExternalLink, Maximize2, Trash2, X } from "lucide-react";
import { api } from "@/lib/api";
import { SOURCE_LABEL, type Source } from "@shared/constants";
import { BusSection } from "@/features/bus/BusSection";
import type { BusOverlay } from "@/features/map/busLayer";
import { FavoritePanel } from "./FavoritePanel";

interface Props {
  id: number;
  /** 地圖左側面板模式:有關閉鈕與「全頁」連結 */
  onClose?: () => void;
  /** 地圖頁才有:公車區塊選了路線就畫到地圖上 */
  onBusOverlay?: (o: BusOverlay | null) => void;
}

/** 房源詳細:照片、狀態、規格、來源與聯絡、備註。DetailPage 與地圖左側面板共用。 */
export function PropertyDetail({ id, onClose, onBusOverlay }: Props) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["property", id], queryFn: () => api.getProperty(id), enabled: Number.isInteger(id) });
  const del = useMutation({
    mutationFn: () => api.deleteProperty(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["properties"] });
      if (onClose) onClose();
      else nav({ to: "/" });
    },
  });

  if (q.isLoading) return <p className="p-4 text-neutral-500">載入中…</p>;
  if (q.error || !q.data) return <p className="p-4 text-red-600">找不到這間房源</p>;
  const { property: p, listings, favorite } = q.data;
  const main = listings[0];
  const photos = safePhotos(main?.photosJson);
  const extra = safeExtra(main?.rawJson);

  return (
    <div className="grid gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-2xl font-semibold text-emerald-700 dark:text-emerald-400">{main ? `$${main.rent.toLocaleString()}` : "—"}</div>
          <h1 className="font-semibold leading-snug">{p.title}</h1>
          <p className="text-sm text-neutral-500">
            {p.city}
            {p.district}
            {p.road ? ` ${p.road}` : ""}
          </p>
        </div>
        {onClose && (
          <div className="flex shrink-0 gap-1">
            <Link to="/p/$id" params={{ id: String(id) }} className="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800" title="全頁">
              <Maximize2 size={16} />
            </Link>
            <button onClick={onClose} className="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label="關閉">
              <X size={16} />
            </button>
          </div>
        )}
      </div>

      {photos.length > 0 && <PhotoStrip photos={photos} />}

      {extra?.market_hint && <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">591:{extra.market_hint}</p>}

      <FavoritePanel id={id} favorite={favorite} />

      <section className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm sm:grid-cols-3">
        <Row k="坪數" v={p.sizePing != null ? `${p.sizePing} 坪` : null} />
        <Row k="格局" v={fmtLayout(p.rooms, p.livingRooms, p.bathrooms)} />
        <Row k="樓層" v={p.floor != null ? `${p.floor}${p.totalFloors != null ? ` / ${p.totalFloors}` : ""} F` : null} />
        <Row k="屋齡" v={p.buildingAge != null ? `${p.buildingAge} 年` : null} />
        <Row k="型態" v={p.buildingType} />
        <Row k="管理費" v={p.mgmtFee != null ? `$${p.mgmtFee} / 月` : null} />
        <Row k="押金" v={main?.depositMonths != null ? `${main.depositMonths} 個月` : null} />
        <Row k="捷運" v={extra?.mrt ? `${extra.mrt.name} ${extra.mrt.distance_m}m` : null} />
        <Row k="電梯" v={yn(p.hasElevator)} />
        <Row k="停車" v={yn(p.hasParking)} />
        <Row k="寵物" v={yn(p.petAllowed)} />
        <Row k="開伙" v={yn(p.cookingAllowed)} />
        <Row k="洗衣機" v={yn(p.hasWasher)} />
        <Row k="網路" v={yn(p.hasInternet)} />
        <Row k="水電" v={p.utilitiesNote} />
      </section>

      {extra?.tags && extra.tags.length > 0 && (
        <p className="flex flex-wrap gap-1">
          {extra.tags.map((t) => (
            <span key={t} className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs dark:bg-neutral-800">
              {t}
            </span>
          ))}
        </p>
      )}

      {p.lat != null && p.lng != null && <BusSection key={id} lat={p.lat} lng={p.lng} onOverlay={onBusOverlay} />}

      {main && (
        <section className="text-sm">
          <h2 className="mb-1.5 text-xs font-medium text-neutral-500">來源與聯絡</h2>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-3">
            <Row k="來源" v={SOURCE_LABEL[main.source as Source] ?? main.source} />
            <Row k="聯絡人" v={main.contactName} />
            <Row k="電話" v={main.contactPhone} />
            <Row k="首次看到" v={main.firstSeenAt.slice(0, 10)} />
            <Row k="狀態" v={main.status === "active" ? "刊登中" : main.status} />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {main.sourceUrl && (
              <a href={main.sourceUrl} target="_blank" rel="noreferrer" className="btn-ghost">
                原始連結 <ExternalLink size={14} />
              </a>
            )}
            {main.contactLine && (
              <a href={main.contactLine} target="_blank" rel="noreferrer" className="btn-ghost">
                LINE <ExternalLink size={14} />
              </a>
            )}
            {main.contactPhone && (
              <a href={`tel:${main.contactPhone.replace(/\D/g, "")}`} className="btn-ghost">
                撥打
              </a>
            )}
          </div>
        </section>
      )}

      {extra?.remark_html && <Remark html={extra.remark_html} />}

      {p.note && (
        <section className="text-sm whitespace-pre-wrap">
          <h2 className="mb-1.5 text-xs font-medium text-neutral-500">我的備註</h2>
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

function PhotoStrip({ photos }: { photos: string[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <>
      <div className="-mx-4 flex snap-x gap-1.5 overflow-x-auto px-4">
        {photos.map((src, i) => (
          <button key={src} onClick={() => setOpen(i)} className="shrink-0 snap-start">
            <img src={src} alt="" loading="lazy" className="h-28 w-40 rounded object-cover" />
          </button>
        ))}
      </div>
      {open != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4" onClick={() => setOpen(null)}>
          <img src={photos[open]} alt="" className="max-h-full max-w-full rounded" />
          <button className="absolute top-3 right-3 rounded bg-black/50 p-2 text-white" aria-label="關閉">
            <X size={20} />
          </button>
          <div className="absolute bottom-3 text-sm text-white/80">
            {open + 1} / {photos.length}
          </div>
        </div>
      )}
    </>
  );
}

/** 591 的屋況介紹是 HTML;只留文字與換行,不直接 innerHTML */
function Remark({ html }: { html: string }) {
  const [more, setMore] = useState(false);
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) return null;
  const short = text.length > 200 && !more;
  return (
    <section className="text-sm">
      <h2 className="mb-1.5 text-xs font-medium text-neutral-500">屋況介紹</h2>
      <p className="whitespace-pre-wrap text-neutral-700 dark:text-neutral-300">{short ? text.slice(0, 200) + "…" : text}</p>
      {text.length > 200 && (
        <button onClick={() => setMore(!more)} className="mt-1 text-xs text-emerald-700 underline dark:text-emerald-400">
          {more ? "收起" : "展開全文"}
        </button>
      )}
    </section>
  );
}

interface Extra {
  tags?: string[];
  market_hint?: string;
  mrt?: { name: string; distance_m: number };
  remark_html?: string;
}
function safeExtra(raw: string | null | undefined): Extra | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Extra;
  } catch {
    return null;
  }
}
function safePhotos(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function Row({ k, v }: { k: string; v: string | null | undefined }) {
  if (v == null || v === "") return null;
  return (
    <div>
      <span className="text-xs text-neutral-500">{k}</span>
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
