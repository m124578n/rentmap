/**
 * 租金行情(內政部租賃實價登錄)
 *
 * 查詢(需登入):
 *   GET /api/market                  所有房源的行情摘要(中位數、比行情高低幾 %),列表 / 卡片用
 *   GET /api/properties/:id/market   一間的行情:四分位、每坪、用了哪些條件、最像的幾筆;
 *                                    另附「目前開價」:系統裡還在刊登(active)的同區同房型房源,同一套相似條件(不含自己)
 *
 * 採集機推入(bearer INGEST_SECRET):
 *   POST /api/ingest/rent-stats        { items: RentStatIn[] }  用實價登錄編號 upsert
 *   POST /api/ingest/rent-stats/prune  { before: YYYY-MM-DD }   刪掉租賃日更早的
 *
 * 樣本池:最新一筆資料往前一年、排除社宅包租代管與含車位,整份進記憶體(雙北一年約 2 萬筆),以筆數 + 最大 id 當快取鍵。
 */
import { Hono } from "hono";
import { z } from "zod";
import { briefOf, cleanPool, computeMarket, RentStatIn, type MarketMatrix, type MarketResponse, type MarketTarget, type RentStat } from "@shared/market";
import type { AppEnv } from "../env";
import { requireIngest, requireUser } from "../auth";
import { isPrivatePool, ownerOf, ownerSql } from "../pool";
import { cachedJson, propertiesSig, tableSig } from "../cache";

export const market = new Hono<AppEnv>();
market.use("/api/market", requireUser());
market.use("/api/properties/:id/market", requireUser());
market.use("/api/ingest/rent-stats", requireIngest());
market.use("/api/ingest/rent-stats/*", requireIngest());

type Row = RentStat & { city: string; kind: string };
let cache: { sig: string; pools: Map<string, RentStat[]> } | null = null;

/** 同區同房型;district 傳 "*" 是同縣市同房型 */
const poolKey = (city: string, district: string, kind: string) => `${city.replace("臺", "台")}|${district}|${kind}`;

async function loadPools(DB: D1Database) {
  const head = await DB.prepare("SELECT COUNT(*) AS n, MAX(id) AS m FROM rent_stats").first<{ n: number; m: number | null }>();
  const sig = `${head?.n ?? 0}#${head?.m ?? 0}`;
  if (cache?.sig === sig) return cache.pools;
  const { results } = await DB.prepare(
    `SELECT city, district, road, kind, building_type, floor, total_floors, building_age, size_ping, rooms, rent, date, has_elevator
       FROM rent_stats
      WHERE social = 0 AND has_parking = 0 AND kind IS NOT NULL
        AND date >= date((SELECT MAX(date) FROM rent_stats), '-365 days')`,
  ).all<Omit<Row, "has_elevator"> & { has_elevator: number | null }>();
  const pools = new Map<string, RentStat[]>();
  for (const r of results) {
    const row: RentStat = { ...r, has_elevator: r.has_elevator == null ? null : r.has_elevator === 1 };
    for (const k of [poolKey(r.city, r.district, r.kind), poolKey(r.city, "*", r.kind)]) {
      const list = pools.get(k);
      if (list) list.push(row);
      else pools.set(k, [row]);
    }
  }
  // 同一棟限筆數、剔除極端值:每個池子只做一次
  for (const [k, list] of pools) pools.set(k, cleanPool(list));
  cache = { sig, pools };
  return pools;
}

interface PropRow {
  id: number;
  city: string;
  district: string;
  kind: string | null;
  size_ping: number | null;
  rooms: number | null;
  building_age: number | null;
  has_elevator: number | null;
  rent: number | null;
}
const PROP_SQL = `SELECT p.id, p.city, p.district, p.kind, p.size_ping, p.rooms, p.building_age, p.has_elevator,
                         (SELECT rent FROM listings WHERE property_id = p.id ORDER BY id DESC LIMIT 1) AS rent
                    FROM properties p`;

function marketOf(pools: Map<string, RentStat[]>, p: PropRow) {
  if (!p.kind) return null;
  const t: MarketTarget = { kind: p.kind, size_ping: p.size_ping, rooms: p.rooms, building_age: p.building_age, has_elevator: p.has_elevator == null ? null : p.has_elevator === 1, rent: p.rent };
  return computeMarket(t, pools.get(poolKey(p.city, p.district, p.kind)) ?? [], pools.get(poolKey(p.city, "*", p.kind)) ?? [], { cleaned: true });
}

market.get("/api/market", async (c) => {
  const DB = c.env.DB;
  // 租金變動會寫價格紀錄,所以房源 + 價格紀錄 + 實價登錄三個一起當版本
  const owner = ownerOf(c);
  const key = ["market", await tableSig(DB, "rent_stats", "id"), await propertiesSig(DB, owner), await tableSig(DB, "listing_price_history", "id")];
  return cachedJson(c, key, async (): Promise<MarketMatrix> => {
    const pools = await loadPools(DB);
    const { results } = await DB.prepare(`${PROP_SQL} WHERE 1${ownerSql(owner, "p")}`).all<PropRow>();
    const items: MarketMatrix["items"] = {};
    for (const p of results) items[p.id] = briefOf(marketOf(pools, p));
    return { has_data: pools.size > 0, items };
  });
});

