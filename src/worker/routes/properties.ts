/**
 * 房源 API(需登入):
 *   GET    /api/properties            列表(含目前租金、來源、我的狀態)
 *   POST   /api/properties            手動新增(property + 一筆 listing,並自動收藏成 saved)
 *   GET    /api/properties/:id        詳細(property + listings + favorite)
 *   PUT    /api/properties/:id/stage  改狀態
 *   DELETE /api/properties/:id        刪除(連同 listings、favorite)
 */
import { Hono } from "hono";
import { and, desc, eq, sql } from "drizzle-orm";
import { PropertyInput, StageInput, type PropertySummary } from "@shared/schemas";
import type { AppEnv } from "../env";
import { db, nowIso, schema } from "../db";
import { requireUser } from "../auth";

export const properties = new Hono<AppEnv>();
properties.use("/api/properties", requireUser());
properties.use("/api/properties/*", requireUser());

properties.get("/api/properties", async (c) => {
  const user = c.get("user");
  const d = db(c.env.DB);
  const p = schema.properties;
  const f = schema.favorites;
  // 每個 property 取最新一筆 listing 當代表(Phase 1 一對一,之後去重才會多筆)
  const rows = await d
    .select({
      id: p.id,
      title: p.title,
      city: p.city,
      district: p.district,
      road: p.road,
      lat: p.lat,
      lng: p.lng,
      size_ping: p.sizePing,
      rooms: p.rooms,
      floor: p.floor,
      total_floors: p.totalFloors,
      has_elevator: p.hasElevator,
      mgmt_fee: p.mgmtFee,
      rent: sql<number | null>`(SELECT rent FROM listings WHERE property_id = ${p.id} ORDER BY id DESC LIMIT 1)`,
      source: sql<string | null>`(SELECT source FROM listings WHERE property_id = ${p.id} ORDER BY id DESC LIMIT 1)`,
      source_url: sql<string | null>`(SELECT source_url FROM listings WHERE property_id = ${p.id} ORDER BY id DESC LIMIT 1)`,
      listing_status: sql<string | null>`(SELECT status FROM listings WHERE property_id = ${p.id} ORDER BY id DESC LIMIT 1)`,
      stage: f.stage,
      created_at: p.createdAt,
      updated_at: p.updatedAt,
    })
    .from(p)
    .leftJoin(f, and(eq(f.propertyId, p.id), eq(f.userId, user.id)))
    .orderBy(desc(p.updatedAt));
  return c.json({ items: rows satisfies PropertySummary[] });
});

properties.post("/api/properties", async (c) => {
  const user = c.get("user");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad json" }, 400);
  }
  const parsed = PropertyInput.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
  const v = parsed.data;
  const now = nowIso();
  const d = db(c.env.DB);

  const [prop] = await d
    .insert(schema.properties)
    .values({
      title: v.title,
      city: v.city,
      district: v.district,
      road: v.road ?? null,
      addressText: v.address_text ?? null,
      lat: v.lat ?? null,
      lng: v.lng ?? null,
      geocodeSource: v.lat != null && v.lng != null ? "manual" : null,
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
      note: v.note ?? null,
      createdBy: user.id,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: schema.properties.id });
  if (!prop) return c.json({ error: "insert failed" }, 500);

  const [listing] = await d
    .insert(schema.listings)
    .values({
      propertyId: prop.id,
      source: v.source,
      sourceUrl: v.source_url ?? null,
      sourceListingId: v.source_listing_id ?? null,
      rent: v.rent,
      depositMonths: v.deposit_months ?? null,
      contactName: v.contact_name ?? null,
      contactPhone: v.contact_phone ?? null,
      contactLine: v.contact_line ?? null,
      status: "active",
      firstSeenAt: now,
      lastSeenAt: now,
      createdAt: now,
    })
    .returning({ id: schema.listings.id });
  if (listing) await d.insert(schema.listingPriceHistory).values({ listingId: listing.id, rent: v.rent, seenAt: now });

  await d.insert(schema.favorites).values({ userId: user.id, propertyId: prop.id, stage: "saved", updatedAt: now });
  return c.json({ id: prop.id }, 201);
});

properties.get("/api/properties/:id", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "bad id" }, 400);
  const d = db(c.env.DB);
  const prop = await d.query.properties.findFirst({ where: eq(schema.properties.id, id) });
  if (!prop) return c.json({ error: "not found" }, 404);
  const listings = await d.select().from(schema.listings).where(eq(schema.listings.propertyId, id)).orderBy(desc(schema.listings.id));
  const fav = await d.query.favorites.findFirst({
    where: and(eq(schema.favorites.propertyId, id), eq(schema.favorites.userId, user.id)),
  });
  return c.json({ property: prop, listings, favorite: fav ?? null });
});

properties.put("/api/properties/:id/stage", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "bad id" }, 400);
  const parsed = StageInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
  const now = nowIso();
  await db(c.env.DB)
    .insert(schema.favorites)
    .values({ userId: user.id, propertyId: id, stage: parsed.data.stage, note: parsed.data.note ?? null, updatedAt: now })
    .onConflictDoUpdate({
      target: [schema.favorites.userId, schema.favorites.propertyId],
      set: { stage: parsed.data.stage, updatedAt: now, ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}) },
    });
  return c.json({ ok: true });
});

properties.delete("/api/properties/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "bad id" }, 400);
  await db(c.env.DB).delete(schema.properties).where(eq(schema.properties.id, id));
  return c.json({ ok: true });
});
