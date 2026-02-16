import { describe, expect, it } from "vitest";
import { enrichResearchRecords } from "../src/providers/enrichment";
import { renderResearch, renderShopping, type ShoppingOffer } from "../src/providers/renderer";
import { filterByTimebox, isWithinTimebox, resolveTimebox } from "../src/providers/timebox";
import type { NormalizedRecord } from "../src/providers/types";

const makeRecord = (overrides: Partial<NormalizedRecord> = {}): NormalizedRecord => ({
  id: "rec-1",
  source: "web",
  provider: "web/default",
  url: "https://example.com/a",
  title: "A",
  content: "alpha",
  timestamp: "2026-02-10T00:00:00.000Z",
  confidence: 0.7,
  attributes: {},
  ...overrides
});

describe("workflow primitives", () => {
  it("resolves strict timebox semantics and rejects invalid combinations", () => {
    const now = new Date("2026-02-16T00:00:00.000Z");

    const byDays = resolveTimebox({ days: 7, now });
    expect(byDays).toMatchObject({ mode: "days", days: 7, applied: true });

    const byRange = resolveTimebox({ from: "2026-02-01T00:00:00.000Z", to: "2026-02-10T00:00:00.000Z", now });
    expect(byRange).toMatchObject({ mode: "range", applied: true });

    const fromOnly = resolveTimebox({ from: "2026-02-01T00:00:00.000Z", now });
    expect(fromOnly.to).toBe(now.toISOString());

    expect(() => resolveTimebox({ to: "2026-02-10T00:00:00.000Z", now })).toThrow("to cannot be provided");
    expect(() => resolveTimebox({ days: 3, from: "2026-02-01T00:00:00.000Z", now })).toThrow("days cannot be combined");
    expect(() => resolveTimebox({ from: "2026-02-10T00:00:00.000Z", to: "2026-02-01T00:00:00.000Z", now })).toThrow("from cannot be later");
  });

  it("filters records by resolved timebox and handles invalid timestamps", () => {
    const timebox = resolveTimebox({ from: "2026-02-01T00:00:00.000Z", to: "2026-02-10T00:00:00.000Z" });
    const inside = makeRecord({ id: "inside", timestamp: "2026-02-05T00:00:00.000Z" });
    const outside = makeRecord({ id: "outside", timestamp: "2026-03-01T00:00:00.000Z" });
    const invalid = makeRecord({ id: "invalid", timestamp: "not-a-date" });

    expect(isWithinTimebox(inside.timestamp, timebox)).toBe(true);
    expect(isWithinTimebox(outside.timestamp, timebox)).toBe(false);
    expect(isWithinTimebox(invalid.timestamp, timebox)).toBe(false);

    const filtered = filterByTimebox([inside, outside, invalid], timebox);
    expect(filtered.map((record) => record.id)).toEqual(["inside"]);
  });

  it("includes slight post-to timestamps in days mode for filtering and recency metadata", () => {
    const now = new Date("2026-02-16T00:00:00.000Z");
    const timebox = resolveTimebox({ days: 1, now });
    const justAfterTo = new Date(new Date(timebox.to).getTime() + 1).toISOString();
    const evaluationNow = new Date(new Date(timebox.to).getTime() + 5);
    const record = makeRecord({ id: "days-upper-bound", timestamp: justAfterTo });

    const filtered = filterByTimebox([record], timebox, evaluationNow);
    expect(filtered.map((item) => item.id)).toEqual(["days-upper-bound"]);

    const enriched = enrichResearchRecords([record], timebox, evaluationNow);
    expect(enriched[0]?.recency.within_timebox).toBe(true);
  });

  it("covers timebox validation fallbacks and empty timestamp checks", () => {
    expect(() => resolveTimebox({ from: "invalid-date" })).toThrow("Invalid from date");
    expect(() => resolveTimebox({ days: 0 })).toThrow("days must be a positive number");

    const fallback = resolveTimebox({});
    expect(fallback).toMatchObject({ mode: "days", days: 30, applied: true });
    expect(isWithinTimebox(undefined, fallback)).toBe(false);
  });

  it("enriches records with engagement, recency, and date confidence metadata", () => {
    const timebox = resolveTimebox({ from: "2026-02-01T00:00:00.000Z", to: "2026-02-20T00:00:00.000Z" });
    const enriched = enrichResearchRecords([
      makeRecord({
        id: "engagement-nested",
        attributes: {
          engagement: {
            likes: 12,
            comments: "5",
            views: 100,
            upvotes: 3
          }
        }
      }),
      makeRecord({
        id: "engagement-root",
        timestamp: "invalid",
        attributes: {
          likes: "9",
          comments: 2,
          views: 30,
          upvotes: "1"
        }
      })
    ], timebox, new Date("2026-02-16T00:00:00.000Z"));

    expect(enriched[0]?.engagement).toEqual({ likes: 12, comments: 5, views: 100, upvotes: 3 });
    expect(enriched[0]?.recency.within_timebox).toBe(true);
    expect(enriched[0]?.date_confidence.source).toBe("explicit");

    expect(enriched[1]?.engagement).toEqual({ likes: 9, comments: 2, views: 30, upvotes: 1 });
    expect(enriched[1]?.recency.within_timebox).toBe(false);
    expect(enriched[1]?.date_confidence.source).toBe("missing");

    expect(enriched[0]?.attributes.date_confidence).toMatchObject({ source: "explicit" });
  });

  it("handles inferred dates and non-numeric engagement fields", () => {
    const timebox = resolveTimebox({ from: "2026-02-01T00:00:00.000Z", to: "2026-02-20T00:00:00.000Z" });
    const [inferred] = enrichResearchRecords([
      makeRecord({
        id: "inferred-date",
        timestamp: "invalid",
        attributes: {
          published_at: "2026-02-05T00:00:00.000Z",
          likes: "not-a-number",
          engagement: {
            comments: "bad"
          }
        }
      })
    ], timebox, new Date("2026-02-16T00:00:00.000Z"));

    expect(inferred?.date_confidence.source).toBe("inferred");
    expect(inferred?.engagement.likes).toBe(0);
    expect(inferred?.engagement.comments).toBe(0);
  });

  it("omits optional content when the source record has no content", () => {
    const timebox = resolveTimebox({ from: "2026-02-01T00:00:00.000Z", to: "2026-02-20T00:00:00.000Z" });
    const [record] = enrichResearchRecords([
      makeRecord({
        id: "missing-content",
        content: undefined
      })
    ], timebox, new Date("2026-02-16T00:00:00.000Z"));

    expect(record).toBeDefined();
    expect("content" in (record as object)).toBe(false);
  });

  it("renders research payloads for all output modes", () => {
    const records = enrichResearchRecords([
      makeRecord({ id: "r1", source: "community", provider: "community/default" })
    ], resolveTimebox({ days: 7, now: new Date("2026-02-16T00:00:00.000Z") }));

    for (const mode of ["compact", "json", "md", "context", "path"] as const) {
      const rendered = renderResearch({
        mode,
        topic: "agentic systems",
        records,
        meta: { selection: { source_selection: "auto" } }
      });

      expect(rendered.files.map((file) => file.path)).toEqual([
        "summary.md",
        "records.json",
        "context.json",
        "meta.json"
      ]);
      expect(rendered.response.mode).toBe(mode === "path" ? "path" : mode);
    }
  });

  it("renders shopping payloads and comparison matrix", () => {
    const offers: ShoppingOffer[] = [{
      offer_id: "o1",
      product_id: "p1",
      provider: "shopping/amazon",
      url: "https://amazon.com/item",
      title: "Item 1",
      price: { amount: 19.99, currency: "USD", retrieved_at: "2026-02-16T00:00:00.000Z" },
      shipping: { amount: 2.5, currency: "USD", notes: "std" },
      availability: "in_stock",
      rating: 4.4,
      reviews_count: 120,
      deal_score: 0.85,
      attributes: {}
    }];

    const rendered = renderShopping({
      mode: "md",
      query: "usb microphone",
      offers,
      meta: { providers: ["shopping/amazon"] }
    });

    expect(rendered.files.map((file) => file.path)).toContain("comparison.csv");
    const csv = rendered.files.find((file) => file.path === "comparison.csv")?.content as string;
    expect(csv).toContain("shopping/amazon");
    expect(rendered.response).toMatchObject({ mode: "md", markdown: expect.any(String) });
  });

  it("renders empty/fallback records and shopping context mode", () => {
    const records = enrichResearchRecords([
      makeRecord({
        id: "fallback-title",
        title: undefined,
        url: undefined,
        source: "social",
        provider: "social/youtube"
      })
    ], resolveTimebox({ days: 7, now: new Date("2026-02-16T00:00:00.000Z") }));

    const compact = renderResearch({
      mode: "compact",
      topic: "empty-title",
      records,
      meta: {}
    });
    expect(String(compact.response.summary)).toContain("social/youtube");

    const shoppingContext = renderShopping({
      mode: "context",
      query: "none",
      offers: [],
      meta: {}
    });
    expect(shoppingContext.response).toMatchObject({ mode: "context" });
    expect(String(shoppingContext.files.find((file) => file.path === "deals.md")?.content ?? "")).toContain("No offers available");
  });
});
