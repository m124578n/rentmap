/**
 * 道路圖匯入(採集機 bearer;資料由家裡 scripts/build_roads.py 產生,`collect -- roads` 推):
 *   POST /api/ingest/roads          { region, version, chunk, total, data(base64) }   一段一段推,同一段重送會覆蓋
 *   POST /api/ingest/roads/commit   { region, version }   段數齊了才換版:刪掉同生活圈的其他 version
 * 讀取在 transit/roads.ts(通勤 API 用)。
 */
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requireIngest } from "../auth";
import { REGION_KEYS } from "@shared/regions";

export const roads = new Hono<AppEnv>();
roads.use("/api/ingest/roads", requireIngest());
roads.use("/api/ingest/roads/*", requireIngest());

const Region = z.enum(REGION_KEYS);
const Chunk = z.object({
  region: Region,
  version: z.string().min(1).max(40),
  chunk: z.number().int().min(0).max(199),
  total: z.number().int().min(1).max(200),
  // D1 單列有大小上限:一段最多約 1.5MB(base64)
  data: z
    .string()
    .min(1)
    .max(1_500_000)
    .regex(/^[A-Za-z0-9+/=]+$/),
});

roads.post("/api/ingest/roads", async (c) => {
  const parsed = Chunk.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues.slice(0, 5) }, 400);
  const v = parsed.data;
  if (v.chunk >= v.total) return c.json({ error: "chunk >= total" }, 400);
  await c.env.DB.prepare("INSERT OR REPLACE INTO road_graphs (region, version, chunk, total, data) VALUES (?1, ?2, ?3, ?4, ?5)")
    .bind(v.region, v.version, v.chunk, v.total, v.data)
    .run();
  return c.json({ ok: true, chunk: v.chunk });
});

roads.post("/api/ingest/roads/commit", async (c) => {
  const parsed = z.object({ region: Region, version: z.string().min(1).max(40) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid" }, 400);
  const { region, version } = parsed.data;
  const r = await c.env.DB.prepare("SELECT COUNT(*) AS n, MAX(total) AS total, MIN(total) AS t0 FROM road_graphs WHERE region = ?1 AND version = ?2")
    .bind(region, version)
    .first<{ n: number; total: number | null; t0: number | null }>();
  if (!r?.n || r.total !== r.t0 || r.n !== r.total) return c.json({ error: "段數不齊,不換版", got: r?.n ?? 0, total: r?.total ?? null }, 409);
  const del = await c.env.DB.prepare("DELETE FROM road_graphs WHERE region = ?1 AND version <> ?2").bind(region, version).run();
  return c.json({ region, version, chunks: r.n, deleted: del.meta.changes });
});
