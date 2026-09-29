import { daysBetween, NEW_LISTING_DAYS, summarizePrice, type PriceSummary } from "@shared/listing";
import type { PropertySummary } from "@shared/schemas";

export interface ListingAge {
  days: number;
  /** posted = 來源寫的刊登日;seen = 我們第一次看到(實際只會更久) */
  kind: "posted" | "seen";
  isNew: boolean;
}

export function ageOf(p: Pick<PropertySummary, "posted_at" | "first_seen_at">, now = new Date()): ListingAge | null {
  if (p.posted_at) {
    const days = daysBetween(p.posted_at, now);
    return { days, kind: "posted", isNew: days <= NEW_LISTING_DAYS };
  }
  if (p.first_seen_at) {
    const days = daysBetween(p.first_seen_at, now);
    // 只知道收錄日時,「新」只在收錄當週,而且它可能早就在架上了,所以不標新
    return { days, kind: "seen", isNew: false };
  }
  return null;
}

export function priceOf(p: Pick<PropertySummary, "price_history">): PriceSummary | null {
  return summarizePrice(p.price_history ?? []);
}

export const fmtMoney = (n: number) => `$${Math.abs(n).toLocaleString()}`;
