/**
 * `npm run collect -- tra [--dry] [--date=YYYY-MM-DD]`
 *
 * 從 TDX 下載台鐵車站 + 某個平日(預設下週三)的每日時刻表 → public/tra.json(進 git,Worker 建軌道圖時 import;Worker 不抓外站)。
 * 只收目前生活圈(north)外框內的站與區間車。時刻表改點(通常一年幾次)才要重跑。
 * 金鑰同公車:.env 的 TDX_CLIENT_ID / TDX_CLIENT_SECRET。原始回應快取在 data/tdx/tra-*.json。
 */
import fs from "node:fs";
import path from "node:path";
import { regionBbox } from "../src/shared/regions";
import { buildTra, type TdxTraStation, type TdxTraTimetable } from "./tra-transform";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "public", "tra.json");
const CACHE_DIR = path.join(ROOT, "data", "tdx");
const TOKEN_URL = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";
const API_BASE = "https://tdx.transportdata.tw/api/basic/v3/Rail/TRA";

async function getToken() {
  const id = process.env.TDX_CLIENT_ID;
  const secret = process.env.TDX_CLIENT_SECRET;
  if (!id || !secret) throw new Error(".env 沒有 TDX_CLIENT_ID / TDX_CLIENT_SECRET");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret }),
  });
  if (!res.ok) throw new Error(`TDX token ${res.status}: ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

/** 下週三(平日、不太會碰到連假) */
function nextWednesday(now = new Date()) {
  const d = new Date(now);
  d.setDate(d.getDate() + ((3 - d.getDay() + 7) % 7 || 7));
  return d.toISOString().slice(0, 10);
}

async function get<T>(token: string, name: string, p: string, key: string): Promise<T[]> {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, `tra-${name}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8")) as T[];
  const res = await fetch(`${API_BASE}/${p}?%24format=JSON`, { headers: { Accept: "application/json", Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw new Error(`TDX TRA ${p} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as Record<string, unknown> | T[];
  // v3 包在物件裡({ Stations: [...] }、{ TrainTimetables: [...] }),v2 直接是陣列
  const list = (Array.isArray(body) ? body : body[key]) as T[] | undefined;
  if (!Array.isArray(list)) throw new Error(`TDX TRA ${p} 找不到 ${key}`);
  fs.writeFileSync(file, JSON.stringify(list));
  return list;
}

export async function runTra(args: string[]) {
  const date = args.find((a) => a.startsWith("--date="))?.slice(7) ?? nextWednesday();
  const token = await getToken();
  const stations = await get<TdxTraStation>(token, "stations", "Station", "Stations");
  await new Promise((r) => setTimeout(r, 3000));
  const trains = await get<TdxTraTimetable>(token, `daily-${date}`, `DailyTrainTimetable/TrainDate/${date}`, "TrainTimetables");
  console.log(`  車站 ${stations.length},${date} 車次 ${trains.length}`);
  const out = buildTra(stations, trains, regionBbox("north"));
  console.log(`生活圈內 ${out.stations.length} 站、站間 ${Object.keys(out.edges).length} 段,區間車班距 ${out.headway.join(" / ")} 分(尖峰 / 離峰 / 晚上)`);
  if (args.includes("--dry")) return console.log(JSON.stringify(out.stations.slice(0, 5)));
  fs.writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString().slice(0, 10), date, ...out }) + "\n");
  console.log(`寫入 ${path.relative(ROOT, OUT)}(要 commit)`);
}
