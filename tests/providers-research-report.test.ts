import { describe, expect, it } from "vitest";
import { enrichResearchRecords } from "../src/providers/enrichment";
import { buildResearchBriefing, renderResearchBriefingMarkdown } from "../src/providers/research-report";
import { buildClaims } from "../src/providers/research-report/claims";
import { selectPassages } from "../src/providers/research-report/passages";
import {
  buildResearchBriefingMetaView,
  compareStableText,
  isActiveChallengeOrchestration,
  registrableDomainFromUrl,
  rejectionPressure,
  unwrapSearchRedirect
} from "../src/providers/research-report/rules";
import { resolveTimebox } from "../src/providers/timebox";
import { makeResearchRecord as makeRecord, researchReportMarkdown as reportMarkdown } from "./helpers/research-report-fixtures";

describe("deterministic research report", () => {
  const passReadyRecords = (timebox: ReturnType<typeof resolveTimebox>) => enrichResearchRecords([
    makeRecord({
      id: "alpha-pass-source",
      url: "https://alpha-pass.test/research-report-quality",
      title: "Claim maps for deterministic reports"
    }),
    makeRecord({
      id: "beta-pass-source",
      url: "https://beta-pass.test/evidence-briefing-quality",
      title: "Evidence briefings need confidence"
    }),
    makeRecord({
      id: "gamma-pass-source",
      url: "https://gamma-pass.test/source-traceability",
      title: "Traceable source recommendations"
    })
  ], timebox, new Date("2026-06-14T00:00:00.000Z"));

  it("renders a decision-ready evidence briefing with required sections in order", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords([
      makeRecord({
        id: "claim-map-source",
        url: "https://alpha-report.test/research-report-quality",
        title: "Claim maps for research reports"
      }),
      makeRecord({
        id: "confidence-source",
        url: "https://beta-report.test/evidence-briefings",
        title: "Evidence briefings need confidence"
      }),
      makeRecord({
        id: "recommendation-source",
        url: "https://gamma-report.test/agent-ready-reports",
        title: "Agent-ready research reports"
      })
    ], timebox, new Date("2026-06-14T00:00:00.000Z"));

    const report = reportMarkdown({
      mode: "path",
      topic: "research report quality",
      records,
      meta: {
        timebox,
        selection: { source_selection: "web", resolved_sources: ["web"] },
        metrics: {
          total_records: 3,
          within_timebox: 3,
          final_records: 3,
          rejected_candidate_count: 0
        }
      }
    });

    const requiredHeadings = [
      "## Evidence Gate Status",
      "## Final Answer",
      "## Claim Map",
      "## Theme Synthesis",
      "## Source Agreement or Disagreement",
      "## Confidence by Claim",
      "## Limitations",
      "## Recommendations",
      "## Evidence Appendix"
    ];
    const headingIndexes = requiredHeadings.map((heading) => report.indexOf(heading));

    expect(headingIndexes.every((index) => index >= 0)).toBe(true);
    expect(headingIndexes).toEqual([...headingIndexes].sort((left, right) => left - right));
    expect(report).toContain("Evidence gate: pass");
    expect(report).toContain("Timebox: days from 2026-05-31T00:00:00.000Z to 2026-06-14T00:00:00.000Z");
    expect(report).toContain("The accepted evidence supports");
    expect(report).toContain("claim-map-source");
    expect(report).toContain("https://alpha-report.test/research-report-quality");
    expect(report).toContain("Record timestamp: 2026-06-10T00:00:00.000Z");
    expect(report).not.toContain("Published: 2026-06-10T00:00:00.000Z");
    expect(report).toContain("high");
  });

  it("renders a partial gate with tentative claims when source diversity is low", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords([
      makeRecord({
        id: "single-domain-source",
        url: "https://single.example.com/research-report-quality",
        content: [
          "Research report quality improves when accepted evidence is organized into a claim map.",
          "A deterministic evidence briefing should show confidence by claim and limitations before downstream use.",
          "The same accepted source explains that recommendations should point to records json for audit review."
        ].join(" ")
      })
    ], timebox, new Date("2026-06-14T00:00:00.000Z"));

    const report = reportMarkdown({
      mode: "path",
      topic: "research report quality",
      records,
      meta: {
        timebox,
        metrics: {
          total_records: 1,
          within_timebox: 1,
          final_records: 1
        }
      }
    });

    expect(report).toContain("Evidence gate: partial");
    expect(report).toContain("Status: tentative");
    expect(report).toContain("Source diversity is below the pass threshold.");
  });

  it("excludes claim support when the usable-content evidence gate fails", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const shortContentAttributes = {
      retrievalPath: "web:fetch:url",
      extractionQuality: {
        hasContent: true,
        contentChars: 48
      }
    };
    const records = enrichResearchRecords([
      makeRecord({
        id: "short-alpha-source",
        url: "https://short-alpha.test/reliability",
        content: "Human oversight improves browser agent reliability.",
        attributes: shortContentAttributes
      }),
      makeRecord({
        id: "short-beta-source",
        url: "https://short-beta.test/reliability",
        content: "Human oversight improves browser agent reliability.",
        attributes: shortContentAttributes
      }),
      makeRecord({
        id: "short-gamma-source",
        url: "https://short-gamma.test/reliability",
        content: "Human oversight improves browser agent reliability.",
        attributes: shortContentAttributes
      })
    ], timebox, new Date("2026-06-14T00:00:00.000Z"));

    const report = reportMarkdown({
      mode: "path",
      topic: "human oversight browser reliability",
      records,
      meta: {
        timebox,
        metrics: {
          total_records: 3,
          within_timebox: 3,
          final_records: 3,
          rejected_candidate_count: 0
        }
      }
    });

    expect(report).toContain("Evidence gate: fail");
    expect(report).toContain("Evidence gate failed, so accepted records cannot support deterministic claims.");
    expect(report).toContain("Status: excluded");
    expect(report).toContain("claim-1: low (0) because overall evidence gate failed.");
    expect(report).toContain("Supporting records: none");
    expect(report).toContain("Source URLs: none");
    expect(report).not.toContain("Status: accepted");
    expect(report).not.toContain("high (6)");
    expect(report).not.toContain("decision-ready finding");
  });

  it("treats subdomains of one registrable domain as one independent source", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords([
      makeRecord({
        id: "news-subdomain",
        url: "https://news.example.com/research-report-quality",
        content: "Claim maps keep deterministic research reports decision-ready by connecting accepted passages to source evidence."
      }),
      makeRecord({
        id: "blog-subdomain",
        url: "https://blog.example.com/research-report-quality",
        content: "Claim maps keep deterministic research reports decision-ready by connecting accepted passages to confidence and recommendations."
      }),
      makeRecord({
        id: "www-subdomain",
        url: "https://www.example.com/research-report-quality",
        content: "Claim maps keep deterministic research reports decision-ready by connecting accepted passages to limitations."
      })
    ], timebox, new Date("2026-06-14T00:00:00.000Z"));

    const report = reportMarkdown({
      mode: "path",
      topic: "claim maps deterministic research reports",
      records,
      meta: {
        timebox,
        metrics: {
          total_records: 3,
          within_timebox: 3,
          final_records: 3,
          rejected_candidate_count: 0
        }
      }
    });

    expect(report).toContain("Evidence gate: partial");
    expect(report).toContain("Independent accepted domains: observed 1");
    expect(report).toContain("Status: tentative");
    expect(report).toContain("Source diversity is below the pass threshold.");
    expect(report).not.toContain("Evidence gate: pass");
  });

  it("uses public suffix boundaries for hosted project domains", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords([
      makeRecord({
        id: "alpha-github-pages",
        url: "https://alpha-project.github.io/research-report-quality",
        content: "Claim maps keep deterministic research reports decision-ready by linking accepted evidence to confidence."
      }),
      makeRecord({
        id: "alpha-docs-github-pages",
        url: "https://docs.alpha-project.github.io/research-report-quality",
        content: "Decision-ready reports show source agreement, limitations, recommendations, and source-backed passages."
      }),
      makeRecord({
        id: "beta-github-pages",
        url: "https://beta-project.github.io/research-report-quality",
        content: "Evidence briefings stay useful when accepted passages cite record identifiers and source URLs."
      })
    ], timebox, new Date("2026-06-14T00:00:00.000Z"));

    const report = reportMarkdown({
      mode: "path",
      topic: "deterministic research report quality",
      records,
      meta: {
        timebox,
        metrics: {
          total_records: 3,
          within_timebox: 3,
          final_records: 3,
          rejected_candidate_count: 0
        }
      }
    });

    expect(registrableDomainFromUrl("https://docs.alpha-project.github.io/path")).toBe("alpha-project.github.io");
    expect(registrableDomainFromUrl("https://beta-project.github.io/path")).toBe("beta-project.github.io");
    expect(registrableDomainFromUrl("https://service.gov.uk/path")).toBe("service.gov.uk");
    expect(report).toContain("Evidence gate: pass");
    expect(report).toContain("Independent accepted domains: observed 2");
  });

  it("counts private hosted suffix tenants independently without splitting same-tenant subdomains", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords([
      makeRecord({
        id: "alpha-onrender",
        url: "https://alpha-project.onrender.com/research-report-quality",
        content: "Claim maps keep deterministic research reports decision-ready by linking accepted evidence to confidence."
      }),
      makeRecord({
        id: "alpha-docs-onrender",
        url: "https://docs.alpha-project.onrender.com/research-report-quality",
        content: "Decision-ready reports show source agreement, limitations, recommendations, and source-backed passages."
      }),
      makeRecord({
        id: "beta-onrender",
        url: "https://beta-project.onrender.com/research-report-quality",
        content: "Evidence briefings stay useful when accepted passages cite record identifiers and source URLs."
      })
    ], timebox, new Date("2026-06-14T00:00:00.000Z"));

    const report = reportMarkdown({
      mode: "path",
      topic: "deterministic research report quality",
      records,
      meta: {
        timebox,
        metrics: {
          total_records: 3,
          within_timebox: 3,
          final_records: 3,
          rejected_candidate_count: 0
        }
      }
    });

    expect(registrableDomainFromUrl("https://docs.alpha-project.onrender.com/path")).toBe("alpha-project.onrender.com");
    expect(registrableDomainFromUrl("https://beta-project.onrender.com/path")).toBe("beta-project.onrender.com");
    expect(registrableDomainFromUrl("https://preview.alpha.fly.dev/path")).toBe("alpha.fly.dev");
    expect(registrableDomainFromUrl("https://assets.beta.r2.dev/path")).toBe("beta.r2.dev");
    expect(registrableDomainFromUrl("https://docs.alpha.deno.dev/path")).toBe("alpha.deno.dev");
    expect(report).toContain("Evidence gate: pass");
    expect(report).toContain("Independent accepted domains: observed 2");
  });

  it("labels weak single-source claims as low confidence", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords([
      makeRecord({
        id: "weak-source",
        url: "https://weak.example.com/report",
        confidence: 0.3,
        timestamp: "2026-06-10T00:00:00.000Z",
        content: "A weak source says claim maps matter, but it gives little usable detail.",
        attributes: {
          retrievalPath: "web:fetch:url",
          extractionQuality: {
            hasContent: true,
            contentChars: 1200
          }
        }
      })
    ], timebox, new Date("2026-06-14T00:00:00.000Z"));

    const report = reportMarkdown({
      mode: "path",
      topic: "claim maps",
      records,
      meta: {
        timebox,
        metrics: {
          total_records: 1,
          within_timebox: 1,
          final_records: 1
        }
      }
    });

    expect(report).toContain("Evidence gate: partial");
    expect(report).toContain("claim-1: low");
    expect(report).toContain("Within timebox: yes");
    expect(report).not.toContain("claim-1: medium");
  });

  it("subtracts confidence when rejection pressure exceeds the pass threshold", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords([
      makeRecord({
        id: "pressure-source",
        url: "https://pressure.example.com/decision-maturity",
        title: "Decision maturity evidence",
        content: "Decision maturity improves when teams document review context before acting on research findings.",
        attributes: {
          retrievalPath: "web:fetch:url",
          extractionQuality: {
            hasContent: true,
            contentChars: 1200
          }
        }
      })
    ], timebox, new Date("2026-06-14T00:00:00.000Z"));

    const report = reportMarkdown({
      mode: "path",
      topic: "decision quality",
      records,
      meta: {
        timebox,
        metrics: {
          total_records: 4,
          within_timebox: 1,
          final_records: 1,
          rejected_candidate_count: 3
        }
      }
    });

    expect(report).toContain("Evidence gate: partial");
    expect(report).toContain("claim-1: low (2) because average accepted content >= 500 characters; average source confidence >= 0.70; supporting records are inside the resolved timebox; overall evidence gate is constrained by rejected-candidate pressure.");
    expect(report).not.toContain("claim-1: medium");
  });

  it("excludes stale accepted records from claims and explains the timebox limitation", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords([
      makeRecord({
        id: "stale-source",
        url: "https://stale.example.com/report",
        timestamp: "2026-05-01T00:00:00.000Z",
        content: [
          "Claim maps make research reports more useful when source passages are linked.",
          "This source is outside the active timebox and should not support final claims."
        ].join(" "),
        attributes: {
          retrievalPath: "web:fetch:url",
          extractionQuality: {
            hasContent: true,
            contentChars: 1200
          }
        }
      })
    ], timebox, new Date("2026-06-14T00:00:00.000Z"));

    const report = reportMarkdown({
      mode: "path",
      topic: "claim maps",
      records,
      meta: {
        timebox,
        metrics: {
          total_records: 1,
          within_timebox: 0,
          final_records: 1
        }
      }
    });

    expect(report).toContain("Evidence gate: fail");
    expect(report).toContain("1 accepted record was outside the resolved timebox and excluded from claim support.");
    expect(report).toContain("Within timebox: no");
    expect(report).toContain("Evidence is insufficient because no accepted records passed the research evidence gate.");
  });

  it("reports direct disagreement cues without claiming universal agreement", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords([
      makeRecord({
        id: "supporting-source",
        url: "https://alpha.example.com/claim-maps",
        content: "Claim maps improve decision readiness when accepted evidence is linked to source passages."
      }),
      makeRecord({
        id: "contrast-source",
        url: "https://beta.example.com/claim-map-risks",
        content: "Claim maps improve decision readiness. However, claim maps can mislead when evidence is thin."
      }),
      makeRecord({
        id: "third-source",
        url: "https://gamma.example.com/claim-map-review",
        content: "Claim maps improve decision readiness by making confidence and limitations visible to agents."
      })
    ], timebox, new Date("2026-06-14T00:00:00.000Z"));

    const report = reportMarkdown({
      mode: "path",
      topic: "claim maps decision readiness",
      records,
      meta: {
        timebox,
        metrics: {
          total_records: 3,
          within_timebox: 3,
          final_records: 3
        }
      }
    });

    expect(report).toContain("Direct disagreement cues detected");
    expect(report).toContain("Disagreement cues: however");
    expect(report).not.toContain("Sources agree");
  });

  it("explains search-index rejection when the destination page is accepted after follow-up fetch", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords([
      makeRecord({
        id: "accepted-destination",
        url: "https://design.example.com/inspiration",
        title: "Accepted destination page"
      })
    ], timebox, new Date("2026-06-14T00:00:00.000Z"));

    const report = reportMarkdown({
      mode: "path",
      topic: "design inspiration research",
      records,
      meta: {
        timebox,
        metrics: {
          total_records: 2,
          within_timebox: 1,
          final_records: 1,
          sanitized_reason_distribution: {
            search_index_shell: 1
          }
        },
        rejected_candidates: [{
          provider: "web/default",
          source: "web",
          reason: "search_index_shell",
          replacement_status: "rejected_before_synthesis",
          retrievalPath: "web:search:index",
          url: "https://duckduckgo.com/l?uddg=https%3A%2F%2Fdesign.example.com%2Finspiration"
        }]
      }
    });

    expect(report).toContain("Search-index candidate rejected as final evidence; destination page accepted after follow-up fetch");
    expect(report).toContain("accepted-destination");
    expect(report).toContain("https://design.example.com/inspiration");
  });

  it("discounts accepted search-index overlaps from gate pressure and confidence penalties", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const acceptedUrls = [
      "https://alpha-report.test/report-quality",
      "https://beta-report.test/report-quality",
      "https://gamma-report.test/report-quality",
      "https://delta-report.test/report-quality",
      "https://epsilon-report.test/report-quality"
    ];
    const records = enrichResearchRecords(acceptedUrls.map((url, index) => makeRecord({
      id: `accepted-overlap-${index + 1}`,
      url,
      title: "Decision-ready evidence briefing",
      content: [
        "Decision-ready evidence briefings connect accepted source passages to claim maps.",
        "Claim maps should explain confidence, source agreement, limitations, and recommendations.",
        "Deterministic report quality improves when accepted destination evidence is cited directly."
      ].join(" ")
    })), timebox, new Date("2026-06-14T00:00:00.000Z"));

    const report = reportMarkdown({
      mode: "path",
      topic: "research report quality",
      records,
      meta: {
        timebox,
        metrics: {
          total_records: 15,
          within_timebox: 5,
          final_records: 5,
          rejected_candidate_count: 10,
          sanitized_reason_distribution: {
            search_index_shell: 10
          }
        },
        rejected_candidates: [
          ...acceptedUrls.map((url) => ({
            provider: "web/default",
            source: "web",
            reason: "search_index_shell",
            replacement_status: "rejected_before_synthesis",
            retrievalPath: "web:search:index",
            url
          })),
          ...Array.from({ length: 5 }, (_, index) => ({
            provider: "web/default",
            source: "web",
            reason: "search_index_shell",
            replacement_status: "rejected_before_synthesis",
            retrievalPath: "web:search:index",
            url: `https://unfollowed-${index + 1}.test/report-quality`
          }))
        ]
      }
    });

    expect(report).toContain("Evidence gate: pass");
    expect(report).toContain("after discounting 5 accepted destination overlap(s)");
    expect(report).toContain("5 accepted destination overlap(s) were discounted from gate pressure");
    expect(report).not.toContain("overall evidence gate is constrained by rejected-candidate pressure");
  });

  it("keeps high rejected-candidate pressure partial when accepted evidence is usable", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const report = reportMarkdown({
      mode: "path",
      topic: "research report quality under high rejection pressure",
      records: passReadyRecords(timebox),
      meta: {
        timebox,
        selection: { source_selection: "web", resolved_sources: ["web"] },
        metrics: {
          total_records: 63,
          within_timebox: 3,
          final_records: 3,
          rejected_candidate_count: 60
        }
      }
    });

    const finalAnswer = report.slice(
      report.indexOf("## Final Answer"),
      report.indexOf("## Claim Map")
    );

    expect(report).toContain("Evidence gate: partial");
    expect(report).toContain("Rejected-candidate pressure for partial: observed 0.95");
    expect(finalAnswer).toContain("Under a partial evidence gate");
    expect(finalAnswer).toContain("decision-ready findings");
    expect(report).not.toContain("Evidence gate: fail");
  });

  it("renders claim support without pairing unrelated record ids and urls by index", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords([
      makeRecord({
        id: "source-b",
        url: "https://a.example.com/claim-map",
        title: "Claim map evidence"
      }),
      makeRecord({
        id: "source-a",
        url: "https://z.example.com/claim-map",
        title: "Claim map confidence"
      })
    ], timebox, new Date("2026-06-14T00:00:00.000Z"));

    const report = reportMarkdown({
      mode: "path",
      topic: "claim map evidence",
      records,
      meta: {
        timebox,
        metrics: {
          total_records: 2,
          within_timebox: 2,
          final_records: 2
        }
      }
    });

    expect(report).toContain("Supporting records: source-a, source-b");
    expect(report).toContain("Source URLs: https://a.example.com/claim-map; https://z.example.com/claim-map");
    expect(report).not.toContain("source-a (https://a.example.com/claim-map)");
  });

  it("summarizes duplicate cookie diagnostics without mutating raw metadata", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords([
      makeRecord()
    ], timebox, new Date("2026-06-14T00:00:00.000Z"));
    const cookieDiagnostic = {
      provider: "web/default",
      source: "web",
      policy: "auto",
      sourceRef: "/Users/example/.config/opencode/opendevbrowser.provider-cookies.json",
      sessionEvidence: "cookies_missing",
      message: "Cookie file not found: /Users/example/.config/opencode/opendevbrowser.provider-cookies.json"
    };
    const meta = {
      timebox,
      selection: { source_selection: "web", resolved_sources: ["web"] },
      metrics: {
        total_records: 1,
        within_timebox: 1,
        final_records: 1,
        rejected_candidate_count: 0,
        cookie_diagnostics: [cookieDiagnostic, cookieDiagnostic]
      }
    };

    const report = reportMarkdown({
      mode: "path",
      topic: "cookie diagnostics research",
      records,
      meta
    });

    expect(report.match(/Cookie file not found/g) ?? []).toHaveLength(1);
    expect(report).toContain("observed 2 times");
    expect(meta.metrics.cookie_diagnostics).toHaveLength(2);
  });

  it("downgrades an otherwise passing gate when required cookies are missing", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const report = reportMarkdown({
      mode: "path",
      topic: "required cookies research quality",
      records: passReadyRecords(timebox),
      meta: {
        timebox,
        selection: { source_selection: "web", resolved_sources: ["web"] },
        metrics: {
          total_records: 3,
          within_timebox: 3,
          final_records: 3,
          rejected_candidate_count: 0,
          cookie_diagnostics: [{
            provider: "web/default",
            source: "web",
            policy: "required",
            sourceRef: "/tmp/research-required-cookies.json",
            sessionEvidence: "cookies_missing",
            message: "Cookie file not found: /tmp/research-required-cookies.json"
          }]
        }
      }
    });

    expect(report).toContain("Evidence gate: partial");
    expect(report).toContain("Blocking diagnostics: observed 1");
    expect(report).toContain("Required cookie diagnostics: observed 1");
    expect(report).toContain("Cookie file not found: /tmp/research-required-cookies.json observed 1 times under required policy; blocking.");
    expect(report).not.toContain("Evidence gate: pass");
  });

  it("surfaces diagnostic metadata channels in limitations and appendix", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords([
      makeRecord({
        id: "diagnostic-source",
        url: "https://diagnostic.example.com/report",
        content: "Diagnostic evidence exists, but extraction quality is intentionally weak for this regression.",
        attributes: {
          retrievalPath: "web:fetch:url",
          extractionQuality: {
            hasContent: true,
            contentChars: 120
          }
        }
      })
    ], timebox, new Date("2026-06-14T00:00:00.000Z"));

    const report = reportMarkdown({
      mode: "path",
      topic: "diagnostic metadata research",
      records,
      meta: {
        timebox,
        metrics: {
          total_records: 1,
          within_timebox: 1,
          final_records: 1,
          challenge_diagnostics: [{
            provider: "web/default",
            source: "web",
            reasonCode: "challenge_detected"
          }],
          challenge_orchestration: [{
            provider: "web/default",
            mode: "browser_with_helper",
            status: "manual_yield"
          }],
          anti_bot_pressure: {
            anti_bot_failures: 1,
            total_failures: 3
          },
          transcript_durability: {
            attempted: 2,
            successful: 0
          },
          alerts: [{
            provider: "web/default",
            signal: "rate_limited",
            state: "warning",
            reason: "signal ratio exceeded warning threshold"
          }]
        }
      }
    });

    expect(report).toContain("1 accepted record was below the 500-character usable-content threshold.");
    expect(report).toContain("Challenge diagnostics were reported 2 times");
    expect(report).toContain("Anti-bot pressure was reported in 1 of 3 provider failures.");
    expect(report).toContain("Transcript durability is constrained: 0 of 2 transcript attempts succeeded.");
    expect(report).toContain("1 workflow alert was reported");
    expect(report).toContain("Challenge diagnostic: provider=web/default source=web reason=challenge_detected.");
    expect(report).toContain("Challenge orchestration: provider=web/default mode=browser_with_helper status=manual_yield.");
    expect(report).toContain("Anti-bot pressure: 1 of 3 provider failures were anti-bot related.");
    expect(report).toContain("Transcript durability: 0 of 2 transcript attempts succeeded.");
    expect(report).toContain("Workflow alert: provider=web/default signal=rate_limited state=warning reason=signal ratio exceeded warning threshold.");
    expect(report).toContain("Use browser-scoped challenge recovery only for selected evidence pages");
    expect(report).toContain("Inspect transcript-backed records and rerun with another source family");
    expect(report).toContain("Resolve workflow alerts or treat affected provider evidence as constrained");
  });

  it("merges top-level workflow alerts into limitations and diagnostics", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const report = reportMarkdown({
      mode: "path",
      topic: "top-level alerts research quality",
      records: passReadyRecords(timebox),
      meta: {
        timebox,
        alerts: [{
          provider: "web/default",
          signal: "source_limited",
          state: "warning",
          reason: "top-level alert should constrain the rendered briefing"
        }],
        selection: { source_selection: "web", resolved_sources: ["web"] },
        metrics: {
          total_records: 3,
          within_timebox: 3,
          final_records: 3,
          rejected_candidate_count: 0
        }
      }
    });

    expect(report).toContain("1 workflow alert was reported");
    expect(report).toContain("Evidence gate: partial");
    expect(report).toContain("Blocking diagnostics: observed 1");
    expect(report).toContain("Workflow alerts: observed 1");
    expect(report).toContain("Workflow alert: provider=web/default signal=source_limited state=warning reason=top-level alert should constrain the rendered briefing.");
    expect(report).toContain("Resolve workflow alerts or treat affected provider evidence as constrained");
    expect(report).not.toContain("Evidence gate: pass");
  });

  it("does not double count duplicate cookie diagnostic alias arrays", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords([
      makeRecord()
    ], timebox, new Date("2026-06-14T00:00:00.000Z"));
    const cookieDiagnostic = {
      provider: "web/default",
      source: "file",
      policy: "auto",
      sourceRef: "/Users/example/.config/opencode/opendevbrowser.provider-cookies.json",
      sessionEvidence: "cookies_missing",
      message: "Cookie file not found: /Users/example/.config/opencode/opendevbrowser.provider-cookies.json"
    };

    const report = reportMarkdown({
      mode: "path",
      topic: "cookie diagnostics research",
      records,
      meta: {
        timebox,
        selection: { source_selection: "web", resolved_sources: ["web"] },
        metrics: {
          total_records: 1,
          within_timebox: 1,
          final_records: 1,
          rejected_candidate_count: 0,
          cookie_diagnostics: [cookieDiagnostic, cookieDiagnostic],
          cookieDiagnostics: [cookieDiagnostic, cookieDiagnostic]
        }
      }
    });

    expect(report).toContain("observed 2 times");
    expect(report).not.toContain("observed 4 times");
  });

  it("deduplicates repeated challenge diagnostics in markdown without mutating raw metadata", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords([
      makeRecord({
        id: "challenge-source",
        url: "https://challenge.example.com/report"
      })
    ], timebox, new Date("2026-06-14T00:00:00.000Z"));
    const challengeDiagnostic = {
      provider: "web/default",
      source: "web",
      reasonCode: "challenge_detected"
    };
    const challengeOrchestration = {
      provider: "web/default",
      mode: "browser_with_helper",
      status: "manual_yield"
    };
    const meta = {
      timebox,
      metrics: {
        total_records: 1,
        within_timebox: 1,
        final_records: 1,
        challenge_diagnostics: [challengeDiagnostic, challengeDiagnostic],
        challenge_orchestration: [challengeOrchestration, challengeOrchestration]
      }
    };

    const report = reportMarkdown({
      mode: "path",
      topic: "challenge diagnostics research",
      records,
      meta
    });

    expect(report.match(/Challenge diagnostic:/g) ?? []).toHaveLength(1);
    expect(report.match(/Challenge orchestration:/g) ?? []).toHaveLength(1);
    expect(report).toContain("Challenge diagnostic: provider=web/default source=web reason=challenge_detected (observed 2 times; raw repeated attempts remain in meta.json).");
    expect(report).toContain("Challenge orchestration: provider=web/default mode=browser_with_helper status=manual_yield (observed 2 times; raw repeated attempts remain in meta.json).");
    expect(meta.metrics.challenge_diagnostics).toHaveLength(2);
    expect(meta.metrics.challenge_orchestration).toHaveLength(2);
  });

  it("downgrades an otherwise passing gate when challenge orchestration is active", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const report = reportMarkdown({
      mode: "path",
      topic: "active challenge orchestration research quality",
      records: passReadyRecords(timebox),
      meta: {
        timebox,
        selection: { source_selection: "web", resolved_sources: ["web"] },
        metrics: {
          total_records: 3,
          within_timebox: 3,
          final_records: 3,
          rejected_candidate_count: 0,
          challenge_orchestration: [{
            provider: "web/default",
            mode: "browser_with_helper",
            status: "manual_yield"
          }]
        }
      }
    });

    expect(report).toContain("Evidence gate: partial");
    expect(report).toContain("Blocking diagnostics: observed 1");
    expect(report).toContain("Active challenge orchestrations: observed 1");
    expect(report).toContain("Challenge orchestration: provider=web/default mode=browser_with_helper status=manual_yield.");
    expect(report).not.toContain("Evidence gate: pass");
  });

  it.each([
    "still_blocked",
    "yield_required",
    "no_progress",
    "policy_blocked"
  ] as const)("downgrades pass-ready evidence for active challenge action status %s", (status) => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const report = reportMarkdown({
      mode: "path",
      topic: "challenge action status research quality",
      records: passReadyRecords(timebox),
      meta: {
        timebox,
        selection: { source_selection: "web", resolved_sources: ["web"] },
        metrics: {
          total_records: 3,
          within_timebox: 3,
          final_records: 3,
          rejected_candidate_count: 0,
          challenge_orchestration: [{
            provider: "web/default",
            mode: "browser_with_helper",
            status
          }]
        }
      }
    });

    expect(report).toContain("Evidence gate: partial");
    expect(report).toContain("Active challenge orchestrations: observed 1");
    expect(report).toContain(`Challenge orchestration: provider=web/default mode=browser_with_helper status=${status}.`);
    expect(report).not.toContain("Evidence gate: pass");
  });

  it("does not downgrade pass-ready evidence for resolved challenge orchestration history", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const report = reportMarkdown({
      mode: "path",
      topic: "resolved challenge orchestration research quality",
      records: passReadyRecords(timebox),
      meta: {
        timebox,
        selection: { source_selection: "web", resolved_sources: ["web"] },
        metrics: {
          total_records: 3,
          within_timebox: 3,
          final_records: 3,
          rejected_candidate_count: 0,
          challenge_orchestration: [{
            provider: "web/default",
            mode: "browser_with_helper",
            invoked: true,
            status: "resolved"
          }]
        }
      }
    });

    expect(report).toContain("Evidence gate: pass");
    expect(report).toContain("Active challenge orchestrations: observed 0");
    expect(report).not.toContain("Challenge orchestration:");
    expect(report).not.toContain("Use browser-scoped challenge recovery");
  });

  it("does not turn non-invoked challenge helper notes or zero transcript attempts into limitations", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords([
      makeRecord({
        id: "clean-helper-standdown",
        url: "https://standdown.example.com/report",
        title: "Clean helper standdown"
      })
    ], timebox, new Date("2026-06-14T00:00:00.000Z"));

    const report = reportMarkdown({
      mode: "path",
      topic: "challenge diagnostics research",
      records,
      meta: {
        timebox,
        metrics: {
          total_records: 1,
          within_timebox: 1,
          final_records: 1,
          challenge_orchestration: [{
            provider: "web/default",
            mode: "browser_with_helper",
            invoked: false,
            status: "not_recorded"
          }],
          transcript_durability: {
            attempted: 0,
            successful: 0,
            failed: 0,
            success_rate: 0
          },
          anti_bot_pressure: {
            total_failures: 1,
            anti_bot_failures: 0,
            anti_bot_failure_ratio: 0
          }
        }
      }
    });

    expect(report).not.toContain("Challenge orchestration:");
    expect(report).not.toContain("Challenge diagnostics were reported");
    expect(report).not.toContain("Use browser-scoped challenge recovery");
    expect(report).not.toContain("Transcript durability:");
    expect(report).not.toContain("Anti-bot pressure");
  });

  it("promotes evidence phrases without synthetic topic-token themes", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords([
      makeRecord({
        id: "source-one",
        url: "https://alpha.example.com/browser-automation",
        content: [
          "Browser automation tools need deterministic audit trails for reliable production use.",
          "Browser automation tools should expose claim-ready evidence and source links."
        ].join(" ")
      }),
      makeRecord({
        id: "source-two",
        url: "https://beta.example.com/browser-automation",
        content: [
          "Browser automation tools compare deterministic execution with agent flexibility.",
          "Browser automation tools still need limitations and source confidence."
        ].join(" ")
      })
    ], timebox, new Date("2026-06-14T00:00:00.000Z"));

    const report = reportMarkdown({
      mode: "path",
      topic: "deterministic research report quality in browser automation tools",
      records,
      meta: {
        timebox,
        metrics: {
          total_records: 2,
          within_timebox: 2,
          final_records: 2
        }
      }
    });

    expect(report).toContain("- claim-ready evidence:");
    expect(report).toContain("- deterministic audit:");
    expect(report).toContain("source-one:");
    expect(report).toContain("Record: source-two");
    expect(report).not.toContain("- browser automation:");
    expect(report).not.toContain("deterministic quality browser");
  });

  it("prioritizes extracted reliability practices over generic topic phrases", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords([
      makeRecord({
        id: "practice-source",
        url: "https://alpha.example.com/browser-reliability",
        content: "Browser automation reliability depends on repeatable execution and visible failure recovery.",
        attributes: {
          retrievalPath: "web:fetch:url",
          features: [
            "Prefer semantic selectors over brittle CSS paths.",
            "Introduce retries with bounded backoff, not infinite loops.",
            "Log screenshots and step traces for replay."
          ],
          extractionQuality: {
            hasContent: true,
            contentChars: 2800
          }
        }
      }),
      makeRecord({
        id: "checkpoint-source",
        url: "https://beta.example.com/browser-workflows",
        content: "Browser automation agent workflows need stable checkpoints and clear escalation paths.",
        attributes: {
          retrievalPath: "web:fetch:url",
          features: [
            "Use step-level checkpointing before long workflow execution.",
            "Escalate high-risk decisions to human review."
          ],
          extractionQuality: {
            hasContent: true,
            contentChars: 2400
          }
        }
      })
    ], timebox, new Date("2026-06-14T00:00:00.000Z"));

    const report = reportMarkdown({
      mode: "path",
      topic: "browser automation reliability practices for agent workflows",
      records,
      meta: {
        timebox,
        metrics: {
          total_records: 2,
          within_timebox: 2,
          final_records: 2
        }
      }
    });

    expect(report).toContain("- semantic selectors:");
    expect(report).toContain("- bounded backoff:");
    expect(report).toContain("Log screenshots and step traces for replay.");
    expect(report).toContain("Tentative evidence also points to");
  });

  it("promotes practice evidence over title-like feature phrases", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords([
      makeRecord({
        id: "title-heavy-source",
        url: "https://alpha.example.com/browser-agent",
        content: [
          "Browser agent reliability is the article setup, not the practice recommendation.",
          "AI browser automation reliability depends on human oversight and bounded retries when pages change.",
          "Teams should keep screenshots and traces for replay before trusting the agent result."
        ].join(" "),
        attributes: {
          retrievalPath: "web:fetch:url",
          features: [
            "Amazon Nova Act: The AI Browser Agent That Outperforms Benchmarks",
            "Use human oversight with bounded retries for page changes."
          ],
          extractionQuality: {
            hasContent: true,
            contentChars: 2200
          }
        }
      }),
      makeRecord({
        id: "practice-heavy-source",
        url: "https://beta.example.com/browser-reliability",
        content: [
          "Browser agent reliability is the topic frame, but the actionable guidance is narrower.",
          "Browser automation reliability improves when human oversight, bounded retries, and replay traces are built into the workflow.",
          "Agents should escalate uncertain actions instead of continuing through broken page state."
        ].join(" "),
        attributes: {
          retrievalPath: "web:fetch:url",
          features: [
            "Browser Agent Reliability Guide 2026",
            "Escalate uncertain actions and keep replay traces."
          ],
          extractionQuality: {
            hasContent: true,
            contentChars: 2400
          }
        }
      })
    ], timebox, new Date("2026-06-14T00:00:00.000Z"));

    const report = reportMarkdown({
      mode: "path",
      topic: "browser automation reliability practices for AI agents",
      records,
      meta: {
        timebox,
        metrics: {
          total_records: 2,
          within_timebox: 2,
          final_records: 2
        }
      }
    });

    expect(report).toContain("- human oversight:");
    expect(report).toContain("- bounded retries:");
    expect(report).not.toContain("Accepted evidence supports browser agent");
    expect(report).not.toContain("- browser agent:");
  });

  it("does not use title-like features or page chrome as representative evidence", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords([
      makeRecord({
        id: "marketing-title-source",
        url: "https://alpha.example.com/nova-act",
        content: [
          "Workflow Open main menu Home Tech Home / Tech / Amazon Nova Act: The AI Browser Agent That Outperforms Benchmarks.",
          "Browser automation reliability practices require human oversight, bounded retries, and replay traces before agents continue.",
          "Human oversight gives reviewers a clear escalation point when pages change unexpectedly."
        ].join(" "),
        attributes: {
          retrievalPath: "web:fetch:url",
          features: [
            "Amazon Nova Act: The AI Browser Agent That Outperforms Benchmarks"
          ],
          extractionQuality: {
            hasContent: true,
            contentChars: 2200
          }
        }
      }),
      makeRecord({
        id: "practice-source",
        url: "https://beta.example.com/reliability",
        content: [
          "Browser automation reliability practices require human oversight, bounded retries, and replay traces before agents continue.",
          "Bounded retries and replay traces make failed browser steps auditable for AI coding agents."
        ].join(" "),
        attributes: {
          retrievalPath: "web:fetch:url",
          extractionQuality: {
            hasContent: true,
            contentChars: 2400
          }
        }
      })
    ], timebox, new Date("2026-06-14T00:00:00.000Z"));

    const report = reportMarkdown({
      mode: "path",
      topic: "browser automation reliability practices for AI agents",
      records,
      meta: {
        timebox,
        metrics: {
          total_records: 2,
          within_timebox: 2,
          final_records: 2
        }
      }
    });

    expect(report).toContain("- human oversight:");
    expect(report).toContain("- bounded retries:");
    expect(report).not.toContain("Amazon Nova Act: The AI Browser Agent That Outperforms Benchmarks");
    expect(report).not.toContain("Workflow Open main menu");
  });

  it("keeps live page titles out of final claims when practice evidence is available", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords([
      makeRecord({
        id: "comparison-source",
        url: "https://alpha.example.com/browser-agents",
        content: [
          "Best AI Agents for Browser Automation in 2026 A comprehensive comparison of browser automation agents.",
          "The 2026 generation of browser agents brings visual understanding through screenshots or DOM structures rather than relying on CSS selectors that break when a site updates."
        ].join(" "),
        attributes: {
          retrievalPath: "web:fetch:url",
          features: [
            "Visual understanding: AI models interpret rendered pages through screenshots or DOM structures rather than relying on CSS selectors."
          ],
          extractionQuality: {
            hasContent: true,
            contentChars: 2400
          }
        }
      }),
      makeRecord({
        id: "nova-source",
        url: "https://beta.example.com/nova-act",
        content: [
          "Workflow Open main menu Home Tech Home / Tech / Amazon Nova Act: The AI Browser Agent That Outperforms OpenAI and Anthropic, Achieving 90%+ Reliability in Enterprise Automation AI & Automation.",
          "This reliability breakthrough addresses the tendency for agents to break when web interfaces change.",
          "Enterprise browser automation still requires human oversight for edge cases and reliable escalation."
        ].join(" ")
      })
    ], timebox, new Date("2026-06-14T00:00:00.000Z"));

    const report = reportMarkdown({
      mode: "path",
      topic: "browser automation agent reliability practices for AI coding agents",
      records,
      meta: {
        timebox,
        metrics: {
          total_records: 2,
          within_timebox: 2,
          final_records: 2,
          rejected_candidate_count: 6
        }
      }
    });

    expect(report).toContain("- css selectors:");
    expect(report).toContain("Selected low-confidence tentative claims are included only as bounded signals, not confirmed findings.");
    expect(report).toContain("human oversight");
    expect(report).not.toContain("Accepted evidence supports browser automation");
    expect(report).not.toContain("Browser Agent That Outperforms OpenAI");
    expect(report).not.toContain("Workflow Open main menu");
  });

  it("does not promote command snippets or comparison-table fragments as final research claims", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords([
      makeRecord({
        id: "command-table-source",
        url: "https://alpha.example.com/browser-agents",
        content: [
          "Browser control comparison: Browser Sandbox for AI agents API + open-source Free tier, then $16/mo+ 130,000+ Browser Use Developers building custom agents Open-source framework Free (+ LLM costs) 97,000+ Stagehand TypeScript developers Open-source SDK Free (+ LLM costs).",
          "Add browser skills to your agents npx -y firecrawl-cli@latest init --all --browser # Use Firecrawl Browser Sandbox firecrawl browser \"open https://example.com\" firecrawl browser \"snapshot\" firecrawl browser \"click @e5\".",
          "Reliable browser agents still need result validation after completing the task."
        ].join(" "),
        attributes: {
          retrievalPath: "web:fetch:url",
          extractionQuality: {
            hasContent: true,
            contentChars: 2600
          }
        }
      }),
      makeRecord({
        id: "practice-source",
        url: "https://beta.example.com/browser-automation",
        content: [
          "Browser automation capabilities generated significant discussion about the intersection of coding agents and browser control.",
          "Visual understanding means AI models interpret rendered pages through screenshots or DOM structures rather than relying on CSS selectors that break when a site updates.",
          "Live browser views enable human-in-the-loop oversight when an automated flow reaches an uncertain state."
        ].join(" "),
        attributes: {
          retrievalPath: "web:fetch:url",
          features: [
            "Visual understanding: AI models interpret rendered pages (screenshots or DOM structures) rather than relying on CSS selectors.",
            "Live View: embed a real-time browser view in your app, enabling human-in-the-loop oversight."
          ],
          extractionQuality: {
            hasContent: true,
            contentChars: 2600
          }
        }
      })
    ], timebox, new Date("2026-06-14T00:00:00.000Z"));

    const report = reportMarkdown({
      mode: "path",
      topic: "browser automation agent reliability practices for AI coding agents",
      records,
      meta: {
        timebox,
        metrics: {
          total_records: 2,
          within_timebox: 2,
          final_records: 2,
          rejected_candidate_count: 6
        }
      }
    });

    expect(report).toContain("- css selectors:");
    expect(report).toContain("human-in-the-loop oversight");
    expect(report).not.toContain("Accepted evidence supports browser control");
    expect(report).not.toContain("- agents npx:");
    expect(report).not.toContain("- browser click:");
    expect(report).not.toContain("- browser open:");
    expect(report).not.toContain("- browser sandbox:");
  });

  it("promotes live reliability practice terms over generic agent and browser phrases", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords([
      makeRecord({
        id: "mcp-practice-source",
        url: "https://mcp-practices.test/mcp-browser-agents",
        content: [
          "Browser Debugging What It Provides When to Use It Setup Playwright MCP vs Chrome DevTools MCP Collaborative Browsing: Sharing Your Browser with an Agent Chrome Extension plus MCP Approach.",
          "The server exposes browser actions as MCP tools that your agent can call: navigate to URLs, click elements, take screenshots, and read page content via accessibility tree snapshots.",
          "Accessibility tree snapshots provide structured semantic understanding of the page without brittle CSS selectors."
        ].join(" "),
        attributes: {
          retrievalPath: "web:fetch:url",
          extractionQuality: {
            hasContent: true,
            contentChars: 2600
          }
        }
      }),
      makeRecord({
        id: "agent-practice-source",
        url: "https://agent-practices.test/browser-agent-reliability",
        content: [
          "Browserbase is optimized for AI agent workflows with session management, persistent browser sessions, and session recordings that show exactly what your agent did for debugging.",
          "Page analysis lets the agent read the current page structure through the DOM, accessibility tree, or screenshot before it identifies interactive elements.",
          "Result validation means the agent verifies the outcome and returns structured results after completing the task."
        ].join(" "),
        attributes: {
          retrievalPath: "web:fetch:url",
          features: [
            "Page analysis: The agent reads the current page structure (DOM, accessibility tree, or screenshot) and identifies interactive elements.",
            "Result validation: After completing the task, it verifies the outcome and returns structured results.",
            "Session recordings: Watch exactly what your agent did for debugging."
          ],
          extractionQuality: {
            hasContent: true,
            contentChars: 2800
          }
        }
      })
    ], timebox, new Date("2026-06-14T00:00:00.000Z"));

    const report = reportMarkdown({
      mode: "path",
      topic: "browser automation agent reliability practices for AI coding agents",
      records,
      meta: {
        timebox,
        metrics: {
          total_records: 2,
          within_timebox: 2,
          final_records: 2,
          rejected_candidate_count: 6
        }
      }
    });

    expect(report).toContain("- accessibility tree:");
    expect(report).toContain("Accepted evidence supports accessibility tree");
    expect(report).toContain("- result validation:");
    expect(report).toContain("- session recordings:");
    expect(report).not.toContain("Accepted evidence supports browser use");
    expect(report).not.toContain("Accepted evidence supports your agent");
    expect(report).not.toContain("- agent chrome:");
    expect(report).not.toContain("- agent you:");
  });

  it("uses default artifact files when the briefing compiler is called directly", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords([
      makeRecord()
    ], timebox, new Date("2026-06-14T00:00:00.000Z"));

    const briefing = buildResearchBriefing({
      topic: "default artifact files",
      records,
      meta: {
        timebox,
        metrics: {
          total_records: 1,
          within_timebox: 1,
          final_records: 1
        }
      }
    });

    expect(briefing.artifactFiles).toEqual([
      "summary.md",
      "report.md",
      "records.json",
      "context.json",
      "meta.json",
      "bundle-manifest.json"
    ]);
  });

  it("renders plural stale-record and required-cookie limitations", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords([
      makeRecord({ id: "stale-one", timestamp: "2026-05-01T00:00:00.000Z" }),
      makeRecord({ id: "stale-two", timestamp: "2026-05-02T00:00:00.000Z" })
    ], timebox, new Date("2026-06-14T00:00:00.000Z"));

    const report = reportMarkdown({
      mode: "path",
      topic: "stale required-cookie research",
      records,
      meta: {
        timebox,
        metrics: {
          total_records: 2,
          within_timebox: 0,
          final_records: 2,
          cookie_diagnostics: [{
            provider: "web/default",
            source: "web",
            policy: "required",
            sourceRef: "/tmp/cookies.json",
            sessionEvidence: "cookies_missing",
            message: "Cookie file not found: /tmp/cookies.json"
          }]
        }
      }
    });

    expect(report).toContain("2 accepted records were outside the resolved timebox and excluded from claim support.");
    expect(report).toContain("Cookie file not found: /tmp/cookies.json observed 1 times under required policy; blocking.");
  });

  it("renders plural omitted accepted sources in the evidence appendix", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords(
      Array.from({ length: 22 }, (_, index) => makeRecord({
        id: `bulk-source-${index + 1}`,
        url: `https://bulk-${index + 1}.example.com/research-report-quality`
      })),
      timebox,
      new Date("2026-06-14T00:00:00.000Z")
    );

    const report = reportMarkdown({
      mode: "path",
      topic: "bulk source appendix",
      records,
      meta: {
        timebox,
        metrics: {
          total_records: 22,
          within_timebox: 22,
          final_records: 22
        }
      }
    });

    expect(report).toContain("2 more accepted sources omitted from this report; see records.json.");
  });

  it("parses defensive metadata aliases and search redirect fallbacks", () => {
    const metaView = buildResearchBriefingMetaView({
      metrics: {
        challengeDiagnostics: [{ provider: "web/default" }],
        challengeOrchestration: [{ status: "observed" }],
        sanitized_reason_distribution: {
          empty_reason: 0,
          search_index_shell: 2
        }
      }
    });

    expect(metaView.challengeDiagnostics).toHaveLength(1);
    expect(metaView.challengeOrchestration).toHaveLength(1);
    expect(metaView.sanitizedReasonDistribution).toEqual({ search_index_shell: 2 });
    expect(rejectionPressure(0, 0)).toBe(0);
    expect(unwrapSearchRedirect("https://duckduckgo.com/l?foo=bar")).toBe("https://duckduckgo.com/l?foo=bar");
    expect(unwrapSearchRedirect("not a url")).toBe("not a url");
  });

  it("prefers snake_case challenge diagnostics when both metadata aliases are present", () => {
    const metaView = buildResearchBriefingMetaView({
      metrics: {
        challenge_diagnostics: [{ provider: "snake-diagnostic" }],
        challengeDiagnostics: [{ provider: "camel-diagnostic" }],
        challenge_orchestration: [{ status: "snake-orchestration" }],
        challengeOrchestration: [{ status: "camel-orchestration" }]
      }
    });

    expect(metaView.challengeDiagnostics).toEqual([{ provider: "snake-diagnostic" }]);
    expect(metaView.challengeOrchestration).toEqual([{ status: "snake-orchestration" }]);
  });

  it("combines dead-end search failures with sanitized rejection pressure and reads camelCase diagnostics", () => {
    const deadEndFailure = {
      provider: "web/default",
      source: "web",
      error: {
        message: "Research search resolved only dead-end pages.",
        details: { fallbackOutputReason: "research_dead_end_shell" }
      }
    };
    const metaView = buildResearchBriefingMetaView({
      failures: [deadEndFailure],
      metrics: {
        sanitized_reason_distribution: { search_index_shell: 2 }
      }
    });
    const explicitZeroMetaView = buildResearchBriefingMetaView({
      failures: [deadEndFailure],
      metrics: {
        rejected_candidate_count: 0,
        sanitized_records: 2
      }
    });
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords([
      makeRecord({ id: "alpha", url: "https://alpha.example.com/report" }),
      makeRecord({ id: "beta", url: "https://beta.example.com/report" }),
      makeRecord({ id: "gamma", url: "https://gamma.example.com/report" })
    ], timebox, new Date("2026-06-14T00:00:00.000Z"));

    const report = reportMarkdown({
      mode: "path",
      topic: "camel case diagnostics research",
      records,
      meta: {
        timebox,
        metrics: {
          total_records: 3,
          within_timebox: 3,
          final_records: 3,
          antiBotPressure: {
            antiBotFailures: 1,
            totalFailures: 2
          },
          transcriptDurability: {
            attempted: 3,
            successful: 1
          }
        }
      }
    });

    expect(metaView.rejectedCandidateCount).toBe(3);
    expect(explicitZeroMetaView.rejectedCandidateCount).toBe(0);
    expect(report).toContain("Evidence gate: partial");
    expect(report).toContain("Anti-bot pressure was reported in 1 of 2 provider failures.");
    expect(report).toContain("Transcript durability is constrained: 1 of 3 transcript attempts succeeded.");
    expect(report).toContain("Anti-bot pressure: 1 of 2 provider failures were anti-bot related.");
    expect(report).toContain("Transcript durability: 1 of 3 transcript attempts succeeded.");
  });

  it("renders markdown fallbacks for empty briefing sections and zero confidence reasons", () => {
    const briefing = buildResearchBriefing({
      topic: "empty renderer guardrails",
      records: [],
      meta: {
        metrics: {
          total_records: 0,
          final_records: 0
        }
      }
    });
    const [claim] = briefing.claims;
    if (!claim) {
      throw new Error("Expected the empty briefing to include an excluded claim.");
    }

    const report = renderResearchBriefingMarkdown({
      ...briefing,
      finalAnswer: [],
      agreement: [],
      themes: [],
      claims: [{
        ...claim,
        confidence: {
          label: "low",
          score: 0,
          reasons: []
        }
      }],
      limitations: [],
      recommendations: []
    });

    expect(report).toContain("## Final Answer\n- None.");
    expect(report).toContain("- No themes could be promoted from accepted evidence.");
    expect(report).toContain("claim-1: low (0) because no positive confidence factors were met.");
    expect(report).toContain("## Limitations\n- None.");
    expect(report).toContain("## Recommendations\n- None.");
  });

  it("excludes stale records from synthesis even when report metadata omits the timebox", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords([
      makeRecord({
        id: "stale-feature-source",
        url: "https://alpha.example.com/retry-logic",
        timestamp: "2026-05-01T00:00:00.000Z",
        content: "Stable retry logic keeps browser automation failures auditable for later review.",
        attributes: {
          retrievalPath: "web:fetch:url",
          features: [
            42,
            "Skip to main content retry logic for browser workflow failure handling."
          ],
          extractionQuality: {
            hasContent: true,
            contentChars: 1600
          }
        }
      })
    ], timebox, new Date("2026-06-14T00:00:00.000Z"));

    const report = reportMarkdown({
      mode: "path",
      topic: "retry logic browser automation",
      records,
      meta: {
        metrics: {
          total_records: 1,
          within_timebox: 0,
          final_records: 1
        }
      }
    });

    expect(report).toContain("Evidence gate: fail");
    expect(report).toContain("1 accepted record was outside the resolved timebox and excluded from claim support.");
    expect(report).toContain("Within timebox: no");
    expect(report).not.toContain("- retry logic:");
    expect(report).not.toContain("42");
  });

  it("filters numeric and weak-leading theme phrases before promotion", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords([
      makeRecord({
        id: "numeric-noise-source",
        url: "https://alpha.example.com/evidence-gates",
        content: [
          "2026 evidence gates should not become a promoted numeric theme.",
          "Tools recovery steps should not become a weak leading theme.",
          "Evidence gates keep claim confidence traceable for browser automation research."
        ].join(" ")
      }),
      makeRecord({
        id: "supporting-source",
        url: "https://beta.example.com/evidence-gates",
        content: "Evidence gates keep confidence and limitations visible before an agent uses the research."
      })
    ], timebox, new Date("2026-06-14T00:00:00.000Z"));

    const report = reportMarkdown({
      mode: "path",
      topic: "evidence gates browser automation research",
      records,
      meta: {
        timebox,
        metrics: {
          total_records: 2,
          within_timebox: 2,
          final_records: 2
        }
      }
    });

    expect(report).toContain("- evidence gates:");
    expect(report).not.toContain("- 2026 evidence:");
    expect(report).not.toContain("- tools recovery:");
  });

  it("covers defensive claim summaries and passage scoring branches", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords([
      makeRecord({
        id: "branch-source",
        url: "",
        content: [
          "Reliable browser agents use stable selectors and retry logic before publishing evidence.",
          "npx -y runner npm install demo command output should be treated as weak support."
        ].join(" "),
        attributes: {
          retrievalPath: "web:fetch:url",
          features: [
            42,
            "Use stable selectors and retry logic for browser workflow failure recovery."
          ],
          extractionQuality: {
            hasContent: true,
            contentChars: 1600
          }
        }
      })
    ], timebox, new Date("2026-06-14T00:00:00.000Z"));
    const [record] = records;
    if (!record) {
      throw new Error("Expected enriched branch coverage record.");
    }
    const metaView = buildResearchBriefingMetaView({
      metrics: {
        total_records: 1,
        within_timebox: 1,
        final_records: 1
      }
    });
    const gate = { status: "pass" as const, summary: "ok", criteria: [] };
    const longPassageText = [
      "Evidence gates keep browser automation claims traceable to accepted source passages.",
      "This deliberately long representative passage keeps describing confidence factors, limitations, recommendations, record identifiers, and source URLs so the claim summary must truncate deterministically."
    ].join(" ");
    const claims = buildClaims({
      records,
      topic: "browser automation evidence gates",
      metaView,
      gate,
      themes: [
        {
          phrase: "audit trails",
          recordIds: [],
          urls: [],
          domainCount: 0,
          sourceCount: 0,
          passages: [{
            recordId: record.id,
            title: record.title ?? "Branch source",
            url: record.url ?? "URL not provided",
            source: record.source,
            provider: record.provider,
            text: longPassageText,
            analysisText: longPassageText,
            score: 1
          }],
          disagreementSignals: []
        }
      ]
    });
    const missingPassageClaims = buildClaims({
      records,
      topic: "browser automation evidence gates",
      metaView,
      gate,
      themes: [{
        phrase: "missing passage",
        recordIds: [record.id],
        urls: [],
        domainCount: 1,
        sourceCount: 1,
        passages: [],
        disagreementSignals: []
      }]
    });
    const noThemeClaims = buildClaims({
      records,
      topic: "browser automation evidence gates",
      metaView,
      gate,
      themes: []
    });
    const passages = selectPassages("retry logic browser automation", records);

    expect(claims[0]?.text).toContain("...");
    expect(claims[0]?.confidence.reasons).not.toContain("supporting records are inside the resolved timebox");
    expect(missingPassageClaims[0]?.text).toContain("no representative passage selected");
    expect(noThemeClaims[0]?.urls).toEqual([]);
    expect(passages.some((passage) => passage.analysisText.includes("retry logic"))).toBe(true);
    expect(passages.some((passage) => passage.analysisText === "42")).toBe(false);
    expect(compareStableText("z", "a")).toBe(1);
  });

  it("renders scalar diagnostics, transcript metadata fallbacks, and active challenge branches", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords([
      makeRecord({
        id: "diagnostic-source",
        url: "https://diagnostics.example.com/browser-agent-reliability",
        content: "Browser agent reliability reports should surface active challenge diagnostics and transcript metadata before claims are reused."
      })
    ], timebox, new Date("2026-06-14T00:00:00.000Z"));

    const report = reportMarkdown({
      mode: "path",
      topic: "browser agent reliability diagnostics",
      records,
      meta: {
        timebox,
        metrics: {
          total_records: 1,
          within_timebox: 1,
          final_records: 1,
          challenge_diagnostics: [{
            provider: "web/default",
            source: 7,
            reasonCode: 429
          }],
          challenge_orchestration: [{
            provider: 42,
            mode: true,
            status: "active",
            invoked: true
          }],
          anti_bot_pressure: {
            total_failures: 2,
            anti_bot_failures: 1
          },
          transcript_durability: {
            detail: "reported"
          },
          alerts: [{
            provider: 123,
            signal: true,
            state: "warning",
            reason: "active provider signal"
          }]
        }
      }
    });

    expect(isActiveChallengeOrchestration({ invoked: true, status: "active" })).toBe(true);
    expect(isActiveChallengeOrchestration({ invoked: true, status: 17 })).toBe(true);
    expect(report).toContain("Evidence gate: partial");
    expect(report).toContain("Challenge diagnostic: provider=web/default source=7 reason=429.");
    expect(report).toContain("Challenge orchestration: provider=42 mode=true status=active.");
    expect(report).toContain("Anti-bot pressure: 1 of 2 provider failures were anti-bot related.");
    expect(report).toContain("Transcript durability metadata was reported; inspect meta.json for transcript-backed evidence limits.");
    expect(report).toContain("Transcript durability metadata was reported; see meta.json.");
    expect(report).toContain("Workflow alert: provider=123 signal=true state=warning reason=active provider signal.");
  });

});
