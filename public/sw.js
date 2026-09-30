/**
 * 離線:看房途中收訊差也打得開收藏、面板與看房路線。只在正式建置註冊(main.tsx),dev 不用。
 *
 *   /assets/*(檔名帶 hash)        cache-first,永久
 *   頁面導覽                        network-first,斷線回快取的 index.html(SPA 殼)
 *   GET /api/*(登入、ingest 除外) network-first,4 秒沒回就先給上次的,回應加 x-sw-cache: 1
 *   CARTO 底圖、字型、樣式          cache-first,最多 3000 筆(看過的地方離線也有底圖)
 * 登出時頁面會送 {type:"logout"},清掉 API 快取(個人資料不留在這台)。
 */
const VERSION = "v1";
const SHELL = `shell-${VERSION}`;
const ASSETS = `assets-${VERSION}`;
const API = "api";
const TILES = "tiles";
const TILE_MAX = 3000;
const API_TIMEOUT_MS = 4000;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(["/", "/manifest.webmanifest", "/icon.svg"])));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  const keep = new Set([SHELL, ASSETS, API, TILES]);
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (e) => {
  if (e.data?.type === "logout") e.waitUntil(caches.delete(API));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith("/api/")) {
      if (url.pathname.startsWith("/api/auth/") || url.pathname.startsWith("/api/ingest/")) return;
      e.respondWith(networkFirst(req, API));
      return;
    }
    if (url.pathname.startsWith("/assets/")) {
      e.respondWith(cacheFirst(req, ASSETS));
      return;
    }
    if (req.mode === "navigate") {
      e.respondWith(
        fetch(req)
          .then((res) => {
            if (res.ok) caches.open(SHELL).then((c) => c.put("/", res.clone()));
            return res;
          })
          .catch(() => caches.match("/", { cacheName: SHELL }).then((r) => r ?? Response.error())),
      );
      return;
    }
    return;
  }

  if (/(^|\.)basemaps\.cartocdn\.com$/.test(url.hostname)) {
    e.respondWith(cacheFirst(req, TILES, TILE_MAX));
  }
});

async function cacheFirst(req, name, max) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    await cache.put(req, res.clone());
    if (max) trim(cache, max);
  }
  return res;
}

/** 先打網路;超過 API_TIMEOUT_MS 或失敗就回上次的(若有),網路後來回來仍會更新快取 */
async function networkFirst(req, name) {
  const cache = await caches.open(name);
  const net = fetch(req).then(async (res) => {
    if (res.ok) await cache.put(req, res.clone());
    return res;
  });
  net.catch(() => undefined); // 已經回了快取之後網路才失敗,不要變成未處理的錯誤
  const cached = () => cache.match(req).then((r) => (r ? marked(r) : undefined));
  try {
    const res = await Promise.race([net, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), API_TIMEOUT_MS))]);
    return res;
  } catch {
    const old = await cached();
    if (old) return old;
    return net; // 沒有舊的就等網路(可能失敗)
  }
}

function marked(res) {
  const h = new Headers(res.headers);
  h.set("x-sw-cache", "1");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

async function trim(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}
