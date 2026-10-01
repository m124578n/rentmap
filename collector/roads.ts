/**
 * `npm run collect -- roads [--region=north] [--dry]`
 *
 * 把 scripts/build_roads.py 產生的 data/roads/{region}.bin(機車 / 開車道路圖)推進 /api/ingest/roads:
 * base64 切成約 900KB 一段推,全部推完 commit(段數齊才換版、舊版刪掉)。不給 --region = 所有已開放的生活圈。
 * 每月跟著台灣 OSM 檔更新一次(`npm run data:refresh` 的 roads 步驟)。
 */
import fs from "node:fs";
import path from "node:path";
import { decodeRoads } from "../src/shared/roads";
import { REGION_KEYS, REGIONS, type RegionKey } from "../src/shared/regions";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIR = path.join(ROOT, "data", "roads");
const CHUNK = 900_000;

async function post(base: string, secret: string, p: string, body: unknown) {
  const res = await fetch(`${base}/api/ingest/roads${p}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ingest roads${p} ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as Record<string, unknown>;
}

export async function runRoads(opts: { base: string; secret: string; args: string[] }) {
  const regionArg = opts.args.find((a) => a.startsWith("--region="))?.slice(9);
  if (regionArg && !(REGION_KEYS as readonly string[]).includes(regionArg)) throw new Error(`--region 只能是 ${REGION_KEYS.join(" / ")}`);
  const regions = regionArg ? [regionArg as RegionKey] : REGION_KEYS.filter((k) => REGIONS[k].enabled);
  const dry = opts.args.includes("--dry");
  if (!dry && !opts.secret) throw new Error(".env 沒有 INGEST_SECRET");
  for (const region of regions) {
    const file = path.join(DIR, `${region}.bin`);
    if (!fs.existsSync(file)) throw new Error(`沒有 ${path.relative(ROOT, file)}:先跑 python scripts/build_roads.py --region=${region}`);
    const buf = fs.readFileSync(file);
    const g = decodeRoads(new Uint8Array(buf)); // 先驗格式,壞檔不要推上去
    const b64 = buf.toString("base64");
    const total = Math.ceil(b64.length / CHUNK);
    const age = Math.floor((Date.now() - fs.statSync(file).mtimeMs) / 86400_000);
    console.log(`${REGIONS[region].label}(${region}):路口 ${g.n}、邊 ${g.e},${(buf.length / 1e6).toFixed(1)} MB → ${total} 段${age > 35 ? `(道路圖是 ${age} 天前建的)` : ""}`);
    if (dry) continue;
    const version = new Date().toISOString();
    for (let i = 0; i < total; i++) await post(opts.base, opts.secret, "", { region, version, chunk: i, total, data: b64.slice(i * CHUNK, (i + 1) * CHUNK) });
    console.log("  commit", await post(opts.base, opts.secret, "/commit", { region, version }));
  }
}
