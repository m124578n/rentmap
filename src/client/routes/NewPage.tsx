import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ApiError, api } from "@/lib/api";
import { PropertyInput } from "@shared/schemas";
import { BUILDING_TYPES, CITIES, DISTRICTS, KINDS, SOURCES, SOURCE_LABEL, type City } from "@shared/constants";

/** 手動新增房源。表單值全部是字串 / checkbox,交給 Zod schema 轉型與驗證。 */
export function NewPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [city, setCity] = useState<City>("台北市");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const create = useMutation({
    mutationFn: api.createProperty,
    onSuccess: ({ id }) => {
      qc.invalidateQueries({ queryKey: ["properties"] });
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
    <form onSubmit={onSubmit} className="mx-auto grid max-w-2xl gap-4 p-4">
      <h1 className="text-xl font-semibold">新增房源</h1>

      <section className="card grid gap-3">
        <Field label="標題" error={err("title")}>
          <input name="title" className="input" placeholder="例:大安區近捷運兩房" required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="縣市">
            <select name="city" className="input" value={city} onChange={(e) => setCity(e.target.value as City)}>
              {CITIES.map((c) => (
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
          <Field label="租金 / 月" error={err("rent")}>
            <input name="rent" type="number" min={1} className="input" required />
          </Field>
          <Field label="管理費 / 月">
            <input name="mgmt_fee" type="number" min={0} className="input" />
          </Field>
          <Field label="押金(月)">
            <input name="deposit_months" type="number" min={0} step="0.5" className="input" />
          </Field>
          <Field label="坪數">
            <input name="size_ping" type="number" min={0} step="0.1" className="input" />
          </Field>
          <Field label="房">
            <input name="rooms" type="number" min={0} className="input" />
          </Field>
          <Field label="廳">
            <input name="living_rooms" type="number" min={0} className="input" />
          </Field>
          <Field label="衛">
            <input name="bathrooms" type="number" min={0} className="input" />
          </Field>
          <Field label="樓層">
            <input name="floor" type="number" min={0} className="input" />
          </Field>
          <Field label="總樓層">
            <input name="total_floors" type="number" min={0} className="input" />
          </Field>
          <Field label="屋齡(年)">
            <input name="building_age" type="number" min={0} className="input" />
          </Field>
          <Field label="房型">
            <select name="kind" className="input" defaultValue="">
              <option value="">—</option>
              {KINDS.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
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
      </section>

      <section className="card grid gap-3">
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
          <Field label="聯絡人">
            <input name="contact_name" className="input" />
          </Field>
          <Field label="電話">
            <input name="contact_phone" className="input" />
          </Field>
          <Field label="LINE">
            <input name="contact_line" className="input" />
          </Field>
        </div>
        <Field label="備註">
          <textarea name="note" className="input" rows={3} />
        </Field>
      </section>

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
