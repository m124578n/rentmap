/**
 * D1 schema(Drizzle)。改這裡後 `npm run db:generate` 產 migration,再 `npm run db:migrate:local` 套到本地。
 * 凡是「人的資料」都帶 user_id;Phase 1 只有一個帳號,但一開始就多人。
 */
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
    kind: text("kind"), // 整層住家 | 獨立套房 | 分租套房 | 雅房 | 其他
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
    photosJson: text("photos_json"), // 來源的照片 URL 陣列(JSON)。只存連結不下載;整個系統不存任何檔案(決定:2026-09-22)
    contactName: text("contact_name"),
    contactPhone: text("contact_phone"),
    contactLine: text("contact_line"),
    status: text("status").notNull().default("active"), // active | removed | unknown
    postedAt: text("posted_at"), // 來源寫的刊登日 YYYY-MM-DD(591 有,好房沒有);沒有就看 first_seen_at
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

/**
 * 公車路線方向(TDX 雙北市區公車,採集機 `collect bus` 覆蓋式匯入;version 是那次匯入的時間戳,commit 時刪掉舊版)。
 * key = `{SubRouteUID 或 RouteUID}:{Direction}`
 */
export const busRoutes = sqliteTable("bus_routes", {
  key: text("key").primaryKey(),
  routeUid: text("route_uid").notNull(),
  name: text("name").notNull(), // 主路線名(307、紅5),同名視為同一路
  variant: text("variant"), // 子路線說明(莒光、經天母國中、區間…);主線為 null
  city: text("city").notNull(),
  direction: integer("direction").notNull(),
  fromName: text("from_name"),
  toName: text("to_name"),
  stopCount: integer("stop_count").notNull(),
  lengthM: integer("length_m").notNull(),
  shapeJson: text("shape_json").notNull(), // [[lng,lat],…] 已簡化
  scheduleJson: text("schedule_json"), // shared/bus.ts Schedule
  version: text("version").notNull(),
});

/** 路線方向上的每一站(站牌 × 路線 × 方向);附近查詢走 (lat, lng) 索引 */
export const busRouteStops = sqliteTable(
  "bus_route_stops",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    routeKey: text("route_key").notNull(),
    seq: integer("seq").notNull(),
    stopUid: text("stop_uid").notNull(),
    stationId: text("station_id"),
    name: text("name").notNull(),
    lat: real("lat").notNull(),
    lng: real("lng").notNull(),
    distM: integer("dist_m").notNull(),
    tMin: integer("t_min"),
    version: text("version").notNull(),
  },
  (t) => [uniqueIndex("brs_route_seq_uq").on(t.routeKey, t.seq), index("brs_latlng_idx").on(t.lat, t.lng)],
);

/** 我的地點(公司、爸媽家…),用來算通勤 */
export const myPlaces = sqliteTable(
  "my_places",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    address: text("address"), // 使用者輸入的地址(顯示用;座標以 lat/lng 為準,可能拖曳微調過)
    lat: real("lat").notNull(),
    lng: real("lng").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("my_places_user_idx").on(t.userId)],
);

/** 找房需求(M6 符合度;一人一份,整份 JSON 見 src/shared/fit.ts 的 Requirements) */
export const userRequirements = sqliteTable("user_requirements", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  json: text("json").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * 內政部租賃實價登錄(雙北,參考資料)。採集機 `collect -- rent-stats` 匯入,serial = 實價登錄編號(重匯同一筆覆蓋)。
 * 行情計算見 src/shared/market.ts;social(社宅包租代管)與 has_parking(含車位)預設不列入。
 */
export const rentStats = sqliteTable(
  "rent_stats",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    serial: text("serial").notNull(),
    city: text("city").notNull(), // 台北市 | 新北市
    district: text("district").notNull(),
    road: text("road"),
    kind: text("kind"), // 整層住家 | 獨立套房 | 分租套房 | 雅房 | null
    buildingType: text("building_type"),
    floor: integer("floor"),
    totalFloors: integer("total_floors"),
    buildingAge: integer("building_age"),
    sizePing: real("size_ping"),
    rooms: integer("rooms"),
    livings: integer("livings"),
    baths: integer("baths"),
    rent: integer("rent").notNull(),
    date: text("date").notNull(), // 租賃日 YYYY-MM-DD
    hasElevator: integer("has_elevator", { mode: "boolean" }),
    furnished: integer("furnished", { mode: "boolean" }),
    hasMgmt: integer("has_mgmt", { mode: "boolean" }),
    hasParking: integer("has_parking", { mode: "boolean" }).notNull(),
    social: integer("social", { mode: "boolean" }).notNull(),
  },
  (t) => [uniqueIndex("rent_stats_serial_idx").on(t.serial), index("rent_stats_area_idx").on(t.city, t.district, t.kind), index("rent_stats_date_idx").on(t.date)],
);

/**
 * 生活機能(OSM + menmap 拉麵)。採集機 `collect -- pois` 每類覆蓋式匯入(version 不同的舊列在 commit 時刪掉)。
 * 同一個 OSM 地點可能屬於兩類,所以主鍵是 (category, key)。
 */
export const pois = sqliteTable(
  "pois",
  {
    category: text("category").notNull(),
    key: text("key").notNull(), // OSM n123 / w456 / r789;menmap m{ftid}
    subtype: text("subtype"),
    name: text("name"),
    lat: real("lat").notNull(),
    lng: real("lng").notNull(),
    rating: real("rating"),
    url: text("url"),
    note: text("note"), // 垃圾車:「19:30–19:40 · 一二四五六」
    minute: integer("minute"), // 垃圾車抵達時間(一天第幾分鐘)
    days: integer("days"), // 垃圾車收一般垃圾的星期(bit0 = 週日)
    version: text("version").notNull(),
  },
  (t) => [primaryKey({ columns: [t.category, t.key] }), index("pois_latlng_idx").on(t.lat, t.lng)],
);

/**
 * 災害潛勢多邊形(淹水、土壤液化)。`collect -- hazards` 整批覆蓋式匯入;查詢時整份進記憶體依外框索引。
 */
export const hazardZones = sqliteTable(
  "hazard_zones",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind").notNull(), // flood6 | flood24 | liquefaction
    level: integer("level").notNull(),
    city: text("city").notNull(),
    minLat: real("min_lat").notNull(),
    minLng: real("min_lng").notNull(),
    maxLat: real("max_lat").notNull(),
    maxLng: real("max_lng").notNull(),
    rings: text("rings").notNull(), // JSON [[[lng, lat], …], …]
    version: text("version").notNull(),
  },
  (t) => [index("hazard_zones_kind_idx").on(t.kind)],
);
