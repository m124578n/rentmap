import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { signSession, SESSION_COOKIE } from "../src/worker/auth";
import { encodeRoads, NO_SCOOTER, ROAD_CLASSES } from "../src/shared/roads";
import type { DriveAtResponse, DriveMatrix } from "../src/shared/trip";

// 道路圖匯入(分段、段數齊才換版)與機車 / 開車通勤 API
const ORIGIN = "http://localhost:5173";
let cookie = "";
const authed = (init: RequestInit = {}) => ({ ...init, headers: { Cookie: cookie, Origin: ORIGIN, "Content-Type": "application/json" } });
const ingest = (path: string, body: unknown) =>
  SELF.fetch(`${ORIGIN}/api/ingest/${path}`, { method: "POST", headers: { Authorization: "Bearer test-ingest", "Content-Type": "application/json" }, body: JSON.stringify(body) });
const get = async <T>(path: string) => {
  const r = await SELF.fetch(`${ORIGIN}${path}`, authed());
  return { status: r.status, body: (await r.json()) as T };
};
const C = (name: (typeof ROAD_CLASSES)[number]) => ROAD_CLASSES.indexOf(name);

// 台中一段小路網:住處(0)──primary 2km── 1 ──primary 2km── 公司(2);0 → 2 另有一條只能開車的快速道路 3km
const HOME = { lat: 24.16, lng: 120.62 };
const WORK = { lat: 24.16, lng: 120.66 };
const graph = encodeRoads(
  [
    [HOME.lat, HOME.lng],
    [24.16, 120.64],
    [WORK.lat, WORK.lng],
  ],
  [
    [0, 1, 2000, C("primary")],
    [1, 0, 2000, C("primary")],
    [1, 2, 2000, C("primary")],
    [2, 1, 2000, C("primary")],
    [0, 2, 3000, C("trunk") | NO_SCOOTER],
    [2, 0, 3000, C("trunk") | NO_SCOOTER],
  ],
);
const b64 = btoa(String.fromCharCode(...graph));
const half = Math.ceil(b64.length / 2 / 4) * 4;

let propId = 0;
beforeAll(async () => {
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO users (provider, provider_id, display_name, created_at, last_login_at) VALUES ('google','sub-1','T',?,?)").bind(now, now).run();
  cookie = `${SESSION_COOKIE}=${await signSession({ id: 1, name: "T", avatar: null }, "test-secret")}`;
  await SELF.fetch(`${ORIGIN}/api/places`, authed({ method: "POST", body: JSON.stringify({ name: "公司", ...WORK }) }));
  const r = await SELF.fetch(`${ORIGIN}/api/properties`, authed({ method: "POST", body: JSON.stringify({ title: "台中套房", city: "台中市", district: "西屯區", rent: 9000, ...HOME }) }));
  propId = ((await r.json()) as { id: number }).id;
});

describe("道路圖匯入", () => {
  it("段數不齊不換版;齊了才換,舊版刪掉", async () => {
    const before = await get<DriveMatrix>("/api/commute/drive?mode=scooter&region=taichung");
    expect(before.body.has_roads).toBe(false);

    expect((await ingest("roads", { region: "taichung", version: "v1", chunk: 0, total: 2, data: b64.slice(0, half) })).status).toBe(200);
    expect((await ingest("roads/commit", { region: "taichung", version: "v1" })).status).toBe(409);
    expect((await ingest("roads", { region: "taichung", version: "v1", chunk: 1, total: 2, data: b64.slice(half) })).status).toBe(200);
    expect((await ingest("roads/commit", { region: "taichung", version: "v1" })).status).toBe(200);
    // 壞資料擋掉
    expect((await ingest("roads", { region: "taichung", version: "v2", chunk: 0, total: 1, data: "not base64!" })).status).toBe(400);
    // 沒帶金鑰
    const r = await SELF.fetch(`${ORIGIN}/api/ingest/roads/commit`, { method: "POST", body: "{}" });
    expect(r.status).toBe(401);
  });
});

describe("機車 / 開車通勤", () => {
  it("矩陣:機車繞平面道路、開車走快速道路;含牽車 / 停車時間", async () => {
    const s = await get<DriveMatrix>("/api/commute/drive?mode=scooter&region=taichung");
    const c = await get<DriveMatrix>("/api/commute/drive?mode=car&region=taichung");
    expect(s.body.has_roads).toBe(true);
    const placeId = Object.keys(s.body.items[propId]!)[0]!;
    const sb = s.body.items[propId]![placeId]!;
    const cb = c.body.items[propId]![placeId]!;
    expect(sb).toMatchObject({ kind: "scooter", km: 4 });
    expect(cb).toMatchObject({ kind: "car", km: 3 });
    // 平日 08:00 是尖峰:台中機車 4km primary(36 km/h × 34/28)約 8 分 + 牽車 4 分
    expect(sb.total_min).toBeGreaterThanOrEqual(11);
    expect(sb.total_min).toBeLessThanOrEqual(14);
  });

  it("單點:面板查一個地址,機車與開車都有", async () => {
    const r = await get<DriveAtResponse>(`/api/commute/drive/at?lat=${HOME.lat}&lng=${HOME.lng}`);
    expect(r.status).toBe(200);
    const it0 = Object.values(r.body.items)[0]!;
    expect(it0.scooter?.km).toBe(4);
    expect(it0.car?.km).toBe(3);
  });

  it("其他生活圈沒有道路圖:has_roads false(前端改用距離估)", async () => {
    const r = await get<DriveAtResponse>("/api/commute/drive/at?lat=25.04&lng=121.5");
    expect(r.body.has_roads).toBe(false);
  });

  it("參數:mode 錯 400;下班方向也算得出來(免費版擋時段在 plan.test.ts)", async () => {
    expect((await get("/api/commute/drive?mode=bike")).status).toBe(400);
    const back = await get<DriveMatrix>("/api/commute/drive?mode=scooter&region=taichung&day=wd&time=18:00&dir=from");
    expect(back.status).toBe(200);
    expect(Object.values(back.body.items[propId]!)[0]).toMatchObject({ km: 4 });
  });
});
