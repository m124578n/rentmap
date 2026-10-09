/**
 * 營運儀表板(只有站長,見 owner.ts):
 *   GET /api/admin/stats   使用者(總數、新註冊、活躍,近 30 天每天)、方案、內容(筆記、地點、收藏)、條款同意、資料庫各表筆數、最近登入的使用者
 * 數字都是直接查 D1(量不大);回應不快取(每次看都是即時的)。
 */
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { requireUser } from "../auth";
import { requireOwner } from "../owner";
import { LEGAL_DOCS } from "@shared/legal";
import type { AdminStats } from "@shared/admin";

export const admin = new Hono<AppEnv>();
admin.use("/api/admin/*", requireUser(), requireOwner());

const DAYS = 30;
const TABLES = ["users", "properties", "my_places", "favorites", "consents", "plan_grants", "bus_routes", "bus_route_stops", "rent_stats", "sale_stats", "pois", "hazard_zones", "road_graphs"] as const;

admin.get("/api/admin/stats", async (c) => {
  c.header("Cache-Control", "no-store");
  const DB = c.env.DB;
  const now = new Date();
  const ago = (d: number) => new Date(now.getTime() - d * 86400_000).toISOString();
  const one = async <T>(sql: string, ...args: unknown[]) => (await DB.prepare(sql).bind(...args).first<T>())!;
  const all = async <T>(sql: string, ...args: unknown[]) => (await DB.prepare(sql).bind(...args).all<T>()).results;

  const users = await one<{ total: number; new1: number; new7: number; new30: number; act1: number; act7: number; act30: number; pro: number }>(
    `SELECT COUNT(*) AS total,
            SUM(created_at >= ?1) AS new1, SUM(created_at >= ?2) AS new7, SUM(created_at >= ?3) AS new30,
            SUM(last_login_at >= ?1) AS act1, SUM(last_login_at >= ?2) AS act7, SUM(last_login_at >= ?3) AS act30,
            SUM(plan <> 'free' AND plan_until > ?4) AS pro
       FROM users`,
    ago(1),
    ago(7),
    ago(30),
    now.toISOString(),
  );
  // 近 30 天每天:新註冊、最後一次登入落在那天的人數(沒有登入紀錄表,只能看「最後登入」)
  const signups = await all<{ day: string; n: number }>(`SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n FROM users WHERE created_at >= ?1 GROUP BY day`, ago(DAYS));
  const logins = await all<{ day: string; n: number }>(`SELECT substr(last_login_at, 1, 10) AS day, COUNT(*) AS n FROM users WHERE last_login_at >= ?1 GROUP BY day`, ago(DAYS));
  const notes = await all<{ day: string; n: number }>(
    `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n FROM properties WHERE created_by IS NOT NULL AND created_at >= ?1 GROUP BY day`,
    ago(DAYS),
  );
  const series = [...Array(DAYS).keys()].map((i) => {
    const day = ago(DAYS - 1 - i).slice(0, 10);
    const at = (rows: { day: string; n: number }[]) => rows.find((r) => r.day === day)?.n ?? 0;
    return { day, signups: at(signups), logins: at(logins), notes: at(notes) };
  });

  const content = await one<{ notes: number; note_users: number; buy: number; places: number; place_users: number; favorites: number }>(
    `SELECT (SELECT COUNT(*) FROM properties WHERE created_by IS NOT NULL) AS notes,
            (SELECT COUNT(DISTINCT created_by) FROM properties WHERE created_by IS NOT NULL) AS note_users,
            (SELECT COUNT(*) FROM properties WHERE created_by IS NOT NULL AND deal = 'buy') AS buy,
            (SELECT COUNT(*) FROM my_places) AS places,
            (SELECT COUNT(DISTINCT user_id) FROM my_places) AS place_users,
            (SELECT COUNT(*) FROM favorites) AS favorites`,
  );
  const consents = await all<{ doc: string; version: string; n: number }>(`SELECT doc, version, COUNT(DISTINCT user_id) AS n FROM consents GROUP BY doc, version ORDER BY doc, version`);
  const grants = await all<AdminStats["grants"][number]>(
    `SELECT g.created_at, u.email, g.offer, g.days, g.price, g.ref FROM plan_grants g JOIN users u ON u.id = g.user_id ORDER BY g.id DESC LIMIT 10`,
  );
  const recent = await all<AdminStats["recent"][number]>(
    `SELECT u.id, u.display_name AS name, u.email, u.created_at, u.last_login_at, u.plan, u.plan_until,
            (SELECT COUNT(*) FROM properties p WHERE p.created_by = u.id) AS notes,
            (SELECT COUNT(*) FROM my_places m WHERE m.user_id = u.id) AS places
       FROM users u ORDER BY u.last_login_at DESC LIMIT 20`,
  );
  const tables: AdminStats["tables"] = [];
  for (const t of TABLES) tables.push({ table: t, rows: (await one<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)).n });

  const body: AdminStats = {
    at: now.toISOString(),
    users: { total: users.total, new: [users.new1 ?? 0, users.new7 ?? 0, users.new30 ?? 0], active: [users.act1 ?? 0, users.act7 ?? 0, users.act30 ?? 0], pro: users.pro ?? 0 },
    series,
    content,
    consents: consents.map((r) => ({ ...r, current: LEGAL_DOCS[r.doc as keyof typeof LEGAL_DOCS]?.version === r.version })),
    grants,
    recent,
    tables,
  };
  return c.json(body);
});
