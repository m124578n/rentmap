/** 價格顯示:租屋是月租「$18,000」,買房是總價「2,880 萬」「1.25 億」(前後端共用) */
export const wan = (n: number) => (n >= 1e8 ? `${(n / 1e8).toFixed(2).replace(/\.?0+$/, "")} 億` : `${Math.round(n / 1e4).toLocaleString()} 萬`);

export interface Priced {
  deal?: "rent" | "buy";
  rent: number | null;
  price?: number | null;
}

/** 完整的價格文字(卡片、面板) */
export function priceText(p: Priced) {
  if (p.deal === "buy") return p.price != null ? wan(p.price) : "—";
  return p.rent != null ? `$${p.rent.toLocaleString()}` : "—";
}

/** 地圖標記用的短價格:月租 1.8萬 / $9,300;總價 2880萬 / 1.3億 */
export function priceShort(p: Priced) {
  if (p.deal === "buy") return p.price == null ? "—" : p.price >= 1e8 ? `${(p.price / 1e8).toFixed(1)}億` : `${Math.round(p.price / 1e4)}萬`;
  const r = p.rent;
  if (r == null) return "—";
  return r >= 10000 ? `${(r / 10000).toFixed(r % 10000 === 0 ? 0 : 1)}萬` : `$${r.toLocaleString()}`;
}

/** 每坪:月租 / 坪,或總價 / 坪 */
export function perPing(p: Priced & { size_ping: number | null }) {
  const v = p.deal === "buy" ? p.price : p.rent;
  return v != null && p.size_ping ? Math.round(v / p.size_ping) : null;
}
