import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { LEGAL_DOCS, type ConsentNeed } from "@shared/legal";
import { ApiError, api } from "@/lib/api";

/**
 * 同意流程(法律文件「五、同意流程」):第一次登入、或條款改版後,先同意才能用。
 * 勾選框不預設勾選;全文在新分頁開(/legal/…),同意紀錄存伺服器(版本、時間、IP)。
 */
export function ConsentGate({ needed, onLogout }: { needed: ConsentNeed[]; onLogout: () => void }) {
  const qc = useQueryClient();
  const [checked, setChecked] = useState(false);
  const revised = needed.some((n) => n.previous);
  const agree = useMutation({
    mutationFn: () => api.consent(needed.map((n) => ({ doc: n.doc, version: n.version }))),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
    onError: (e) => {
      // 條款在這段時間改版了:重抓一次再同意
      if (e instanceof ApiError && e.status === 409) qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
  return (
    <div className="mx-auto grid max-w-lg gap-3 p-6 text-sm">
      <h1 className="text-lg font-semibold">{revised ? "條款已更新" : "開始使用前"}</h1>
      <p className="text-neutral-600 dark:text-neutral-300">{revised ? "以下文件有新版本,請看過後再同意一次:" : "請先閱讀以下文件:"}</p>
      <ul className="grid gap-1.5">
        {needed.map((n) => (
          <li key={n.doc} className="flex flex-wrap items-baseline gap-x-2">
            <Link to="/legal/$doc" params={{ doc: n.doc }} target="_blank" className="text-emerald-700 underline dark:text-emerald-400">
              {LEGAL_DOCS[n.doc].title}
            </Link>
            <span className="text-xs text-neutral-500">
              版本 {n.version}
              {n.previous ? `(你之前同意的是 ${n.previous})` : ""}
            </span>
            {n.previous && LEGAL_DOCS[n.doc].changes && <span className="w-full text-xs text-neutral-500">變更:{LEGAL_DOCS[n.doc].changes}</span>}
          </li>
        ))}
      </ul>
      <label className="flex items-start gap-2">
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-1" />
        <span>我已閱讀並同意{needed.map((n) => `「${LEGAL_DOCS[n.doc].title}」`).join("與")}</span>
      </label>
      {agree.isError && <p className="text-xs text-red-600">{agree.error instanceof ApiError && agree.error.status === 409 ? "條款剛更新,請再看一次" : "送出失敗,再試一次"}</p>}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={!checked || agree.isPending} onClick={() => agree.mutate()}>
          {agree.isPending ? "送出中…" : "同意並開始"}
        </button>
        <button className="btn-ghost" onClick={onLogout}>
          不同意,登出
        </button>
      </div>
    </div>
  );
}
