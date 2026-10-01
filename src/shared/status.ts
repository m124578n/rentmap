/** GET /api/status:各份資料有多少、最後什麼時候更新、要不要重跑(資料狀態頁) */
export interface StatusItem {
  key: string;
  group: "房源" | "交通" | "生活機能" | "行情" | "災害" | "治安";
  label: string;
  count: number;
  /** 最後更新(ISO 時間或 YYYY-MM-DD);null = 還沒匯入 */
  updated: string | null;
  /** 距今幾天 */
  age_days: number | null;
  /** 建議多久更新一次 */
  every: string;
  /** 超過建議間隔(或還沒匯入):要重跑 */
  stale: boolean;
  /** 在家要跑的指令 */
  command: string;
  note?: string;
}
export interface StatusResponse {
  now: string;
  /** 這份統計是哪個生活圈的 */
  region: import("./regions").RegionKey;
  items: StatusItem[];
}
