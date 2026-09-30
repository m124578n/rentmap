/** TDX 共用:token(一個程序拿一次)+ GET(429 / 5xx 重試)。金鑰放 .env 的 TDX_CLIENT_ID / TDX_CLIENT_SECRET。 */
const TOKEN_URL = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";
export const TDX_API = "https://tdx.transportdata.tw/api/basic";

let token: string | null = null;
export async function tdxToken(): Promise<string> {
  if (token) return token;
  const id = process.env.TDX_CLIENT_ID;
  const secret = process.env.TDX_CLIENT_SECRET;
  if (!id || !secret) throw new Error(".env 沒有 TDX_CLIENT_ID / TDX_CLIENT_SECRET");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret }),
  });
  if (!res.ok) throw new Error(`TDX token ${res.status}: ${await res.text()}`);
  token = ((await res.json()) as { access_token: string }).access_token;
  return token;
}

/** path 例:v2/Bike/Station/City/Taoyuan;404 回 null(該縣市沒有這項資料) */
export async function tdxGet<T>(path: string): Promise<T | null> {
  for (let i = 0; i < 6; i++) {
    const res = await fetch(`${TDX_API}/${path}${path.includes("?") ? "&" : "?"}%24format=JSON`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${await tdxToken()}` },
      signal: AbortSignal.timeout(300_000),
    });
    if (res.status === 404) return null;
    if (res.status === 429 || res.status >= 500) {
      // 429 = 短時間打太多次(同一天連跑公車 + 台鐵 + 捷運很容易碰到):15、30、45… 秒退避,最多等約 5 分鐘
      const wait = 15 * (i + 1);
      console.log(`  TDX ${path.split("?")[0]} HTTP ${res.status},${wait} 秒後重試`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`TDX ${path} ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as T;
  }
  throw new Error(`TDX ${path} 重試仍失敗`);
}
