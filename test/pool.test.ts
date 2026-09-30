import { SELF, createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import app from "../src/worker/index";
import { signSession, SESSION_COOKIE } from "../src/worker/auth";

// 公開模式(PRIVATE_POOL 沒設):每人只看得到自己的房源,不收照片 / 屋況文字 / 聯絡人,沒有房源採集推入。
// vitest 的預設 binding 是私人模式,這裡直接呼叫 app.fetch 換一份 env。
const ORIGIN = "http://localhost:5173";
const PUBLIC_ENV = { ...env, PRIVATE_POOL: undefined };
const cookies: Record<number, string> = {};
let sharedId = 0;

async function pub(path: string, uid: number | null, init: RequestInit = {}) {
  const headers: Record<string, string> = { Origin: ORIGIN, "Content-Type": "application/json", ...((init.headers as Record<string, string>) ?? {}) };
  if (uid != null) headers.Cookie = cookies[uid]!;
  const ctx = createExecutionContext();
  const res = await app.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers }), PUBLIC_ENV, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const create = (uid: number, extra: Record<string, unknown> = {}) =>
  pub("/api/properties", uid, {
    method: "POST",
    body: JSON.stringify({ title: `u${uid} 的房`, city: "台北市", district: "大安區", rent: 20000, kind: "獨立套房", lat: 25.03, lng: 121.54, source: "manual", ...extra }),
  });

beforeAll(async () => {
  const now = new Date().toISOString();
  for (const uid of [1, 2]) {
    await env.DB.prepare("INSERT INTO users (id, provider, provider_id, display_name, created_at, last_login_at) VALUES (?, 'google', ?, ?, ?, ?)")
      .bind(uid, `sub-${uid}`, `U${uid}`, now, now)
      .run();
    cookies[uid] = `${SESSION_COOKIE}=${await signSession({ id: uid, name: `U${uid}`, avatar: null }, "test-secret")}`;
  }
  // 私人模式採集進來的共用房源(created_by 是 NULL),帶照片、屋況、聯絡人
  const p = await env.DB.prepare(
    "INSERT INTO properties (title, city, district, lat, lng, kind, created_at, updated_at) VALUES ('591 抓來的', '台北市', '大安區', 25.03, 121.54, '獨立套房', ?, ?) RETURNING id",
  )
    .bind(now, now)
    .first<{ id: number }>();
  sharedId = p!.id;
  await env.DB.prepare(
    `INSERT INTO listings (property_id, source, source_listing_id, rent, photos_json, raw_json, contact_name, contact_phone, status, first_seen_at, last_seen_at, created_at)
     VALUES (?, '591', 'x1', 18000, '["https://img/1.jpg"]', '{"desc":"屋況"}', '王先生', '0912345678', 'active', ?, ?, ?)`,
  )
    .bind(sharedId, now, now, now)
    .run();
});

describe("公開模式", () => {
  it("/api/me 告訴前端是公開模式", async () => {
    expect(await (await pub("/api/me", 1)).json()).toMatchObject({ private_pool: false });
    expect(await (await SELF.fetch(`${ORIGIN}/api/me`)).json()).toMatchObject({ private_pool: true });
  });

  it("每人只看得到、改得到自己建的房源;共用池看不到", async () => {
    const a = (await (await create(1)).json()) as { id: number };
    const b = (await (await create(2)).json()) as { id: number };
    const list1 = (await (await pub("/api/properties", 1)).json()) as { items: { id: number }[] };
    expect(list1.items.map((x) => x.id)).toEqual([a.id]);
    const list2 = (await (await pub("/api/properties", 2)).json()) as { items: { id: number }[] };
    expect(list2.items.map((x) => x.id)).toEqual([b.id]);

    for (const id of [b.id, sharedId]) {
      expect((await pub(`/api/properties/${id}`, 1)).status).toBe(404);
      expect((await pub(`/api/properties/${id}/favorite`, 1, { method: "PUT", body: JSON.stringify({ stage: "saved" }) })).status).toBe(404);
      expect((await pub(`/api/properties/${id}/market`, 1)).status).toBe(404);
      expect((await pub(`/api/properties/${id}`, 1, { method: "DELETE" })).status).toBe(404);
    }
    // 別人刪不掉,房源還在
    expect((await pub(`/api/properties/${b.id}`, 2)).status).toBe(200);

    // 彙總 API 只算自己的
    const nearby = (await (await pub("/api/nearby/summary", 1)).json()) as { items: Record<string, unknown> };
    expect(Object.keys(nearby.items)).toEqual([String(a.id)]);
    const hz = (await (await pub("/api/hazards/summary", 1)).json()) as { items: Record<string, unknown> };
    expect(Object.keys(hz.items)).toEqual([String(a.id)]);
    const mk = (await (await pub("/api/market", 1)).json()) as { items: Record<string, unknown> };
    expect(Object.keys(mk.items)).toEqual([String(a.id)]);

    // 私人模式照舊看得到全部
    const all = (await (await SELF.fetch(`${ORIGIN}/api/properties`, { headers: { Cookie: cookies[1]! } })).json()) as { items: { id: number }[] };
    expect(all.items.map((x) => x.id).sort()).toEqual([sharedId, a.id, b.id].sort());
  });

  it("不存聯絡人;行情沒有「目前開價」", async () => {
    const { id } = (await (await create(1, { contact_name: "林小姐", contact_phone: "0911222333", contact_line: "https://line.me/x" })).json()) as { id: number };
    const row = await env.DB.prepare("SELECT contact_name, contact_phone, contact_line FROM listings WHERE property_id = ?").bind(id).first();
    expect(row).toEqual({ contact_name: null, contact_phone: null, contact_line: null });
    const m = (await (await pub(`/api/properties/${id}/market`, 1)).json()) as { asking: unknown };
    expect(m.asking).toBeNull();
  });

  it("舊資料裡的照片、屋況、聯絡人不回", async () => {
    // 假設共用池的房源被轉成 user 1 的(例如本機匯出再匯入)
    await env.DB.prepare("UPDATE properties SET created_by = 1 WHERE id = ?").bind(sharedId).run();
    const d = (await (await pub(`/api/properties/${sharedId}`, 1)).json()) as { listings: Record<string, unknown>[] };
    expect(d.listings[0]).toMatchObject({ rent: 18000, photosJson: null, rawJson: null, contactName: null, contactPhone: null });
    await env.DB.prepare("UPDATE properties SET created_by = NULL WHERE id = ?").bind(sharedId).run();
  });

  it("房源採集推入不存在;開放資料匯入照常", async () => {
    const bearer = { Authorization: "Bearer test-ingest" };
    for (const path of ["/api/ingest/listings", "/api/ingest/seen", "/api/ingest/status"])
      expect((await pub(path, null, { method: "POST", headers: bearer, body: "{}" })).status).toBe(404);
    expect((await pub("/api/ingest/active?source=591", null, { headers: bearer })).status).toBe(404);
    // 沒帶 bearer 還是先擋 401
    expect((await pub("/api/ingest/listings", null, { method: "POST", body: "{}" })).status).toBe(401);
    // 開放資料(生活機能)不受影響:格式錯回 400 而不是 404
    expect((await pub("/api/ingest/pois", null, { method: "POST", headers: bearer, body: "{}" })).status).toBe(400);
  });
});
