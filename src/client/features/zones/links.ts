/**
 * 落腳圈每個區的外部搜尋連結(只是連過去,不抓任何資料)。
 * 591 直接帶縣市代碼 + 關鍵字;其他網站的搜尋網址常改版,用 Google 站內搜尋比較不會壞。
 */
const R591: Record<string, number> = { 台北市: 1, 基隆市: 2, 新北市: 3, 新竹市: 4, 新竹縣: 5, 桃園市: 6, 台中市: 8, 台南市: 15, 高雄市: 17 };
const q = encodeURIComponent;
const google = (text: string, site: string) => `https://www.google.com/search?q=${q(`${text} site:${site}`)}`;

export interface AreaLink {
  label: string;
  url: string;
}

export function areaLinks(city: string, district: string, deal: "rent" | "buy"): AreaLink[] {
  const where = `${city}${district}`;
  const region = R591[city];
  if (deal === "buy")
    return [
      { label: "591 買屋", url: `https://sale.591.com.tw/?regionid=${region ?? ""}&keywords=${q(district)}` },
      { label: "信義房屋", url: google(`${where} 買屋`, "sinyi.com.tw") },
      { label: "永慶房屋", url: google(`${where} 買屋`, "yungching.com.tw") },
      { label: "樂屋網", url: google(`${where} 中古屋`, "rakuya.com.tw") },
      { label: "Google 地圖", url: `https://www.google.com/maps/search/${q(where)}` },
    ];
  return [
    { label: "591 租屋", url: `https://rent.591.com.tw/list?region=${region ?? ""}&keywords=${q(district)}` },
    { label: "樂屋網", url: google(`${where} 租屋`, "rakuya.com.tw") },
    { label: "好房網", url: google(`${where} 租屋`, "housefun.com.tw") },
    { label: "信義租屋", url: google(`${where} 出租`, "sinyi.com.tw") },
    { label: "Google 地圖", url: `https://www.google.com/maps/search/${q(where)}` },
  ];
}
