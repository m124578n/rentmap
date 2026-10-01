import type { FavoriteInput, Place, PlaceInput, PlaceUpdate, PropertyInput, PropertySummary, SessionUser, StageInput } from "@shared/schemas";
import type { AlongResponse, BusRouteDetail, NearbyBusResponse } from "@shared/bus";
import type { MarketMatrix, MarketResponse } from "@shared/market";
import type { Requirements } from "@shared/fit";
import type { StatusResponse } from "@shared/status";
import { decodeNearbySummary, type GarbageFit, type NearbyResponse, type NearbySummary, type NearbySummaryWire } from "@shared/poi";
import type { HazardKind, HazardResponse, HazardSummary, HazardZones } from "@shared/hazard";
import { whenParams, type CommuteGrid, type CommuteMatrix, type CommuteWhen, type TourResponse, type TripsResponse } from "@shared/trip";
import type { ConsentNeed } from "@shared/legal";

/** 地圖畫面範圍(度) */
export interface Bbox {
  w: number;
  s: number;
  e: number;
  n: number;
}
const bboxParams = (b: Bbox) => `w=${b.w}&s=${b.s}&e=${b.e}&n=${b.n}`;

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`API ${status}`);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body);
  // Service Worker 在網路太慢 / 斷線時會回上次的快取(public/sw.js),通知畫面顯示「離線中」
  if (res.headers.get("x-sw-cache")) window.dispatchEvent(new Event(STALE_EVENT));
  else if (staleShown) window.dispatchEvent(new Event(FRESH_EVENT));
  return body as T;
}

export const STALE_EVENT = "rentmap:stale";
export const FRESH_EVENT = "rentmap:fresh";
let staleShown = false;
window.addEventListener(STALE_EVENT, () => (staleShown = true));
window.addEventListener(FRESH_EVENT, () => (staleShown = false));

