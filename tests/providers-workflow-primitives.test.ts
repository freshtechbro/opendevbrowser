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
      expect(report?.content).toContain("- Source: community");
      expect(report?.content).toContain("- Provider: community/default");
      expect(report?.content).not.toContain("community/community/default");
      expect(report?.content).toContain("## Report Files");
      expect(report?.content).toContain("## Search Direction");
      expect(report?.content).toContain("## Candidate Triage");
      expect(report?.content).toContain("## Rejected Candidates");
      expect(report?.content).toContain("## Deep Dives");
      expect(report?.content).toContain("## Synthesis Feedback");
      expect(report?.content).toContain("Rejected candidate: search_index_shell from web/default (web; rejected_before_synthesis");
      expect(report?.content).toContain("bundle-manifest.json");
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
      expect(rendered.response.mode).toBe(mode === "path" ? "path" : mode);
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
    expect(report).toContain("unknown_reason from unknown_provider (unknown_source; not_recorded): URL not recorded");
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

    expect(report).toContain("- Rejected shell or dead-end candidates: 3");
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
    expect(emptyReport).toContain("No usable findings were available.");
    expect(emptyReport).toContain("No provider limitations or sanitization gaps were reported.");
    expect(emptyReport).toContain("No sources available.");
    expect(constrainedReport).toContain("Primary constraint: Provider returned only shell pages.");
    expect(constrainedReport).toContain("web/provider-10");
    expect(constrainedReport).toContain("2 more provider failures omitted from this report; see meta.json");
    expect(constrainedReport).not.toContain("web/provider-11");
    expect(malformedFailureReport).toContain("unknown (unknown): provider failure");
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

    expect(report).toContain("Usable findings: 21");
    expect(report).toContain("Findings shown in report: 10");
    expect(report).toContain("Sources shown in report: 20");
    expect(report).toContain("Usable records are persisted in records.json.");
    expect(report).toContain("Run metadata, failures, and constraints are persisted in meta.json");
    expect(report).toContain("11 more findings omitted from this report; see records.json");
    expect(report).toContain("1 more source omitted from this report; see records.json");
    expect(report).toContain("### 10. Finding 10");
    expect(report).not.toContain("### 11. Finding 11");
    expect(report).toContain("Finding 20: https://example.com/20");
    expect(report).not.toContain("Finding 21: https://example.com/21");
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
