import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeRecord } from "../src/providers/normalize";
import {
  runInspiredesignWorkflow,
  workflowTestUtils,
  type ProviderExecutor
} from "../src/providers/workflows";
import type {
  InspiredesignBriefExpansion,
  InspiredesignBriefFormat
} from "../src/inspiredesign/brief-expansion";
import type { InspiredesignCaptureEvidence } from "../src/providers/inspiredesign-contract";
import { buildWorkflowResumeEnvelope } from "../src/providers/workflow-contracts";
import type {
  JsonValue,
  ProviderAggregateResult,
  ProviderError,
  ProviderFailureEntry,
  ProviderSource
} from "../src/providers/types";

type InspiredesignWorkflowMeta = {
  reasonCodeDistribution?: Record<string, number>;
  followthroughSummary?: string;
  recommendedSkills?: string[];
  deepCaptureRecommendation?: string;
  contractScope?: {
    note?: string;
  };
  selection: {
    urls: string[];
    capture_mode: string;
    include_prototype_guidance: boolean;
  };
  metrics: {
    reference_count: number;
    fetched_references: number;
    captured_references: number;
    failed_fetches: number;
    failed_captures: number;
  };
  artifact_manifest: {
    files: string[];
  };
};

type InspiredesignWorkflowEvidence = {
  advancedBrief: string;
  briefExpansion: {
    templateVersion: string;
    format: InspiredesignBriefFormat;
  };
  references: Array<{
    url: string;
    fetchStatus: string;
    captureStatus: string;
    fetchFailure?: string;
    captureFailure?: string;
  }>;
};

type InspiredesignWorkflowContext = {
  advancedBriefMarkdown: string;
  urls: string[];
  prototypeGuidanceMarkdown: string | null;
  evidence: InspiredesignWorkflowEvidence;
  canvasPlanRequest: {
    canvasSessionId: string;
    leaseId: string;
    documentId: string;
  };
  designAgentHandoff: {
    briefExpansion: {
      templateVersion: string;
      file: string;
      format: {
        label: string;
      };
    };
    contractScope: {
      emittedContract: string;
      omittedTemplateBlocks: string[];
    };
  };
};

const tempDirs: string[] = [];

const makeOutputDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "inspiredesign-workflow-"));
  tempDirs.push(dir);
  return dir;
};

const makeFailure = (
  provider: string,
  source: ProviderSource,
  error: Partial<ProviderError> = {}
): ProviderFailureEntry => ({
  provider,
  source,
  error: {
    code: "unavailable",
    message: "provider failed",
    retryable: false,
    ...error
  }
});

const makeAggregate = (overrides: Partial<ProviderAggregateResult> = {}): ProviderAggregateResult => ({
  ok: true,
  records: [],
  trace: { requestId: "inspiredesign-workflow", ts: new Date().toISOString() },
  partial: false,
  failures: [],
  metrics: { attempted: 1, succeeded: 1, failed: 0, retries: 0, latencyMs: 1 },
  sourceSelection: "web",
  providerOrder: ["web/default"],
  ...overrides
});

const toRuntime = (handlers: {
  fetch?: ProviderExecutor["fetch"];
  getAntiBotSnapshots?: ProviderExecutor["getAntiBotSnapshots"];
}): ProviderExecutor => ({
  search: async () => makeAggregate(),
  fetch: handlers.fetch ?? (async () => makeAggregate()),
  ...(handlers.getAntiBotSnapshots ? { getAntiBotSnapshots: handlers.getAntiBotSnapshots } : {})
});

const makeCapture = (title: string): InspiredesignCaptureEvidence => ({
  title,
  snapshot: {
    content: `${title} snapshot`,
    refCount: 5,
    warnings: []
  },
  clone: {
    componentPreview: `<section>${title}</section>`,
    cssPreview: ".hero { display: grid; }",
    warnings: []
  }
});

