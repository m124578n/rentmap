/**
 * `npm run collect -- bus [--dry] [--cities=Taipei,NewTaipei] [--refresh] [--force]`
 *
 * 從交通部 TDX 下載雙北市區公車(Route / StopOfRoute / Shape / Schedule)→ transform → 覆蓋式推到 /api/ingest/bus/*。
 * 原始 JSON 快取在 data/tdx/{city}-{dataset}.json(7 天內重跑不重抓;--refresh 強制重抓),一個月跑一次就夠。
 *
 * 金鑰:.env 的 TDX_CLIENT_ID / TDX_CLIENT_SECRET(https://tdx.transportdata.tw 會員中心 → API 金鑰)。
 * 沒填也能跑(匿名額度很小,一天幾十次;這支一次約 8 次請求)。
 */
import fs from "node:fs";
import path from "node:path";
import type { BusRouteIn, BusStopIn } from "../../src/shared/bus";
import { transformCity, type TdxCity } from "./transform";

const ROOT = path.resolve(import.meta.dirname, "../..");
const CACHE_DIR = path.join(ROOT, "data", "tdx");
const TOKEN_URL = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";
const API_BASE = "https://tdx.transportdata.tw/api/basic/v2/Bus";
const CACHE_DAYS = 7;

const DATASETS = { routes: "Route", stopOfRoute: "StopOfRoute", shapes: "Shape", schedules: "Schedule" } as const;

let token: string | null = null;
async function getToken(): Promise<string | null> {
  if (token) return token;
  const id = process.env.TDX_CLIENT_ID;
  const secret = process.env.TDX_CLIENT_SECRET;
  if (!id || !secret) return null;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret }),
  });
  if (!res.ok) throw new Error(`TDX token ${res.status}: ${await res.text()}`);
  token = ((await res.json()) as { access_token: string }).access_token;
  return token;
}

async function tdxGet(dataset: string, city: string): Promise<unknown[]> {
  const url = `${API_BASE}/${dataset}/City/${city}?%24format=JSON`;
  for (let i = 0; i < 4; i++) {
    const t = await getToken();
    const res = await fetch(url, { headers: { Accept: "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) }, signal: AbortSignal.timeout(300_000) });
    if (res.status === 429 || res.status >= 500) {
      console.log(`  ${dataset}/${city} HTTP ${res.status},${5 * (i + 1)} 秒後重試`);
      await new Promise((r) => setTimeout(r, 5000 * (i + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`TDX ${dataset}/${city} ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = await res.json();
    if (!Array.isArray(body)) throw new Error(`TDX ${dataset}/${city} 回傳不是陣列`);
    return body;
  }
  throw new Error(`TDX ${dataset}/${city} 重試仍失敗`);
}

async function loadCity(city: string, refresh: boolean): Promise<TdxCity> {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const out: Record<string, unknown[]> = {};
  for (const [k, dataset] of Object.entries(DATASETS)) {
    const file = path.join(CACHE_DIR, `${city}-${dataset}.json`);
    const fresh = fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < CACHE_DAYS * 86400_000;
    if (fresh && !refresh) {
      out[k] = JSON.parse(fs.readFileSync(file, "utf8")) as unknown[];
      console.log(`  ${city} ${dataset}:快取 ${out[k]!.length} 筆`);
      continue;
    }
    const t0 = Date.now();
    out[k] = await tdxGet(dataset, city);
    fs.writeFileSync(file, JSON.stringify(out[k]));
    console.log(`  ${city} ${dataset}:下載 ${out[k]!.length} 筆(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    await new Promise((r) => setTimeout(r, 1500)); // 別連發
  }
  return out as unknown as TdxCity;
}

async function post(base: string, secret: string, p: string, body: unknown) {
  const res = await fetch(`${base}/api/ingest/bus/${p}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ingest bus/${p} ${res.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text) as Record<string, unknown>;
}

export async function runBus(opts: { base: string; secret: string; args: string[] }) {
  const { args } = opts;
  const dry = args.includes("--dry");
  const refresh = args.includes("--refresh");
  const force = args.includes("--force");
  const cities = (args.find((a) => a.startsWith("--cities="))?.slice(9) ?? "Taipei,NewTaipei").split(",").filter(Boolean);
  if (!process.env.TDX_CLIENT_ID) console.log("(.env 沒有 TDX_CLIENT_ID,用匿名額度;被 429 擋就去 TDX 申請金鑰)");

  // 雙北聯營路線兩邊資料都有,同 key 只留先看到的
  const routes = new Map<string, BusRouteIn>();
  const stops = new Map<string, BusStopIn>();
  for (const city of cities) {
    console.log(`=== ${city} ===`);
    const r = transformCity(city, await loadCity(city, refresh));
    let added = 0;
    for (const x of r.routes) if (!routes.has(x.key) && ++added) routes.set(x.key, x);
    for (const s of r.stops) if (routes.get(s.route_key)?.city === city) stops.set(`${s.route_key}#${s.seq}`, s);
    console.log(`  → 路線方向 ${r.routes.length}(新 ${added})、站 ${r.stops.length}`);
  }
  const withSched = [...routes.values()].filter((r) => r.schedule).length;
  const withTimes = [...routes.values()].filter((r) => r.schedule && Object.values(r.schedule).some((d) => d?.deps?.length)).length;
  console.log(`合計 路線方向 ${routes.size}、站 ${stops.size};有班距 / 時刻 ${withSched}(其中有逐班時刻 ${withTimes})`);

  if (dry) {
    const sample = [...routes.values()].find((r) => r.name === "307") ?? [...routes.values()][0];
    if (sample) console.log(JSON.stringify({ ...sample, shape: `${sample.shape.length} 點` }, null, 1));
    return;
  }
  if (!opts.secret) throw new Error(".env 沒有 INGEST_SECRET");

  const version = new Date().toISOString();
  const rs = [...routes.values()];
  for (let i = 0; i < rs.length; i += 50) await post(opts.base, opts.secret, "routes", { version, items: rs.slice(i, i + 50) });
  console.log(`推入路線 ${rs.length}`);
  const ss = [...stops.values()];
  for (let i = 0; i < ss.length; i += 1000) {
    await post(opts.base, opts.secret, "stops", { version, items: ss.slice(i, i + 1000) });
    process.stdout.write(`\r推入站 ${Math.min(i + 1000, ss.length)} / ${ss.length}`);
  }
  console.log();
  console.log("commit", await post(opts.base, opts.secret, "commit", { version, force }));
}
