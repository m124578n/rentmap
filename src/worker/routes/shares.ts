/**
 * 落腳圈的分享連結:
 *   POST   /api/shares               (登入){ region, mode, combine, rings, day, time, dir } → 把目前方案內、這個生活圈的地點存成快照,回 { token }
 *   GET    /api/shares               (登入)我建過的連結
 *   DELETE /api/shares/:token        (登入)刪掉自己的
 *   GET    /api/shares/:token/zones  (不用登入)用快照算落腳圈(唯讀);結果走 Cache API
 * token 是 16 個隨機字元(不可猜);分享的內容會包含地點名稱與座標,建立時前端有提示。
 */
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requireUser } from "../auth";
import { cachedJson, tableSig } from "../cache";
import { REGION_KEYS, REGIONS, regionAt, regionTdx, type RegionKey } from "@shared/regions";
import { ZonesQuery, type SharedZones } from "@shared/zones";
import { commuteGate, myPlaces, whenOf } from "./commute";
import { loadBusNet } from "../transit/network";
import { EMPTY_BIKES } from "../transit/bike";
import { loadRoads } from "../transit/roads";
import { RAIL_VERSION } from "../transit/mrt";
import { computeZones, type ZonePlace } from "../transit/zones";
import type { CommuteWhen } from "@shared/trip";

export const shares = new Hono<AppEnv>();
shares.use("/api/shares", requireUser());

interface ShareParams {
  region: RegionKey;
  mode: "transit" | "scooter" | "car";
  combine: "max" | "weighted";
  rings: number[];
  when: CommuteWhen;
  places: Omit<ZonePlace, "id">[];
}

const token = () => {
  const a = crypto.getRandomValues(new Uint8Array(12));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

shares.post("/api/shares", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, string> | null;
  const q = ZonesQuery.safeParse(body ?? {});
  const region = z.enum(REGION_KEYS).safeParse(body?.region);
  const when = whenOf(body ?? {});
  if (!q.success || !region.success || !when || !REGIONS[region.data].enabled) return c.json({ error: "invalid" }, 400);
  const g = await commuteGate(c, when);
  if ("denied" in g) return g.denied;
  const places = (await myPlaces(c, g.maxPlaces)).filter((p) => regionAt(p.lat, p.lng) === region.data);
  if (!places.length) return c.json({ error: "這個生活圈還沒有地點" }, 400);
  const params: ShareParams = { region: region.data, ...q.data, when, places: places.map(({ name, lat, lng, days }) => ({ name, lat, lng, days })) };
  const t = token();
  await c.env.DB.prepare("INSERT INTO shares (token, user_id, params, created_at) VALUES (?, ?, ?, ?)").bind(t, c.get("user").id, JSON.stringify(params), new Date().toISOString()).run();
  return c.json({ token: t }, 201);
});

shares.get("/api/shares", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT token, params, created_at FROM shares WHERE user_id = ? ORDER BY created_at DESC").bind(c.get("user").id).all<{ token: string; params: string; created_at: string }>();
  return c.json({ items: results.map((r) => ({ token: r.token, created_at: r.created_at, ...(JSON.parse(r.params) as ShareParams) })) });
});

shares.delete("/api/shares/:token", requireUser(), async (c) => {
  const r = await c.env.DB.prepare("DELETE FROM shares WHERE token = ? AND user_id = ?").bind(c.req.param("token"), c.get("user").id).run();
  return r.meta.changes ? c.json({ ok: true }) : c.json({ error: "not found" }, 404);
});

shares.get("/api/shares/:token/zones", async (c) => {
  c.header("X-Robots-Tag", "noindex");
  const row = await c.env.DB.prepare("SELECT params, created_at FROM shares WHERE token = ?").bind(c.req.param("token")).first<{ params: string; created_at: string }>();
  if (!row) return c.json({ error: "not found" }, 404);
  const p = JSON.parse(row.params) as ShareParams;
  const DB = c.env.DB;
  const tdx = regionTdx(p.region)
    .map((x) => `'${x}'`)
    .join(",");
  const key = [
    "share",
    c.req.param("token"),
    p.mode === "transit" ? await tableSig(DB, "bus_routes", "version", `WHERE city IN (${tdx})`) : await tableSig(DB, "road_graphs", "version", `WHERE region = '${p.region}'`),
    await tableSig(DB, "rent_stats", "id"),
    await tableSig(DB, "sale_stats", "id"),
    await tableSig(DB, "pois", "version"),
    await tableSig(DB, "hazard_zones", "version"),
    RAIL_VERSION,
  ];
  return cachedJson(c, key, async (): Promise<SharedZones> => {
    const bus = await loadBusNet(DB, p.region);
    const roads = await loadRoads(DB, p.region);
    const places = p.places.map((pl, i) => ({ ...pl, id: i + 1 }));
    const z = await computeZones(DB, { region: p.region, places, mode: p.mode, when: p.when, combine: p.combine, rings: p.rings, bus, bikes: EMPTY_BIKES, roads });
    return { ...z, region: p.region, created_at: row.created_at };
  });
});
