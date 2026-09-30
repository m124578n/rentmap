/**
 * 內政部實價登錄「租賃」CSV({a|f}_lvr_land_c.csv,a = 臺北市、f = 新北市)→ RentStatIn。純函式,測試在 test/collector/rentstats.test.ts。
 *
 * 第 1 列中文欄名、第 2 列英文欄名、之後是資料。只收住宅:
 *   交易標的是「租賃房屋」(含「+車位」,標 has_parking)、建物型態是住宅大樓 / 華廈 / 公寓 / 透天厝、主要用途不是商業 / 辦公 / 工業;
 *   排除親友 / 員工等特殊關係、一筆含多個門牌、租金或面積不合理的。
 * 「租賃住宅服務」是社會住宅包租代管 / 代管的標 social(有租金上限,實測比一般案件低 20–50%,行情預設不算)。
 */
import type { RentStatIn } from "../../src/shared/market";

/** 簡單 CSV(支援雙引號欄位) */
/** 房 / 廳 / 衛偶爾有登錄錯誤的離譜值(>20):當成沒填,不要讓一筆髒資料擋掉整批匯入(Zod 上限 50) */
const sane = (n: number | null): number | null => (n != null && n > 20 ? null : n);

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      if (row.length > 1 || row[0]) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const FULL = "０１２３４５６７８９";
const halfDigits = (s: string) => s.replace(/[０-９]/g, (c) => String(FULL.indexOf(c)));

const CN: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
/** 「四」「十二」「二十三」→ 數字 */
export function cnNum(s: string): number | null {
  if (/^\d+$/.test(s)) return Number(s);
  const m = /^([一二三四五六七八九])?(十)?([一二三四五六七八九])?$/.exec(s);
  if (!m || !s) return null;
  if (!m[2]) return m[1] ? CN[m[1]]! : null;
  return (m[1] ? CN[m[1]]! : 1) * 10 + (m[3] ? CN[m[3]]! : 0);
}

/** 「四層」→ 4;「地下一層」→ -1;「全」「四層，五層」取第一個、看不懂 null */
export function parseFloor(s: string): number | null {
  const first = s.split(/[，,、]/)[0]!.trim();
  const m = /^(地下)?(.+?)層$/.exec(first);
  if (!m) return null;
  const n = cnNum(halfDigits(m[2]!));
  return n == null ? null : m[1] ? -n : n;
}

