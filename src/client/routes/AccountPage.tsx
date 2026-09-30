import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import { LegalLinks } from "@/features/legal/LegalLinks";

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
