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
import { nearby } from "./routes/nearby";
import { hazards } from "./routes/hazards";
import { status } from "./routes/status";
import { legal } from "./routes/legal";
import { account } from "./routes/account";
import { sale } from "./routes/sale";
import { area } from "./routes/area";
import { billing } from "./routes/billing";

const app = new Hono<AppEnv>();

// API 不給搜尋引擎收錄(介紹頁才收;robots.txt 也擋了 /api/)
app.use("/api/*", async (c, next) => {
  await next();
  c.header("X-Robots-Tag", "noindex");
});

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
// 買賣行情 /api/market/sale/at;匯入 /api/ingest/sale-stats
app.route("/", sale);
// 公開的各區行情頁 /area/*、/sitemap.xml(不用登入,Worker 直接出 HTML)
app.route("/", area);
// 方案開通 / 取消(bearer INGEST_SECRET)
app.route("/", billing);
// 找房需求(M6 符合度)
app.route("/", requirements);
// 生活機能 /api/nearby*;匯入 /api/ingest/pois*
app.route("/", nearby);
// 災害潛勢 /api/hazards*;匯入 /api/ingest/hazards*
app.route("/", hazards);
// 資料狀態頁 /api/status
app.route("/", status);
// 條款同意 /api/consent
app.route("/", legal);
// 帳號:匯出 / 刪除 /api/account
app.route("/", account);

app.notFound((c) => c.json({ error: "not found" }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "internal error" }, 500);
});

export default app;
