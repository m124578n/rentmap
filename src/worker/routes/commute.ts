/**
 * 通勤(需登入;公車 + 捷運,最多轉乘一次,見 transit/plan.ts):
 *   GET /api/commute?radius=400                  所有房源 × 我的每個地點,最快的一種(精簡版,列表 / 篩選用)
 *   GET /api/commute/trips?lat=&lng=&place_id=&radius=400
 *                                                一個點到一個地點:每種搭法最快的 + 公車直達前三條(面板用)
 *
 * 每個地點算一次「從目的地往回」的標記,之後每間房只看走得到的站,所以跟房源數幾乎無關。
 * 公車資料整份在記憶體(transit/network.ts);沒匯入公車時仍有捷運與步行。
 */
import { Hono } from "hono";
import { and, asc, eq } from "drizzle-orm";
import type { CommuteMatrix, TripsResponse } from "@shared/trip";
import type { AppEnv } from "../env";
import { requireUser } from "../auth";
import { db, schema } from "../db";
import { loadBusNet } from "../transit/network";
import { bestTrip, buildPlan, buildTrip, candidates } from "../transit/plan";

export const commute = new Hono<AppEnv>();
commute.use("/api/commute", requireUser());
commute.use("/api/commute/*", requireUser());

const radiusOf = (v: string | undefined) => Math.min(1000, Math.max(100, Number(v) || 400));

commute.get("/api/commute", async (c) => {
  const radius = radiusOf(c.req.query("radius"));
  const d = db(c.env.DB);
  const places = await d
    .select({ id: schema.myPlaces.id, name: schema.myPlaces.name, lat: schema.myPlaces.lat, lng: schema.myPlaces.lng })
    .from(schema.myPlaces)
    .where(eq(schema.myPlaces.userId, c.get("user").id))
    .orderBy(asc(schema.myPlaces.id));
  const props = (await d.select({ id: schema.properties.id, lat: schema.properties.lat, lng: schema.properties.lng }).from(schema.properties)).filter(
    (p): p is { id: number; lat: number; lng: number } => p.lat != null && p.lng != null,
  );
  const net = await loadBusNet(c.env.DB);
  const items: CommuteMatrix["items"] = {};
  for (const p of props) items[p.id] = {};
  for (const place of places) {
    const plan = buildPlan(net, place);
    for (const p of props) {
      const t = bestTrip(plan, p.lat, p.lng, radius);
      items[p.id]![place.id] = t ? { kind: t.kind, total_min: t.total_min, transfers: t.transfers, summary: t.summary } : null;
    }
  }
  const body: CommuteMatrix = { radius, has_bus: net.version != null, items };
  return c.json(body);
});

commute.get("/api/commute/trips", async (c) => {
  const lat = Number(c.req.query("lat"));
  const lng = Number(c.req.query("lng"));
  const placeId = Number(c.req.query("place_id"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isInteger(placeId)) return c.json({ error: "lat, lng, place_id required" }, 400);
  const [place] = await db(c.env.DB)
    .select({ name: schema.myPlaces.name, lat: schema.myPlaces.lat, lng: schema.myPlaces.lng })
    .from(schema.myPlaces)
    .where(and(eq(schema.myPlaces.id, placeId), eq(schema.myPlaces.userId, c.get("user").id)));
  if (!place) return c.json({ error: "place not found" }, 404);
  const net = await loadBusNet(c.env.DB);
  const plan = buildPlan(net, place);
  const trips = candidates(plan, lat, lng, radiusOf(c.req.query("radius")), 3)
    .map((x) => buildTrip(plan, x))
    .sort((a, b) => a.total_min - b.total_min);
  const body: TripsResponse = { has_bus: net.version != null, trips };
  return c.json(body);
});
