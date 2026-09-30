/**
 * `npm run collect -- metro`
 *
 * 從 TDX 下載捷運官方站間時間(Rail/Metro/S2STravelTime:台北捷運 TRTC、新北捷運 NTMC、桃園機捷 TYMC、高雄捷運 KRTC、高雄輕軌 KLRT、台中捷運 TMRT)
 * → 寫成 public/mrt-times.json(進 git,Worker 建捷運圖時 import;Worker 不抓外站)。一年跑一兩次就夠。
 * 金鑰同公車:.env 的 TDX_CLIENT_ID / TDX_CLIENT_SECRET。
 */
import fs from "node:fs";
import path from "node:path";
import { buildMrtTimes, type TdxS2S } from "./metro-transform";
import { tdxGet } from "./lib/tdx";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "public", "mrt-times.json");
const DATASET = "v2/Rail/Metro/S2STravelTime";
// 高雄捷運 KRTC、高雄輕軌 KLRT、台中捷運 TMRT:mrt.json 已有站,開那些生活圈前跑一次
const OPERATORS = ["TRTC", "NTMC", "TYMC", "KRTC", "KLRT", "TMRT"];

export async function runMetro(args: string[]) {
  const all: (TdxS2S & { op: string })[] = [];
  for (const op of OPERATORS) {
    const body = (await tdxGet<TdxS2S[]>(`${DATASET}/${op}`)) ?? [];
    console.log(`  ${op}:${body.length} 條路線`);
    all.push(...body.map((x) => ({ ...x, op })));
    await new Promise((r) => setTimeout(r, 5000));
  }
  const out = buildMrtTimes(all);
  console.log(`站間 ${Object.keys(out.edges).length} 段`);
  if (args.includes("--dry")) return console.log(JSON.stringify(Object.entries(out.edges).slice(0, 5)));
  fs.writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString().slice(0, 10), ...out }, null, 0) + "\n");
  console.log(`寫入 ${path.relative(ROOT, OUT)}`);
}
