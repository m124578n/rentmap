/**
 * 買賣行情(內政部不動產買賣實價登錄)
 *
 * 查詢(需登入):
 *   GET /api/market/sale/at?city&district&building_type&size_ping&building_age&price   任一地址的買賣行情(每坪單價、估總價)
 *
 * 採集機推入(bearer INGEST_SECRET):
 *   POST /api/ingest/sale-stats        { items: SaleStatIn[] }  用實價登錄編號 upsert
 *   POST /api/ingest/sale-stats/prune  { before: YYYY-MM-DD }   刪掉交易日更早的
 *
 * 樣本池:一個縣市一份(該縣市最新一筆往前一年)進記憶體,以筆數 + 最大 id 當快取鍵。
 */
import { Hono } from "hono";
import { z } from "zod";
import { cleanSalePool, computeSaleMarket, SALE_TYPES, SaleStatIn, type SaleMarketResponse, type SaleStat } from "@shared/sale";
import { normalizeCity } from "@shared/regions";
import type { AppEnv } from "../env";
import { requireIngest, requireUser } from "../auth";
import { planOf } from "../plan";

export const sale = new Hono<AppEnv>();
sale.use("/api/market/sale/*", requireUser());
sale.use("/api/ingest/sale-stats", requireIngest());
sale.use("/api/ingest/sale-stats/*", requireIngest());

type Pools = { sig: string; byDistrict: Map<string, SaleStat[]>; all: SaleStat[] };
const cache = new Map<string, Pools>();

export async function loadSalePools(DB: D1Database, city: string): Promise<Pools> {
  const head = await DB.prepare("SELECT COUNT(*) AS n, MAX(id) AS m FROM sale_stats WHERE city = ?").bind(city).first<{ n: number; m: number | null }>();
  const sig = `${head?.n ?? 0}#${head?.m ?? 0}`;
  const hit = cache.get(city);
  if (hit?.sig === sig) return hit;
  const { results } = await DB.prepare(
    `SELECT district, road, building_type, floor, total_floors, building_age, size_ping, price, unit_price, rooms, has_parking, date
       FROM sale_stats
      WHERE city = ?1 AND date >= date((SELECT MAX(date) FROM sale_stats WHERE city = ?1), '-365 days')`,
  )
    .bind(city)
    .all<Omit<SaleStat, "has_parking"> & { has_parking: number }>();
  const rows: SaleStat[] = results.map((r) => ({ ...r, has_parking: r.has_parking === 1 }));
  const all = cleanSalePool(rows);
  const byDistrict = new Map<string, SaleStat[]>();
  for (const r of all) (byDistrict.get(r.district) ?? byDistrict.set(r.district, []).get(r.district)!).push(r);
  const pools = { sig, byDistrict, all };
  cache.set(city, pools);
  return pools;
}

const AtQuery = z.object({
  city: z.string().min(1),
  district: z.string().min(1),
  building_type: z.enum(SALE_TYPES).optional(),
  size_ping: z.coerce.number().positive().optional(),
  building_age: z.coerce.number().int().min(0).max(150).optional(),
  price: z.coerce.number().int().positive().optional(),
});

sale.get("/api/market/sale/at", async (c) => {
  const parsed = AtQuery.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: "city, district required" }, 400);
  const v = parsed.data;
  const city = normalizeCity(v.city) ?? v.city;
  const pools = await loadSalePools(c.env.DB, city);
  const market = computeSaleMarket(
    { building_type: v.building_type ?? null, size_ping: v.size_ping ?? null, building_age: v.building_age ?? null, price: v.price ?? null },
    pools.byDistrict.get(v.district) ?? [],
    pools.all,
    { cleaned: true },
  );
  // 方案沒有買賣成交明細(買房方案才有):拿掉「最像的幾筆」
  const locked = !!market && !(await planOf(c)).ent.saleDetail;
  const body: SaleMarketResponse = { has_data: pools.all.length > 0, market: locked ? { ...market!, comparables: [] } : market, ...(locked ? { detail_locked: true } : {}) };
  return c.json(body);
});

// ---- 採集機推入 ----

const ItemsBody = z.object({ items: z.array(SaleStatIn).min(1).max(2000) });
sale.post("/api/ingest/sale-stats", async (c) => {
  const parsed = ItemsBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues.slice(0, 20) }, 400);
  const b = (x: boolean | null) => (x == null ? null : Number(x));
  const rows = parsed.data.items.map((x) => ({ ...x, has_parking: Number(x.has_parking), has_elevator: b(x.has_elevator), has_mgmt: b(x.has_mgmt) }));
  // 一個請求一條 SQL(json_each 展開),同編號覆蓋
  await c.env.DB.prepare(
    `INSERT INTO sale_stats (serial, city, district, road, building_type, floor, total_floors, building_age, size_ping, price, unit_price, rooms,
                             has_parking, parking_price, date, has_elevator, has_mgmt)
     SELECT j.value ->> 'serial', j.value ->> 'city', j.value ->> 'district', j.value ->> 'road', j.value ->> 'building_type', j.value ->> 'floor',
            j.value ->> 'total_floors', j.value ->> 'building_age', j.value ->> 'size_ping', j.value ->> 'price', j.value ->> 'unit_price',
            j.value ->> 'rooms', j.value ->> 'has_parking', j.value ->> 'parking_price', j.value ->> 'date', j.value ->> 'has_elevator', j.value ->> 'has_mgmt'
       FROM json_each(?1) AS j WHERE true
     ON CONFLICT(serial) DO UPDATE SET
       city = excluded.city, district = excluded.district, road = excluded.road, building_type = excluded.building_type, floor = excluded.floor,
       total_floors = excluded.total_floors, building_age = excluded.building_age, size_ping = excluded.size_ping, price = excluded.price,
       unit_price = excluded.unit_price, rooms = excluded.rooms, has_parking = excluded.has_parking, parking_price = excluded.parking_price,
       date = excluded.date, has_elevator = excluded.has_elevator, has_mgmt = excluded.has_mgmt`,
  )
    .bind(JSON.stringify(rows))
    .run();
  return c.json({ upserted: rows.length });
});

const PruneBody = z.object({ before: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
sale.post("/api/ingest/sale-stats/prune", async (c) => {
  const parsed = PruneBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid" }, 400);
  const r = await c.env.DB.prepare("DELETE FROM sale_stats WHERE date < ?").bind(parsed.data.before).run();
  const left = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM sale_stats").first<{ n: number }>();
  return c.json({ deleted: r.meta.changes ?? 0, total: left?.n ?? 0 });
});
