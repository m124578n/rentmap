/**
 * 通勤(需登入;公車 + 捷運,最多轉乘一次,見 transit/plan.ts):
 *   GET /api/commute?radius=400&day=wd&time=08:00&dir=to
 *                                                所有房源 × 我的每個地點,最快的一種(精簡版,列表 / 篩選用)
 *   GET /api/commute/trips?lat=&lng=&place_id=&radius=400&day=&time=&dir=
 *                                                一個點到一個地點:每種搭法最快的 + 公車直達前三條(面板用)
 * 時段參數:day = wd / sat / sun、time = 出發時刻、dir = to(住處 → 地點,上班)/ from(地點 → 住處,下班);
 * 省略就是平日 08:00 上班。等車依那個時段的班距,那段時間沒開的路線不算。
 *   GET /api/commute/grid?w=&s=&e=&n=&day=&time=&dir=
 *                                                畫面範圍切網格(最多約 2500 格),每格到每個地點最快幾分(地圖「通勤」圖層)
 * bike=0 不算 YouBike(預設會算:騎到目的地或捷運站旁的站,見 transit/bike.ts)。
 *
 * 每個地點算一次「從目的地往回」的標記,之後每間房只看走得到的站,所以跟房源數幾乎無關。
 * 公車資料整份在記憶體(transit/network.ts);沒匯入公車時仍有捷運與步行。
 */
import { Hono } from "hono";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { DAY_TYPES } from "@shared/bus";
import { COMMUTE_DEFAULT, type CommuteGrid, type CommuteMatrix, type CommuteWhen, type TripsResponse } from "@shared/trip";
import type { AppEnv } from "../env";
import { requireUser } from "../auth";
import { db, schema } from "../db";
import { loadBusNet } from "../transit/network";
import { EMPTY_BIKES, loadBikes } from "../transit/bike";
import { bestTrip, buildPlan, buildTrip, candidates } from "../transit/plan";

export const commute = new Hono<AppEnv>();
commute.use("/api/commute", requireUser());
commute.use("/api/commute/*", requireUser());

const radiusOf = (v: string | undefined) => Math.min(1000, Math.max(100, Number(v) || 400));

const WhenQuery = z.object({
  day: z.enum(DAY_TYPES).default(COMMUTE_DEFAULT.go.day),
  time: z
    .string()
    .regex(/^([01]?\d|2[0-3]):[0-5]\d$/)
    .default(COMMUTE_DEFAULT.go.time),
  dir: z.enum(["to", "from"]).default(COMMUTE_DEFAULT.go.dir),
});
const whenOf = (q: Record<string, string>): CommuteWhen | null => {
  const r = WhenQuery.safeParse({ day: q.day || undefined, time: q.time || undefined, dir: q.dir || undefined });
  return r.success ? { ...r.data, time: r.data.time.padStart(5, "0") } : null;
};

commute.get("/api/commute", async (c) => {
  const radius = radiusOf(c.req.query("radius"));
  const when = whenOf(c.req.query());
  if (!when) return c.json({ error: "day / time / dir invalid" }, 400);
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
  const bikes = c.req.query("bike") === "0" ? EMPTY_BIKES : await loadBikes(c.env.DB);
  const items: CommuteMatrix["items"] = {};
  for (const p of props) items[p.id] = {};
  for (const place of places) {
    const plan = buildPlan(net, place, when, bikes);
    for (const p of props) {
      const t = bestTrip(plan, p.lat, p.lng, radius);
      items[p.id]![place.id] = t ? { kind: t.kind, total_min: t.total_min, transfers: t.transfers, summary: t.summary } : null;
    }
  }
  const body: CommuteMatrix = { radius, when, has_bus: net.version != null, items };
  return c.json(body);
});

commute.get("/api/commute/trips", async (c) => {
  const lat = Number(c.req.query("lat"));
  const lng = Number(c.req.query("lng"));
  const placeId = Number(c.req.query("place_id"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isInteger(placeId)) return c.json({ error: "lat, lng, place_id required" }, 400);
  const when = whenOf(c.req.query());
  if (!when) return c.json({ error: "day / time / dir invalid" }, 400);
  const [place] = await db(c.env.DB)
    .select({ name: schema.myPlaces.name, lat: schema.myPlaces.lat, lng: schema.myPlaces.lng })
    .from(schema.myPlaces)
    .where(and(eq(schema.myPlaces.id, placeId), eq(schema.myPlaces.userId, c.get("user").id)));
  if (!place) return c.json({ error: "place not found" }, 404);
  const net = await loadBusNet(c.env.DB);
  const bikes = c.req.query("bike") === "0" ? EMPTY_BIKES : await loadBikes(c.env.DB);
  const plan = buildPlan(net, place, when, bikes);
  const trips = candidates(plan, lat, lng, radiusOf(c.req.query("radius")), 3)
    .map((x) => buildTrip(plan, x))
    .sort((a, b) => a.total_min - b.total_min);
  const body: TripsResponse = { when, has_bus: net.version != null, trips };
  return c.json(body);
});

/** 網格最多幾格:再多一次請求 CPU 會太久 */
const GRID_MAX = 2500;

commute.get("/api/commute/grid", async (c) => {
  const [w, s, e, n] = (["w", "s", "e", "n"] as const).map((k) => Number(c.req.query(k))) as [number, number, number, number];
  if (![w, s, e, n].every(Number.isFinite) || e <= w || n <= s) return c.json({ error: "w, s, e, n required" }, 400);
  const when = whenOf(c.req.query());
  if (!when) return c.json({ error: "day / time / dir invalid" }, 400);
  // 格子邊長:至少 250m,畫面大就放大到不超過 GRID_MAX 格
  const kx = Math.cos((((s + n) / 2) * Math.PI) / 180);
  const minStep = 0.00225;
  const step = Math.max(minStep, Math.sqrt(((e - w) * kx * (n - s)) / GRID_MAX));
  const stepLng = step / kx;
  const places = await db(c.env.DB)
    .select({ id: schema.myPlaces.id, name: schema.myPlaces.name, lat: schema.myPlaces.lat, lng: schema.myPlaces.lng })
    .from(schema.myPlaces)
    .where(eq(schema.myPlaces.userId, c.get("user").id))
    .orderBy(asc(schema.myPlaces.id));
  const net = await loadBusNet(c.env.DB);
  const bikes = c.req.query("bike") === "0" ? EMPTY_BIKES : await loadBikes(c.env.DB);
  const plans = places.map((pl) => buildPlan(net, pl, when, bikes));
  const cells: CommuteGrid["cells"] = [];
  for (let lat = Math.floor(s / step) * step + step / 2; lat < n; lat += step)
    for (let lng = Math.floor(w / stepLng) * stepLng + stepLng / 2; lng < e; lng += stepLng) {
      const mins = plans.map((plan) => bestTrip(plan, lat, lng, 400)?.total_min ?? null);
      cells.push({ lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5, mins });
    }
  const body: CommuteGrid = { step, step_lng: stepLng, places: places.map((p) => p.id), cells };
  return c.json(body);
});
