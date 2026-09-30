import fs from "node:fs";
import path from "node:path";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";
import { extractFacts, parseImportHash } from "../../src/shared/bookmarklet";
import { PropertyInput } from "../../src/shared/schemas";
import { extractNuxt, parse591Detail } from "../../collector/sources/five91";

const html = fs.readFileSync(path.join(import.meta.dirname, "..", "fixtures", "591-detail.html"), "utf8");
const url = "https://rent.591.com.tw/21718755";

describe("書籤小工具", () => {
  const facts = extractFacts(extractNuxt(html), url)!;

  it("跟採集 parser 讀到一樣的事實欄位", () => {
    const full = parse591Detail(html, url);
    const same = ["title", "city", "district", "road", "lat", "lng", "kind", "building_type", "floor", "total_floors", "building_age", "size_ping", "rooms", "rent", "has_elevator", "pet_allowed", "cooking_allowed", "mgmt_fee", "utilities_note", "deposit_months", "source_url"] as const;
    for (const k of same) expect(facts[k], k).toEqual(full[k]);
    expect(PropertyInput.safeParse(facts).success).toBe(true);
  });

  it("不帶照片、屋況文字、聯絡人", () => {
    for (const k of ["photos", "raw_json", "contact_name", "contact_phone", "contact_line", "note"]) expect(facts).not.toHaveProperty(k);
  });

  it("不是 591 / 沒資料回 null", () => {
    expect(extractFacts({}, url)).toBeNull();
    expect(extractFacts(extractNuxt(html), "https://example.com/1")).toBeNull();
  });

  it("javascript: 網址自成一體(轉成 JS 後只靠自己也能跑)", () => {
    // 前端建置後函式原始碼是 JS;這裡用 esbuild 轉一次再從字串重建,確認沒有引用外面的東西
    const js = transformSync(`export ${extractFacts.toString()}`, { loader: "ts" }).code.replace(/^export /, "");
    const rebuilt = new Function(`return (${js})`)() as typeof extractFacts;
    expect(rebuilt(extractNuxt(html), url)).toEqual(facts);
  });

  it("/new#import= 解回來", () => {
    expect(parseImportHash(`#import=${encodeURIComponent(JSON.stringify(facts))}`)).toEqual(facts);
    expect(parseImportHash("#import=%7Bbad")).toBeNull();
    expect(parseImportHash("")).toBeNull();
  });
});
