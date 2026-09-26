/**
 * 我的地點(需登入;公司、爸媽家…,算通勤用):
 *   GET    /api/places
 *   POST   /api/places      { name, address?, lat, lng }
 *   PATCH  /api/places/:id  部分更新(改名、改地址、拖曳微調座標)
 *   DELETE /api/places/:id
 */
import { Hono } from "hono";
import { and, asc, eq } from "drizzle-orm";
import { PlaceInput, PlaceUpdate } from "@shared/schemas";
import type { AppEnv } from "../env";
import { db, nowIso, schema } from "../db";
import { requireUser } from "../auth";

export const places = new Hono<AppEnv>();
places.use("/api/places", requireUser());
places.use("/api/places/*", requireUser());

const cols = { id: schema.myPlaces.id, name: schema.myPlaces.name, address: schema.myPlaces.address, lat: schema.myPlaces.lat, lng: schema.myPlaces.lng };

places.get("/api/places", async (c) => {
  const items = await db(c.env.DB).select(cols).from(schema.myPlaces).where(eq(schema.myPlaces.userId, c.get("user").id)).orderBy(asc(schema.myPlaces.id));
  return c.json({ items });
});

places.post("/api/places", async (c) => {
  const parsed = PlaceInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
  const [row] = await db(c.env.DB)
    .insert(schema.myPlaces)
    .values({ ...parsed.data, address: parsed.data.address ?? null, userId: c.get("user").id, createdAt: nowIso() })
    .returning(cols);
  return c.json({ place: row }, 201);
});

places.patch("/api/places/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const parsed = PlaceUpdate.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
  const v = Object.fromEntries(Object.entries(parsed.data).filter(([, x]) => x !== undefined));
  if (Object.keys(v).length === 0) return c.json({ error: "nothing to update" }, 400);
  const [row] = await db(c.env.DB)
    .update(schema.myPlaces)
    .set(v)
    .where(and(eq(schema.myPlaces.id, id), eq(schema.myPlaces.userId, c.get("user").id)))
    .returning(cols);
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({ place: row });
});

places.delete("/api/places/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const r = await db(c.env.DB)
    .delete(schema.myPlaces)
    .where(and(eq(schema.myPlaces.id, id), eq(schema.myPlaces.userId, c.get("user").id)));
  if (!r.meta.changes) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});
