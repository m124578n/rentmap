import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ImportedListing } from "../../src/shared/schemas";
import { parse591Detail, parse591List } from "../../collector/sources/five91";

const fx = (name: string) => fs.readFileSync(path.join(import.meta.dirname, "..", "fixtures", name), "utf8");

describe("591 list", () => {
  it("extracts 30 detail urls from JSON-LD", () => {
    const urls = parse591List(fx("591-list.html"));
    expect(urls.length).toBe(30);
    expect(urls[0]).toMatch(/^https:\/\/rent\.591\.com\.tw\/\d+$/);
  });
});

describe("591 detail", () => {
  const url = "https://rent.591.com.tw/21718755";
  const raw = parse591Detail(fx("591-detail.html"), url);

  it("passes the shared schema", () => {
    const r = ImportedListing.safeParse(raw);
    expect(r.success, JSON.stringify(r.success ? null : r.error.issues)).toBe(true);
  });

  it("maps the main fields", () => {
    expect(raw).toMatchObject({
      title: "大三房*前後陽台*近學區",
      city: "台北市",
      district: "大安區",
      road: "安居街124巷",
      rent: 30000,
      size_ping: 22,
      rooms: 3,
      living_rooms: 2,
      bathrooms: 1,
      floor: 3,
      total_floors: 3,
      building_age: 61,
      building_type: "公寓",
      kind: "整層住家",
      has_elevator: false,
      has_parking: false,
      has_washer: false,
      pet_allowed: false,
      cooking_allowed: true,
      mgmt_fee: 0,
      deposit_months: 2,
      source: "591",
      source_listing_id: "21718755",
      source_url: url,
      contact_phone: "0958-863-047",
      status: "active",
    });
    expect(raw.lat).toBeCloseTo(25.01838, 4);
    expect(raw.lng).toBeCloseTo(121.55152, 4);
    expect(raw.photos.length).toBeGreaterThan(5);
    expect(raw.contact_line).toMatch(/^https:\/\/line\.me\//);
    const extra = JSON.parse(raw.raw_json!);
    expect(extra.mrt).toEqual({ name: "六張犁站", distance_m: 626 });
    expect(extra.market_hint).toContain("市價");
  });

  it("rejects a non-591 url", () => {
    expect(() => parse591Detail("<html></html>", "https://example.com/1")).toThrow();
  });
});