/** 民國 yyyMMdd → YYYY-MM-DD */
export function rocDate(s: string): string | null {
  const m = /^(\d{2,3})(\d{2})(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const y = Number(m[1]) + 1911;
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${m[2]}-${m[3]}`;
}

/** 門牌 → 路段(「復興北路」「忠孝東路四段」);抓不到 null */
export function roadOf(addr: string, district: string): string | null {
  const a = halfDigits(addr);
  const i = a.indexOf(district);
  const rest = i >= 0 ? a.slice(i + district.length) : a.replace(/^.*?[市縣]/, "").replace(/^.*?[區鄉鎮市]/, "");
  const m = /^(?:.{0,6}?里)?(?:\d+鄰)?(.+?(?:大道|路|街)(?:[一二三四五六七八九十]+段)?)/.exec(rest);
  return m ? m[1]!.slice(0, 40) : null;
}

const KIND: Record<string, string> = { "整棟(戶)出租": "整層住家", 分層出租: "整層住家", 獨立套房: "獨立套房", 分租套房: "分租套房", 分租雅房: "雅房" };
const RESIDENTIAL = /住宅大樓|華廈|公寓|透天/;
const NON_RESIDENTIAL_USE = /商業|事務所|辦公|工業|店舖|廠房/;
const SPECIAL = /親友|員工|特殊關係|關係人|含多個門牌/;
const yes = (v: string | undefined) => (v === "有" ? true : v === "無" ? false : null);
const int = (v: string | undefined) => (v != null && /^\d+$/.test(v.trim()) ? Number(v) : null);

export type SkipReason = "欄位數不符" | "非房屋" | "非住宅" | "特殊關係 / 多門牌" | "日期" | "租金或面積不合理" | "整棟多房";

export function transformRent(city: RentStatIn["city"], csv: string): { items: RentStatIn[]; skipped: Partial<Record<SkipReason, number>> } {
  const rows = parseCsv(csv);
  const head = rows[0] ?? [];
  const col = (name: string) => head.indexOf(name);
  const idx = {
    district: col("鄉鎮市區"),
    target: col("交易標的"),
    addr: col("土地位置建物門牌"),
    date: col("租賃年月日"),
    floor: col("租賃層次"),
    total: col("總樓層數"),
    btype: col("建物型態"),
    use: col("主要用途"),
    built: col("建築完成年月"),
    area: col("建物總面積平方公尺"),
    rooms: col("建物現況格局-房"),
    livings: col("建物現況格局-廳"),
    baths: col("建物現況格局-衛"),
    mgmt: col("有無管理組織"),
    furn: col("有無附傢俱"),
    rent: col("總額元"),
    note: col("備註"),
    serial: col("編號"),
    kind: col("出租型態"),
    elev: col("有無電梯"),
    service: col("租賃住宅服務"),
  };
  for (const [k, v] of Object.entries(idx)) if (v < 0) throw new Error(`實價登錄 CSV 少了欄位 ${k}(格式改了?)`);

  const items: RentStatIn[] = [];
  const skipped: Partial<Record<SkipReason, number>> = {};
  const skip = (r: SkipReason) => void (skipped[r] = (skipped[r] ?? 0) + 1);
  for (const r of rows.slice(2)) {
    if (r.length !== head.length) {
      skip("欄位數不符");
      continue;
    }
    const target = r[idx.target]!;
    if (!target.startsWith("租賃房屋")) {
      skip("非房屋");
      continue;
    }
    if (!RESIDENTIAL.test(r[idx.btype]!) || NON_RESIDENTIAL_USE.test(r[idx.use]!)) {
      skip("非住宅");
      continue;
    }
    if (SPECIAL.test(r[idx.note]!)) {
      skip("特殊關係 / 多門牌");
      continue;
    }
    const date = rocDate(r[idx.date]!);
    if (!date) {
      skip("日期");
      continue;
    }
    const rent = int(r[idx.rent]);
    const m2 = Number(r[idx.area]);
    const size = Number.isFinite(m2) && m2 > 0 ? Math.round(m2 * 0.3025 * 10) / 10 : null;
    if (!rent || rent < 1000 || rent > 1_000_000 || (size != null && size > 2000)) {
      skip("租金或面積不合理");
      continue;
    }
    const rooms = int(r[idx.rooms]);
    if (rooms != null && rooms > 20) {
      skip("整棟多房"); // 整棟宿舍 / 旅館式,不是一般住家
      continue;
    }
    const district = r[idx.district]!.trim();
    const built = rocDate(r[idx.built]!.padStart(7, "0"));
    const age = built ? Math.max(0, Number(date.slice(0, 4)) - Number(built.slice(0, 4))) : null;
    items.push({
      serial: r[idx.serial]!.trim(),
      city,
      district,
      road: roadOf(r[idx.addr]!, district),
      kind: KIND[r[idx.kind]!.trim()] ?? null,
      building_type: r[idx.btype]!.replace(/\(.*\)$/, "").slice(0, 30) || null,
      floor: parseFloor(r[idx.floor]!),
      total_floors: int(r[idx.total]),
      building_age: age != null && age <= 150 ? age : null,
      size_ping: size,
      rooms,
      livings: sane(int(r[idx.livings])),
      baths: sane(int(r[idx.baths])),
      rent,
      date,
      has_elevator: yes(r[idx.elev]),
      furnished: yes(r[idx.furn]),
      has_mgmt: yes(r[idx.mgmt]),
      has_parking: target.includes("車位"),
      social: r[idx.service]!.startsWith("社會住宅"),
    });
  }
  return { items, skipped };
}
