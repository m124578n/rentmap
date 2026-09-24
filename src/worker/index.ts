import { Hono } from "hono";
import type { AppEnv } from "./env";
import { auth } from "./auth";
import { properties } from "./routes/properties";
import { ingest } from "./routes/ingest";
import { bus } from "./routes/bus";
import { places } from "./routes/places";

const app = new Hono<AppEnv>();

app.get("/api/health", (c) => c.json({ ok: true }));
app.route("/", auth);
app.route("/", properties);
// 採集機推入:POST /api/ingest/listings(bearer INGEST_SECRET)
app.route("/", ingest);
// 公車查詢 /api/bus/*;公車匯入 /api/ingest/bus/*(bearer INGEST_SECRET)
app.route("/", bus);
app.route("/", places);

app.notFound((c) => c.json({ error: "not found" }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "internal error" }, 500);
});

export default app;