/** 還在刊登的同縣市同房型房源 → 行情計算用的列(date = 最後看到的日期) */
async function askingPools(DB: D1Database, p: PropRow) {
  if (!p.kind) return null;
  const { results } = await DB.prepare(
    `SELECT p.id, p.district, p.road, p.kind, p.building_type, p.floor, p.total_floors, p.building_age, p.size_ping, p.rooms, p.has_elevator,
            l.rent, substr(l.last_seen_at, 1, 10) AS date
       FROM properties p
       JOIN listings l ON l.id = (SELECT id FROM listings WHERE property_id = p.id ORDER BY id DESC LIMIT 1)
      WHERE p.city = ? AND p.kind = ? AND p.id <> ? AND l.status = 'active'`,
  )
    .bind(p.city, p.kind, p.id)
    .all<Omit<RentStat, "has_elevator"> & { id: number; has_elevator: number | null }>();
  const rows: RentStat[] = results.map(({ id: _id, ...r }) => ({ ...r, has_elevator: r.has_elevator == null ? null : r.has_elevator === 1 }));
  return { district: rows.filter((r) => r.district === p.district), city: rows };
}

market.get("/api/properties/:id/market", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "bad id" }, 400);
  const p = await c.env.DB.prepare(`${PROP_SQL} WHERE p.id = ?${ownerSql(ownerOf(c), "p")}`).bind(id).first<PropRow>();
  if (!p) return c.json({ error: "not found" }, 404);
  const pools = await loadPools(c.env.DB);
  // 「目前開價」靠共用的房源池,只有私人模式有;公開版行情只看實價登錄
  const ask = isPrivatePool(c.env) ? await askingPools(c.env.DB, p) : null;
  let asking: MarketResponse["asking"] = null;
  if (ask) {
    const t: MarketTarget = { kind: p.kind, size_ping: p.size_ping, rooms: p.rooms, building_age: p.building_age, has_elevator: p.has_elevator == null ? null : p.has_elevator === 1, rent: p.rent };
    const m = computeMarket(t, ask.district, ask.city);
    if (m) {
      const { comparables: _c, ...rest } = m;
      asking = rest;
    }
  }
  const body: MarketResponse = { has_data: pools.size > 0, market: marketOf(pools, p), asking };
  return c.json(body);
});

// ---- 採集機推入 ----

const ItemsBody = z.object({ items: z.array(RentStatIn).min(1).max(2000) });
market.post("/api/ingest/rent-stats", async (c) => {
  const parsed = ItemsBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues.slice(0, 20) }, 400);
  const rows = parsed.data.items.map((x) => ({
    ...x,
    has_elevator: x.has_elevator == null ? null : Number(x.has_elevator),
    furnished: x.furnished == null ? null : Number(x.furnished),
    has_mgmt: x.has_mgmt == null ? null : Number(x.has_mgmt),
    has_parking: Number(x.has_parking),
    social: Number(x.social),
  }));
  // 一個請求一條 SQL(json_each 展開),同 serial 覆蓋
  await c.env.DB.prepare(
    `INSERT INTO rent_stats (serial, city, district, road, kind, building_type, floor, total_floors, building_age, size_ping, rooms, livings, baths,
                             rent, date, has_elevator, furnished, has_mgmt, has_parking, social)
     SELECT j.value ->> 'serial', j.value ->> 'city', j.value ->> 'district', j.value ->> 'road', j.value ->> 'kind', j.value ->> 'building_type',
            j.value ->> 'floor', j.value ->> 'total_floors', j.value ->> 'building_age', j.value ->> 'size_ping', j.value ->> 'rooms',
            j.value ->> 'livings', j.value ->> 'baths', j.value ->> 'rent', j.value ->> 'date', j.value ->> 'has_elevator',
            j.value ->> 'furnished', j.value ->> 'has_mgmt', j.value ->> 'has_parking', j.value ->> 'social'
       FROM json_each(?1) AS j WHERE true
     ON CONFLICT(serial) DO UPDATE SET
       city = excluded.city, district = excluded.district, road = excluded.road, kind = excluded.kind, building_type = excluded.building_type,
       floor = excluded.floor, total_floors = excluded.total_floors, building_age = excluded.building_age, size_ping = excluded.size_ping,
       rooms = excluded.rooms, livings = excluded.livings, baths = excluded.baths, rent = excluded.rent, date = excluded.date,
       has_elevator = excluded.has_elevator, furnished = excluded.furnished, has_mgmt = excluded.has_mgmt,
       has_parking = excluded.has_parking, social = excluded.social`,
  )
    .bind(JSON.stringify(rows))
    .run();
  return c.json({ upserted: rows.length });
});

const PruneBody = z.object({ before: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
market.post("/api/ingest/rent-stats/prune", async (c) => {
  const parsed = PruneBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid" }, 400);
  const r = await c.env.DB.prepare("DELETE FROM rent_stats WHERE date < ?").bind(parsed.data.before).run();
  const left = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM rent_stats").first<{ n: number }>();
  return c.json({ deleted: r.meta.changes ?? 0, total: left?.n ?? 0 });
});
