import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeRecord } from "../src/providers/normalize";
import {
  runInspiredesignWorkflow,
  workflowTestUtils,
  type ReferenceRetrievalPort
} from "../src/providers/workflows";
import type {
  InspiredesignBriefExpansion,
  InspiredesignBriefFormat
} from "../src/inspiredesign/brief-expansion";
import type { InspiredesignCaptureEvidence } from "../src/inspiredesign/contract";
import {
  INSPIREDESIGN_ARTIFACT_GUIDE,
  INSPIREDESIGN_CONTRACT_SECTION_GUIDE
} from "../src/inspiredesign/handoff";
import { buildWorkflowResumeEnvelope } from "../src/providers/workflow-contracts";
import type {
  JsonValue,
  ProviderAggregateResult,
  ProviderError,
  ProviderFailureEntry,
  ProviderSource
} from "../src/providers/types";

type InspiredesignWorkflowMeta = {
  captureAttemptSummary?: string;
  captureAttemptReport?: {
    worked: string[];
    didNotWork: string[];
  };
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
    recovered_fetches?: number;
    recovered_fetch_details?: Array<{
      url: string;
      fetchFailure?: string;
    }>;
    capture_attempts?: {
      snapshot: Record<string, number>;
      clone: Record<string, number>;
      dom: Record<string, number>;
    };
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
  targetAnalysis?: InspiredesignWorkflowTargetAnalysis;
  referencePatternBoard?: {
    references: Array<{
      id: string;
      capturedVia: string[];
      layoutRecipe: string;
    }>;
  };
  designVectors?: {
    sourcePriority: string;
    premiumPosture: string[];
    motionPosture: string[];
    sectionArchitecture: string[];
    interactionMoments: string[];
    materialEffects: string[];
    advancedMotionAdvisory: string[];
    referenceInfluence: string[];
  };
  references: Array<{
    url: string;
    fetchStatus: string;
    captureStatus: string;
    fetchFailure?: string;
    captureFailure?: string;
    capture?: {
      title?: string;
      signals?: string[];
      attempts?: Record<string, { status: string; detail?: string }>;
    };
  }>;
};

type InspiredesignWorkflowTargetAnalysis = {
  primaryKind: "page" | "component" | "asset";
  kinds: Array<"page" | "component" | "asset">;
  confidence: number;
  triggeringSignals: string[];
  evidenceBuckets: {
    anatomy: string[];
    propsSlots: string[];
    stateMatrix: string[];
    tokens: string[];
    assets: string[];
    accessibility: string[];
    motion: string[];
    previewFixtures: string[];
  };
  component?: {
    canvasType: "CanvasComponentInventoryItem";
    inventoryItems: Array<{
      name: string;
      props: Array<{ name: string; type: string }>;
      slots: Array<{ name: string; allowedKinds: string[] }>;
    }>;
  };
  asset?: {
    canvasType: "CanvasAsset";
    assets: Array<{ id: string; sourceType: string; kind: string }>;
  };
};

const FORBIDDEN_CANVAS_REQUEST_KEYS = [
  "targetAnalysis",
  "prototypeScope",
  "sourceArtifacts",
  "artifactGuide",
  "contractSectionGuide"
] as const;

type InspiredesignWorkflowGuide = Record<string, {
  purpose: string;
  expectedContents: string[];
  howToUse: string[];
  mustNot: string[];
}>;

