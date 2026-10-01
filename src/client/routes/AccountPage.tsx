import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import { LegalLinks } from "@/features/legal/LegalLinks";
import { usePlan } from "@/lib/plan";
import { ENTITLEMENTS, OFFERS, PLAN_LABEL, type PlanKey } from "@shared/plan";

/** 各方案多了什麼(從 shared/plan.ts 的權限表產生,不另外寫一份) */
function features(k: PlanKey): string[] {
  const e = ENTITLEMENTS[k];
  return [
    e.notes == null ? "筆記不限間數" : `筆記最多 ${e.notes} 間`,
    `我的地點 ${e.places} 個`,
    `比較表 ${e.compare} 間`,
    e.commuteCustom ? "通勤:上下班分開、自訂時段、含 YouBike" : "通勤:平日 08:00 上班",
    ...(e.tour ? ["看房路線"] : []),
    ...(e.fit ? ["需求與符合度"] : []),
    ...(e.costDetail ? ["每月支出明細"] : ["每月支出總額"]),
    ...(e.rentDetail ? ["租金成交明細(最像的幾筆)"] : []),
    ...(e.saleDetail ? ["買賣成交明細(附近 / 最像的幾筆)"] : []),
  ];
}

function PlanSection() {
  const p = usePlan();
  return (
    <section id="plan" className="card grid scroll-mt-4 gap-2">
      <h2 className="font-medium">方案</h2>
      {!p.enforced ? (
        <p className="text-xs text-neutral-500">私人模式(本機):所有功能都開著,不限制。</p>
      ) : (
        <p>
          目前:<b>{PLAN_LABEL[p.plan]}</b>
          {p.until && <span className="ml-1 text-xs text-neutral-500">到 {new Date(p.until).toLocaleDateString("zh-TW")}(到期自動回免費版,不會扣款)</span>}
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-3">
        {(["free", "rent", "buy"] as PlanKey[]).map((k) => {
          const offers = OFFERS.filter((o) => o.plan === k);
          return (
            <div key={k} className={`rounded border p-2 text-xs ${p.enforced && p.plan === k ? "border-emerald-600" : "border-neutral-200 dark:border-neutral-700"}`}>
              <p className="font-medium">{PLAN_LABEL[k]}</p>
              <p className="mb-1 text-neutral-500">{offers.length ? offers.map((o) => `${o.days} 天 $${o.price}`).join(" / ") : "免費"}</p>
              <ul className="grid gap-0.5 text-neutral-600 dark:text-neutral-400">
                {features(k).map((f) => (
                  <li key={f}>· {f}</li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-neutral-500">一次付清、不自動續約;付款後 7 天內可全額退款。線上付款準備中。</p>
    </section>
  );
}

/** 帳號:匯出自己的資料、刪除帳號(隱私權政策的「閱覽、複製、刪除」) */
export function AccountPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setErr(null);
    try {
      await api.deleteAccount();
      navigator.serviceWorker?.controller?.postMessage({ type: "logout" });
      qc.clear();
      window.location.href = "/";
    } catch {
      setErr("刪除失敗,再試一次");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-xl gap-4 p-4 text-sm">
      <h1 className="text-xl font-semibold">帳號</h1>
      <p className="text-neutral-600 dark:text-neutral-300">{user?.name ?? ""}</p>

      <PlanSection />

      <section className="card grid gap-2">
        <h2 className="font-medium">匯出我的資料</h2>
        <p className="text-xs text-neutral-500">你建的房源與刊登、收藏與備註、我的地點、找房需求、條款同意紀錄,存成一個 JSON 檔。</p>
        <a href="/api/account/export" className="btn-ghost w-fit" download>
          <Download size={14} /> 下載
        </a>
      </section>

      <section className="card grid gap-2 border-red-200 dark:border-red-900">
        <h2 className="font-medium text-red-700 dark:text-red-400">刪除帳號</h2>
        <p className="text-xs text-neutral-500">會刪掉你建的房源、收藏、地點、需求與同意紀錄,無法復原。要保留的話先匯出。</p>
        <label className="grid gap-1 text-xs">
          輸入「刪除」確認
          <input value={typed} onChange={(e) => setTyped(e.target.value)} className="input w-40" />
        </label>
        {err && <p className="text-xs text-red-600">{err}</p>}
        <button onClick={remove} disabled={typed !== "刪除" || busy} className="btn-ghost w-fit border-red-300 text-red-700 disabled:opacity-50 dark:text-red-400">
          <Trash2 size={14} /> {busy ? "刪除中…" : "刪除帳號"}
        </button>
      </section>

      <LegalLinks />
    </div>
  );
}
