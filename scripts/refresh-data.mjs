#!/usr/bin/env node
/**
 * 開放資料更新:把所有「要在家裡這台抓」的資料集包成一支可重複執行的腳本。
 *
 *   npm run data:refresh                          全部資料集(已開放的生活圈)
 *   npm run data:refresh -- --region=taichung     只抓某個生活圈(開新區時用)
 *   npm run data:refresh -- --only=bus,pois       只跑指定項目
 *   npm run data:refresh -- --skip=crime          跳過某些項目
 *   npm run data:refresh -- --due                 只跑「到期」的(依下面每項的 everyDays 與上次成功時間)
 *   npm run data:refresh -- --plan                只印會跑什麼,不執行
 *   npm run data:refresh -- --serial              一項一項跑(預設依來源分三條線平行)
 *
 * 做的事:
 *   - 執行鎖(data/refresh.lock):同時只會有一份在跑,避免兩組採集互撞(覆蓋式匯入、解壓唯讀檔都會出事)
 *   - 本機模式(.env 的 RENTMAP_API 是 localhost):dev server 沒開就先套 migration、自己起一個,跑完關掉
 *   - 每項各自寫 log(data/logs/refresh-{日期}-{項目}.log),結束印摘要;任何一項失敗 exit code 1
 *   - 記錄每項上次成功時間(data/refresh-state.json),給 --due 用
 *   - 會改到 public/ 底下要進 git 的檔(tra.json、mrt-times.json、crime-districts.json)時提醒 commit
 *
 * 所有匯入都是覆蓋式、冪等的:重跑只會更新,不會重複。原始檔有快取(data/tdx、data/osm、data/lvr、data/hazard、data/crime)。
 */
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
process.chdir(ROOT);
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const list = (v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : null);

const region = opt("region"); // 不給 = collector 的預設(所有已開放的生活圈)
const regionArg = region ? ` --region=${region}` : "";

/**
 * 資料集。lane = 來源主機(同一條線內依序跑,不同線平行,才不會對同一個站同時發請求)。
 * everyDays = 建議多久更新一次(--due 用)。commit = 會改到、要進 git 的檔。
 */
const STEPS = [
  { id: "bus", lane: "tdx", everyDays: 30, label: "公車路線與班表(TDX)", cmds: [`npm run collect -- bus${regionArg}`] },
  { id: "tra", lane: "tdx", everyDays: 180, label: "台鐵區間車時刻(TDX)", cmds: ["npm run collect -- tra"], commit: ["public/tra.json"] },
  { id: "metro", lane: "tdx", everyDays: 180, label: "捷運站間時間(TDX)", cmds: ["npm run collect -- metro"], commit: ["public/mrt-times.json"] },
  { id: "rent", lane: "gov", everyDays: 90, label: "租賃實價登錄(內政部)", cmds: [`npm run collect -- rent-stats${regionArg}`] },
  {
    id: "hazards",
    lane: "gov",
    everyDays: 365,
    label: "災害潛勢(淹水 / 液化 / 航空噪音)",
    cmds: ["python -m pip install -q py7zr pyshp pyproj", "python scripts/build_hazards.py", "npm run collect -- hazards"],
  },
  {
    id: "pois",
    lane: "osm",
    everyDays: 30,
    label: "生活機能 / 嫌惡設施 / 垃圾車 / YouBike",
    // 先從 Geofabrik 的台灣檔在本機抽出各類(寫成 collector 的快取檔),匯入時就不會打 Overpass(常限速 / 連不上)
    // 台中、高雄的垃圾車清運點沒有座標:locate_garbage.py 用同一份台灣檔裡的門牌對出來(其他生活圈會直接跳過)
    cmds: ["python -m pip install -q osmium", `python scripts/build_osm_pois.py${regionArg}`, `python scripts/locate_garbage.py${regionArg}`, `npm run collect -- pois${regionArg}`],
  },
  { id: "crime", lane: "osm", everyDays: 90, label: "治安(竊盜點位 + 各區件數)", cmds: ["npm run collect -- crime"], commit: ["public/crime-districts.json"] },
];

// ---- 選出要跑的 ----
const STATE_FILE = path.join(ROOT, "data", "refresh-state.json");
const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : {};
const stateKey = (id) => `${region ?? "all"}:${id}`;
const daysSince = (iso) => (iso ? (Date.now() - Date.parse(iso)) / 86400_000 : Infinity);

const only = list(opt("only"));
const skip = list(opt("skip")) ?? [];
const unknown = [...(only ?? []), ...skip].filter((x) => !STEPS.some((s) => s.id === x));
if (unknown.length) {
  console.error(`不認得的項目:${unknown.join(", ")}(可用:${STEPS.map((s) => s.id).join(", ")})`);
  process.exit(2);
}
let chosen = STEPS.filter((s) => (!only || only.includes(s.id)) && !skip.includes(s.id));
if (flag("due")) chosen = chosen.filter((s) => daysSince(state[stateKey(s.id)]?.ok_at) >= s.everyDays);

console.log(`生活圈:${region ?? "全部已開放"}`);
for (const s of STEPS) {
  const last = state[stateKey(s.id)]?.ok_at;
  const age = last ? `${Math.floor(daysSince(last))} 天前` : "從未";
  console.log(`  ${chosen.includes(s) ? "▶" : "·"} ${s.id.padEnd(8)} ${s.label}  (每 ${s.everyDays} 天;上次成功:${age})`);
}
if (chosen.length === 0) {
  console.log("沒有要跑的項目。");
  process.exit(0);
}
if (flag("plan")) process.exit(0);

