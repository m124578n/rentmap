import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { RentStatIn, computeMarket, quantile, type RentStat } from "../../src/shared/market";
import { cnNum, parseFloor, roadOf, rocDate, transformRent } from "../../collector/rentstats/transform";
import { readZipEntry, recentSeasons } from "../../collector/rentstats/index";

const csv = fs.readFileSync(path.join(import.meta.dirname, "..", "fixtures", "lvr-rent-mini.csv"), "utf8");

describe("實價登錄租賃 CSV", () => {
  const { items, skipped } = transformRent("台北市", csv);

  it("只收住宅、排除特殊關係與非房屋,標社宅與車位", () => {
    expect(items.map((x) => x.serial)).toEqual(["SER-OK-1", "SER-PARK", "SER-SOCIAL"]);
    expect(skipped).toEqual({ 非住宅: 1, "特殊關係 / 多門牌": 1, 非房屋: 1 });
    for (const x of items) expect(RentStatIn.safeParse(x).success).toBe(true);
  });

  it("欄位轉換", () => {
    const [ok, park, social] = items as [RentStatIn, RentStatIn, RentStatIn];
    expect(ok).toMatchObject({
      city: "台北市",
      district: "大安區",
      road: "忠孝東路四段",
      kind: "整層住家",
      building_type: "華廈",
      floor: 5,
      total_floors: 7,
      building_age: 30, // 民國 85 年完工、115 年租
      size_ping: 30,
      rooms: 2,
      rent: 42000,
      date: "2026-03-01",
      has_elevator: true,
      has_parking: false,
      social: false,
    });
    expect(park).toMatchObject({ has_parking: true, floor: 12, road: "復興南路一段" });
    expect(social).toMatchObject({ social: true, kind: "獨立套房", floor: -1, has_elevator: false });
  });

  it("小工具", () => {
    expect([cnNum("四"), cnNum("十"), cnNum("十二"), cnNum("二十三"), cnNum("x")]).toEqual([4, 10, 12, 23, null]);
    expect([parseFloor("四層"), parseFloor("地下一層"), parseFloor("全"), parseFloor("三層，四層")]).toEqual([4, -1, null, 3]);
    expect([rocDate("1150211"), rocDate("0920610"), rocDate("abc")]).toEqual(["2026-02-11", "2003-06-10", null]);
    expect(roadOf("臺北市中山區復興北路３８０巷１１號４樓", "中山區")).toBe("復興北路");
    expect(roadOf("新北市板橋區文化路一段１號", "板橋區")).toBe("文化路一段");
    expect(recentSeasons(new Date("2026-09-29"), 4)).toEqual(["115S3", "115S2", "115S1", "114S4"]);
  });

  it("readZipEntry 讀 deflate 的檔", () => {
    const name = "a_lvr_land_c.csv";
    const data = Buffer.from("鄉鎮市區,x\n大安區,1\n");
    const comp = zlib.deflateRawSync(data);
    const nameB = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameB.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameB.length, 28);
    central.writeUInt32LE(0, 42);
    const cdOffset = local.length + nameB.length + comp.length;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(central.length + nameB.length, 12);
    eocd.writeUInt32LE(cdOffset, 16);
    const zip = Buffer.concat([local, nameB, comp, central, nameB, eocd]);
    expect(readZipEntry(zip, name)!.toString("utf8")).toBe(data.toString("utf8"));
    expect(readZipEntry(zip, "nope.csv")).toBeNull();
  });
});

