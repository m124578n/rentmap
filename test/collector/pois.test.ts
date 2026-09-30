import { describe, expect, it } from "vitest";
import { PoiIn } from "../../src/shared/poi";
import { fromMenmap, fromOverpass, osmName, overpassQuery, tiles, TPE_BBOX, type OsmElement } from "../../collector/pois/transform";

describe("OSM / Overpass", () => {
  it("query:每條選擇器一段 nwr,out center", () => {
    const q = overpassQuery("pharmacy", { s: 25, w: 121.5, n: 25.1, e: 121.6 });
    expect(q).toBe('[out:json][timeout:180];(nwr["amenity"="pharmacy"](25.0000,121.5000,25.1000,121.6000);nwr["healthcare"="pharmacy"](25.0000,121.5000,25.1000,121.6000););out center tags;');
    expect(overpassQuery("gym", { s: 25, w: 121.5, n: 25.1, e: 121.6 }).match(/nwr\[/g)).toHaveLength(3);
    expect(() => overpassQuery("ramen", TPE_BBOX)).toThrow();
  });

  it("tiles 切塊涵蓋整個範圍", () => {
    const t = tiles(TPE_BBOX, 3, 3);
    expect(t).toHaveLength(9);
    expect(t[0]).toMatchObject({ s: TPE_BBOX.s, w: TPE_BBOX.w });
    expect(t[8]!.n).toBeCloseTo(TPE_BBOX.n);
    expect(t[8]!.e).toBeCloseTo(TPE_BBOX.e);
  });

  it("node 用自己的座標、way 用 center;重複的只留一筆;私人的不收", () => {
    const els: OsmElement[] = [
      { type: "node", id: 1, lat: 25.04, lon: 121.5, tags: { amenity: "restaurant", name: "阿婆麵線" } },
      { type: "way", id: 2, center: { lat: 25.05, lon: 121.51 }, tags: { amenity: "cafe", "name:zh": "咖啡" } },
      { type: "node", id: 1, lat: 25.04, lon: 121.5, tags: { amenity: "restaurant", name: "阿婆麵線" } },
      { type: "node", id: 3, lat: 25.06, lon: 121.52, tags: { amenity: "fast_food", brand: "麥當勞" } },
      { type: "way", id: 4, tags: { amenity: "restaurant" } }, // 沒座標
      { type: "node", id: 5, lat: 25.07, lon: 121.53, tags: { amenity: "restaurant", access: "private" } },
    ];
    const out = fromOverpass("food", els);
    expect(out.map((x) => [x.key, x.subtype, x.name])).toEqual([
      ["n1", "restaurant", "阿婆麵線"],
      ["w2", "cafe", "咖啡"],
      ["n3", "fast_food", "麥當勞"],
    ]);
    for (const x of out) expect(PoiIn.safeParse(x).success).toBe(true);
  });

  it("osmName 退回順序", () => {
    expect(osmName({ "name:en": "Park" })).toBe("Park");
    expect(osmName({})).toBeNull();
  });
});

describe("menmap 拉麵", () => {
  it("只收雙北、營業中,帶評分與連結", () => {
    const out = fromMenmap([
      { ftid: "0x1:0x2", name: "麵屋 A", lat: 25.05, lng: 121.52, city: "台北市", status: "OPERATIONAL", rating: 4.4, maps_url: "https://maps.google.com/?cid=1" },
      { ftid: "0x3:0x4", name: "麵屋 B", lat: 25.0, lng: 121.45, city: "新北市", status: "OPERATIONAL", rating: null, maps_url: null },
      { ftid: "0x5:0x6", name: "台中店", lat: 24.1, lng: 120.6, city: "台中市", status: "OPERATIONAL", rating: 4 },
      { ftid: "0x7:0x8", name: "暫停", lat: 25.05, lng: 121.5, city: "台北市", status: "CLOSED_TEMPORARILY", rating: 4 },
    ]);
    expect(out.map((x) => [x.key, x.rating, x.url])).toEqual([
      ["m0x1:0x2", 4.4, "https://maps.google.com/?cid=1"],
      ["m0x3:0x4", null, "https://www.google.com/maps?ftid=0x3%3A0x4"],
    ]);
    for (const x of out) expect(PoiIn.safeParse(x).success).toBe(true);
  });
});
