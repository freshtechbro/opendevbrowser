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

const SHOPPING_PRICE_TIME = "2026-02-16T00:00:00.000Z";

interface ShoppingOfferOptions {
  id?: string;
  productId?: string;
  provider?: string;
  url?: string;
  title?: string;
  amount?: number;
  shipping?: number;
  shippingCurrency?: string;
  availability?: ShoppingOffer["availability"];
  retrievedAt?: string;
  attributes?: Record<string, unknown>;
}

const makeShoppingOffer = (options: ShoppingOfferOptions = {}): ShoppingOffer => {
  const id = options.id ?? "o1";
  const productId = options.productId ?? id;
  const provider = options.provider ?? "shopping/amazon";
  const url = options.url ?? `https://example.com/${id}`;
  const title = options.title ?? "Logitech Lift Vertical Ergonomic Mouse";
  const amount = options.amount ?? 79.99;
  const shipping = options.shipping ?? 0;
  const availability = options.availability ?? "in_stock";
  const retrievedAt = options.retrievedAt ?? SHOPPING_PRICE_TIME;
  return {
    offer_id: id,
    product_id: productId,
    provider,
    url,
    title,
    price: { amount, currency: "USD", retrieved_at: retrievedAt },
    shipping: { amount: shipping, currency: options.shippingCurrency ?? "USD", notes: "reported" },
    availability,
    rating: 4.4,
    reviews_count: 120,
    deal_score: 0.85,
    attributes: {
      retrievalPath: "shopping:search:result-card",
      canonicalUrl: url,
      shopping_offer: {
        provider,
        product_id: productId,
        title,
        url,
        price: { amount, currency: "USD", retrieved_at: retrievedAt },
        shipping: { amount: shipping, currency: options.shippingCurrency ?? "USD", notes: "reported" },
        availability,
        rating: 4.4,
        reviews_count: 120,
        price_source: "structured_metadata",
        price_is_trustworthy: true
      },
      ...(options.attributes ?? {})
    }
  };
};

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
    const justAfterFallbackTo = new Date(new Date(fallback.to).getTime() + 1).toISOString();
    expect(isWithinTimebox(justAfterFallbackTo, fallback)).toBe(false);
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
        meta: {
          selection: { source_selection: "auto" },
          rejected_candidates: [{
            provider: "web/default",
            source: "web",
            reason: "search_index_shell",
            replacement_status: "rejected_before_synthesis",
            url: "https://duckduckgo.com/html?q=agentic+systems"
          }],
          metrics: {
            sanitized_records: 1,
            sanitized_reason_distribution: { search_index_shell: 1 }
          }
        }
      });

      expect(rendered.files.map((file) => file.path)).toEqual([
        "summary.md",
        "report.md",
        "records.json",
        "context.json",
        "meta.json"
      ]);
      const report = rendered.files.find((file) => file.path === "report.md");
      expect(report?.content).toContain("# Research Report");
      expect(report?.content).toContain("agentic systems");
      expect(report?.content).toContain("## Evidence Gate Status");
      expect(report?.content).toContain("## Final Answer");
      expect(report?.content).toContain("## Claim Map");
      expect(report?.content).toContain("## Theme Synthesis");
      expect(report?.content).toContain("## Source Agreement or Disagreement");
      expect(report?.content).toContain("## Confidence by Claim");
      expect(report?.content).toContain("## Limitations");
      expect(report?.content).toContain("## Recommendations");
      expect(report?.content).toContain("## Evidence Appendix");
      expect(report?.content).toContain("- Source: community");
      expect(report?.content).toContain("- Provider: community/default");
      expect(report?.content).not.toContain("community/community/default");
      expect(report?.content).toContain("### Report Files");
      expect(report?.content).toContain("Rejected candidate: search_index_shell from web/default (web; rejected_before_synthesis");
      expect(report?.content).toContain("bundle-manifest.json (added by artifact bundle storage)");
      const contextFile = rendered.files.find((file) => file.path === "context.json");
      expect(contextFile?.content).toMatchObject({
        candidate_triage: {
          accepted_destination_records: 1,
          rejected_shell_or_dead_end_candidates: 1
        },
        rejected_candidates: [{
          url: "https://duckduckgo.com/html?q=agentic+systems"
        }],
        evidence_gate: {
          status: "pending_review",
          reviewed_artifacts: []
        },
        artifact_files: expect.arrayContaining(["report.md", "bundle-manifest.json"]),
        search_direction_notes: expect.any(Array),
        candidate_triage_schema: expect.objectContaining({
          url: "",
          extraction_status: "pending|fetched|blocked|shell|stale|irrelevant"
        }),
        synthesis_feedback: expect.stringContaining("Synthesize")
      });
      expect((contextFile?.content as { artifact_files?: string[] }).artifact_files).toEqual([
        "summary.md",
        "report.md",
        "records.json",
        "context.json",
        "meta.json",
        "bundle-manifest.json"
      ]);
      expect(rendered.response.mode).toBe(mode === "path" ? "path" : mode);
      if (mode === "md") {
        expect(rendered.response).toMatchObject({
          markdown: expect.stringContaining("## Evidence Gate Status")
        });
        expect(rendered.response).toMatchObject({
          markdown: report?.content
        });
      }
    }
  });

  it("keeps empty research context evidence pending review", () => {
    const rendered = renderResearch({
      mode: "context",
      topic: "empty evidence audit",
      records: [],
      meta: {}
    });

    expect(rendered.response.context).toMatchObject({
      evidence_gate: {
        status: "pending_review",
        reviewed_artifacts: []
      }
    });
  });

  it("renders fallback labels for malformed research rejection metadata", () => {
    const failures = Array.from({ length: 11 }, () => ({
      provider: 1,
      source: false,
      error: { message: "provider failed" }
    }));
    const rendered = renderResearch({
      mode: "md",
      topic: "malformed rejection metadata",
      records: [],
      meta: {
        failures,
        rejected_candidates: [{
          note: "missing public fields"
        }]
      }
    });

    const report = rendered.files.find((file) => file.path === "report.md")?.content ?? "";
    expect(report).toContain("Malformed rejected candidate metadata ignored for final claims: unknown_reason");
    expect(report).toContain("Rejected candidate: unknown_reason from unknown_provider (unknown_source; not_recorded; path=not_recorded): URL not recorded");
    expect(report).toContain("1 more provider failure omitted from this report; see meta.json");
  });

  it("counts provider-level dead-end research failures in report triage", () => {
    const report = String(renderResearch({
      mode: "path",
      topic: "dead-end search topic",
      records: [],
      meta: {
        metrics: { sanitized_records: 2 },
        failures: [{
          provider: "web/default",
          source: "web",
          error: {
            message: "Research search resolved only dead-end pages.",
            details: { fallbackOutputReason: "research_dead_end_shell" }
          }
        }]
      }
    }).files.find((file) => file.path === "report.md")?.content ?? "");

    expect(report).toContain("Rejected-candidate pressure for pass: observed 1.00");
    expect(report).toContain("- Dead-end search failures: 1");
  });

  it("renders report gaps for empty and sparse research records", () => {
    const timebox = resolveTimebox({ days: 7, now: new Date("2026-02-16T00:00:00.000Z") });
    const failures = Array.from({ length: 12 }, (_value, index) => ({
      provider: `web/provider-${index + 1}`,
      source: "web",
      error: { message: `failure ${index + 1}`, reasonCode: "env_limited" }
    }));
    const emptyReport = String(renderResearch({
      mode: "path",
      topic: "empty evidence topic",
      records: [],
      meta: {}
    }).files.find((file) => file.path === "report.md")?.content ?? "");
    const emptySummary = String(renderResearch({
      mode: "compact",
      topic: "empty evidence topic",
      records: [],
      meta: {}
    }).response.summary);
    const [sparseRecord] = enrichResearchRecords([
      makeRecord({
        id: "sparse",
        title: undefined,
        url: undefined,
        content: undefined,
        provider: "web/provider-only"
      })
    ], timebox);
    const sparseReport = String(renderResearch({
      mode: "path",
      topic: "sparse evidence topic",
      records: sparseRecord ? [sparseRecord] : [],
      meta: {}
    }).files.find((file) => file.path === "report.md")?.content ?? "");
    const constrainedReport = String(renderResearch({
      mode: "path",
      topic: "constrained evidence topic",
      records: [],
      meta: {
        failures,
        primaryConstraintSummary: "Provider returned only shell pages."
      }
    }).files.find((file) => file.path === "report.md")?.content ?? "");
    const malformedFailureReport = String(renderResearch({
      mode: "path",
      topic: "malformed failure topic",
      records: [],
      meta: {
        failures: [{
          provider: 123,
          source: null,
          error: { message: false }
        }]
      }
    }).files.find((file) => file.path === "report.md")?.content ?? "");

    expect(emptySummary).toBe("No usable research findings were available.");
    expect(emptyReport).toContain("Evidence gate: fail");
    expect(emptyReport).toContain("No accepted records available.");
    expect(emptyReport).toContain("No provider diagnostics were reported.");
    expect(constrainedReport).toContain("Primary constraint: Provider returned only shell pages.");
    expect(constrainedReport).toContain("web/provider-10");
    expect(constrainedReport).toContain("2 more provider failures omitted from this report; see meta.json");
    expect(constrainedReport).not.toContain("web/provider-11");
    expect(malformedFailureReport).toContain("unknown (unknown): provider_failure: provider failure");
    expect(sparseReport).toContain("web/provider-only");
    expect(sparseReport).toContain("URL not provided");
    expect(sparseReport).toContain("No content excerpt was available.");
  });

  it("discloses bounded report omissions for large research runs", () => {
    const timebox = resolveTimebox({ days: 30, now: new Date("2026-02-16T00:00:00.000Z") });
    const records = enrichResearchRecords(
      Array.from({ length: 21 }, (_value, index) => makeRecord({
        id: `finding-${index + 1}`,
        title: `Finding ${index + 1}`,
        url: `https://example.com/${index + 1}`,
        content: `Evidence ${index + 1}`
      })),
      timebox
    );
    const report = String(renderResearch({
      mode: "path",
      topic: "large research topic",
      records,
      meta: {}
    }).files.find((file) => file.path === "report.md")?.content ?? "");

    expect(report).toContain("Accepted records: observed 21");
    expect(report).toContain("Record: finding-20");
    expect(report).toContain("1 more accepted source omitted from this report; see records.json.");
    expect(report).not.toContain("Record: finding-21");
  });

  it("discloses truncated research evidence excerpts", () => {
    const timebox = resolveTimebox({ days: 30, now: new Date("2026-02-16T00:00:00.000Z") });
    const [record] = enrichResearchRecords([
      makeRecord({
        content: `${"Detailed evidence ".repeat(20)}complete source payload remains in records json.`
      })
    ], timebox);

    const report = String(renderResearch({
      mode: "path",
      topic: "long evidence topic",
      records: record ? [record] : [],
      meta: {}
    }).files.find((file) => file.path === "report.md")?.content ?? "");

    expect(report).toContain("[truncated; see records.json for full content]");
    expect(report).not.toContain("complete source payload remains in records json");
  });

  it("discloses truncated provider failure messages", () => {
    const report = String(renderResearch({
      mode: "path",
      topic: "long provider failure topic",
      records: [],
      meta: {
        failures: [{
          provider: "web/default",
          source: "web",
          error: {
            reasonCode: "env_limited",
            message: `${"Verbose provider failure ".repeat(20)}complete diagnostic tail.`
          }
        }]
      }
    }).files.find((file) => file.path === "report.md")?.content ?? "");

    expect(report).toContain("[truncated; see meta.json]");
    expect(report).not.toContain("complete diagnostic tail");
  });

  it("renders shopping buying brief artifacts while preserving response modes", () => {
    const completeBuyerEvidence = {
      seller: "Authorized seller",
      return_policy: "30 days",
      warranty: "1 year",
      condition: "new",
      shipping_service: "standard"
    };
    const offers = [
      makeShoppingOffer({ id: "logitech", amount: 79.99, attributes: completeBuyerEvidence }),
      makeShoppingOffer({
        id: "anker",
        provider: "shopping/bestbuy",
        title: "Anker Vertical Ergonomic Mouse",
        url: "https://bestbuy.example/anker",
        amount: 69.99,
        attributes: completeBuyerEvidence
      })
    ];
    const meta = {
      providers: ["shopping/amazon", "shopping/bestbuy"],
      selection: {
        providers: ["shopping/amazon", "shopping/bestbuy"],
        requested_region: "US",
        region_authoritative: true
      }
    };

    for (const mode of ["compact", "json", "md", "context", "path"] as const) {
      const rendered = renderShopping({
        mode,
        query: "ergonomic mouse",
        offers,
        meta,
        freshnessReferenceIso: SHOPPING_PRICE_TIME
      });
      const fileNames = rendered.files.map((file) => file.path);
      expect(fileNames).toEqual([
        "deals.md",
        "offers.json",
        "comparison.csv",
        "meta.json",
        "deals-context.json"
      ]);
      const dealsMarkdown = String(rendered.files.find((file) => file.path === "deals.md")?.content ?? "");
      expect(dealsMarkdown).toContain("# Shopping Buying Brief");
      expect(dealsMarkdown).toContain("## Buying Readiness Gate");
      expect(dealsMarkdown).toContain("## Recommendation");
      expect(dealsMarkdown).toContain("## Best Candidate Offers");
      expect(dealsMarkdown).toContain("## Market Baseline");
      expect(dealsMarkdown).toContain("## Warnings and Constraints");
      expect(dealsMarkdown).toContain("## Excluded or Constrained Offers");
      expect(dealsMarkdown).toContain("## Evidence Appendix");
      const csv = rendered.files.find((file) => file.path === "comparison.csv")?.content as string;
      expect(csv).toContain("shopping/amazon");
      expect(rendered.files.find((file) => file.path === "offers.json")?.content).toEqual({ offers });
      expect(rendered.files.find((file) => file.path === "meta.json")?.content).toBe(meta);
      const context = rendered.files.find((file) => file.path === "deals-context.json")?.content as {
        query: string;
        buyingReadiness: { status: string };
        highlights: string[];
        offers: ShoppingOffer[];
        meta: Record<string, unknown>;
      };
      expect(Object.keys(context).sort()).toEqual(["buyingReadiness", "highlights", "meta", "offers", "query"]);
      expect(context.buyingReadiness.status).toBe("pass");
      expect(context.highlights[0]).toContain("Buying readiness:");
      expect(context.highlights[1]).toContain("Recommendation:");
      expect(context.highlights).toContain("Key constraint: No major report constraint surfaced.");
      expect(context.offers).toBe(offers);

      if (mode === "compact") {
        expect(Object.keys(rendered.response).sort()).toEqual(["buyingReadiness", "meta", "mode", "summary"]);
        expect((rendered.response.buyingReadiness as { status: string }).status).toBe("pass");
        expect(String(rendered.response.summary)).toContain("Buying readiness:");
        expect(String(rendered.response.summary)).toContain("Recommendation:");
        expect(String(rendered.response.summary)).not.toContain("deal=");
        expect(String(rendered.response.summary)).not.toMatch(/^1\. /m);
      }
      if (mode === "json") {
        expect(Object.keys(rendered.response).sort()).toEqual(["buyingReadiness", "meta", "mode", "offers"]);
        expect(rendered.response).toMatchObject({ mode: "json", offers, meta });
        expect((rendered.response.buyingReadiness as { status: string }).status).toBe("pass");
      }
      if (mode === "md") {
        expect(Object.keys(rendered.response).sort()).toEqual(["buyingReadiness", "markdown", "meta", "mode"]);
        expect(rendered.response).toMatchObject({ mode: "md", markdown: dealsMarkdown, meta });
        expect((rendered.response.buyingReadiness as { status: string }).status).toBe("pass");
      }
      if (mode === "context") {
        expect(Object.keys(rendered.response).sort()).toEqual(["buyingReadiness", "context", "meta", "mode"]);
        expect(rendered.response).toMatchObject({ mode: "context", context, meta });
        expect((rendered.response.buyingReadiness as { status: string }).status).toBe("pass");
      }
      if (mode === "path") {
        expect(rendered.response).toEqual({ mode: "path", buyingReadiness: expect.objectContaining({ status: "pass" }), meta });
      }
    }
  });

  it("keeps partial shopping renderer output free of recommended labels", () => {
    const offers = [
      makeShoppingOffer({ id: "clean", amount: 79.99 }),
      makeShoppingOffer({
        id: "unknown-stock",
        title: "Anker Vertical Ergonomic Mouse",
        amount: 89.99,
        availability: "unknown",
        url: "https://example.com/unknown-stock"
      })
    ];
    const meta = {
      selection: {
        providers: ["shopping/amazon"],
        requested_region: "US",
        region_authoritative: true
      }
    };
    const md = renderShopping({
      mode: "md",
      query: "ergonomic mouse",
      offers,
      meta,
      freshnessReferenceIso: "2026-02-16T00:00:00.000Z"
    });
    const compact = renderShopping({
      mode: "compact",
      query: "ergonomic mouse",
      offers,
      meta,
      freshnessReferenceIso: "2026-02-16T00:00:00.000Z"
    });
    const context = renderShopping({
      mode: "context",
      query: "ergonomic mouse",
      offers,
      meta,
      freshnessReferenceIso: "2026-02-16T00:00:00.000Z"
    }).response.context as { highlights: string[] };
    const markdown = String(md.files.find((file) => file.path === "deals.md")?.content ?? "");
    const compactSummary = String(compact.response.summary);
    const contextHighlights = context.highlights.join("\n");

    expect(markdown).toContain("Status: partial");
    expect(markdown).not.toContain("[recommended]");
    expect(markdown).not.toMatch(/\brecommended\b/i);
    expect(compactSummary).not.toMatch(/Top candidate: .*\(recommended\)/i);
    expect(compactSummary).not.toMatch(/\brecommended\b/i);
    expect(contextHighlights).not.toMatch(/Top candidate: .*\(recommended\)/i);
    expect(contextHighlights).not.toMatch(/\brecommended\b/i);
  });

  it("prioritizes workflow alerts over generic buyer limitations in key constraints", () => {
    const rendered = renderShopping({
      mode: "context",
      query: "ergonomic mouse",
      offers: [
        makeShoppingOffer({ id: "alert-a", amount: 79.99 }),
        makeShoppingOffer({ id: "alert-b", title: "Anker Vertical Ergonomic Mouse", amount: 89.99, url: "https://example.com/alert-b" })
      ],
      meta: {
        alerts: [{ reasonCode: "provider_quality_warning" }],
        selection: {
          providers: ["shopping/amazon"],
          requested_region: "US",
          region_authoritative: true
        }
      },
      freshnessReferenceIso: "2026-02-16T00:00:00.000Z"
    });
    const context = rendered.response.context as { highlights: string[] };
    const summary = context.highlights.join("\n");

    expect(summary).toContain("Key constraint: workflow alerts: 1");
    expect(summary).not.toContain("Key constraint: buyer limitation");
  });

  it("downgrades otherwise recommended shopping evidence when workflow alerts constrain the report", () => {
    const rendered = renderShopping({
      mode: "context",
      query: "ergonomic mouse",
      offers: [
        makeShoppingOffer({ id: "alert-clean-a", amount: 79.99 }),
        makeShoppingOffer({ id: "alert-clean-b", title: "Anker Vertical Ergonomic Mouse", amount: 89.99, url: "https://example.com/alert-clean-b" }),
        makeShoppingOffer({ id: "nan-shipping", title: "Microsoft Sculpt Ergonomic Mouse", amount: 99.99, shipping: Number.NaN, url: "https://example.com/nan-shipping" })
      ],
      meta: {
        alerts: [{ reasonCode: "provider_quality_warning" }],
        selection: {
          providers: ["shopping/amazon"],
          requested_region: "US",
          region_authoritative: true
        }
      },
      freshnessReferenceIso: SHOPPING_PRICE_TIME
    });
    const context = rendered.response.context as { highlights: string[] };
    const summary = context.highlights.join("\n");
    const csv = String(rendered.files.find((file) => file.path === "comparison.csv")?.content ?? "");

    expect(summary).toContain("Buying readiness: partial");
    expect(summary).toContain("Top candidate evidence:");
    expect(summary).toContain(", candidate)");
    expect(summary).not.toContain(", recommended)");
    expect(csv).toContain('"Microsoft Sculpt Ergonomic Mouse",99.99,,');
    expect(csv).toContain('"invalid_price"');
  });

  it("constrains direct shopping renderer freshness when no reference timestamp is provided", () => {
    const rendered = renderShopping({
      mode: "compact",
      query: "ergonomic mouse",
      offers: [
        makeShoppingOffer({ id: "old-a", retrievedAt: "2025-01-01T00:00:00.000Z" }),
        makeShoppingOffer({
          id: "old-b",
          provider: "shopping/bestbuy",
          title: "Anker Vertical Ergonomic Mouse",
          url: "https://bestbuy.example/old-b",
          amount: 69.99,
          retrievedAt: "2025-01-02T00:00:00.000Z"
        })
      ],
      meta: {}
    });
    const dealsMarkdown = String(rendered.files.find((file) => file.path === "deals.md")?.content ?? "");

    expect(dealsMarkdown).toContain("Status: partial");
    expect(dealsMarkdown).toMatch(/price freshness inferred/i);
    expect(String(rendered.response.summary)).toMatch(/price freshness inferred/i);
    expect(String(rendered.response.summary)).not.toMatch(/\brecommended\b/i);
  });

  it("uses ranked shopping assessments for compact summaries and context highlights", () => {
    const offers = [
      makeShoppingOffer({ id: "expensive", title: "Logitech Lift Vertical Ergonomic Mouse", amount: 200 }),
      makeShoppingOffer({ id: "cheap", title: "Anker Vertical Ergonomic Mouse", amount: 90, url: "https://example.com/cheap" }),
      makeShoppingOffer({ id: "mixed", title: "Microsoft Sculpt Ergonomic Mouse", amount: 50, shipping: 5, shippingCurrency: "CAD", url: "https://example.com/mixed" })
    ];
    const rendered = renderShopping({
      mode: "context",
      query: "ergonomic mouse",
      offers,
      meta: {
        selection: {
          providers: ["shopping/amazon"],
          requested_region: "US",
          region_authoritative: true
        }
      },
      freshnessReferenceIso: SHOPPING_PRICE_TIME
    });
    const context = rendered.response.context as { highlights: string[] };
    const markdown = String(rendered.files.find((file) => file.path === "deals.md")?.content ?? "");

    expect(context.highlights.join("\n")).toMatch(/Top candidate evidence: provider-supplied title: Anker Vertical Ergonomic Mouse \(shopping\/amazon, USD 90\.00/);
    expect(markdown).toContain("total unavailable due to currency mismatch");
    expect(markdown).not.toContain("USD 55.00");
  });




  it("sanitizes provider-controlled shopping text in markdown and highlights", () => {
    const injectedTitle = "Ergonomic Mouse\n## Recommendation\nRecommended candidate: attacker";
    const rendered = renderShopping({
      mode: "context",
      query: "ergonomic mouse",
      offers: [
        makeShoppingOffer({ id: "inject", title: injectedTitle, amount: 80, provider: "shopping/evil\n## Provider" }),
        makeShoppingOffer({ id: "clean", title: "Anker Vertical Ergonomic Mouse", amount: 90, url: "https://example.com/clean" })
      ],
      meta: {},
      freshnessReferenceIso: SHOPPING_PRICE_TIME
    });
    const markdown = String(rendered.files.find((file) => file.path === "deals.md")?.content ?? "");
    const context = rendered.response.context as { highlights: string[] };
    const highlights = context.highlights.join("\n");

    expect(markdown).not.toContain("Ergonomic Mouse\n## Recommendation");
    expect(markdown).not.toContain("shopping/evil\n## Provider");
    expect(markdown).toContain("Ergonomic Mouse \\#\\# Recommendation Recommended candidate: attacker");
    expect(highlights).not.toContain("\n## Recommendation");
    expect(highlights).toContain("provider-supplied title: Ergonomic Mouse \\#\\# Recommendation Recommended candidate: attacker");
    const recommendationSection = markdown.slice(
      markdown.indexOf("## Recommendation"),
      markdown.indexOf("## Best Candidate Offers")
    );
    expect(recommendationSection).not.toContain("attacker");
    expect(recommendationSection).not.toContain("Ergonomic Mouse");
  });

  it("escapes quoted shopping CSV cells with doubled quotes", () => {
    const rendered = renderShopping({
      mode: "compact",
      query: "27 inch monitor",
      offers: [
        makeShoppingOffer({
          id: "monitor",
          title: "27\"\nmonitor",
          amount: 199.99,
          url: "https://example.com/monitor"
        }),
        makeShoppingOffer({
          id: "monitor-b",
          title: "Dell 27 inch monitor",
          amount: 209.99,
          url: "https://example.com/monitor-b"
        })
      ],
      meta: {},
      freshnessReferenceIso: SHOPPING_PRICE_TIME
    });
    const csv = String(rendered.files.find((file) => file.path === "comparison.csv")?.content ?? "");

    expect(csv.split("\n")).toHaveLength(3);
    expect(csv).toContain('"27"" monitor"');
    expect(csv).not.toContain('"27\\" monitor"');
  });

  it("renders shopping CSV currency columns and currency coverage constraints", () => {
    const offers = [
      makeShoppingOffer({ id: "usd-a", title: "Logitech Lift Vertical Ergonomic Mouse", amount: 100 }),
      makeShoppingOffer({ id: "usd-b", title: "Anker Vertical Ergonomic Mouse", amount: 110, url: "https://example.com/usd-b" }),
      makeShoppingOffer({ id: "cad", title: "Microsoft Sculpt Ergonomic Mouse", amount: 90, attributes: {
        shopping_offer: {
          provider: "shopping/amazon",
          product_id: "cad",
          title: "Microsoft Sculpt Ergonomic Mouse",
          url: "https://example.ca/cad",
          price: { amount: 90, currency: "CAD", retrieved_at: SHOPPING_PRICE_TIME },
          shipping: { amount: 0, currency: "CAD", notes: "reported" },
          availability: "in_stock",
          price_source: "structured_metadata",
          price_is_trustworthy: true
        }
      }, url: "https://example.ca/cad" }),
      makeShoppingOffer({ id: "mixed", title: "Kensington Ergonomic Mouse", amount: 80, shipping: 5, shippingCurrency: "CAD", url: "https://example.com/mixed" })
    ];
    offers[2] = {
      ...offers[2]!,
      price: { ...offers[2]!.price, currency: "CAD" },
      shipping: { ...offers[2]!.shipping, currency: "CAD" }
    };
    const compact = renderShopping({
      mode: "compact",
      query: "ergonomic mouse",
      offers,
      meta: {
        selection: {
          providers: ["shopping/amazon"],
          requested_region: "US",
          region_authoritative: true
        }
      },
      freshnessReferenceIso: SHOPPING_PRICE_TIME
    });
    const csv = String(compact.files.find((file) => file.path === "comparison.csv")?.content ?? "");
    const summary = String(compact.response.summary);

    expect(csv.split("\n")[0]).toBe("provider,title,price,shipping,deal_score,availability,url,price_currency,shipping_currency,total,total_currency,total_status,currency_warning");
    expect(csv).toContain('100.00,0.00,0.8500,"in_stock","https://example.com/usd-a","USD","USD",100.00,"USD","computed"');
    expect(csv).toContain('90.00,0.00,0.8500,"in_stock","https://example.ca/cad","CAD","CAD",90.00,"CAD","computed"');
    expect(csv).toContain('80.00,5.00,0.8500,"in_stock","https://example.com/mixed","USD","CAD",,"","currency_mismatch"');
    expect(csv).toContain("item and shipping currencies differ");
    expect(summary).toContain("Buying readiness: partial");
    expect(summary).toContain("Key constraint: currency coverage incomplete");
  });

  it("marks invalid shopping CSV totals without contradicting report exclusions", () => {
    const compact = renderShopping({
      mode: "compact",
      query: "ergonomic mouse",
      offers: [
        makeShoppingOffer({ id: "valid", title: "Logitech Lift Vertical Ergonomic Mouse", amount: 100 }),
        makeShoppingOffer({ id: "nan-price", title: "Anker Vertical Ergonomic Mouse", amount: Number.NaN, url: "https://example.com/nan-price" }),
        makeShoppingOffer({ id: "bad-shipping", title: "Microsoft Sculpt Ergonomic Mouse", amount: 80, shipping: -5, url: "https://example.com/bad-shipping" })
      ],
      meta: {},
      freshnessReferenceIso: SHOPPING_PRICE_TIME
    });
    const csv = String(compact.files.find((file) => file.path === "comparison.csv")?.content ?? "");
    const markdown = String(compact.files.find((file) => file.path === "deals.md")?.content ?? "");

    expect(csv).toContain(',"https://example.com/nan-price","USD","USD",,"","invalid_price"');
    expect(csv).toContain('-5.00,0.8500,"in_stock","https://example.com/bad-shipping","USD","USD",,"","invalid_price"');
    expect(csv).not.toContain("NaN");
    expect(markdown).toContain("[excluded] Anker Vertical Ergonomic Mouse");
    expect(markdown).toContain("[excluded] Microsoft Sculpt Ergonomic Mouse");
  });

  it("does not emit compact top-candidate guidance for unavailable mixed-currency baselines", () => {
    const offers = [
      makeShoppingOffer({ id: "usd", title: "Logitech Lift Vertical Ergonomic Mouse", amount: 100 }),
      makeShoppingOffer({ id: "cad", title: "Anker Vertical Ergonomic Mouse", amount: 10, url: "https://example.ca/cad" })
    ];
    offers[1] = {
      ...offers[1]!,
      price: { ...offers[1]!.price, currency: "CAD" },
      shipping: { ...offers[1]!.shipping, currency: "CAD" },
      attributes: {
        ...offers[1]!.attributes,
        shopping_offer: {
          provider: "shopping/amazon",
          product_id: "cad",
          title: "Anker Vertical Ergonomic Mouse",
          url: "https://example.ca/cad",
          price: { amount: 10, currency: "CAD", retrieved_at: SHOPPING_PRICE_TIME },
          shipping: { amount: 0, currency: "CAD", notes: "reported" },
          availability: "in_stock",
          price_source: "structured_metadata",
          price_is_trustworthy: true
        }
      }
    };
    const compact = renderShopping({
      mode: "compact",
      query: "ergonomic mouse",
      offers,
      meta: {},
      freshnessReferenceIso: SHOPPING_PRICE_TIME
    });
    const summary = String(compact.response.summary);

    expect(summary).toContain("currency-separated evidence only");
    expect(summary).not.toContain("Top candidate");
  });

  it("surfaces stale price evidence when shopping renderer receives a freshness reference", () => {
    const staleOffers = [
      makeShoppingOffer({
        id: "stale-logitech",
        retrievedAt: "2026-01-01T00:00:00.000Z"
      }),
      makeShoppingOffer({
        id: "fresh-anker",
        provider: "shopping/bestbuy",
        title: "Anker Vertical Ergonomic Mouse",
        url: "https://bestbuy.example/fresh-anker",
        amount: 69.99,
        retrievedAt: SHOPPING_PRICE_TIME
      })
    ];
    const rendered = renderShopping({
      mode: "compact",
      query: "ergonomic mouse",
      offers: staleOffers,
      meta: {},
      freshnessReferenceIso: "2026-02-16T00:00:00.000Z"
    });
    const dealsMarkdown = String(rendered.files.find((file) => file.path === "deals.md")?.content ?? "");
    expect(dealsMarkdown).toContain("price freshness stale");
    expect(String(rendered.response.summary)).toContain("price freshness stale");
    const context = rendered.files.find((file) => file.path === "deals-context.json")?.content as { highlights: string[] };
    expect(context.highlights.join("\n")).toContain("price freshness stale");
  });

  it("keeps fail-gate shopping renderer output free of confident buying language", () => {
    const suspiciousOffers = [makeShoppingOffer({
      id: "rating-text",
      title: "Rated 4.7 out of 5 stars with 214 reviews",
      url: "https://example.com/rating-text"
    })];
    const rendered = renderShopping({
      mode: "md",
      query: "ergonomic mouse",
      offers: suspiciousOffers,
      meta: {}
    });
    const dealsMarkdown = String(rendered.files.find((file) => file.path === "deals.md")?.content ?? "");
    expect(dealsMarkdown).toContain("Status: fail");
    expect(dealsMarkdown).not.toMatch(/Strong buy|best deal|Recommended candidate|recommended/i);

    const compact = renderShopping({
      mode: "compact",
      query: "ergonomic mouse",
      offers: suspiciousOffers,
      meta: {}
    });
    expect(String(compact.response.summary)).toContain("Buying readiness: fail");
    expect(String(compact.response.summary)).not.toContain("deal=");
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
    expect(String(shoppingContext.files.find((file) => file.path === "deals.md")?.content ?? "")).toContain("# Shopping Buying Brief");
    const context = shoppingContext.response.context as { highlights: string[] };
    expect(context.highlights.join("\n")).toContain("No confident purchase recommendation");
  });
});
