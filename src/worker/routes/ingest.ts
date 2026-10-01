/**
 * 採集機推入(bearer INGEST_SECRET,不走 session):
 *   POST /api/ingest/listings { items: ImportedListing[] }
 *     → 依 (source, source_listing_id) upsert:已存在就更新 listing 的租金 / 狀態 / last_seen(租金變了寫價格歷史)
 *       並更新 property 欄位;不存在就建 property + listing + 價格歷史。回 { created, updated, ids }
 * 只在私人模式(PRIVATE_POOL=1)存在,公開模式一律 404。
 */
import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { ImportedListing } from "@shared/schemas";
import type { AppEnv } from "../env";
import { db, nowIso, schema, type Db } from "../db";
import { parsePostedAt } from "@shared/listing";
import { requireIngest } from "../auth";
import { isPrivatePool } from "../pool";

export const ingest = new Hono<AppEnv>();
ingest.use("/api/ingest/*", requireIngest());
// 房源採集這組只在私人模式存在(公開模式不收抓來的房源;開放資料的匯入 pois / bus / rent-stats / hazards 不受影響)
for (const path of ["/api/ingest/listings", "/api/ingest/active", "/api/ingest/seen", "/api/ingest/status"])
  ingest.use(path, async (c, next) => (isPrivatePool(c.env) ? next() : c.json({ error: "not found" }, 404)));

const Body = z.object({ items: z.array(ImportedListing).min(1).max(100) });

ingest.post("/api/ingest/listings", async (c) => {
  const parsed = Body.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues.slice(0, 20) }, 400);
  const r = await upsertListings(db(c.env.DB), parsed.data.items);
  return c.json(r);
});

/** 採集機每日 sync 用:某來源目前還在刊登中的 listing 清單(重抓偵測下架 / 價格變動) */
ingest.get("/api/ingest/active", async (c) => {
  const source = c.req.query("source") ?? "591";
  const rows = await db(c.env.DB)
    .select({
      source_listing_id: schema.listings.sourceListingId,
      source_url: schema.listings.sourceUrl,
      last_checked_at: schema.listings.lastCheckedAt,
      rent: schema.listings.rent,
    })
    .from(schema.listings)
    .where(and(eq(schema.listings.source, source), eq(schema.listings.status, "active")));
  return c.json({ items: rows });
});

/** 列表上還看得到 → 只更新 last_seen_at(不重抓物件頁),省掉每天幾百次的抓取 */
const SeenBody = z.object({ source: z.string(), ids: z.array(z.string()).min(1).max(1000) });
ingest.post("/api/ingest/seen", async (c) => {
  const parsed = SeenBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid" }, 400);
  // 一條 SQL(json_each 展開 id 清單),不要一個 id 一次往返
  const r = await c.env.DB.prepare(
    "UPDATE listings SET last_seen_at = ?1 WHERE source = ?2 AND source_listing_id IN (SELECT value FROM json_each(?3))",
  )
    .bind(nowIso(), parsed.data.source, JSON.stringify(parsed.data.ids))
    .run();
  return c.json({ updated: r.meta.changes ?? 0 });
});

/** 採集機回報狀態(404 → removed);不帶完整資料 */
const StatusBody = z.object({
  items: z.array(z.object({ source: z.string(), source_listing_id: z.string(), status: z.enum(["active", "removed", "unknown"]) })).min(1).max(500),
});
ingest.post("/api/ingest/status", async (c) => {
  const parsed = StatusBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid" }, 400);
  // 依 (來源, 狀態) 分組,每組一條 SQL,全部一次 batch
  const groups = new Map<string, { source: string; status: string; ids: string[] }>();
  for (const it of parsed.data.items) {
    const k = `${it.source}|${it.status}`;
    const g = groups.get(k) ?? { source: it.source, status: it.status, ids: [] };
    g.ids.push(it.source_listing_id);
    groups.set(k, g);
  }
  const now = nowIso();
  const stmt = c.env.DB.prepare(
    "UPDATE listings SET status = ?1, last_checked_at = ?2 WHERE source = ?3 AND source_listing_id IN (SELECT value FROM json_each(?4))",
  );
  const res = await c.env.DB.batch([...groups.values()].map((g) => stmt.bind(g.status, now, g.source, JSON.stringify(g.ids))));
  return c.json({ updated: res.reduce((n, r) => n + (r.meta.changes ?? 0), 0) });
});

function propertyValues(v: ImportedListing) {
  return {
    title: v.title,
    city: v.city,
    district: v.district,
    road: v.road ?? null,
    addressText: v.address_text ?? null,
    lat: v.lat ?? null,
    lng: v.lng ?? null,
    geocodeSource: v.lat != null && v.lng != null ? "approx" : null, // 591 給的是大概位置
    kind: v.kind ?? null,
    buildingType: v.building_type ?? null,
    floor: v.floor ?? null,
    totalFloors: v.total_floors ?? null,
    buildingAge: v.building_age ?? null,
    sizePing: v.size_ping ?? null,
    rooms: v.rooms ?? null,
    livingRooms: v.living_rooms ?? null,
    bathrooms: v.bathrooms ?? null,
    hasElevator: v.has_elevator ?? null,
    hasParking: v.has_parking ?? null,
    petAllowed: v.pet_allowed ?? null,
    cookingAllowed: v.cooking_allowed ?? null,
    hasWasher: v.has_washer ?? null,
    hasInternet: v.has_internet ?? null,
    mgmtFee: v.mgmt_fee ?? null,
    utilitiesNote: v.utilities_note ?? null,
  };
}

