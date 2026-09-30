import { consentsNeeded } from "@shared/legal";

/** 這個使用者還要同意哪些條款(沒同意過或有新版) */
export async function neededFor(DB: D1Database, userId: number) {
  const { results } = await DB.prepare("SELECT doc, version FROM consents WHERE user_id = ? ORDER BY id").bind(userId).all<{ doc: string; version: string }>();
  return consentsNeeded(results);
}
