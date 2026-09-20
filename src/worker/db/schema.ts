/**
 * D1 schema(Drizzle)。改這裡後 `npm run db:generate` 產 migration,再 `npm run db:migrate:local` 套到本地。
 * 凡是「人的資料」都帶 user_id;Phase 1 只有一個帳號,但一開始就多人。
 */
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    provider: text("provider").notNull(), // 'google'
    providerId: text("provider_id").notNull(), // Google sub
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    email: text("email"), // Google 驗證過的;只用於白名單與聯絡,不公開
    createdAt: text("created_at").notNull(),
    lastLoginAt: text("last_login_at").notNull(),
  },
  (t) => [uniqueIndex("users_provider_uq").on(t.provider, t.providerId)],
);

/** 實體物件。多個來源的刊登(listings)掛在同一個 property 下;Phase 1 一對一,去重留 Phase 3。 */
export const properties = sqliteTable(
  "properties",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    title: text("title").notNull(),
    city: text("city").notNull(),
    district: text("district").notNull(),
    road: text("road"),
    addressText: text("address_text"),
    lat: real("lat"),
    lng: real("lng"),
    geocodeSource: text("geocode_source"), // approx | manual | exact | null
    buildingType: text("building_type"),
    floor: integer("floor"),
    totalFloors: integer("total_floors"),
    buildingAge: integer("building_age"),
    sizePing: real("size_ping"),
    rooms: integer("rooms"),
    livingRooms: integer("living_rooms"),
    bathrooms: integer("bathrooms"),
    hasElevator: integer("has_elevator", { mode: "boolean" }),
    hasParking: integer("has_parking", { mode: "boolean" }),
    petAllowed: integer("pet_allowed", { mode: "boolean" }),
    cookingAllowed: integer("cooking_allowed", { mode: "boolean" }),
    hasWasher: integer("has_washer", { mode: "boolean" }),
    hasInternet: integer("has_internet", { mode: "boolean" }),
    furnitureJson: text("furniture_json"),
    mgmtFee: integer("mgmt_fee"),
    utilitiesNote: text("utilities_note"),
    nearestMrtId: text("nearest_mrt_id"),
    mrtWalkMin: integer("mrt_walk_min"),
    note: text("note"),
    createdBy: integer("created_by").references(() => users.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("properties_city_district_idx").on(t.city, t.district), index("properties_latlng_idx").on(t.lat, t.lng)],
);

/** 某個來源上的一則刊登 */
export const listings = sqliteTable(
  "listings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    propertyId: integer("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    source: text("source").notNull(), // 591 | rakuya | hb | fb | agent | manual
    sourceUrl: text("source_url"),
    sourceListingId: text("source_listing_id"),
    rent: integer("rent").notNull(),
    depositMonths: real("deposit_months"),
    rawJson: text("raw_json"),
    contactName: text("contact_name"),
    contactPhone: text("contact_phone"),
    contactLine: text("contact_line"),
    status: text("status").notNull().default("active"), // active | removed | unknown
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    lastCheckedAt: text("last_checked_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("listings_property_idx").on(t.propertyId),
    uniqueIndex("listings_source_uq").on(t.source, t.sourceListingId),
  ],
);

export const listingPriceHistory = sqliteTable(
  "listing_price_history",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    listingId: integer("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    rent: integer("rent").notNull(),
    seenAt: text("seen_at").notNull(),
  },
  (t) => [index("lph_listing_idx").on(t.listingId)],
);

/** 找房 CRM:每個使用者對每個物件的狀態 */
export const favorites = sqliteTable(
  "favorites",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    propertyId: integer("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    stage: text("stage").notNull().default("saved"),
    tagsJson: text("tags_json"),
    priority: integer("priority"),
    note: text("note"),
    rank: integer("rank"),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("favorites_uq").on(t.userId, t.propertyId)],
);

/** 貼 URL 佇列:網頁寫入,採集機領取 */
export const pendingUrls = sqliteTable(
  "pending_urls",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    source: text("source"),
    status: text("status").notNull().default("pending"), // pending | fetching | done | failed
    error: text("error"),
    propertyId: integer("property_id").references(() => properties.id, { onDelete: "set null" }),
    requestedAt: text("requested_at").notNull(),
    doneAt: text("done_at"),
  },
  (t) => [index("pending_urls_status_idx").on(t.status)],
);
