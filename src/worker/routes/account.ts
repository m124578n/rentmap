/**
 * 帳號(需登入;隱私權政策承諾的「閱覽、複製、刪除」):
 *   GET    /api/account/export  自己的全部資料(JSON 下載):帳號、自己建的房源與刊登、收藏、我的地點、找房需求、條款同意紀錄
 *   DELETE /api/account         刪除帳號:自己建的房源(連同刊登、價格紀錄)與所有個人資料;body 要帶 { confirm: "刪除" }
 */
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { clearSession, requireUser } from "../auth";

export const account = new Hono<AppEnv>();
account.use("/api/account", requireUser());
account.use("/api/account/*", requireUser());

account.get("/api/account/export", async (c) => {
  const id = c.get("user").id;
  const DB = c.env.DB;
  const all = async (sql: string) => (await DB.prepare(sql).bind(id).all()).results;
  const body = {
    exported_at: new Date().toISOString(),
    user: await DB.prepare("SELECT id, provider, display_name, email, created_at, last_login_at FROM users WHERE id = ?").bind(id).first(),
    properties: await all("SELECT * FROM properties WHERE created_by = ?"),
    listings: await all("SELECT l.* FROM listings l JOIN properties p ON p.id = l.property_id WHERE p.created_by = ?"),
    favorites: await all("SELECT * FROM favorites WHERE user_id = ?"),
    places: await all("SELECT * FROM my_places WHERE user_id = ?"),
    requirements: await all("SELECT * FROM user_requirements WHERE user_id = ?"),
    consents: await all("SELECT doc, version, accepted_at, ip FROM consents WHERE user_id = ?"),
  };
  c.header("Content-Disposition", `attachment; filename="rentmap-export-${body.exported_at.slice(0, 10)}.json"`);
  c.header("Cache-Control", "no-store");
  return c.json(body);
});

account.delete("/api/account", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { confirm?: string } | null;
  if (body?.confirm !== "刪除") return c.json({ error: "要帶 { confirm: \"刪除\" }" }, 400);
  const id = c.get("user").id;
  const DB = c.env.DB;
  // properties.created_by 沒有 cascade:先刪自己建的房源(刊登、價格紀錄、別人的收藏跟著 cascade),再刪帳號(收藏、地點、需求、同意紀錄 cascade)
  const n = (await DB.prepare("SELECT COUNT(*) AS n FROM properties WHERE created_by = ?").bind(id).first<{ n: number }>())?.n ?? 0;
  await DB.batch([DB.prepare("DELETE FROM properties WHERE created_by = ?").bind(id), DB.prepare("DELETE FROM users WHERE id = ?").bind(id)]);
  clearSession(c);
  return c.json({ ok: true, deleted_properties: n });
});
