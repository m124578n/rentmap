/**
 * Google OAuth(authorization code)由 Worker 自己跑,callback 後簽 HS256 JWT 放 HttpOnly cookie 當 session。
 * 搬自 menmap worker/src/auth.ts,差別:
 *   - Phase 1 只放行 ADMIN_EMAILS 白名單裡的 Google 帳號(開放註冊是 Phase 3 的事)
 *   - user 表改用 Drizzle
 *
 * 路由:
 *   GET  /api/auth/google?return_to=/...   → 導去 Google
 *   GET  /api/auth/google/callback         → 換 token、upsert user、設 cookie、導回
 *   POST /api/auth/logout                  → 清 cookie
 *   GET  /api/me                           → { user, enabled }
 */
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { sign, verify } from "hono/jwt";
import type { SessionUser } from "@shared/schemas";
import type { AppEnv, Env } from "./env";
import { db, nowIso, schema } from "./db";

export const SESSION_COOKIE = "rent_session";
const STATE_COOKIE = "rent_oauth_state";
const SESSION_DAYS = 30;
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export const auth = new Hono<AppEnv>();

auth.get("/api/auth/google", (c) => {
  const { GOOGLE_CLIENT_ID, APP_ORIGIN } = c.env;
  if (!authConfigured(c.env) || !GOOGLE_CLIENT_ID) return c.text("auth not configured", 503);
  const returnTo = safeReturnTo(c.req.query("return_to"));
  const state = randomToken();
  setCookie(c, STATE_COOKIE, `${state}.${b64url(returnTo)}`, {
    httpOnly: true,
    secure: isHttps(c),
    sameSite: "Lax",
    path: "/api/auth",
    maxAge: 600,
  });
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(APP_ORIGIN),
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  return c.redirect(`${GOOGLE_AUTH_URL}?${params}`, 302);
});

auth.get("/api/auth/google/callback", async (c) => {
  const { APP_ORIGIN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SESSION_SECRET } = c.env;
  const fail = (reason: string, code = "failed") => {
    console.warn("google login failed:", reason);
    return c.redirect(`${APP_ORIGIN}/?login=${code}`, 302);
  };
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !SESSION_SECRET) return fail("not configured");

  const code = c.req.query("code");
  const state = c.req.query("state");
  const stateCookie = getCookie(c, STATE_COOKIE) ?? "";
  deleteCookie(c, STATE_COOKIE, { path: "/api/auth" });

  const dot = stateCookie.indexOf(".");
  if (!code || !state || dot < 0) return fail("missing code/state");
  const expected = stateCookie.slice(0, dot);
  const returnTo = safeReturnTo(b64urlDecode(stateCookie.slice(dot + 1)));
  if (!timingSafeEqual(state, expected)) return fail("state mismatch");

  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(APP_ORIGIN),
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) return fail(`token exchange ${tokenRes.status}: ${await tokenRes.text()}`);
  const token = (await tokenRes.json()) as { id_token?: string };
  if (!token.id_token) return fail("no id_token");

  // id_token 是 Google 透過 TLS 直接給的,不必再驗簽章;只檢查 aud / iss / exp
  const claims = decodeJwtPayload(token.id_token);
  if (!claims) return fail("bad id_token");
  if (claims.aud !== GOOGLE_CLIENT_ID) return fail("aud mismatch");
  if (claims.iss !== "https://accounts.google.com" && claims.iss !== "accounts.google.com") return fail("iss mismatch");
  if (typeof claims.exp === "number" && claims.exp * 1000 < Date.now()) return fail("id_token expired");
  const sub = typeof claims.sub === "string" ? claims.sub : null;
  if (!sub) return fail("no sub");

  const email = claims.email_verified === true ? strOrNull(claims.email) : null;
  if (!isAllowedEmail(c.env, email)) return fail(`email not in whitelist: ${email}`, "denied");

  const now = nowIso();
  const name = strOrNull(claims.name);
  const avatar = strOrNull(claims.picture);
  const [row] = await db(c.env.DB)
    .insert(schema.users)
    .values({ provider: "google", providerId: sub, displayName: name, avatarUrl: avatar, email, createdAt: now, lastLoginAt: now })
    .onConflictDoUpdate({
      target: [schema.users.provider, schema.users.providerId],
      set: { displayName: name, avatarUrl: avatar, email, lastLoginAt: now },
    })
    .returning({ id: schema.users.id });
  if (!row) return fail("user upsert returned nothing");

  await setSession(c, { id: row.id, name, avatar }, SESSION_SECRET);
  return c.redirect(`${APP_ORIGIN}${returnTo}`, 302);
});

