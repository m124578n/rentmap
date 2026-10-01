import { describe, expect, it } from "vitest";
import { districtStats, parseNpaCrime, parseNtpcCrime, parseTaipeiTheft, rocDate } from "../../collector/crime/transform";

const TP = `編號,案類,發生日期,發生時段,發生地點
1,住宅竊盜,1150729,17~19,臺北市士林區延平北路五段151~180號
2,住宅竊盜,1150829,11~13,臺北市大安區臥龍街188巷1~30號
3,住宅竊盜,1040101,00~02,臺北市信義區富台里忠孝東路5段295巷6弄1~30號
4,住宅竊盜,,00~02,臺北市信義區忠孝東路5段1號
5,住宅竊盜,1150101,00~02,新北市板橋區文化路1段1號`;

describe("crime open data", () => {
  it("ROC dates", () => {
    expect(rocDate("1150729")).toBe("2026-07-29");
    expect(rocDate("990101")).toBe("2010-01-01");
    expect(rocDate("1151301")).toBeNull();
    expect(rocDate("")).toBeNull();
  });

  it("Taipei rows → lane, then road section; village name dropped; bad rows skipped", () => {
    const rows = parseTaipeiTheft(TP, "house");
    expect(rows.map((r) => r.id)).toEqual(["1", "2", "3"]);
    expect(rows[0]).toMatchObject({ date: "2026-07-29", slot: "17~19", district: "士林區", queries: ["延平北路五段"] });
    expect(rows[1]!.queries).toEqual(["臥龍街188巷", "臥龍街"]);
    expect(rows[2]).toMatchObject({ district: "信義區", queries: ["忠孝東路5段295巷", "忠孝東路5段"] });
  });

  it("New Taipei rows: district when written, kinds mapped", () => {
    const rows = parseNtpcCrime("﻿type,year,date,location\n住宅竊盜,115,1150401,新北市淡水區\n機車竊盜,115,1150401,新北市\n竊盜,115,1150401,新北市板橋區\n");
    expect(rows).toEqual([
      { kind: "house", date: "2026-04-01", district: "淡水區" },
      { kind: "moto", date: "2026-04-01", district: null },
      { kind: "other", date: "2026-04-01", district: "板橋區" },
    ]);
  });

  it("district stats over the last year", () => {
    const tp = [
      { kind: "house" as const, date: "2026-08-29", district: "大安區" },
      { kind: "house" as const, date: "2025-09-01", district: "大安區" },
      { kind: "moto" as const, date: "2025-08-01", district: "大安區" }, // 超過一年
    ];
    const nt = parseNtpcCrime("type,year,date,location\n住宅竊盜,115,1150401,新北市淡水區\n機車竊盜,115,1150401,新北市\n住宅竊盜,113,1130401,新北市淡水區\n");
    const s = districtStats(tp, nt);
    expect(s.to).toBe("2026-08-29");
    expect(s.items).toEqual({ "台北市|大安區": { house: 2 }, "新北市|淡水區": { house: 1 } });
    expect(s.ntpc_unknown).toBe(1);
    expect(s.periods).toBeUndefined();
  });

  it("警政署全國資料:雙北以外的縣市各區件數,期間分開記", () => {
    const npa = parseNpaCrime(
      [
        // 真實檔案的樣子:第二列是中文表頭、日期只有月日、年度另一欄
        "\uFEFFtype,oc_year,oc_data,oc_county,oc_region",
        "案類,發生年度,發生日期,發生縣市,發生鄉鎮市區",
        "住宅竊盜,115,0630,臺中市,西屯區",
        "機車竊盜,115,1150401,臺中市,臺中市西屯區", // 7 碼完整日期也收
        "住宅竊盜,114,0701,高雄市,鳳山區",
        "住宅竊盜,114,0630,高雄市,鳳山區", // 超過一年
        "毒品,115,0401,臺中市,西屯區", // 不是竊盜
        "住宅竊盜,115,0401,臺中市,不存在區",
        "住宅竊盜,115,0401,臺北市,大安區", // 雙北用各自的來源
        "住宅竊盜,115,0401,花蓮縣,花蓮市", // regions.ts 沒列
      ].join("\n"),
    );
    expect(npa).toHaveLength(7);
    expect(npa[1]).toEqual({ kind: "moto", date: "2026-04-01", city: "台中市", district: "西屯區" });
    expect(npa[5]!.district).toBeNull();
    const s = districtStats([{ kind: "house", date: "2026-08-29", district: "大安區" }], [], npa);
    expect(s.items).toEqual({ "台北市|大安區": { house: 1 }, "台中市|西屯區": { house: 1, moto: 1 }, "高雄市|鳳山區": { house: 1 } });
    expect(s.periods).toEqual({ 台中市: { from: "2025-06-30", to: "2026-06-30" }, 高雄市: { from: "2025-06-30", to: "2026-06-30" } });
    expect(s.to).toBe("2026-08-29");
  });
});
