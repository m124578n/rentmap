/**
 * 落腳圈(需登入;計算在 transit/zones.ts,型別在 src/shared/zones.ts):
 *   GET /api/zones?region=&mode=transit|scooter|car&combine=max|weighted&rings=20,35,50&day=&time=&dir=
 * 方案跟通勤一樣(免費版只算平日 08:00 上班、方案內的地點);結果走 Cache API,任何一份資料或地點變了 key 就變。
 */
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { requireUser } from "../auth";
import { cachedJson, tableSig } from "../cache";
import { parseRegion, regionAt, regionTdx } from "@shared/regions";
import { ZonesQuery } from "@shared/zones";
import { commuteGate, myPlaces, whenOf } from "./commute";
import { loadBusNet } from "../transit/network";
import { EMPTY_BIKES, loadBikes } from "../transit/bike";
import { loadRoads } from "../transit/roads";
import { RAIL_VERSION } from "../transit/mrt";
import { computeZones } from "../transit/zones";

export const zones = new Hono<AppEnv>();
zones.use("/api/zones", requireUser());

zones.get("/api/zones", async (c) => {
  const q = ZonesQuery.safeParse(c.req.query());
  if (!q.success) return c.json({ error: "invalid", issues: q.error.issues.slice(0, 5) }, 400);
  const when = whenOf(c.req.query());
  if (!when) return c.json({ error: "day / time / dir invalid" }, 400);
  const g = await commuteGate(c, when);
  if ("denied" in g) return g.denied;
  const region = parseRegion(c.req.query("region"));
  // 只算這個生活圈裡的地點(別區的公司不會出現在這區的圈裡)
  const places = (await myPlaces(c, g.maxPlaces)).filter((p) => regionAt(p.lat, p.lng) === region);
  const { mode, combine, rings } = q.data;
  const DB = c.env.DB;
  const tdx = regionTdx(region)
    .map((x) => `'${x}'`)
    .join(",");
  const key = [
    "zones",
    region,
    mode,
    combine,
    rings.join(","),
    when.day,
    when.time,
    when.dir,
    places.map((p) => `${p.id}@${p.lat},${p.lng}x${p.days}`).join(";"),
    g.bikeOk ? 1 : 0,
    mode === "transit" ? await tableSig(DB, "bus_routes", "version", `WHERE city IN (${tdx})`) : await tableSig(DB, "road_graphs", "version", `WHERE region = '${region}'`),
    await tableSig(DB, "rent_stats", "id"),
    await tableSig(DB, "sale_stats", "id"),
    await tableSig(DB, "pois", "version"),
    await tableSig(DB, "hazard_zones", "version"),
    RAIL_VERSION,
  ];
  return cachedJson(c, key, async () => {
    const bus = await loadBusNet(DB, region);
    const bikes = mode === "transit" && g.bikeOk ? await loadBikes(DB, region) : EMPTY_BIKES;
    const roads = await loadRoads(DB, region);
    return computeZones(DB, { region, places, mode, when, combine, rings, bus, bikes, roads });
  });
});
