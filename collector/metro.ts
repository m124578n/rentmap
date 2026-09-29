/**
 * `npm run collect -- metro`
 *
 * 從 TDX 下載捷運官方站間時間(Rail/Metro/S2STravelTime:台北捷運 TRTC、新北捷運 NTMC、桃園機捷 TYMC)
 * → 寫成 public/mrt-times.json(進 git,Worker 建捷運圖時 import;Worker 不抓外站)。一年跑一兩次就夠。
 * 金鑰同公車:.env 的 TDX_CLIENT_ID / TDX_CLIENT_SECRET。
 */
import fs from "node:fs";
import path from "node:path";
import { buildMrtTimes, type TdxS2S } from "./metro-transform";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "public", "mrt-times.json");
const TOKEN_URL = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";
const API_BASE = "https://tdx.transportdata.tw/api/basic/v2/Rail/Metro/S2STravelTime";
const OPERATORS = ["TRTC", "NTMC", "TYMC"];

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

export async function runMetro(args: string[]) {
  const token = await getToken();
  const all: TdxS2S[] = [];
  for (const op of OPERATORS) {
    const res = await fetch(`${API_BASE}/${op}?%24format=JSON`, { headers: { Accept: "application/json", Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`TDX S2STravelTime/${op} ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as TdxS2S[];
    console.log(`  ${op}:${body.length} 條路線`);
    all.push(...body);
    await new Promise((r) => setTimeout(r, 5000));
  }
  const out = buildMrtTimes(all);
  console.log(`站間 ${Object.keys(out.edges).length} 段`);
  if (args.includes("--dry")) return console.log(JSON.stringify(Object.entries(out.edges).slice(0, 5)));
  fs.writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString().slice(0, 10), ...out }, null, 0) + "\n");
  console.log(`寫入 ${path.relative(ROOT, OUT)}`);
}