const makeBriefFormat = (
  overrides: Partial<InspiredesignBriefFormat> = {}
): InspiredesignBriefFormat => ({
  id: "premium-editorial-landing-page",
  label: "Premium editorial landing page",
  bestFor: ["launch pages", "docs homepages"],
  businessFocus: ["premium SaaS marketing", "product launches"],
  keywords: ["landing", "launch", "brand"],
  archetype: "editorial brand campaign",
  layoutArchetype: "full-bleed hero with narrative section cadence",
  typographySystem: "display serif or refined grotesk headlines paired with restrained sans body copy",
  surfaceTreatment: "bright print-like planes, disciplined image crops, and hairline dividers",
  shapeLanguage: "sharp framing with selective soft corners only where interaction requires it",
  componentGrammar: "hero composition, proof bands, narrative media strips, restrained CTA groups",
  motionGrammar: "measured fades, staggered reveals, and restrained parallax",
  paletteIntent: "bright neutral field with one confident accent and controlled contrast",
  visualDensity: "airy",
  designVariance: "balanced asymmetry",
  responsiveCollapseRules: [
    "Collapse split editorial compositions into a single text-first stack before line length becomes cramped."
  ],
  guardrails: [
    "Prioritize one dominant hero idea and a clear narrative progression instead of dashboard-style clutter."
  ],
  antiPatterns: [
    "No feature-card hero."
  ],
  deliverables: [
    "Translate the references into a reusable design contract."
  ],
  route: {
    profile: "product-story",
    themeStrategy: "single-theme",
    navigationModel: "global-header",
    layoutApproach: "editorial-hero-sequence"
  },
  ...overrides
});

const makeBriefExpansion = (
  overrides: Partial<InspiredesignBriefExpansion> = {}
): InspiredesignBriefExpansion => ({
  sourceBrief: "Design a premium launch surface",
  advancedBrief: "Selected prompt format: Premium editorial landing page\n\nSource brief:\nDesign a premium launch surface\n\nPrompt objective:\nStudy the inspiration references and synthesize a premium editorial landing page system that translates the source brief into a reusable, brand-specific direction.",
  templateVersion: "inspiredesign-advanced-brief.v1",
  format: makeBriefFormat(),
  ...overrides
});

