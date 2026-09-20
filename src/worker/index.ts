import { Hono } from "hono";
import type { AppEnv } from "./env";
import { auth } from "./auth";
import { properties } from "./routes/properties";

const app = new Hono<AppEnv>();

app.get("/api/health", (c) => c.json({ ok: true }));
app.route("/", auth);
app.route("/", properties);

app.notFound((c) => c.json({ error: "not found" }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "internal error" }, 500);
});

export default app;