auth.post("/api/auth/logout", (c) => {
  if (!sameOrigin(c)) return c.json({ error: "forbidden" }, 403);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

auth.get("/api/me", async (c) => {
  c.header("Cache-Control", "no-store");
  const user = await readSession(c);
  return c.json({ user, enabled: authConfigured(c.env) });
});

// ---- 給其他路由用 ----

export async function readSession(c: Context<AppEnv>): Promise<SessionUser | null> {
  const raw = getCookie(c, SESSION_COOKIE);
  if (!raw || !c.env.SESSION_SECRET) return null;
  try {
    const p = (await verify(raw, c.env.SESSION_SECRET, "HS256")) as Record<string, unknown>;
    if (typeof p.uid !== "number") return null;
    return { id: p.uid, name: strOrNull(p.name), avatar: strOrNull(p.avatar) };
  } catch {
    return null;
  }
}

/** 沒登入 401;非 GET 另要求同源(Origin / Sec-Fetch-Site)搭配 SameSite=Lax 擋 CSRF。 */
export function requireUser(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD" && !sameOrigin(c)) return c.json({ error: "forbidden" }, 403);
    const user = await readSession(c);
    if (!user) return c.json({ error: "login required" }, 401);
    c.set("user", user);
    await next();
  };
}

/** 採集機用:Authorization: Bearer <INGEST_SECRET> */
export function requireIngest(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const secret = c.env.INGEST_SECRET;
    const got = (c.req.header("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!secret || !got || !timingSafeEqual(got, secret)) return c.json({ error: "unauthorized" }, 401);
    await next();
  };
}

/** 簽一顆 session JWT(測試也用) */
export async function signSession(user: SessionUser, secret: string) {
  const nowSec = Math.floor(Date.now() / 1000);
  return sign({ uid: user.id, name: user.name, avatar: user.avatar, iat: nowSec, exp: nowSec + SESSION_DAYS * 86400 }, secret, "HS256");
}

// ---- helpers ----

function isAllowedEmail(env: Env, email: string | null) {
  if (!email) return false;
  const allow = (env.ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return allow.includes(email.trim().toLowerCase());
}

function authConfigured(env: Env) {
  return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.SESSION_SECRET);
}

async function setSession(c: Context<AppEnv>, user: SessionUser, secret: string) {
  setCookie(c, SESSION_COOKIE, await signSession(user, secret), {
    httpOnly: true,
    secure: isHttps(c),
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

function redirectUri(appOrigin: string) {
  return `${appOrigin}/api/auth/google/callback`;
}

function safeReturnTo(v: string | null | undefined): string {
  if (!v || !v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\")) return "/";
  return v.length > 512 ? "/" : v;
}

function isHttps(c: Context<AppEnv>) {
  return new URL(c.req.url).protocol === "https:";
}

function sameOrigin(c: Context<AppEnv>) {
  const origin = c.req.header("Origin");
  if (origin) return origin === c.env.APP_ORIGIN || origin === new URL(c.req.url).origin;
  const sfs = c.req.header("Sec-Fetch-Site");
  return sfs === "same-origin" || sfs === "none";
}

function randomToken() {
  const buf = new Uint8Array(24);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function b64url(s: string) {
  return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): string | null {
  try {
    const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
    return decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad)));
  } catch {
    return null;
  }
}

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  const json = b64urlDecode(parts[1]);
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}
