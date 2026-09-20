import type { PropertyInput, PropertySummary, SessionUser, StageInput } from "@shared/schemas";

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
  return body as T;
}

export const api = {
  me: () => req<{ user: SessionUser | null; enabled: boolean }>("/api/me"),
  logout: () => req<{ ok: true }>("/api/auth/logout", { method: "POST" }),

  listProperties: () => req<{ items: PropertySummary[] }>("/api/properties"),
  createProperty: (input: PropertyInput) => req<{ id: number }>("/api/properties", { method: "POST", body: JSON.stringify(input) }),
  getProperty: (id: number) => req<PropertyDetail>(`/api/properties/${id}`),
  setStage: (id: number, input: StageInput) =>
    req<{ ok: true }>(`/api/properties/${id}/stage`, { method: "PUT", body: JSON.stringify(input) }),
  deleteProperty: (id: number) => req<{ ok: true }>(`/api/properties/${id}`, { method: "DELETE" }),
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
    contactName: string | null;
    contactPhone: string | null;
    contactLine: string | null;
    status: string;
    firstSeenAt: string;
    lastSeenAt: string;
  }[];
  favorite: { stage: string; note: string | null; updatedAt: string } | null;
}
