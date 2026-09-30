import { Link, useParams } from "@tanstack/react-router";
import { LEGAL_DOC_KEYS, LEGAL_DOCS, LEGAL_IS_DRAFT, OPERATOR, type LegalDoc } from "@shared/legal";
import { LEGAL_BODY, legalTitle } from "@/features/legal/docs";

/** /legal/terms|privacy|refund|sources:沒登入也看得到(Layout 放行 /legal/) */
export function LegalPage() {
  const { doc } = useParams({ from: "/legal/$doc" });
  const d = (LEGAL_DOC_KEYS as string[]).includes(doc) ? (doc as LegalDoc) : "terms";
  return (
    <article className="legal mx-auto grid max-w-3xl gap-3 p-4 text-sm leading-relaxed">
      <nav className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {LEGAL_DOC_KEYS.map((k) => (
          <Link key={k} to="/legal/$doc" params={{ doc: k }} className={k === d ? "font-semibold text-emerald-700 dark:text-emerald-400" : "text-neutral-500 underline"}>
            {LEGAL_DOCS[k].title}
          </Link>
        ))}
      </nav>
      <h1 className="text-xl font-semibold">{legalTitle(d)}</h1>
      {LEGAL_IS_DRAFT && (
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          草稿:〔〕是還沒填的經營者資料;正式收費前會請律師審閱後更新版本。
        </p>
      )}
      {LEGAL_DOCS[d].changes && <p className="text-xs text-neutral-500">這一版的變更:{LEGAL_DOCS[d].changes}</p>}
      <div className="grid gap-2 [&_li]:mb-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_table]:w-full [&_td]:border-t [&_td]:border-neutral-200 [&_td]:py-1.5 [&_th]:w-28 [&_th]:border-t [&_th]:border-neutral-200 [&_th]:py-1.5 [&_th]:pr-2 [&_th]:text-left [&_th]:align-top [&_th]:font-medium [&_ul]:list-disc [&_ul]:pl-5 dark:[&_td]:border-neutral-800 dark:[&_th]:border-neutral-800">
        {LEGAL_BODY[d]}
      </div>
      <p className="text-xs text-neutral-500">聯絡:{OPERATOR.email}</p>
    </article>
  );
}
