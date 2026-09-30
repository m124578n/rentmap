import { Link } from "@tanstack/react-router";
import { LEGAL_DOC_KEYS, LEGAL_DOCS, OPERATOR } from "@shared/legal";

/** 頁尾常駐連結(介紹頁、更多選單) */
export function LegalLinks({ className = "" }: { className?: string }) {
  return (
    <nav className={`flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-500 ${className}`}>
      {LEGAL_DOC_KEYS.map((k) => (
        <Link key={k} to="/legal/$doc" params={{ doc: k }} className="underline">
          {LEGAL_DOCS[k].title}
        </Link>
      ))}
      <a href={OPERATOR.email.includes("@") ? `mailto:${OPERATOR.email}` : undefined} className="underline">
        聯絡我們
      </a>
    </nav>
  );
}
