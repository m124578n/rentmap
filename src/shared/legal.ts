/**
 * 條款文件的版本與同意規則(docs/business/2026-09-30-subscription-and-legal.md「法律文件草稿」「同意流程」)。
 * 全文在 src/client/features/legal/docs.tsx;改了內容要把 version 加一、寫 changes,使用者下次登入會被要求再同意一次。
 * 〔〕是還沒填的地方(經營者、信箱);上線收費前請律師看過。
 */
export const LEGAL_DOCS = {
  terms: { title: "服務條款", version: "1.1", effective: "2026-10-01", changes: "服務內容加入買賣行情與房貸試算;不限租屋,買房或了解住家附近也適用" },
  privacy: { title: "隱私權政策", version: "1.0", effective: "2026-10-01", changes: "" },
  refund: { title: "付費與退款說明", version: "1.0", effective: "2026-10-01", changes: "" },
  sources: { title: "資料來源與免責聲明", version: "1.2", effective: "2026-10-01", changes: "資料來源加入內政部買賣實價登錄;估算說明加入房貸試算與買賣行情" },
} as const;
export type LegalDoc = keyof typeof LEGAL_DOCS;
export const LEGAL_DOC_KEYS = Object.keys(LEGAL_DOCS) as LegalDoc[];

/** 登入後一定要同意的(沒同意不能用);退款說明在付款前另外同意 */
export const REQUIRED_CONSENTS = ["terms", "privacy"] as const satisfies readonly LegalDoc[];

/** 經營者資料:還沒定,先留〔〕,頁面上會顯示「草稿」提示 */
export const OPERATOR = { name: "〔經營者姓名或行號〕", email: "〔聯絡信箱〕" };
export const LEGAL_IS_DRAFT = /〔/.test(OPERATOR.name + OPERATOR.email);

export interface ConsentNeed {
  doc: LegalDoc;
  version: string;
  /** 之前同意過舊版(這次是改版) */
  previous: string | null;
}

/** 目前還要同意哪些:沒同意過、或同意的不是最新版 */
export function consentsNeeded(accepted: { doc: string; version: string }[]): ConsentNeed[] {
  return REQUIRED_CONSENTS.flatMap((doc) => {
    const mine = accepted.filter((a) => a.doc === doc).map((a) => a.version);
    const current = LEGAL_DOCS[doc].version;
    if (mine.includes(current)) return [];
    return [{ doc, version: current, previous: mine.at(-1) ?? null }];
  });
}
