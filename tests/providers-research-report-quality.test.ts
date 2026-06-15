import { describe, expect, it } from "vitest";
import { enrichResearchRecords } from "../src/providers/enrichment";
import { resolveTimebox } from "../src/providers/timebox";
import {
  makeResearchRecord as makeRecord,
  researchReportMarkdown as reportMarkdown
} from "./helpers/research-report-fixtures";

describe("deterministic research report live-quality regressions", () => {
  it("does not promote phrases spliced across stopwords or headings from live reliability evidence", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords([
      makeRecord({
        id: "browser-agent-source",
        url: "https://alpha.example.com/browser-agent-reliability",
        content: [
          "Execution with adaptation: It performs the action and monitors the result.",
          "If something unexpected happens, a popup, a CAPTCHA, or a page layout change, it adapts.",
          "Intent interpretation: You give the agent a natural language browser automation goal.",
          "Submit compliance forms to government websites that lack APIs Monitor content changes across hundreds of pages.",
          "Browser providers expose managed browser instances for agent workflows.",
          "Session management - Persistent browser sessions with cookie and localStorage management across agent runs.",
          "Session recordings - Watch exactly what your agent did for debugging.",
          "Page analysis reads the DOM and accessibility tree before the next action."
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
        id: "second-source",
        url: "https://beta.example.com/browser-agent-reliability",
        content: [
          "Reliable browser agents use the accessibility tree and session recordings for replayable diagnostics.",
          "Teams keep result validation visible before accepting an automated browser task."
        ].join(" "),
        attributes: {
          retrievalPath: "web:fetch:url",
          extractionQuality: {
            hasContent: true,
            contentChars: 2200
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
          rejected_candidate_count: 4
        }
      }
    });

    expect(report).toContain("- accessibility tree:");
    expect(report).toContain("- session recordings:");
    expect(report).not.toContain("- action monitors:");
    expect(report).not.toContain("- monitors result:");
    expect(report).not.toContain("- recordings watch:");
    expect(report).not.toContain("- runs session:");
    expect(report).not.toContain("- workflows session:");
    expect(report).not.toContain("- automation goal:");
    expect(report).not.toContain("- websites monitor:");
    expect(report).not.toContain("- apis monitor:");
    expect(report).not.toContain("- agent runs:");
    expect(report).not.toContain("- browser task:");
    expect(report).not.toContain("- browser instances:");
    expect(report).not.toContain("- browser providers:");
    expect(report).not.toContain("- monitor content:");
  });

  it("promotes practice-level live evidence over comparison and navigation fragments", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords([
      makeRecord({
        id: "platform-practices",
        url: "https://alpha.example.com/production-browser-automation",
        content: [
          "Browser Automation Platforms in 2026 Table of content Evaluating Browser Automation Platforms Deterministic vs AI-Driven Automation.",
          "deterministic audit trails E-commerce Price monitoring, inventory tracking, competitor analysis High volume, low cost per execution.",
          "Use stable element identification. Collaborate with development teams to add test-specific attributes like data-test-id to critical UI elements.",
          "Avoid fragile XPath chains or index-based selectors.",
          "Implement modular architecture by breaking workflows into reusable components: Authentication modules for login handling, Navigation modules for menu interactions, Data extraction modules for common patterns, Error handling modules for retry logic.",
          "Monitor proactively by tracking execution metrics to catch problems early: Success rates by workflow, Execution time trends, Failure patterns by error type, Resource utilization.",
          "Automated alerts when metrics degrade enable fixes before business impact occurs."
        ].join(" "),
        attributes: {
          retrievalPath: "web:fetch:url",
          features: [
            "Error handling modules for retry logic",
            "Failure patterns by error type",
            "Automated alerts when metrics degrade"
          ],
          extractionQuality: {
            hasContent: true,
            contentChars: 14575
          }
        }
      }),
      makeRecord({
        id: "verification-practices",
        url: "https://beta.example.com/deterministic-verification",
        content: [
          "A deterministic verification framework ensures browser agents fail fast and transparently.",
          "Step-by-step assertions replace guesswork with testable source-backed checks."
        ].join(" "),
        attributes: {
          retrievalPath: "web:fetch:url",
          extractionQuality: {
            hasContent: true,
            contentChars: 1464
          }
        }
      }),
      makeRecord({
        id: "browserbook-practices",
        url: "https://gamma.example.com/browserbook",
        content: [
          "Features Pricing Demo Blog Resources Download Backed by The Browser Automation IDE.",
          "Deterministic by default. Build fast reliable automations that run cheaper than browser agents.",
          "Self-healing automations adapt to UI changes and fix themselves."
        ].join(" "),
        attributes: {
          retrievalPath: "web:fetch:url",
          extractionQuality: {
            hasContent: true,
            contentChars: 5445
          }
        }
      })
    ], timebox, new Date("2026-06-14T00:00:00.000Z"));

    const report = reportMarkdown({
      mode: "path",
      topic: "deterministic research report quality in browser automation tools",
      records,
      meta: {
        timebox,
        metrics: {
          total_records: 3,
          within_timebox: 3,
          final_records: 3,
          rejected_candidate_count: 6
        }
      }
    });

    expect(report).toContain("- retry logic:");
    expect(report).toContain("- deterministic verification:");
    expect(report).toContain("Error handling modules for retry logic");
    expect(report).not.toContain("- price monitoring:");
    expect(report).not.toContain("- monitoring data:");
    expect(report).not.toContain("- accessibility testing:");
    expect(report).not.toContain("- app accessibility:");
    expect(report).not.toContain("- cloud accessibility:");
    expect(report).not.toContain("- browser automation:");
    expect(report).not.toContain("- automation chromium:");
  });

  it("does not promote quantifier-led or broad framework labels from live report output", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords([
      makeRecord({
        id: "sandbox-source",
        url: "https://alpha.example.com/browser-automation-sandbox",
        content: [
          "Isolated sandbox - Every session runs in a fully contained environment.",
          "Agents and the sites they visit are isolated from your own infrastructure.",
          "Reliable browser automation tools also preserve deterministic traces and screenshots for audit."
        ].join(" "),
        attributes: {
          retrievalPath: "web:fetch:url",
          extractionQuality: {
            hasContent: true,
            contentChars: 1800
          }
        }
      }),
      makeRecord({
        id: "framework-source",
        url: "https://beta.example.com/browser-automation-frameworks",
        content: [
          "Browser automation frameworks Chrome, Firefox, Edge, Safari, and older browser setups WebDriver-based browser control.",
          "Teams reduce flake by using stable selectors, retry logic, and source-backed trace evidence."
        ].join(" "),
        attributes: {
          retrievalPath: "web:fetch:url",
          extractionQuality: {
            hasContent: true,
            contentChars: 2200
          }
        }
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

    expect(report).toContain("- stable selectors:");
    expect(report).toContain("- retry logic:");
    expect(report).not.toContain("- every session:");
    expect(report).not.toContain("- automation frameworks:");
    expect(report).not.toContain("- automation teams:");
  });

  it("filters browser engine and automation framework list fragments before final claims", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords([
      makeRecord({
        id: "engine-list-source",
        url: "https://alpha.example.com/browser-engine-lists",
        content: [
          "Browser automation Chromium Firefox Edge Safari WebKit Playwright Selenium compatibility appears in a platform list.",
          "Teams reduce fragile flows with stable element identification and retry logic."
        ].join(" "),
        attributes: {
          retrievalPath: "web:fetch:url",
          features: [
            "Use stable element identification for durable UI targeting.",
            "Retry logic keeps failed browser workflows auditable."
          ],
          extractionQuality: {
            hasContent: true,
            contentChars: 2600
          }
        }
      }),
      makeRecord({
        id: "framework-list-source",
        url: "https://beta.example.com/browser-framework-lists",
        content: [
          "Browser automation Chromium Firefox Edge Safari WebKit Playwright Selenium support should stay a source detail, not a claim.",
          "Research reports remain useful when deterministic verification and confidence labels are visible."
        ].join(" "),
        attributes: {
          retrievalPath: "web:fetch:url",
          features: [
            "Run deterministic verification before publishing browser automation findings.",
            "Publish confidence labels for each claim."
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
      topic: "browser automation framework quality for chromium firefox edge safari tools",
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
    const finalAnswer = report.slice(
      report.indexOf("## Final Answer"),
      report.indexOf("## Claim Map")
    ).toLowerCase();

    expect(report).toContain("- element identification:");
    expect(report).toContain("- retry logic:");
    expect(report).toContain("- deterministic verification:");
    expect(report).toContain("- confidence labels:");
    expect(report).not.toContain("- automation chromium:");
    expect(report).not.toContain("- chromium firefox:");
    expect(report).not.toContain("- edge safari:");
    expect(finalAnswer).not.toContain("automation chromium");
    expect(finalAnswer).not.toContain("chromium firefox");
    expect(finalAnswer).not.toContain("edge safari");
  });

  it("does not promote comparison-object or connector fragments from live browser automation pages", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords([
      makeRecord({
        id: "platform-practices",
        url: "https://alpha.example.com/production-browser-automation",
        content: [
          "Deterministic core with AI for edge cases like CAPTCHAs and natural language extraction.",
          "Visual AI Element identification by appearance rather than DOM structure.",
          "Have predictable, stable interfaces.",
          "Error handling modules for retry logic.",
          "Failure patterns by error type."
        ].join(" "),
        attributes: {
          retrievalPath: "web:fetch:url",
          features: [
            "Error handling modules for retry logic",
            "Failure patterns by error type"
          ],
          extractionQuality: {
            hasContent: true,
            contentChars: 14575
          }
        }
      }),
      makeRecord({
        id: "table-source",
        url: "https://beta.example.com/browser-tools",
        content: [
          "Browser Automation Tools # The table below compares the 12 tools based on evaluation criteria.",
          "The guide explains how tools perform in real scenarios and support stable maintainable test automation.",
          "Debugging support includes screenshots, traces, and logs for failure review."
        ].join(" "),
        attributes: {
          retrievalPath: "web:fetch:url",
          extractionQuality: {
            hasContent: true,
            contentChars: 3200
          }
        }
      }),
      makeRecord({
        id: "verification-practices",
        url: "https://gamma.example.com/deterministic-verification",
        content: [
          "A deterministic verification framework ensures browser agents fail fast and transparently.",
          "Step-by-step assertions replace guesswork with testable source-backed checks."
        ].join(" "),
        attributes: {
          retrievalPath: "web:fetch:url",
          extractionQuality: {
            hasContent: true,
            contentChars: 1800
          }
        }
      })
    ], timebox, new Date("2026-06-14T00:00:00.000Z"));

    const report = reportMarkdown({
      mode: "path",
      topic: "deterministic research report quality in browser automation tools",
      records,
      meta: {
        timebox,
        metrics: {
          total_records: 3,
          within_timebox: 3,
          final_records: 3,
          rejected_candidate_count: 6
        }
      }
    });
    const finalAnswer = report.slice(
      report.indexOf("## Final Answer"),
      report.indexOf("## Claim Map")
    );

    expect(report).toContain("- element identification:");
    expect(report).toContain("- retry logic:");
    expect(report).toContain("- deterministic verification:");
    expect(finalAnswer).toContain("Selected low-confidence tentative claims are included only as bounded signals, not confirmed findings.");
    expect(report).not.toContain("- dom structure:");
    expect(report).not.toContain("- than dom:");
    expect(report).not.toContain("- support stable:");
    expect(report).not.toContain("- tools based:");
  });

  it("renders a conservative usable final answer for live partial gates with accepted evidence", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords([
      makeRecord({
        id: "element-identification-source",
        url: "https://element-identification.test/production-browser-automation",
        content: [
          "Deterministic core with AI for edge cases like CAPTCHAs and natural language extraction.",
          "Use stable element identification and collaborate with teams to add test-specific attributes.",
          "Avoid fragile XPath chains or index-based selectors when pages change."
        ].join(" "),
        attributes: {
          retrievalPath: "web:fetch:url",
          features: ["Use stable element identification"],
          extractionQuality: { hasContent: true, contentChars: 14575 }
        }
      }),
      makeRecord({
        id: "verification-source",
        url: "https://verification-practices.test/deterministic-verification",
        content: [
          "A deterministic verification framework ensures browser agents fail fast and transparently.",
          "Step-by-step assertions replace guesswork with testable source-backed checks."
        ].join(" "),
        attributes: {
          retrievalPath: "web:fetch:url",
          extractionQuality: { hasContent: true, contentChars: 1800 }
        }
      }),
      makeRecord({
        id: "retry-source",
        url: "https://retry-practices.test/retry-logic",
        content: "Error handling modules for retry logic keep failed browser workflows auditable.",
        attributes: {
          retrievalPath: "web:fetch:url",
          features: ["Error handling modules for retry logic"],
          extractionQuality: { hasContent: true, contentChars: 1400 }
        }
      }),
      makeRecord({
        id: "replay-source",
        url: "https://replay-practices.test/replay-traces",
        content: "Debugging support includes screenshots, traces, and logs for failure review.",
        attributes: {
          retrievalPath: "web:fetch:url",
          features: ["Keep replay traces for failure review"],
          extractionQuality: { hasContent: true, contentChars: 1600 }
        }
      }),
      makeRecord({
        id: "interface-source",
        url: "https://interface-practices.test/stable-interfaces",
        content: "Reliable automation workflows use predictable stable interfaces and clear escalation paths.",
        attributes: {
          retrievalPath: "web:fetch:url",
          features: ["Have predictable stable interfaces"],
          extractionQuality: { hasContent: true, contentChars: 1500 }
        }
      })
    ], timebox, new Date("2026-06-14T00:00:00.000Z"));

    const report = reportMarkdown({
      mode: "path",
      topic: "deterministic research report quality in browser automation tools",
      records,
      meta: {
        timebox,
        metrics: {
          total_records: 15,
          within_timebox: 5,
          final_records: 5,
          rejected_candidate_count: 10
        }
      }
    });
    const finalAnswer = report.slice(
      report.indexOf("## Final Answer"),
      report.indexOf("## Claim Map")
    );

    expect(report).toContain("Evidence gate: partial");
    expect(finalAnswer).toContain("Under a partial evidence gate, accepted records provide bounded signals");
    expect(finalAnswer).toContain("Supporting records:");
    expect(finalAnswer).toContain("Selected low-confidence tentative claims are included only as bounded signals");
    expect(finalAnswer.match(/claim-\d:/g) ?? []).not.toHaveLength(0);
    expect(finalAnswer).not.toEqual("## Final Answer\n- Low-confidence tentative claims are retained in the claim map but are not treated as final answer support.\n\n");
  });

  it("renders bounded tentative signals when a pass gate has no multi-source accepted claim", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords([
      makeRecord({
        id: "element-identification-source",
        url: "https://element-identification-pass.test/production-browser-automation",
        confidence: 0.6,
        content: "Use stable element identification and collaborate with teams to add test-specific attributes.",
        attributes: {
          retrievalPath: "web:fetch:url",
          features: ["Use stable element identification"],
          extractionQuality: { hasContent: true, contentChars: 14575 }
        }
      }),
      makeRecord({
        id: "verification-source",
        url: "https://verification-pass.test/deterministic-verification",
        confidence: 0.6,
        content: "A deterministic verification framework ensures browser agents fail fast and transparently.",
        attributes: {
          retrievalPath: "web:fetch:url",
          extractionQuality: { hasContent: true, contentChars: 1800 }
        }
      }),
      makeRecord({
        id: "retry-source",
        url: "https://retry-pass.test/retry-logic",
        confidence: 0.6,
        content: "Error handling modules for retry logic keep failed browser workflows auditable.",
        attributes: {
          retrievalPath: "web:fetch:url",
          features: ["Error handling modules for retry logic"],
          extractionQuality: { hasContent: true, contentChars: 1400 }
        }
      }),
      makeRecord({
        id: "replay-source",
        url: "https://replay-pass.test/replay-traces",
        confidence: 0.6,
        content: "Debugging support includes screenshots, traces, and logs for failure review.",
        attributes: {
          retrievalPath: "web:fetch:url",
          features: ["Keep replay traces for failure review"],
          extractionQuality: { hasContent: true, contentChars: 1600 }
        }
      }),
      makeRecord({
        id: "interface-source",
        url: "https://interface-pass.test/stable-interfaces",
        confidence: 0.6,
        content: "Reliable automation workflows use predictable stable interfaces and clear escalation paths.",
        attributes: {
          retrievalPath: "web:fetch:url",
          features: ["Have predictable stable interfaces"],
          extractionQuality: { hasContent: true, contentChars: 1500 }
        }
      })
    ], timebox, new Date("2026-06-14T00:00:00.000Z"));

    const report = reportMarkdown({
      mode: "path",
      topic: "deterministic research report quality in browser automation tools",
      records,
      meta: {
        timebox,
        metrics: {
          total_records: 5,
          within_timebox: 5,
          final_records: 5,
          rejected_candidate_count: 0
        }
      }
    });
    const finalAnswer = report.slice(
      report.indexOf("## Final Answer"),
      report.indexOf("## Claim Map")
    );

    expect(report).toContain("Evidence gate: pass");
    expect(finalAnswer).toContain("Accepted records provide bounded low-confidence signals");
    expect(finalAnswer).toContain("Supporting records:");
    expect(finalAnswer).toContain("Selected low-confidence tentative claims are included only as bounded signals");
    expect(finalAnswer.match(/claim-\d:/g) ?? []).not.toHaveLength(0);
  });

  it("ignores header-only extracted features when building evidence passages", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords([
      makeRecord({
        id: "header-feature-source",
        url: "https://alpha.example.com/header-only",
        content: "The page body says reliable agent workflows need auditable replay traces before use.",
        attributes: {
          retrievalPath: "web:fetch:url",
          features: [
            "Amazon Nova Act: The AI Browser Agent That Outperforms Benchmarks"
          ],
          extractionQuality: {
            hasContent: true,
            contentChars: 1800
          }
        }
      })
    ], timebox, new Date("2026-06-14T00:00:00.000Z"));

    const report = reportMarkdown({
      mode: "path",
      topic: "browser agent benchmark reliability",
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

    expect(report).toContain("auditable replay traces");
    expect(report).not.toContain("- browser agent:");
    expect(report).not.toContain("Amazon Nova Act: The AI Browser Agent That Outperforms Benchmarks");
  });

  it("focuses theme passages around evidence terms instead of leading navigation boilerplate", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords([
      makeRecord({
        id: "boilerplate-source",
        url: "https://alpha.example.com/browser-automation",
        content: [
          "Skip to main content Navigation menu Search Login Documentation Support Release Notes",
          "Browser automation tools need evidence gates, confidence labels, source links, and clear limitations for agent handoff."
        ].join(" ")
      }),
      makeRecord({
        id: "evidence-source",
        url: "https://beta.example.com/browser-automation",
        content: "Browser automation tools need deterministic report briefings that cite accepted records and summarize limitations."
      })
    ], timebox, new Date("2026-06-14T00:00:00.000Z"));

    const report = reportMarkdown({
      mode: "path",
      topic: "browser automation tools",
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
    expect(report).toContain("- confidence labels:");
    expect(report).toContain("boilerplate-source: evidence gates");
    expect(report).not.toContain("boilerplate-source: Skip to main content");
    expect(report).toContain("  - Evidence: Browser automation tools need evidence gates");
    expect(report).not.toContain("  - Evidence: Skip to main content");
    expect(report).not.toContain("- automation tools:");
  });

  it("filters duplicate-token and weak verb-led theme phrases", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords([
      makeRecord({
        id: "automation-source",
        url: "https://alpha.example.com/browser-automation",
        content: [
          "Browser automation tools need deterministic evidence and clear report quality signals.",
          "Automation automation appears in noisy extracted text and should not become a theme."
        ].join(" ")
      }),
      makeRecord({
        id: "flow-source",
        url: "https://beta.example.com/browser-flows",
        content: [
          "Teams automate browser flows, but the useful evidence theme is browser automation tools.",
          "Browser automation tools need accepted source passages and confidence labels."
        ].join(" ")
      })
    ], timebox, new Date("2026-06-14T00:00:00.000Z"));

    const report = reportMarkdown({
      mode: "path",
      topic: "browser automation tools",
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

    expect(report).toContain("- deterministic evidence:");
    expect(report).toContain("- confidence labels:");
    expect(report).not.toContain("- browser automation:");
    expect(report).not.toContain("- automation automation:");
    expect(report).not.toContain("- automate browser:");
    expect(report).not.toContain("- automation appears:");
  });

  it("does not treat incidental standalone not as a disagreement cue", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords([
      makeRecord({
        id: "first-source",
        url: "https://alpha.example.com/browser-automation",
        content: "Browser automation tools are listed by category, not ranked by preference, while evidence links stay explicit."
      }),
      makeRecord({
        id: "second-source",
        url: "https://beta.example.com/browser-automation",
        content: "Browser automation tools need deterministic evidence briefings with confidence labels and limitations."
      })
    ], timebox, new Date("2026-06-14T00:00:00.000Z"));

    const report = reportMarkdown({
      mode: "path",
      topic: "browser automation tools",
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

    expect(report).toContain("No direct disagreement detected in accepted sources.");
    expect(report).not.toContain("Disagreement cues: not");
  });

  it("does not promote theme phrases spliced across punctuation boundaries", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords([
      makeRecord({
        id: "punctuation-source",
        url: "https://alpha.example.com/browser-automation",
        content: [
          "AI automation: deterministic verification frameworks make browser automation tools easier to audit.",
          "Browser automation tools need accepted evidence and confidence labels."
        ].join(" ")
      }),
      makeRecord({
        id: "supporting-source",
        url: "https://beta.example.com/browser-automation",
        content: "Browser automation tools need deterministic report briefings that cite accepted records and summarize limitations."
      })
    ], timebox, new Date("2026-06-14T00:00:00.000Z"));

    const report = reportMarkdown({
      mode: "path",
      topic: "deterministic browser automation tools",
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

    expect(report).toContain("- accepted evidence:");
    expect(report).toContain("- summarize limitations:");
    expect(report).not.toContain("- automation tools:");
    expect(report).not.toContain("automation deterministic");
  });

  it("promotes semantically equivalent reliability practices across independent accepted sources", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords([
      makeRecord({
        id: "human-loop-source",
        url: "https://alpha-oversight.test/browser-agent-oversight",
        content: [
          "Browser agent reliability improves when teams keep a live browser view for human-in-the-loop oversight.",
          "The same workflow stores screenshots and traces so reviewers can audit failed browser actions."
        ].join(" "),
        attributes: {
          retrievalPath: "web:fetch:url",
          extractionQuality: { hasContent: true, contentChars: 2400 }
        }
      }),
      makeRecord({
        id: "safeguard-source",
        url: "https://beta-safeguards.test/agent-safeguards",
        content: [
          "External safeguards combine behavior auditing with human review for high-risk browser automation queries.",
          "Real-time monitoring of agent decisions helps detect anomalies before the workflow continues."
        ].join(" "),
        attributes: {
          retrievalPath: "web:fetch:url",
          extractionQuality: { hasContent: true, contentChars: 2600 }
        }
      }),
      makeRecord({
        id: "page-analysis-source",
        url: "https://gamma-analysis.test/browser-page-analysis",
        content: [
          "Reliable browser agents inspect the DOM and accessibility tree before planning the next action.",
          "Session recordings keep replayable diagnostics available for debugging."
        ].join(" "),
        attributes: {
          retrievalPath: "web:fetch:url",
          extractionQuality: { hasContent: true, contentChars: 2500 }
        }
      }),
      makeRecord({
        id: "visual-understanding-source",
        url: "https://delta-visual.test/visual-browser-agents",
        content: [
          "Visual understanding lets AI models interpret rendered pages and screenshots instead of relying only on brittle CSS selectors.",
          "Error recovery and self-healing flows keep changed pages from silently corrupting results."
        ].join(" "),
        attributes: {
          retrievalPath: "web:fetch:url",
          extractionQuality: { hasContent: true, contentChars: 2700 }
        }
      })
    ], timebox, new Date("2026-06-14T00:00:00.000Z"));

    const report = reportMarkdown({
      mode: "path",
      topic: "recent browser automation reliability practices for AI agents",
      records,
      meta: {
        timebox,
        metrics: {
          total_records: 4,
          within_timebox: 4,
          final_records: 4
        }
      }
    });
    const finalAnswer = report.slice(
      report.indexOf("## Final Answer"),
      report.indexOf("## Claim Map")
    );

    expect(report).toContain("Evidence gate: pass");
    expect(report).toContain("- human oversight: 2 accepted records across 2 independent domains.");
    expect(report).toContain("- page-state analysis: 2 accepted records across 2 independent domains.");
    expect(report).toContain("  - Status: accepted");
    expect(report).toMatch(/claim-\d: (?:high|medium) \([3-9]\)/);
    expect(finalAnswer).toContain("The accepted evidence supports 2 decision-ready findings");
    expect(finalAnswer).toContain("human oversight - claim-");
    expect(finalAnswer).not.toContain("bounded low-confidence signals");
  });

  it("groups live reliability synonyms into decision-ready semantic findings", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords([
      makeRecord({
        id: "supervision-source",
        url: "https://alpha-live.test/browser-agents-production",
        content: "The biggest risks are reliability, cost, and governance, so production teams should treat browser agents like supervised systems.",
        attributes: {
          retrievalPath: "web:fetch:url",
          features: ["Production teams should treat browser agents like supervised systems, not autonomous magic."],
          extractionQuality: { hasContent: true, contentChars: 3200 }
        }
      }),
      makeRecord({
        id: "escalation-source",
        url: "https://beta-live.test/web-connected-agents",
        content: "Human escalation for persistent failures logs failure context and surfaces it to a human operator rather than hallucinating a response.",
        attributes: {
          retrievalPath: "web:fetch:url",
          features: ["Human escalation for persistent failures surfaces context to a human operator."],
          extractionQuality: { hasContent: true, contentChars: 3600 }
        }
      }),
      makeRecord({
        id: "adaptation-source",
        url: "https://gamma-live.test/browser-agents",
        content: "Execution with adaptation monitors the result; if a popup, CAPTCHA, or page layout change appears, the browser agent adapts.",
        attributes: {
          retrievalPath: "web:fetch:url",
          features: ["Execution with adaptation monitors the result and adapts to layout changes."],
          extractionQuality: { hasContent: true, contentChars: 3400 }
        }
      }),
      makeRecord({
        id: "retry-source",
        url: "https://delta-live.test/reliable-web-agents",
        content: "Retry logic with exponential backoff classifies transient errors before retrying and keeps cascading failures bounded.",
        attributes: {
          retrievalPath: "web:fetch:url",
          features: ["Retry logic with exponential backoff classifies errors before retrying."],
          extractionQuality: { hasContent: true, contentChars: 3500 }
        }
      }),
      makeRecord({
        id: "observability-source",
        url: "https://epsilon-live.test/agent-observability",
        content: "Production observability tracks success rate, p95 latency, anti-bot block rate, and credit burn rate for autonomous agent runs.",
        attributes: {
          retrievalPath: "web:fetch:url",
          features: ["Production observability tracks success rate, p95 latency, anti-bot block rate, and credit burn rate."],
          extractionQuality: { hasContent: true, contentChars: 3300 }
        }
      }),
      makeRecord({
        id: "audit-source",
        url: "https://zeta-live.test/browser-agent-audits",
        content: "Comprehensive logging uses real-time monitoring of agent decisions to detect anomalies and facilitate audits.",
        attributes: {
          retrievalPath: "web:fetch:url",
          features: ["Real-time monitoring of agent decisions detects anomalies and supports audits."],
          extractionQuality: { hasContent: true, contentChars: 3400 }
        }
      })
    ], timebox, new Date("2026-06-14T00:00:00.000Z"));

    const report = reportMarkdown({
      mode: "path",
      topic: "recent browser automation reliability practices for AI agents",
      records,
      meta: {
        timebox,
        metrics: {
          total_records: 6,
          within_timebox: 6,
          final_records: 6
        }
      }
    });
    const finalAnswer = report.slice(
      report.indexOf("## Final Answer"),
      report.indexOf("## Claim Map")
    );

    expect(report).toContain("- human oversight: 2 accepted records across 2 independent domains.");
    expect(report).toContain("- recovery controls: 3 accepted records across 3 independent domains.");
    expect(report).toContain("- monitoring audits: 2 accepted records across 2 independent domains.");
    expect(finalAnswer).toContain("The accepted evidence supports 3 decision-ready findings");
    expect(finalAnswer).toContain("human oversight - claim-");
    expect(finalAnswer).toContain("recovery controls - claim-");
    expect(finalAnswer).toContain("monitoring audits - claim-");
    expect(finalAnswer).not.toContain("bounded low-confidence signals");
  });

  it("anchors semantic theme evidence on practice cues instead of nearby topic text", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords([
      makeRecord({
        id: "observability-source",
        url: "https://alpha-monitoring.test/browser-agent-observability",
        content: [
          "Production observability tracks success rate, p95 latency, anti-bot block rate, and credit burn rate during autonomous agent runs.",
          "Testing in unstable environments often leads into Browser Automation and Autonomous Agents, where browser automation is one capability within autonomous AI agents."
        ].join(" "),
        attributes: {
          retrievalPath: "web:fetch:url",
          extractionQuality: { hasContent: true, contentChars: 2200 }
        }
      }),
      makeRecord({
        id: "audit-source",
        url: "https://beta-monitoring.test/browser-agent-audits",
        content: "Human-in-the-loop systems for high-risk queries. Comprehensive logging uses real-time monitoring of agent decisions to detect anomalies and facilitate audits.",
        attributes: {
          retrievalPath: "web:fetch:url",
          extractionQuality: { hasContent: true, contentChars: 2400 }
        }
      }),
      makeRecord({
        id: "workflow-source",
        url: "https://gamma-monitoring.test/browser-automation",
        content: [
          "End-to-End Task Automation Examples: Booking travel, managing vendor portals, updating CRM systems, and monitoring dashboards.",
          "Testing in unstable environments often leads into Browser Automation and Autonomous Agents, where browser automation is one capability within autonomous AI agents."
        ].join(" "),
        attributes: {
          retrievalPath: "web:fetch:url",
          extractionQuality: { hasContent: true, contentChars: 2200 }
        }
      })
    ], timebox, new Date("2026-06-14T00:00:00.000Z"));

    const report = reportMarkdown({
      mode: "path",
      topic: "recent browser automation reliability practices for AI agents",
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
    const finalAnswer = report.slice(
      report.indexOf("## Final Answer"),
      report.indexOf("## Claim Map")
    );

    expect(report).toContain("- monitoring audits: 2 accepted records across 2 independent domains.");
    expect(finalAnswer).toContain("anti-bot block rate, and credit burn rate");
    expect(report).toContain("monitoring of agent decisions to detect anomalies and facilitate audits");
    expect(finalAnswer).not.toContain("monitoring dashboards");
    expect(finalAnswer).not.toContain("Browser Automation and Autonomous Agents");
    expect(finalAnswer).not.toContain("Human-in-the-loop systems");
  });

  it("does not use comparison table rows as semantic theme evidence", () => {
    const timebox = resolveTimebox({ days: 14, now: new Date("2026-06-14T00:00:00.000Z") });
    const records = enrichResearchRecords([
      makeRecord({
        id: "table-source",
        url: "https://alpha-recovery.test/comparison-table",
        content: [
          "Selectors Semantic understanding Error recovery Manual Autonomous Environment changes Break scripts Adapt dynamically Reasoning None Built-in reasoning Scalability High maintenance.",
          "The article later notes that reliable browser agents still require review before production use."
        ].join(" "),
        attributes: {
          retrievalPath: "web:fetch:url",
          extractionQuality: { hasContent: true, contentChars: 2400 }
        }
      }),
      makeRecord({
        id: "adaptation-source",
        url: "https://beta-recovery.test/adaptation",
        content: "Execution with adaptation monitors the result; if a popup or page layout change appears, the browser agent adapts before continuing.",
        attributes: {
          retrievalPath: "web:fetch:url",
          extractionQuality: { hasContent: true, contentChars: 2500 }
        }
      }),
      makeRecord({
        id: "self-healing-source",
        url: "https://gamma-recovery.test/self-healing",
        content: "Self-healing recovery reruns failed actions after checking page state, so changed pages do not silently corrupt results.",
        attributes: {
          retrievalPath: "web:fetch:url",
          extractionQuality: { hasContent: true, contentChars: 2500 }
        }
      })
    ], timebox, new Date("2026-06-14T00:00:00.000Z"));

    const report = reportMarkdown({
      mode: "path",
      topic: "recent browser automation reliability practices for AI agents",
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
    const finalAnswer = report.slice(
      report.indexOf("## Final Answer"),
      report.indexOf("## Claim Map")
    );

    expect(report).toContain("- recovery controls: 2 accepted records across 2 independent domains.");
    expect(finalAnswer).toMatch(
      /Execution with adaptation monitors the result|recovery reruns failed actions/
    );
    expect(finalAnswer).not.toContain("Selectors Semantic understanding");
    expect(finalAnswer).not.toContain("Break scripts Adapt dynamically");
    expect(finalAnswer).not.toContain("Built-in reasoning");
  });

  it("renders a fail gate without unsupported final claims when accepted evidence is absent", () => {
    const report = reportMarkdown({
      mode: "path",
      topic: "empty research report",
      records: [],
      meta: {
        metrics: {
          total_records: 2,
          sanitized_records: 2,
          rejected_candidate_count: 2,
          sanitized_reason_distribution: {
            search_index_shell: 2
          }
        }
      }
    });

    expect(report).toContain("Evidence gate: fail");
    expect(report).toContain("Evidence is insufficient");
    expect(report).toContain("search_index_shell: 2");
    expect(report).not.toContain("The accepted evidence supports");
  });
});
