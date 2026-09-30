/**
 * 每月實際支出(估):房租 + 管理費 + 電費 + 水費 + 網路 + 通勤交通費。純函式,前端算。
 *
 * 電費:591 的「電:」有三種寫法
 *   臺電繳費 / 台電計價 → 用台電住宅累進費率(夏月 6–9 月、非夏月加權平均)算
 *   每度 N 元(房東自訂)→ 度數 × N
 *   含在租金 → 0
 *   沒寫 → 當台電計價,標「估」
 * 度數:沒自己設就依房型估(套房 / 雅房 120 度,整層 150 + 每坪 6 度,最多 400)。
 * 水費:有寫每月金額就用;台水 / 沒寫估 100;含在租金 0。
 * 網路:房源有附網路 0;否則估 500。
 * 通勤:通勤地點(預設第一個「我的地點」)上班 + 下班的最快搭法,每趟票價依搭法估(公車 15、捷運 25、YouBike 5、
 *   公車捷運轉乘 −8),× 每週天數 × 52 ÷ 12;有搭大眾運輸就以 TPASS 1200 元封頂(雙北 + 基隆桃園,含 YouBike 前 30 分)。
 */
import type { TripBrief, TripKind } from "./trip";

export const TPASS = 1200;
export const INTERNET_EST = 500;
export const WATER_EST = 100;

/** 台電住宅非時間電價(元 / 度),[上限度數, 夏月, 非夏月];夏月 4 個月 */
const TAIPOWER: [number, number, number][] = [
  [120, 1.78, 1.78],
  [330, 2.55, 2.26],
  [500, 3.8, 3.13],
  [700, 5.14, 4.24],
  [1000, 6.44, 5.29],
  [Infinity, 8.86, 7.03],
];

/** 一個月用 kwh 度的台電電費(夏月 / 非夏月加權) */
export function taipowerBill(kwh: number) {
  let prev = 0;
  let summer = 0;
  let other = 0;
  for (const [top, s, o] of TAIPOWER) {
    const n = Math.max(0, Math.min(kwh, top) - prev);
    summer += n * s;
    other += n * o;
    prev = top;
    if (kwh <= top) break;
  }
  return Math.round((summer * 4 + other * 8) / 12);
}

/** 依房型估每月度數 */
export function defaultKwh(kind: string | null | undefined, sizePing: number | null) {
  if (kind === "整層住家") return Math.min(400, Math.round(150 + (sizePing ?? 20) * 6));
  return 120;
}

export type Electricity = { mode: "taipower" } | { mode: "rate"; rate: number } | { mode: "included" } | { mode: "unknown" };
export type Water = { mode: "fixed"; amount: number } | { mode: "taipower" } | { mode: "included" } | { mode: "unknown" };

/** 591「水:臺水繳費 電:每度5元」這種備註拆出水電的計價方式 */
export function parseUtilities(note: string | null | undefined): { electricity: Electricity; water: Water } {
  const s = (note ?? "").replace(/\s+/g, "");
  // 依「水:」「電:」標籤切段(內容本身也可能有水、電字:臺水繳費、臺電繳費)
  const parts = new Map<string, string>();
  for (const m of s.matchAll(/(水|電)[::](.*?)(?=(?:水|電)[::]|$)/g)) parts.set(m[1]!, m[2]!);
  const seg = (k: "水" | "電") => parts.get(k) ?? "";
  const e = seg("電");
  const w = seg("水");
  const rate = e.match(/每度(\d+(?:\.\d+)?)/) ?? e.match(/(\d+(?:\.\d+)?)元\/?度/);
  const electricity: Electricity = /含|包/.test(e)
    ? { mode: "included" }
    : rate
      ? { mode: "rate", rate: Number(rate[1]) }
      : /[臺台]電/.test(e)
        ? { mode: "taipower" }
        : { mode: "unknown" };
  const amt = w.match(/(\d+)元/);
  const water: Water = /含|包/.test(w) ? { mode: "included" } : amt ? { mode: "fixed", amount: Number(amt[1]) } : /[臺台]水|自來水/.test(w) ? { mode: "taipower" } : { mode: "unknown" };
  return { electricity, water };
}