type Stmt = Parameters<Db["batch"]>[0][number];

/**
 * 一批 listing 一起寫:先一條查詢撈出已存在的(依來源分組、走 (source, source_listing_id) 索引),
 * 再把所有寫入放進一個 D1 batch(一個交易、一次往返)。新的用 last_insert_rowid() 串 property → listing → 價格紀錄。
 * 同一批裡同一筆出現兩次只算最後一次。
 */
export async function upsertListings(d: Db, input: ImportedListing[]): Promise<{ created: number; updated: number; ids: number[] }> {
  const now = nowIso();
  const keyOf = (v: { source: string; source_listing_id: string }) => `${v.source}|${v.source_listing_id}`;
  const items = [...new Map(input.map((v) => [keyOf(v), v])).values()];

  const existing = new Map<string, ExistingRow>();
  const bySource = new Map<string, string[]>();
  for (const v of items) bySource.set(v.source, [...(bySource.get(v.source) ?? []), v.source_listing_id]);
  for (const [source, ids] of bySource) {
    const rows = await d.all<ExistingRow>(sql`
      SELECT l.id, l.property_id, l.source, l.source_listing_id, l.rent, l.deposit_months, l.raw_json, l.photos_json,
             l.contact_name, l.contact_phone, l.contact_line, l.posted_at, p.geocode_source, p.lat, p.lng
        FROM listings l JOIN properties p ON p.id = l.property_id
       WHERE l.source = ${source} AND l.source_listing_id IN (SELECT value FROM json_each(${JSON.stringify(ids)}))`);
    for (const r of rows) existing.set(keyOf(r), r);
  }

  const stmts: Stmt[] = [];
  /** 每筆在 batch 結果裡的位置:更新的直接知道 property id;新的要從 insert property 的 returning 拿 */
  const plan: ({ kind: "old"; propertyId: number } | { kind: "new"; at: number })[] = [];
  for (const v of items) {
    const posted = parsePostedAt(v.source_posted_at, new Date(now));
    const ex = existing.get(keyOf(v));
    if (ex) {
      stmts.push(
        d
          .update(schema.listings)
          .set({
            rent: v.rent!,
            depositMonths: v.deposit_months ?? ex.deposit_months,
            rawJson: v.raw_json ?? ex.raw_json,
            photosJson: v.photos.length ? JSON.stringify(v.photos) : ex.photos_json,
            contactName: v.contact_name ?? ex.contact_name,
            contactPhone: v.contact_phone ?? ex.contact_phone,
            contactLine: v.contact_line ?? ex.contact_line,
            status: v.status,
            // 取較早的:重新刊登時 591 的日期會變新,但我們要的是「在市場上多久」
            postedAt: posted && (!ex.posted_at || posted < ex.posted_at) ? posted : ex.posted_at,
            lastSeenAt: now,
            lastCheckedAt: now,
          })
          .where(eq(schema.listings.id, ex.id)),
      );
      if (ex.rent !== v.rent!) stmts.push(d.insert(schema.listingPriceHistory).values({ listingId: ex.id, rent: v.rent!, seenAt: now }));
      // 手動修正過的座標(manual)不被採集覆蓋
      const pv = propertyValues(v);
      if (ex.geocode_source === "manual") {
        pv.lat = ex.lat;
        pv.lng = ex.lng;
        pv.geocodeSource = "manual";
      }
      stmts.push(d.update(schema.properties).set({ ...pv, updatedAt: now }).where(eq(schema.properties.id, ex.property_id)));
      plan.push({ kind: "old", propertyId: ex.property_id });
      continue;
    }
    plan.push({ kind: "new", at: stmts.length });
    stmts.push(
      d
        .insert(schema.properties)
        .values({ ...propertyValues(v), note: null, createdBy: null, createdAt: now, updatedAt: now })
        .returning({ id: schema.properties.id }),
    );
    stmts.push(
      d.insert(schema.listings).values({
        propertyId: sql`last_insert_rowid()`,
        source: v.source,
        sourceUrl: v.source_url ?? null,
        sourceListingId: v.source_listing_id,
        rent: v.rent!,
        depositMonths: v.deposit_months ?? null,
        rawJson: v.raw_json ?? null,
        photosJson: v.photos.length ? JSON.stringify(v.photos) : null,
        contactName: v.contact_name ?? null,
        contactPhone: v.contact_phone ?? null,
        contactLine: v.contact_line ?? null,
        status: v.status,
        postedAt: posted,
        firstSeenAt: now,
        lastSeenAt: now,
        lastCheckedAt: now,
        createdAt: now,
      }),
    );
    stmts.push(d.insert(schema.listingPriceHistory).values({ listingId: sql`last_insert_rowid()`, rent: v.rent!, seenAt: now }));
  }
  const results = stmts.length ? await d.batch(stmts as [Stmt, ...Stmt[]]) : [];
  const ids = plan.map((x) => (x.kind === "old" ? x.propertyId : (results[x.at] as { id: number }[])[0]!.id));
  const created = plan.filter((x) => x.kind === "new").length;
  return { created, updated: plan.length - created, ids };
}

interface ExistingRow {
  id: number;
  property_id: number;
  source: string;
  source_listing_id: string;
  rent: number;
  deposit_months: number | null;
  raw_json: string | null;
  photos_json: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_line: string | null;
  posted_at: string | null;
  geocode_source: string | null;
  lat: number | null;
  lng: number | null;
}
