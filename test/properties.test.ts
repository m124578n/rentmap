import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { signSession, SESSION_COOKIE } from "../src/worker/auth";
import type { PropertySummary } from "../src/shared/schemas";

const ORIGIN = "http://localhost:5173";
let cookie = "";

beforeAll(async () => {
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO users (provider, provider_id, display_name, email, created_at, last_login_at) VALUES ('google','sub-1','Tester','tester@example.com',?,?)",
  )
    .bind(now, now)
    .run();
  cookie = `${SESSION_COOKIE}=${await signSession({ id: 1, name: "Tester", avatar: null }, "test-secret")}`;
});

const authed = (init: RequestInit = {}) => ({
  ...init,
  headers: { Cookie: cookie, Origin: ORIGIN, "Content-Type": "application/json", ...(init.headers ?? {}) },
});

describe("auth", () => {
  it("health is public", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/health`);
    expect(res.status).toBe(200);
  });
  it("/api/me without cookie → user null", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/me`);
    expect(await res.json()).toMatchObject({ user: null });
  });
  it("properties require login", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/properties`);
    expect(res.status).toBe(401);
  });
  it("non-GET without same origin → 403", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/properties`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: "https://evil.example", "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(403);
  });
});

describe("properties", () => {
  it("rejects invalid input", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/properties`, authed({ method: "POST", body: JSON.stringify({ title: "", city: "台北市", district: "板橋區", rent: 0 }) }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { issues: { path: unknown[] }[] };
    const paths = body.issues.map((i) => String(i.path[0]));
    expect(paths).toContain("title");
    expect(paths).toContain("district");
    expect(paths).toContain("rent");
  });

  it("creates, lists, reads, updates stage, deletes", async () => {
    const create = await SELF.fetch(
      `${ORIGIN}/api/properties`,
      authed({
        method: "POST",
        body: JSON.stringify({
          title: "大安兩房",
          city: "台北市",
          district: "大安區",
          rent: "22000",
          size_ping: "14.5",
          rooms: "2",
          has_elevator: true,
          source: "591",
          source_url: "https://rent.591.com.tw/12345",
        }),
      }),
    );
    expect(create.status).toBe(201);
    const { id } = (await create.json()) as { id: number };

    const list = await SELF.fetch(`${ORIGIN}/api/properties`, authed());
    const { items } = (await list.json()) as { items: { id: number; rent: number; stage: string; source: string; has_elevator: boolean }[] };
    const mine = items.find((i) => i.id === id)!;
    expect(mine).toMatchObject({ rent: 22000, stage: "saved", source: "591", has_elevator: true });

    const detail = await SELF.fetch(`${ORIGIN}/api/properties/${id}`, authed());
    const d = (await detail.json()) as { property: { sizePing: number }; listings: { rent: number }[]; favorite: { stage: string } };
    expect(d.property.sizePing).toBe(14.5);
    expect(d.listings[0]?.rent).toBe(22000);
    expect(d.favorite.stage).toBe("saved");

    const stage = await SELF.fetch(`${ORIGIN}/api/properties/${id}/stage`, authed({ method: "PUT", body: JSON.stringify({ stage: "contacted" }) }));
    expect(stage.status).toBe(200);
    const after = (await (await SELF.fetch(`${ORIGIN}/api/properties/${id}`, authed())).json()) as { favorite: { stage: string } };
    expect(after.favorite.stage).toBe("contacted");

    // favorite:部分更新與取消
    const fav = await SELF.fetch(`${ORIGIN}/api/properties/${id}/favorite`, authed({ method: "PUT", body: JSON.stringify({ priority: 3, note: "採光好", tags: ["近捷運"] }) }));
    expect(fav.status).toBe(200);
    const favBody = (await fav.json()) as { favorite: { stage: string; priority: number; note: string; tagsJson: string } };
    expect(favBody.favorite).toMatchObject({ stage: "contacted", priority: 3, note: "採光好", tagsJson: JSON.stringify(["近捷運"]) });
    const listed = (await (await SELF.fetch(`${ORIGIN}/api/properties`, authed())).json()) as { items: { id: number; priority: number; tags: string[]; fav_note: string }[] };
    expect(listed.items.find((i) => i.id === id)).toMatchObject({ priority: 3, tags: ["近捷運"], fav_note: "採光好" });
    const unfav = await SELF.fetch(`${ORIGIN}/api/properties/${id}/favorite`, authed({ method: "DELETE" }));
    expect(unfav.status).toBe(200);
    const noFav = (await (await SELF.fetch(`${ORIGIN}/api/properties/${id}`, authed())).json()) as { favorite: unknown };
    expect(noFav.favorite).toBeNull();

    const del = await SELF.fetch(`${ORIGIN}/api/properties/${id}`, authed({ method: "DELETE" }));
    expect(del.status).toBe(200);
    expect((await SELF.fetch(`${ORIGIN}/api/properties/${id}`, authed())).status).toBe(404);
    // cascade:listing 也要不見
    const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM listings WHERE property_id = ?").bind(id).first<{ n: number }>();
    expect(left?.n).toBe(0);
  });
});

describe("list ETag", () => {
  it("304 when nothing changed; a new favorite changes it", async () => {
    const first = await SELF.fetch(`${ORIGIN}/api/properties`, authed());
    const etag = first.headers.get("etag")!;
    expect(etag).toMatch(/^W\/"[0-9a-f]+"$/);
    const again = await SELF.fetch(`${ORIGIN}/api/properties`, authed({ headers: { "If-None-Match": etag } }));
    expect(again.status).toBe(304);
    const { id } = (await (await SELF.fetch(`${ORIGIN}/api/properties`, authed({ method: "POST", body: JSON.stringify({ title: "etag", city: "台北市", district: "大安區", rent: 10000 }) }))).json()) as { id: number };
    await SELF.fetch(`${ORIGIN}/api/properties/${id}/favorite`, authed({ method: "PUT", body: JSON.stringify({ stage: "saved" }) }));
    const changed = await SELF.fetch(`${ORIGIN}/api/properties`, authed({ headers: { "If-None-Match": etag } }));
    expect(changed.status).toBe(200);
    expect(changed.headers.get("etag")).not.toBe(etag);
  });
});

describe("price history and listing age in API", () => {
  it("list and detail return posted date and price history", async () => {
    const ing = (body: unknown) =>
      SELF.fetch(`${ORIGIN}/api/ingest/listings`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer test-ingest" }, body: JSON.stringify(body) });
    const base = { title: "降價測試", city: "台北市", district: "中山區", source: "591", source_listing_id: "777001", rent: 20000, source_posted_at: "2026/08/01" };
    const { ids } = (await (await ing({ items: [base] })).json()) as { ids: number[] };
    await ing({ items: [{ ...base, rent: 19000 }] });
    await ing({ items: [{ ...base, rent: 19000 }] }); // 沒變價不多記
    const list = (await (await SELF.fetch(`${ORIGIN}/api/properties`, authed())).json()) as { items: PropertySummary[] };
    const p = list.items.find((x) => x.id === ids[0])!;
    expect(p.posted_at).toBe("2026-08-01");
    expect(p.first_seen_at).toBeTruthy();
    expect(p.price_history.map((h) => h.rent)).toEqual([20000, 19000]);
    const detail = (await (await SELF.fetch(`${ORIGIN}/api/properties/${ids[0]}`, authed())).json()) as { price_history: { rent: number }[]; listings: { postedAt: string }[] };
    expect(detail.price_history.map((h) => h.rent)).toEqual([20000, 19000]);
    expect(detail.listings[0]!.postedAt).toBe("2026-08-01");
  });
});
