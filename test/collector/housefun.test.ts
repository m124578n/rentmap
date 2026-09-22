import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ImportedListing } from "../../src/shared/schemas";
import { isHousefunGone, parseHousefunDetail, parseHousefunList } from "../../collector/sources/housefun";

const fx = (name: string) => fs.readFileSync(path.join(import.meta.dirname, "..", "fixtures", name), "utf8");

describe("housefun list", () => {
  it("parses cards with rent / size / layout", () => {
    const items = parseHousefunList(fx("housefun-list.html"));
    expect(items.length).toBeGreaterThanOrEqual(10);
    const one = items.find((i) => i.id === "2020251")!;
    expect(one).toMatchObject({ url: "https://rent.housefun.com.tw/rent/house/2020251/", title: "重慶獨立套房", address: "台北市大同區歸綏街", rent: 16800, size_ping: 7.08, layout: "1房(室)0廳1衛", floor: "8 / 10" });
  });
});

describe("housefun detail", () => {
  const url = "https://rent.housefun.com.tw/rent/house/2020260/";
  const raw = parseHousefunDetail(fx("housefun-detail.html"), url);

  it("passes the shared schema (with geocoded coords added later)", () => {
    const { geocode_query, ...rest } = raw;
    expect(geocode_query).toBe("台北市士林區士東路");
    const r = ImportedListing.safeParse({ ...rest, lat: 25.1, lng: 121.5 });
    expect(r.success, JSON.stringify(r.success ? null : r.error.issues)).toBe(true);
  });

  it("maps the main fields", () => {
    expect(raw).toMatchObject({
      title: "吉屋出租請速與我聯絡",
      city: "台北市",
      district: "士林區",
      road: "士東路",
      rent: 185000,
      size_ping: 102.31,
      rooms: 4,
      living_rooms: 2,
      bathrooms: 3,
      floor: 10,
      total_floors: 15,
      building_age: 18,
      building_type: "電梯大樓",
      kind: "整層住家",
      has_elevator: true,
      has_washer: false,
      pet_allowed: false,
      cooking_allowed: true,
      deposit_months: 2,
      source: "hb",
      source_listing_id: "2020260",
      source_url: url,
      status: "active",
    });
    expect(raw.photos.length).toBeGreaterThan(0);
    expect(raw.photos[0]).toMatch(/^https:\/\//);
    expect(raw.utilities_note).toContain("水費");
  });

  it("detects the 404 redirect", () => {
    expect(isHousefunGone("https://rent.housefun.com.tw/errorPage?ch=rent_404", "")).toBe(true);
    expect(isHousefunGone(url, fx("housefun-detail.html"))).toBe(false);
  });
});
