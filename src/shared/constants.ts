import { CITY_INFO, OPEN_CITIES, type CityName } from "./regions";

/** 已開放的縣市與行政區(由 regions.ts 決定,不要在這裡寫死);表單下拉與資料驗證用 */
export const CITIES = OPEN_CITIES as [CityName, ...CityName[]];
export type City = CityName;
export const DISTRICTS = Object.fromEntries(Object.entries(CITY_INFO).map(([k, v]) => [k, v.districts])) as unknown as Record<CityName, readonly string[]>;

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

/** 房型(591 的 kind):整層 / 獨立套房 / 分租套房 / 雅房 */
export const KINDS = ["整層住家", "獨立套房", "分租套房", "雅房", "其他"] as const;
export type Kind = (typeof KINDS)[number];
