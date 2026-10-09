/** GET /api/admin/stats(營運儀表板,只有站長) */
export interface AdminStats {
  at: string;
  users: {
    total: number;
    /** 新註冊:近 1 / 7 / 30 天 */
    new: [number, number, number];
    /** 活躍(最後登入在期間內):近 1 / 7 / 30 天 */
    active: [number, number, number];
    /** 方案有效中的付費帳號(不含站長) */
    pro: number;
  };
  /** 近 30 天每天 */
  series: { day: string; signups: number; logins: number; notes: number }[];
  content: { notes: number; note_users: number; buy: number; places: number; place_users: number; favorites: number };
  consents: { doc: string; version: string; n: number; current: boolean }[];
  grants: { created_at: string; email: string | null; offer: string; days: number; price: number; ref: string }[];
  recent: { id: number; name: string | null; email: string | null; created_at: string; last_login_at: string; plan: string; plan_until: string | null; notes: number; places: number }[];
  tables: { table: string; rows: number }[];
}