describe("inspiredesign workflow", () => {
  afterEach(() => {
    workflowTestUtils.resetProviderSignalState();
    vi.restoreAllMocks();
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("returns a path artifact bundle when no references are supplied", async () => {
    const runtime = toRuntime({});
    const output = await runInspiredesignWorkflow(runtime, {
      brief: "  Create a premium knowledge base  ",
      mode: "path",
      outputDir: makeOutputDir()
    });

    const meta = output.meta as InspiredesignWorkflowMeta;

    expect(output).toMatchObject({
      mode: "path",
      path: expect.any(String),
      followthroughSummary: expect.stringContaining("OpenDevBrowser Canvas"),
      suggestedNextAction: expect.stringContaining("canvas.plan.set")
    });
    expect(meta.selection).toEqual({
      urls: [],
      capture_mode: "off",
      include_prototype_guidance: false
    });
    expect(meta.metrics.reference_count).toBe(0);
    expect(meta.artifact_manifest.files).toContain("design.md");
    expect(meta.followthroughSummary).toEqual(expect.stringContaining("advanced-brief.md"));
    expect(meta.followthroughSummary).toEqual(expect.stringContaining("canvas-plan.request.json"));
    expect(meta.recommendedSkills).toEqual([
      'opendevbrowser-best-practices "quick start"',
      'opendevbrowser-design-agent "canvas-contract"'
    ]);
    expect(meta.contractScope).toEqual(expect.objectContaining({
      note: expect.stringContaining("design-contract.json is the narrowed canvas governance contract")
    }));
    expect(meta.artifact_manifest.files).toEqual(expect.arrayContaining([
      "advanced-brief.md",
      "canvas-plan.request.json",
      "design-agent-handoff.json"
    ]));
  });

  it("defaults to compact mode when inspiredesign input omits an explicit render mode", async () => {
    const runtime = toRuntime({});

    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Design a compact default output"
    });

    expect(output.mode).toBe("compact");
  });

  it("forces deep capture when urls are present without an explicit capture mode", async () => {
    const fetch = vi.fn(async (input: { url: string }) => makeAggregate({
      records: [
        normalizeRecord("web/default", "web", {
          url: input.url,
          title: "Reference title",
          content: "Reference content with enough detail for a design excerpt."
        })
      ]
    }));
    const captureReference = vi.fn(async (url: string) => makeCapture(`Captured ${url}`));
    const runtime = toRuntime({ fetch });

    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Design a docs workspace",
      urls: ["https://example.com/reference"]
    }, {
      captureReference
    });

    const meta = output.meta as InspiredesignWorkflowMeta;

    expect(captureReference).toHaveBeenCalledTimes(1);
    expect(meta.selection.capture_mode).toBe("deep");
  });

  it("overrides explicit off to deep capture when urls are present", async () => {
    const fetch = vi.fn(async (input: { url: string }) => makeAggregate({
      records: [
        normalizeRecord("web/default", "web", {
          url: input.url,
          title: "Reference title",
          content: "Reference content with enough detail for a design excerpt."
        })
      ]
    }));
    const captureReference = vi.fn(async (url: string) => makeCapture(`Captured ${url}`));
    const runtime = toRuntime({ fetch });

    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Design a docs workspace",
      urls: ["https://example.com/reference"],
      captureMode: "off"
    }, {
      captureReference
    });

    const meta = output.meta as InspiredesignWorkflowMeta;

    expect(captureReference).toHaveBeenCalledTimes(1);
    expect(meta.selection.capture_mode).toBe("deep");
  });

  it("parses valid inspiredesign envelopes and forwards every optional runtime override", async () => {
    const fetch = vi.fn(async (input: { url: string }) => makeAggregate({
      records: [
        normalizeRecord("web/default", "web", {
          url: input.url,
          title: "Reference title",
          content: "Reference content with enough detail for a design excerpt."
        })
      ]
    }));
    const captureReference = vi.fn(async (url: string) => makeCapture(`Captured ${url}`));
    const runtime = toRuntime({ fetch });

    const output = await runInspiredesignWorkflow(runtime, buildWorkflowResumeEnvelope("inspiredesign", {
      brief: "Design a docs workspace",
      urls: [" https://example.com/reference ", "https://example.com/reference"],
      captureMode: "deep",
      includePrototypeGuidance: true,
      mode: "context",
      timeoutMs: 45000,
      outputDir: makeOutputDir(),
      ttlHours: 24,
      useCookies: true,
      challengeAutomationMode: "browser_with_helper",
      cookiePolicyOverride: "required"
    }), {
      captureReference
    });

    const meta = output.meta as InspiredesignWorkflowMeta;
    const context = output.context as InspiredesignWorkflowContext;

    expect(fetch).toHaveBeenCalledWith(
      { url: "https://example.com/reference" },
      expect.objectContaining({
        timeoutMs: expect.any(Number),
        runtimePolicy: expect.objectContaining({
          useCookies: true,
          challengeAutomationMode: "browser_with_helper",
          cookiePolicyOverride: "required"
        }),
        suspendedIntent: expect.objectContaining({
          kind: "workflow.inspiredesign"
        })
      })
    );
    expect(captureReference).toHaveBeenCalledTimes(1);
    expect(output.mode).toBe("context");
    expect(context.advancedBriefMarkdown).toContain("Selected prompt format:");
    expect(context.urls).toEqual(["https://example.com/reference"]);
    expect(context.prototypeGuidanceMarkdown).toContain("# 6. Optional Prototype Plan");
    expect(context.canvasPlanRequest).toMatchObject({
      canvasSessionId: "<canvas-session-id>",
      leaseId: "<lease-id>",
      documentId: "<document-id>"
    });
    expect(context.designAgentHandoff).toMatchObject({
      briefExpansion: {
        templateVersion: "inspiredesign-advanced-brief.v1",
        file: "advanced-brief.md",
        format: {
          label: expect.any(String)
        }
      },
      contractScope: {
        emittedContract: "CanvasDesignGovernance",
        omittedTemplateBlocks: ["navigationModel", "asyncModel", "performanceModel"]
      }
    });
    expect(context.evidence.advancedBrief).toContain("Prompt objective:");
    expect(context.evidence.references[0]).toMatchObject({
      fetchStatus: "captured",
      captureStatus: "captured"
    });
    expect(meta.followthroughSummary).toContain("advanced-brief.md");
    expect(meta.selection.capture_mode).toBe("deep");
    expect(meta.selection.include_prototype_guidance).toBe(true);
    expect(meta.deepCaptureRecommendation).toContain("already uses captureMode=deep");
  });

  it("defaults invalid envelope render fields but still forces deep capture when urls are present", async () => {
    const fetch = vi.fn(async (input: { url: string }) => makeAggregate({
      records: [
        normalizeRecord("web/default", "web", {
          url: input.url,
          title: "Fallback title",
          content: "Fallback content"
        })
      ]
    }));
    const runtime = toRuntime({ fetch });

    const output = await runInspiredesignWorkflow(runtime, {
      kind: "inspiredesign",
      input: {
        brief: "  Design a calm control surface  ",
        urls: [" https://example.com/control ", 42],
        mode: "invalid-mode",
        captureMode: "invalid-capture",
        includePrototypeGuidance: "yes",
        timeoutMs: "fast",
        outputDir: "",
        ttlHours: "24",
        useCookies: "true",
        challengeAutomationMode: 1,
        cookiePolicyOverride: false
      }
    } as never);

    const meta = output.meta as InspiredesignWorkflowMeta;

    expect(output.mode).toBe("compact");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      { url: "https://example.com/control" },
      expect.objectContaining({
        suspendedIntent: expect.objectContaining({
          kind: "workflow.inspiredesign"
        })
      })
    );
    expect(meta.selection).toEqual({
      urls: ["https://example.com/control"],
      capture_mode: "deep",
      include_prototype_guidance: false
    });
  });

  it("ignores invalid envelope brief expansions and regenerates the advanced brief", async () => {
    const fetch = vi.fn(async (input: { url: string }) => makeAggregate({
      records: [
        normalizeRecord("web/default", "web", {
          url: input.url,
          title: "Reference title",
          content: "Reference content with enough detail for a design excerpt."
        })
      ]
    }));
    const captureReference = vi.fn(async (url: string) => makeCapture(`Captured ${url}`));
    const runtime = toRuntime({ fetch });
    const invalidBriefExpansion: JsonValue = {
      sourceBrief: "Design a docs workspace",
      advancedBrief: "This stale brief expansion should be ignored.",
      templateVersion: "invalid-template",
      format: {
        id: "invalid-format",
        label: "Invalid format",
        bestFor: ["valid", 42]
      }
    };

    const output = await runInspiredesignWorkflow(runtime, {
      kind: "inspiredesign",
      input: {
        brief: "Design a docs workspace",
        urls: ["https://example.com/reference"],
        mode: "context",
        briefExpansion: invalidBriefExpansion
      }
    } as never, {
      captureReference
    });

    const context = output.context as InspiredesignWorkflowContext;

    expect(context.advancedBriefMarkdown).toContain("Selected prompt format:");
    expect(context.advancedBriefMarkdown).not.toContain("This stale brief expansion should be ignored.");
    expect(context.evidence.briefExpansion.templateVersion).toBe("inspiredesign-advanced-brief.v1");
    expect(context.evidence.briefExpansion.format.bestFor.every((entry) => typeof entry === "string")).toBe(true);
  });

  it("drops invalid string runtime overrides from inspiredesign envelopes", async () => {
    const fetch = vi.fn(async (input: { url: string }, options?: { runtimePolicy?: Record<string, unknown> }) => makeAggregate({
      records: [
        normalizeRecord("web/default", "web", {
          url: input.url,
          title: "Validated title",
          content: "Validated content"
        })
      ],
      meta: options?.runtimePolicy ? { runtimePolicy: options.runtimePolicy } : undefined
    }));
    const captureReference = vi.fn(async (url: string, options?: Record<string, unknown>) => ({
      ...makeCapture(`Captured ${url}`),
      clone: {
        componentPreview: JSON.stringify(options ?? {}),
        cssPreview: ".validated { display: block; }",
        warnings: []
      }
    }));
    const runtime = toRuntime({ fetch });

    await runInspiredesignWorkflow(runtime, {
      kind: "inspiredesign",
      input: {
        brief: "Validate resume envelope enums",
        urls: ["https://example.com/resume"],
        captureMode: "deep",
        challengeAutomationMode: "invalid-mode",
        cookiePolicyOverride: "invalid-policy"
      }
    } as never, {
      captureReference
    });

    expect(fetch).toHaveBeenCalledWith(
      { url: "https://example.com/resume" },
      expect.objectContaining({
        runtimePolicy: expect.not.objectContaining({
          challengeAutomationMode: "invalid-mode",
          cookiePolicyOverride: "invalid-policy"
        })
      })
    );
    expect(captureReference).toHaveBeenCalledWith(
      "https://example.com/resume",
      expect.not.objectContaining({
        challengeAutomationMode: "invalid-mode",
        cookiePolicyOverride: "invalid-policy"
      })
    );
  });

  it("reuses cached brief expansion from inspiredesign envelopes", async () => {
    const fetch = vi.fn(async (input: { url: string }) => makeAggregate({
      records: [
        normalizeRecord("web/default", "web", {
          url: input.url,
          title: "Cached expansion reference",
          content: "Cached expansion content"
        })
      ]
    }));
    const runtime = toRuntime({ fetch });
    const output = await runInspiredesignWorkflow(runtime, buildWorkflowResumeEnvelope("inspiredesign", {
      brief: "  Design   a premium   launch surface  ",
      briefExpansion: makeBriefExpansion({
        advancedBrief: "Selected prompt format: Custom cached brief\n\nSource brief:\nDesign a premium launch surface",
        templateVersion: "custom-template.v1",
        format: makeBriefFormat({
          id: "custom",
          label: "Custom cached brief",
          bestFor: ["custom runs"],
          businessFocus: ["custom runs"],
          keywords: ["custom"],
          archetype: "custom archetype",
          layoutArchetype: "custom layout",
          typographySystem: "custom type",
          surfaceTreatment: "custom surface",
          shapeLanguage: "custom shape",
          componentGrammar: "custom components",
          motionGrammar: "custom motion",
          paletteIntent: "custom palette",
          visualDensity: "airy",
          designVariance: "balanced",
          responsiveCollapseRules: ["Keep custom layout stable."],
          guardrails: ["Keep custom route stable."],
          antiPatterns: ["No stale override."],
          deliverables: ["Return the custom route."],
          route: {
            profile: "control-room",
            themeStrategy: "single-theme",
            navigationModel: "contextual",
            layoutApproach: "custom-layout"
          }
        })
      }),
      urls: ["https://example.com/cached"],
      mode: "context"
    }));

    const context = output.context as InspiredesignWorkflowContext;

    expect(context.advancedBriefMarkdown).toContain("Custom cached brief");
    expect(context.evidence.briefExpansion).toEqual({
      templateVersion: "custom-template.v1",
      format: makeBriefFormat({
        id: "custom",
        label: "Custom cached brief",
        bestFor: ["custom runs"],
        businessFocus: ["custom runs"],
        keywords: ["custom"],
        archetype: "custom archetype",
        layoutArchetype: "custom layout",
        typographySystem: "custom type",
        surfaceTreatment: "custom surface",
        shapeLanguage: "custom shape",
        componentGrammar: "custom components",
        motionGrammar: "custom motion",
        paletteIntent: "custom palette",
        visualDensity: "airy",
        designVariance: "balanced",
        responsiveCollapseRules: ["Keep custom layout stable."],
        guardrails: ["Keep custom route stable."],
        antiPatterns: ["No stale override."],
        deliverables: ["Return the custom route."],
        route: {
          profile: "control-room",
          themeStrategy: "single-theme",
          navigationModel: "contextual",
          layoutApproach: "custom-layout"
        }
      })
    });
  });

  it("rejects invalid inspiredesign workflow envelopes", async () => {
    await expect(
      runInspiredesignWorkflow(toRuntime({}), {
        kind: "inspiredesign",
        input: []
      } as never)
    ).rejects.toThrow("Inspiredesign workflow envelope is invalid.");
  });

  it("rejects inspiredesign workflow envelopes with mismatched kinds", async () => {
    await expect(
      runInspiredesignWorkflow(toRuntime({}), {
        kind: "research",
        input: {
          brief: "Design a landing page"
        }
      } as never)
    ).rejects.toThrow("Inspiredesign workflow envelope kind mismatch. Expected inspiredesign but received research.");
  });

  it("rejects malformed inspiredesign envelope inputs after parsing optional fields", async () => {
    await expect(
      runInspiredesignWorkflow(toRuntime({}), {
        kind: "inspiredesign",
        input: {
          brief: 42
        }
      } as never)
    ).rejects.toThrow("Inspiredesign workflow requires a non-empty brief.");
  });

  it("rejects empty briefs and invalid inspiredesign urls", async () => {
    await expect(
      runInspiredesignWorkflow(toRuntime({}), {
        brief: "   ",
        mode: "json"
      })
    ).rejects.toThrow("Inspiredesign workflow requires a non-empty brief.");

    await expect(
      runInspiredesignWorkflow(toRuntime({}), {
        brief: "Design a landing page",
        urls: ["notaurl"],
        mode: "json"
      })
    ).rejects.toThrow("Inspiredesign workflow received an invalid URL: notaurl");
  });

  it("records fetch failures without manufacturing missing deep-capture callback failures", async () => {
    const runtime = toRuntime({
      fetch: async () => makeAggregate({
        ok: false,
        records: [],
        failures: [
          makeFailure("web/default", "web", {
            code: "challenge_detected",
            message: "challenge detected",
            reasonCode: "challenge_detected"
          })
        ],
        metrics: { attempted: 1, succeeded: 0, failed: 1, retries: 0, latencyMs: 1 },
        error: {
          code: "challenge_detected",
          message: "challenge detected",
          retryable: false,
          reasonCode: "challenge_detected"
        }
      })
    });

    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Design a fallback-safe landing page",
      urls: ["https://example.com/blocked"],
      captureMode: "deep",
      mode: "json",
      outputDir: makeOutputDir()
    });

    const evidence = output.evidence as InspiredesignWorkflowEvidence;
    const meta = output.meta as InspiredesignWorkflowMeta;

    expect(evidence.references[0]).toMatchObject({
      url: "https://example.com/blocked",
      fetchStatus: "failed",
      captureStatus: "off"
    });
    expect(evidence.references[0]?.fetchFailure).toEqual(expect.any(String));
    expect(evidence.references[0]).not.toHaveProperty("captureFailure");
    expect(meta).toMatchObject({
      selection: {
        capture_mode: "deep"
      },
      metrics: {
        failed_captures: 0
      },
      primaryConstraintSummary: expect.any(String),
      reasonCodeDistribution: {
        challenge_detected: 1
      },
      primaryConstraint: expect.objectContaining({
        reasonCode: "challenge_detected"
      })
    });
    expect(JSON.stringify(output)).not.toContain("Deep capture requested, but no browser capture callback was available.");
    expect(output.meta).not.toHaveProperty("primary_constraint");
  });

  it("downgrades shell-only fetched references without breaking mixed-source success", async () => {
    const runtime = toRuntime({
      fetch: async (input: { url: string }) => {
        if (input.url.includes("apple.com")) {
          return makeAggregate({
            records: [
              normalizeRecord("web/default", "web", {
                url: input.url,
                title: "Apple",
                content: "Premium product storytelling with careful whitespace and clear CTA hierarchy."
              })
            ]
          });
        }

        return makeAggregate({
          records: [
            normalizeRecord("web/default", "web", {
              url: input.url,
              title: "Pinterest",
              content: "JavaScript is required to view this page.",
              attributes: {
                providerShell: "social_js_required_shell",
                browserRequired: true
              }
            })
          ]
        });
      }
    });

    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Design a premium consumer landing page",
      urls: ["https://www.apple.com", "https://www.pinterest.com/pin/example"],
      captureMode: "off",
      mode: "json",
      outputDir: makeOutputDir()
    });

    const evidence = output.evidence as InspiredesignWorkflowEvidence;
    const meta = output.meta as InspiredesignWorkflowMeta;

    expect(evidence.references).toMatchObject([
      {
        url: "https://www.apple.com",
        fetchStatus: "captured",
        captureStatus: "off"
      },
      {
        url: "https://www.pinterest.com/pin/example",
        fetchStatus: "failed",
        captureStatus: "off",
        fetchFailure: "Default requires a live browser-rendered page."
      }
    ]);
    expect(meta.metrics).toMatchObject({
      reference_count: 2,
      fetched_references: 1,
      failed_fetches: 1,
      failed_captures: 0
    });
    expect(output.meta).toMatchObject({
      reasonCodeDistribution: {
        env_limited: 1
      },
      primaryConstraintSummary: "Default requires a live browser-rendered page.",
      primaryConstraint: expect.objectContaining({
        reasonCode: "env_limited",
        constraint: expect.objectContaining({
          kind: "render_required",
          evidenceCode: "social_js_required_shell"
        })
      })
    });
  });

  it("keeps usable fetched records when a shell-only record is returned alongside them", async () => {
    const runtime = toRuntime({
      fetch: async (input: { url: string }) => makeAggregate({
        records: [
          normalizeRecord("web/default", "web", {
            url: input.url,
            title: "Pinterest shell",
            content: "JavaScript is required to view this page.",
            attributes: {
              providerShell: "social_js_required_shell",
              browserRequired: true
            }
          }),
          normalizeRecord("web/default", "web", {
            url: input.url,
            title: "Recovered reference",
            content: "Editorial product layout with calm navigation and clear calls to action."
          })
        ]
      })
    });

    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Design a premium consumer landing page",
      urls: ["https://example.com/recovered"],
      captureMode: "off",
      mode: "json",
      outputDir: makeOutputDir()
    });

    const evidence = output.evidence as InspiredesignWorkflowEvidence;

    expect(evidence.references[0]).toMatchObject({
      url: "https://example.com/recovered",
      title: "Recovered reference",
      fetchStatus: "captured",
      captureStatus: "off"
    });
    expect(evidence.references[0]?.fetchFailure).toBeUndefined();
    expect(output.meta).toMatchObject({
      metrics: {
        fetched_references: 1,
        failed_fetches: 0
      }
    });
    expect(output.meta).not.toHaveProperty("primaryConstraint");
  });

  it("reuses existing provider failures when shell-only fetches were already classified upstream", async () => {
    const runtime = toRuntime({
      fetch: async (input: { url: string }) => makeAggregate({
        ok: false,
        records: [
          normalizeRecord("web/default", "web", {
            url: input.url,
            title: "Verification required",
            content: "Complete the verification challenge to continue.",
            attributes: {
              providerShell: "social_verification_wall"
            }
          })
        ],
        failures: [
          makeFailure("web/default", "web", {
            code: "unavailable",
            message: "challenge detected",
            reasonCode: "challenge_detected"
          })
        ],
        metrics: { attempted: 1, succeeded: 0, failed: 1, retries: 0, latencyMs: 1 },
        error: {
          code: "unavailable",
          message: "challenge detected",
          retryable: false,
          reasonCode: "challenge_detected"
        }
      })
    });

    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Design a premium consumer landing page",
      urls: ["https://example.com/blocked"],
      captureMode: "off",
      mode: "json",
      outputDir: makeOutputDir()
    });

    const evidence = output.evidence as InspiredesignWorkflowEvidence;

    expect(evidence.references[0]).toMatchObject({
      url: "https://example.com/blocked",
      fetchStatus: "failed",
      captureStatus: "off",
      fetchFailure: "Default hit an anti-bot challenge that requires manual completion."
    });
    expect(output.meta).toMatchObject({
      reasonCodeDistribution: {
        challenge_detected: 1
      },
      primaryConstraintSummary: "Default hit an anti-bot challenge that requires manual completion."
    });
  });

  it("keeps upstream failures for shell-only fetches without injecting a new top-level fetch error", async () => {
    const runtime = toRuntime({
      fetch: async (input: { url: string }) => makeAggregate({
        ok: false,
        records: [
          normalizeRecord("web/default", "web", {
            url: input.url,
            title: "Pinterest shell",
            content: "JavaScript is required to view this page.",
            attributes: {
              providerShell: "social_js_required_shell",
              browserRequired: true
            }
          })
        ],
        failures: [
          makeFailure("web/default", "web", {
            code: "unavailable",
            message: "render follow-up required",
            reasonCode: "env_limited",
            details: {
              providerShell: "social_js_required_shell",
              browserRequired: true,
              constraint: {
                kind: "render_required",
                evidenceCode: "social_js_required_shell"
              }
            }
          })
        ],
        metrics: { attempted: 1, succeeded: 0, failed: 1, retries: 0, latencyMs: 1 }
      })
    });

    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Design a premium consumer landing page",
      urls: ["https://www.pinterest.com/pin/example"],
      captureMode: "off",
      mode: "json",
      outputDir: makeOutputDir()
    });

    const evidence = output.evidence as InspiredesignWorkflowEvidence;

    expect(evidence.references[0]).toMatchObject({
      url: "https://www.pinterest.com/pin/example",
      fetchStatus: "failed",
      captureStatus: "off",
      fetchFailure: "Default requires a live browser-rendered page."
    });
    expect(output.meta).toMatchObject({
      reasonCodeDistribution: {
        env_limited: 1
      },
      primaryConstraintSummary: "Default requires a live browser-rendered page."
    });
  });

  it("falls back to the aggregate fetch error message when no classified failures are available", async () => {
    const runtime = toRuntime({
      fetch: async () => makeAggregate({
        ok: false,
        records: [],
        failures: [],
        metrics: { attempted: 1, succeeded: 0, failed: 1, retries: 0, latencyMs: 1 },
        error: {
          code: "unavailable",
          message: "upstream timeout",
          retryable: true
        }
      })
    });

    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Design a premium consumer landing page",
      urls: ["https://example.com/timeout"],
      captureMode: "off",
      mode: "json",
      outputDir: makeOutputDir()
    });

    const evidence = output.evidence as InspiredesignWorkflowEvidence;

    expect(evidence.references[0]).toMatchObject({
      url: "https://example.com/timeout",
      fetchStatus: "failed",
      captureStatus: "off",
      fetchFailure: "upstream timeout"
    });
    expect(output.meta).toMatchObject({
      metrics: {
        failed_fetches: 1,
        failed_captures: 0
      }
    });
    expect(output.meta).not.toHaveProperty("primaryConstraint");
  });

  it("records unusable and non-error deep capture failures without aborting the workflow", async () => {
    const runtime = toRuntime({
      fetch: async (input: { url: string }) => makeAggregate({
        records: [
          normalizeRecord("web/default", "web", {
            url: input.url,
            title: "",
            content: ""
          })
        ]
      })
    });
    const captureReference = vi.fn(async (url: string) => {
      if (url.endsWith("/empty")) {
        return null;
      }
      throw "boom";
    });

    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Design a resilient workflow surface",
      urls: ["https://example.com/empty", "https://example.com/error"],
      captureMode: "deep",
      mode: "json",
      outputDir: makeOutputDir()
    }, {
      captureReference
    });

    const evidence = output.evidence as InspiredesignWorkflowEvidence;

    expect(evidence.references[0]).toMatchObject({
      url: "https://example.com/empty",
      captureStatus: "failed",
      captureFailure: "Deep capture did not return usable snapshot, DOM, or clone evidence."
    });
    expect(evidence.references[1]).toMatchObject({
      url: "https://example.com/error",
      captureStatus: "failed",
      captureFailure: "Deep capture failed."
    });
  });

  it("preserves Error messages from deep capture failures", async () => {
    const runtime = toRuntime({
      fetch: async (input: { url: string }) => makeAggregate({
        records: [
          normalizeRecord("web/default", "web", {
            url: input.url,
            title: "Reference title",
            content: "Reference content"
          })
        ]
      })
    });
    const captureReference = vi.fn(async () => {
      throw new Error("capture exploded");
    });

    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Design a resilient workflow surface",
      urls: ["https://example.com/error-object"],
      captureMode: "deep",
      mode: "json",
      outputDir: makeOutputDir()
    }, {
      captureReference
    });

    const evidence = output.evidence as InspiredesignWorkflowEvidence;

    expect(evidence.references[0]).toMatchObject({
      url: "https://example.com/error-object",
      fetchStatus: "captured",
      captureStatus: "failed",
      captureFailure: "capture exploded"
    });
    expect(output.meta).toMatchObject({
      primaryConstraintSummary: "Deep capture failed for 1 reference.",
      reasonCodeDistribution: {
        env_limited: 1
      },
      metrics: {
        reasonCodeDistribution: {
          env_limited: 1
        }
      },
      primaryConstraint: expect.objectContaining({
        summary: "Deep capture failed for 1 reference.",
        reasonCode: "env_limited",
        guidance: expect.objectContaining({
          reason: "Deep capture failed for 1 reference.",
          recommendedNextCommands: expect.arrayContaining([
            "Rerun inspiredesign after configuring providers.cookieSource for the protected references you need to capture."
          ])
        })
      })
    });
  });

  it("recomputes the remaining timeout budget before deep capture", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-17T10:00:00.000Z"));

    try {
      const fetch = vi.fn(async (input: { url: string }) => {
        vi.setSystemTime(new Date("2026-04-17T10:00:03.000Z"));
        return makeAggregate({
          records: [
            normalizeRecord("web/default", "web", {
              url: input.url,
              title: "Reference title",
              content: "Reference content"
            })
          ]
        });
      });
      const captureReference = vi.fn(async (url: string, options?: { timeoutMs?: number }) => {
        return {
          ...makeCapture(`Captured ${url}`),
          snapshot: {
            content: `${url} snapshot (${options?.timeoutMs})`,
            refCount: 5,
            warnings: []
          }
        };
      });
      const runtime = toRuntime({ fetch });

      await runInspiredesignWorkflow(runtime, {
        brief: "Design a budget-aware capture flow",
        urls: ["https://example.com/reference"],
        captureMode: "deep",
        mode: "json",
        timeoutMs: 5000,
        outputDir: makeOutputDir()
      }, {
        captureReference
      });

      expect(fetch).toHaveBeenCalledWith(
        { url: "https://example.com/reference" },
        expect.objectContaining({ timeoutMs: 5000 })
      );
      expect(captureReference).toHaveBeenCalledWith(
        "https://example.com/reference",
        expect.objectContaining({
          timeoutMs: expect.any(Number)
        })
      );
      expect(captureReference.mock.calls[0]?.[1]?.timeoutMs).toBe(2000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("forwards deep-capture runtime policy overrides to the capture callback", async () => {
    const runtime = toRuntime({
      fetch: async (input: { url: string }) => makeAggregate({
        records: [
          normalizeRecord("web/default", "web", {
            url: input.url,
            title: "Reference title",
            content: "Reference content"
          })
        ]
      })
    });
    const captureReference = vi.fn(async (url: string) => makeCapture(`Captured ${url}`));

    await runInspiredesignWorkflow(runtime, {
      brief: "Preserve capture runtime policy",
      urls: ["https://example.com/reference"],
      captureMode: "deep",
      mode: "json",
      useCookies: false,
      challengeAutomationMode: "browser",
      cookiePolicyOverride: "off"
    }, {
      captureReference
    });

    expect(captureReference).toHaveBeenCalledWith(
      "https://example.com/reference",
      expect.objectContaining({
        useCookies: false,
        challengeAutomationMode: "browser",
        cookiePolicyOverride: "off"
      })
    );
  });
});
