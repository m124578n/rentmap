/**
 * 採集機推入(bearer INGEST_SECRET,不走 session):
 *   POST /api/ingest/listings { items: ImportedListing[] }
 *     → 依 (source, source_listing_id) upsert:已存在就更新 listing 的租金 / 狀態 / last_seen(租金變了寫價格歷史)
 *       並更新 property 欄位;不存在就建 property + listing + 價格歷史。回 { created, updated, ids }
 */
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { ImportedListing } from "@shared/schemas";
import type { AppEnv } from "../env";
import { db, nowIso, schema, type Db } from "../db";
import { requireIngest } from "../auth";

export const ingest = new Hono<AppEnv>();
ingest.use("/api/ingest/*", requireIngest());

const Body = z.object({ items: z.array(ImportedListing).min(1).max(100) });

ingest.post("/api/ingest/listings", async (c) => {
  const parsed = Body.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues.slice(0, 20) }, 400);
  const d = db(c.env.DB);
  let created = 0;
  let updated = 0;
  const ids: number[] = [];
  for (const item of parsed.data.items) {
    const r = await upsertListing(d, item);
    ids.push(r.propertyId);
    if (r.created) created++;
    else updated++;
  }
  return c.json({ created, updated, ids });
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

export async function upsertListing(d: Db, v: ImportedListing): Promise<{ propertyId: number; listingId: number; created: boolean }> {
  const now = nowIso();
  const existing = await d.query.listings.findFirst({
    where: and(eq(schema.listings.source, v.source), eq(schema.listings.sourceListingId, v.source_listing_id)),
  });

  if (existing) {
    await d
      .update(schema.listings)
      .set({
        rent: v.rent,
        depositMonths: v.deposit_months ?? existing.depositMonths,
        rawJson: v.raw_json ?? existing.rawJson,
        photosJson: v.photos.length ? JSON.stringify(v.photos) : existing.photosJson,
        contactName: v.contact_name ?? existing.contactName,
        contactPhone: v.contact_phone ?? existing.contactPhone,
        contactLine: v.contact_line ?? existing.contactLine,
        status: v.status,
        lastSeenAt: now,
        lastCheckedAt: now,
      })
      .where(eq(schema.listings.id, existing.id));
    if (existing.rent !== v.rent) await d.insert(schema.listingPriceHistory).values({ listingId: existing.id, rent: v.rent, seenAt: now });
    // 手動修正過的座標(manual)不被採集覆蓋
    const prop = await d.query.properties.findFirst({ where: eq(schema.properties.id, existing.propertyId) });
    const pv = propertyValues(v);
    if (prop?.geocodeSource === "manual") {
      pv.lat = prop.lat;
      pv.lng = prop.lng;
      pv.geocodeSource = "manual";
    }
    await d.update(schema.properties).set({ ...pv, updatedAt: now }).where(eq(schema.properties.id, existing.propertyId));
    return { propertyId: existing.propertyId, listingId: existing.id, created: false };
  }

  const [prop] = await d
    .insert(schema.properties)
    .values({ ...propertyValues(v), note: null, createdBy: null, createdAt: now, updatedAt: now })
    .returning({ id: schema.properties.id });
  if (!prop) throw new Error("insert property failed");
  const [listing] = await d
    .insert(schema.listings)
    .values({
      propertyId: prop.id,
      source: v.source,
      sourceUrl: v.source_url ?? null,
      sourceListingId: v.source_listing_id,
      rent: v.rent,
      depositMonths: v.deposit_months ?? null,
      rawJson: v.raw_json ?? null,
      photosJson: v.photos.length ? JSON.stringify(v.photos) : null,
      contactName: v.contact_name ?? null,
      contactPhone: v.contact_phone ?? null,
      contactLine: v.contact_line ?? null,
      status: v.status,
      firstSeenAt: now,
      lastSeenAt: now,
      lastCheckedAt: now,
      createdAt: now,
    })
    .returning({ id: schema.listings.id });
  if (!listing) throw new Error("insert listing failed");
  await d.insert(schema.listingPriceHistory).values({ listingId: listing.id, rent: v.rent, seenAt: now });
  return { propertyId: prop.id, listingId: listing.id, created: true };
}
