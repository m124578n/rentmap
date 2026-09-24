import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { signSession, SESSION_COOKIE } from "../src/worker/auth";
import type { BusRouteDetail, BusRouteIn, BusStopIn, NearbyBusResponse } from "../src/shared/bus";
import type { Place } from "../src/shared/schemas";

const ORIGIN = "http://localhost:5173";
let cookie = "";
const ingestHeaders = { Authorization: "Bearer test-ingest", "Content-Type": "application/json" };
const authed = (init: RequestInit = {}) => ({
  ...init,
  headers: { Cookie: cookie, Origin: ORIGIN, "Content-Type": "application/json", ...(init.headers ?? {}) },
});

// 一條東西向的假路線:lat 25.04,lng 121.500 起每站往東約 200m(0.002 度),共 10 站
const LAT = 25.04;
const lngAt = (i: number) => 121.5 + i * 0.002;
function route(key: string, name: string, direction: number, extra: Partial<BusRouteIn> = {}): BusRouteIn {
  return {
    key,
    route_uid: key.split(":")[0]!,
    name,
    city: "Taipei",
    direction,
    from_name: "起點",
    to_name: "終點",
    stop_count: 10,
    length_m: 2000,
    shape: [
      [lngAt(0), LAT],
      [lngAt(9), LAT],
    ],
    schedule: { wd: { bands: [{ s: "06:00", e: "09:00", min: 5, max: 8 }, { s: "09:00", e: "22:30", min: 10, max: 15 }] } },
    ...extra,
  };
}
function stops(key: string, reverse = false, withTimes = false): BusStopIn[] {
  return Array.from({ length: 10 }, (_, i) => {
    const pos = reverse ? 9 - i : i;
    return {
      route_key: key,
      seq: i + 1,
      stop_uid: `${key}-${i}`,
      station_id: null,
      name: `站${pos}`,
      lat: LAT,
      lng: lngAt(pos),
      dist_m: i * 200,
      t_min: withTimes ? i * 2 : null,
    };
  });
}
async function ingest(path: string, body: unknown) {
  return SELF.fetch(`${ORIGIN}/api/ingest/bus/${path}`, { method: "POST", headers: ingestHeaders, body: JSON.stringify(body) });
}

beforeAll(async () => {
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO users (provider, provider_id, display_name, email, created_at, last_login_at) VALUES ('google','sub-1','Tester','tester@example.com',?,?)",
  )
    .bind(now, now)
    .run();
  cookie = `${SESSION_COOKIE}=${await signSession({ id: 1, name: "Tester", avatar: null }, "test-secret")}`;
});

describe("bus ingest", () => {
  it("rejects without ingest secret", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/ingest/bus/routes`, { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
  });

  it("imports routes + stops and commits", async () => {
    const v = "v1";
    expect((await ingest("routes", { version: v, items: [route("R1:0", "307", 0), route("R1:1", "307", 1), route("R2:0", "紅30", 0)] })).status).toBe(200);
    const res = await ingest("stops", { version: v, items: [...stops("R1:0", false, true), ...stops("R1:1", true), ...stops("R2:0").slice(0, 3)] });
    expect(res.status).toBe(200);
    const commit = await ingest("commit", { version: v });
    expect(commit.status).toBe(200);
  });

  it("commit refuses a much smaller re-import unless forced", async () => {
    await ingest("routes", { version: "v2", items: [route("R9:0", "999", 0)] });
    await ingest("stops", { version: "v2", items: stops("R9:0").slice(0, 2) });
    const res = await ingest("commit", { version: "v2" });
    expect(res.status).toBe(409);
    // 清掉試驗資料,v1 繼續用
    await env.DB.prepare("DELETE FROM bus_route_stops WHERE version = 'v2'").run();
    await env.DB.prepare("DELETE FROM bus_routes WHERE version = 'v2'").run();
  });
});

describe("bus nearby", () => {
  it("requires login", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/bus/nearby?lat=${LAT}&lng=${lngAt(1)}`);
    expect(res.status).toBe(401);
  });

  it("lists routes near a point, both directions grouped, nearest stop each", async () => {
    // 站1 旁邊 30m
    const res = await SELF.fetch(`${ORIGIN}/api/bus/nearby?lat=${LAT + 0.0003}&lng=${lngAt(1)}&radius=300`, authed());
    expect(res.status).toBe(200);
    const body = (await res.json()) as NearbyBusResponse;
    expect(body.has_data).toBe(true);
    expect(body.routes.map((r) => r.name)).toEqual(["307", "紅30"]);
    const r307 = body.routes[0]!;
    expect(r307.dirs.map((d) => d.key)).toEqual(["R1:0", "R1:1"]);
    expect(r307.dirs[0]!.stop.name).toBe("站1");
    expect(r307.dirs[0]!.stop.walk_min).toBeGreaterThanOrEqual(1);
    expect(r307.dirs[0]!.wd).toMatchObject({ first: "06:00", last: "22:30", peak: [5, 8], offpeak: [10, 15] });
    expect(body.commute).toBeNull();
  });

  it("finds direct commute only in the right direction", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/bus/nearby?lat=${LAT}&lng=${lngAt(1)}&radius=300&to_lat=${LAT}&to_lng=${lngAt(8)}&to_radius=300`, authed());
    const body = (await res.json()) as NearbyBusResponse;
    // R1:0 往東,站1 → 站8;R1:1 往西不能到;紅30 只有 3 站到不了
    expect(body.commute?.map((c) => c.key)).toEqual(["R1:0"]);
    const c = body.commute![0]!;
    expect(c.board.name).toBe("站1");
    expect(c.alight.name).toBe("站8");
    expect(c.stops).toBe(7);
    expect(c.ride_exact).toBe(true);
    expect(c.ride_min).toBe(14); // t_min 每站 2 分
    expect(c.wait_min).toBe(3); // 尖峰 5–8 分 → 平均 6.5 → 一半約 3
    expect(c.total_min).toBe(c.board.walk_min + c.wait_min + c.ride_min + c.alight.walk_min);
  });

  it("returns route detail with ordered stops", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/bus/routes/${encodeURIComponent("R1:1")}`, authed());
    expect(res.status).toBe(200);
    const body = (await res.json()) as BusRouteDetail;
    expect(body.route.name).toBe("307");
    expect(body.route.shape).toHaveLength(2);
    expect(body.stops.map((s) => s.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(body.stops[0]!.name).toBe("站9");
  });

  it("404 for unknown route", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/bus/routes/nope`, authed());
    expect(res.status).toBe(404);
  });
});

describe("places", () => {
  it("create, list, delete", async () => {
    const created = await SELF.fetch(`${ORIGIN}/api/places`, authed({ method: "POST", body: JSON.stringify({ name: "公司", lat: 25.05, lng: 121.52 }) }));
    expect(created.status).toBe(201);
    const { place } = (await created.json()) as { place: Place };
    expect(place).toMatchObject({ name: "公司", lat: 25.05 });

    const list = (await (await SELF.fetch(`${ORIGIN}/api/places`, authed())).json()) as { items: Place[] };
    expect(list.items.map((p) => p.name)).toEqual(["公司"]);

    expect((await SELF.fetch(`${ORIGIN}/api/places/${place.id}`, authed({ method: "DELETE" }))).status).toBe(200);
    expect((await SELF.fetch(`${ORIGIN}/api/places/${place.id}`, authed({ method: "DELETE" }))).status).toBe(404);
  });

  it("rejects points outside Taiwan", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/places`, authed({ method: "POST", body: JSON.stringify({ name: "x", lat: 35, lng: 139 }) }));
    expect(res.status).toBe(400);
  });
});
