/**
 * 彙總 API 的回應快取(Workers Cache API,每個機房一份,Worker 被回收也還在)。
 * 快取鍵帶「資料版本」:房源筆數 + 最後更新、來源資料的筆數 + version……資料一變鍵就變,不會回舊的,也不用手動清。
 * 命中就不用把整份公車網路 / 生活機能 / 實價登錄載進記憶體(冷啟動那 0.5–2 秒)。
 * 使用者自己的資料(我的地點)要放進 key;回應只存在伺服器端的快取,不會被別人拿到。
 */
import type { Context } from "hono";
import type { AppEnv } from "./env";

const ORIGIN = "https://cache.rentmap.internal";
const TTL = 7 * 86400;

/** 房源變了(新增、重抓、座標)就換 key;公開模式只看這個人的房源(owner 也進 key,別人的結果不會混進來) */
export async function propertiesSig(DB: D1Database, owner: number | null = null) {
  const where = owner == null ? "" : ` WHERE created_by = ${Math.trunc(owner)}`;
  const r = await DB.prepare(`SELECT COUNT(*) AS n, MAX(updated_at) AS u FROM properties${where}`).first<{ n: number; u: string | null }>();
  return `${owner ?? "all"}.${r?.n ?? 0}.${r?.u ?? ""}`;
}

/** 一張表的筆數 + 某欄最大值(version、id、date) */
export async function tableSig(DB: D1Database, table: string, col: string, where = "") {
  const r = await DB.prepare(`SELECT COUNT(*) AS n, MAX(${col}) AS m FROM ${table} ${where}`).first<{ n: number; m: string | number | null }>();
  return `${r?.n ?? 0}.${r?.m ?? ""}`;
}

/** 有快取就回;沒有就 compute、存起來再回。header x-cache: hit / miss 方便看 */
export async function cachedJson(c: Context<AppEnv>, parts: (string | number)[], compute: () => Promise<unknown>) {
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  const key = new Request(`${ORIGIN}/${parts.map((p) => encodeURIComponent(String(p))).join("/")}`);
  if (cache) {
    const hit = await cache.match(key);
    if (hit) {
      const res = new Response(hit.body, hit);
      res.headers.set("x-cache", "hit");
      res.headers.set("Cache-Control", "private, no-store");
      return res;
    }
  }
  const body = JSON.stringify(await compute());
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": `max-age=${TTL}` };
  if (cache) c.executionCtx.waitUntil(cache.put(key, new Response(body, { headers })));
  return new Response(body, { headers: { ...headers, "Cache-Control": "private, no-store", "x-cache": "miss" } });
}

/** ETag 用的短雜湊 */
export async function shortHash(s: string) {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
  return [...new Uint8Array(buf).slice(0, 10)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
