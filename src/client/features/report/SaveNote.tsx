import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BookmarkPlus } from "lucide-react";
import { ApiError, api } from "@/lib/api";
import { useRegion } from "@/lib/region";
import { DEAL_LABEL, DISTRICTS, KINDS, type City, type Deal, type Source } from "@shared/constants";
import { SALE_TYPES } from "@shared/sale";
import { PropertyInput } from "@shared/schemas";
import type { ReverseHit } from "@/features/places/geocode";
import { invalidateProperties } from "@/lib/invalidate";

/**
 * 地址即報告的「存成筆記」:看完一個點覺得可以,就存成自己的筆記。
 * 租屋填月租、房型、坪數;買房填總價(萬)、建物型態、建坪、土地、屋齡、車位(原始頁面都選填)。
 * 城市 / 行政區 / 路名從反查地址來;不在目前生活圈開放的縣市就不能存(行政區清單對不上)。
 */
export function SaveNote({
  lat,
  lng,
  addr,
  onSaved,
  deal = "rent",
}: {
  lat: number;
  lng: number;
  addr: ReverseHit;
  onSaved: (id: number) => void;
  deal?: Deal;
}) {
  const qc = useQueryClient();
  const region = useRegion();
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const city = (region.cities as readonly string[]).includes(addr.city) ? (addr.city as City) : null;
  const district = city && DISTRICTS[city].includes(addr.district) ? addr.district : null;

  const save = useMutation({
    mutationFn: api.createProperty,
    onSuccess: ({ id }) => {
      invalidateProperties(qc);
      onSaved(id);
    },
    onError: (e) => {
      const issues = e instanceof ApiError && e.status === 400 ? ((e.body as { issues?: { path: (string | number)[]; message: string }[] })?.issues ?? []) : [];
      setErrors(issues.length ? Object.fromEntries(issues.map((i) => [String(i.path[0]), i.message])) : { _: "儲存失敗" });
    },
  });

  if (!city || !district)
    return (
      <p className="text-xs text-neutral-500">
        {addr.city ? `${addr.city}${addr.district}目前還不能存(${region.label}以外或查不到行政區)。` : "查不到這裡的地址,不能存成筆記。"}
      </p>
    );

  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="btn-primary justify-center">
        <BookmarkPlus size={16} /> 存成{DEAL_LABEL[deal]}筆記
      </button>
    );

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const raw: Record<string, unknown> = Object.fromEntries(fd.entries());
    if (deal === "buy") {
      // 總價用「萬」輸入,存元
      raw.price = Number(raw.price_wan) > 0 ? Math.round(Number(raw.price_wan) * 10000) : undefined;
      delete raw.price_wan;
      raw.has_parking = fd.has("has_parking");
    }
    const parsed = PropertyInput.safeParse({
      ...raw,
      deal,
      city,
      district,
      road: addr.road || undefined,
      address_text: addr.label,
      lat,
      lng,
      source: sourceOf(String(raw.source_url ?? "")),
    });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  }
  const err = (k: string) => errors[k] && <span className="text-xs text-red-600">{errors[k]}</span>;
  const label = "grid gap-0.5 text-xs text-neutral-600 dark:text-neutral-300";

  return (
    <form onSubmit={onSubmit} className="card grid gap-2 text-sm">
      <p className="text-xs font-medium text-neutral-500">
        存成{DEAL_LABEL[deal]}筆記 · {city}
        {district}
      </p>
      <label className={label}>
        標題
        <input name="title" className="input" defaultValue={addr.label || `${city}${district}`} required />
        {err("title")}
      </label>
      {deal === "buy" ? (
        <div className="grid grid-cols-3 gap-2">
          <label className={label}>
            總價(萬)
            <input name="price_wan" type="number" inputMode="decimal" min={1} step="0.1" className="input" placeholder="例:2880" required autoFocus />
            {err("price")}
          </label>
          <label className={label}>
            型態
            <select name="building_type" className="input" defaultValue="電梯大樓">
              {SALE_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className={label}>
            建坪
            <input name="size_ping" type="number" inputMode="decimal" step="0.1" min={0} className="input" />
            {err("size_ping")}
          </label>
          <label className={label}>
            土地(坪)
            <input name="land_ping" type="number" inputMode="decimal" step="0.01" min={0} className="input" />
          </label>
          <label className={label}>
            屋齡(年)
            <input name="building_age" type="number" inputMode="numeric" min={0} className="input" />
          </label>
          <label className="flex items-center gap-1 self-end pb-2 text-xs text-neutral-600 dark:text-neutral-300">
            <input type="checkbox" name="has_parking" /> 含車位
          </label>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          <label className={label}>
            月租
            <input name="rent" type="number" inputMode="numeric" min={1} className="input" placeholder="例:18000" required autoFocus />
            {err("rent")}
          </label>
          <label className={label}>
            房型
            <select name="kind" className="input" defaultValue="獨立套房">
              {KINDS.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <label className={label}>
            坪數
            <input name="size_ping" type="number" inputMode="decimal" step="0.1" min={0} className="input" />
            {err("size_ping")}
          </label>
        </div>
      )}
      <label className={label}>
        原始頁面(選填)
        <input name="source_url" type="url" className="input" placeholder="https://" />
        {err("source_url")}
      </label>
      <p className="text-[11px] text-neutral-400">只存這些事實與你自己的筆記;其他(通勤、行情、機能、災害)都從位置算。</p>
      {errors._ && <p className="text-xs text-red-600">{errors._}</p>}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={save.isPending}>
          {save.isPending ? "儲存中…" : "儲存"}
        </button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
          取消
        </button>
      </div>
    </form>
  );
}

/** 從原始頁面網址認來源(認不出來當手動) */
function sourceOf(url: string): Source {
  if (/591\.com\.tw/.test(url)) return "591";
  if (/rakuya\.com\.tw/.test(url)) return "rakuya";
  if (/facebook\.com/.test(url)) return "fb";
  return "manual";
}
