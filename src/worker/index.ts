import { Hono } from "hono";
import type { AppEnv } from "./env";
import { auth } from "./auth";
import { properties } from "./routes/properties";
import { ingest } from "./routes/ingest";
import { bus } from "./routes/bus";
import { places } from "./routes/places";
import { commute } from "./routes/commute";
import { market } from "./routes/market";
import { requirements } from "./routes/requirements";

const app = new Hono<AppEnv>();

app.get("/api/health", (c) => c.json({ ok: true }));
app.route("/", auth);
app.route("/", properties);
// 採集機推入:POST /api/ingest/listings(bearer INGEST_SECRET)
app.route("/", ingest);
// 公車查詢 /api/bus/*;公車匯入 /api/ingest/bus/*(bearer INGEST_SECRET)
app.route("/", bus);
app.route("/", places);
// 所有房源 × 我的地點 的公車通勤
app.route("/", commute);
// 租金行情(實價登錄)/api/market、/api/properties/:id/market;匯入 /api/ingest/rent-stats
app.route("/", market);
// 找房需求(M6 符合度)
app.route("/", requirements);

app.notFound((c) => c.json({ error: "not found" }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "internal error" }, 500);
});

export default app;
