/** 目標範圍只有雙北。行政區清單給表單下拉與資料驗證用。 */
export const CITIES = ["台北市", "新北市"] as const;
export type City = (typeof CITIES)[number];

export const DISTRICTS: Record<City, readonly string[]> = {
  台北市: ["中正區", "大同區", "中山區", "松山區", "大安區", "萬華區", "信義區", "士林區", "北投區", "內湖區", "南港區", "文山區"],
  新北市: [
    "板橋區", "三重區", "中和區", "永和區", "新莊區", "新店區", "土城區", "蘆洲區", "樹林區", "汐止區", "鶯歌區", "三峽區",
    "淡水區", "瑞芳區", "五股區", "泰山區", "林口區", "深坑區", "石碇區", "坪林區", "三芝區", "石門區", "八里區", "平溪區",
    "雙溪區", "貢寮區", "金山區", "萬里區", "烏來區",
  ],
};

/** 房源來源。591 / 樂屋 / 好房由採集機推入,fb / agent / manual 是手動表單。 */
export const SOURCES = ["591", "rakuya", "hb", "fb", "agent", "manual"] as const;
export type Source = (typeof SOURCES)[number];
export const SOURCE_LABEL: Record<Source, string> = {
  "591": "591",
  rakuya: "樂屋網",
  hb: "好房網",
  fb: "FB 社團",
  agent: "房仲",
  manual: "手動",
};

/** 找房 CRM 的狀態流程 */
export const STAGES = ["saved", "contacted", "scheduled", "visited", "considering", "finalist", "rejected", "signed"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABEL: Record<Stage, string> = {
  saved: "收藏",
  contacted: "已聯絡",
  scheduled: "已約看",
  visited: "已看房",
  considering: "考慮中",
  finalist: "最終候選",
  rejected: "淘汰",
  signed: "已簽約",
};

export const BUILDING_TYPES = ["公寓", "電梯大樓", "華廈", "透天", "套房", "其他"] as const;
export type BuildingType = (typeof BUILDING_TYPES)[number];