// ---- 執行鎖 ----
const LOCK = path.join(ROOT, "data", "refresh.lock");
fs.mkdirSync(path.join(ROOT, "data", "logs"), { recursive: true });
if (fs.existsSync(LOCK)) {
  const pid = Number(fs.readFileSync(LOCK, "utf8"));
  let alive = false;
  try {
    process.kill(pid, 0);
    alive = true;
  } catch {
    /* 行程不在了,是殘留的鎖 */
  }
  if (alive) {
    console.error(`已經有一份在跑(pid ${pid})。要強制重來:先結束它,再刪 data/refresh.lock`);
    process.exit(3);
  }
}
fs.writeFileSync(LOCK, String(process.pid));
let devProc = null;
const cleanup = () => {
  try {
    fs.unlinkSync(LOCK);
  } catch {
    /* 已經沒了 */
  }
  if (devProc) killTree(devProc.pid);
};
process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(130));

function killTree(pid) {
  try {
    if (process.platform === "win32") execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
    else process.kill(-pid);
  } catch {
    /* 已經結束 */
  }
}

// ---- 確認 API(本機模式會自己起 dev server)----
if (fs.existsSync(path.join(ROOT, ".env"))) process.loadEnvFile(path.join(ROOT, ".env"));
const API = process.env.RENTMAP_API ?? "http://localhost:5173";
const healthy = async () => {
  try {
    return (await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(3000) })).ok;
  } catch {
    return false;
  }
};
if (!(await healthy())) {
  if (!/^https?:\/\/localhost/.test(API)) {
    console.error(`API 連不上:${API}`);
    process.exit(4);
  }
  console.log("dev server 沒開:先套本地 migration,再啟動 vite dev(跑完會關掉)");
  try {
    execSync("npm run db:migrate:local", { stdio: "ignore" });
  } catch {
    console.error("!! migrate 失敗,仍嘗試繼續");
  }
  devProc = spawn("npx vite dev", { shell: true, stdio: "ignore", detached: process.platform !== "win32" });
  let up = false;
  for (let i = 0; i < 60 && !(up = await healthy()); i++) await new Promise((r) => setTimeout(r, 1000));
  if (!up) {
    console.error("dev server 起不來");
    process.exit(4);
  }
}

// ---- 跑 ----
const stamp = new Date().toISOString().slice(0, 10);
const results = [];

function run(cmd, logFile) {
  return new Promise((resolve) => {
    const out = fs.createWriteStream(logFile, { flags: "a" });
    out.write(`\n$ ${cmd}\n`);
    const p = spawn(cmd, { shell: true, env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" } });
    p.stdout.pipe(out, { end: false });
    p.stderr.pipe(out, { end: false });
    p.on("close", (code) => {
      out.end();
      resolve(code ?? 1);
    });
    p.on("error", () => resolve(1));
  });
}

async function runStep(s) {
  const logFile = path.join(ROOT, "data", "logs", `refresh-${stamp}-${s.id}.log`);
  const t0 = Date.now();
  console.log(`[${s.id}] 開始`);
  let code = 0;
  for (const cmd of s.cmds) {
    code = await run(cmd, logFile);
    if (code !== 0) break;
  }
  const seconds = Math.round((Date.now() - t0) / 1000);
  const ok = code === 0;
  const tail = fs.readFileSync(logFile, "utf8").trim().split(/\r?\n|\r/).filter((l) => l.trim()).slice(-1)[0] ?? "";
  console.log(`[${s.id}] ${ok ? "完成" : "失敗"}(${seconds}s)${ok ? "" : ` → ${path.relative(ROOT, logFile)}`}`);
  state[stateKey(s.id)] = { ...(state[stateKey(s.id)] ?? {}), last_run_at: new Date().toISOString(), ok, seconds, ...(ok ? { ok_at: new Date().toISOString() } : {}) };
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1));
  results.push({ id: s.id, ok, seconds, tail: tail.slice(0, 110), log: path.relative(ROOT, logFile) });
}

const lanes = flag("serial") ? [chosen] : Object.values(Object.groupBy(chosen, (s) => s.lane));
await Promise.all(
  lanes.map(async (lane) => {
    for (const s of lane) await runStep(s);
  }),
);

// ---- 摘要 ----
console.log("\n=== 摘要 ===");
for (const s of chosen) {
  const r = results.find((x) => x.id === s.id);
  console.log(`${r.ok ? "✓" : "✗"} ${r.id.padEnd(8)} ${String(r.seconds).padStart(5)}s  ${r.tail}`);
}
const touched = chosen.flatMap((s) => s.commit ?? []);
if (touched.length) {
  let dirty = "";
  try {
    dirty = execSync(`git status --porcelain -- ${touched.join(" ")}`, { encoding: "utf8" }).trim();
  } catch {
    /* 不在 git repo 裡就算了 */
  }
  if (dirty) console.log(`\n這些檔有變,要 commit(正式站的前端與 Worker 會讀):\n${dirty}`);
}
const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.log(`\n失敗 ${failed.length} 項:${failed.map((f) => `${f.id}(${f.log})`).join("、")}`);
  process.exit(1);
}
