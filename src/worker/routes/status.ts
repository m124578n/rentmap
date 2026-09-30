/**
 * 資料狀態(需登入):GET /api/status
 * 每份資料的筆數、最後更新(匯入 version 是那次匯入的時間戳;房源看最後一次看到的時間;實價登錄看最新的租賃日),
 * 超過建議間隔就標「要重跑」,附在家要跑的指令。
 */
import { Hono } from "hono";
import { NUISANCE_CATS, POI_CATEGORIES, type PoiCat } from "@shared/poi";
import type { StatusItem, StatusResponse } from "@shared/status";
import mrtTimes from "../../../public/mrt-times.json";
import type { AppEnv } from "../env";
import { requireUser } from "../auth";

export const status = new Hono<AppEnv>();
status.use("/api/status", requireUser());

const DAY = 86400_000;

status.get("/api/status", async (c) => {
  const DB = c.env.DB;
  const now = Date.now();
  const age = (t: string | null) => (t ? Math.floor((now - Date.parse(t.length === 10 ? `${t}T00:00:00Z` : t)) / DAY) : null);
  const item = (x: Omit<StatusItem, "age_days" | "stale">, maxDays: number | null): StatusItem => {
    const a = age(x.updated);
    return { ...x, age_days: a, stale: x.updated == null || x.count === 0 || (maxDays != null && a != null && a > maxDays) };
  };
  const items: StatusItem[] = [];

  // 房源:每個來源最後一次看到、刊登中幾間、近一天新進幾間
  const since = new Date(now - DAY).toISOString();
  const { results: src } = await DB.prepare(
    `SELECT source, COUNT(*) AS n, SUM(status = 'active') AS active, MAX(last_seen_at) AS seen, SUM(first_seen_at >= ?) AS fresh FROM listings GROUP BY source`,
  )
    .bind(since)
    .all<{ source: string; n: number; active: number; seen: string | null; fresh: number }>();
  const SRC: Record<string, { label: string; every: string; max: number | null; command: string }> = {
    "591": { label: "591", every: "每天(排程 20:00 / 21:00)", max: 2, command: "npm run collect -- sync --group=taipei(或 newtaipei)" },
    housefun: { label: "好房", every: "手動", max: null, command: "npm run collect -- sync --group=housefun" },
  };
  for (const s of src) {
    const m = SRC[s.source] ?? { label: s.source, every: "手動", max: null, command: "npm run collect -- add <網址>" };
    items.push(item({ key: `listings:${s.source}`, group: "房源", label: `${m.label} 房源`, count: s.n, updated: s.seen, every: m.every, command: m.command, note: `刊登中 ${s.active} 間 · 近一天新進 ${s.fresh} 間` }, m.max));
  }
  if (!src.some((s) => s.source === "591"))
    items.push(item({ key: "listings:591", group: "房源", label: "591 房源", count: 0, updated: null, every: SRC["591"]!.every, command: SRC["591"]!.command }, 2));

  // 公車、捷運
  const bus = await DB.prepare("SELECT COUNT(*) AS n, MAX(version) AS v FROM bus_routes").first<{ n: number; v: string | null }>();
  items.push(item({ key: "bus", group: "交通", label: "公車路線與班表(TDX)", count: bus?.n ?? 0, updated: bus?.v ?? null, every: "每月", command: "npm run collect -- bus" }, 45));
  items.push(
    item(
      { key: "metro", group: "交通", label: "捷運站間時間(TDX)", count: Object.keys(mrtTimes.edges).length, updated: mrtTimes.updated, every: "路網有變才要", command: "npm run collect -- metro(改完要 commit)" },
      null,
    ),
  );

  // 生活機能(每類一列;YouBike 算交通、嫌惡設施與治安各自分組)
  const { results: pois } = await DB.prepare("SELECT category, COUNT(*) AS n, MAX(version) AS v FROM pois GROUP BY category").all<{ category: PoiCat; n: number; v: string }>();
  const byCat = new Map(pois.map((p) => [p.category, p]));
  for (const cat of Object.keys(POI_CATEGORIES) as PoiCat[]) {
    const p = byCat.get(cat);
    const def = POI_CATEGORIES[cat] as { label: string; crime?: boolean };
    const crime = !!def.crime;
    const group: StatusItem["group"] = crime ? "治安" : cat === "youbike" ? "交通" : "生活機能";
    items.push(
      item(
        {
          key: `pois:${cat}`,
          group,
          label: `${def.label}${NUISANCE_CATS.includes(cat) ? "(嫌惡設施)" : ""}`,
          count: p?.n ?? 0,
          updated: p?.v ?? null,
          every: crime ? "每季" : "每月",
          command: crime ? "npm run collect -- crime" : `npm run collect -- pois --only=${cat}`,
        },
        crime ? 120 : 45,
      ),
    );
  }

  // 實價登錄:看最新的租賃日(內政部每季公布)
  const rs = await DB.prepare("SELECT COUNT(*) AS n, MAX(date) AS d FROM rent_stats").first<{ n: number; d: string | null }>();
  items.push(
    item(
      { key: "rent_stats", group: "行情", label: "租賃實價登錄", count: rs?.n ?? 0, updated: rs?.d ?? null, every: "每季(約 1/4/7/10 月公布)", command: "npm run collect -- rent-stats", note: "日期是資料裡最新的租賃日,本來就會落後 2–4 個月" },
      150,
    ),
  );

  // 災害潛勢:圖資幾年才更新,不標過期
  const { results: hz } = await DB.prepare("SELECT kind, COUNT(*) AS n, MAX(version) AS v FROM hazard_zones GROUP BY kind").all<{ kind: string; n: number; v: string }>();
  const HZ: Record<string, string> = { flood6: "淹水(短時強降雨)", flood24: "淹水(颱風)", liquefaction: "土壤液化(台北市)", airnoise: "航空噪音防制區" };
  for (const [kind, label] of Object.entries(HZ)) {
    const h = hz.find((x) => x.kind === kind);
    items.push(item({ key: `hazard:${kind}`, group: "災害", label, count: h?.n ?? 0, updated: h?.v ?? null, every: "圖資改版才要", command: "python scripts/build_hazards.py && npm run collect -- hazards" }, null));
  }

  const body: StatusResponse = { now: new Date(now).toISOString(), items };
  return c.json(body);
});
