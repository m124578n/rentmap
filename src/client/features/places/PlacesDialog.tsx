import { useState } from "react";
import { MapPin, Pencil, Search, Trash2, X } from "lucide-react";
import type { Place } from "@shared/schemas";
import { searchAddress, type GeoHit } from "./geocode";
import { PinMap } from "./PinMap";
import { setCommuteTarget, usePlaceMutations, usePlaces, usePlacesDialogOpen } from "./places";

/** 放在 Layout:任何地方呼叫 openPlacesDialog() 就打開 */
export function PlacesDialogHost() {
  const [open, setOpen] = usePlacesDialogOpen();
  if (!open) return null;
  return <PlacesDialog onClose={() => setOpen(false)} />;
}

type Draft = { id: number | null; name: string; address: string; pin: { lat: number; lng: number } | null };

/**
 * 我的地點(公司、爸媽家…):輸入地址 → 搜尋 → 選一個結果 → 小地圖上拖曳圖釘對到門口 → 儲存。
 * 通勤相關功能都以這裡存的座標為準。
 */
export function PlacesDialog({ onClose }: { onClose: () => void }) {
  const places = usePlaces();
  const items = places.data?.items ?? [];
  const mut = usePlaceMutations();
  // 還沒有任何地點就直接進新增表單,名稱預設「公司」
  const [draft, setDraft] = useState<Draft | null>(() => null);
  const editing = draft ?? (places.isSuccess && items.length === 0 ? { id: null, name: "公司", address: "", pin: null } : null);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="max-h-[92dvh] w-full overflow-auto rounded-t-xl bg-white p-4 shadow-xl sm:max-w-lg sm:rounded-xl dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="我的地點"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 font-semibold">
            <MapPin size={18} /> 我的地點
          </h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label="關閉">
            <X size={18} />
          </button>
        </div>
        <p className="mb-3 text-sm text-neutral-500">存公司(或常去的地方)的地址,房源就能算通勤:哪些公車直達、要多久。</p>

        {editing ? (
          <PlaceForm
            key={editing.id ?? "new"}
            initial={editing}
            canCancel={items.length > 0}
            saving={mut.create.isPending || mut.update.isPending}
            onCancel={() => setDraft(null)}
            onSave={(v) => {
              const body = { name: v.name, address: v.address || null, lat: v.pin.lat, lng: v.pin.lng };
              if (v.id == null)
                mut.create.mutate(body, {
                  onSuccess: ({ place }) => {
                    setCommuteTarget(place.id);
                    setDraft(null);
                  },
                });
              else mut.update.mutate({ id: v.id, ...body }, { onSuccess: () => setDraft(null) });
            }}
          />
        ) : (
          <>
            <ul className="grid gap-1.5">
              {items.map((p) => (
                <PlaceRow
                  key={p.id}
                  place={p}
                  onEdit={() => setDraft({ id: p.id, name: p.name, address: p.address ?? "", pin: { lat: p.lat, lng: p.lng } })}
                  onDelete={() => {
                    if (confirm(`刪除「${p.name}」?`)) mut.remove.mutate(p.id);
                  }}
                />
              ))}
            </ul>
            <div className="mt-3 flex justify-between">
              <button className="btn-ghost" onClick={() => setDraft({ id: null, name: "", address: "", pin: null })}>
                + 新增地點
              </button>
              <button className="btn-primary" onClick={onClose}>
                完成
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PlaceRow({ place, onEdit, onDelete }: { place: Place; onEdit: () => void; onDelete: () => void }) {
  return (
    <li className="flex items-center justify-between gap-2 rounded border border-neutral-200 px-3 py-2 dark:border-neutral-800">
      <div className="min-w-0">
        <div className="font-medium">{place.name}</div>
        <div className="truncate text-xs text-neutral-500">{place.address || `${place.lat.toFixed(5)}, ${place.lng.toFixed(5)}`}</div>
      </div>
      <div className="flex shrink-0 gap-1">
        <button onClick={onEdit} className="rounded p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label="修改">
          <Pencil size={15} />
        </button>
        <button onClick={onDelete} className="rounded p-1.5 text-red-600 hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label="刪除">
          <Trash2 size={15} />
        </button>
      </div>
    </li>
  );
}

function PlaceForm({
  initial,
  canCancel,
  saving,
  onCancel,
  onSave,
}: {
  initial: Draft;
  canCancel: boolean;
  saving: boolean;
  onCancel: () => void;
  onSave: (v: Draft & { pin: { lat: number; lng: number } }) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [address, setAddress] = useState(initial.address);
  const [pin, setPin] = useState(initial.pin);
  const [hits, setHits] = useState<GeoHit[] | null>(null);
  const [chosen, setChosen] = useState<GeoHit | null>(null);
  const [searching, setSearching] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function search() {
    if (!address.trim()) return;
    setSearching(true);
    setErr(null);
    try {
      const r = await searchAddress(address);
      setHits(r);
      if (r.length) {
        setChosen(r[0]!);
        setPin({ lat: r[0]!.lat, lng: r[0]!.lng });
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "地址搜尋失敗");
    } finally {
      setSearching(false);
    }
  }

  const canSave = name.trim() !== "" && pin != null && !saving;
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void search();
      }}
    >
      <label className="grid gap-1 text-sm">
        <span className="text-xs text-neutral-500">名稱</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="公司、爸媽家…" maxLength={30} />
      </label>
      <label className="grid gap-1 text-sm">
        <span className="text-xs text-neutral-500">地址</span>
        <div className="flex gap-2">
          <input
            className="input"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="例:台北市中正區忠孝西路一段49號"
            maxLength={120}
            autoFocus={initial.id == null}
          />
          <button type="submit" className="btn-ghost shrink-0" disabled={searching || !address.trim()}>
            <Search size={15} /> {searching ? "搜尋中" : "搜尋"}
          </button>
        </div>
      </label>

      {err && <p className="text-sm text-red-600">{err}</p>}
      {hits && hits.length === 0 && <p className="text-sm text-amber-700 dark:text-amber-400">找不到這個地址。試著只打到路名,或直接在下面地圖上點公司的位置。</p>}
      {hits && hits.length > 1 && (
        <ul className="grid gap-1 text-sm">
          {hits.map((h, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => {
                  setChosen(h);
                  setPin({ lat: h.lat, lng: h.lng });
                }}
                className={`w-full rounded px-2 py-1 text-left ${chosen === h ? "bg-blue-50 dark:bg-blue-950" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
              >
                {h.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {chosen?.level === "road" && <p className="text-xs text-amber-700 dark:text-amber-400">只找到路段,請把圖釘拖到公司門口。</p>}

      {(hits != null || pin != null) && (
        <div className="grid gap-1">
          <PinMap value={pin} onChange={setPin} />
          <p className="text-xs text-neutral-500">{pin ? "拖曳圖釘或點地圖,對到門口的位置" : "在地圖上點一下放圖釘"}</p>
        </div>
      )}

      <div className="flex justify-end gap-2">
        {canCancel && (
          <button type="button" className="btn-ghost" onClick={onCancel}>
            取消
          </button>
        )}
        <button type="button" className="btn-primary" disabled={!canSave} onClick={() => pin && onSave({ id: initial.id, name: name.trim(), address: address.trim(), pin })}>
          {saving ? "儲存中…" : "儲存"}
        </button>
      </div>
    </form>
  );
}
