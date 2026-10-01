import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ApiError, api } from "@/lib/api";
import { PropertyInput } from "@shared/schemas";
import { useRegion } from "@/lib/region";
import { usePrivatePool } from "@/lib/useAuth";
import { usePurpose } from "@/lib/purpose";
import { BUILDING_TYPES, DEALS, DEAL_LABEL, DISTRICTS, KINDS, SOURCES, SOURCE_LABEL, type City, type Deal } from "@shared/constants";
import { invalidateProperties } from "@/lib/invalidate";
import { parseImportHash, type ImportedFacts } from "@shared/bookmarklet";
import { bookmarkletHref } from "@/lib/bookmarklet";
import { normalizeCity } from "@shared/regions";

/** 手動新增房源。表單值全部是字串 / checkbox,交給 Zod schema 轉型與驗證。 */
export function NewPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const region = useRegion();
  // 公開版不收聯絡人(個資);私人模式照舊
  const pool = usePrivatePool();
  // 書籤小工具帶過來的欄位(/new#import=…,只在瀏覽器裡,不經過伺服器)
  const [imported] = useState<ImportedFacts | null>(() => parseImportHash(window.location.hash));
  const importedCity = normalizeCity(imported?.city);
  const cityOk = !!importedCity && (region.cities as readonly string[]).includes(importedCity);
  const [city, setCity] = useState<City>(cityOk ? (importedCity as City) : region.cities[0]!);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!imported || !formRef.current) return;
    fillForm(formRef.current, imported);
    // 帶完就把 # 清掉,重新整理或分享網址不會再帶一次
    history.replaceState(null, "", window.location.pathname);
  }, [imported]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // 租屋 / 買房:預設跟著地址報告的用途(只看附近 → 租屋)
  const purpose = usePurpose();
  const [deal, setDeal] = useState<Deal>(purpose === "buy" ? "buy" : "rent");

  const create = useMutation({
    mutationFn: api.createProperty,
    onSuccess: ({ id }) => {
      invalidateProperties(qc);
      nav({ to: "/p/$id", params: { id: String(id) } });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 400) {
        const issues = (e.body as { issues?: { path: (string | number)[]; message: string }[] })?.issues ?? [];
        setErrors(Object.fromEntries(issues.map((i) => [String(i.path[0]), i.message])));
      } else setErrors({ _: "儲存失敗" });
    },
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const raw: Record<string, unknown> = Object.fromEntries(fd.entries());
    for (const k of BOOL_FIELDS) raw[k] = fd.has(k);
    raw.deal = deal;
    if (deal === "buy") {
      // 總價用「萬」輸入,存元
      raw.price = Number(raw.price_wan) > 0 ? Math.round(Number(raw.price_wan) * 10000) : undefined;
      delete raw.rent;
    }
    delete raw.price_wan;
    const parsed = PropertyInput.safeParse(raw);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    create.mutate(parsed.data);
  }

  const err = (k: string) => errors[k] && <span className="text-xs text-red-600">{errors[k]}</span>;

  return (
    <form ref={formRef} onSubmit={onSubmit} className="mx-auto grid max-w-2xl gap-4 p-4">
      <input type="hidden" name="lat" />
      <input type="hidden" name="lng" /> 
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">新增{DEAL_LABEL[deal]}筆記</h1>
        {DEALS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDeal(d)}
            className={`rounded-full border px-2.5 py-0.5 text-xs ${deal === d ? "border-neutral-800 bg-neutral-800 text-white dark:border-neutral-200 dark:bg-neutral-200 dark:text-neutral-900" : "border-neutral-300 text-neutral-600 dark:border-neutral-700 dark:text-neutral-300"}`}
          >
            {DEAL_LABEL[d]}
          </button>
        ))}
      </div>
      <p className="-mt-2 text-sm text-neutral-500">
        {pool ? (
          <>
            591、好房的物件用採集比較快:<code className="text-xs">npm run collect -- add &lt;網址&gt;</code>。這裡是手動記錄(朋友介紹、社團、仲介)。
          </>
        ) : (
          "只記事實(租金、坪數、樓層、設備…)與你自己的筆記;照片、屋況介紹、房東聯絡方式請看原始頁面。也可以在地圖上輸入地址,看完報告再存。"
        )}
      </p>
      {imported ? (
        <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          已從原始頁面帶入 {Object.keys(imported).length} 個欄位,確認後再儲存。照片、屋況介紹、聯絡方式不會帶過來。
          {imported.city && !cityOk && <span className="block text-amber-700 dark:text-amber-400">{imported.city}不在目前的生活圈({region.label}),縣市與行政區請自己選。</span>}
        </div>
      ) : (
        <BookmarkletCard />
      )}

      <section className="card grid gap-3">
        <Field label="標題" error={err("title")}>
          <input name="title" className="input" placeholder="例:大安區近捷運兩房" required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="縣市">
            <select name="city" className="input" value={city} onChange={(e) => setCity(e.target.value as City)}>
              {region.cities.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="行政區" error={err("district")}>
            <select name="district" className="input" required>
              {DISTRICTS[city].map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="路段">
            <input name="road" className="input" placeholder="信義路四段" />
          </Field>
          <Field label="完整地址(可選)">
            <input name="address_text" className="input" />
          </Field>
        </div>
      </section>

      <section className="card grid gap-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {deal === "buy" ? (
            <>
              <Field label="總價(萬)" error={err("price")}>
                <input key="price" name="price_wan" type="number" min={1} step="0.1" className="input" required />
              </Field>
              <Field label="建坪">
                <input name="size_ping" type="number" min={0} step="0.1" className="input" />
              </Field>
              <Field label="土地(坪)">
                <input name="land_ping" type="number" min={0} step="0.01" className="input" />
              </Field>
            </>
          ) : (
            <>
              <Field label="租金 / 月" error={err("rent")}>
                <input key="rent" name="rent" type="number" min={1} className="input" required />
              </Field>
              <Field label="坪數">
                <input name="size_ping" type="number" min={0} step="0.1" className="input" />
              </Field>
            </>
          )}
          <Field label="房">
            <input name="rooms" type="number" min={0} className="input" />
          </Field>
          <Field label="樓層">
            <input name="floor" type="number" min={0} className="input" />
          </Field>
          <Field label={deal === "buy" ? "房型(選填)" : "房型"}>
            <select name="kind" className="input" defaultValue="">
              <option value="">—</option>
              {KINDS.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </Field>
        </div>
        {/* 次要欄位收起來;<details> 收起時欄位仍在表單裡,送出照樣會帶 */}
        <details className="group">
          <summary className="cursor-pointer text-sm text-neutral-500 select-none">更多規格(管理費、押金、格局、屋齡、設備…)</summary>
          <div className="mt-3 grid gap-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="管理費 / 月">
                <input name="mgmt_fee" type="number" min={0} className="input" />
              </Field>
              {deal === "rent" && (
                <Field label="押金(月)">
                  <input name="deposit_months" type="number" min={0} step="0.5" className="input" />
                </Field>
              )}
              <Field label="廳">
                <input name="living_rooms" type="number" min={0} className="input" />
              </Field>
              <Field label="衛">
                <input name="bathrooms" type="number" min={0} className="input" />
              </Field>
              <Field label="總樓層">
                <input name="total_floors" type="number" min={0} className="input" />
              </Field>
              <Field label="屋齡(年)">
                <input name="building_age" type="number" min={0} className="input" />
              </Field>
              <Field label="型態">
                <select name="building_type" className="input" defaultValue="">
                  <option value="">—</option>
                  {BUILDING_TYPES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
              {BOOL_FIELDS.map((k) => (
                <label key={k} className="flex items-center gap-1">
                  <input type="checkbox" name={k} /> {BOOL_LABEL[k]}
                </label>
              ))}
            </div>
            <Field label="水電 / 費用備註">
              <input name="utilities_note" className="input" placeholder="電費一度 5 元、水費含" />
            </Field>
          </div>
        </details>
      </section>

      <details className="card">
        <summary className="cursor-pointer text-sm text-neutral-500 select-none">來源、聯絡人、備註(可選)</summary>
        <div className="mt-3 grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="來源">
              <select name="source" className="input" defaultValue="manual">
                {SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {SOURCE_LABEL[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="原始連結" error={err("source_url")}>
              <input name="source_url" type="url" className="input" placeholder="https://" />
            </Field>
            {pool && (
              <>
                <Field label="聯絡人">
                  <input name="contact_name" className="input" />
                </Field>
                <Field label="電話">
                  <input name="contact_phone" className="input" />
                </Field>
                <Field label="LINE">
                  <input name="contact_line" className="input" />
                </Field>
              </>
            )}
          </div>
          <Field label="備註">
            <textarea name="note" className="input" rows={3} />
          </Field>
        </div>
      </details>

      {errors._ && <p className="text-red-600">{errors._}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={() => history.back()}>
          取消
        </button>
        <button type="submit" className="btn-primary" disabled={create.isPending}>
          {create.isPending ? "儲存中…" : "儲存"}
        </button>
      </div>
    </form>
  );
}

const BOOL_FIELDS = ["has_elevator", "has_parking", "pet_allowed", "cooking_allowed", "has_washer", "has_internet"] as const;
const BOOL_LABEL: Record<(typeof BOOL_FIELDS)[number], string> = {
  has_elevator: "電梯",
  has_parking: "停車",
  pet_allowed: "可養寵物",
  cooking_allowed: "可開伙",
  has_washer: "洗衣機",
  has_internet: "網路",
};

function Field({ label, error, children }: { label: string; error?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-neutral-600 dark:text-neutral-400">{label}</span>
      {children}
      {error}
    </label>
  );
}

/** 書籤帶來的欄位填進表單(不認得的欄位略過;布林值 → checkbox) */
function fillForm(form: HTMLFormElement, facts: ImportedFacts) {
  for (const [k, v] of Object.entries(facts)) {
    if (v == null || k === "city") continue;
    const el = form.elements.namedItem(k);
    if (el instanceof HTMLInputElement && el.type === "checkbox") el.checked = v === true;
    else if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
      // select 只接受清單裡有的值(例如行政區對不上就留預設)
      if (el instanceof HTMLSelectElement && ![...el.options].some((o) => o.value === String(v))) continue;
      el.value = String(v);
    }
  }
}

/**
 * 「拖到書籤列」:在 591 物件頁按一下,就用你自己的瀏覽器讀出事實欄位、開到這一頁。
 * React 不讓 JSX 直接寫 javascript: 網址,用 ref 設 href。只在桌機顯示(手機瀏覽器幾乎不能用書籤小工具)。
 */
function BookmarkletCard() {
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    ref.current?.setAttribute("href", bookmarkletHref(window.location.origin));
  }, []);
  return (
    <div className="hidden rounded border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-600 sm:block dark:border-neutral-700 dark:text-neutral-300">
      <b className="font-medium">從租屋網頁帶入:</b>把
      <a ref={ref} onClick={(e) => e.preventDefault()} className="mx-1 inline-block cursor-grab rounded bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white" title="拖到書籤列">
        存到落腳筆記
      </a>
      拖到瀏覽器的書籤列。之後在租屋網站的物件頁按那個書籤,會開新分頁到這裡並帶好租金、坪數、樓層、地址等欄位(由你的瀏覽器讀取,本站伺服器不會去抓那個網站;目前認得 591,其他網站只帶標題與網址)。
    </div>
  );
}