describe("computeMarket", () => {
  const row = (rent: number, size: number, rooms = 2, extra: Partial<RentStat> = {}): RentStat => ({
    district: "大安區",
    road: null,
    kind: "整層住家",
    building_type: "華廈",
    floor: 3,
    total_floors: 7,
    building_age: 30,
    size_ping: size,
    rooms,
    rent,
    date: "2026-03-01",
    has_elevator: true,
    ...extra,
  });
  const target = { kind: "整層住家", size_ping: 30, rooms: 2, building_age: 28, has_elevator: true, rent: 36000 };

  it("最嚴的條件夠 5 筆就用;diff 以中位數算", () => {
    const pool = [row(30000, 28), row(32000, 30), row(34000, 31), row(36000, 33), row(40000, 35), row(90000, 80, 4)];
    const m = computeMarket(target, pool)!;
    expect(m).toMatchObject({ level: 0, count: 5, enough: true, median: 34000, p25: 32000, p75: 36000, diff_pct: 6 });
    expect(m.criteria).toEqual(["坪數 ±30%", "2 房", "屋齡 ±10 年", "有電梯"]);
    expect(m.per_ping_median).toBe(1091); // 每坪中位數:28、30、31、33、35 坪各自的每坪租金取中位
    expect(m.comparables[0]!.size_ping).toBe(30);
  });

  it("樣本不足就放寬;全部都不夠時標 enough=false", () => {
    const pool = [row(30000, 29, 2, { has_elevator: false }), row(31000, 30, 2, { building_age: 50 }), row(32000, 31, 3), row(33000, 44, 3), row(35000, 45, 1)];
    const m = computeMarket(target, pool)!;
    expect(m.level).toBe(2); // 坪數 ±50% 才有 5 筆
    expect(m.count).toBe(5);
    const few = computeMarket(target, pool.slice(0, 2))!;
    expect(few).toMatchObject({ level: 4, scope: "district", count: 2, enough: false });
    expect(computeMarket(target, [])).toBeNull();
  });

  it("分租套房不看坪數;沒租金就沒有 diff", () => {
    const pool = [8000, 9000, 10000, 11000, 12000].map((r) => row(r, 40, 1, { kind: "分租套房" }));
    const m = computeMarket({ kind: "分租套房", size_ping: 6, rooms: 1, building_age: null, has_elevator: null, rent: null }, pool)!;
    expect(m).toMatchObject({ level: 0, count: 5, median: 10000, diff_pct: null, per_ping_median: null, criteria: [] });
  });

  it("同區坪數湊不到 → 先看全縣市相近坪數,不拿大坪數豪宅來比", () => {
    const luxury = [90000, 100000, 110000, 120000, 130000, 95000].map((r) => row(r, 40, 1, { kind: "獨立套房" }));
    const citySmall = [14000, 15000, 16000, 17000, 18000].map((r) => row(r, 7, 1, { kind: "獨立套房", district: "中山區" }));
    // 全市的獨立套房大多是 10–13 坪、2 萬上下(豪宅在全市裡是少數)
    const cityMid = Array.from({ length: 20 }, (_, i) => row(19000 + i * 300, 11, 1, { kind: "獨立套房", district: "文山區" }));
    const t = { kind: "獨立套房", size_ping: 7, rooms: 1, building_age: null, has_elevator: null, rent: 15000 };
    const m = computeMarket(t, luxury, [...luxury, ...citySmall, ...cityMid])!;
    expect(m).toMatchObject({ level: 3, scope: "city", median: 16000, diff_pct: -6, criteria: ["坪數 ±30%"] });
    // 沒給全縣市樣本時才退到同區全部
    expect(computeMarket(t, luxury)).toMatchObject({ level: 4, scope: "district" });
  });

  it("剔除極端值:同一棟反覆登錄的整戶高價不會主導", () => {
    const normal = [15000, 16000, 17000, 18000, 19000, 20000, 21000].map((r) => row(r, 20, 1, { kind: "分租套房", building_age: 40, has_elevator: false }));
    const outliers = [232000, 225000, 243600, 243600, 225000].map((r) => row(r, 48, 2, { kind: "分租套房", building_age: 10, has_elevator: true }));
    const m = computeMarket({ kind: "分租套房", size_ping: 6, rooms: 1, building_age: 12, has_elevator: true, rent: 9800 }, [...normal, ...outliers])!;
    expect(m.median).toBeLessThan(25000);
    expect(m.comparables.every((c) => c.rent < 100000)).toBe(true);
  });

  it("同一棟最多算 2 筆", () => {
    const building = Array.from({ length: 10 }, (_, i) => row(25000, 6, 1, { kind: "分租套房", road: "中正路", total_floors: 12, building_age: 5, date: `2026-0${(i % 9) + 1}-01` }));
    const others = [8000, 8500, 9000, 9500, 10000, 10500].map((r, i) => row(r, 20, 1, { kind: "分租套房", road: `路${i}`, total_floors: 5, building_age: 5 }));
    const m = computeMarket({ kind: "分租套房", size_ping: 5, rooms: 1, building_age: 5, has_elevator: true, rent: 9000 }, [...building, ...others])!;
    expect(m.count).toBe(8);
    expect(m.median).toBe(9750);
  });

  it("quantile", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([5], 0.25)).toBe(5);
  });
});
