/**
 * 房源池模式(方向文件 §5.4):
 *   私人模式(PRIVATE_POOL=1,只在使用者本機):照舊是一份共用的房源池(591 / 好房採集),照片、聯絡人、屋況文字都有,採集機可以推入。
 *   公開模式(預設,正式站):每人只看得到自己建的房源(properties.created_by);
 *     不存也不回照片、屋況文字(raw_json)、聯絡人;/api/ingest/listings 這組不存在;
 *     靠開價算的東西(行情卡「目前開價」)與拉麵的 Google 評分也不給。
 * 預設是公開模式:忘了設變數時寧可少功能,不要把抓來的資料放上網。
 */
import type { Context } from "hono";
import type { AppEnv, Env } from "./env";

export function isPrivatePool(env: Pick<Env, "PRIVATE_POOL">): boolean {
  return env.PRIVATE_POOL === "1" || env.PRIVATE_POOL === "true";
}

/** 這個請求看得到誰建的房源:null = 全部(私人模式),數字 = 只有這個使用者的 */
export function ownerOf(c: Context<AppEnv>): number | null {
  return isPrivatePool(c.env) ? null : Number(c.get("user").id);
}

/** 接在 WHERE 條件後面的 SQL 片段(owner 是 session 裡的整數,直接內嵌) */
export function ownerSql(owner: number | null, alias = ""): string {
  return owner == null ? "" : ` AND ${alias ? `${alias}.` : ""}created_by = ${Math.trunc(owner)}`;
}