/** 單趟票價(估) */
export const TRIP_FARE: Record<TripKind, number> = {
  walk: 0,
  bus: 15,
  mrt: 25,
  "bus+bus": 30,
  "bus+mrt": 32,
  "mrt+bus": 32,
  bike: 5,
  "bike+mrt": 30,
  "mrt+bike": 30,
};

export interface CostInput {
  rent: number | null;
  kind?: string | null;
  size_ping: number | null;
  mgmt_fee: number | null;
  utilities_note?: string | null;
  has_internet?: boolean | null;
}
export interface CostOpts {
  /** 每月用電度數;null = 依房型估 */
  kwh?: number | null;
  /** 通勤地點的上班、下班最快搭法;undefined = 沒設地點或還在算,null = 搭不到 */
  commute?: { go: TripBrief | null | undefined; back: TripBrief | null | undefined; place: string };
  /** 每週通勤幾天 */
  days?: number;
}
export interface CostLine {
  key: "rent" | "mgmt" | "electricity" | "water" | "internet" | "commute";
  label: string;
  amount: number;
  note: string;
  /** 估計值(不是房源寫的) */
  estimated: boolean;
}
export interface MonthlyCost {
  total: number;
  lines: CostLine[];
}

export function monthlyCost(p: CostInput, o: CostOpts = {}): MonthlyCost | null {
  if (p.rent == null) return null;
  const lines: CostLine[] = [{ key: "rent", label: "房租", amount: p.rent, note: "", estimated: false }];
  lines.push(
    p.mgmt_fee != null
      ? { key: "mgmt", label: "管理費", amount: p.mgmt_fee, note: p.mgmt_fee ? "" : "無", estimated: false }
      : { key: "mgmt", label: "管理費", amount: 0, note: "沒寫(可能含在租金或另計)", estimated: true },
  );

  const u = parseUtilities(p.utilities_note);
  const kwh = o.kwh ?? defaultKwh(p.kind, p.size_ping);
  const e = u.electricity;
  lines.push(
    e.mode === "included"
      ? { key: "electricity", label: "電費", amount: 0, note: "含在租金", estimated: false }
      : e.mode === "rate"
        ? { key: "electricity", label: "電費", amount: Math.round(kwh * e.rate), note: `每度 ${e.rate} 元 × ${kwh} 度`, estimated: o.kwh == null }
        : {
            key: "electricity",
            label: "電費",
            amount: taipowerBill(kwh),
            note: `${e.mode === "taipower" ? "台電計價" : "沒寫,當台電計價"} · ${kwh} 度`,
            estimated: true,
          },
  );
  const w = u.water;
  lines.push(
    w.mode === "included"
      ? { key: "water", label: "水費", amount: 0, note: "含在租金", estimated: false }
      : w.mode === "fixed"
        ? { key: "water", label: "水費", amount: w.amount, note: "", estimated: false }
        : { key: "water", label: "水費", amount: WATER_EST, note: w.mode === "taipower" ? "台水計價" : "沒寫", estimated: true },
  );
  lines.push(
    p.has_internet
      ? { key: "internet", label: "網路", amount: 0, note: "有附", estimated: false }
      : { key: "internet", label: "網路", amount: INTERNET_EST, note: "沒附,自己拉", estimated: true },
  );

  const c = o.commute;
  if (c && c.go !== undefined && c.back !== undefined) {
    const days = o.days ?? 5;
    if (!c.go || !c.back) lines.push({ key: "commute", label: "通勤", amount: 0, note: `到${c.place}搭不到(1 次轉乘內),沒算`, estimated: true });
    else {
      const perDay = TRIP_FARE[c.go.kind] + TRIP_FARE[c.back.kind];
      const raw = Math.round((perDay * days * 52) / 12);
      const transit = perDay > 0;
      const amount = transit ? Math.min(TPASS, raw) : 0;
      lines.push({
        key: "commute",
        label: "通勤",
        amount,
        note: !transit ? `到${c.place}走路就到` : `到${c.place}每天約 ${perDay} 元 × 每週 ${days} 天${raw > TPASS ? `,TPASS ${TPASS} 封頂` : ""}`,
        estimated: true,
      });
    }
  }
  return { total: lines.reduce((s, l) => s + l.amount, 0), lines };
}