export const api = {
  me: () => req<{ user: SessionUser | null; enabled: boolean; dev: boolean; private_pool: boolean; consent_needed: ConsentNeed[] }>("/api/me"),
  deleteAccount: () => req<{ ok: true }>("/api/account", { method: "DELETE", body: JSON.stringify({ confirm: "刪除" }) }),
  consent: (docs: { doc: string; version: string }[]) => req<{ consent_needed: ConsentNeed[] }>("/api/consent", { method: "POST", body: JSON.stringify({ docs }) }),
  logout: () => req<{ ok: true }>("/api/auth/logout", { method: "POST" }),

  listProperties: () => req<{ items: PropertySummary[] }>("/api/properties"),
  createProperty: (input: PropertyInput) => req<{ id: number }>("/api/properties", { method: "POST", body: JSON.stringify(input) }),
  getProperty: (id: number) => req<PropertyDetail>(`/api/properties/${id}`),
  setStage: (id: number, input: StageInput) =>
    req<{ ok: true }>(`/api/properties/${id}/stage`, { method: "PUT", body: JSON.stringify(input) }),
  setFavorite: (id: number, input: FavoriteInput) =>
    req<{ favorite: Favorite }>(`/api/properties/${id}/favorite`, { method: "PUT", body: JSON.stringify(input) }),
  removeFavorite: (id: number) => req<{ ok: true }>(`/api/properties/${id}/favorite`, { method: "DELETE" }),
  deleteProperty: (id: number) => req<{ ok: true }>(`/api/properties/${id}`, { method: "DELETE" }),

  busNearby: (q: { lat: number; lng: number; radius: number }) => req<NearbyBusResponse>(`/api/bus/nearby?lat=${q.lat}&lng=${q.lng}&radius=${q.radius}`),
  busRoute: (key: string) => req<BusRouteDetail>(`/api/bus/routes/${encodeURIComponent(key)}`),
  busNames: (region = "north") => req<{ bus: string[]; mrt: string[] }>(`/api/bus/names?region=${region}`),
  busAlong: (names: string[], region = "north", radius = 400) =>
    req<AlongResponse>(`/api/bus/along?names=${encodeURIComponent(names.join(","))}&region=${region}&radius=${radius}`),

  commute: (when: CommuteWhen, bike = true, region = "north", radius = 400) =>
    req<CommuteMatrix>(`/api/commute?radius=${radius}&region=${region}&${whenParams(when)}${bike ? "" : "&bike=0"}`),
  commuteTrips: (q: { lat: number; lng: number; placeId: number; radius: number; when: CommuteWhen; bike: boolean }) =>
    req<TripsResponse>(`/api/commute/trips?lat=${q.lat}&lng=${q.lng}&place_id=${q.placeId}&radius=${q.radius}&${whenParams(q.when)}${q.bike ? "" : "&bike=0"}`),

  market: () => req<MarketMatrix>("/api/market"),
  propertyMarket: (id: number) => req<MarketResponse>(`/api/properties/${id}/market`),
  /** 任一地址的行情(還沒存成房源) */
  marketAt: (q: { city: string; district: string; kind: string; size_ping?: number; rent?: number }) =>
    req<MarketResponse>(`/api/market/at?${new URLSearchParams(Object.entries(q).flatMap(([k, v]) => (v == null ? [] : [[k, String(v)]])))}`),

  getRequirements: () => req<{ requirements: Requirements }>("/api/requirements"),
  putRequirements: (r: Requirements) => req<{ requirements: Requirements }>("/api/requirements", { method: "PUT", body: JSON.stringify(r) }),

  nearby: (q: { lat: number; lng: number; radius: number }) => req<NearbyResponse>(`/api/nearby?lat=${q.lat}&lng=${q.lng}&radius=${q.radius}`),
  garbageFit: (maxM: number, after: string) => req<GarbageFit>(`/api/garbage/fit?max=${maxM}&after=${encodeURIComponent(after)}`),
  hazards: (lat: number, lng: number, city: string) => req<HazardResponse>(`/api/hazards?lat=${lat}&lng=${lng}&city=${encodeURIComponent(city)}`),
  hazardSummary: () => req<HazardSummary>("/api/hazards/summary"),
  hazardZones: (kind: HazardKind, b: Bbox) => req<HazardZones>(`/api/hazards/zones?kind=${kind}&${bboxParams(b)}`),
  tour: (body: { points: { lat: number; lng: number; name: string }[]; start: { lat: number; lng: number; name: string } | null; day: string; time: string }) =>
    req<TourResponse>("/api/tour", { method: "POST", body: JSON.stringify(body) }),
  status: (region = "north") => req<StatusResponse>(`/api/status?region=${region}`),
  commuteGrid: (b: Bbox, when: CommuteWhen, bike: boolean) => req<CommuteGrid>(`/api/commute/grid?${bboxParams(b)}&${whenParams(when)}${bike ? "" : "&bike=0"}`),
  nearbySummary: async (radius = 500): Promise<NearbySummary> => decodeNearbySummary(await req<NearbySummaryWire>(`/api/nearby/summary?radius=${radius}`)),

  listPlaces: () => req<{ items: Place[] }>("/api/places"),
  createPlace: (input: PlaceInput) => req<{ place: Place }>("/api/places", { method: "POST", body: JSON.stringify(input) }),
  updatePlace: (id: number, input: PlaceUpdate) => req<{ place: Place }>(`/api/places/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  deletePlace: (id: number) => req<{ ok: true }>(`/api/places/${id}`, { method: "DELETE" }),
};

/** 詳細頁回傳。欄位對應 worker/db/schema.ts 的 camelCase。 */
export interface PropertyDetail {
  property: {
    id: number;
    title: string;
    city: string;
    district: string;
    road: string | null;
    addressText: string | null;
    lat: number | null;
    lng: number | null;
    buildingType: string | null;
    kind: string | null;
    floor: number | null;
    totalFloors: number | null;
    buildingAge: number | null;
    sizePing: number | null;
    rooms: number | null;
    livingRooms: number | null;
    bathrooms: number | null;
    hasElevator: boolean | null;
    hasParking: boolean | null;
    petAllowed: boolean | null;
    cookingAllowed: boolean | null;
    hasWasher: boolean | null;
    hasInternet: boolean | null;
    mgmtFee: number | null;
    utilitiesNote: string | null;
    note: string | null;
    createdAt: string;
    updatedAt: string;
  };
  listings: {
    id: number;
    source: string;
    sourceUrl: string | null;
    rent: number;
    depositMonths: number | null;
    photosJson: string | null;
    rawJson: string | null;
    contactName: string | null;
    contactPhone: string | null;
    contactLine: string | null;
    status: string;
    postedAt: string | null;
    firstSeenAt: string;
    lastSeenAt: string;
  }[];
  favorite: Favorite | null;
  price_history: { rent: number; at: string }[];
}

export interface Favorite {
  stage: string;
  priority: number | null;
  note: string | null;
  tagsJson: string | null;
  updatedAt: string;
}
