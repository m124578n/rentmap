/**
 * `npm run collect -- hazards [--dry] [--force]`
 *
 * 把 scripts/build_hazards.py 產生的 data/hazard/hazards.json(淹水、土壤液化多邊形)整批推進 /api/ingest/hazards,
 * 推完 commit(舊版刪掉)。圖資很少更新,轉一次推一次就好。
 */
import fs from "node:fs";
import path from "node:path";
import { HazardZoneIn } from "../src/shared/hazard";

const ROOT = path.resolve(import.meta.dirname, "..");
const FILE = path.join(ROOT, "data", "hazard", "hazards.json");

async function post(base: string, secret: string, p: string, body: unknown) {
  const res = await fetch(`${base}/api/ingest/hazards${p}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ingest hazards${p} ${res.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text) as Record<string, unknown>;
}

export async function runHazards(opts: { base: string; secret: string; args: string[] }) {
  if (!fs.existsSync(FILE)) throw new Error(`沒有 ${path.relative(ROOT, FILE)}:先跑 python scripts/build_hazards.py`);
  const { zones } = JSON.parse(fs.readFileSync(FILE, "utf8")) as { zones: unknown[] };
  const items = zones.map((z) => HazardZoneIn.parse(z));
  const by: Record<string, number> = {};
  for (const z of items) by[`${z.city} ${z.kind}`] = (by[`${z.city} ${z.kind}`] ?? 0) + 1;
  console.log(`多邊形 ${items.length}:${JSON.stringify(by)}`);
  if (opts.args.includes("--dry")) return;
  if (!opts.secret) throw new Error(".env 沒有 INGEST_SECRET");
  const version = new Date().toISOString();
  // 每批控制在約 1MB(D1 單一綁定參數有上限)
  let batch: typeof items = [];
  let size = 0;
  let sent = 0;
  const flush = async () => {
    if (!batch.length) return;
    await post(opts.base, opts.secret, "", { version, items: batch });
    sent += batch.length;
    process.stdout.write(`\r推入 ${sent} / ${items.length}`);
    batch = [];
    size = 0;
  };
  for (const z of items) {
    const n = JSON.stringify(z.rings).length;
    if (size + n > 900_000 || batch.length >= 1000) await flush();
    batch.push(z);
    size += n;
  }
  await flush();
  console.log();
  console.log("commit", await post(opts.base, opts.secret, "/commit", { version, force: opts.args.includes("--force") }));
}
