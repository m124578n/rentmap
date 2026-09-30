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
 *   POST /api/tour  { points, start?, day, time, bike? }
 *                                                看房路線:每兩點之間(start → 各點、各點互相)的最快搭法,前端排順序
 * bike=0 不算 YouBike(預設會算:騎到目的地或捷運站旁的站,見 transit/bike.ts)。
 *
 * 每個地點算一次「從目的地往回」的標記,之後每間房只看走得到的站,所以跟房源數幾乎無關。
 * 公車資料整份在記憶體(transit/network.ts);沒匯入公車時仍有捷運與步行。
 */
import { Hono } from "hono";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { DAY_TYPES } from "@shared/bus";
import { COMMUTE_DEFAULT, type CommuteGrid, type CommuteMatrix, type CommuteWhen, type TourResponse, type TripsResponse } from "@shared/trip";
import type { AppEnv } from "../env";
import { requireUser } from "../auth";
import { ownerOf } from "../pool";
import { cachedJson, propertiesSig, tableSig } from "../cache";
import { db, schema } from "../db";
import { loadBusNet } from "../transit/network";
import { EMPTY_BIKES, loadBikes } from "../transit/bike";
import { bestTrip, buildPlan, buildTrip, candidates } from "../transit/plan";
import { RAIL_VERSION } from "../transit/mrt";
import { parseRegion, regionAt, regionTdx } from "@shared/regions";

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
  const bike = c.req.query("bike") !== "0";
  const DB = c.env.DB;
  const owner = ownerOf(c);
  // 一次只算一個生活圈:那一區的公車 / 軌道 / YouBike 網路;不同區的地點與房源彼此不算(null)
  const region = parseRegion(c.req.query("region"));
  // 我的地點是個人資料:放進 key(只存在伺服器端快取);公車、YouBike、房源任何一個更新 key 就變
  const key = [
    "commute",
    region,
    places.map((p) => `${p.id}@${p.lat},${p.lng}`).join(";"),
    radius,
    when.day,
    when.time,
    when.dir,
    bike ? 1 : 0,
    await tableSig(DB, "bus_routes", "version", `WHERE city IN (${regionTdx(region).map((x) => `'${x}'`).join(",")})`),
    bike ? await tableSig(DB, "pois", "version", "WHERE category = 'youbike'") : "-",
    await propertiesSig(DB, owner),
    RAIL_VERSION,
  ];
  return cachedJson(c, key, async (): Promise<CommuteMatrix> => {
    const props = (
      await d
        .select({ id: schema.properties.id, lat: schema.properties.lat, lng: schema.properties.lng })
        .from(schema.properties)
        .where(owner == null ? undefined : eq(schema.properties.createdBy, owner))
    ).filter(
      (p): p is { id: number; lat: number; lng: number } => p.lat != null && p.lng != null && regionAt(p.lat, p.lng) === region,
    );
    const net = await loadBusNet(DB, region);
    const bikes = bike ? await loadBikes(DB, region) : EMPTY_BIKES;
    const items: CommuteMatrix["items"] = {};
    for (const p of props) items[p.id] = Object.fromEntries(places.map((pl) => [pl.id, null]));
    for (const place of places) {
      if (regionAt(place.lat, place.lng) !== region) continue;
      const plan = buildPlan(net, place, when, bikes);
      for (const p of props) {
        const t = bestTrip(plan, p.lat, p.lng, radius);
        items[p.id]![place.id] = t ? { kind: t.kind, total_min: t.total_min, transfers: t.transfers, summary: t.summary } : null;
      }
    }
    return { radius, when, has_bus: net.version != null, items };
  });
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
  const region = parseRegion(regionAt(place.lat, place.lng));
  const net = await loadBusNet(c.env.DB, region);
  const bikes = c.req.query("bike") === "0" ? EMPTY_BIKES : await loadBikes(c.env.DB, region);
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
  const region = parseRegion(regionAt((s + n) / 2, (w + e) / 2) ?? c.req.query("region"));
  const net = await loadBusNet(c.env.DB, region);
  const bikes = c.req.query("bike") === "0" ? EMPTY_BIKES : await loadBikes(c.env.DB, region);
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

// ---- 看房路線 ----

const Pt = z.object({ lat: z.number().min(21).max(26.5), lng: z.number().min(119).max(123), name: z.string().max(60) });
const TourBody = z.object({
  points: z.array(Pt).min(2).max(8),
  start: Pt.nullable().optional(),
  day: z.enum(DAY_TYPES).default("wd"),
  time: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/).default("10:00"),
  bike: z.boolean().default(true),
});

/**
 * 節點 = [start?, ...points];trips[i][j] = 節點 i → 節點 j 的最快搭法(j 只會是看房點;null = 搭不到或同一點)。
 * 每個看房點當目的地建一次 plan(等車用同一個時段估),所以 8 間約 8 次。
 */
commute.post("/api/tour", async (c) => {
  const parsed = TourBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues.slice(0, 10) }, 400);
  const { points, start, day, time, bike } = parsed.data;
  const when: CommuteWhen = { day, time: time.padStart(5, "0"), dir: "to" };
  const nodes = start ? [start, ...points] : points;
  const region = parseRegion(regionAt(points[0]!.lat, points[0]!.lng));
  const net = await loadBusNet(c.env.DB, region);
  const bikes = bike ? await loadBikes(c.env.DB, region) : EMPTY_BIKES;
  const trips: TourResponse["trips"] = nodes.map(() => nodes.map(() => null));
  nodes.forEach((to, j) => {
    if (start && j === 0) return; // 不會回到起點
    const plan = buildPlan(net, to, when, bikes);
    nodes.forEach((from, i) => {
      if (i !== j) trips[i]![j] = bestTrip(plan, from.lat, from.lng, 400);
    });
  });
  const body: TourResponse = { when, has_start: !!start, trips };
  return c.json(body);
});