type InspiredesignWorkflowContext = {
  advancedBriefMarkdown: string;
  urls: string[];
  prototypeGuidanceMarkdown: string | null;
  evidence: InspiredesignWorkflowEvidence;
  canvasPlanRequest: {
    canvasSessionId: string;
    leaseId: string;
    documentId: string;
    generationPlan: {
      targetOutcome: { summary: string };
      contentStrategy: { source: string };
      componentStrategy: { mode: string };
      interactionMoments?: string[];
      materialEffects?: string[];
      referencePatternBoard?: InspiredesignWorkflowEvidence["referencePatternBoard"];
      designVectors?: InspiredesignWorkflowEvidence["designVectors"];
      targetAnalysis?: InspiredesignWorkflowTargetAnalysis;
    };
  };
  designAgentHandoff: {
    artifactGuide: InspiredesignWorkflowGuide;
    contractSectionGuide: InspiredesignWorkflowGuide;
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
    implementationContext: {
      referenceSynthesis: {
        cues: string[];
      };
      referencePatternBoard?: InspiredesignWorkflowEvidence["referencePatternBoard"];
      designVectors?: InspiredesignWorkflowEvidence["designVectors"];
      targetAnalysis?: InspiredesignWorkflowTargetAnalysis;
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
  fetch?: ReferenceRetrievalPort["fetch"];
  getAntiBotSnapshots?: ReferenceRetrievalPort["getAntiBotSnapshots"];
}): ReferenceRetrievalPort => ({
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

  it("emits URL-backed artifact files and capture telemetry together for workflow runs", async () => {
    const outputDir = makeOutputDir();
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
    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Design a premium launch surface",
      urls: ["https://example.com/reference"],
      outputDir,
      mode: "context",
      includePrototypeGuidance: true
    }, {
      captureReference: async (url: string) => ({
        ...makeCapture(`Atelier Luma Studio limestone hero brass CTA rail staggered project index from ${url}`),
        attempts: {
          snapshot: { status: "captured" },
          clone: { status: "captured" },
          dom: {
            status: "skipped",
            detail: "DOM capture helper unavailable in this execution lane."
          }
        }
      })
    });

    const meta = output.meta as InspiredesignWorkflowMeta;
    const context = output.context as InspiredesignWorkflowContext;
    const artifactPath = String(output.artifact_path);

    expect(output).toMatchObject({
      mode: "context",
      artifact_path: expect.any(String)
    });
    expect(meta.selection).toEqual({
      urls: ["https://example.com/reference"],
      capture_mode: "deep",
      include_prototype_guidance: true
    });
    expect(context.evidence.references[0]?.capture?.attempts).toEqual({
      snapshot: { status: "captured" },
      clone: { status: "captured" },
      dom: { status: "skipped", detail: "DOM capture helper unavailable in this execution lane." }
    });
    expect(meta.artifact_manifest.files).toEqual(expect.arrayContaining([
      "advanced-brief.md",
      "canvas-plan.request.json",
      "design-agent-handoff.json",
      "prototype-guidance.md",
      "evidence.json"
    ]));
    expect(context.canvasPlanRequest.generationPlan.targetOutcome.summary).toContain("Atelier Luma Studio");
    expect(context.canvasPlanRequest.generationPlan.contentStrategy.source).toContain("limestone hero");
    expect(context.canvasPlanRequest.generationPlan.componentStrategy.mode).toContain("brass CTA rail");
    expect(context.designAgentHandoff.artifactGuide).toEqual(INSPIREDESIGN_ARTIFACT_GUIDE);
    expect(context.designAgentHandoff.contractSectionGuide).toEqual(INSPIREDESIGN_CONTRACT_SECTION_GUIDE);
    expect(context.designAgentHandoff.artifactGuide["design-agent-handoff.json"]?.purpose).toContain(
      "Downstream index"
    );
    expect(context.designAgentHandoff.artifactGuide["canvas-plan.request.json"]?.mustNot).toEqual(
      expect.arrayContaining([expect.stringContaining("handoff-only fields")])
    );
    expect(context.designAgentHandoff.contractSectionGuide.generationPlan?.purpose).toContain(
      "Mutation-safe subset"
    );
    expect(context.designAgentHandoff.contractSectionGuide.motionSystem?.mustNot).toEqual(
      expect.arrayContaining([expect.stringContaining("runtime libraries")])
    );
    expect(context.designAgentHandoff.implementationContext.referenceSynthesis.cues[0]).toContain("staggered project index");
    expect(context.advancedBriefMarkdown.indexOf("Reference pattern board:")).toBe(0);
    expect(context.advancedBriefMarkdown.indexOf("Atelier Luma Studio")).toBeLessThan(
      context.advancedBriefMarkdown.indexOf("Selected prompt format:")
    );
    expect(context.evidence.referencePatternBoard?.references[0]).toMatchObject({
      id: expect.any(String),
      capturedVia: ["fetch", "snapshot", "clone"],
      layoutRecipe: expect.stringContaining("Atelier Luma Studio")
    });
    expect(context.evidence.designVectors).toMatchObject({
      sourcePriority: "reference-evidence-first",
      premiumPosture: expect.arrayContaining([expect.stringContaining("premium")]),
      motionPosture: expect.arrayContaining([expect.stringContaining("reveal")]),
      sectionArchitecture: expect.arrayContaining([expect.stringContaining("8 to 12")]),
      interactionMoments: expect.arrayContaining([expect.stringContaining("Microinteractions")]),
      materialEffects: expect.arrayContaining([expect.stringContaining("Glassmorphism")]),
      advancedMotionAdvisory: expect.arrayContaining([
        expect.stringContaining("shader-style"),
        expect.stringContaining("WebGL-style"),
        expect.stringContaining("Spline-style"),
        expect.stringContaining("Runtime boundary")
      ]),
      referenceInfluence: expect.arrayContaining([expect.stringContaining("Atelier Luma Studio")])
    });
    expect("referencePatternBoard" in context.canvasPlanRequest.generationPlan).toBe(false);
    expect(context.canvasPlanRequest.generationPlan.designVectors).toMatchObject({
      premiumPosture: expect.arrayContaining([expect.stringContaining("premium")]),
      motionPosture: expect.arrayContaining([expect.stringContaining("reveal")]),
      sectionArchitecture: expect.arrayContaining([expect.stringContaining("8 to 12")]),
      interactionMoments: expect.arrayContaining([expect.stringContaining("Microinteractions")]),
      materialEffects: expect.arrayContaining([expect.stringContaining("Glassmorphism")]),
      advancedMotionAdvisory: context.evidence.designVectors?.advancedMotionAdvisory,
      referenceInfluence: expect.arrayContaining([expect.stringContaining("Atelier Luma Studio")])
    });
    expect("advancedMotionAdvisory" in context.canvasPlanRequest.generationPlan).toBe(false);
    expect(context.designAgentHandoff.implementationContext.referencePatternBoard).toEqual(
      context.evidence.referencePatternBoard
    );
    expect(context.designAgentHandoff.implementationContext.designVectors).toEqual(
      context.evidence.designVectors
    );
    for (const fileName of [
      "advanced-brief.md",
      "design.md",
      "implementation-plan.md",
      "prototype-guidance.md",
      "canvas-plan.request.json",
      "design-agent-handoff.json"
    ]) {
      const content = readFileSync(join(artifactPath, fileName), "utf8");
      expect(content).toContain("Atelier Luma Studio");
      expect(content).toContain("limestone hero");
      expect(content).toContain("brass CTA rail");
      expect(content).toContain("staggered project index");
      expect(content).toContain("shader-style");
      expect(content).toContain("WebGL-style");
      expect(content).toContain("Spline-style");
    }
    const generationPlan = JSON.parse(
      readFileSync(join(artifactPath, "generation-plan.json"), "utf8")
    ) as InspiredesignWorkflowContext["canvasPlanRequest"]["generationPlan"];
    const canvasRequest = JSON.parse(
      readFileSync(join(artifactPath, "canvas-plan.request.json"), "utf8")
    ) as InspiredesignWorkflowContext["canvasPlanRequest"];
    const handoff = JSON.parse(
      readFileSync(join(artifactPath, "design-agent-handoff.json"), "utf8")
    ) as InspiredesignWorkflowContext["designAgentHandoff"];
    const evidence = JSON.parse(
      readFileSync(join(artifactPath, "evidence.json"), "utf8")
    ) as InspiredesignWorkflowEvidence;

    expect(handoff.artifactGuide).toEqual(INSPIREDESIGN_ARTIFACT_GUIDE);
    expect(handoff.contractSectionGuide).toEqual(INSPIREDESIGN_CONTRACT_SECTION_GUIDE);
    expect(handoff.artifactGuide["design-agent-handoff.json"]?.expectedContents).toEqual(
      expect.arrayContaining(["artifact and section guides"])
    );
    expect(handoff.contractSectionGuide.generationPlan?.mustNot).toEqual(
      expect.arrayContaining([expect.stringContaining("handoff-only guide fields")])
    );
    expect(generationPlan.referencePatternBoard).toEqual(evidence.referencePatternBoard);
    expect(generationPlan.designVectors).toEqual(evidence.designVectors);
    expect(generationPlan.designVectors?.advancedMotionAdvisory).toEqual(
      evidence.designVectors?.advancedMotionAdvisory
    );
    expect(generationPlan.interactionMoments).toEqual(evidence.designVectors?.interactionMoments);
    expect(generationPlan.materialEffects).toEqual(evidence.designVectors?.materialEffects);
    expect(JSON.stringify(canvasRequest)).not.toContain("artifactGuide");
    expect(JSON.stringify(canvasRequest)).not.toContain("contractSectionGuide");
    expect("referencePatternBoard" in canvasRequest.generationPlan).toBe(false);
    expect("advancedMotionAdvisory" in canvasRequest.generationPlan).toBe(false);
    expect(canvasRequest.generationPlan.interactionMoments).toEqual(evidence.designVectors?.interactionMoments);
    expect(canvasRequest.generationPlan.materialEffects).toEqual(evidence.designVectors?.materialEffects);
    expect(canvasRequest.generationPlan.designVectors).toMatchObject({
      premiumPosture: expect.arrayContaining([expect.stringContaining("premium")]),
      motionPosture: expect.arrayContaining([expect.stringContaining("reveal")]),
      sectionArchitecture: expect.arrayContaining([expect.stringContaining("8 to 12")]),
      interactionMoments: expect.arrayContaining([expect.stringContaining("Microinteractions")]),
      materialEffects: expect.arrayContaining([expect.stringContaining("Glassmorphism")]),
      advancedMotionAdvisory: evidence.designVectors?.advancedMotionAdvisory,
      referenceInfluence: expect.arrayContaining([expect.stringContaining("Atelier Luma Studio")])
    });
    expect(handoff.implementationContext.designVectors).toEqual(evidence.designVectors);
  });

  it("persists component target analysis through workflow artifacts without adding Canvas request fields", async () => {
    const outputDir = makeOutputDir();
    const componentBrief = "Prototype a reusable checkout card component with price props, badge slot, media slot, hover focus disabled loading and error states plus an asset pack with responsive variants and usage rules.";
    const runtime = toRuntime({
      fetch: async (input: { url: string }) => makeAggregate({
        records: [
          normalizeRecord("web/default", "web", {
            url: input.url,
            title: "Checkout Card Component",
            content: "Reusable checkout card component with pricing props, media slot, badge slot, focus state, loading state, error state, tokenized CTA anatomy, and an asset pack with provenance, responsive variants, and usage rules."
          })
        ]
      })
    });

    const output = await runInspiredesignWorkflow(runtime, {
      brief: componentBrief,
      urls: ["https://example.com/checkout-card"],
      outputDir,
      mode: "context",
      includePrototypeGuidance: true
    }, {
      captureReference: async () => ({
        ...makeCapture("Checkout Card Component anatomy props slots state matrix tokens asset pack responsive variants usage rules"),
        attempts: {
          snapshot: { status: "captured" },
          clone: { status: "captured" },
          dom: { status: "skipped", detail: "DOM capture helper unavailable in this execution lane." }
        }
      })
    });

    const context = output.context as InspiredesignWorkflowContext;
    const artifactPath = String(output.artifact_path);
    const generationPlan = JSON.parse(
      readFileSync(join(artifactPath, "generation-plan.json"), "utf8")
    ) as InspiredesignWorkflowContext["canvasPlanRequest"]["generationPlan"];
    const canvasRequest = JSON.parse(
      readFileSync(join(artifactPath, "canvas-plan.request.json"), "utf8")
    ) as InspiredesignWorkflowContext["canvasPlanRequest"];
    const handoff = JSON.parse(
      readFileSync(join(artifactPath, "design-agent-handoff.json"), "utf8")
    ) as InspiredesignWorkflowContext["designAgentHandoff"];
    const evidence = JSON.parse(
      readFileSync(join(artifactPath, "evidence.json"), "utf8")
    ) as InspiredesignWorkflowEvidence;
    const prototypeGuidance = readFileSync(join(artifactPath, "prototype-guidance.md"), "utf8");

    expect(evidence.targetAnalysis).toMatchObject({
      primaryKind: "component",
      kinds: ["component", "asset"],
      confidence: expect.any(Number),
      triggeringSignals: expect.arrayContaining([
        expect.stringContaining("component intent"),
        expect.stringContaining("asset intent")
      ]),
      component: {
        canvasType: "CanvasComponentInventoryItem",
        inventoryItems: [
          expect.objectContaining({
            name: expect.stringContaining("Component")
          })
        ]
      },
      asset: {
        canvasType: "CanvasAsset",
        assets: [
          expect.objectContaining({
            kind: "visual-asset"
          })
        ]
      }
    });
    expect(evidence.targetAnalysis?.evidenceBuckets).toMatchObject({
      anatomy: expect.arrayContaining([expect.stringContaining("anatomy")]),
      propsSlots: expect.arrayContaining([expect.stringContaining("props")]),
      stateMatrix: expect.arrayContaining([expect.stringContaining("default")]),
      tokens: expect.arrayContaining([expect.stringContaining("token")]),
      assets: expect.arrayContaining([expect.stringContaining("asset")]),
      accessibility: expect.arrayContaining([expect.stringContaining("keyboard")]),
      motion: expect.arrayContaining([expect.stringContaining("reduced-motion")]),
      previewFixtures: expect.arrayContaining([expect.stringContaining("fixture")])
    });
    expect(context.evidence.targetAnalysis).toEqual(evidence.targetAnalysis);
    expect(context.designAgentHandoff.implementationContext.targetAnalysis).toEqual(evidence.targetAnalysis);
    expect(generationPlan.targetAnalysis).toEqual(evidence.targetAnalysis);
    expect(handoff.implementationContext.targetAnalysis).toEqual(evidence.targetAnalysis);
    expect(canvasRequest.generationPlan.targetAnalysis).toBeUndefined();
    expect(canvasRequest.generationPlan.designVectors?.advancedMotionAdvisory).toEqual(
      evidence.designVectors?.advancedMotionAdvisory
    );
    expect("advancedMotionAdvisory" in canvasRequest.generationPlan).toBe(false);
    expect(prototypeGuidance).toContain("Component prototype target");
    expect(prototypeGuidance).toContain("props/slots");
    expect(prototypeGuidance).toContain("triggering signals");
    for (const key of FORBIDDEN_CANVAS_REQUEST_KEYS) {
      expect(JSON.stringify(canvasRequest)).not.toContain(key);
    }
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

  it("ignores cached envelope routes that use invalid enum values", async () => {
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
      kind: "inspiredesign",
      input: {
        brief: "Design a docs workspace",
        urls: ["https://example.com/reference"],
        mode: "context",
        briefExpansion: {
          sourceBrief: "Design a docs workspace",
          advancedBrief: "Selected prompt format: Invalid cached brief",
          templateVersion: "inspiredesign-advanced-brief.v1",
          format: {
            ...makeBriefFormat(),
            id: "invalid-cached-route",
            label: "Invalid cached brief",
            route: {
              profile: "not-a-profile",
              themeStrategy: "single-theme",
              navigationModel: "contextual",
              layoutApproach: "custom-layout"
            }
          }
        }
      }
    } as never, {
      captureReference
    });

    const context = output.context as InspiredesignWorkflowContext;

    expect(context.advancedBriefMarkdown).toContain("Selected prompt format:");
    expect(context.advancedBriefMarkdown).not.toContain("Invalid cached brief");
    expect(context.evidence.briefExpansion.format.id).not.toBe("invalid-cached-route");
  });

  it.each([
    {
      name: "theme strategy",
      route: {
        profile: "immersive-premium-storytelling",
        themeStrategy: "not-a-theme",
        navigationModel: "contextual",
        layoutApproach: "custom-layout"
      }
    },
    {
      name: "navigation model",
      route: {
        profile: "immersive-premium-storytelling",
        themeStrategy: "single-theme",
        navigationModel: "not-a-navigation-model",
        layoutApproach: "custom-layout"
      }
    }
  ])("ignores cached envelope routes with invalid $name values", async ({ route }) => {
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
      kind: "inspiredesign",
      input: {
        brief: "Design a docs workspace",
        urls: ["https://example.com/reference"],
        mode: "context",
        briefExpansion: {
          sourceBrief: "Design a docs workspace",
          advancedBrief: "Selected prompt format: Invalid cached brief",
          templateVersion: "inspiredesign-advanced-brief.v1",
          format: {
            ...makeBriefFormat(),
            id: "invalid-cached-route",
            label: "Invalid cached brief",
            route
          }
        }
      }
    } as never, {
      captureReference
    });

    const context = output.context as InspiredesignWorkflowContext;

    expect(context.advancedBriefMarkdown).toContain("Selected prompt format:");
    expect(context.advancedBriefMarkdown).not.toContain("Invalid cached brief");
    expect(context.evidence.briefExpansion.format.id).not.toBe("invalid-cached-route");
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

  it("regenerates cached brief expansions whose format id is no longer in the current template", async () => {
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
        templateVersion: "inspiredesign-advanced-brief.v1",
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

    expect(context.advancedBriefMarkdown).toContain("Selected prompt format:");
    expect(context.advancedBriefMarkdown).not.toContain("Custom cached brief");
    expect(context.evidence.briefExpansion.templateVersion).toBe("inspiredesign-advanced-brief.v1");
    expect(context.evidence.briefExpansion.format.id).not.toBe("custom");
  });

  it("regenerates stale cached brief expansions when the template version is outdated", async () => {
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
      brief: "Design a premium launch surface",
      briefExpansion: makeBriefExpansion({
        advancedBrief: "Selected prompt format: Stale cached brief\n\nSource brief:\nDesign a premium launch surface",
        templateVersion: "custom-template.v1"
      }),
      urls: ["https://example.com/cached"],
      mode: "context"
    }));

    const context = output.context as InspiredesignWorkflowContext;

    expect(context.advancedBriefMarkdown).toContain("Selected prompt format:");
    expect(context.advancedBriefMarkdown).not.toContain("Stale cached brief");
    expect(context.evidence.briefExpansion.templateVersion).toBe("inspiredesign-advanced-brief.v1");
  });

  it("rebuilds stale cached brief expansion metadata from the current template entry", async () => {
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
      brief: "Design a premium launch surface",
      briefExpansion: makeBriefExpansion({
        advancedBrief: "Selected prompt format: Stale cached brief\n\nSource brief:\nDesign a premium launch surface",
        format: makeBriefFormat({
          label: "Stale cached brief",
          guardrails: ["Keep the stale label forever."]
        })
      }),
      urls: ["https://example.com/cached"],
      mode: "context"
    }));

    const context = output.context as InspiredesignWorkflowContext;

    expect(context.advancedBriefMarkdown).toContain("Selected prompt format:");
    expect(context.advancedBriefMarkdown).not.toContain("Stale cached brief");
    expect(context.evidence.briefExpansion.format.label).not.toBe("Stale cached brief");
    expect(context.evidence.briefExpansion.format.guardrails).not.toContain("Keep the stale label forever.");
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

  it("records fetch failures while surfacing missing deep-capture support truthfully", async () => {
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
      captureStatus: "failed",
      captureFailure: "Deep capture requested, but browser capture is unavailable in this execution lane.",
      capture: {
        attempts: {
          snapshot: {
            status: "skipped",
            detail: "Deep capture requested, but browser capture is unavailable in this execution lane."
          },
          clone: {
            status: "skipped",
            detail: "Deep capture requested, but browser capture is unavailable in this execution lane."
          },
          dom: {
            status: "skipped",
            detail: "Deep capture requested, but browser capture is unavailable in this execution lane."
          }
        }
      }
    });
    expect(evidence.references[0]?.fetchFailure).toEqual(expect.any(String));
    expect(meta).toMatchObject({
      selection: {
        capture_mode: "deep"
      },
      metrics: {
        failed_captures: 1,
        capture_attempts: {
          snapshot: { captured: 0, failed: 0, skipped: 1 },
          clone: { captured: 0, failed: 0, skipped: 1 },
          dom: { captured: 0, failed: 0, skipped: 1 }
        }
      },
      captureAttemptSummary: "worked=none; did_not_work=snapshot (skipped 1), clone (skipped 1), dom (skipped 1)",
      captureAttemptReport: {
        worked: [],
        didNotWork: ["snapshot (skipped 1)", "clone (skipped 1)", "dom (skipped 1)"]
      },
      primaryConstraintSummary: expect.any(String),
      reasonCodeDistribution: {
        challenge_detected: 1
      },
      primaryConstraint: expect.objectContaining({
        reasonCode: "challenge_detected"
      })
    });
    expect(JSON.stringify(output)).toContain("Deep capture requested, but browser capture is unavailable in this execution lane.");
    expect(output.meta).not.toHaveProperty("primary_constraint");
  });

  it("classifies auth-wall inspiredesign references as session-required failures", async () => {
    const runtime = toRuntime({
      fetch: async (input: { url: string }) => makeAggregate({
        records: [
          normalizeRecord("web/default", "web", {
            url: input.url,
            title: "Sign in | LinkedIn",
            content: "Please sign in to continue."
          })
        ]
      })
    });

    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Design a premium docs workspace",
      urls: ["https://www.linkedin.com/company/example"],
      captureMode: "off",
      mode: "json",
      outputDir: makeOutputDir()
    });

    const evidence = output.evidence as InspiredesignWorkflowEvidence;
    const meta = output.meta as InspiredesignWorkflowMeta;

    expect(evidence.references[0]).toMatchObject({
      url: "https://www.linkedin.com/company/example",
      fetchStatus: "failed",
      captureStatus: "failed",
      fetchFailure: "Default requires login or an existing session.",
      captureFailure: "Deep capture requested, but browser capture is unavailable in this execution lane."
    });
    expect(output.meta).toMatchObject({
      reasonCodeDistribution: {
        token_required: 1
      },
      primaryConstraint: expect.objectContaining({
        reasonCode: "token_required"
      })
    });
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
        captureStatus: "failed",
        captureFailure: "Deep capture requested, but browser capture is unavailable in this execution lane."
      },
      {
        url: "https://www.pinterest.com/pin/example",
        fetchStatus: "failed",
        captureStatus: "failed",
        captureFailure: "Deep capture requested, but browser capture is unavailable in this execution lane.",
        fetchFailure: "Default requires a live browser-rendered page."
      }
    ]);
    expect(meta.metrics).toMatchObject({
      reference_count: 2,
      fetched_references: 1,
      failed_fetches: 1,
      failed_captures: 2
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
      captureStatus: "failed",
      captureFailure: "Deep capture requested, but browser capture is unavailable in this execution lane."
    });
    expect(evidence.references[0]?.fetchFailure).toBeUndefined();
    expect(output.meta).toMatchObject({
      metrics: {
        fetched_references: 1,
        failed_fetches: 0,
        failed_captures: 1
      },
      primaryConstraintSummary: "Deep capture was unavailable for 1 reference in this execution lane."
    });
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
      captureStatus: "failed",
      captureFailure: "Deep capture requested, but browser capture is unavailable in this execution lane.",
      fetchFailure: "Default hit an anti-bot challenge that requires manual completion."
    });
    expect(output.meta).toMatchObject({
      reasonCodeDistribution: {
        challenge_detected: 1
      },
      primaryConstraintSummary: "Default hit an anti-bot challenge that requires manual completion."
    });
  });

  it("prioritizes auth-required inspiredesign issue hints and omits empty synthesized detail fields", async () => {
    const runtime = toRuntime({
      fetch: async () => makeAggregate({
        records: [
          normalizeRecord("web/default", "web", {
            content: "",
            attributes: {
              reasonCode: "auth_required"
            }
          }),
          normalizeRecord("web/default", "web", {
            url: "https://example.com/challenge",
            title: "Verification required",
            content: "Complete the verification challenge to continue.",
            attributes: {
              reasonCode: "challenge_detected"
            }
          }),
          normalizeRecord("web/default", "web", {
            url: "https://example.com/render",
            title: "Rendered shell",
            content: "",
            attributes: {
              constraint: {
                kind: "render_required",
                evidenceCode: "shell_requires_browser"
              }
            }
          })
        ]
      })
    });

    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Design a gated premium docs workspace",
      urls: ["https://example.com/blocked"],
      captureMode: "off",
      mode: "json",
      outputDir: makeOutputDir()
    });

    const evidence = output.evidence as InspiredesignWorkflowEvidence;

    expect(evidence.references[0]).toMatchObject({
      url: "https://example.com/blocked",
      fetchStatus: "failed",
      captureStatus: "failed",
      fetchFailure: expect.stringContaining("login")
    });
    expect(output.meta).toMatchObject({
      reasonCodeDistribution: {
        auth_required: 1
      },
      primaryConstraint: expect.objectContaining({
        reasonCode: "auth_required"
      })
    });
    expect(output.meta).not.toHaveProperty("primaryConstraint.constraint");
    expect(output.meta).not.toHaveProperty("primaryConstraint.blockerType");
  });

  it("classifies plain env-limited inspiredesign issue hints without auth or render metadata", async () => {
    const runtime = toRuntime({
      fetch: async () => makeAggregate({
        records: [
          normalizeRecord("web/default", "web", {
            content: "",
            attributes: {
              reasonCode: "env_limited",
              constraint: {
                kind: "session_required",
                evidenceCode: "stale_session"
              }
            }
          })
        ]
      })
    });

    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Design a constrained premium docs workspace",
      urls: ["https://example.com/env-limited"],
      captureMode: "off",
      mode: "json",
      outputDir: makeOutputDir()
    });

    expect(output.meta).toMatchObject({
      reasonCodeDistribution: {
        env_limited: 1
      },
      primaryConstraint: expect.objectContaining({
        reasonCode: "env_limited"
      })
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
      captureStatus: "failed",
      captureFailure: "Deep capture requested, but browser capture is unavailable in this execution lane.",
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
      captureStatus: "failed",
      captureFailure: "Deep capture requested, but browser capture is unavailable in this execution lane.",
      fetchFailure: "upstream timeout"
    });
    expect(output.meta).toMatchObject({
      metrics: {
        failed_fetches: 1,
        failed_captures: 1
      },
      primaryConstraintSummary: "upstream timeout"
    });
    expect(output.meta).not.toHaveProperty("primaryConstraint");
  });

  it("does not mark failed fetches as recovered when deep capture only returns code evidence", async () => {
    const runtime = toRuntime({
      fetch: async () => makeAggregate({
        ok: false,
        records: [],
        failures: [makeFailure("web/default", "web", {
          code: "unavailable",
          message: "Default requires a live browser-rendered page."
        })],
        metrics: { attempted: 1, succeeded: 0, failed: 1, retries: 0, latencyMs: 1 },
        error: {
          code: "unavailable",
          message: "Default requires a live browser-rendered page.",
          retryable: false
        }
      })
    });
    const captureReference = vi.fn(async (): Promise<InspiredesignCaptureEvidence> => ({
      clone: {
        cssPreview: ".hero { display: grid; }",
        warnings: []
      }
    }));

    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Design a resilient workflow surface",
      urls: ["https://example.com/code-only"],
      captureMode: "deep",
      mode: "json",
      outputDir: makeOutputDir()
    }, {
      captureReference
    });
    const evidence = output.evidence as InspiredesignWorkflowEvidence;
    const meta = output.meta as InspiredesignWorkflowMeta;

    expect(evidence.references[0]).toMatchObject({
      url: "https://example.com/code-only",
      fetchStatus: "failed",
      captureStatus: "captured",
      fetchFailure: "Default requires a live browser-rendered page."
    });
    expect(evidence.references[0]?.capture?.signals).toBeUndefined();
    expect(meta.metrics).toMatchObject({
      failed_fetches: 1,
      failed_captures: 0
    });
    expect(meta.metrics.recovered_fetches).toBeUndefined();
    expect(meta.primaryConstraintSummary).toBe("Default requires a live browser-rendered page.");
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
    const meta = output.meta as InspiredesignWorkflowMeta;

    expect(evidence.references[0]).toMatchObject({
      url: "https://example.com/empty",
      captureStatus: "failed",
      captureFailure: "Deep capture did not return usable snapshot, DOM, or clone evidence."
    });
    expect(evidence.references[1]).toMatchObject({
      url: "https://example.com/error",
      captureStatus: "failed",
      captureFailure: "Deep capture failed.",
      capture: {
        attempts: {
          snapshot: { status: "failed", detail: "Deep capture failed." },
          clone: { status: "skipped", detail: "Skipped after deep capture failed before artifact capture started." },
          dom: { status: "skipped", detail: "Skipped after deep capture failed before artifact capture started." }
        }
      }
    });
    expect(meta).toMatchObject({
      metrics: {
        failed_captures: 2,
        capture_attempts: {
          snapshot: { captured: 0, failed: 1, skipped: 0 },
          clone: { captured: 0, failed: 0, skipped: 1 },
          dom: { captured: 0, failed: 0, skipped: 1 }
        }
      },
      captureAttemptSummary: "worked=none; did_not_work=snapshot (failed 1), clone (skipped 1), dom (skipped 1)"
    });
  });

  it("accepts deep capture evidence when only DOM content is returned", async () => {
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
    const captureReference = vi.fn(async (): Promise<InspiredesignCaptureEvidence> => ({
      dom: {
        outerHTML: "<main><section>Captured DOM</section></main>",
        truncated: false
      }
    }));

    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Design a resilient workflow surface",
      urls: ["https://example.com/dom-only"],
      captureMode: "deep",
      mode: "json",
      outputDir: makeOutputDir()
    }, {
      captureReference
    });

    const evidence = output.evidence as InspiredesignWorkflowEvidence;

    expect(evidence.references[0]).toMatchObject({
      url: "https://example.com/dom-only",
      fetchStatus: "captured",
      captureStatus: "captured"
    });
    expect(evidence.references[0]?.capture).toMatchObject({
      signals: expect.arrayContaining(["Captured DOM"])
    });
    expect(JSON.stringify(evidence.references[0]?.capture)).not.toContain("<main>");
  });

  it("keeps snapshot evidence when other deep capture methods fail and reports the attempt outcomes", async () => {
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
    const captureReference = vi.fn(async (): Promise<InspiredesignCaptureEvidence> => ({
      snapshot: {
        content: "Captured actionables snapshot",
        refCount: 5,
        warnings: []
      },
      attempts: {
        snapshot: { status: "captured" },
        clone: { status: "failed", detail: "clone capture timeout" },
        dom: { status: "failed", detail: "dom capture unavailable" }
      }
    }));

    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Design a resilient workflow surface",
      urls: ["https://example.com/snapshot-only"],
      captureMode: "deep",
      mode: "json",
      outputDir: makeOutputDir()
    }, {
      captureReference
    });

    const evidence = output.evidence as InspiredesignWorkflowEvidence;
    const meta = output.meta as InspiredesignWorkflowMeta;

    expect(evidence.references[0]).toMatchObject({
      url: "https://example.com/snapshot-only",
      fetchStatus: "captured",
      captureStatus: "captured",
      capture: {
        attempts: {
          snapshot: { status: "captured" },
          clone: { status: "failed", detail: "clone capture timeout" },
          dom: { status: "failed", detail: "dom capture unavailable" }
        }
      }
    });
    expect(meta).toMatchObject({
      metrics: {
        captured_references: 1,
        failed_captures: 0,
        capture_attempts: {
          snapshot: { captured: 1, failed: 0, skipped: 0 },
          clone: { captured: 0, failed: 1, skipped: 0 },
          dom: { captured: 0, failed: 1, skipped: 0 }
        }
      },
      captureAttemptSummary: "worked=snapshot (captured 1); did_not_work=clone (failed 1), dom (failed 1)",
      captureAttemptReport: {
        worked: ["snapshot (captured 1)"],
        didNotWork: ["clone (failed 1)", "dom (failed 1)"]
      }
    });
    expect(meta.primaryConstraintSummary).toBeUndefined();
    expect(output.captureAttemptSummary).toBe("worked=snapshot (captured 1); did_not_work=clone (failed 1), dom (failed 1)");
  });

  it("keeps title-only deep capture as diagnostic evidence but reports the capture as failed", async () => {
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
    const captureReference = vi.fn(async (): Promise<InspiredesignCaptureEvidence> => ({
      title: "Captured title only"
    }));

    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Design a diagnostic-first landing page",
      urls: ["https://example.com/title-only"],
      captureMode: "deep",
      mode: "json",
      outputDir: makeOutputDir()
    }, {
      captureReference
    });

    const evidence = output.evidence as InspiredesignWorkflowEvidence;
    const meta = output.meta as InspiredesignWorkflowMeta;

    expect(evidence.references[0]).toMatchObject({
      url: "https://example.com/title-only",
      fetchStatus: "captured",
      captureStatus: "failed",
      captureFailure: "Deep capture did not return usable snapshot, DOM, or clone evidence.",
      capture: {
        title: "Captured title only"
      }
    });
    expect(meta.metrics.captured_references).toBe(0);
    expect(meta.metrics.failed_captures).toBe(1);
    expect(output.captureAttemptSummary).toBeUndefined();
  });

  it("falls back to deep-capture title when the fetched title is blank", async () => {
    const runtime = toRuntime({
      fetch: async (input: { url: string }) => makeAggregate({
        records: [
          normalizeRecord("web/default", "web", {
            url: input.url,
            title: "",
            content: "Reference content"
          })
        ]
      })
    });
    const captureReference = vi.fn(async (): Promise<InspiredesignCaptureEvidence> => makeCapture("Captured title only"));

    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Design a recovery-aware landing page",
      urls: ["https://example.com/blank-title"],
      captureMode: "deep",
      mode: "json",
      outputDir: makeOutputDir()
    }, {
      captureReference
    });

    const evidence = output.evidence as InspiredesignWorkflowEvidence;

    expect(evidence.references[0]).toMatchObject({
      url: "https://example.com/blank-title",
      title: "Captured title only",
      fetchStatus: "captured",
      captureStatus: "captured"
    });
  });

  it("reports empty snapshot and clone deep capture attempts as failed without counting a capture success", async () => {
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
    const captureReference = vi.fn(async (): Promise<InspiredesignCaptureEvidence> => ({
      attempts: {
        snapshot: {
          status: "failed",
          detail: "Snapshot capture returned empty content."
        },
        clone: {
          status: "failed",
          detail: "Clone capture returned empty component and CSS previews."
        },
        dom: {
          status: "skipped",
          detail: "DOM capture helper unavailable in this execution lane."
        }
      }
    }));

    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Design a resilient workflow surface",
      urls: ["https://example.com/empty-capture"],
      captureMode: "deep",
      mode: "json",
      outputDir: makeOutputDir()
    }, {
      captureReference
    });

    const evidence = output.evidence as InspiredesignWorkflowEvidence;
    const meta = output.meta as InspiredesignWorkflowMeta;

    expect(evidence.references[0]).toMatchObject({
      url: "https://example.com/empty-capture",
      fetchStatus: "captured",
      captureStatus: "failed",
      captureFailure: "Deep capture did not return usable snapshot, DOM, or clone evidence.",
      capture: {
        attempts: {
          snapshot: {
            status: "failed",
            detail: "Snapshot capture returned empty content."
          },
          clone: {
            status: "failed",
            detail: "Clone capture returned empty component and CSS previews."
          },
          dom: {
            status: "skipped",
            detail: "DOM capture helper unavailable in this execution lane."
          }
        }
      }
    });
    expect(meta).toMatchObject({
      metrics: {
        captured_references: 0,
        failed_captures: 1,
        capture_attempts: {
          snapshot: { captured: 0, failed: 1, skipped: 0 },
          clone: { captured: 0, failed: 1, skipped: 0 },
          dom: { captured: 0, failed: 0, skipped: 1 }
        }
      },
      captureAttemptSummary: "worked=none; did_not_work=snapshot (failed 1), clone (failed 1), dom (skipped 1)",
      captureAttemptReport: {
        worked: [],
        didNotWork: ["snapshot (failed 1)", "clone (failed 1)", "dom (skipped 1)"]
      }
    });
  });

  it("downgrades captured attempt summaries when normalization drops empty artifacts", async () => {
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
    const captureReference = vi.fn(async (): Promise<InspiredesignCaptureEvidence> => ({
      snapshot: {
        content: "   ",
        refCount: 1,
        warnings: []
      },
      attempts: {
        snapshot: { status: "captured" },
        clone: { status: "skipped", detail: "Clone capture not requested." },
        dom: { status: "skipped", detail: "DOM capture helper unavailable in this execution lane." }
      }
    }));

    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Design a resilient workflow surface",
      urls: ["https://example.com/normalized-empty-snapshot"],
      captureMode: "deep",
      mode: "json",
      outputDir: makeOutputDir()
    }, {
      captureReference
    });

    const evidence = output.evidence as InspiredesignWorkflowEvidence;
    const meta = output.meta as InspiredesignWorkflowMeta;

    expect(evidence.references[0]).toMatchObject({
      url: "https://example.com/normalized-empty-snapshot",
      captureStatus: "failed",
      captureFailure: "Deep capture did not return usable snapshot, DOM, or clone evidence.",
      capture: {
        attempts: {
          snapshot: {
            status: "failed",
            detail: "Captured artifact was empty after normalization."
          },
          clone: { status: "skipped", detail: "Clone capture not requested." },
          dom: {
            status: "skipped",
            detail: "DOM capture helper unavailable in this execution lane."
          }
        }
      }
    });
    expect(meta).toMatchObject({
      metrics: {
        captured_references: 0,
        failed_captures: 1,
        capture_attempts: {
          snapshot: { captured: 0, failed: 1, skipped: 0 },
          clone: { captured: 0, failed: 0, skipped: 1 },
          dom: { captured: 0, failed: 0, skipped: 1 }
        }
      },
      captureAttemptSummary: "worked=none; did_not_work=snapshot (failed 1), clone (skipped 1), dom (skipped 1)",
      captureAttemptReport: {
        worked: [],
        didNotWork: ["snapshot (failed 1)", "clone (skipped 1)", "dom (skipped 1)"]
      }
    });
    expect(output.captureAttemptSummary).toBe(
      "worked=none; did_not_work=snapshot (failed 1), clone (skipped 1), dom (skipped 1)"
    );
  });

  it("normalizes malformed deep capture attempt payloads before workflow aggregation", async () => {
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
    const captureReference = vi.fn(async (): Promise<InspiredesignCaptureEvidence> => ({
      snapshot: {
        content: "Captured actionables snapshot",
        refCount: 3,
        warnings: []
      },
      attempts: {
        snapshot: { status: "captured" },
        clone: { status: "broken", detail: 5 },
        dom: undefined
      }
    } as InspiredesignCaptureEvidence));

    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Design a fault-tolerant review surface",
      urls: ["https://example.com/malformed-attempts"],
      captureMode: "deep",
      mode: "json",
      outputDir: makeOutputDir()
    }, {
      captureReference
    });

    const evidence = output.evidence as InspiredesignWorkflowEvidence;
    const meta = output.meta as InspiredesignWorkflowMeta;

    expect(evidence.references[0]).toMatchObject({
      url: "https://example.com/malformed-attempts",
      captureStatus: "captured",
      capture: {
        attempts: {
          snapshot: { status: "captured" },
          clone: {
            status: "skipped",
            detail: "Capture attempt metadata missing or malformed."
          },
          dom: {
            status: "skipped",
            detail: "Capture attempt metadata missing or malformed."
          }
        }
      }
    });
    expect(meta).toMatchObject({
      metrics: {
        captured_references: 1,
        capture_attempts: {
          snapshot: { captured: 1, failed: 0, skipped: 0 },
          clone: { captured: 0, failed: 0, skipped: 1 },
          dom: { captured: 0, failed: 0, skipped: 1 }
        }
      },
      captureAttemptSummary: "worked=snapshot (captured 1); did_not_work=clone (skipped 1), dom (skipped 1)",
      captureAttemptReport: {
        worked: ["snapshot (captured 1)"],
        didNotWork: ["clone (skipped 1)", "dom (skipped 1)"]
      }
    });
    expect(output.captureAttemptSummary).toBe("worked=snapshot (captured 1); did_not_work=clone (skipped 1), dom (skipped 1)");
  });

  it("accepts deep capture evidence when only clone output is returned", async () => {
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
    const captureReference = vi.fn(async (): Promise<InspiredesignCaptureEvidence> => ({
      clone: {
        componentPreview: "<section>Captured clone</section>",
        cssPreview: ".hero { display: grid; }",
        warnings: []
      }
    }));

    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Design a resilient workflow surface",
      urls: ["https://example.com/clone-only"],
      captureMode: "deep",
      mode: "json",
      outputDir: makeOutputDir()
    }, {
      captureReference
    });

    const evidence = output.evidence as InspiredesignWorkflowEvidence;

    expect(evidence.references[0]).toMatchObject({
      url: "https://example.com/clone-only",
      fetchStatus: "captured",
      captureStatus: "captured"
    });
    expect(evidence.references[0]?.capture).toMatchObject({
      signals: expect.arrayContaining(["Captured clone"])
    });
    expect(JSON.stringify(evidence.references[0]?.capture)).not.toContain("<section>");
    expect(JSON.stringify(evidence.references[0]?.capture)).not.toContain(".hero");
  });

  it("accepts deep capture evidence when clone CSS is present even if the component preview is empty", async () => {
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
    const captureReference = vi.fn(async (): Promise<InspiredesignCaptureEvidence> => ({
      clone: {
        componentPreview: "",
        cssPreview: ".hero { display: grid; }",
        warnings: []
      },
      attempts: {
        snapshot: { status: "failed", detail: "Snapshot capture returned empty content." },
        clone: { status: "captured" },
        dom: { status: "skipped", detail: "DOM capture helper unavailable in this execution lane." }
      }
    }));

    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Design a resilient workflow surface",
      urls: ["https://example.com/clone-css-only"],
      captureMode: "deep",
      mode: "json",
      outputDir: makeOutputDir()
    }, {
      captureReference
    });

    const evidence = output.evidence as InspiredesignWorkflowEvidence;

    expect(evidence.references[0]).toMatchObject({
      url: "https://example.com/clone-css-only",
      fetchStatus: "captured",
      captureStatus: "captured",
      capture: {
        signals: expect.arrayContaining(["Reference title", "Reference content"])
      }
    });
    expect(JSON.stringify(evidence.references[0]?.capture)).not.toContain(".hero");
  });

  it("uses capture-backed reference evidence when fetch fails but deep capture succeeds", async () => {
    const runtime = toRuntime({
      fetch: async () => makeAggregate({
        ok: false,
        records: [],
        failures: [
          makeFailure("web/default", "web", {
            message: "shell only response",
            reasonCode: "env_limited"
          })
        ],
        error: {
          code: "unavailable",
          message: "shell only response",
          retryable: false
        }
      })
    });
    const captureReference = vi.fn(async (): Promise<InspiredesignCaptureEvidence> => ({
      snapshot: {
        content: "Captured editorial hero with strong CTA and tiered proof blocks.",
        refCount: 4,
        warnings: []
      }
    }));

    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Design a resilient workflow surface",
      urls: ["https://example.com/recovered-by-capture"],
      captureMode: "deep",
      mode: "json",
      outputDir: makeOutputDir()
    }, {
      captureReference
    });

    const evidence = output.evidence as InspiredesignWorkflowEvidence;
    const designContract = output.designContract as {
      contentModel: {
        supportingMessages: string[];
      };
    };

    expect(evidence.references[0]).toMatchObject({
      url: "https://example.com/recovered-by-capture",
      title: "Captured editorial hero with strong CTA and tiered proof blocks.",
      excerpt: "Captured editorial hero with strong CTA and tiered proof blocks.",
      fetchStatus: "failed",
      captureStatus: "captured",
      fetchFailure: expect.any(String)
    });
    expect(designContract.contentModel.supportingMessages).toEqual([
      "Captured editorial hero with strong CTA and tiered proof blocks."
    ]);
    expect(output.meta).toMatchObject({
      metrics: {
        fetched_references: 0,
        captured_references: 1,
        failed_fetches: 0,
        failed_captures: 0
      }
    });
    expect(output.meta).not.toHaveProperty("primaryConstraintSummary");
  });

  it("ignores discarded shell failures when a usable inspiredesign record remains", async () => {
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
          }),
          normalizeRecord("web/default", "web", {
            url: input.url,
            title: "Recovered editorial layout",
            content: "Editorial product layout with calm navigation and clear calls to action."
          })
        ],
        failures: [
          makeFailure("web/default", "web", {
            message: "Default requires login or an existing session.",
            reasonCode: "auth_required"
          })
        ],
        error: {
          code: "auth",
          message: "Default requires login or an existing session.",
          retryable: false,
          reasonCode: "auth_required"
        }
      })
    });
    const captureReference = vi.fn(async (): Promise<InspiredesignCaptureEvidence> => ({
      snapshot: {
        content: "Recovered editorial layout with calm navigation and clear calls to action.",
        refCount: 4,
        warnings: []
      }
    }));

    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Design a premium consumer landing page",
      urls: ["https://example.com/recovered-mixed-failure"],
      captureMode: "deep",
      mode: "json",
      outputDir: makeOutputDir()
    }, {
      captureReference
    });

    const evidence = output.evidence as InspiredesignWorkflowEvidence;

    expect(evidence.references[0]).toMatchObject({
      url: "https://example.com/recovered-mixed-failure",
      title: "Recovered editorial layout",
      fetchStatus: "captured",
      captureStatus: "captured"
    });
    expect(evidence.references[0]?.fetchFailure).toBeUndefined();
    expect(output.meta).toMatchObject({
      metrics: {
        fetched_references: 1,
        captured_references: 1,
        failed_fetches: 0,
        failed_captures: 0
      }
    });
    expect(output.meta).not.toHaveProperty("primaryConstraintSummary");
  });

  it("suppresses fetch failures when deep capture recovers a fetch-failed inspiredesign reference", async () => {
    const runtime = toRuntime({
      fetch: async () => makeAggregate({
        ok: false,
        records: [],
        failures: [
          makeFailure("web/default", "web", {
            code: "auth",
            message: "Default requires login or an existing session.",
            reasonCode: "auth_required"
          })
        ],
        error: {
          code: "auth",
          message: "Default requires login or an existing session.",
          retryable: false,
          reasonCode: "auth_required"
        }
      })
    });
    const captureReference = vi.fn(async (): Promise<InspiredesignCaptureEvidence> => ({
      snapshot: {
        content: "Recovered editorial layout with calm navigation and clear calls to action.",
        refCount: 4,
        warnings: []
      }
    }));

    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Design a premium consumer landing page",
      urls: ["https://example.com/capture-recovered"],
      captureMode: "deep",
      mode: "json",
      outputDir: makeOutputDir()
    }, {
      captureReference
    });

    const evidence = output.evidence as InspiredesignWorkflowEvidence;

    expect(evidence.references[0]).toMatchObject({
      url: "https://example.com/capture-recovered",
      title: "Recovered editorial layout with calm navigation and clear calls to action.",
      fetchStatus: "failed",
      captureStatus: "captured",
      fetchFailure: "Default requires login or an existing session."
    });
    expect(output.meta).toMatchObject({
      metrics: {
        fetched_references: 0,
        captured_references: 1,
        failed_fetches: 0,
        failed_captures: 0,
        recovered_fetches: 1,
        recovered_fetch_details: [
          {
            url: "https://example.com/capture-recovered",
            fetchFailure: "Default requires login or an existing session."
          }
        ]
      },
      reasonCodeDistribution: {}
    });
    expect(output.meta).not.toHaveProperty("primaryConstraintSummary");
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
      captureFailure: "capture exploded",
      capture: {
        attempts: {
          snapshot: { status: "failed", detail: "capture exploded" },
          clone: { status: "skipped", detail: "Skipped after deep capture failed before artifact capture started." },
          dom: { status: "skipped", detail: "Skipped after deep capture failed before artifact capture started." }
        }
      }
    });
    expect(output.meta).toMatchObject({
      primaryConstraintSummary: "Deep capture failed for 1 reference.",
      reasonCodeDistribution: {
        env_limited: 1
      },
      metrics: {
        capture_attempts: {
          snapshot: { captured: 0, failed: 1, skipped: 0 },
          clone: { captured: 0, failed: 0, skipped: 1 },
          dom: { captured: 0, failed: 0, skipped: 1 }
        },
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
    expect(output.followthroughSummary).toContain("Primary constraint: Deep capture failed for 1 reference.");
  });

  it("surfaces primary constraints in compact inspiredesign output", async () => {
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

    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Design a resilient workflow surface",
      urls: ["https://example.com/degraded"],
      captureMode: "deep",
      mode: "compact",
      outputDir: makeOutputDir()
    });

    expect(output.summary).toContain("Primary constraint: Deep capture was unavailable for 1 reference in this execution lane.");
    expect(output.followthroughSummary).toContain(
      "Primary constraint: Deep capture was unavailable for 1 reference in this execution lane."
    );
  });

  it("summarizes unavailable deep capture constraints across multiple references", async () => {
    const runtime = toRuntime({
      fetch: async (input: { url: string }) => makeAggregate({
        records: [
          normalizeRecord("web/default", "web", {
            url: input.url,
            title: `Reference for ${input.url}`,
            content: "Reference content"
          })
        ]
      })
    });

    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Design a resilient workflow surface",
      urls: ["https://example.com/one", "https://example.com/two"],
      captureMode: "deep",
      mode: "json",
      outputDir: makeOutputDir()
    });

    expect(output.meta).toMatchObject({
      primaryConstraintSummary: "Deep capture was unavailable for 2 references in this execution lane.",
      primaryConstraint: expect.objectContaining({
        guidance: expect.objectContaining({
          recommendedNextCommands: expect.arrayContaining([
            "Restore browser capture access for this execution lane, then rerun inspiredesign."
          ])
        })
      }),
      metrics: {
        failed_captures: 2
      }
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
