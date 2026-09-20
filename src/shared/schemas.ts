import { z } from "zod";
import { BUILDING_TYPES, CITIES, DISTRICTS, SOURCES, STAGES, type City } from "./constants";

/** 空字串當 undefined(HTML 表單送空欄位) */
const optStr = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.string().trim().max(500).optional());
const optInt = z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number().int().nonnegative().optional());
const optNum = z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number().nonnegative().optional());
const optBool = z.preprocess((v) => (v === "" || v == null ? undefined : v === true || v === "true" || v === 1 || v === "1" || v === "on"), z.boolean().optional());

/** 手動新增 / 採集機推入共用的房源欄位。property 欄位 + 一筆 listing 欄位攤平在一起。 */
const PropertyFields = z
  .object({
    title: z.string().trim().min(1, "請填標題").max(200),
    city: z.enum(CITIES),
    district: z.string().trim().min(1, "請選行政區"),
    road: optStr,
    address_text: optStr,
    lat: z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number().min(-90).max(90).optional()),
    lng: z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number().min(-180).max(180).optional()),

    building_type: z.preprocess((v) => (v === "" ? undefined : v), z.enum(BUILDING_TYPES).optional()),
    floor: optInt,
    total_floors: optInt,
    building_age: optInt,
    size_ping: optNum,
    rooms: optInt,
    living_rooms: optInt,
    bathrooms: optInt,
    has_elevator: optBool,
    has_parking: optBool,
    pet_allowed: optBool,
    cooking_allowed: optBool,
    has_washer: optBool,
    has_internet: optBool,
    mgmt_fee: optInt,
    utilities_note: optStr,
    note: optStr,

    // listing
    source: z.enum(SOURCES).default("manual"),
    source_url: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.string().url().max(1000).optional()),
    source_listing_id: optStr,
    rent: z.preprocess((v) => Number(v), z.number().int().positive("租金要大於 0")),
    deposit_months: optNum,
    contact_name: optStr,
    contact_phone: optStr,
    contact_line: optStr,
  });

const districtOk = (v: { city: City; district: string }) => DISTRICTS[v.city].includes(v.district);
const districtErr = { message: "行政區不屬於該縣市", path: ["district"] };

export const PropertyInput = PropertyFields.refine(districtOk, districtErr);
export type PropertyInput = z.infer<typeof PropertyInput>;

/** 採集機推入 ingest 的格式:多了來源 id(必填)、照片、原始資料、來源端時間 */
export const ImportedListing = PropertyFields.extend({
  source_listing_id: z.string().trim().min(1),
  photos: z.array(z.string().url()).default([]),
  raw_json: z.string().optional(),
  source_posted_at: optStr, // 來源顯示的發佈時間(原文字)
  source_updated_at: optStr,
  status: z.enum(["active", "removed"]).default("active"),
}).refine(districtOk, districtErr);
export type ImportedListing = z.infer<typeof ImportedListing>;

export const StageInput = z.object({ stage: z.enum(STAGES), note: optStr });
export type StageInput = z.infer<typeof StageInput>;

/** API 回傳的房源列表項目 */
export interface PropertySummary {
  id: number;
  title: string;
  city: string;
  district: string;
  road: string | null;
  lat: number | null;
  lng: number | null;
  size_ping: number | null;
  rooms: number | null;
  floor: number | null;
  total_floors: number | null;
  has_elevator: boolean | null;
  mgmt_fee: number | null;
  rent: number | null;
  source: string | null;
  source_url: string | null;
  listing_status: string | null;
  stage: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionUser {
  id: number;
  name: string | null;
  avatar: string | null;
}
