/**
 * 落腳圈每個區 / 車站的外部搜尋連結(只是連過去,不抓任何資料)。
 * 第一個是 Google 直接搜關鍵字(「中和區 租屋」),各家網站都會出來;591 直接帶縣市代碼 + 關鍵字;
 * 其他網站的搜尋網址常改版,用 Google 站內搜尋比較不會壞。
 */
const R591: Record<string, number> = { 台北市: 1, 基隆市: 2, 新北市: 3, 新竹市: 4, 新竹縣: 5, 桃園市: 6, 台中市: 8, 台南市: 15, 高雄市: 17 };
const q = encodeURIComponent;
const google = (text: string, site?: string) => `https://www.google.com/search?q=${q(site ? `${text} site:${site}` : text)}`;

export type Deal = "rent" | "buy";
export const DEAL_LABEL: Record<Deal, string> = { rent: "租屋", buy: "買房" };

export interface AreaLink {
  label: string;
  url: string;
}

/** Google 搜關鍵字:「新北市中和區 租屋」 */
export function googleSearch(where: string, deal: Deal): string {
  return google(`${where} ${deal === "buy" ? "買房 中古屋" : "租屋"}`);
}

export function areaLinks(city: string, district: string, deal: Deal): AreaLink[] {
  const where = `${city}${district}`;
  const region = R591[city];
  if (deal === "buy")
    return [
      { label: "Google 搜尋", url: googleSearch(where, deal) },
      { label: "591 買屋", url: `https://sale.591.com.tw/?regionid=${region ?? ""}&keywords=${q(district)}` },
      { label: "信義房屋", url: google(`${where} 買屋`, "sinyi.com.tw") },
      { label: "永慶房屋", url: google(`${where} 買屋`, "yungching.com.tw") },
      { label: "樂屋網", url: google(`${where} 中古屋`, "rakuya.com.tw") },
      { label: "Google 地圖", url: `https://www.google.com/maps/search/${q(where)}` },
    ];
  return [
    { label: "Google 搜尋", url: googleSearch(where, deal) },
    { label: "591 租屋", url: `https://rent.591.com.tw/list?region=${region ?? ""}&keywords=${q(district)}` },
    { label: "樂屋網", url: google(`${where} 租屋`, "rakuya.com.tw") },
    { label: "好房網", url: google(`${where} 租屋`, "housefun.com.tw") },
    { label: "信義租屋", url: google(`${where} 出租`, "sinyi.com.tw") },
    { label: "Google 地圖", url: `https://www.google.com/maps/search/${q(where)}` },
  ];
}

/** 車站周邊:「捷運永安市場站 租屋」 */
export function stationSearch(name: string, rail: "mrt" | "tra", deal: Deal): string {
  return googleSearch(rail === "tra" ? `${name.replace(/^台鐵/, "")}車站` : `捷運${name}站`, deal);
}
