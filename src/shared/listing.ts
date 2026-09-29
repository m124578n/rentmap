/**
 * 刊登天數與價格變動(前後端 + 測試共用)。
 *
 * 刊登日:591 物件頁寫「此房屋在7月28日發佈」(沒有年份),ingest 時換算成 YYYY-MM-DD 存 listings.posted_at;
 * 好房只有「更新日期」,不當刊登日。沒有刊登日的就用「我們第一次看到」(first_seen_at),介面寫「收錄」而不是「刊登」。
 */

const TZ_MS = 8 * 3600_000; // 台灣時間

/** Date → 台灣日期 YYYY-MM-DD */
export function twDate(d: Date): string {
  return new Date(d.getTime() + TZ_MS).toISOString().slice(0, 10);
}

/** 來源的發佈時間文字 → YYYY-MM-DD(台灣日期);看不懂就 null */
export function parsePostedAt(text: string | null | undefined, now: Date): string | null {
  if (!text) return null;
  const s = text.replace(/\s+/g, "");
  const today = twDate(now);
  const pad = (n: number) => String(n).padStart(2, "0");
  let m = /(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;
  m = /(\d{1,2})月(\d{1,2})日/.exec(s);
  if (m) {
    // 沒寫年份:先當今年,比今天還晚就是去年
    let year = Number(today.slice(0, 4));
    const md = `${pad(Number(m[1]))}-${pad(Number(m[2]))}`;
    if (`${year}-${md}` > today) year--;
    return `${year}-${md}`;
  }
  m = /(\d+)天前/.exec(s);
  if (m) return twDate(new Date(now.getTime() - Number(m[1]) * 86400_000));
  if (/(小時|分鐘|秒)前|今天|剛剛/.test(s)) return today;
  if (/昨天/.test(s)) return twDate(new Date(now.getTime() - 86400_000));
  return null;
}

/** 兩個日期(YYYY-MM-DD 或 ISO)之間的天數,以台灣日期算 */
export function daysBetween(from: string, to: Date): number {
  const a = Date.parse(from.length === 10 ? `${from}T00:00:00+08:00` : from);
  const b = Date.parse(`${twDate(to)}T00:00:00+08:00`);
  return Math.max(0, Math.floor((b - Date.parse(`${twDate(new Date(a))}T00:00:00+08:00`)) / 86400_000));
}

export interface PricePoint {
  rent: number;
  /** ISO 時間 */
  at: string;
}

export interface PriceSummary {
  current: number;
  first: number;
  /** 上一個不同的價格(沒變過 = null) */
  prev: number | null;
  /** 最後一次變價的時間 */
  changedAt: string | null;
  /** 最後一次變動:current − prev */
  lastDelta: number;
  /** 從第一次看到到現在:current − first */
  totalDelta: number;
  changes: number;
}

/** 價格紀錄(依時間)→ 摘要;連續相同的價格合併 */
export function summarizePrice(history: PricePoint[]): PriceSummary | null {
  const pts = [...history].sort((a, b) => a.at.localeCompare(b.at)).filter((p, i, arr) => i === 0 || p.rent !== arr[i - 1]!.rent);
  if (!pts.length) return null;
  const cur = pts[pts.length - 1]!;
  const prev = pts.length > 1 ? pts[pts.length - 2]! : null;
  return {
    current: cur.rent,
    first: pts[0]!.rent,
    prev: prev?.rent ?? null,
    changedAt: prev ? cur.at : null,
    lastDelta: prev ? cur.rent - prev.rent : 0,
    totalDelta: cur.rent - pts[0]!.rent,
    changes: pts.length - 1,
  };
}

/** 價格紀錄去掉連續重複,給時間軸用 */
export function priceSteps(history: PricePoint[]): PricePoint[] {
  return [...history].sort((a, b) => a.at.localeCompare(b.at)).filter((p, i, arr) => i === 0 || p.rent !== arr[i - 1]!.rent);
}

export const NEW_LISTING_DAYS = 7;
