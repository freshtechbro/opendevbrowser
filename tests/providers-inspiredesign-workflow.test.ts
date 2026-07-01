import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { basename, dirname, join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeRecord } from "../src/providers/normalize";
import {
  readBoundedPinMediaRuntimeFile,
  runInspiredesignWorkflow,
  workflowTestUtils,
	type PinMediaRuntimeReadableFile,
	type InspiredesignWorkflowPinMediaCaptureOptions,
	type InspiredesignWorkflowOptions,
  type ReferenceRetrievalPort
} from "../src/providers/workflows";
import type {
  InspiredesignBriefExpansion,
  InspiredesignBriefFormat
} from "../src/inspiredesign/brief-expansion";
import type { InspiredesignCaptureEvidence } from "../src/inspiredesign/contract";
import {
  INSPIREDESIGN_ARTIFACT_GUIDE,
  INSPIREDESIGN_CONTRACT_SECTION_GUIDE,
  INSPIREDESIGN_HANDOFF_FILES
} from "../src/inspiredesign/handoff";
import { INSPIREDESIGN_MEDIA_ANALYSIS_BINARY_PROBE_TIMEOUT_MS } from "../src/inspiredesign/media-analysis";
import { buildWorkflowResumeEnvelope } from "../src/providers/workflow-contracts";
import type {
  JsonValue,
  NormalizedRecord,
  ProviderAggregateResult,
  ProviderError,
  ProviderFailureEntry,
  ProviderReasonCode,
  ProviderSource
} from "../src/providers/types";
import type { NextStepGuidance } from "../src/guidance/types";
import { installExpectedProviderWarnCapture } from "./support/provider-warn-capture";

type InspiredesignWorkflowMeta = {
  primaryConstraintSummary?: string;
  primaryConstraint?: {
    reasonCode?: string;
    summary?: string;
  };
  captureAttemptSummary?: string;
  captureAttemptReport?: {
    worked: string[];
    didNotWork: string[];
  };
  reasonCodeDistribution?: Record<string, number>;
  followthroughSummary?: string;
  recommendedSkills?: string[];
  deepCaptureRecommendation?: string;
  nextStepGuidance?: NextStepGuidance;
  discovery?: {
    requested: boolean;
    searchAvailable: boolean;
    acceptedUrls?: string[];
    failure?: string;
    siteRecipeId?: string;
    browserNativeDiagnostics?: Record<string, JsonValue>;
  };
  contractScope?: {
    note?: string;
  };
  selection: {
    urls: string[];
    query?: string;
    providers?: string[];
    max_references?: number;
    visual_evidence?: string;
    capture_mode: string;
    primary_capture_strategy?: string;
    requested_browser_mode?: string;
    include_prototype_guidance: boolean;
  };
  metrics: {
    reference_count: number;
    attempted_reference_count?: number;
    all_attempt_failed_capture_count?: number;
    all_attempt_missing_screenshot_count?: number;
    all_attempt_visual_failure_count?: number;
    all_attempt_motion_failure_count?: number;
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

const PIN_MEDIA_RUNTIME_MAX_TEST_BYTES = 20_000_000;

type InspiredesignWorkflowEvidence = {
  advancedBrief: string;
  briefExpansion: {
    templateVersion: string;
    format: InspiredesignBriefFormat;
  };
  targetAnalysis?: InspiredesignWorkflowTargetAnalysis;
  referencePatternBoard?: {
    qualitySummary?: {
      attemptedReferenceCount?: number;
      allAttemptFailedCaptureCount?: number;
      allAttemptMissingScreenshotCount?: number;
      allAttemptVisualFailureCount?: number;
      allAttemptMotionFailureCount?: number;
    };
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

const FORBIDDEN_CANVAS_REQUEST_KEYS = new Set([
  "targetAnalysis",
  "prototypeScope",
  "sourceArtifacts",
  "artifactGuide",
  "contractSectionGuide",
  "mediaAnalysis",
  "mediaPath",
  "mediaUrl",
  "sourceUrl",
  "bboxNorm",
  "boxes",
  "frames",
  "facts",
  "claimLevels",
  "limitations"
]);

const hasForbiddenCanvasRequestKey = (value: JsonValue): boolean => {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => hasForbiddenCanvasRequestKey(item));
  return Object.entries(value).some(([key, nested]) => (
    FORBIDDEN_CANVAS_REQUEST_KEYS.has(key) || hasForbiddenCanvasRequestKey(nested)
  ));
};

const FORBIDDEN_CANVAS_SOURCE_TEXT_PATTERNS = [
  /https?:\/\//i,
  /pinterest\.com/i,
  /i\.pinimg\.com/i,
  /v\d*(?:-[a-z]+)?\.pinimg\.com/i,
  /pin-media-evidence\//i
] as const;

const expectNoCanvasSourceTextLeakage = (payload: string): void => {
  for (const pattern of FORBIDDEN_CANVAS_SOURCE_TEXT_PATTERNS) {
    expect(payload).not.toMatch(pattern);
  }
};

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


const makeJpegBytes = (width: number, height: number, minBytes: number): Buffer => {
  const header = Buffer.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10,
    0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00,
    0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9
  ]);
  return Buffer.concat([header, Buffer.alloc(Math.max(0, minBytes - header.length), 0)]);
};

const validPinMediaBytes = (): Buffer => makeJpegBytes(1200, 1600, 2048);
const LIVE_PIN_MEDIA_VIDEO_WIDTH = 240;
const LIVE_PIN_MEDIA_VIDEO_HEIGHT = 180;

const validPinMediaVideoBytes = (): Buffer => {
  const ftyp = Buffer.alloc(24, 0);
  ftyp.writeUInt32BE(24, 0);
  ftyp.write("ftyp", 4, "ascii");
  ftyp.write("isom", 8, "ascii");
  ftyp.write("iso2", 12, "ascii");
  ftyp.write("avc1", 16, "ascii");
  ftyp.write("mp41", 20, "ascii");
  const tkhd = Buffer.alloc(92, 0);
  tkhd.writeUInt32BE(92, 0);
  tkhd.write("tkhd", 4, "ascii");
  tkhd.writeUInt32BE(LIVE_PIN_MEDIA_VIDEO_WIDTH * 65_536, 84);
  tkhd.writeUInt32BE(LIVE_PIN_MEDIA_VIDEO_HEIGHT * 65_536, 88);
  const trak = Buffer.alloc(100, 0);
  trak.writeUInt32BE(100, 0);
  trak.write("trak", 4, "ascii");
  tkhd.copy(trak, 8);
  const moov = Buffer.alloc(108, 0);
  moov.writeUInt32BE(108, 0);
  moov.write("moov", 4, "ascii");
  trak.copy(moov, 8);
  const media = Buffer.concat([ftyp, moov]);
  return Buffer.concat([media, Buffer.alloc(2048 - media.length, 0)]);
};

const makeOutputDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "inspiredesign-workflow-"));
  tempDirs.push(dir);
  return dir;
};

const expectArtifactPath = (artifactPath: string, root: string, namespace: string): void => {
  expect(dirname(dirname(artifactPath))).toBe(root);
  expect(basename(dirname(artifactPath))).toBe(namespace);
  expect(basename(artifactPath)).toMatch(/^[0-9a-f-]{36}$/);
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

const PINTEREST_IMAGE_PIN_ATTRIBUTES: Record<string, JsonValue> = {
  pinterestMediaClassification: {
    kind: "image_pin",
    confidence: 0.9,
    productCandidate: true,
    sourcePageQuality: "pin_media",
    reasons: ["browser_native_image_pin"],
    diagnosticBlockers: []
  }
};

const PINTEREST_VIDEO_PIN_ATTRIBUTES: Record<string, JsonValue> = {
  pinterestMediaClassification: {
    kind: "video_pin",
    confidence: 0.9,
    productCandidate: true,
    sourcePageQuality: "pin_media",
    reasons: ["browser_native_video_pin"],
    diagnosticBlockers: []
  }
};

const makePinterestSearchShellDiscoveryRecord = (url: string, pinUrl: string): NormalizedRecord => {
  const pinPath = new URL(pinUrl).pathname;
  return normalizeRecord("social/pinterest", "social", {
    url,
    title: "Pinterest query results",
    content: "Search results for cinematic photography studio. Pin card results are visible.",
    attributes: {
      links: [
        pinPath,
        "https://www.pinterest.com/ideas/web-design-parallax-scrolling/896364491640/",
        "https://example.com/offsite-reference"
      ],
      html: `<main><article aria-label="Pin card"><a href="${pinPath}">Studio pin</a></article></main>`
    }
  });
};

const makePinterestDiscoveredImagePinRecord = (url: string): NormalizedRecord => normalizeRecord("social/pinterest", "social", {
  url,
  title: "Pinterest discovered image pin reference",
  content: "Full-bleed editorial image pin with premium product staging",
  attributes: PINTEREST_IMAGE_PIN_ATTRIBUTES
});

const makePinterestImagePinMediaCapture = (
  url: string,
  options: InspiredesignWorkflowPinMediaCaptureOptions,
  mediaUrl: string
) => ({
  status: "captured" as const,
  kind: "image" as const,
  capturedAt: "2026-05-23T00:00:00.000Z",
  referenceId: options.referenceId,
  url,
  sourceUrl: url,
  endedSourceUrl: url,
  pinterestPageQuality: "pin_media" as const,
  mediaUrl,
  candidateSelector: "[data-test-id='closeup-image-main-MainPinImage']",
  width: 1200,
  height: 1600,
  contentType: "image/jpeg",
  tempPath: options.pinMediaEvidencePath,
  warnings: [],
  rejectionReasons: []
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
  search?: ReferenceRetrievalPort["search"];
  getAntiBotSnapshots?: ReferenceRetrievalPort["getAntiBotSnapshots"];
}): ReferenceRetrievalPort => ({
  fetch: handlers.fetch ?? (async () => makeAggregate()),
  ...(handlers.search ? { search: handlers.search } : {}),
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

installExpectedProviderWarnCapture();

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

  it("uses fallback product copy when feature sections collapse to labels only", () => {
    const record = normalizeRecord("shopping/walmart", "shopping", {
      url: "https://www.walmart.com/ip/featureless-copy",
      title: "Featureless copy fixture",
      content: "About this item See more product details"
    });

    expect(workflowTestUtils.resolveProductCopy(
      record,
      "https://www.walmart.com/ip/featureless-copy",
      undefined,
      []
    )).toBe("About this item See more product details");
  });

  it("keeps preferred product copy when malformed URLs cannot be checked for marketplace promos", () => {
    const record = normalizeRecord("shopping/walmart", "shopping", {
      url: "https://www.walmart.com/ip/malformed-copy",
      title: "Malformed copy fixture",
      content: "Fallback marketplace content should not win."
    });

    expect(workflowTestUtils.resolveProductCopy(
      record,
      "https://%",
      "Studio-grade product narrative with real merchandising details.",
      []
    )).toBe("Studio-grade product narrative with real merchandising details.");
  });

  it("returns a path artifact bundle when no references are supplied", async () => {
    const runtime = toRuntime({});
    const outputDir = makeOutputDir();
    const output = await runInspiredesignWorkflow(runtime, {
      brief: "  Create a premium knowledge base  ",
      mode: "path",
      outputDir
    });

    const meta = output.meta as InspiredesignWorkflowMeta;
    const artifactPath = String(output.artifact_path);

    expect(output).toMatchObject({
      mode: "path",
      artifact_path: expect.any(String),
		followthroughSummary: "Canvas continuation unavailable until ranked references include authoritative visual, motion, or pin-media evidence.",
      productSuccess: false,
      artifactAuthority: "diagnostic_only",
		suggestedNextAction: "Canvas continuation unavailable until ranked references include authoritative visual, motion, or pin-media evidence."
    });
    expect(meta.nextStepGuidance).toEqual(expect.objectContaining({
      readiness: "ready",
      reasonCode: "design_ready"
    }));
    expect(meta.selection).toEqual({
      urls: [],
      capture_mode: "off",
      include_prototype_guidance: false
    });
    expect(meta.metrics.reference_count).toBe(0);
    expect(meta.artifact_manifest.files).toContain("design.md");
	expect(meta.followthroughSummary).toBe("Canvas continuation unavailable until ranked references include authoritative visual, motion, or pin-media evidence.");
    expect(meta.recommendedSkills).toEqual([
      'opendevbrowser-best-practices "quick start"',
      'opendevbrowser-design-agent "canvas-contract"',
      'opendevbrowser-motion-design "quick start"'
    ]);
    expect(meta.contractScope).toEqual(expect.objectContaining({
      note: expect.stringContaining("design-contract.json is the narrowed canvas governance contract")
    }));
    expect(meta.artifact_manifest.files).toEqual(expect.arrayContaining([
      "advanced-brief.md",
      "design-agent-handoff.json"
    ]));
    expect(meta.artifact_manifest.files).not.toContain("canvas-plan.request.json");
    const handoff = JSON.parse(readFileSync(join(artifactPath, "design-agent-handoff.json"), "utf8")) as Record<string, unknown>;
    expect(handoff).toEqual(expect.objectContaining({
		nextStep: "Canvas continuation unavailable until ranked references include authoritative visual, motion, or pin-media evidence.",
		suggestedNextAction: "Canvas continuation unavailable until ranked references include authoritative visual, motion, or pin-media evidence.",
      nextStepGuidance: expect.objectContaining({
        readiness: "ready",
        reasonCode: "design_ready"
      })
    }));
    expectArtifactPath(artifactPath, outputDir, "inspiredesign");
  });

  it("stores default artifact bundles under the workspace inspiredesign directory", async () => {
    const workspaceDir = makeOutputDir();
    vi.spyOn(process, "cwd").mockReturnValue(workspaceDir);
    const runtime = toRuntime({
      fetch: vi.fn(async (_input, options) => {
        expect(options?.suspendedIntent).toMatchObject({
          kind: "workflow.inspiredesign",
          input: {
            workflow: {
              kind: "inspiredesign",
              input: { outputDir: join(workspaceDir, ".opendevbrowser") }
            }
          }
        });
        return makeAggregate();
      })
    });

    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Create a repo-local artifact bundle",
      urls: ["https://example.com/reference"],
      mode: "path"
    });

    const artifactPath = String(output.artifact_path);

    expectArtifactPath(artifactPath, join(workspaceDir, ".opendevbrowser"), "inspiredesign");
    expect(existsSync(join(artifactPath, "canvas-plan.request.json"))).toBe(false);
    expect(readFileSync(join(artifactPath, "design-agent-handoff.json"), "utf8")).toContain(
		"Unavailable until harvest readiness is ready with authoritative visual, motion, or pin-media evidence."
    );
    expect(readFileSync(join(artifactPath, "design.md"), "utf8")).toMatch(
      /^> \*\*Diagnostic-only artifact\.\*\*/
    );
  });

  it("defaults direct harvest workflow callers to path output and required visual evidence", async () => {
    const outputDir = makeOutputDir();
    let receivedVisualPath = "";
    const runtime = toRuntime({
      fetch: async (input: { url: string }) => makeAggregate({
        records: [
          normalizeRecord("web/default", "web", {
            url: input.url,
            title: "Default harvest reference",
            content: "Full-bleed landing page reference with strong hero imagery."
          })
        ]
      })
    });

    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Design a harvest-backed landing page",
      harvest: true,
      urls: ["https://example.com/default-harvest"],
      outputDir
    }, {
      captureReference: async (_url, options) => {
        if (!options?.visualEvidencePath) {
          throw new Error("visual evidence path missing");
        }
        receivedVisualPath = options.visualEvidencePath;
        writeFileSync(options.visualEvidencePath, Buffer.from("default harvest png"));
        return {
          ...makeCapture("Default harvest reference full-bleed hero"),
          visual: {
            status: "captured",
            kind: "viewport",
            fullPage: false,
            capturedAt: "2026-05-18T00:00:00.000Z",
            tempPath: options.visualEvidencePath,
            warnings: []
          }
        };
      }
    });

    const meta = output.meta as InspiredesignWorkflowMeta;
    const artifactPath = String(output.artifact_path);

    expect(output.mode).toBe("path");
    expect(meta.selection).toEqual(expect.objectContaining({
      visual_evidence: "required",
      capture_mode: "deep"
    }));
    expect(readFileSync(join(artifactPath, "visual-evidence.json"), "utf8")).toContain(
      `"bytes": ${Buffer.from("default harvest png").byteLength}`
    );
    expect(readFileSync(join(artifactPath, "screenshot-index.json"), "utf8")).toContain("visual-evidence/");
    expect(existsSync(receivedVisualPath)).toBe(false);
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
      visualEvidence: "required",
      includePrototypeGuidance: true
    }, {
      captureReference: async (url: string, options) => {
        if (!options?.visualEvidencePath) {
          throw new Error("visual evidence path missing");
        }
        writeFileSync(options.visualEvidencePath, Buffer.from("premium launch visual artifact"));
        return {
          ...makeCapture(`Premium launch surface for Atelier Luma Studio with limestone hero brass CTA rail staggered project index from ${url}`),
          visual: {
            status: "captured",
            kind: "viewport",
            fullPage: false,
            capturedAt: "2026-05-26T00:00:00.000Z",
            tempPath: options.visualEvidencePath,
			sourceUrl: url,
            warnings: []
          },
          attempts: {
          snapshot: { status: "captured" },
          clone: { status: "captured" },
          dom: {
            status: "skipped",
            detail: "DOM capture helper unavailable in this execution lane."
          }
        }
      };
    }
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
      visual_evidence: "required",
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
      capturedVia: ["fetch", "snapshot", "clone", "visual"],
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

  it("finalizes visual screenshot PNG artifacts and serializes metadata without temp paths or base64", async () => {
    const outputDir = makeOutputDir();
    let stagedTempPath = "";
    const runtime = toRuntime({
      fetch: async (input: { url: string }) => makeAggregate({
        records: [
          normalizeRecord("web/default", "web", {
            url: input.url,
            title: "Visual reference",
            content: "Full-bleed hero with cinematic product staging and refined CTA."
          })
        ]
      })
    });

    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Design a visual harvest landing page",
      urls: ["https://example.com/visual"],
      outputDir,
      mode: "path",
      visualEvidence: "required"
    }, {
      captureReference: async (_url, options) => {
        if (!options?.visualEvidencePath) {
          throw new Error("visual evidence path missing");
        }
        stagedTempPath = options.visualEvidencePath;
        writeFileSync(options.visualEvidencePath, Buffer.from("png bytes"));
        return {
          ...makeCapture("Visual reference full-bleed hero cinematic product staging refined CTA"),
          visual: {
            status: "captured",
            kind: "viewport",
            fullPage: false,
            capturedAt: "2026-05-18T00:00:00.000Z",
            tempPath: options.visualEvidencePath,
            warnings: ["cdp fallback"]
          }
        };
      }
    });

    const meta = output.meta as InspiredesignWorkflowMeta;
    const artifactPath = String(output.artifact_path);
    const visualEvidenceJson = readFileSync(join(artifactPath, "visual-evidence.json"), "utf8");
    const screenshotIndexJson = readFileSync(join(artifactPath, "screenshot-index.json"), "utf8");
    const rankedReferencesJson = readFileSync(join(artifactPath, "ranked-references.json"), "utf8");
    const metaPrompt = readFileSync(join(artifactPath, "meta-prompt.md"), "utf8");
    const visualEvidence = JSON.parse(visualEvidenceJson) as {
      visualEvidence: Array<{ visual: { path: string; sha256: string; bytes: number } }>;
    };
    const screenshotIndex = JSON.parse(screenshotIndexJson) as {
      screenshots: Array<{ path: string; sha256: string; bytes: number }>;
    };

    expect(meta.selection).toEqual(expect.objectContaining({
      visual_evidence: "required",
      capture_mode: "deep"
    }));
    expect(meta.artifact_manifest.files).toEqual(expect.arrayContaining([
      "visual-evidence.json",
      "screenshot-index.json",
      "ranked-references.json",
      "meta-prompt.md",
      "visual-evidence/b710f7bd0da7/viewport.png"
    ]));
    expect(visualEvidence.visualEvidence[0]?.visual).toMatchObject({
      path: "visual-evidence/b710f7bd0da7/viewport.png",
      bytes: Buffer.from("png bytes").byteLength
    });
    expect(visualEvidence.visualEvidence[0]?.visual.sha256).toHaveLength(64);
    expect(screenshotIndex.screenshots[0]).toEqual(expect.objectContaining({
      path: "visual-evidence/b710f7bd0da7/viewport.png",
      sha256: visualEvidence.visualEvidence[0]?.visual.sha256,
      bytes: Buffer.from("png bytes").byteLength
    }));
    expect(readFileSync(join(artifactPath, "visual-evidence/b710f7bd0da7/viewport.png"))).toEqual(Buffer.from("png bytes"));
    expect(rankedReferencesJson).toContain("\"rank\": 1");
    expect(metaPrompt).toContain("Rank 1: Visual reference");
    for (const jsonText of [visualEvidenceJson, screenshotIndexJson, rankedReferencesJson]) {
      expect(jsonText).not.toContain(stagedTempPath);
      expect(jsonText).not.toContain("base64");
    }
    expect(existsSync(stagedTempPath)).toBe(false);
  });

  it("captures Pinterest image pin screenshot evidence without deep diagnostics", async () => {
    const outputDir = makeOutputDir();
    const callOrder: string[] = [];
    const cookieSource = {
      type: "inline" as const,
      value: [{ name: "sid", value: "abc", url: "https://www.pinterest.com/pin/27654985208435505/" }]
    };
    const runtime = toRuntime({
      fetch: async (input: { url: string }) => makeAggregate({
        records: [
          normalizeRecord("social/pinterest", "social", {
            url: input.url,
            title: "Pinterest image pin reference",
            content: "Full-bleed editorial image pin with premium product staging",
            attributes: PINTEREST_IMAGE_PIN_ATTRIBUTES
          })
        ]
      })
    });

    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Design a premium Pinterest-inspired product story",
      harvest: true,
      providers: ["social/pinterest"],
      urls: ["https://www.pinterest.com/pin/27654985208435505/"],
      outputDir,
      mode: "path",
      visualEvidence: "required",
      captureMode: "deep",
      cookiePolicyOverride: "required",
      cookieSource
    }, {
      captureVisualEvidence: async (_url, options) => {
        callOrder.push("visual");
        expect(options.cookieSource).toEqual(cookieSource);
        writeFileSync(options.visualEvidencePath, Buffer.alloc(2048, 1));
        return {
          status: "captured",
          kind: "viewport",
          fullPage: false,
          capturedAt: "2026-05-23T00:00:00.000Z",
          sourceUrl: _url,
			pinterestPageQuality: "pin_media",
          tempPath: options.visualEvidencePath,
          warnings: ["workflow_visual_first"]
        };
      },
      captureReference: async () => {
        callOrder.push("deep");
        throw new Error("Deep capture transport timed out before DOM capture");
      }
    });

    const meta = output.meta as InspiredesignWorkflowMeta;
    const artifactPath = String(output.artifact_path);
    const evidence = JSON.parse(readFileSync(join(artifactPath, "evidence.json"), "utf8")) as InspiredesignWorkflowEvidence;
    const visualEvidence = JSON.parse(readFileSync(join(artifactPath, "visual-evidence.json"), "utf8")) as {
      visualEvidence: Array<{ visual: { status: string; path?: string; warnings: string[] } }>;
    };
    const screenshotIndex = JSON.parse(readFileSync(join(artifactPath, "screenshot-index.json"), "utf8")) as {
      screenshots: Array<{ path: string }>;
    };

    expect(callOrder).toEqual(["visual"]);
    expect(output).toEqual(expect.objectContaining({
		ready: false,
      readiness: "ready",
		guidanceReady: true,
		productSuccess: false,
		artifactAuthority: "diagnostic_only",
		evidenceAuthority: "diagnostic_only",
		rankedReferenceCount: 1,
		snapshotReadyReferenceCount: 1,
		pinMediaReadyReferenceCount: 0
    }));
	expect(existsSync(join(artifactPath, "canvas-plan.request.json"))).toBe(false);
    expect(meta.selection).toEqual(expect.objectContaining({
      capture_mode: "off",
      primary_capture_strategy: "visual_first"
    }));
    expect(meta.metrics.captured_references).toBe(1);
    expect(meta.metrics.failed_captures).toBe(0);
    expect(meta.metrics).toEqual(expect.objectContaining({
      attempted_reference_count: 1,
      all_attempt_failed_capture_count: 0,
      all_attempt_missing_screenshot_count: 0,
      all_attempt_visual_failure_count: 0,
      all_attempt_motion_failure_count: 0
    }));
    expect(visualEvidence.visualEvidence[0]?.visual).toEqual(expect.objectContaining({
      status: "captured",
      path: "visual-evidence/b7a5656033e1/viewport.png",
      warnings: ["workflow_visual_first"]
    }));
    expect(screenshotIndex.screenshots[0]?.path).toBe("visual-evidence/b7a5656033e1/viewport.png");
    expect(evidence.referencePatternBoard?.references[0]?.capturedVia).toEqual(expect.arrayContaining([
      "visual",
      "snapshot_ready"
    ]));
    expect(evidence.references[0]).toEqual(expect.objectContaining({
      captureStatus: "captured"
    }));
  });

	it("captures Pinterest pin media before screenshot and emits pin-media artifacts without deep diagnostics", async () => {
	const outputDir = makeOutputDir();
	const callOrder: string[] = [];
	const runtime = toRuntime({
		fetch: async (input: { url: string }) => makeAggregate({
		records: [
			normalizeRecord("social/pinterest", "social", {
			url: input.url,
			title: "Pinterest image pin reference",
			content: "Full-bleed editorial image pin with premium product staging",
			attributes: PINTEREST_IMAGE_PIN_ATTRIBUTES
			})
		]
		})
	});

	const output = await runInspiredesignWorkflow(runtime, {
		brief: "Design a premium Pinterest-inspired product story",
		harvest: true,
		providers: ["social/pinterest"],
		urls: ["https://www.pinterest.com/pin/27654985208435505/"],
		outputDir,
		mode: "path",
		visualEvidence: "required",
		captureMode: "deep"
	}, {
		capturePinMediaEvidence: async (_url, options) => {
		callOrder.push("pinMedia");
		writeFileSync(options.pinMediaEvidencePath, validPinMediaBytes());
		return {
			status: "captured",
			kind: "image",
			capturedAt: "2026-05-23T00:00:00.000Z",
			referenceId: options.referenceId,
			url: _url,
			sourceUrl: _url,
			endedSourceUrl: _url,
			pinterestPageQuality: "pin_media",
			mediaUrl: "https://i.pinimg.com/originals/pin-main-final.jpg",
			candidateSelector: "[data-test-id='closeup-image-main-MainPinImage']",
			width: 1200,
			height: 1600,
			contentType: "image/jpeg",
			tempPath: options.pinMediaEvidencePath,
			warnings: [],
			rejectionReasons: []
		};
		},
		captureVisualEvidence: async (_url, options) => {
		callOrder.push("visual");
		writeFileSync(options.visualEvidencePath, Buffer.alloc(2048, 1));
		return {
			status: "captured",
			kind: "viewport",
			fullPage: false,
			capturedAt: "2026-05-23T00:00:00.000Z",
			sourceUrl: _url,
			pinterestPageQuality: "pin_media",
			tempPath: options.visualEvidencePath,
			warnings: []
		};
		},
		captureReference: async () => {
		callOrder.push("deep");
		throw new Error("Deep capture transport timed out before DOM capture");
		}
	});

	const artifactPath = String(output.artifact_path);
	const pinMediaEvidence = JSON.parse(readFileSync(join(artifactPath, "pin-media-evidence.json"), "utf8")) as {
		pinMediaEvidence: Array<{ pinMedia: { status: string; authority: string; path?: string; sha256?: string; bytes?: number; mediaUrl?: string } }>;
	};
	const pinMediaIndex = JSON.parse(readFileSync(join(artifactPath, "pin-media-index.json"), "utf8")) as {
		pinMediaIndex: Array<{ path: string; kind: string; contentType: string }>;
	};
	const mediaAnalysis = JSON.parse(readFileSync(join(artifactPath, INSPIREDESIGN_HANDOFF_FILES.mediaAnalysis), "utf8")) as {
		references: Array<{ referenceId: string; mediaPath: string; claimLevels: string[] }>;
	};
	const evidence = JSON.parse(readFileSync(join(artifactPath, "evidence.json"), "utf8")) as InspiredesignWorkflowEvidence & {
		pinMediaEvidence?: unknown;
		pinMediaIndex?: unknown;
		mediaAnalysis?: { file: string; referenceCount: number; analyzedReferences: Array<{ mediaPath: string }> };
	};
	const designMarkdown = readFileSync(join(artifactPath, INSPIREDESIGN_HANDOFF_FILES.designMarkdown), "utf8");
	const generationPlanText = readFileSync(join(artifactPath, INSPIREDESIGN_HANDOFF_FILES.generationPlan), "utf8");
	const canvasPlanRequestText = readFileSync(join(artifactPath, "canvas-plan.request.json"), "utf8");
	const canvasPlanRequest = JSON.parse(canvasPlanRequestText) as InspiredesignWorkflowContext["canvasPlanRequest"];
	const designAgentHandoffText = readFileSync(join(artifactPath, INSPIREDESIGN_HANDOFF_FILES.designAgentHandoff), "utf8");
	const meta = output.meta as InspiredesignWorkflowMeta;

	expect(callOrder).toEqual(["pinMedia", "visual"]);
	expect(pinMediaEvidence.pinMediaEvidence[0]?.pinMedia).toEqual(expect.objectContaining({
		status: "captured",
		authority: "design_evidence",
		path: "pin-media-evidence/b7a5656033e1/main.jpg",
		bytes: validPinMediaBytes().length,
		mediaUrl: "https://i.pinimg.com/originals/pin-main-final.jpg"
	}));
	expect(pinMediaEvidence.pinMediaEvidence[0]?.pinMedia.sha256).toMatch(/^[a-f0-9]{64}$/);
	expect(pinMediaIndex.pinMediaIndex[0]).toEqual(expect.objectContaining({
		path: "pin-media-evidence/b7a5656033e1/main.jpg",
		kind: "image",
		contentType: "image/jpeg"
	}));
	expect(readFileSync(join(artifactPath, "pin-media-evidence/b7a5656033e1/main.jpg"))).toEqual(validPinMediaBytes());
	expect(evidence.pinMediaEvidence).toEqual(pinMediaEvidence.pinMediaEvidence);
	expect(evidence.pinMediaIndex).toEqual(pinMediaIndex.pinMediaIndex);
	expect(mediaAnalysis.references[0]).toEqual(expect.objectContaining({
		referenceId: "b7a5656033e1",
		mediaPath: "pin-media-evidence/b7a5656033e1/main.jpg",
		claimLevels: expect.arrayContaining(["metadata_only"])
	}));
	expect(mediaAnalysis.references[0]).not.toHaveProperty("authority");
	expect(mediaAnalysis).not.toHaveProperty("artifactAuthority");
	expect(mediaAnalysis).not.toHaveProperty("evidenceAuthority");
	expect(mediaAnalysis).not.toHaveProperty("productSuccess");
	expect(mediaAnalysis).not.toHaveProperty("diagnosticWarning");
	expect(evidence.mediaAnalysis).toEqual(expect.objectContaining({
		file: INSPIREDESIGN_HANDOFF_FILES.mediaAnalysis,
		referenceCount: 1,
		analyzedReferences: [expect.objectContaining({
			mediaPath: "pin-media-evidence/b7a5656033e1/main.jpg"
		})]
	}));
	expect(designMarkdown).toContain("media observations: media path pin-media-evidence/b7a5656033e1/main.jpg");
	expect(generationPlanText).toContain(INSPIREDESIGN_HANDOFF_FILES.mediaAnalysis);
	expect(hasForbiddenCanvasRequestKey(canvasPlanRequest as JsonValue)).toBe(false);
	expectNoCanvasSourceTextLeakage(canvasPlanRequestText);
	expect(designAgentHandoffText).toContain(INSPIREDESIGN_HANDOFF_FILES.mediaAnalysis);
	expect(evidence.references[0]?.capture).toEqual(expect.objectContaining({
		pinMedia: expect.objectContaining({
		path: "pin-media-evidence/b7a5656033e1/main.jpg",
		authority: "design_evidence"
		})
	}));
	expect(meta.selection.capture_mode).toBe("off");
	expect(meta.artifact_manifest.files).toEqual(expect.arrayContaining([
		"pin-media-evidence.json",
		"pin-media-index.json",
		INSPIREDESIGN_HANDOFF_FILES.mediaAnalysis,
		"pin-media-evidence/b7a5656033e1/main.jpg"
	]));
	});

	it("passes resolved media-analysis binaries into analyzer options without changing authority", async () => {
	const outputDir = makeOutputDir();
	const runtime = toRuntime({
		fetch: async (input: { url: string }) => makeAggregate({
			records: [
				normalizeRecord("social/pinterest", "social", {
					url: input.url,
					title: "Pinterest image pin reference",
					content: "Full-bleed editorial image pin with premium product staging",
					attributes: PINTEREST_IMAGE_PIN_ATTRIBUTES
				})
			]
		})
	});
	const resolveMediaAnalysisBinaries = vi.fn(async (probeOptions?: { timeoutMs?: number }) => {
		expect(probeOptions).toEqual({ timeoutMs: INSPIREDESIGN_MEDIA_ANALYSIS_BINARY_PROBE_TIMEOUT_MS });
		return {
			available: true,
			capabilityTier: "full" as const,
			limitations: [],
			ffmpeg: {
				tool: "ffmpeg" as const,
				available: true,
				source: "config" as const,
				requestedPath: "/fake/ffmpeg",
				resolvedPath: "/fake/ffmpeg",
				version: "ffmpeg version fake",
				capabilityTier: "frame_decode" as const
			},
			ffprobe: {
				tool: "ffprobe" as const,
				available: true,
				source: "config" as const,
				requestedPath: "/fake/ffprobe",
				resolvedPath: "/fake/ffprobe",
				version: "ffprobe version fake",
				capabilityTier: "metadata_probe" as const
			}
		};
	});
	const analyzeMediaArtifacts = vi.fn<NonNullable<InspiredesignWorkflowOptions["analyzeMediaArtifacts"]>>(async (inputs, options) => {
		expect(inputs[0]).toEqual(expect.objectContaining({
			authority: "design_evidence",
			scheduledForBundle: true
		}));
		expect(options).toEqual(expect.objectContaining({
			ffmpegBinaryPath: "/fake/ffmpeg",
			ffprobeBinaryPath: "/fake/ffprobe"
		}));
		return {
			version: 1,
			generatedAt: "2026-05-23T00:00:00.000Z",
			nonGoals: ["media-analysis.json cannot satisfy product readiness."],
			references: []
		};
	});

	const output = await runInspiredesignWorkflow(runtime, {
		brief: "Design a premium Pinterest-inspired product story",
		harvest: true,
		providers: ["social/pinterest"],
		urls: ["https://www.pinterest.com/pin/27654985208435505/"],
		outputDir,
		mode: "path",
		visualEvidence: "off"
	}, {
		resolveMediaAnalysisBinaries,
		capturePinMediaEvidence: async (_url, options) => {
			writeFileSync(options.pinMediaEvidencePath, validPinMediaBytes());
			return {
				status: "captured" as const,
				kind: "image" as const,
				capturedAt: "2026-05-23T00:00:00.000Z",
				referenceId: options.referenceId,
				url: _url,
				sourceUrl: _url,
				endedSourceUrl: _url,
				pinterestPageQuality: "pin_media" as const,
				mediaUrl: "https://i.pinimg.com/originals/pin-main-final.jpg",
				width: 1200,
				height: 1600,
				contentType: "image/jpeg",
				tempPath: options.pinMediaEvidencePath,
				warnings: [],
				rejectionReasons: []
			};
		},
		analyzeMediaArtifacts
	});

	const artifactPath = String(output.artifact_path);
	const mediaAnalysis = JSON.parse(readFileSync(join(artifactPath, INSPIREDESIGN_HANDOFF_FILES.mediaAnalysis), "utf8")) as Record<string, unknown>;
	const evidence = JSON.parse(readFileSync(join(artifactPath, "evidence.json"), "utf8")) as {
		mediaAnalysis?: { savedMediaMotionNotice?: unknown };
	};
	expect(evidence.mediaAnalysis?.savedMediaMotionNotice).toBeUndefined();
	expect(resolveMediaAnalysisBinaries).toHaveBeenCalledOnce();
	expect(analyzeMediaArtifacts).toHaveBeenCalledOnce();
	expect(mediaAnalysis).not.toHaveProperty("artifactAuthority");
		expect(mediaAnalysis).not.toHaveProperty("evidenceAuthority");
		expect(mediaAnalysis).not.toHaveProperty("productSuccess");
		});

		it("skips media analysis non-fatally when binary preflight exhausts the remaining timeout", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-23T00:00:00.000Z"));
		const outputDir = makeOutputDir();
		const analyzeMediaArtifacts = vi.fn();
		const expectedPreflightBudgetMs = 500;
		const resolveMediaAnalysisBinaries = vi.fn(async (probeOptions?: { timeoutMs?: number }) => {
			expect(probeOptions).toEqual({ timeoutMs: expectedPreflightBudgetMs });
			vi.setSystemTime(new Date("2026-05-23T00:00:01.500Z"));
			return {
				available: true,
				capabilityTier: "full" as const,
				limitations: [],
				ffmpeg: {
					tool: "ffmpeg" as const,
					available: true,
					source: "path" as const,
					requestedPath: "ffmpeg",
					resolvedPath: "ffmpeg",
					version: "ffmpeg version fake",
					capabilityTier: "frame_decode" as const
				},
				ffprobe: {
					tool: "ffprobe" as const,
					available: true,
					source: "path" as const,
					requestedPath: "ffprobe",
					resolvedPath: "ffprobe",
					version: "ffprobe version fake",
					capabilityTier: "metadata_probe" as const
				}
			};
		});
		const runtime = toRuntime({
			fetch: async (input: { url: string }) => makeAggregate({
				records: [
					normalizeRecord("social/pinterest", "social", {
						url: input.url,
						title: "Pinterest image pin reference",
						content: "Full-bleed editorial image pin with premium product staging",
						attributes: PINTEREST_IMAGE_PIN_ATTRIBUTES
					})
				]
			})
		});
		try {
			const output = await runInspiredesignWorkflow(runtime, {
				brief: "Design a premium Pinterest-inspired product story",
				harvest: true,
				providers: ["social/pinterest"],
				urls: ["https://www.pinterest.com/pin/27654985208435505/"],
				outputDir,
				mode: "path",
				visualEvidence: "off",
				timeoutMs: 1000
			}, {
				resolveMediaAnalysisBinaries,
				capturePinMediaEvidence: async (_url, options) => {
					writeFileSync(options.pinMediaEvidencePath, validPinMediaBytes());
					vi.setSystemTime(new Date("2026-05-23T00:00:00.500Z"));
					return {
						status: "captured",
						kind: "image",
						capturedAt: "2026-05-23T00:00:00.500Z",
						referenceId: options.referenceId,
						url: _url,
						sourceUrl: _url,
						endedSourceUrl: _url,
						pinterestPageQuality: "pin_media",
						mediaUrl: "https://i.pinimg.com/originals/pin-main-final.jpg",
						width: 1200,
						height: 1600,
						contentType: "image/jpeg",
						tempPath: options.pinMediaEvidencePath,
						warnings: [],
						rejectionReasons: []
					};
				},
				analyzeMediaArtifacts
			});
			const artifactPath = String(output.artifact_path);
			const mediaAnalysis = JSON.parse(readFileSync(join(artifactPath, INSPIREDESIGN_HANDOFF_FILES.mediaAnalysis), "utf8")) as {
				references: unknown[];
			};
			expect(resolveMediaAnalysisBinaries).toHaveBeenCalledOnce();
			expect(analyzeMediaArtifacts).not.toHaveBeenCalled();
			expect(mediaAnalysis).toEqual(expect.objectContaining({ references: [] }));
			expect(mediaAnalysis).not.toHaveProperty("artifactAuthority");
			expect(mediaAnalysis).not.toHaveProperty("evidenceAuthority");
			expect(mediaAnalysis).not.toHaveProperty("productSuccess");
			expect(output.meta).toEqual(expect.objectContaining({
				mediaAnalysisFailure: "Pinterest pin media analysis deadline was exhausted."
			}));
		} finally {
			vi.useRealTimers();
		}
		});

		it("writes media analysis sources with fresh safe paths and remaining timeout", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-23T00:00:00.000Z"));
	const outputDir = makeOutputDir();
	const escapeRoot = mkdtempSync(join(tmpdir(), "inspiredesign-analysis-escape-"));
	tempDirs.push(escapeRoot);
	const escapeTarget = join(escapeRoot, "escape-target");
	writeFileSync(escapeTarget, "outside");
	let predictablePath: string | undefined;
	let analysisSourcePath: string | undefined;
	const runtime = toRuntime({
		fetch: async (input: { url: string }) => makeAggregate({
			records: [
				normalizeRecord("social/pinterest", "social", {
					url: input.url,
					title: "Pinterest image pin reference",
					content: "Full-bleed editorial image pin with premium product staging",
					attributes: PINTEREST_IMAGE_PIN_ATTRIBUTES
				})
			]
		})
	});

	try {
		const output = await runInspiredesignWorkflow(runtime, {
			brief: "Design a premium Pinterest-inspired product story",
			harvest: true,
			providers: ["social/pinterest"],
			urls: ["https://www.pinterest.com/pin/27654985208435505/"],
			outputDir,
			mode: "path",
			visualEvidence: "off",
			timeoutMs: 10000
		}, {
			capturePinMediaEvidence: async (_url, options) => {
				writeFileSync(options.pinMediaEvidencePath, validPinMediaBytes());
				predictablePath = join(dirname(options.pinMediaEvidencePath), `${options.referenceId}-media-analysis-source`);
				symlinkSync(escapeTarget, predictablePath);
				vi.setSystemTime(new Date("2026-05-23T00:00:09.400Z"));
				return {
					status: "captured",
					kind: "image",
					capturedAt: "2026-05-23T00:00:09.400Z",
					referenceId: options.referenceId,
					url: _url,
					sourceUrl: _url,
					endedSourceUrl: _url,
					pinterestPageQuality: "pin_media",
					mediaUrl: "https://i.pinimg.com/originals/pin-main-final.jpg",
					width: 1200,
					height: 1600,
					contentType: "image/jpeg",
					tempPath: options.pinMediaEvidencePath,
					warnings: [],
					rejectionReasons: []
				};
			},
			analyzeMediaArtifacts: async (inputs, options) => {
				expect(options?.timeoutMs).toBe(600);
				const sourcePath = inputs[0]?.filePath;
				if (!sourcePath) throw new Error("Expected media-analysis source input.");
				analysisSourcePath = sourcePath;
				expect(sourcePath).not.toBe(predictablePath);
				expect(dirname(sourcePath)).not.toBe(dirname(predictablePath ?? ""));
				expect(lstatSync(sourcePath).isSymbolicLink()).toBe(false);
				expect(lstatSync(dirname(sourcePath)).isDirectory()).toBe(true);
				expect(readFileSync(sourcePath)).toEqual(validPinMediaBytes());
				return {
					version: 1,
					generatedAt: "2026-05-23T00:00:09.400Z",
					nonGoals: [],
					references: []
				};
			}
		});

		expect(output.artifact_path).toEqual(expect.any(String));
		expect(readFileSync(escapeTarget, "utf8")).toBe("outside");
		if (!analysisSourcePath) throw new Error("Expected media-analysis source path.");
		expect(existsSync(dirname(analysisSourcePath))).toBe(false);
	} finally {
		vi.useRealTimers();
	}
	});

	it("stops media analysis temp writes when the remaining workflow timeout is exhausted", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-05-23T00:00:00.000Z"));
	const outputDir = makeOutputDir();
	const analyzeMediaArtifacts = vi.fn();
	const runtime = toRuntime({
		fetch: async (input: { url: string }) => makeAggregate({
			records: [
				normalizeRecord("social/pinterest", "social", {
					url: input.url,
					title: "Pinterest image pin reference",
					content: "Full-bleed editorial image pin with premium product staging",
					attributes: PINTEREST_IMAGE_PIN_ATTRIBUTES
				})
			]
		})
	});

	try {
		const output = await runInspiredesignWorkflow(runtime, {
			brief: "Design a premium Pinterest-inspired product story",
			harvest: true,
			providers: ["social/pinterest"],
			urls: ["https://www.pinterest.com/pin/27654985208435505/"],
			outputDir,
			mode: "path",
			visualEvidence: "off",
			timeoutMs: 1000
		}, {
			capturePinMediaEvidence: async (_url, options) => {
				writeFileSync(options.pinMediaEvidencePath, validPinMediaBytes());
				vi.setSystemTime(new Date("2026-05-23T00:00:01.500Z"));
				return {
					status: "captured",
					kind: "image",
					capturedAt: "2026-05-23T00:00:01.500Z",
					referenceId: options.referenceId,
					url: _url,
					sourceUrl: _url,
					endedSourceUrl: _url,
					pinterestPageQuality: "pin_media",
					mediaUrl: "https://i.pinimg.com/originals/pin-main-final.jpg",
					width: 1200,
					height: 1600,
					contentType: "image/jpeg",
					tempPath: options.pinMediaEvidencePath,
					warnings: [],
					rejectionReasons: []
				};
			},
			analyzeMediaArtifacts
		});
		const artifactPath = String(output.artifact_path);
		const mediaAnalysis = JSON.parse(readFileSync(join(artifactPath, INSPIREDESIGN_HANDOFF_FILES.mediaAnalysis), "utf8")) as {
			references: unknown[];
		};
		expect(analyzeMediaArtifacts).not.toHaveBeenCalled();
		expect(mediaAnalysis).toEqual(expect.objectContaining({ references: [] }));
		expect(mediaAnalysis).not.toHaveProperty("artifactAuthority");
		expect(mediaAnalysis).not.toHaveProperty("evidenceAuthority");
		expect(mediaAnalysis).not.toHaveProperty("productSuccess");
		expect(mediaAnalysis).not.toHaveProperty("diagnosticWarning");
		expect(output.meta).toEqual(expect.objectContaining({
			mediaAnalysisFailure: "Pinterest pin media analysis temp write deadline was exhausted."
		}));
	} finally {
		vi.useRealTimers();
	}
	});

	it("cleans media analysis source temp dirs when analyzer fails", async () => {
	const outputDir = makeOutputDir();
	let analysisSourcePath: string | undefined;
	const runtime = toRuntime({
		fetch: async (input: { url: string }) => makeAggregate({
			records: [
				normalizeRecord("social/pinterest", "social", {
					url: input.url,
					title: "Pinterest image pin reference",
					content: "Full-bleed editorial image pin with premium product staging",
					attributes: PINTEREST_IMAGE_PIN_ATTRIBUTES
				})
			]
		})
	});

	const output = await runInspiredesignWorkflow(runtime, {
		brief: "Design a premium Pinterest-inspired product story",
		harvest: true,
		providers: ["social/pinterest"],
		urls: ["https://www.pinterest.com/pin/27654985208435505/"],
		outputDir,
		mode: "path",
		visualEvidence: "off"
	}, {
		capturePinMediaEvidence: async (_url, options) => {
			writeFileSync(options.pinMediaEvidencePath, validPinMediaBytes());
			return {
				status: "captured",
				kind: "image",
				capturedAt: "2026-05-23T00:00:00.000Z",
				referenceId: options.referenceId,
				url: _url,
				sourceUrl: _url,
				endedSourceUrl: _url,
				pinterestPageQuality: "pin_media",
				mediaUrl: "https://i.pinimg.com/originals/pin-main-final.jpg",
				width: 1200,
				height: 1600,
				contentType: "image/jpeg",
				tempPath: options.pinMediaEvidencePath,
				warnings: [],
				rejectionReasons: []
			};
		},
		analyzeMediaArtifacts: async (inputs) => {
			const sourcePath = inputs[0]?.filePath;
			if (!sourcePath) throw new Error("Expected media-analysis source input.");
			analysisSourcePath = sourcePath;
			expect(existsSync(dirname(sourcePath))).toBe(true);
			throw new Error("analysis failed");
		}
	});

	if (!analysisSourcePath) throw new Error("Expected media-analysis source path.");
	expect(existsSync(dirname(analysisSourcePath))).toBe(false);
	const artifactPath = String(output.artifact_path);
	const mediaAnalysis = JSON.parse(readFileSync(join(artifactPath, INSPIREDESIGN_HANDOFF_FILES.mediaAnalysis), "utf8")) as {
		references: unknown[];
	};
	expect(mediaAnalysis).toEqual(expect.objectContaining({ references: [] }));
	expect(mediaAnalysis).not.toHaveProperty("artifactAuthority");
	expect(mediaAnalysis).not.toHaveProperty("evidenceAuthority");
	expect(mediaAnalysis).not.toHaveProperty("productSuccess");
	expect(mediaAnalysis).not.toHaveProperty("diagnosticWarning");
	expect(output.meta).toEqual(expect.objectContaining({
		mediaAnalysisFailure: "analysis failed"
	}));
	});

	it("emits product-ready Pinterest video pin media from actual video bytes", async () => {
	const runtime = toRuntime({
		fetch: async (input: { url: string }) => makeAggregate({
		records: [
			normalizeRecord("social/pinterest", "social", {
			url: input.url,
			title: "Pinterest video pin reference",
			content: "Cinematic studio reel pin with motion-led photography direction",
			attributes: PINTEREST_VIDEO_PIN_ATTRIBUTES
			})
		]
		})
	});

	const output = await runInspiredesignWorkflow(runtime, {
		brief: "Design a cinematic Pinterest-inspired photography studio story",
		harvest: true,
		providers: ["social/pinterest"],
		urls: ["https://www.pinterest.com/pin/27654985208435505/"],
		outputDir: makeOutputDir(),
		mode: "path",
		visualEvidence: "required",
		captureMode: "deep"
	}, {
		capturePinMediaEvidence: async (_url, options) => {
		writeFileSync(options.pinMediaEvidencePath, validPinMediaVideoBytes());
		return {
			status: "captured" as const,
			kind: "video" as const,
			capturedAt: "2026-05-23T00:00:00.000Z",
			referenceId: options.referenceId,
			url: _url,
			sourceUrl: _url,
			endedSourceUrl: _url,
			pinterestPageQuality: "pin_media" as const,
			mediaUrl: "https://v.pinimg.com/videos/mc/720p/pin-main-final.mp4",
			candidateSelector: "video",
				width: LIVE_PIN_MEDIA_VIDEO_WIDTH,
				height: LIVE_PIN_MEDIA_VIDEO_HEIGHT,
			contentType: "video/mp4",
			tempPath: options.pinMediaEvidencePath,
			warnings: ["interface_chrome_shell"],
			rejectionReasons: []
		};
		},
		captureVisualEvidence: async () => ({
		status: "skipped",
		kind: "viewport",
		fullPage: false,
		capturedAt: "2026-05-23T00:00:00.000Z",
		warnings: ["primary_visual_capture_unavailable"],
		failure: "Primary visual evidence capture unavailable."
		}),
		captureReference: async () => {
		throw new Error("Deep capture transport timed out before DOM capture");
		},
		analyzeMediaArtifacts: async (inputs) => {
		const input = inputs[0];
		if (!input || !input.width || !input.height) throw new Error("Expected trusted video media-analysis input.");
		return {
			version: 1,
			generatedAt: "2026-05-23T00:00:09.400Z",
			nonGoals: ["Readable exact text extraction is not part of v1."],
			references: [{
			referenceId: input.referenceId,
			mediaPath: input.mediaPath,
			sourceUrl: input.sourceUrl,
			mediaUrl: input.mediaUrl,
			kind: input.kind,
			contentType: input.contentType,
			bytes: input.bytes,
			hash: input.hash,
			dimensions: { width: input.width, height: input.height, aspectRatio: input.width / input.height },
			authority: "design_evidence",
			claimLevels: ["metadata_only", "motion_sampled"],
			facts: {
				metadata: {
				dimensions: { width: input.width, height: input.height, aspectRatio: input.width / input.height },
				durationSeconds: 16.6,
				fps: 60,
				frameCount: 996,
				videoCodec: "h264",
				audioCodec: "aac",
				hasAudio: true,
				containerFormat: "mov,mp4,m4a,3gp,3g2,mj2"
				},
				dimensions: { width: input.width, height: input.height, aspectRatio: input.width / input.height },
				motion: {
				sampledFrameCount: 2,
				sampledFrameIndexes: [0, 1],
				frameDeltas: [0.21],
				averageFrameDelta: 0.21,
				cadence: "moderate",
				posture: "subtle_motion",
				frameToneSummaries: [],
				motionSignature: {
					version: 1,
					sampleBasis: "decoded_rgb_frames",
					motionFamily: "dynamic_motion",
					peakFrameDelta: 0.21,
					averageFrameDelta: 0.21,
					deltaVariance: 0,
					toneShift: 0.18,
					dominantChangedRegions: [],
					confidence: 0.66
				}
				}
			},
			designGuidance: {
				visualStrengths: ["Trusted MP4 media analysis preserved byte-backed video dimensions."],
				visualRisks: ["Readable exact text extraction was not performed, so exact copy strings are unavailable."],
				layoutRecipe: "cinematic vertical hero with motion-led studio pacing.",
				contentHierarchy: ["motion-first hero headline candidate"],
				componentFamilies: ["hero", "showreel panel"],
				motionPosture: "Use sampled MP4 cadence for restrained scroll reveals and hero pacing.",
					tokenNotes: ["Treat the compact 240 by 180 frame as the dominant media ratio."],
				patternsToBorrow: ["Borrow the vertical motion frame as a hero composition source."],
				patternsToReject: ["Do not invent readable text from the video."],
				typographyPosture: "Use OCR-free hierarchy only.",
				imageryPosture: "Lead with vertical cinematic studio imagery.",
				confidence: 0.82
			},
			confidence: 0.82,
			limitations: ["Readable exact text extraction was not performed, so exact copy strings are unavailable."]
			}]
		};
		}
	});

	const artifactPath = String(output.artifact_path);
	const pinMediaEvidence = JSON.parse(readFileSync(join(artifactPath, "pin-media-evidence.json"), "utf8")) as {
		pinMediaEvidence: Array<{ pinMedia: { authority: string; path?: string; rejectionReasons: string[]; warnings: string[] } }>;
	};
	const pinMediaIndex = JSON.parse(readFileSync(join(artifactPath, "pin-media-index.json"), "utf8")) as {
		pinMediaIndex: Array<{ path: string; kind: string; contentType: string; mediaUrl: string; warnings: string[] }>;
	};
	const evidence = JSON.parse(readFileSync(join(artifactPath, "evidence.json"), "utf8")) as {
		mediaAnalysis?: { savedMediaMotionNotice?: { kind: string; sampledMotionCount: number; mediaPaths: string[]; message: string } };
	};
	const mediaAnalysis = JSON.parse(readFileSync(join(artifactPath, "media-analysis.json"), "utf8")) as {
		references: Array<{ facts: { motion?: { motionSignature?: { motionFamily: string } } } }>;
	};

	expect(output).toEqual(expect.objectContaining({
		productSuccess: true,
		artifactAuthority: "product_ready",
		evidenceAuthority: "pin_media_ready"
	}));
	expect(pinMediaEvidence.pinMediaEvidence[0]?.pinMedia).toEqual(expect.objectContaining({
		authority: "design_evidence",
		path: "pin-media-evidence/b7a5656033e1/video.mp4",
		warnings: ["interface_chrome_shell"]
	}));
	expect(pinMediaEvidence.pinMediaEvidence[0]?.pinMedia.rejectionReasons).not.toContain("blocking_warning");
	expect(pinMediaEvidence.pinMediaEvidence[0]?.pinMedia.rejectionReasons).not.toContain("missing_trusted_byte_inspection");
	expect(pinMediaIndex.pinMediaIndex[0]).toEqual(expect.objectContaining({
		path: "pin-media-evidence/b7a5656033e1/video.mp4",
		kind: "video",
		contentType: "video/mp4",
		mediaUrl: "https://v.pinimg.com/videos/mc/720p/pin-main-final.mp4",
		warnings: ["interface_chrome_shell"]
	}));
	expect(readFileSync(join(artifactPath, "pin-media-evidence/b7a5656033e1/video.mp4"))).toEqual(validPinMediaVideoBytes());
	expect(mediaAnalysis.references[0]?.facts.motion?.motionSignature?.motionFamily).toBe("dynamic_motion");
	expect(evidence.mediaAnalysis?.savedMediaMotionNotice).toEqual({
		kind: "saved_media_motion_without_browser_replay",
		sampledMotionCount: 1,
		mediaPaths: ["pin-media-evidence/b7a5656033e1/video.mp4"],
		message: "Saved GIF or video media was sampled in media-analysis.json, but no authoritative browser replay screencast was captured in motion-evidence.json."
	});
	expect(JSON.stringify(evidence.mediaAnalysis?.savedMediaMotionNotice)).not.toContain("product_ready");
	});

	it("keeps trusted Pinterest pin media authoritative when page chrome reports login state", async () => {
	const runtime = toRuntime({
		fetch: async (input: { url: string }) => makeAggregate({
		records: [
			normalizeRecord("social/pinterest", "social", {
			url: input.url,
			title: "Pinterest image pin reference",
			content: "Full-bleed editorial image pin with premium product staging",
			attributes: PINTEREST_IMAGE_PIN_ATTRIBUTES
			})
		]
		})
	});

	const output = await runInspiredesignWorkflow(runtime, {
		brief: "Design a premium Pinterest-inspired product story",
		harvest: true,
		providers: ["social/pinterest"],
		urls: ["https://www.pinterest.com/pin/27654985208435505/"],
		outputDir: makeOutputDir(),
		mode: "path",
		visualEvidence: "required",
		captureMode: "deep"
	}, {
		capturePinMediaEvidence: async (_url, options) => {
		writeFileSync(options.pinMediaEvidencePath, validPinMediaBytes());
		return {
			status: "captured" as const,
			kind: "image" as const,
			capturedAt: "2026-05-23T00:00:00.000Z",
			referenceId: options.referenceId,
			url: _url,
			sourceUrl: _url,
			endedSourceUrl: _url,
			pinterestPageQuality: "pin_media" as const,
			mediaUrl: "https://i.pinimg.com/originals/pin-main-final.jpg",
			candidateSelector: "[data-test-id='closeup-image-main-MainPinImage']",
			width: 1200,
			height: 1600,
			contentType: "image/jpeg",
			tempPath: options.pinMediaEvidencePath,
			warnings: ["login_or_challenge_state"],
			rejectionReasons: []
		};
		},
		captureVisualEvidence: async () => ({
		status: "skipped",
		kind: "viewport",
		fullPage: false,
		capturedAt: "2026-05-23T00:00:00.000Z",
		warnings: ["primary_visual_capture_unavailable"],
		failure: "Primary visual evidence capture unavailable."
		}),
		captureReference: async () => {
		throw new Error("Deep capture transport timed out before DOM capture");
		}
	});

	const artifactPath = String(output.artifact_path);
	const pinMediaEvidence = JSON.parse(readFileSync(join(artifactPath, "pin-media-evidence.json"), "utf8")) as {
		pinMediaEvidence: Array<{ pinMedia: { authority: string; path?: string; rejectionReasons: string[] } }>;
	};
	const pinMediaIndex = JSON.parse(readFileSync(join(artifactPath, "pin-media-index.json"), "utf8")) as {
		pinMediaIndex: Array<{ path: string; kind: string; contentType: string }>;
	};
	const meta = output.meta as InspiredesignWorkflowMeta;

	expect(output).toEqual(expect.objectContaining({
		productSuccess: true,
		artifactAuthority: "product_ready",
		evidenceAuthority: "pin_media_ready"
	}));
	expect(pinMediaEvidence.pinMediaEvidence[0]?.pinMedia).toEqual(expect.objectContaining({
		authority: "design_evidence",
		path: "pin-media-evidence/b7a5656033e1/main.jpg"
	}));
	expect(pinMediaEvidence.pinMediaEvidence[0]?.pinMedia.rejectionReasons).not.toContain("blocking_warning");
	expect(pinMediaEvidence.pinMediaEvidence[0]?.pinMedia.rejectionReasons).not.toContain("missing_trusted_byte_inspection");
	expect(pinMediaIndex.pinMediaIndex[0]).toEqual(expect.objectContaining({
		path: "pin-media-evidence/b7a5656033e1/main.jpg",
		kind: "image",
		contentType: "image/jpeg"
	}));
	expect(readFileSync(join(artifactPath, "pin-media-evidence/b7a5656033e1/main.jpg"))).toEqual(validPinMediaBytes());
	expect(meta.artifact_manifest.files).toEqual(expect.arrayContaining([
		"pin-media-evidence/b7a5656033e1/main.jpg"
	]));
	});

	it("keeps trusted Pinterest pin media authoritative when page chrome reports interface shell", async () => {
	const runtime = toRuntime({
		fetch: async (input: { url: string }) => makeAggregate({
		records: [
			normalizeRecord("social/pinterest", "social", {
			url: input.url,
			title: "Pinterest image pin reference",
			content: "Full-bleed editorial image pin with premium product staging",
			attributes: PINTEREST_IMAGE_PIN_ATTRIBUTES
			})
		]
		})
	});

	const output = await runInspiredesignWorkflow(runtime, {
		brief: "Design a premium Pinterest-inspired product story",
		harvest: true,
		providers: ["social/pinterest"],
		urls: ["https://www.pinterest.com/pin/27654985208435505/"],
		outputDir: makeOutputDir(),
		mode: "path",
		visualEvidence: "required",
		captureMode: "deep"
	}, {
		capturePinMediaEvidence: async (_url, options) => {
		writeFileSync(options.pinMediaEvidencePath, validPinMediaBytes());
		return {
			status: "captured" as const,
			kind: "image" as const,
			capturedAt: "2026-05-23T00:00:00.000Z",
			referenceId: options.referenceId,
			url: _url,
			sourceUrl: _url,
			endedSourceUrl: _url,
			pinterestPageQuality: "pin_media" as const,
			mediaUrl: "https://i.pinimg.com/originals/pin-main-final.jpg",
			candidateSelector: "[data-test-id='closeup-image-main-MainPinImage']",
			width: 1200,
			height: 1600,
			contentType: "image/jpeg",
			tempPath: options.pinMediaEvidencePath,
			warnings: ["interface_chrome_shell"],
			rejectionReasons: []
		};
		},
		captureVisualEvidence: async () => ({
		status: "skipped",
		kind: "viewport",
		fullPage: false,
		capturedAt: "2026-05-23T00:00:00.000Z",
		warnings: ["primary_visual_capture_unavailable"],
		failure: "Primary visual evidence capture unavailable."
		}),
		captureReference: async () => {
		throw new Error("Deep capture transport timed out before DOM capture");
		}
	});

	const artifactPath = String(output.artifact_path);
	const pinMediaEvidence = JSON.parse(readFileSync(join(artifactPath, "pin-media-evidence.json"), "utf8")) as {
		pinMediaEvidence: Array<{ pinMedia: { authority: string; path?: string; rejectionReasons: string[]; warnings: string[] } }>;
	};
	const pinMediaIndex = JSON.parse(readFileSync(join(artifactPath, "pin-media-index.json"), "utf8")) as {
		pinMediaIndex: Array<{ path: string; kind: string; contentType: string; warnings: string[] }>;
	};

	expect(output).toEqual(expect.objectContaining({
		productSuccess: true,
		artifactAuthority: "product_ready",
		evidenceAuthority: "pin_media_ready"
	}));
	expect(pinMediaEvidence.pinMediaEvidence[0]?.pinMedia).toEqual(expect.objectContaining({
		authority: "design_evidence",
		path: "pin-media-evidence/b7a5656033e1/main.jpg",
		warnings: ["interface_chrome_shell"]
	}));
	expect(pinMediaEvidence.pinMediaEvidence[0]?.pinMedia.rejectionReasons).not.toContain("blocking_warning");
	expect(pinMediaEvidence.pinMediaEvidence[0]?.pinMedia.rejectionReasons).not.toContain("missing_trusted_byte_inspection");
	expect(pinMediaIndex.pinMediaIndex[0]).toEqual(expect.objectContaining({
		path: "pin-media-evidence/b7a5656033e1/main.jpg",
		kind: "image",
		contentType: "image/jpeg",
		warnings: ["interface_chrome_shell"]
	}));
	expect(readFileSync(join(artifactPath, "pin-media-evidence/b7a5656033e1/main.jpg"))).toEqual(validPinMediaBytes());
	});

	it("lets manifest-backed pin media satisfy required visual evidence when screenshot capture is unavailable", async () => {
	const runtime = toRuntime({
		fetch: async (input: { url: string }) => makeAggregate({
		records: [
			normalizeRecord("social/pinterest", "social", {
			url: input.url,
			title: "Pinterest image pin reference",
			content: "Full-bleed editorial image pin with premium product staging",
			attributes: PINTEREST_IMAGE_PIN_ATTRIBUTES
			})
		]
		})
	});

	const output = await runInspiredesignWorkflow(runtime, {
		brief: "Design a premium Pinterest-inspired product story",
		harvest: true,
		providers: ["social/pinterest"],
		urls: ["https://www.pinterest.com/pin/27654985208435505/"],
		outputDir: makeOutputDir(),
		mode: "path",
		visualEvidence: "required",
		captureMode: "deep"
	}, {
		capturePinMediaEvidence: async (_url, options) => {
		writeFileSync(options.pinMediaEvidencePath, validPinMediaBytes());
		return {
			status: "captured" as const,
			kind: "image" as const,
			capturedAt: "2026-05-23T00:00:00.000Z",
			referenceId: options.referenceId,
			url: _url,
			sourceUrl: _url,
			endedSourceUrl: _url,
			pinterestPageQuality: "pin_media" as const,
			mediaUrl: "https://i.pinimg.com/originals/pin-main-final.jpg",
			candidateSelector: "[data-test-id='closeup-image-main-MainPinImage']",
			width: 1200,
			height: 1600,
			contentType: "image/jpeg",
			tempPath: options.pinMediaEvidencePath,
			warnings: [],
			rejectionReasons: []
		};
		},
		captureVisualEvidence: async () => ({
		status: "skipped",
		kind: "viewport",
		fullPage: false,
		capturedAt: "2026-05-23T00:00:00.000Z",
		warnings: ["primary_visual_capture_unavailable"],
		failure: "Primary visual evidence capture unavailable."
		})
	});

	const artifactPath = String(output.artifact_path);
	const evidenceText = readFileSync(join(artifactPath, "evidence.json"), "utf8");
	const visualEvidencePath = join(artifactPath, "visual-evidence.json");
	expect(output).toEqual(expect.objectContaining({
		productSuccess: true,
		artifactAuthority: "product_ready",
		evidenceAuthority: "pin_media_ready"
	}));
	expect(evidenceText).not.toContain("Required visual evidence was not captured.");
	expect(evidenceText).not.toContain("required_visual_evidence_missing");
	if (existsSync(visualEvidencePath)) {
		const visualEvidenceText = readFileSync(visualEvidencePath, "utf8");
		expect(visualEvidenceText).not.toContain("required_visual_evidence_missing");
	}
	expect(existsSync(join(artifactPath, "canvas-plan.request.json"))).toBe(true);
	});

	it("records required visual failure when rejected pin media is paired with a skipped visual placeholder", async () => {
	const runtime = toRuntime({
		fetch: async (input: { url: string }) => makeAggregate({
		records: [
			normalizeRecord("social/pinterest", "social", {
			url: input.url,
			title: "Pinterest image pin reference",
			content: "Full-bleed editorial image pin with premium product staging",
			attributes: PINTEREST_IMAGE_PIN_ATTRIBUTES
			})
		]
		})
	});

	const output = await runInspiredesignWorkflow(runtime, {
		brief: "Design a premium Pinterest-inspired product story",
		harvest: true,
		providers: ["social/pinterest"],
		urls: ["https://www.pinterest.com/pin/27654985208435505/"],
		outputDir: makeOutputDir(),
		mode: "path",
		visualEvidence: "required",
		captureMode: "deep"
	}, {
		capturePinMediaEvidence: async (_url, options) => {
		writeFileSync(options.pinMediaEvidencePath, validPinMediaBytes());
		return {
			status: "captured" as const,
			kind: "image" as const,
			capturedAt: "2026-05-23T00:00:00.000Z",
			referenceId: options.referenceId,
			url: _url,
			sourceUrl: _url,
			endedSourceUrl: _url,
			pinterestPageQuality: "pin_media" as const,
			mediaUrl: "https://i.pinimg.com/originals/pin-main-final.jpg",
			candidateSelector: "[data-test-id='closeup-image-main-MainPinImage']",
			width: 1200,
			height: 1600,
			contentType: "image/jpeg",
			tempPath: options.pinMediaEvidencePath,
			warnings: [],
			rejectionReasons: ["candidate_not_main_pin_media"]
		};
		},
		captureVisualEvidence: async () => ({
		status: "skipped",
		kind: "viewport",
		fullPage: false,
		capturedAt: "2026-05-23T00:00:00.000Z",
		warnings: ["primary_visual_capture_unavailable"],
		failure: "Primary visual evidence capture unavailable."
		})
	});

	const artifactPath = String(output.artifact_path);
	const evidenceText = readFileSync(join(artifactPath, "evidence.json"), "utf8");
	const visualEvidenceText = readFileSync(join(artifactPath, "visual-evidence.json"), "utf8");
	const pinMediaEvidence = JSON.parse(readFileSync(join(artifactPath, "pin-media-evidence.json"), "utf8")) as {
		pinMediaEvidence: Array<{ pinMedia: { authority: string; rejectionReasons: string[] } }>;
	};
	expect(output).toEqual(expect.objectContaining({
		productSuccess: false,
		artifactAuthority: "diagnostic_only"
	}));
	expect(evidenceText).toContain("required_visual_evidence_missing");
	expect(visualEvidenceText).toContain("required_visual_evidence_missing");
	expect(pinMediaEvidence.pinMediaEvidence[0]?.pinMedia).toEqual(expect.objectContaining({
		authority: "diagnostic",
		rejectionReasons: expect.arrayContaining(["candidate_not_main_pin_media"])
	}));
	expect(existsSync(join(artifactPath, "canvas-plan.request.json"))).toBe(false);
	});

	it("records required visual failure when provisional pin media fails finalization", async () => {
	const runtime = toRuntime({
		fetch: async (input: { url: string }) => makeAggregate({
		records: [
			normalizeRecord("social/pinterest", "social", {
			url: input.url,
			title: "Pinterest image pin reference",
			content: "Full-bleed editorial image pin with premium product staging",
			attributes: PINTEREST_IMAGE_PIN_ATTRIBUTES
			})
		]
		})
	});

	const output = await runInspiredesignWorkflow(runtime, {
		brief: "Design a premium Pinterest-inspired product story",
		harvest: true,
		providers: ["social/pinterest"],
		urls: ["https://www.pinterest.com/pin/27654985208435505/"],
		outputDir: makeOutputDir(),
		mode: "path",
		visualEvidence: "required",
		captureMode: "deep"
	}, {
		capturePinMediaEvidence: async (_url, options) => {
		writeFileSync(options.pinMediaEvidencePath, validPinMediaBytes());
		return {
			status: "captured" as const,
			kind: "image" as const,
			capturedAt: "2026-05-23T00:00:00.000Z",
			referenceId: options.referenceId,
			url: _url,
			sourceUrl: _url,
			endedSourceUrl: _url,
			pinterestPageQuality: "pin_media" as const,
			mediaUrl: "https://i.pinimg.com/originals/pin-main-final.jpg",
			candidateSelector: "[data-test-id='closeup-image-main-MainPinImage']",
			width: 1200,
			height: 1600,
			contentType: "image/jpeg",
			tempPath: join(dirname(options.pinMediaEvidencePath), "wrong-pin-media"),
			warnings: [],
			rejectionReasons: []
		};
		},
		captureVisualEvidence: async () => ({
		status: "skipped",
		kind: "viewport",
		fullPage: false,
		capturedAt: "2026-05-23T00:00:00.000Z",
		warnings: ["primary_visual_capture_unavailable"],
		failure: "Primary visual evidence capture unavailable."
		})
	});

	const artifactPath = String(output.artifact_path);
	const evidenceText = readFileSync(join(artifactPath, "evidence.json"), "utf8");
	const visualEvidenceText = readFileSync(join(artifactPath, "visual-evidence.json"), "utf8");
	const pinMediaEvidence = JSON.parse(readFileSync(join(artifactPath, "pin-media-evidence.json"), "utf8")) as {
		pinMediaEvidence: Array<{ pinMedia: { authority: string; rejectionReasons: string[]; path?: string } }>;
	};
	const pinMediaIndex = JSON.parse(readFileSync(join(artifactPath, "pin-media-index.json"), "utf8")) as {
		pinMediaIndex: unknown[];
	};

	expect(output).toEqual(expect.objectContaining({
		productSuccess: false,
		artifactAuthority: "diagnostic_only",
		evidenceAuthority: "diagnostic_only"
	}));
	expect(evidenceText).toContain("required_visual_evidence_missing");
	expect(visualEvidenceText).toContain("required_visual_evidence_missing");
	expect(pinMediaEvidence.pinMediaEvidence[0]?.pinMedia).toEqual(expect.objectContaining({
		authority: "diagnostic",
		rejectionReasons: expect.arrayContaining(["pin_media_temp_path_mismatch"])
	}));
	expect(pinMediaEvidence.pinMediaEvidence[0]?.pinMedia.path).toBeUndefined();
	expect(pinMediaIndex.pinMediaIndex).toEqual([]);
	expect(existsSync(join(artifactPath, "canvas-plan.request.json"))).toBe(false);
	});

	it("keeps Pinterest pin media finalization failures diagnostic", async () => {
	const diagnosticProofFields = ["path", "sha256", "bytes", "width", "height", "contentType"] as const;
	type DiagnosticPinMedia = {
		authority: string;
		failure?: string;
		rejectionReasons: string[];
		path?: string;
		sha256?: string;
		bytes?: number;
		width?: number;
		height?: number;
		contentType?: string;
	};
	const expectDiagnosticProofFieldsRedacted = (pinMedia: DiagnosticPinMedia | undefined): void => {
		expect(pinMedia).toBeDefined();
		for (const field of diagnosticProofFields) {
		expect(pinMedia).not.toHaveProperty(field);
		}
	};
	const runCase = async (args: {
		name: string;
		writeBytes?: number;
		contentType: string;
		tempPath: (options: InspiredesignWorkflowPinMediaCaptureOptions) => string;
		expectedReason: string;
		expectedFailure?: string;
	}) => {
		const runtime = toRuntime({
		fetch: async (input: { url: string }) => makeAggregate({
			records: [
			normalizeRecord("social/pinterest", "social", {
				url: input.url,
				title: `${args.name} Pinterest pin`,
				content: "Full-bleed editorial image pin with premium product staging",
				attributes: PINTEREST_IMAGE_PIN_ATTRIBUTES
			})
			]
		})
		});
		const output = await runInspiredesignWorkflow(runtime, {
		brief: "Design a premium Pinterest-inspired product story",
		harvest: true,
		providers: ["social/pinterest"],
		urls: ["https://www.pinterest.com/pin/27654985208435505/"],
		outputDir: makeOutputDir(),
		mode: "path",
		visualEvidence: "off"
		}, {
		capturePinMediaEvidence: async (_url, options) => {
			if (args.writeBytes !== undefined) {
			const content = args.writeBytes >= 40 ? makeJpegBytes(1200, 1600, args.writeBytes) : Buffer.alloc(args.writeBytes, 7);
			writeFileSync(options.pinMediaEvidencePath, content);
			}
			return {
			status: "captured" as const,
			kind: "image" as const,
			capturedAt: "2026-05-23T00:00:00.000Z",
			referenceId: options.referenceId,
			url: _url,
			sourceUrl: _url,
			endedSourceUrl: _url,
			pinterestPageQuality: "pin_media" as const,
			mediaUrl: "https://i.pinimg.com/originals/pin-main.jpg",
			width: 1200,
			height: 1600,
			contentType: args.contentType,
			tempPath: args.tempPath(options),
			warnings: [],
			rejectionReasons: []
			};
		}
		});
		const artifactPath = String(output.artifact_path);
		const pinMediaEvidence = JSON.parse(readFileSync(join(artifactPath, "pin-media-evidence.json"), "utf8")) as {
		pinMediaEvidence: Array<{ pinMedia: DiagnosticPinMedia }>;
		};
		const aggregateEvidence = JSON.parse(readFileSync(join(artifactPath, "evidence.json"), "utf8")) as {
		pinMediaEvidence: Array<{ pinMedia: DiagnosticPinMedia }>;
		references: Array<{ capture?: { pinMedia?: DiagnosticPinMedia } }>;
		};
		const pinMediaIndex = JSON.parse(readFileSync(join(artifactPath, "pin-media-index.json"), "utf8")) as {
		pinMediaIndex: unknown[];
		};
		const meta = output.meta as InspiredesignWorkflowMeta;
		const leakedPinMediaPath = "pin-media-evidence/b7a5656033e1/main.jpg";
		const pinMedia = pinMediaEvidence.pinMediaEvidence[0]?.pinMedia;
		expect(pinMedia).toEqual(expect.objectContaining({
		authority: "diagnostic",
		rejectionReasons: expect.arrayContaining([args.expectedReason])
		}));
		if (args.expectedFailure) {
		expect(pinMedia?.failure).toBe(args.expectedFailure);
		}
		expectDiagnosticProofFieldsRedacted(pinMedia);
		expectDiagnosticProofFieldsRedacted(aggregateEvidence.pinMediaEvidence[0]?.pinMedia);
		expectDiagnosticProofFieldsRedacted(aggregateEvidence.references[0]?.capture?.pinMedia);
		expect(pinMediaIndex.pinMediaIndex).toEqual([]);
		expect(meta.artifact_manifest.files).not.toContain(leakedPinMediaPath);
		expect(existsSync(join(artifactPath, leakedPinMediaPath))).toBe(false);
		return { artifactPath, pinMedia };
	};

	await runCase({
		name: "missing temp path",
		writeBytes: 2048,
		contentType: "image/jpeg",
		tempPath: () => "",
		expectedReason: "pin_media_temp_path_missing",
		expectedFailure: "Pinterest pin media temp path was not provided by the capture runtime."
	});
	await runCase({
		name: "path mismatch",
		contentType: "image/jpeg",
		tempPath: (options) => join(dirname(options.pinMediaEvidencePath), "wrong-pin-media"),
		expectedReason: "pin_media_temp_path_mismatch",
		expectedFailure: "Pinterest pin media temp path did not match the workflow capture plan."
	});
	await runCase({
		name: "unsupported content type",
		writeBytes: 2048,
		contentType: "image/svg+xml",
		tempPath: (options) => options.pinMediaEvidencePath,
		expectedReason: "unsupported_declared_content_type"
	});
	await runCase({
		name: "oversized temp file",
		writeBytes: 20_000_001,
		contentType: "image/jpeg",
		tempPath: (options) => options.pinMediaEvidencePath,
		expectedReason: "pin_media_temp_file_too_large",
		expectedFailure: "Pinterest pin media temp file exceeded 20000000 bytes."
	});
	await runCase({
		name: "missing temp file",
		contentType: "image/jpeg",
		tempPath: (options) => options.pinMediaEvidencePath,
		expectedReason: "pin_media_temp_file_unavailable",
		expectedFailure: "Pinterest pin media temp file was unavailable."
	});
	const verificationFailure = await runCase({
		name: "byte verification",
		writeBytes: 12,
			contentType: "image/jpeg",
			tempPath: (options) => options.pinMediaEvidencePath,
			expectedReason: "unsupported_byte_signature",
			expectedFailure: "Pinterest pin media bytes did not match a supported media format."
		});
	expect(verificationFailure.pinMedia?.path).toBeUndefined();
	expect(existsSync(join(verificationFailure.artifactPath, "pin-media-evidence/b7a5656033e1/main.jpg"))).toBe(false);
	});

	it("rejects symlinked pin-media temp roots before reading runtime files", async () => {
	const symlinkTargetRoot = mkdtempSync(join(tmpdir(), "inspiredesign-pin-media-symlink-target-"));
	tempDirs.push(symlinkTargetRoot);
	const runtime = toRuntime({
		fetch: async (input: { url: string }) => makeAggregate({
		records: [
			normalizeRecord("social/pinterest", "social", {
			url: input.url,
			title: "Symlinked Pinterest pin",
			content: "Full-bleed editorial image pin with premium product staging",
			attributes: PINTEREST_IMAGE_PIN_ATTRIBUTES
			})
		]
		})
	});
	const output = await runInspiredesignWorkflow(runtime, {
		brief: "Design a premium Pinterest-inspired product story",
		harvest: true,
		providers: ["social/pinterest"],
		urls: ["https://www.pinterest.com/pin/27654985208435505/"],
		outputDir: makeOutputDir(),
		mode: "path",
		visualEvidence: "off"
	}, {
		capturePinMediaEvidence: async (_url, options) => {
		const plannedRoot = dirname(options.pinMediaEvidencePath);
		rmSync(plannedRoot, { recursive: true, force: true });
		symlinkSync(symlinkTargetRoot, plannedRoot, "dir");
		writeFileSync(join(symlinkTargetRoot, basename(options.pinMediaEvidencePath)), validPinMediaBytes());
		return {
			status: "captured" as const,
			kind: "image" as const,
			capturedAt: "2026-05-23T00:00:00.000Z",
			referenceId: options.referenceId,
			url: _url,
			sourceUrl: _url,
			endedSourceUrl: _url,
			pinterestPageQuality: "pin_media" as const,
			mediaUrl: "https://i.pinimg.com/originals/pin-main.jpg",
			width: 1200,
			height: 1600,
			contentType: "image/jpeg",
			tempPath: options.pinMediaEvidencePath,
			warnings: [],
			rejectionReasons: []
		};
		}
	});
	const artifactPath = String(output.artifact_path);
	const pinMediaEvidence = JSON.parse(readFileSync(join(artifactPath, "pin-media-evidence.json"), "utf8")) as {
		pinMediaEvidence: Array<{ pinMedia: { authority: string; failure?: string; rejectionReasons: string[]; path?: string } }>;
	};
	const pinMediaIndex = JSON.parse(readFileSync(join(artifactPath, "pin-media-index.json"), "utf8")) as {
		pinMediaIndex: unknown[];
	};
	const meta = output.meta as InspiredesignWorkflowMeta;
	const leakedPinMediaPath = "pin-media-evidence/b7a5656033e1/main.jpg";
	const pinMedia = pinMediaEvidence.pinMediaEvidence[0]?.pinMedia;

	expect(output).toEqual(expect.objectContaining({
		productSuccess: false,
		artifactAuthority: "diagnostic_only",
		evidenceAuthority: "diagnostic_only"
	}));
	expect(pinMedia).toEqual(expect.objectContaining({
		authority: "diagnostic",
		failure: "Pinterest pin media temp path did not match the workflow capture plan.",
		rejectionReasons: expect.arrayContaining(["pin_media_temp_path_mismatch"])
	}));
	expect(pinMedia?.path).toBeUndefined();
	expect(pinMediaIndex.pinMediaIndex).toEqual([]);
	expect(meta.artifact_manifest.files).not.toContain(leakedPinMediaPath);
	expect(existsSync(join(artifactPath, leakedPinMediaPath))).toBe(false);
	});

	it("stops pin-media temp-file reads once the runtime cap is exceeded", async () => {
	let emittedBytes = 0;
	const read = vi.fn(async (
		buffer: Buffer,
		offset: number,
		length: number,
		_position: number | null
	): Promise<{ bytesRead: number; buffer: Buffer }> => {
		const remainingBytes = PIN_MEDIA_RUNTIME_MAX_TEST_BYTES + 1 - emittedBytes;
		if (remainingBytes <= 0) return { bytesRead: 0, buffer };
		const bytesRead = Math.min(length, remainingBytes);
		buffer.fill(7, offset, offset + bytesRead);
		emittedBytes += bytesRead;
		return { bytesRead, buffer };
	});
	const readableFile: PinMediaRuntimeReadableFile = { read };

	await expect(readBoundedPinMediaRuntimeFile(readableFile)).rejects.toThrow("pin_media_temp_file_too_large");
	expect(emittedBytes).toBe(PIN_MEDIA_RUNTIME_MAX_TEST_BYTES + 1);
	expect(read).toHaveBeenCalled();
	});

	it("concatenates bounded pin-media runtime file chunks", async () => {
	const chunks = [Buffer.from("video-"), Buffer.from("bytes")];
	const read = vi.fn(async (
		buffer: Buffer,
		offset: number,
		length: number,
		_position: number | null
	): Promise<{ bytesRead: number; buffer: Buffer }> => {
		const chunk = chunks.shift();
		if (!chunk) return { bytesRead: 0, buffer };
		expect(length).toBeGreaterThanOrEqual(chunk.length);
		chunk.copy(buffer, offset);
		return { bytesRead: chunk.length, buffer };
	});
	const readableFile: PinMediaRuntimeReadableFile = { read };

	await expect(readBoundedPinMediaRuntimeFile(readableFile)).resolves.toEqual(Buffer.from("video-bytes"));
	expect(read).toHaveBeenCalledTimes(3);
	});

	it("sanitizes pin-media temp capture paths before joining the workflow temp root", () => {
	const workflowPathUtils = workflowTestUtils as typeof workflowTestUtils & {
		buildPinMediaTempCapturePath: (pinMediaTempRoot: string, referenceId: string) => string;
	};
	const tempRoot = mkdtempSync(join(tmpdir(), "odb-pin-media-temp-path-"));

	expect(workflowPathUtils.buildPinMediaTempCapturePath(tempRoot, "../unsafe/ref id")).toBe(
		join(tempRoot, "unsafe-ref-id-pin-media")
	);
	expect(workflowPathUtils.buildPinMediaTempCapturePath(tempRoot, "../..")).toBe(
		join(tempRoot, "reference-pin-media")
	);
	expect(workflowPathUtils.buildPinMediaTempCapturePath(tempRoot, "/private/tmp/escape")).toBe(
		join(tempRoot, "private-tmp-escape-pin-media")
	);
	expect(workflowPathUtils.buildPinMediaTempCapturePath(tempRoot, "C:\\tmp\\escape")).toBe(
		join(tempRoot, "C-tmp-escape-pin-media")
	);
	});

	it("rejects missing pin-media temp roots before trusting runtime paths", async () => {
	const workflowPathUtils = workflowTestUtils as typeof workflowTestUtils & {
		buildPinMediaTempCapturePath: (pinMediaTempRoot: string, referenceId: string) => string;
		trustedPinMediaTempPath: (
		pinMediaTempRoot: string | undefined,
		referenceId: string,
		tempPath: string | undefined
		) => Promise<string | undefined>;
	};
	const tempRoot = mkdtempSync(join(tmpdir(), "odb-pin-media-trust-branch-"));
	tempDirs.push(tempRoot);
	const plannedPath = workflowPathUtils.buildPinMediaTempCapturePath(tempRoot, "pin-ref");

	await expect(workflowPathUtils.trustedPinMediaTempPath(undefined, "pin-ref", plannedPath))
		.resolves.toBeUndefined();
	await expect(workflowPathUtils.trustedPinMediaTempPath(tempRoot, "pin-ref", undefined))
		.resolves.toBeUndefined();
	});

	it("trusts planned pin-media runtime paths under the real temp root", async () => {
	const workflowPathUtils = workflowTestUtils as typeof workflowTestUtils & {
		buildPinMediaTempCapturePath: (pinMediaTempRoot: string, referenceId: string) => string;
		trustedPinMediaTempPath: (
		pinMediaTempRoot: string | undefined,
		referenceId: string,
		tempPath: string | undefined
		) => Promise<string | undefined>;
	};
	const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), "odb-pin-media-trusted-success-")));
	tempDirs.push(tempRoot);
	const plannedPath = workflowPathUtils.buildPinMediaTempCapturePath(tempRoot, "pin-ref");
	const mismatchedPath = join(tempRoot, "other-pin-media");

	await expect(workflowPathUtils.trustedPinMediaTempPath(tempRoot, "pin-ref", plannedPath))
		.resolves.toBe(plannedPath);
	await expect(workflowPathUtils.trustedPinMediaTempPath(tempRoot, "pin-ref", mismatchedPath))
		.resolves.toBeUndefined();
	});

	it("creates trusted media-analysis temp dirs below the pin-media root", async () => {
	const workflowPathUtils = workflowTestUtils as typeof workflowTestUtils & {
		createPinMediaAnalysisTempDir: (pinMediaTempRoot: string, referenceId: string) => Promise<string>;
	};
	const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), "odb-pin-media-analysis-root-")));
	tempDirs.push(tempRoot);
	const tempDir = await workflowPathUtils.createPinMediaAnalysisTempDir(tempRoot, "../unsafe/ref id");

	expect(dirname(tempDir)).toBe(tempRoot);
	expect(basename(tempDir).startsWith("unsafe-ref-id-media-analysis-")).toBe(true);
	expect(lstatSync(tempDir).isDirectory()).toBe(true);
	});

	it("reads trusted pin-media runtime files and rejects non-files", async () => {
	const workflowPathUtils = workflowTestUtils as typeof workflowTestUtils & {
		readTrustedPinMediaRuntimeFile: (pinMediaTempRoot: string, absolutePath: string) => Promise<Buffer>;
	};
	const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), "odb-pin-media-read-trusted-")));
	tempDirs.push(tempRoot);
	const filePath = join(tempRoot, "trusted-pin-media");
	const directoryPath = join(tempRoot, "trusted-pin-media-dir");
	writeFileSync(filePath, "trusted-bytes");
	mkdirSync(directoryPath);

	await expect(workflowPathUtils.readTrustedPinMediaRuntimeFile(tempRoot, filePath))
		.resolves.toEqual(Buffer.from("trusted-bytes"));
	await expect(workflowPathUtils.readTrustedPinMediaRuntimeFile(tempRoot, directoryPath))
		.rejects.toThrow("Pinterest pin media temp path was not a file.");
	});

	it("keeps media-unproven Pinterest-only URL harvest diagnostic when provider is omitted", async () => {
    const outputDir = makeOutputDir();
    const captureReference = vi.fn();
    const output = await runInspiredesignWorkflow(toRuntime({
      fetch: async (input: { url: string }) => makeAggregate({
        records: [
          normalizeRecord("social/pinterest", "social", {
            url: input.url,
			title: "Pinterest pin reference",
			content: "Full-bleed editorial pin with premium product staging"
          })
        ]
      })
    }), {
      brief: "Design a premium Pinterest-inspired product story",
      harvest: true,
      urls: ["https://www.pinterest.com/pin/27654985208435505/"],
      outputDir,
      mode: "path"
    }, {
      captureReference
    });

    const meta = output.meta as InspiredesignWorkflowMeta;

    expect(meta.selection).toEqual(expect.objectContaining({
      capture_mode: "off",
		primary_capture_strategy: "source_diagnostic"
    }));
    expect(captureReference).not.toHaveBeenCalled();
  });

	it("runs pin media browser recovery for canonical pin pages with recoverable page quality", async () => {
	const capturePinMediaEvidence = vi.fn(async (_url: string, options: InspiredesignWorkflowPinMediaCaptureOptions) => {
		if (options.pinterestPageQuality === "search_shell") {
		return {
			status: "failed" as const,
			kind: "image" as const,
			capturedAt: "2026-05-23T00:00:00.000Z",
			referenceId: options.referenceId,
			url: _url,
			sourceUrl: _url,
			pinterestPageQuality: "search_shell" as const,
			warnings: [],
			failure: "Browser media recovery saw a search shell.",
			rejectionReasons: ["search_shell_without_media_signals"]
		};
		}
		writeFileSync(options.pinMediaEvidencePath, validPinMediaBytes());
		return {
		status: "captured" as const,
		kind: "image" as const,
		capturedAt: "2026-05-23T00:00:00.000Z",
		referenceId: options.referenceId,
		url: _url,
		sourceUrl: _url,
		pinterestPageQuality: "pin_media" as const,
		mediaUrl: "https://i.pinimg.com/originals/pin-main.jpg",
		width: 1200,
		height: 1600,
		contentType: "image/jpeg",
		tempPath: options.pinMediaEvidencePath,
		warnings: [],
		rejectionReasons: []
		};
	});
	const runtime = toRuntime({
		fetch: async (input: { url: string }) => makeAggregate({
		records: [
			normalizeRecord("social/pinterest", "social", {
			url: input.url,
			title: "Pinterest pin reference",
			content: "Browser-native classification did not prove artifact-ready media.",
			attributes: input.url.includes("27654985208435505")
				? {
				pinterestMediaClassification: {
					kind: "unknown_pin",
					confidence: 0.66,
					productCandidate: false,
					sourcePageQuality: "unknown",
					reasons: ["browser_native_unknown_pin"],
					diagnosticBlockers: ["pin_media_type_unproven"]
				}
				}
				: {
				pinterestMediaClassification: {
					kind: "shell",
					confidence: 0.66,
					productCandidate: false,
					sourcePageQuality: "search_shell",
					reasons: ["browser_native_search_shell"],
					diagnosticBlockers: ["search_shell_without_media_signals"]
				}
				}
			})
		]
		})
	});

	await runInspiredesignWorkflow(runtime, {
		brief: "Design a premium Pinterest-inspired product story",
		harvest: true,
		providers: ["social/pinterest"],
		urls: [
		"https://www.pinterest.com/pin/27654985208435505/",
		"https://www.pinterest.com/pin/99999999999999999/"
		],
		outputDir: makeOutputDir(),
		mode: "path",
		visualEvidence: "off"
	}, { capturePinMediaEvidence });

	expect(capturePinMediaEvidence).toHaveBeenCalledTimes(2);
	expect(capturePinMediaEvidence.mock.calls[0]?.[0]).toBe("https://www.pinterest.com/pin/27654985208435505");
	expect(capturePinMediaEvidence.mock.calls[1]?.[0]).toBe("https://www.pinterest.com/pin/99999999999999999");
	});

	it("attempts a screenshot after unknown-pin media recovery and records still-image motion clarity", async () => {
	const callOrder: string[] = [];
	const runtime = toRuntime({
		fetch: async (input: { url: string }) => makeAggregate({
		records: [
			normalizeRecord("social/pinterest", "social", {
			url: input.url,
			title: "Pinterest recovered image pin reference",
			content: "Browser-native classification did not prove visual-first capture.",
			attributes: {
				pinterestMediaClassification: {
				kind: "unknown_pin",
				confidence: 0.66,
				productCandidate: false,
				sourcePageQuality: "unknown",
				reasons: ["browser_native_unknown_pin"],
				diagnosticBlockers: ["pin_media_type_unproven"]
				}
			}
			})
		]
		})
	});

	const output = await runInspiredesignWorkflow(runtime, {
		brief: "Design a premium Pinterest-inspired product story",
		harvest: true,
		providers: ["social/pinterest"],
		urls: ["https://www.pinterest.com/pin/27654985208435505/"],
		outputDir: makeOutputDir(),
		mode: "path",
		visualEvidence: "required"
	}, {
		capturePinMediaEvidence: async (_url, options) => {
		callOrder.push("pinMedia");
		writeFileSync(options.pinMediaEvidencePath, validPinMediaBytes());
		return makePinterestImagePinMediaCapture(_url, options, "https://i.pinimg.com/originals/pin-main-final.jpg");
		},
		captureVisualEvidence: async (_url, options) => {
		callOrder.push("visual");
		writeFileSync(options.visualEvidencePath, Buffer.alloc(2048, 2));
		return {
			status: "captured" as const,
			kind: "viewport" as const,
			fullPage: false,
			capturedAt: "2026-05-23T00:00:00.000Z",
			sourceUrl: _url,
			pinterestPageQuality: "pin_media" as const,
			tempPath: options.visualEvidencePath,
			warnings: ["workflow_visual_after_pin_media"]
		};
		}
	});

	const artifactPath = String(output.artifact_path);
	const evidence = JSON.parse(readFileSync(join(artifactPath, "evidence.json"), "utf8")) as {
		visualEvidenceAfterPinMedia?: {
		status: string;
		authority: string;
		references: Array<{ referenceId: string; status: string; reason: string; screenshotPath?: string; pinMediaPath?: string }>;
		};
		motionCapture?: {
		status: string;
		reason: string;
		authority: string;
		references: Array<{ referenceId: string; status: string; reason: string; pinMediaPath?: string }>;
		};
	};
	const screenshotIndex = JSON.parse(readFileSync(join(artifactPath, "screenshot-index.json"), "utf8")) as {
		screenshots: Array<{ path: string; warnings: string[] }>;
	};
	const motionEvidence = JSON.parse(readFileSync(join(artifactPath, "motion-evidence.json"), "utf8")) as {
		motionEvidence: unknown[];
	};

	expect(callOrder).toEqual(["pinMedia", "visual"]);
	expect(output).toEqual(expect.objectContaining({
		productSuccess: true,
		artifactAuthority: "product_ready",
		evidenceAuthority: "pin_media_ready"
	}));
	expect(screenshotIndex.screenshots[0]).toEqual(expect.objectContaining({
		path: "visual-evidence/b7a5656033e1/viewport.png",
		warnings: ["workflow_visual_after_pin_media"]
	}));
	expect(readFileSync(join(artifactPath, "visual-evidence/b7a5656033e1/viewport.png"))).toEqual(Buffer.alloc(2048, 2));
	expect(evidence.visualEvidenceAfterPinMedia).toEqual(expect.objectContaining({
		status: "captured",
		authority: "pin_media_ready",
		references: [expect.objectContaining({
		referenceId: "b7a5656033e1",
		status: "captured",
		reason: "screenshot_captured_after_pin_media",
		screenshotPath: "visual-evidence/b7a5656033e1/viewport.png",
		pinMediaPath: "pin-media-evidence/b7a5656033e1/main.jpg"
		})]
	}));
	expect(evidence.motionCapture).toEqual(expect.objectContaining({
		status: "not_applicable",
		reason: "still_image_pin_media",
		authority: "motion_evidence_browser_replay_only",
		references: [expect.objectContaining({
		referenceId: "b7a5656033e1",
		status: "not_applicable",
		reason: "still_image_pin_media",
		pinMediaPath: "pin-media-evidence/b7a5656033e1/main.jpg"
		})]
	}));
	expect(motionEvidence.motionEvidence).toEqual([]);
	});

	it("keeps pin-media product readiness when post-pin screenshot fails and handoff names the saved media", async () => {
	const runtime = toRuntime({
		fetch: async (input: { url: string }) => makeAggregate({
		records: [
			normalizeRecord("social/pinterest", "social", {
			url: input.url,
			title: "Pinterest recovered image pin reference",
			content: "Browser-native classification did not prove visual-first capture.",
			attributes: {
				pinterestMediaClassification: {
				kind: "unknown_pin",
				confidence: 0.66,
				productCandidate: false,
				sourcePageQuality: "unknown",
				reasons: ["browser_native_unknown_pin"],
				diagnosticBlockers: ["pin_media_type_unproven"]
				}
			}
			})
		]
		})
	});

	const output = await runInspiredesignWorkflow(runtime, {
		brief: "Design a premium Pinterest-inspired product story",
		harvest: true,
		providers: ["social/pinterest"],
		urls: ["https://www.pinterest.com/pin/27654985208435505/"],
		outputDir: makeOutputDir(),
		mode: "path",
		visualEvidence: "required",
		includePrototypeGuidance: true
	}, {
		capturePinMediaEvidence: async (_url, options) => {
		writeFileSync(options.pinMediaEvidencePath, validPinMediaBytes());
		return makePinterestImagePinMediaCapture(_url, options, "https://i.pinimg.com/originals/pin-main-final.jpg");
		},
		captureVisualEvidence: async () => ({
		status: "failed" as const,
		kind: "viewport" as const,
		fullPage: false,
		capturedAt: "2026-05-23T00:00:00.000Z",
		warnings: ["workflow_visual_after_pin_media", "primary_visual_capture_unavailable"],
		failure: "Primary visual evidence capture unavailable after pin media."
		})
	});

	const artifactPath = String(output.artifact_path);
	const evidence = JSON.parse(readFileSync(join(artifactPath, "evidence.json"), "utf8")) as {
		visualEvidenceAfterPinMedia?: {
		status: string;
		authority: string;
		references: Array<{ status: string; reason: string; failure?: string; pinMediaPath?: string }>;
		};
		motionCapture?: { status: string; reason: string; authority: string };
	};
	const screenshotIndex = JSON.parse(readFileSync(join(artifactPath, "screenshot-index.json"), "utf8")) as {
		screenshots: unknown[];
	};
	const rankedReferencesText = readFileSync(join(artifactPath, "ranked-references.json"), "utf8");
	const handoffText = readFileSync(join(artifactPath, INSPIREDESIGN_HANDOFF_FILES.designAgentHandoff), "utf8");
	const implementationPlanText = readFileSync(join(artifactPath, INSPIREDESIGN_HANDOFF_FILES.implementationPlanMarkdown), "utf8");
	const prototypeGuidanceText = readFileSync(join(artifactPath, INSPIREDESIGN_HANDOFF_FILES.prototypeGuidance), "utf8");

	expect(output).toEqual(expect.objectContaining({
		productSuccess: true,
		artifactAuthority: "product_ready",
		evidenceAuthority: "pin_media_ready"
	}));
	expect(screenshotIndex.screenshots).toEqual([]);
	expect(evidence.visualEvidenceAfterPinMedia).toEqual(expect.objectContaining({
		status: "failed",
		authority: "pin_media_ready",
		references: [expect.objectContaining({
		status: "failed",
		reason: "screenshot_failed_after_pin_media",
		failure: "Primary visual evidence capture unavailable after pin media.",
		pinMediaPath: "pin-media-evidence/b7a5656033e1/main.jpg"
		})]
	}));
	expect(evidence.motionCapture).toEqual(expect.objectContaining({
		status: "not_applicable",
		reason: "still_image_pin_media",
		authority: "motion_evidence_browser_replay_only"
	}));
	for (const payload of [rankedReferencesText, handoffText, implementationPlanText, prototypeGuidanceText]) {
		expect(payload).toContain("pin-media-evidence/b7a5656033e1/main.jpg");
		expect(payload).not.toContain("No live reference cues were captured");
	}
	});

	it("persists pin media for canonical pins even when provider classification sees login chrome", async () => {
	const output = await runInspiredesignWorkflow(toRuntime({
		fetch: async (input: { url: string }) => makeAggregate({
		records: [
			normalizeRecord("social/pinterest", "social", {
			url: input.url,
			title: "Pinterest pin behind login chrome",
			content: "Log in to continue with Pinterest and sign up to save this pin",
			attributes: {
				pinterestMediaClassification: {
				kind: "login_challenge",
				confidence: 0.66,
				productCandidate: false,
				sourcePageQuality: "login_challenge",
				reasons: ["browser_native_login_challenge"],
				diagnosticBlockers: ["login_or_challenge_blocks_reference_extraction"]
				}
			}
			})
		]
		})
	}), {
		brief: "Design a premium Pinterest-inspired product story",
		harvest: true,
		providers: ["social/pinterest"],
		urls: ["https://www.pinterest.com/pin/27654985208435505/"],
		outputDir: makeOutputDir(),
		mode: "path",
		visualEvidence: "off"
	}, {
		capturePinMediaEvidence: async (_url, options) => {
		writeFileSync(options.pinMediaEvidencePath, validPinMediaBytes());
		return {
			status: "captured" as const,
			kind: "image" as const,
			capturedAt: "2026-05-23T00:00:00.000Z",
			referenceId: options.referenceId,
			url: _url,
			sourceUrl: _url,
			pinterestPageQuality: "pin_media" as const,
			mediaUrl: "https://i.pinimg.com/originals/pin-main.jpg",
			width: 999,
			height: 999,
			contentType: "image/jpeg",
			tempPath: options.pinMediaEvidencePath,
			warnings: [],
			rejectionReasons: []
		};
		}
	});
	const artifactPath = String(output.artifact_path);
	const pinMediaIndex = JSON.parse(readFileSync(join(artifactPath, "pin-media-index.json"), "utf8")) as {
		pinMediaIndex: Array<{ path: string; authority: string }>;
	};
	expect(pinMediaIndex.pinMediaIndex).toEqual([
		expect.objectContaining({
		path: "pin-media-evidence/b7a5656033e1/main.jpg",
		authority: "design_evidence"
		})
	]);
	const pinMediaEvidence = JSON.parse(readFileSync(join(artifactPath, "pin-media-evidence.json"), "utf8")) as {
		pinMediaEvidence: Array<{ pinMedia: { width?: number; height?: number } }>;
	};
	expect(pinMediaEvidence.pinMediaEvidence[0]?.pinMedia).toEqual(expect.objectContaining({
		width: 1200,
		height: 1600
	}));
	const rankedReferences = JSON.parse(readFileSync(join(artifactPath, "ranked-references.json"), "utf8")) as {
		references: Array<{ evidenceAuthority?: string; capturedVia?: string[] }>;
	};
	expect(rankedReferences.references[0]).toEqual(expect.objectContaining({
		evidenceAuthority: "pin_media_ready",
		capturedVia: expect.arrayContaining(["pin_media", "pin_media_ready"])
	}));
	expect(readFileSync(join(artifactPath, "pin-media-evidence/b7a5656033e1/main.jpg"))).toEqual(validPinMediaBytes());
	});

	it("fails closed on malformed browser-native Pinterest classifications", async () => {
	const cases: Array<{ name: string; attributes: Record<string, JsonValue> }> = [
		{
		name: "invalid kind",
		attributes: {
			pinterestMediaClassification: {
			kind: "photo_pin",
			confidence: 0.9,
			sourcePageQuality: "pin_media",
			reasons: ["browser_native_photo_pin"],
			diagnosticBlockers: []
			}
		}
		},
		{
		name: "invalid source quality",
		attributes: {
			pinterestMediaClassification: {
			kind: "image_pin",
			confidence: 0.9,
			sourcePageQuality: "browser_probe",
			reasons: ["browser_native_image_pin"],
			diagnosticBlockers: []
			}
		}
		},
		{
		name: "non-authoritative unknown pin",
		attributes: {
			pinterestMediaClassification: {
			kind: "unknown_pin",
			confidence: "not-a-number",
			sourcePageQuality: "unknown",
			reasons: ["browser_native_unknown_pin", 7],
			diagnosticBlockers: "pin_media_type_unproven"
			}
		}
		}
	];

	for (const item of cases) {
		const captureReference = vi.fn();
		const output = await runInspiredesignWorkflow(toRuntime({
		fetch: async (input: { url: string }) => makeAggregate({
			records: [
			normalizeRecord("social/pinterest", "social", {
				url: input.url,
				title: `Pinterest pin reference ${item.name}`,
				content: "Browser-native classification did not prove artifact-ready media.",
				attributes: item.attributes
			})
			]
		})
		}), {
		brief: "Design a premium Pinterest-inspired product story",
		harvest: true,
		providers: ["social/pinterest"],
		urls: ["https://www.pinterest.com/pin/27654985208435505/"],
		outputDir: makeOutputDir(),
		mode: "path"
		}, {
		captureReference
		});
		const meta = output.meta as InspiredesignWorkflowMeta;

		expect(meta.selection).toEqual(expect.objectContaining({
		primary_capture_strategy: "source_diagnostic"
		}));
		expect(output).toEqual(expect.objectContaining({
		productSuccess: false,
		artifactAuthority: "diagnostic_only"
		}));
		expect(captureReference).not.toHaveBeenCalled();
	}
	});

  it("records thrown primary visual capture ports as visual failure metadata without deep diagnostics", async () => {
    const outputDir = makeOutputDir();
    const captureReference = vi.fn(async () => makeCapture("Deep diagnostic capture still ran after primary visual failure."));

    const output = await runInspiredesignWorkflow(toRuntime({
      fetch: async (input: { url: string }) => makeAggregate({
        records: [
          normalizeRecord("social/pinterest", "social", {
            url: input.url,
            title: "Pinterest image pin reference",
            content: "Editorial image pin with full-bleed couture composition",
            attributes: PINTEREST_IMAGE_PIN_ATTRIBUTES
          })
        ]
      })
    }), {
      brief: "Design an editorial couture landing page",
      harvest: true,
      providers: ["social/pinterest"],
      urls: ["https://www.pinterest.com/pin/27654985208435505/"],
      outputDir,
      mode: "json",
      visualEvidence: "required",
      captureMode: "deep"
    }, {
      captureVisualEvidence: async () => {
        throw new Error("primary screenshot helper crashed");
      },
      captureReference
    });

    const evidence = output.evidence as InspiredesignWorkflowEvidence;

    expect(captureReference).not.toHaveBeenCalled();
    expect(evidence.references[0]).toMatchObject({
      captureStatus: "off",
      capture: {
        visual: {
          status: "failed",
          failure: "primary screenshot helper crashed",
          warnings: ["primary_visual_capture_failed"]
        }
      }
    });
    expect(output).toEqual(expect.objectContaining({
      productSuccess: false,
      artifactAuthority: "diagnostic_only"
    }));
  });

  it("uses fresh remaining timeout budgets for primary capture and deep diagnostics", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-23T00:00:00.000Z"));

    try {
      await runInspiredesignWorkflow(toRuntime({
        fetch: async (input: { url: string }) => makeAggregate({
          records: [
            normalizeRecord("social/pinterest", "social", {
              url: input.url,
              title: "Pinterest image pin reference",
              content: "Full-bleed editorial image pin with premium product staging"
            })
          ]
        })
      }), {
        brief: "Design a premium Pinterest-inspired product story",
        harvest: true,
        providers: ["social/pinterest"],
        urls: ["https://www.pinterest.com/pin/27654985208435505/"],
        outputDir: makeOutputDir(),
        mode: "path",
        visualEvidence: "required",
        captureMode: "deep",
        timeoutMs: 10000
      }, {
        captureVisualEvidence: async (_url, options) => {
          expect(options.timeoutMs).toBe(10000);
          vi.setSystemTime(new Date("2026-05-23T00:00:09.000Z"));
          writeFileSync(options.visualEvidencePath, Buffer.alloc(2048, 1));
          return {
            status: "captured",
            kind: "viewport",
            fullPage: false,
            capturedAt: "2026-05-23T00:00:09.000Z",
            sourceUrl: _url,
			pinterestPageQuality: "pin_media",
            tempPath: options.visualEvidencePath,
            warnings: []
          };
        },
        captureReference: async (_url, options) => {
          expect(options?.timeoutMs).toBe(1000);
          return makeCapture("Deep diagnostics used the remaining timeout budget");
        }
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves primary screenshot evidence when deep diagnostics return failed visual metadata", async () => {
    const outputDir = makeOutputDir();
    const output = await runInspiredesignWorkflow(toRuntime({
      fetch: async (input: { url: string }) => makeAggregate({
        records: [
          normalizeRecord("social/pinterest", "social", {
            url: input.url,
            title: "Pinterest image pin reference",
            content: "Full-bleed editorial image pin with premium product staging",
            attributes: PINTEREST_IMAGE_PIN_ATTRIBUTES
          })
        ]
      })
    }), {
      brief: "Design a premium Pinterest-inspired product story",
      harvest: true,
      providers: ["social/pinterest"],
      urls: ["https://www.pinterest.com/pin/27654985208435505/"],
      outputDir,
      mode: "path",
      visualEvidence: "required",
      captureMode: "deep"
    }, {
      captureVisualEvidence: async (_url, options) => {
        writeFileSync(options.visualEvidencePath, Buffer.alloc(2048, 1));
        return {
          status: "captured",
          kind: "viewport",
          fullPage: false,
          capturedAt: "2026-05-23T00:00:00.000Z",
          sourceUrl: _url,
			pinterestPageQuality: "pin_media",
          tempPath: options.visualEvidencePath,
          warnings: ["workflow_visual_first"]
        };
      },
      captureReference: async () => ({
        snapshot: { content: "deep diagnostics text", refCount: 1, warnings: [] },
        attempts: {
          snapshot: { status: "captured" },
          clone: { status: "skipped", detail: "No clone needed for diagnostic test." },
          dom: { status: "skipped", detail: "No DOM needed for diagnostic test." }
        },
        visual: {
          status: "failed",
          kind: "viewport",
          fullPage: false,
          capturedAt: "2026-05-23T00:00:01.000Z",
          warnings: ["deep_visual_failed"],
          failure: "Deep diagnostic screenshot failed."
        }
      })
    });

    const meta = output.meta as InspiredesignWorkflowMeta;
    const artifactPath = String(output.artifact_path);
    const evidence = JSON.parse(readFileSync(join(artifactPath, "evidence.json"), "utf8")) as InspiredesignWorkflowEvidence;
    const visualEvidence = JSON.parse(readFileSync(join(artifactPath, "visual-evidence.json"), "utf8")) as {
      visualEvidence: Array<{ visual: { status: string; path?: string; warnings: string[] } }>;
    };

    expect(meta.metrics.captured_references).toBe(1);
    expect(meta.metrics.failed_captures).toBe(0);
    expect(evidence.references[0]?.capture?.visual).toEqual(expect.objectContaining({
      status: "captured",
      path: "visual-evidence/b7a5656033e1/viewport.png",
      warnings: ["workflow_visual_first"]
    }));
    expect(visualEvidence.visualEvidence[0]?.visual).toEqual(expect.objectContaining({
      status: "captured",
      path: "visual-evidence/b7a5656033e1/viewport.png"
    }));
  });

  it("persists motion evidence for Pinterest video pins", async () => {
    const outputDir = makeOutputDir();
    const cookieSource = {
      type: "inline" as const,
      value: [{ name: "sid", value: "abc", url: "https://www.pinterest.com/pin/77654985208435505/" }]
    };

    const output = await runInspiredesignWorkflow(toRuntime({
      fetch: async (input: { url: string }) => makeAggregate({
        records: [
          normalizeRecord("social/pinterest", "social", {
            url: input.url,
            title: "Pinterest video pin reference",
			content: "Browser-native classified video pin with cinematic motion and premium product reveal",
			attributes: PINTEREST_VIDEO_PIN_ATTRIBUTES
          })
        ]
      })
    }), {
      brief: "Design a premium motion-led product story",
      harvest: true,
      providers: ["social/pinterest"],
      urls: ["https://www.pinterest.com/pin/77654985208435505/"],
      outputDir,
      mode: "path",
      visualEvidence: "off",
      cookiePolicyOverride: "required",
      cookieSource
    }, {
      captureMotionEvidence: async (_url, options) => {
        expect(options.cookieSource).toEqual(cookieSource);
        if (!options.outputDir) throw new Error("motion output dir missing");
        const motionOutputDir = options.outputDir;
        const manifestPath = join(motionOutputDir, "replay.json");
        const replayHtmlPath = join(motionOutputDir, "replay.html");
        const previewPath = join(motionOutputDir, "preview.png");
        mkdirSync(join(motionOutputDir, "frames"), { recursive: true });
        mkdirSync(join(motionOutputDir, "ignored-dir"), { recursive: true });
        writeFileSync(manifestPath, JSON.stringify({ frames: [{ index: 1 }, { index: 2 }, { index: 3 }] }));
        writeFileSync(replayHtmlPath, "<html>replay</html>");
        writeFileSync(previewPath, Buffer.alloc(2048, 1));
        writeFileSync(join(motionOutputDir, "frames", "000001.png"), Buffer.from("frame 1"));
        writeFileSync(join(motionOutputDir, "notes.txt"), "ignored note");
        writeFileSync(join(motionOutputDir, "ignored-dir", "000002.png"), Buffer.from("ignored frame"));
        symlinkSync(manifestPath, join(motionOutputDir, "frames", "linked.png"));
        return {
          status: "captured",
          kind: "screencast",
	          capturedAt: "2026-05-23T00:01:00.000Z",
	          sourceUrl: _url,
	          startedSourceUrl: _url,
	          endedSourceUrl: _url,
	pinterestPageQuality: "pin_media",
	startedPinterestPageQuality: "pin_media",
	endedPinterestPageQuality: "pin_media",
	          replay: { tempPath: manifestPath },
          replayHtml: { tempPath: replayHtmlPath },
          preview: { tempPath: previewPath },
          outputDir: motionOutputDir,
          frameCount: 3,
          warnings: ["workflow_motion_first"],
          diagnostic: false,
          diagnosticReasons: []
        };
      }
    });

    const meta = output.meta as InspiredesignWorkflowMeta;
    const artifactPath = String(output.artifact_path);
    const motionEvidenceJson = readFileSync(join(artifactPath, "motion-evidence.json"), "utf8");
    const evidence = JSON.parse(readFileSync(join(artifactPath, "evidence.json"), "utf8")) as InspiredesignWorkflowEvidence & {
      mediaAnalysis?: { savedMediaMotionNotice?: unknown };
      motionEvidence?: unknown;
    };
    const motionEvidence = JSON.parse(motionEvidenceJson) as {
      motionEvidence: Array<{ motion: { status: string; frameCount: number; authority: string; replay: { path: string }; preview: { path: string } } }>;
    };

    expect(output).toEqual(expect.objectContaining({
		ready: false,
      readiness: "ready",
		guidanceReady: true,
		productSuccess: false,
		artifactAuthority: "diagnostic_only",
		evidenceAuthority: "diagnostic_only",
		rankedReferenceCount: 1,
		motionReadyReferenceCount: 1,
		pinMediaReadyReferenceCount: 0
    }));
	expect(existsSync(join(artifactPath, "canvas-plan.request.json"))).toBe(false);
    expect(meta.selection).toEqual(expect.objectContaining({
      primary_capture_strategy: "motion_first"
    }));
    expect(meta.metrics).toEqual(expect.objectContaining({
      attempted_reference_count: 1,
      all_attempt_failed_capture_count: 0,
		all_attempt_missing_screenshot_count: 0,
		all_attempt_visual_failure_count: 0,
      all_attempt_motion_failure_count: 0
    }));
    expect(meta.artifact_manifest.files).toEqual(expect.arrayContaining([
      "motion-evidence.json",
      "motion-evidence/7bf52aee6e56/replay.json",
      "motion-evidence/7bf52aee6e56/replay.html",
      "motion-evidence/7bf52aee6e56/preview.png",
      "motion-evidence/7bf52aee6e56/frames/000001.png"
    ]));
    expect(motionEvidence.motionEvidence[0]?.motion).toEqual(expect.objectContaining({
      status: "captured",
      frameCount: 3,
      authority: "design_evidence",
      replay: expect.objectContaining({
        path: "motion-evidence/7bf52aee6e56/replay.json",
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        bytes: 48
      }),
      preview: expect.objectContaining({
        path: "motion-evidence/7bf52aee6e56/preview.png",
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        bytes: 2048
      })
    }));
    expect(evidence.motionEvidence).toEqual(motionEvidence.motionEvidence);
    expect(evidence.mediaAnalysis?.savedMediaMotionNotice).toBeUndefined();
    expect(evidence.referencePatternBoard?.references[0]?.capturedVia).toEqual(expect.arrayContaining([
      "motion",
      "motion_ready"
    ]));
  });

  it("rejects symlinked motion output roots before reading runtime files", async () => {
    const outputDir = makeOutputDir();
    const trustedMotionDir = mkdtempSync(join(tmpdir(), "inspiredesign-motion-root-target-"));
    tempDirs.push(trustedMotionDir);
    writeFileSync(join(trustedMotionDir, "replay.json"), JSON.stringify({ frames: [{ index: 1 }] }));

    const output = await runInspiredesignWorkflow(toRuntime({
      fetch: async (input: { url: string }) => makeAggregate({
        records: [
          normalizeRecord("social/pinterest", "social", {
            url: input.url,
            title: "Pinterest video pin reference",
			content: "<video data-test-id=\"video\">Video pin with cinematic motion and premium product reveal</video>"
          })
        ]
      })
    }), {
      brief: "Design a premium motion-led product story",
      harvest: true,
      providers: ["social/pinterest"],
      urls: ["https://www.pinterest.com/pin/77654985208435505/"],
      outputDir,
      mode: "path",
      visualEvidence: "off"
    }, {
      captureMotionEvidence: async (_url, options) => {
        if (!options.outputDir) throw new Error("motion output dir missing");
        rmSync(options.outputDir, { recursive: true, force: true });
        symlinkSync(trustedMotionDir, options.outputDir, "dir");
        return {
          status: "captured",
          kind: "screencast",
          capturedAt: "2026-05-23T00:01:00.000Z",
          replay: { tempPath: join(options.outputDir, "replay.json") },
          outputDir: options.outputDir,
          frameCount: 1,
          warnings: [],
          diagnostic: false,
          diagnosticReasons: []
        };
      }
    });

    const artifactPath = String(output.artifact_path);
    const motionEvidence = JSON.parse(readFileSync(join(artifactPath, "motion-evidence.json"), "utf8")) as {
      motionEvidence: Array<{ motion: { status: string; failure?: string; authority: string } }>;
    };

    expect(output).toEqual(expect.objectContaining({
      ready: false,
      productSuccess: false,
      artifactAuthority: "diagnostic_only",
      rankedReferenceCount: 0
    }));
    expect(motionEvidence.motionEvidence[0]?.motion).toEqual(expect.objectContaining({
      status: "failed",
      authority: "diagnostic",
      failure: "Motion evidence output directory was unavailable."
    }));
  });

  it("rejects motion evidence files outside the planned capture directory", async () => {
    const outputDir = makeOutputDir();
    const tempMotionDir = mkdtempSync(join(tmpdir(), "inspiredesign-motion-untrusted-"));
    tempDirs.push(tempMotionDir);
    writeFileSync(join(tempMotionDir, "replay.json"), JSON.stringify({ frames: [{ index: 1 }] }));

    const output = await runInspiredesignWorkflow(toRuntime({
      fetch: async (input: { url: string }) => makeAggregate({
        records: [
          normalizeRecord("social/pinterest", "social", {
            url: input.url,
            title: "Pinterest video pin reference",
			content: "<video data-test-id=\"video\">Video pin with cinematic motion and premium product reveal</video>"
          })
        ]
      })
    }), {
      brief: "Design a premium motion-led product story",
      harvest: true,
      providers: ["social/pinterest"],
      urls: ["https://www.pinterest.com/pin/77654985208435505/"],
      outputDir,
      mode: "path",
      visualEvidence: "required"
    }, {
      captureMotionEvidence: async () => ({
        status: "captured",
        kind: "screencast",
        capturedAt: "2026-05-23T00:01:00.000Z",
        replay: { tempPath: join(tempMotionDir, "replay.json") },
        outputDir: tempMotionDir,
        frameCount: 1,
        warnings: [],
        diagnostic: false,
        diagnosticReasons: []
      })
    });

    const meta = output.meta as InspiredesignWorkflowMeta;
    const artifactPath = String(output.artifact_path);
    const evidence = JSON.parse(readFileSync(join(artifactPath, "evidence.json"), "utf8")) as InspiredesignWorkflowEvidence;
    const motionEvidence = JSON.parse(readFileSync(join(artifactPath, "motion-evidence.json"), "utf8")) as {
      motionEvidence: Array<{ motion: { status: string; authority: string; failure?: string; diagnosticReasons: string[] } }>;
    };

    expect(output).toEqual(expect.objectContaining({
      ready: false,
      productSuccess: false,
      artifactAuthority: "diagnostic_only",
      rankedReferenceCount: 0
    }));
    expect(meta.metrics).toEqual(expect.objectContaining({
      captured_references: 0,
      failed_captures: 1,
      all_attempt_motion_failure_count: 1
    }));
    expect(evidence.references[0]).toEqual(expect.objectContaining({
      captureStatus: "failed",
      captureFailure: "Motion evidence output directory did not match the workflow capture plan."
    }));
    expect(motionEvidence.motionEvidence[0]?.motion).toEqual(expect.objectContaining({
      status: "failed",
      authority: "diagnostic",
      failure: "Motion evidence output directory did not match the workflow capture plan.",
      diagnosticReasons: expect.arrayContaining(["motion_artifact_finalization_failed"])
    }));
    expect(meta.artifact_manifest.files).not.toEqual(expect.arrayContaining([
      expect.stringContaining("motion-evidence/7bf52aee6e56/replay.json")
    ]));
  });

  it("rejects motion evidence output directories nested under the planned capture directory", async () => {
    const outputDir = makeOutputDir();

    const output = await runInspiredesignWorkflow(toRuntime({
      fetch: async (input: { url: string }) => makeAggregate({
        records: [
          normalizeRecord("social/pinterest", "social", {
            url: input.url,
            title: "Pinterest video pin reference",
			content: "<video data-test-id=\"video\">Video pin with cinematic motion and premium product reveal</video>"
          })
        ]
      })
    }), {
      brief: "Design a premium motion-led product story",
      harvest: true,
      providers: ["social/pinterest"],
      urls: ["https://www.pinterest.com/pin/77654985208435505/"],
      outputDir,
      mode: "path",
      visualEvidence: "required"
    }, {
      captureMotionEvidence: async (_url, options) => {
        if (!options.outputDir) throw new Error("motion output dir missing");
        const nestedOutputDir = join(options.outputDir, "nested");
        mkdirSync(nestedOutputDir, { recursive: true });
        const manifestPath = join(nestedOutputDir, "replay.json");
        const previewPath = join(nestedOutputDir, "preview.png");
        writeFileSync(manifestPath, JSON.stringify({ frames: [{ index: 1 }] }));
        writeFileSync(previewPath, Buffer.from("preview png"));
        return {
          status: "captured",
          kind: "screencast",
          capturedAt: "2026-05-23T00:01:00.000Z",
          sourceUrl: _url,
          replay: { tempPath: manifestPath },
          preview: { tempPath: previewPath },
          outputDir: nestedOutputDir,
          frameCount: 1,
          warnings: [],
          diagnostic: false,
          diagnosticReasons: []
        };
      }
    });

    const artifactPath = String(output.artifact_path);
    const evidence = JSON.parse(readFileSync(join(artifactPath, "evidence.json"), "utf8")) as InspiredesignWorkflowEvidence;

    expect(output).toEqual(expect.objectContaining({
      productSuccess: false,
      artifactAuthority: "diagnostic_only",
      rankedReferenceCount: 0
    }));
    expect(evidence.references[0]).toEqual(expect.objectContaining({
      captureStatus: "failed",
      captureFailure: "Motion evidence output directory did not match the workflow capture plan."
    }));
    expect(output.meta).toEqual(expect.objectContaining({
      artifactAuthority: "diagnostic_only"
    }));
  });

  it("rejects decoy replay and preview files that were not returned by runtime motion capture", async () => {
    const outputDir = makeOutputDir();

    const output = await runInspiredesignWorkflow(toRuntime({
      fetch: async (input: { url: string }) => makeAggregate({
        records: [
          normalizeRecord("social/pinterest", "social", {
            url: input.url,
            title: "Pinterest video pin reference",
			content: "<video data-test-id=\"video\">Video pin with cinematic motion and premium product reveal</video>"
          })
        ]
      })
    }), {
      brief: "Design a premium motion-led product story",
      harvest: true,
      providers: ["social/pinterest"],
      urls: ["https://www.pinterest.com/pin/77654985208435505/"],
      outputDir,
      mode: "path",
      visualEvidence: "required"
    }, {
      captureMotionEvidence: async (_url, options) => {
        if (!options.outputDir) throw new Error("motion output dir missing");
        mkdirSync(options.outputDir, { recursive: true });
        writeFileSync(join(options.outputDir, "replay.json"), JSON.stringify({ frames: [{ index: 1 }] }));
        writeFileSync(join(options.outputDir, "preview.png"), Buffer.alloc(2048, 1));
        return {
          status: "captured",
          kind: "screencast",
          capturedAt: "2026-05-23T00:01:00.000Z",
          sourceUrl: _url,
          startedSourceUrl: _url,
          endedSourceUrl: _url,
          pinterestPageQuality: "pin_media",
          startedPinterestPageQuality: "pin_media",
          endedPinterestPageQuality: "pin_media",
          replay: { tempPath: join(options.outputDir, "missing-replay.json") },
          preview: { tempPath: join(options.outputDir, "missing-preview.png") },
          outputDir: options.outputDir,
          frameCount: 3,
          warnings: [],
          diagnostic: false,
          diagnosticReasons: []
        };
      }
    });

    const artifactPath = String(output.artifact_path);
    const meta = output.meta as InspiredesignWorkflowMeta;
    const motionEvidence = JSON.parse(readFileSync(join(artifactPath, "motion-evidence.json"), "utf8")) as {
      motionEvidence: Array<{ motion: { status: string; authority: string; failure?: string; diagnosticReasons: string[] } }>;
    };

    expect(output).toEqual(expect.objectContaining({
      ready: false,
      productSuccess: false,
      artifactAuthority: "diagnostic_only",
      rankedReferenceCount: 0
    }));
    expect(motionEvidence.motionEvidence[0]?.motion).toEqual(expect.objectContaining({
      status: "failed",
      authority: "diagnostic",
      failure: "Motion evidence artifacts were not available for design review.",
      diagnosticReasons: expect.arrayContaining(["motion_artifacts_missing"])
    }));
    expect(meta.artifact_manifest.files).not.toEqual(expect.arrayContaining([
      "motion-evidence/7bf52aee6e56/replay.json",
      "motion-evidence/7bf52aee6e56/preview.png"
    ]));
  });

  it("rejects captured Pinterest motion evidence when no reviewable motion artifacts were bundled", async () => {
    const outputDir = makeOutputDir();

    const output = await runInspiredesignWorkflow(toRuntime({
      fetch: async (input: { url: string }) => makeAggregate({
        records: [
          normalizeRecord("social/pinterest", "social", {
            url: input.url,
            title: "Pinterest video pin reference",
			content: "<video data-test-id=\"video\">Video pin with cinematic motion and premium product reveal</video>"
          })
        ]
      })
    }), {
      brief: "Design a premium motion-led product story",
      harvest: true,
      providers: ["social/pinterest"],
      urls: ["https://www.pinterest.com/pin/77654985208435505/"],
      outputDir,
      mode: "path",
      visualEvidence: "required"
    }, {
      captureMotionEvidence: async (_url, options) => {
        if (!options.outputDir) throw new Error("motion output dir missing");
        mkdirSync(options.outputDir, { recursive: true });
        return {
          status: "captured",
          kind: "screencast",
          capturedAt: "2026-05-23T00:01:00.000Z",
          outputDir: options.outputDir,
          frameCount: 3,
          warnings: [],
          diagnostic: false,
          diagnosticReasons: []
        };
      }
    });

    const artifactPath = String(output.artifact_path);
    const motionEvidence = JSON.parse(readFileSync(join(artifactPath, "motion-evidence.json"), "utf8")) as {
      motionEvidence: Array<{ motion: { status: string; authority: string; failure?: string; diagnosticReasons: string[] } }>;
    };
    const meta = output.meta as InspiredesignWorkflowMeta;
    const evidence = JSON.parse(readFileSync(join(artifactPath, "evidence.json"), "utf8")) as InspiredesignWorkflowEvidence;

    expect(output).toEqual(expect.objectContaining({
      ready: false,
      productSuccess: false,
      artifactAuthority: "diagnostic_only",
      rankedReferenceCount: 0
    }));
    expect(meta.metrics).toEqual(expect.objectContaining({
      captured_references: 0,
      failed_captures: 1,
      all_attempt_motion_failure_count: 1
    }));
    expect(evidence.references[0]).toEqual(expect.objectContaining({
      captureStatus: "failed",
      captureFailure: "Motion evidence artifacts were not available for design review."
    }));
    expect(motionEvidence.motionEvidence[0]?.motion).toEqual(expect.objectContaining({
      status: "failed",
      authority: "diagnostic",
      failure: "Motion evidence artifacts were not available for design review.",
      diagnosticReasons: expect.arrayContaining(["motion_artifacts_missing"])
    }));
    expect(meta.artifact_manifest.files).not.toEqual(expect.arrayContaining([
      expect.stringContaining("motion-evidence/7bf52aee6e56/replay.json")
    ]));
  });

  it("rejects frame-only Pinterest motion evidence without a preview artifact", async () => {
    const outputDir = makeOutputDir();

    const output = await runInspiredesignWorkflow(toRuntime({
      fetch: async (input: { url: string }) => makeAggregate({
        records: [
          normalizeRecord("social/pinterest", "social", {
            url: input.url,
            title: "Pinterest video pin reference",
			content: "<video data-test-id=\"video\">Video pin with cinematic motion and premium product reveal</video>"
          })
        ]
      })
    }), {
      brief: "Design a premium motion-led product story",
      harvest: true,
      providers: ["social/pinterest"],
      urls: ["https://www.pinterest.com/pin/77654985208435505/"],
      outputDir,
      mode: "path",
      visualEvidence: "required"
    }, {
      captureMotionEvidence: async (_url, options) => {
        if (!options.outputDir) throw new Error("motion output dir missing");
        mkdirSync(join(options.outputDir, "frames"), { recursive: true });
        const manifestPath = join(options.outputDir, "replay.json");
        writeFileSync(manifestPath, JSON.stringify({ frames: [{ index: 1 }] }));
        writeFileSync(join(options.outputDir, "frames", "000001.png"), Buffer.from("frame 1"));
        return {
          status: "captured",
          kind: "screencast",
          capturedAt: "2026-05-23T00:01:00.000Z",
          sourceUrl: _url,
          replay: { tempPath: manifestPath },
          outputDir: options.outputDir,
          frameCount: 1,
          warnings: [],
          diagnostic: false,
          diagnosticReasons: []
        };
      }
    });

    const artifactPath = String(output.artifact_path);
    const motionEvidence = JSON.parse(readFileSync(join(artifactPath, "motion-evidence.json"), "utf8")) as {
      motionEvidence: Array<{ motion: { status: string; authority: string; failure?: string; diagnosticReasons: string[] } }>;
    };

    expect(output).toEqual(expect.objectContaining({
      ready: false,
      productSuccess: false,
      artifactAuthority: "diagnostic_only",
      rankedReferenceCount: 0
    }));
    expect(motionEvidence.motionEvidence[0]?.motion).toEqual(expect.objectContaining({
      status: "failed",
      authority: "diagnostic",
      failure: "Motion evidence artifacts were not available for design review.",
      diagnosticReasons: expect.arrayContaining(["motion_artifacts_missing"])
    }));
  });

  it("rejects excessive motion frame artifacts from planned capture directories", async () => {
    const outputDir = makeOutputDir();

    const output = await runInspiredesignWorkflow(toRuntime({
      fetch: async (input: { url: string }) => makeAggregate({
        records: [
          normalizeRecord("social/pinterest", "social", {
            url: input.url,
            title: "Pinterest video pin reference",
			content: "<video data-test-id=\"video\">Video pin with cinematic motion and premium product reveal</video>"
          })
        ]
      })
    }), {
      brief: "Design a premium motion-led product story",
      harvest: true,
      providers: ["social/pinterest"],
      urls: ["https://www.pinterest.com/pin/77654985208435505/"],
      outputDir,
      mode: "path",
      visualEvidence: "required"
    }, {
      captureMotionEvidence: async (_url, options) => {
        const motionOutputDir = options.outputDir;
        mkdirSync(join(motionOutputDir, "frames"), { recursive: true });
        const manifestPath = join(motionOutputDir, "replay.json");
        writeFileSync(manifestPath, JSON.stringify({ frames: [{ index: 1 }] }));
        writeFileSync(join(motionOutputDir, "frames", "000001.png"), Buffer.from("frame 1"));
        writeFileSync(join(motionOutputDir, "frames", "000002.png"), Buffer.from("frame 2"));
        writeFileSync(join(motionOutputDir, "frames", "000003.png"), Buffer.from("frame 3"));
        writeFileSync(join(motionOutputDir, "frames", "000004.png"), Buffer.from("frame 4"));
        return {
          status: "captured",
          kind: "screencast",
          capturedAt: "2026-05-23T00:01:00.000Z",
          replay: { tempPath: manifestPath },
          outputDir: motionOutputDir,
          frameCount: 4,
          warnings: [],
          diagnostic: false,
          diagnosticReasons: []
        };
      }
    });

    const artifactPath = String(output.artifact_path);
    const evidence = JSON.parse(readFileSync(join(artifactPath, "evidence.json"), "utf8")) as InspiredesignWorkflowEvidence;
    const motionEvidence = JSON.parse(readFileSync(join(artifactPath, "motion-evidence.json"), "utf8")) as {
      motionEvidence: Array<{ motion: { status: string; authority: string; failure?: string; diagnosticReasons: string[] } }>;
    };

    expect(output).toEqual(expect.objectContaining({
      ready: false,
      productSuccess: false,
      artifactAuthority: "diagnostic_only",
      rankedReferenceCount: 0
    }));
    expect(evidence.references[0]).toEqual(expect.objectContaining({
      captureStatus: "failed",
      captureFailure: "Motion evidence artifact finalization exceeded the frame file limit."
    }));
    expect(motionEvidence.motionEvidence[0]?.motion).toEqual(expect.objectContaining({
      status: "failed",
      authority: "diagnostic",
      failure: "Motion evidence artifact finalization exceeded the frame file limit.",
      diagnosticReasons: expect.arrayContaining(["motion_artifact_finalization_failed"])
    }));
  });

  it("records zero-frame Pinterest video captures as diagnostic motion evidence", async () => {
    const outputDir = makeOutputDir();
    const output = await runInspiredesignWorkflow(toRuntime({
      fetch: async (input: { url: string }) => makeAggregate({
        records: [
          normalizeRecord("social/pinterest", "social", {
            url: input.url,
            title: "Pinterest video pin reference",
			content: "<video data-test-id=\"video\">Video pin with playback controls only</video>"
          })
        ]
      })
    }), {
      brief: "Design a premium motion-led product story",
      harvest: true,
      providers: ["social/pinterest"],
      urls: ["https://www.pinterest.com/pin/87654985208435505/"],
      outputDir,
      mode: "path",
      visualEvidence: "required"
    }, {
      captureMotionEvidence: async () => ({
        status: "captured",
        kind: "screencast",
        capturedAt: "2026-05-23T00:02:00.000Z",
        frameCount: 0,
        warnings: ["controls_only_capture"],
        diagnostic: true,
        diagnosticReasons: ["zero_frame_capture", "controls_only_capture"]
      })
    });

    const meta = output.meta as InspiredesignWorkflowMeta;
    const artifactPath = String(output.artifact_path);
    const motionEvidence = JSON.parse(readFileSync(join(artifactPath, "motion-evidence.json"), "utf8")) as {
      motionEvidence: Array<{
        motion: {
          frameCount: number;
          authority: string;
          diagnostic: boolean;
          diagnosticReasons: string[];
          replay?: { path: string };
          replayHtml?: { path: string };
          preview?: { path: string };
        };
      }>;
    };

    expect(motionEvidence.motionEvidence[0]?.motion).toEqual(expect.objectContaining({
      frameCount: 0,
      authority: "diagnostic",
      diagnostic: true,
      diagnosticReasons: expect.arrayContaining(["zero_frame_capture", "controls_only_capture"])
    }));
    expect(output).toEqual(expect.objectContaining({
      ready: false,
      productSuccess: false,
      artifactAuthority: "diagnostic_only",
      rankedReferenceCount: 0
    }));
    expect(existsSync(join(artifactPath, "canvas-plan.request.json"))).toBe(false);
    expect(meta.metrics).toEqual(expect.objectContaining({
      attempted_reference_count: 1,
      all_attempt_failed_capture_count: 0,
      all_attempt_missing_screenshot_count: 1,
      all_attempt_visual_failure_count: 1,
      all_attempt_motion_failure_count: 1
    }));
    expect(motionEvidence.motionEvidence[0]?.motion.replay).toBeUndefined();
    expect(motionEvidence.motionEvidence[0]?.motion.replayHtml).toBeUndefined();
    expect(motionEvidence.motionEvidence[0]?.motion.preview).toBeUndefined();
    expect(meta.artifact_manifest.files).not.toContain("motion-evidence/87654985208435505/replay.json");
  });

  it("does not promote diagnostic-only motion or run deep capture for Pinterest video pins", async () => {
    const captureMotionEvidence = vi.fn(async () => ({
      status: "captured" as const,
      kind: "screencast" as const,
      capturedAt: "2026-05-23T00:02:00.000Z",
      frameCount: 0,
      warnings: ["controls_only_capture"],
      diagnostic: true,
      diagnosticReasons: ["zero_frame_capture", "controls_only_capture"]
    }));
    const captureReference = vi.fn(async () => makeCapture("Deep diagnostics should not run for Pinterest harvest."));

    const output = await runInspiredesignWorkflow(toRuntime({
      fetch: async (input: { url: string }) => makeAggregate({
        records: [
          normalizeRecord("social/pinterest", "social", {
            url: input.url,
            title: "Pinterest video pin reference",
			content: "<video data-test-id=\"video\">Video pin with playback controls only</video>"
          })
        ]
      })
    }), {
      brief: "Design a premium motion-led product story",
      harvest: true,
      providers: ["social/pinterest"],
      urls: ["https://www.pinterest.com/pin/87654985208435505/"],
      outputDir: makeOutputDir(),
      mode: "json",
      visualEvidence: "off",
      captureMode: "deep"
    }, {
      captureMotionEvidence,
      captureReference
    });

    const evidence = output.evidence as InspiredesignWorkflowEvidence;
    const meta = output.meta as InspiredesignWorkflowMeta;

    expect(captureMotionEvidence).toHaveBeenCalledTimes(1);
    expect(captureReference).not.toHaveBeenCalled();
    expect(evidence.references[0]).toMatchObject({
      captureStatus: "off"
    });
    expect(meta.metrics).toEqual(expect.objectContaining({
      captured_references: 0,
      failed_captures: 0,
      all_attempt_motion_failure_count: 0
    }));
    expect(output).toEqual(expect.objectContaining({
      productSuccess: false,
      artifactAuthority: "diagnostic_only"
    }));
  });

  it("does not promote failed primary motion capture or run deep diagnostics", async () => {
    const outputDir = makeOutputDir();
    const captureReference = vi.fn(async () => makeCapture("Deep diagnostic capture still ran after primary motion failure."));
    const captureMotionEvidence = vi.fn(async () => {
      throw new Error("primary screencast helper crashed");
    });

    const output = await runInspiredesignWorkflow(toRuntime({
      fetch: async (input: { url: string }) => makeAggregate({
        records: [
          normalizeRecord("social/pinterest", "social", {
            url: input.url,
            title: "Pinterest video pin reference",
			content: "<video data-test-id=\"video\">Video pin with cinematic motion and premium product reveal</video>"
          })
        ]
      })
    }), {
      brief: "Design a premium motion-led product story",
      harvest: true,
      providers: ["social/pinterest"],
      urls: ["https://www.pinterest.com/pin/77654985208435505/"],
      outputDir,
      mode: "json",
      visualEvidence: "off",
      captureMode: "deep"
    }, {
      captureMotionEvidence,
      captureReference
    });

    const evidence = output.evidence as InspiredesignWorkflowEvidence;

    expect(captureMotionEvidence).toHaveBeenCalledTimes(1);
    expect(captureReference).not.toHaveBeenCalled();
    expect(evidence.references[0]).toMatchObject({
      captureStatus: "off",
      capture: {
        visual: {
          status: "skipped",
          failure: "Visual evidence is disabled for this run.",
          warnings: ["policy:visual_evidence_off"]
        }
      }
    });
    expect(output).toEqual(expect.objectContaining({
      productSuccess: false,
      artifactAuthority: "diagnostic_only"
    }));
  });

  it("fails zero-byte required screenshot artifacts without indexing them", async () => {
    const outputDir = makeOutputDir();
    const runtime = toRuntime({
      fetch: async (input: { url: string }) => makeAggregate({
        records: [
          normalizeRecord("web/default", "web", {
            url: input.url,
            title: "Empty visual reference",
            content: "Cinematic hero reference"
          })
        ]
      })
    });

    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Design a visual harvest landing page",
      urls: ["https://example.com/empty-visual"],
      outputDir,
      mode: "path",
      visualEvidence: "required"
    }, {
      captureReference: async (_url, options) => {
        if (!options?.visualEvidencePath) {
          throw new Error("visual evidence path missing");
        }
        writeFileSync(options.visualEvidencePath, Buffer.alloc(0));
        return {
          ...makeCapture("Empty visual reference"),
          visual: {
            status: "captured",
            kind: "viewport",
            fullPage: false,
            capturedAt: "2026-05-18T00:00:00.000Z",
            tempPath: options.visualEvidencePath,
            warnings: []
          }
        };
      }
    });

    const meta = output.meta as InspiredesignWorkflowMeta;
    const artifactPath = String(output.artifact_path);
    const visualEvidence = JSON.parse(readFileSync(join(artifactPath, "visual-evidence.json"), "utf8")) as {
      visualEvidence: Array<{ visual: { status: string; path?: string; failure?: string; warnings: string[] } }>;
    };
    const screenshotIndex = JSON.parse(readFileSync(join(artifactPath, "screenshot-index.json"), "utf8")) as {
      screenshots: unknown[];
    };
    const rankedReferences = JSON.parse(readFileSync(join(artifactPath, "ranked-references.json"), "utf8")) as {
      qualitySummary: {
        attemptedReferenceCount?: number;
        allAttemptFailedCaptureCount?: number;
        allAttemptMissingScreenshotCount?: number;
        allAttemptVisualFailureCount?: number;
      };
    };

    expect(meta.metrics.failed_captures).toBe(1);
    expect(meta.metrics).toEqual(expect.objectContaining({
      attempted_reference_count: 1,
      all_attempt_failed_capture_count: 1,
      all_attempt_missing_screenshot_count: 1,
      all_attempt_visual_failure_count: 1
    }));
    expect(rankedReferences.qualitySummary).toEqual(expect.objectContaining({
      attemptedReferenceCount: 1,
      allAttemptFailedCaptureCount: 1,
      allAttemptMissingScreenshotCount: 1,
      allAttemptVisualFailureCount: 1
    }));
    expect(visualEvidence.visualEvidence[0]?.visual).toEqual(expect.objectContaining({
      status: "failed",
      failure: "Visual evidence screenshot file was empty.",
      warnings: expect.arrayContaining(["finalize_failed"])
    }));
    expect(visualEvidence.visualEvidence[0]?.visual.path).toBeUndefined();
    expect(screenshotIndex.screenshots).toEqual([]);
  });

  it.each<ProviderReasonCode>([
    "policy_blocked",
    "auth_required",
    "challenge_detected",
    "rate_limited"
  ])("does not deep capture top-level %s visual blockers", async (reasonCode) => {
    const outputDir = makeOutputDir();
    const captureReference = vi.fn(async () => makeCapture("Blocked reference"));
    const runtime = toRuntime({
      fetch: async () => makeAggregate({
        ok: false,
        records: [],
        error: {
          code: reasonCode === "auth_required" ? "auth" : "unavailable",
          message: `${reasonCode} blocked reference`,
          retryable: false,
          reasonCode
        },
        metrics: { attempted: 1, succeeded: 0, failed: 1, retries: 0, latencyMs: 1 }
      })
    });

    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Design a visual harvest landing page",
      urls: [`https://example.com/${reasonCode}`],
      outputDir,
      mode: "path",
      visualEvidence: "required"
    }, {
      captureReference
    });

    const meta = output.meta as InspiredesignWorkflowMeta;
    const artifactPath = String(output.artifact_path);
    const evidence = JSON.parse(readFileSync(join(artifactPath, "evidence.json"), "utf8")) as InspiredesignWorkflowEvidence;
    const visualEvidence = JSON.parse(readFileSync(join(artifactPath, "visual-evidence.json"), "utf8")) as {
      visualEvidence: Array<{ visual: { status: string; path?: string; failure?: string; warnings: string[] } }>;
    };

    expect(captureReference).not.toHaveBeenCalled();
    expect(meta.metrics.captured_references).toBe(0);
    expect(meta.metrics.failed_captures).toBe(0);
    expect(meta.metrics.reasonCodeDistribution).toEqual(expect.objectContaining({
      [reasonCode]: 1
    }));
    expect(meta.primaryConstraint).toEqual(expect.objectContaining({
      reasonCode
    }));
    expect(evidence.references[0]).toEqual(expect.objectContaining({
      fetchStatus: "failed",
      captureStatus: "off",
      fetchFailure: expect.any(String)
    }));
    expect(visualEvidence.visualEvidence[0]?.visual).toEqual(expect.objectContaining({
      status: "skipped",
      warnings: [`policy:${reasonCode}`]
    }));
  });

  it("captures partial success records even when another provider reports a blocker", async () => {
    const outputDir = makeOutputDir();
    const captureReference = vi.fn(async (url: string) => makeCapture(`Captured ${url}`));
    const runtime = toRuntime({
      fetch: async (input: { url: string }) => makeAggregate({
        partial: true,
        records: [
          normalizeRecord("web/default", "web", {
            url: input.url,
            title: "Usable visual reference",
            content: "Full-bleed landing page reference"
          })
        ],
        failures: [
          makeFailure("social/pinterest", "social", {
            reasonCode: "auth_required",
            message: "Pinterest auth required"
          })
        ],
        metrics: { attempted: 2, succeeded: 1, failed: 1, retries: 0, latencyMs: 1 }
      })
    });

    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Design a visual harvest landing page",
      urls: ["https://example.com/partial-success"],
      outputDir,
      mode: "path",
      visualEvidence: "auto"
    }, {
      captureReference
    });

    const meta = output.meta as InspiredesignWorkflowMeta;
    const artifactPath = String(output.artifact_path);
    const evidence = JSON.parse(readFileSync(join(artifactPath, "evidence.json"), "utf8")) as InspiredesignWorkflowEvidence;

    expect(captureReference).toHaveBeenCalledTimes(1);
    expect(meta.metrics.captured_references).toBe(1);
    expect(evidence.references[0]).toEqual(expect.objectContaining({
      fetchStatus: "captured",
      captureStatus: "captured"
    }));
  });

  it("accepts Pinterest provider URL recovery without query", async () => {
    const output = await runInspiredesignWorkflow(toRuntime({}), {
      brief: "Design a visual harvest landing page",
      harvest: true,
      providers: ["social/pinterest"],
      urls: ["https://www.pinterest.com/pin/27654985208435505/"],
      mode: "json"
    });

    const meta = output.meta as InspiredesignWorkflowMeta;
    expect(meta.selection).toEqual(expect.objectContaining({
      providers: ["social/pinterest"],
      urls: ["https://www.pinterest.com/pin/27654985208435505"]
    }));
  });

  it("rejects invalid workflow harvest discovery inputs without clamping", async () => {
    const runtime = toRuntime({});
    await expect(runInspiredesignWorkflow(runtime, {
      brief: "Design a visual harvest landing page",
      query: "premium references"
    })).rejects.toThrow("query is only supported when harvest is true");
    await expect(runInspiredesignWorkflow(runtime, {
      brief: "Design a visual harvest landing page",
      harvest: true,
      providers: ["web/default"]
    })).rejects.toThrow("Provider-scoped URL recovery requires at least one URL");
    await expect(runInspiredesignWorkflow(runtime, {
      brief: "Design a visual harvest landing page",
      providers: ["social/pinterest"],
      urls: ["https://www.pinterest.com/pin/27654985208435505/"]
    })).rejects.toThrow("providers require query unless harvest uses compatible URL recovery");
    await expect(runInspiredesignWorkflow(runtime, {
      brief: "Design a visual harvest landing page",
      harvest: true,
      providers: ["web/default"],
      urls: ["https://www.pinterest.com/pin/27654985208435505/"]
    })).rejects.toThrow("Provider web/default does not support URL-only site recipe recovery");
    await expect(runInspiredesignWorkflow(runtime, {
      brief: "Design a visual harvest landing page",
      harvest: true,
      query: "premium references",
      providers: ["social/pinterest"],
      urls: ["https://www.pinterest.com/search/pins/?q=studio"]
    })).rejects.toThrow(
      "URL https://www.pinterest.com/search/pins?q=studio is not a canonical social/pinterest reference URL for provider-scoped recovery."
    );
    await expect(runInspiredesignWorkflow(runtime, {
      brief: "Design a visual harvest landing page",
      harvest: true,
      query: "premium references",
      providers: ["social/pinterest", "web/default"],
      urls: ["https://pinterest.example.com/pin/27654985208435505/"]
    })).rejects.toThrow(
      "URL https://pinterest.example.com/pin/27654985208435505 is not a canonical social/pinterest reference URL for provider-scoped recovery."
    );
    await expect(runInspiredesignWorkflow(runtime, {
      brief: "Design a visual harvest landing page",
      harvest: true,
      query: "premium references",
      maxReferences: 11
    })).rejects.toThrow("maxReferences must be an integer from 1 to 10");
    await expect(runInspiredesignWorkflow(runtime, {
      brief: "Design a visual harvest landing page",
      harvest: true,
      query: "premium references",
      maxReferences: 1.5
    })).rejects.toThrow("maxReferences must be an integer from 1 to 10");
    await expect(runInspiredesignWorkflow(runtime, {
      brief: "Design a visual harvest landing page",
      harvest: true
    })).rejects.toThrow("harvest requires query or URL references");
  });

  it("marks required visual evidence as failed when screenshot metadata is unavailable", async () => {
    const outputDir = makeOutputDir();
    const runtime = toRuntime({
      fetch: async (input: { url: string }) => makeAggregate({
        records: [normalizeRecord("web/default", "web", {
          url: input.url,
          title: "Visual reference",
          content: "Cinematic hero reference"
        })]
      })
    });

    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Design a visual harvest landing page",
      urls: ["https://example.com/visual-unavailable"],
      outputDir,
      mode: "path",
      visualEvidence: "required"
    }, {
      captureReference: async () => makeCapture("Visual reference without screenshot")
    });

    const meta = output.meta as InspiredesignWorkflowMeta;
    const artifactPath = String(output.artifact_path);
    const evidence = JSON.parse(readFileSync(join(artifactPath, "evidence.json"), "utf8")) as InspiredesignWorkflowEvidence;
    const visualEvidence = JSON.parse(readFileSync(join(artifactPath, "visual-evidence.json"), "utf8")) as {
      visualEvidence: Array<{ visual: { status: string; path?: string; failure?: string; warnings: string[] } }>;
    };

    expect(meta.metrics.failed_captures).toBe(1);
    expect(evidence.references[0]).toEqual(expect.objectContaining({
      captureStatus: "failed",
      captureFailure: "Required visual evidence was not captured."
    }));
    expect(visualEvidence.visualEvidence[0]?.visual).toEqual(expect.objectContaining({
      status: "failed",
      failure: "Required visual evidence was not captured.",
      warnings: ["required_visual_evidence_missing"]
    }));
    expect(visualEvidence.visualEvidence[0]?.visual.path).toBeUndefined();
  });

  it("records required visual evidence failure when the capture lane is unavailable", async () => {
    const outputDir = makeOutputDir();
    const runtime = toRuntime({
      fetch: async (input: { url: string }) => makeAggregate({
        records: [normalizeRecord("web/default", "web", {
          url: input.url,
          title: "Visual reference",
          content: "Cinematic hero reference"
        })]
      })
    });

    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Design a visual harvest landing page",
      urls: ["https://example.com/no-capture-lane"],
      outputDir,
      mode: "path",
      visualEvidence: "required"
    });

    const artifactPath = String(output.artifact_path);
    const evidence = JSON.parse(readFileSync(join(artifactPath, "evidence.json"), "utf8")) as InspiredesignWorkflowEvidence;
    const visualEvidence = JSON.parse(readFileSync(join(artifactPath, "visual-evidence.json"), "utf8")) as {
      visualEvidence: Array<{ visual: { status: string; path?: string; failure?: string; warnings: string[] } }>;
    };

    expect(evidence.references[0]).toEqual(expect.objectContaining({
      captureStatus: "failed",
      captureFailure: "Deep capture requested, but browser capture is unavailable in this execution lane."
    }));
    expect(visualEvidence.visualEvidence[0]?.visual).toEqual(expect.objectContaining({
      status: "failed",
      failure: "Deep capture requested, but browser capture is unavailable in this execution lane.",
      warnings: ["required_visual_evidence_missing"]
    }));
    expect(visualEvidence.visualEvidence[0]?.visual.path).toBeUndefined();
  });

  it("marks required visual evidence as failed when screenshot finalization fails", async () => {
    const outputDir = makeOutputDir();
    let plannedTempPath = "";
    const runtime = toRuntime({
      fetch: async (input: { url: string }) => makeAggregate({
        records: [normalizeRecord("web/default", "web", {
          url: input.url,
          title: "Visual reference",
          content: "Cinematic hero reference"
        })]
      })
    });

    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Design a visual harvest landing page",
      urls: ["https://example.com/visual-finalize-failure"],
      outputDir,
      mode: "path",
      visualEvidence: "required"
    }, {
      captureReference: async (_url, options) => {
        plannedTempPath = options?.visualEvidencePath ?? "/tmp/missing-inspiredesign-visual.png";
        return {
          ...makeCapture("Visual reference finalize failure"),
          visual: {
            status: "captured",
            kind: "viewport",
            fullPage: false,
            capturedAt: "2026-05-18T00:00:00.000Z",
            tempPath: plannedTempPath,
            warnings: "/tmp/private/warning.png" as unknown as string[]
          }
        };
      }
    });

    const meta = output.meta as InspiredesignWorkflowMeta;
    const artifactPath = String(output.artifact_path);
    const evidenceJson = readFileSync(join(artifactPath, "evidence.json"), "utf8");
    const visualEvidenceJson = readFileSync(join(artifactPath, "visual-evidence.json"), "utf8");
    const screenshotIndexJson = readFileSync(join(artifactPath, "screenshot-index.json"), "utf8");
    const evidence = JSON.parse(evidenceJson) as InspiredesignWorkflowEvidence;
    const visualEvidence = JSON.parse(visualEvidenceJson) as {
      visualEvidence: Array<{ visual: { status: string; path?: string; failure?: string; warnings: string[] } }>;
    };
    const screenshotIndex = JSON.parse(screenshotIndexJson) as {
      screenshots: unknown[];
    };

    expect(meta.metrics.failed_captures).toBe(1);
    expect(evidence.references[0]).toEqual(expect.objectContaining({
      captureStatus: "failed"
    }));
    expect(visualEvidence.visualEvidence[0]?.visual.status).toBe("failed");
    expect(visualEvidence.visualEvidence[0]?.visual.failure).toBe("Visual evidence screenshot file was unavailable.");
    expect(visualEvidence.visualEvidence[0]?.visual.warnings).toContain("finalize_failed");
    expect(visualEvidence.visualEvidence[0]?.visual.path).toBeUndefined();
    expect(screenshotIndex.screenshots).toEqual([]);
    for (const jsonText of [evidenceJson, visualEvidenceJson, screenshotIndexJson]) {
      expect(jsonText).not.toContain(plannedTempPath);
      expect(jsonText).not.toContain(tmpdir());
    }
  });

  it("records required visual evidence failure when transport times out before visual capture", async () => {
    const outputDir = makeOutputDir();
    const runtime = toRuntime({
      fetch: async (input: { url: string }) => makeAggregate({
        records: [normalizeRecord("web/default", "web", {
          url: input.url,
          title: "Visual reference",
          content: "Cinematic hero reference"
        })]
      })
    });

    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Design a visual harvest landing page",
      urls: ["https://example.com/visual-timeout"],
      outputDir,
      mode: "path",
      visualEvidence: "required"
    }, {
      captureReference: async () => ({
        attempts: {
          snapshot: { status: "failed", detail: "Deep capture snapshot exceeded timeout budget." },
          clone: { status: "skipped", detail: "Skipped after snapshot capture transport timeout." },
          dom: { status: "skipped", detail: "Skipped after snapshot capture transport timeout." }
        }
      })
    });

    const artifactPath = String(output.artifact_path);
    const evidence = JSON.parse(readFileSync(join(artifactPath, "evidence.json"), "utf8")) as InspiredesignWorkflowEvidence;
    const visualEvidence = JSON.parse(readFileSync(join(artifactPath, "visual-evidence.json"), "utf8")) as {
      visualEvidence: Array<{ visual: { status: string; failure?: string; warnings: string[] } }>;
    };

    expect(evidence.references[0]).toEqual(expect.objectContaining({
      captureStatus: "failed",
      captureFailure: "Deep capture did not return usable snapshot, DOM, or clone evidence."
    }));
    expect(visualEvidence.visualEvidence[0]?.visual).toEqual(expect.objectContaining({
      status: "failed",
      failure: "Required visual evidence was not captured.",
      warnings: ["required_visual_evidence_missing"]
    }));
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
      visualEvidence: "required",
      includePrototypeGuidance: true
    }, {
      captureReference: async (_url, options) => {
        if (!options?.visualEvidencePath) {
          throw new Error("visual evidence path missing");
        }
        writeFileSync(options.visualEvidencePath, Buffer.from("component visual artifact"));
        return {
          ...makeCapture("Checkout Card Component anatomy props slots state matrix tokens asset pack responsive variants usage rules"),
          visual: {
            status: "captured",
            kind: "viewport",
            fullPage: false,
            capturedAt: "2026-05-26T00:00:00.000Z",
            tempPath: options.visualEvidencePath,
			sourceUrl: _url,
            warnings: []
          },
          attempts: {
          snapshot: { status: "captured" },
          clone: { status: "captured" },
          dom: { status: "skipped", detail: "DOM capture helper unavailable in this execution lane." }
        }
      };
    }
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
    expect(hasForbiddenCanvasRequestKey(canvasRequest)).toBe(false);
  });

  it("defaults to compact mode when inspiredesign input omits an explicit render mode", async () => {
    const runtime = toRuntime({});

    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Design a compact default output"
    });

    expect(output.mode).toBe("compact");
  });

  it("rejects invalid visual evidence modes from direct workflow callers", async () => {
    const runtime = toRuntime({});

    await expect(runInspiredesignWorkflow(runtime, {
      brief: "Design a compact default output",
      visualEvidence: "sometimes"
    } as unknown as Parameters<typeof runInspiredesignWorkflow>[1])).rejects.toThrow(
      "Inspiredesign workflow visualEvidence must be one of off, auto, or required."
    );
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
    expect(Object.keys(meta.metrics)).not.toContain(`media_${"analysis"}`);
  });

  it("discovers query references and keeps explicit URLs first", async () => {
    const fetch = vi.fn(async (input: { url: string }) => makeAggregate({
      records: [
        normalizeRecord("web/default", "web", {
          url: input.url,
          title: `Fetched ${input.url}`,
          content: "Reference content with enough detail for a design excerpt."
        })
      ]
    }));
    const search = vi.fn(async () => makeAggregate({
      records: [
        normalizeRecord("web/default", "web", {
          url: "https://example.com/shared",
          title: "Shared result",
          content: "Shared discovered content."
        }),
        normalizeRecord("web/default", "web", {
          url: "https://example.com/discovered",
          title: "Discovered result",
          content: "Discovered content."
        })
      ]
    }));
    const captureReference = vi.fn(async (url: string) => makeCapture(`Captured ${url}`));
    const runtime = toRuntime({ fetch, search });

    const output = await runInspiredesignWorkflow(runtime, {
      brief: "Design a docs workspace",
      harvest: true,
      query: "premium docs references",
      providers: ["web/default", "web/default"],
      maxReferences: 3,
      visualEvidence: "auto",
      urls: ["https://example.com/explicit", "https://example.com/shared"],
      mode: "context"
    }, {
      captureReference
    });

    const context = output.context as InspiredesignWorkflowContext;
    const meta = output.meta as InspiredesignWorkflowMeta;

    expect(search).toHaveBeenCalledWith(
      { query: "premium docs references", limit: 3 },
      expect.objectContaining({ providerIds: ["web/default"] })
    );
    expect(fetch.mock.calls.map((call) => call[0].url)).toEqual([
      "https://example.com/explicit",
      "https://example.com/shared",
      "https://example.com/discovered"
    ]);
    expect(context.urls).toEqual([
      "https://example.com/explicit",
      "https://example.com/shared",
      "https://example.com/discovered"
    ]);
    expect(meta.selection).toEqual(expect.objectContaining({
      query: "premium docs references",
      providers: ["web/default"],
      max_references: 3,
      visual_evidence: "auto",
      capture_mode: "deep"
    }));
    expect(meta.discovery).toEqual(expect.objectContaining({
      requested: true,
      searchAvailable: true,
      acceptedUrls: ["https://example.com/shared", "https://example.com/discovered"]
    }));
  });

  it("reports unavailable query discovery without crashing", async () => {
    const output = await runInspiredesignWorkflow(toRuntime({}), {
      brief: "Design a docs workspace",
      harvest: true,
      query: "premium docs references",
      mode: "json"
    });

    const meta = output.meta as InspiredesignWorkflowMeta;
    expect(meta.selection.urls).toEqual([]);
    expect(meta.discovery).toEqual(expect.objectContaining({
      requested: true,
      searchAvailable: false,
      failure: "Reference discovery requested, but provider search is unavailable in this execution lane."
    }));
    expect(meta.primaryConstraintSummary).toBe("Reference discovery requested, but provider search is unavailable in this execution lane.");
    expect(meta.primaryConstraint?.summary).toBe("Reference discovery requested, but provider search is unavailable in this execution lane.");
  });

  it("promotes Pinterest browser-native auth failures into discovery constraints", async () => {
    const output = await runInspiredesignWorkflow(toRuntime({}), {
      brief: "Design a docs workspace",
      harvest: true,
      query: "premium docs references",
      providers: ["social/pinterest"],
      browserMode: "managed",
      useCookies: false,
      cookiePolicyOverride: "required",
      mode: "json"
    });

    const meta = output.meta as InspiredesignWorkflowMeta;
    expect(meta.metrics.reasonCodeDistribution).toEqual(expect.objectContaining({
      auth_required: 1
    }));
    expect(meta.primaryConstraint).toEqual(expect.objectContaining({
      reasonCode: "auth_required"
    }));
    expect(meta.primaryConstraintSummary).toBe("Pinterest requires login or an existing session.");
    expect(meta.nextStepGuidance).toEqual(expect.objectContaining({
      readiness: "blocked",
      reasonCode: "pinterest_browser_native_recovery"
    }));
    expect(meta.nextStepGuidance?.primaryAction.summary).toContain("Pinterest browser-native recipe");
    expect(meta.nextStepGuidance?.commands[0]?.command).toContain("--browser-mode extension --use-cookies --cookie-policy required");
    expect(meta.nextStepGuidance?.paramsExamples[0]?.params).toEqual(expect.objectContaining({
      browserMode: "extension",
      useCookies: true,
      cookiePolicy: "required"
    }));
    expect(output.suggestedNextAction).toEqual(meta.nextStepGuidance?.primaryAction.summary);
  });

  it("attempts public Pinterest discovery when cookies are preferred and keeps usable grid URLs", async () => {
    const fetch = vi.fn(async (input: { url: string }) => {
      if (input.url.includes("/search/pins/")) {
        return makeAggregate({
          records: [
            normalizeRecord("social/pinterest", "social", {
              url: input.url,
              title: "Pinterest results grid",
              content: "<a href=\"/pin/61572719900827789/\">Studio reference</a>",
              attributes: {
                html: '<div data-grid-item="true"><a href="/pin/61572719900827789/"><img alt="Photography studio landing page" src="/studio.jpg"></a></div>'
              }
            })
          ]
        });
      }
      return makeAggregate({
        records: [
          normalizeRecord("web/default", "web", {
            url: input.url,
            title: "Photography studio reference",
            content: "A premium photography studio landing page with cinematic portraits, editorial layout, booking CTA, and parallax motion."
          })
        ]
      });
    });
    const captureReference = vi.fn(async (url: string) => makeCapture(`Captured Pinterest reference ${url}`));

    const output = await runInspiredesignWorkflow(toRuntime({ fetch }), {
      brief: "Design a cinematic photography studio landing page",
      harvest: true,
      query: "premium photography studio landing page",
      providers: ["social/pinterest"],
      browserMode: "managed",
      useCookies: false,
      visualEvidence: "off",
      mode: "json"
    }, {
      captureReference
    });

    const meta = output.meta as InspiredesignWorkflowMeta;
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      { url: "https://www.pinterest.com/search/pins/?q=premium+photography+studio+landing+page" },
      expect.objectContaining({
        source: "web",
        runtimePolicy: expect.objectContaining({
          browserMode: "managed",
          useCookies: false
        })
      })
    );
    expect(meta.discovery?.acceptedUrls).toEqual(["https://www.pinterest.com/pin/61572719900827789/"]);
    expect(meta.metrics.reasonCodeDistribution).not.toEqual(expect.objectContaining({
      auth_required: expect.any(Number)
    }));
    expect(output).toEqual(expect.objectContaining({
      ready: false,
      productSuccess: false,
      rankedReferenceCount: 0
    }));
    expect(meta.nextStepGuidance).toEqual(expect.objectContaining({
      readiness: "needs_recovery",
      reasonCode: "pinterest_browser_native_recovery"
    }));
  });

  it("uses the Pinterest browser-native recipe as an authenticated discovery lane", async () => {
    const fetch = vi.fn(async (input: { url: string }) => {
      if (input.url.includes("/search/pins/")) {
        return makeAggregate({
          records: [
            normalizeRecord("social/pinterest", "social", {
              url: input.url,
              title: "Pinterest photography studio results",
              content: '<a href="/pin/61572719900827789/">Studio pin</a><a href="/ideas/web-design-parallax-scrolling/896364491640/">Idea</a>'
            })
          ]
        });
      }
      return makeAggregate({
        records: [
          normalizeRecord("web/default", "web", {
            url: input.url,
            title: "Pinterest photography studio reference",
            content: "A cinematic photography studio landing page reference with portraits, parallax, premium motion cues, and booking CTA."
          })
        ]
      });
    });
    const captureReference = vi.fn(async (url: string) => makeCapture(`Captured Pinterest grid ${url}`));

    const output = await runInspiredesignWorkflow(toRuntime({ fetch }), {
      brief: "Design a cinematic photography studio landing page",
      harvest: true,
      query: "premium photography studio landing page",
      providers: ["social/pinterest"],
      browserMode: "extension",
      useCookies: true,
      cookiePolicyOverride: "required",
      visualEvidence: "off",
      mode: "json"
    }, {
      captureReference
    });

    const meta = output.meta as InspiredesignWorkflowMeta;
    expect(meta.discovery).toEqual(expect.objectContaining({
      siteRecipeId: "social/pinterest",
      acceptedUrls: ["https://www.pinterest.com/pin/61572719900827789/"]
    }));
    expect(meta.discovery?.acceptedUrls).not.toContain(
      "https://www.pinterest.com/ideas/web-design-parallax-scrolling/896364491640/"
    );
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      { url: "https://www.pinterest.com/search/pins/?q=premium+photography+studio+landing+page" },
      expect.objectContaining({
        source: "web",
        runtimePolicy: expect.objectContaining({
          browserMode: "extension",
          useCookies: true,
          cookiePolicyOverride: "required"
        })
      })
    );
    expect(fetch).toHaveBeenCalledWith(
      { url: "https://www.pinterest.com/pin/61572719900827789/" },
      expect.any(Object)
    );
    expect(meta.nextStepGuidance).toEqual(expect.objectContaining({
      readiness: "needs_recovery",
      reasonCode: "pinterest_browser_native_recovery"
    }));
  });

  it("persists Pinterest discovery diagnostics for diagnostic-only broad queries", async () => {
    const outputDir = makeOutputDir();
    const fetch = vi.fn(async (input: { url: string }) => {
      if (input.url.includes("/search/pins/")) {
        return makeAggregate({
          records: [
            normalizeRecord("social/pinterest", "social", {
              url: input.url,
              title: "Pinterest search shell",
              content: "When autocomplete results are available use up and down arrows. Pin card shell only.",
              attributes: {
                links: ["https://example.com/not-pinterest"],
                html: '<main data-grid="search-results"><a href="https://example.com/not-pinterest">External reference</a></main>'
              }
            })
          ]
        });
      }
      return makeAggregate();
    });

    const output = await runInspiredesignWorkflow(toRuntime({ fetch }), {
      brief: "Design a cinematic photography studio landing page",
      harvest: true,
      query: "premium photography studio landing page",
      providers: ["social/pinterest"],
      browserMode: "extension",
      useCookies: true,
      cookiePolicyOverride: "required",
      visualEvidence: "required",
      outputDir,
      mode: "path"
    });

    const artifactPath = String(output.artifact_path);
    const diagnostics = JSON.parse(readFileSync(join(artifactPath, "discovery-diagnostics.json"), "utf8")) as {
      requested: boolean;
      query: string;
      siteRecipeId: string;
      searchUrl: string;
      fetchedRecordCount: number;
      acceptedUrls: string[];
      acceptedUrlCount: number;
      rejectedUrlCount: number;
      failureCount: number;
      reason: string;
      sourcePageQuality: string;
      badStateId: string;
      diagnosticBlockers: string[];
      recoveryAction: string;
    };
    const evidence = JSON.parse(readFileSync(join(artifactPath, "evidence.json"), "utf8")) as {
      discovery?: { acceptedUrlCount: number; reason: string; sourcePageQuality: string };
    };
    const meta = output.meta as InspiredesignWorkflowMeta;

    expect(output).toEqual(expect.objectContaining({
      ready: false,
      productSuccess: false,
      artifactAuthority: "diagnostic_only",
      evidenceAuthority: "diagnostic_only"
    }));
    expect(diagnostics).toEqual(expect.objectContaining({
      requested: true,
      query: "premium photography studio landing page",
      siteRecipeId: "social/pinterest",
      searchUrl: "https://www.pinterest.com/search/pins/?q=premium+photography+studio+landing+page",
      fetchedRecordCount: 1,
      acceptedUrls: [],
      acceptedUrlCount: 0,
      rejectedUrlCount: 0,
      failureCount: 1,
      reason: "env_limited",
      sourcePageQuality: "search_shell",
      badStateId: "search-shell",
      diagnosticBlockers: expect.arrayContaining([
        "search_shell_without_media_signals",
        "search_shell_without_rendered_pin_links"
      ]),
      recoveryAction: expect.stringContaining("rendered canonical pin")
    }));
    expect(JSON.stringify(diagnostics)).not.toMatch(/<main|cookie|token|secret/i);
    expect(evidence.discovery).toEqual(expect.objectContaining({
      acceptedUrlCount: 0,
      reason: "env_limited",
      sourcePageQuality: "search_shell"
    }));
    expect(meta.artifact_manifest.files).toEqual(expect.arrayContaining(["discovery-diagnostics.json"]));
    expect(meta.nextStepGuidance).toEqual(expect.objectContaining({
      readiness: expect.not.stringMatching(/^ready$/)
    }));
  });

  it("recovers a transient broad-query search shell before promoting canonical Pinterest pins", async () => {
    const outputDir = makeOutputDir();
    const canonicalPinUrl = "https://www.pinterest.com/pin/61572719900827789/";
    const fetchOrder: string[] = [];
    const fetch = vi.fn(async (input: { url: string }) => {
      if (input.url.includes("/search/pins/")) {
        fetchOrder.push("search");
        if (fetchOrder.length === 1) {
          return makeAggregate({
            records: [normalizeRecord("social/pinterest", "social", {
              url: input.url,
              title: "Pinterest empty search results",
              content: "Search results for studio",
              attributes: {
                html: '<main aria-label="search results"><p>When autocomplete results are available</p></main>'
              }
            })]
          });
        }
        return makeAggregate({
          records: [makePinterestSearchShellDiscoveryRecord(input.url, canonicalPinUrl)]
        });
      }
      fetchOrder.push("pin");
      expect(input.url).toBe(canonicalPinUrl);
      return makeAggregate({
        records: [makePinterestDiscoveredImagePinRecord(input.url)]
      });
    });
    const captureReference = vi.fn();
    const capturePinMediaEvidence = vi.fn(async (url: string, options: InspiredesignWorkflowPinMediaCaptureOptions) => {
      writeFileSync(options.pinMediaEvidencePath, validPinMediaBytes());
      return makePinterestImagePinMediaCapture(url, options, "https://i.pinimg.com/originals/query-retry-pin.jpg");
    });

    const output = await runInspiredesignWorkflow(toRuntime({ fetch }), {
      brief: "Design a cinematic photography studio landing page",
      harvest: true,
      query: "premium photography studio landing page",
      providers: ["social/pinterest"],
      urls: [],
      browserMode: "extension",
      useCookies: true,
      cookiePolicyOverride: "required",
      visualEvidence: "required",
      outputDir,
      mode: "path"
    }, {
      capturePinMediaEvidence,
      captureReference
    });

    const artifactPath = String(output.artifact_path);
    const discoveryDiagnostics = JSON.parse(readFileSync(join(artifactPath, "discovery-diagnostics.json"), "utf8")) as {
      acceptedUrls: string[];
      sourcePageQuality: string;
    };
    const pinMediaIndex = JSON.parse(readFileSync(join(artifactPath, "pin-media-index.json"), "utf8")) as {
      pinMediaIndex: Array<{ path: string }>;
    };

    expect(fetchOrder).toEqual(["search", "search", "pin"]);
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      { url: "https://www.pinterest.com/search/pins/?q=premium+photography+studio+landing+page" },
      expect.objectContaining({
        runtimePolicy: expect.objectContaining({
          browserMode: "extension",
          useCookies: true,
          cookiePolicyOverride: "required"
        })
      })
    );
    expect(captureReference).not.toHaveBeenCalled();
    expect(capturePinMediaEvidence).toHaveBeenCalledTimes(1);
    expect(discoveryDiagnostics).toEqual(expect.objectContaining({
      acceptedUrls: [canonicalPinUrl],
      sourcePageQuality: "search_shell"
    }));
    expect(pinMediaIndex.pinMediaIndex).toHaveLength(1);
    expect(output).toEqual(expect.objectContaining({
      ready: true,
      productSuccess: true,
      artifactAuthority: "product_ready",
      evidenceAuthority: "pin_media_ready"
    }));
  });

  it("promotes query-discovered canonical Pinterest pins into pin-media product readiness", async () => {
    const outputDir = makeOutputDir();
    const canonicalPinUrl = "https://www.pinterest.com/pin/61572719900827789/";
    const mediaUrl = "https://i.pinimg.com/originals/query-discovered-pin.jpg";
    const fetchOrder: string[] = [];
    const fetch = vi.fn(async (input: { url: string }) => {
      if (input.url.includes("/search/pins/")) {
        fetchOrder.push("search");
        return makeAggregate({
          records: [makePinterestSearchShellDiscoveryRecord(input.url, canonicalPinUrl)]
        });
      }
      fetchOrder.push("pin");
      expect(input.url).toBe(canonicalPinUrl);
      return makeAggregate({
        records: [makePinterestDiscoveredImagePinRecord(input.url)]
      });
    });
    const captureReference = vi.fn();
    const capturePinMediaEvidence = vi.fn(async (url: string, options: InspiredesignWorkflowPinMediaCaptureOptions) => {
      expect(url).toBe(canonicalPinUrl);
      expect(options.browserMode).toBe("extension");
      expect(options.useCookies).toBe(true);
      expect(options.cookiePolicyOverride).toBe("required");
      expect(options.pinterestPageQuality).toBe("pin_media");
      writeFileSync(options.pinMediaEvidencePath, validPinMediaBytes());
      return makePinterestImagePinMediaCapture(url, options, mediaUrl);
    });

    const output = await runInspiredesignWorkflow(toRuntime({ fetch }), {
      brief: "Design a cinematic photography studio landing page",
      harvest: true,
      query: "premium photography studio landing page",
      providers: ["social/pinterest"],
      urls: [],
      browserMode: "extension",
      useCookies: true,
      cookiePolicyOverride: "required",
      visualEvidence: "required",
      outputDir,
      mode: "path"
    }, {
      capturePinMediaEvidence,
      captureReference
    });

    const meta = output.meta as InspiredesignWorkflowMeta;
    const artifactPath = String(output.artifact_path);
    const evidence = JSON.parse(readFileSync(join(artifactPath, "evidence.json"), "utf8")) as {
      discovery?: { acceptedUrlCount: number; acceptedUrls: string[]; sourcePageQuality: string };
      references: Array<{
        url: string;
        captureStatus: string;
        discovery?: { discoveryMode: string; sourcePageQuality: string; siteRecipeId: string };
        capture?: { pinMedia?: { authority?: string; path?: string } };
      }>;
      pinMediaIndex?: Array<{ path: string }>;
    };
    const discoveryDiagnostics = JSON.parse(readFileSync(join(artifactPath, "discovery-diagnostics.json"), "utf8")) as {
      acceptedUrlCount: number;
      acceptedUrls: string[];
      acceptedReferences: Array<{ url: string; discoveryMode: string; sourcePageQuality: string; siteRecipeId: string }>;
      sourcePageQuality: string;
    };
    const pinMediaIndex = JSON.parse(readFileSync(join(artifactPath, "pin-media-index.json"), "utf8")) as {
      pinMediaIndex: Array<{
        path: string;
        authority: string;
        bytes: number;
        contentType: string;
        mediaUrl: string;
        pinterestPageQuality: string;
        firstPartyProvenance: {
          referenceUrlCanonical: boolean;
          sourceUrlMatchesReference: boolean;
          mediaUrlFirstParty: boolean;
        };
      }>;
    };
    const rankedReferences = JSON.parse(readFileSync(join(artifactPath, "ranked-references.json"), "utf8")) as {
      references: Array<{ url: string; evidenceAuthority?: string; capturedVia?: string[] }>;
    };
    const pinMediaEntry = pinMediaIndex.pinMediaIndex[0];
    if (!pinMediaEntry) throw new Error("Expected query-discovered pin media index entry.");

    expect(fetchOrder).toEqual(["search", "pin"]);
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      { url: "https://www.pinterest.com/search/pins/?q=premium+photography+studio+landing+page" },
      expect.objectContaining({
        source: "web",
        runtimePolicy: expect.objectContaining({
          browserMode: "extension",
          useCookies: true,
          cookiePolicyOverride: "required"
        })
      })
    );
    expect(capturePinMediaEvidence).toHaveBeenCalledTimes(1);
    expect(captureReference).not.toHaveBeenCalled();
    expect(meta.discovery).toEqual(expect.objectContaining({
      siteRecipeId: "social/pinterest",
      acceptedUrls: [canonicalPinUrl],
      browserNativeDiagnostics: expect.objectContaining({
        extractedUrlCount: 1,
        acceptedUrlCount: 1,
        sourcePageQuality: "search_shell"
      })
    }));
    expect(discoveryDiagnostics).toEqual(expect.objectContaining({
      acceptedUrlCount: 1,
      acceptedUrls: [canonicalPinUrl],
      sourcePageQuality: "search_shell",
      acceptedReferences: [expect.objectContaining({
        url: canonicalPinUrl,
        discoveryMode: "browser_native_extracted_reference",
        sourcePageQuality: "search_shell",
        siteRecipeId: "social/pinterest"
      })]
    }));
    expect(evidence.discovery).toEqual(expect.objectContaining({
      acceptedUrlCount: 1,
      acceptedUrls: [canonicalPinUrl],
      sourcePageQuality: "search_shell"
    }));
    expect(meta.selection.urls).toEqual([canonicalPinUrl]);
    expect(output).toEqual(expect.objectContaining({
      ready: true,
      readiness: "ready",
      productSuccess: true,
      artifactAuthority: "product_ready",
      evidenceAuthority: "pin_media_ready",
      rankedReferenceCount: 1
    }));
    expect(meta.nextStepGuidance).toEqual(expect.objectContaining({
      readiness: "ready",
      reasonCode: "design_ready"
    }));
    expect(pinMediaIndex.pinMediaIndex).toHaveLength(1);
    expect(pinMediaEntry).toEqual(expect.objectContaining({
      authority: "design_evidence",
      bytes: validPinMediaBytes().length,
      contentType: "image/jpeg",
      mediaUrl,
      pinterestPageQuality: "pin_media"
    }));
    expect(pinMediaEntry.firstPartyProvenance).toEqual(expect.objectContaining({
      referenceUrlCanonical: true,
      sourceUrlMatchesReference: true,
      mediaUrlFirstParty: true
    }));
    expect(readFileSync(join(artifactPath, pinMediaEntry.path))).toEqual(validPinMediaBytes());
    expect(evidence.pinMediaIndex).toEqual(pinMediaIndex.pinMediaIndex);
    expect(evidence.references[0]).toEqual(expect.objectContaining({
      url: canonicalPinUrl,
      captureStatus: "captured",
      discovery: expect.objectContaining({
        discoveryMode: "browser_native_extracted_reference",
        sourcePageQuality: "search_shell",
        siteRecipeId: "social/pinterest"
      }),
      capture: expect.objectContaining({
        pinMedia: expect.objectContaining({
          authority: "design_evidence",
          path: pinMediaEntry.path
        })
      })
    }));
    expect(rankedReferences.references[0]).toEqual(expect.objectContaining({
      url: canonicalPinUrl,
      evidenceAuthority: "pin_media_ready",
      capturedVia: expect.arrayContaining(["pin_media", "pin_media_ready"])
    }));
    expect(meta.artifact_manifest.files).toEqual(expect.arrayContaining([
      "canvas-plan.request.json",
      "pin-media-evidence.json",
      "discovery-diagnostics.json",
      "pin-media-index.json",
      "ranked-references.json",
      pinMediaEntry.path
    ]));
  });

  it("promotes direct canonical Pinterest pins into pin-media product readiness without deep diagnostics", async () => {
    const outputDir = makeOutputDir();
    const directPinUrl = "https://www.pinterest.com/pin/84301824269977360";
    const mediaUrl = "https://i.pinimg.com/originals/direct-pin-main.jpg";
    const fetch = vi.fn(async (input: { url: string }) => makeAggregate({
      records: [
        normalizeRecord("social/pinterest", "social", {
          url: input.url,
          title: "Pinterest direct image pin reference",
          content: "Full-bleed editorial image pin with cinematic studio staging",
          attributes: PINTEREST_IMAGE_PIN_ATTRIBUTES
        })
      ]
    }));
    const captureReference = vi.fn();
    const capturePinMediaEvidence = vi.fn(async (url: string, options: InspiredesignWorkflowPinMediaCaptureOptions) => {
      expect(url).toBe(directPinUrl);
      expect(options.browserMode).toBe("extension");
      expect(options.useCookies).toBe(true);
      expect(options.cookiePolicyOverride).toBe("required");
      expect(options.pinterestPageQuality).toBe("pin_media");
      writeFileSync(options.pinMediaEvidencePath, validPinMediaBytes());
      return makePinterestImagePinMediaCapture(url, options, mediaUrl);
    });

    const output = await runInspiredesignWorkflow(toRuntime({ fetch }), {
      brief: "Design a cinematic photography studio landing page",
      urls: [directPinUrl],
      browserMode: "extension",
      useCookies: true,
      cookiePolicyOverride: "required",
      visualEvidence: "off",
      includePrototypeGuidance: true,
      outputDir,
      mode: "path",
      timeoutMs: 240000
    }, {
      capturePinMediaEvidence,
      captureReference,
      analyzeMediaArtifacts: async (inputs) => ({
        version: 1,
        generatedAt: "2026-05-23T00:00:00.000Z",
        nonGoals: [],
        references: inputs.map((input) => ({
          referenceId: input.referenceId,
          mediaPath: input.mediaPath,
          ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
          ...(input.mediaUrl ? { mediaUrl: input.mediaUrl } : {}),
          kind: input.kind,
          ...(input.contentType ? { contentType: input.contentType } : {}),
          ...(typeof input.bytes === "number" ? { bytes: input.bytes } : {}),
          ...(input.hash ? { hash: input.hash } : {}),
          dimensions: {
            width: input.width ?? 0,
            height: input.height ?? 0,
            aspectRatio: Number((((input.width ?? 0) / Math.max(1, input.height ?? 1))).toFixed(4))
          },
          authority: "design_evidence",
          claimLevels: ["metadata_only"],
          facts: {},
          designGuidance: {
            visualStrengths: ["Byte-backed direct Pinterest pin media was analyzed."],
            visualRisks: [],
            layoutRecipe: "Use a cinematic full-bleed hero anchored by editorial media.",
            contentHierarchy: ["hero media", "headline", "service proof"],
            componentFamilies: ["hero", "portfolio grid"],
            motionPosture: "Static source only; adapt with restrained reveal motion.",
            tokenNotes: ["Carry dark editorial contrast into semantic tokens."],
            patternsToBorrow: ["full-bleed editorial image direction"],
            patternsToReject: ["diagnostic-only shell guidance"],
            typographyPosture: "editorial display headline",
            imageryPosture: "cinematic studio imagery",
            confidence: 0.84
          },
          confidence: 0.84,
          limitations: []
        }))
      })
    });

    const meta = output.meta as InspiredesignWorkflowMeta;
    const artifactPath = String(output.artifact_path);
    const evidence = JSON.parse(readFileSync(join(artifactPath, "evidence.json"), "utf8")) as {
      references: Array<{ capture?: { attempts?: Record<string, { status: string }> } }>;
    };
    const mediaAnalysis = JSON.parse(readFileSync(join(artifactPath, INSPIREDESIGN_HANDOFF_FILES.mediaAnalysis), "utf8")) as {
      references: Array<{ referenceId: string; mediaPath: string; designGuidance: { patternsToReject: string[] } }>;
    };

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(capturePinMediaEvidence).toHaveBeenCalledTimes(1);
    expect(captureReference).not.toHaveBeenCalled();
    expect(meta.selection).toEqual(expect.objectContaining({
      urls: [directPinUrl],
      capture_mode: "off",
      requested_browser_mode: "extension"
    }));
    expect(output).toEqual(expect.objectContaining({
      ready: true,
      readiness: "ready",
      productSuccess: true,
      artifactAuthority: "product_ready",
      evidenceAuthority: "pin_media_ready",
      rankedReferenceCount: 1
    }));
    expect(evidence.references[0]?.capture?.attempts).toEqual({
      snapshot: expect.objectContaining({ status: "skipped" }),
      clone: expect.objectContaining({ status: "skipped" }),
      dom: expect.objectContaining({ status: "skipped" })
    });
    expect(mediaAnalysis.references).toHaveLength(1);
    expect(mediaAnalysis.references[0]).toEqual(expect.objectContaining({
      mediaPath: "pin-media-evidence/31d105f36553/main.jpg",
      designGuidance: expect.objectContaining({
        patternsToReject: ["diagnostic-only shell guidance"]
      })
    }));
    expect(meta.artifact_manifest.files).toEqual(expect.arrayContaining([
      "canvas-plan.request.json",
      INSPIREDESIGN_HANDOFF_FILES.mediaAnalysis,
      "pin-media-evidence/31d105f36553/main.jpg"
    ]));
  });

  it("keeps later query-discovered Pinterest pins eligible when enough workflow budget remains", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-23T00:00:00.000Z"));

    try {
      const outputDir = makeOutputDir();
      const slowPinUrl = "https://www.pinterest.com/pin/1055599900892243/";
      const readyPinUrl = "https://www.pinterest.com/pin/84301824269977360/";
      const mediaUrl = "https://i.pinimg.com/originals/query-ready-after-slow-pin.jpg";
      const searchUrl = "https://www.pinterest.com/search/pins/?q=premium+photography+studio+landing+page";
      const readyPinTimeouts: Array<number | undefined> = [];
      const fetch = vi.fn(async (input: { url: string }) => {
        if (input.url.includes("/search/pins/")) {
          const slowPinPath = new URL(slowPinUrl).pathname;
          const readyPinPath = new URL(readyPinUrl).pathname;
          return makeAggregate({
            records: [
              normalizeRecord("social/pinterest", "social", {
                url: input.url,
                title: "Pinterest query results",
                content: "Search results for cinematic photography studio with visible pin cards.",
                attributes: {
                  links: [slowPinPath, readyPinPath],
                  html: [
                    `<a href="${slowPinPath}">Slow studio pin</a>`,
                    `<a href="${readyPinPath}">Ready studio pin</a>`
                  ].join("")
                }
              })
            ]
          });
        }
        return makeAggregate({
          records: [makePinterestDiscoveredImagePinRecord(input.url)]
        });
      });
      const captureReference = vi.fn();
      const capturePinMediaEvidence = vi.fn(async (url: string, options: InspiredesignWorkflowPinMediaCaptureOptions) => {
        if (url === slowPinUrl) {
          vi.setSystemTime(new Date("2026-05-23T00:00:04.500Z"));
          return {
            status: "failed" as const,
            kind: "image" as const,
            capturedAt: "2026-05-23T00:00:04.500Z",
            referenceId: options.referenceId,
            url,
            pinterestPageQuality: options.pinterestPageQuality,
            warnings: ["primary_capture_setup_failed"],
            failure: "Deep capture primary media capture session launch exceeded timeout budget.",
            rejectionReasons: ["primary_capture_setup_failed"]
          };
        }
        expect(url).toBe(readyPinUrl);
        readyPinTimeouts.push(options.timeoutMs);
        if ((options.timeoutMs ?? 0) <= 1000) {
          return {
            status: "failed" as const,
            kind: "image" as const,
            capturedAt: "2026-05-23T00:00:09.000Z",
            referenceId: options.referenceId,
            url,
            pinterestPageQuality: options.pinterestPageQuality,
            warnings: ["primary_capture_setup_failed"],
            failure: "Deep capture primary media capture session launch exceeded timeout budget.",
            rejectionReasons: ["primary_capture_setup_failed"]
          };
        }
        writeFileSync(options.pinMediaEvidencePath, validPinMediaBytes());
        return makePinterestImagePinMediaCapture(url, options, mediaUrl);
      });

      const output = await runInspiredesignWorkflow(toRuntime({ fetch }), {
        brief: "Design a cinematic photography studio landing page",
        harvest: true,
        query: "premium photography studio landing page",
        providers: ["social/pinterest"],
        browserMode: "extension",
        useCookies: true,
        cookiePolicyOverride: "required",
        visualEvidence: "required",
        timeoutMs: 10000,
        outputDir,
        mode: "path"
      }, {
        capturePinMediaEvidence,
        captureReference
      });

      const artifactPath = String(output.artifact_path);
      const pinMediaIndex = JSON.parse(readFileSync(join(artifactPath, "pin-media-index.json"), "utf8")) as {
        pinMediaIndex: Array<{ path: string; url: string; authority: string; mediaUrl: string }>;
      };
      const rankedReferences = JSON.parse(readFileSync(join(artifactPath, "ranked-references.json"), "utf8")) as {
        references: Array<{ url: string; evidenceAuthority?: string }>;
      };
      const meta = output.meta as InspiredesignWorkflowMeta;

      expect(fetch).toHaveBeenNthCalledWith(
        1,
        { url: searchUrl },
        expect.objectContaining({ timeoutMs: 10000 })
      );
      expect(capturePinMediaEvidence).toHaveBeenCalledTimes(2);
      expect(readyPinTimeouts).toEqual([5500]);
      expect(captureReference).not.toHaveBeenCalled();
      expect(meta.discovery).toEqual(expect.objectContaining({
        siteRecipeId: "social/pinterest",
        acceptedUrls: [slowPinUrl, readyPinUrl]
      }));
      expect(output).toEqual(expect.objectContaining({
        ready: true,
        readiness: "ready",
        productSuccess: true,
        artifactAuthority: "product_ready",
        evidenceAuthority: "pin_media_ready",
        rankedReferenceCount: 1
      }));
      expect(pinMediaIndex.pinMediaIndex).toEqual([
        expect.objectContaining({
          url: readyPinUrl,
          authority: "design_evidence",
          mediaUrl
        })
      ]);
      expect(readFileSync(join(artifactPath, pinMediaIndex.pinMediaIndex[0]?.path ?? ""))).toEqual(validPinMediaBytes());
      expect(rankedReferences.references[0]).toEqual(expect.objectContaining({
        url: readyPinUrl,
        evidenceAuthority: "pin_media_ready"
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("caps query-discovered reference fetch budgets by the remaining workflow deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-23T00:00:00.000Z"));

    try {
      const pinUrl = "https://www.pinterest.com/pin/61572719900827789/";
      const observedReferenceTimeouts: Array<number | undefined> = [];
      const fetch = vi.fn(async (
        input: Parameters<ReferenceRetrievalPort["fetch"]>[0],
        options?: Parameters<ReferenceRetrievalPort["fetch"]>[1]
      ) => {
        if (input.url.includes("/search/pins/")) {
          expect(options?.timeoutMs).toBe(10000);
          vi.setSystemTime(new Date("2026-05-23T00:00:08.000Z"));
          return makeAggregate({
            records: [makePinterestSearchShellDiscoveryRecord(input.url, pinUrl)]
          });
        }
        observedReferenceTimeouts.push(options?.timeoutMs);
        return makeAggregate({
          records: [makePinterestDiscoveredImagePinRecord(input.url)]
        });
      });

      await runInspiredesignWorkflow(toRuntime({ fetch }), {
        brief: "Design a cinematic photography studio landing page",
        harvest: true,
        query: "premium photography studio landing page",
        providers: ["social/pinterest"],
        browserMode: "extension",
        useCookies: true,
        cookiePolicyOverride: "required",
        visualEvidence: "off",
        timeoutMs: 10000,
        outputDir: makeOutputDir(),
        mode: "json"
      });

      expect(observedReferenceTimeouts).toEqual([2000]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reserves the post-discovery workflow deadline across remaining query-discovered references", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-23T00:00:00.000Z"));

    try {
      const firstPinUrl = "https://www.pinterest.com/pin/61572719900827789/";
      const secondPinUrl = "https://www.pinterest.com/pin/84301824269977360/";
      const observedReferenceTimeouts: Array<number | undefined> = [];
      const fetch = vi.fn(async (
        input: Parameters<ReferenceRetrievalPort["fetch"]>[0],
        options?: Parameters<ReferenceRetrievalPort["fetch"]>[1]
      ) => {
        if (input.url.includes("/search/pins/")) {
          expect(options?.timeoutMs).toBe(10000);
          vi.setSystemTime(new Date("2026-05-23T00:00:04.900Z"));
          const firstPinPath = new URL(firstPinUrl).pathname;
          const secondPinPath = new URL(secondPinUrl).pathname;
          return makeAggregate({
            records: [normalizeRecord("social/pinterest", "social", {
              url: input.url,
              title: "Pinterest query results",
              content: "Search results for cinematic photography studio. Pin card results are visible.",
              attributes: {
                links: [firstPinPath, secondPinPath],
                html: [
                  `<article aria-label="Pin card"><a href="${firstPinPath}">First studio pin</a></article>`,
                  `<article aria-label="Pin card"><a href="${secondPinPath}">Second studio pin</a></article>`
                ].join("")
              }
            })]
          });
        }
        observedReferenceTimeouts.push(options?.timeoutMs);
        if (input.url === firstPinUrl) {
          vi.setSystemTime(new Date("2026-05-23T00:00:07.450Z"));
        }
        return makeAggregate({
          records: [makePinterestDiscoveredImagePinRecord(input.url)]
        });
      });

      await runInspiredesignWorkflow(toRuntime({ fetch }), {
        brief: "Design a cinematic photography studio landing page",
        harvest: true,
        query: "premium photography studio landing page",
        providers: ["social/pinterest"],
        browserMode: "extension",
        useCookies: true,
        cookiePolicyOverride: "required",
        visualEvidence: "off",
        timeoutMs: 10000,
        outputDir: makeOutputDir(),
        mode: "json"
      });

      expect(observedReferenceTimeouts).toEqual([2550, 2550]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not schedule query-discovered references after the workflow deadline is exhausted", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-23T00:00:00.000Z"));

    try {
      const pinUrl = "https://www.pinterest.com/pin/61572719900827789/";
      const fetchedReferenceUrls: string[] = [];
      const fetch = vi.fn(async (
        input: Parameters<ReferenceRetrievalPort["fetch"]>[0],
        options?: Parameters<ReferenceRetrievalPort["fetch"]>[1]
      ) => {
        if (input.url.includes("/search/pins/")) {
          expect(options?.timeoutMs).toBe(10000);
          vi.setSystemTime(new Date("2026-05-23T00:00:10.000Z"));
          return makeAggregate({
            records: [makePinterestSearchShellDiscoveryRecord(input.url, pinUrl)]
          });
        }
        fetchedReferenceUrls.push(input.url);
        return makeAggregate({
          records: [makePinterestDiscoveredImagePinRecord(input.url)]
        });
      });
      const capturePinMediaEvidence = vi.fn();
      const captureReference = vi.fn();

      const output = await runInspiredesignWorkflow(toRuntime({ fetch }), {
        brief: "Design a cinematic photography studio landing page",
        harvest: true,
        query: "premium photography studio landing page",
        providers: ["social/pinterest"],
        browserMode: "extension",
        useCookies: true,
        cookiePolicyOverride: "required",
        visualEvidence: "required",
        timeoutMs: 10000,
        outputDir: makeOutputDir(),
        mode: "json"
      }, {
        capturePinMediaEvidence,
        captureReference
      });

      expect(fetchedReferenceUrls).toEqual([]);
      expect(capturePinMediaEvidence).not.toHaveBeenCalled();
      expect(captureReference).not.toHaveBeenCalled();
      expect(output).toEqual(expect.objectContaining({
        ready: false,
        productSuccess: false,
        artifactAuthority: "diagnostic_only",
        evidenceAuthority: "diagnostic_only",
        rankedReferenceCount: 0
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps query-discovered Pinterest pins diagnostic when pin-media capture bytes are invalid", async () => {
    const outputDir = makeOutputDir();
    const canonicalPinUrl = "https://www.pinterest.com/pin/61572719900827789/";
    const fetch = vi.fn(async (input: { url: string }) => {
      if (input.url.includes("/search/pins/")) {
        return makeAggregate({
          records: [makePinterestSearchShellDiscoveryRecord(input.url, canonicalPinUrl)]
        });
      }
      return makeAggregate({
        records: [makePinterestDiscoveredImagePinRecord(input.url)]
      });
    });
    const captureReference = vi.fn();
    const capturePinMediaEvidence = vi.fn(async (url: string, options: InspiredesignWorkflowPinMediaCaptureOptions) => {
      writeFileSync(options.pinMediaEvidencePath, Buffer.alloc(12, 7));
      return makePinterestImagePinMediaCapture(url, options, "https://i.pinimg.com/originals/query-invalid-pin.jpg");
    });

    const output = await runInspiredesignWorkflow(toRuntime({ fetch }), {
      brief: "Design a cinematic photography studio landing page",
      harvest: true,
      query: "premium photography studio landing page",
      providers: ["social/pinterest"],
      urls: [],
      browserMode: "extension",
      useCookies: true,
      cookiePolicyOverride: "required",
      visualEvidence: "required",
      outputDir,
      mode: "path"
    }, {
      capturePinMediaEvidence,
      captureReference
    });

    const meta = output.meta as InspiredesignWorkflowMeta;
    const artifactPath = String(output.artifact_path);
    const pinMediaEvidence = JSON.parse(readFileSync(join(artifactPath, "pin-media-evidence.json"), "utf8")) as {
      pinMediaEvidence: Array<{ pinMedia: { authority: string; rejectionReasons: string[]; path?: string } }>;
    };
    const pinMediaIndex = JSON.parse(readFileSync(join(artifactPath, "pin-media-index.json"), "utf8")) as {
      pinMediaIndex: Array<Record<string, JsonValue>>;
    };

    expect(meta.discovery).toEqual(expect.objectContaining({
      siteRecipeId: "social/pinterest",
      acceptedUrls: [canonicalPinUrl]
    }));
    expect(meta.selection.urls).toEqual([canonicalPinUrl]);
    expect(capturePinMediaEvidence).toHaveBeenCalledTimes(1);
    expect(captureReference).not.toHaveBeenCalled();
    expect(pinMediaIndex.pinMediaIndex).toEqual([]);
    expect(pinMediaEvidence.pinMediaEvidence[0]?.pinMedia).toEqual(expect.objectContaining({
      authority: "diagnostic",
      rejectionReasons: expect.arrayContaining(["unsupported_byte_signature"])
    }));
    expect(pinMediaEvidence.pinMediaEvidence[0]?.pinMedia.path).toBeUndefined();
    expect(output).toEqual(expect.objectContaining({
      ready: false,
      productSuccess: false,
      artifactAuthority: "diagnostic_only",
      evidenceAuthority: "diagnostic_only"
    }));
    expect(meta.nextStepGuidance).toEqual(expect.objectContaining({
      readiness: "needs_recovery",
      reasonCode: "pinterest_browser_native_recovery"
    }));
    expect(meta.artifact_manifest.files).not.toContain("canvas-plan.request.json");
    expect(existsSync(join(artifactPath, "canvas-plan.request.json"))).toBe(false);
  });

  it("keeps standard provider search when Pinterest is part of a mixed provider harvest", async () => {
	const outputDir = makeOutputDir();
    const search = vi.fn(async () => makeAggregate({
      records: [
        normalizeRecord("web/default", "web", {
          url: "https://example.com/studio-reference",
          title: "Photography studio landing page",
          content: "A premium photography studio landing page with cinematic portrait imagery, parallax sections, booking CTA, and editorial motion cues."
        })
      ]
    }));
    const fetch = vi.fn(async (input: { url: string }) => {
      if (input.url.includes("/search/pins/")) {
        return makeAggregate({
          records: [
            normalizeRecord("social/pinterest", "social", {
              url: input.url,
              title: "Pinterest mixed provider results",
              content: '<a href="/pin/61572719900827789/">Studio pin</a>'
            })
          ]
        });
      }
      return makeAggregate({
        records: [
          normalizeRecord("web/default", "web", {
            url: input.url,
            title: "Fetched studio reference",
            content: "A premium photography studio landing page with cinematic portrait imagery, parallax sections, booking CTA, and editorial motion cues."
          })
        ]
      });
    });
    const captureReference = vi.fn(async (url: string) => makeCapture(`Captured ${url}`));

    const output = await runInspiredesignWorkflow(toRuntime({ fetch, search }), {
      brief: "Design a cinematic photography studio landing page",
      harvest: true,
      query: "premium photography studio landing page",
      providers: ["web/default", "social/pinterest"],
      visualEvidence: "off",
      outputDir,
      mode: "path"
    }, {
      captureReference
    });

    const meta = output.meta as InspiredesignWorkflowMeta;
    const artifactPath = String(output.artifact_path);
    const discoveryDiagnostics = JSON.parse(readFileSync(join(artifactPath, "discovery-diagnostics.json"), "utf8")) as {
      acceptedUrlCount: number;
      acceptedUrls: string[];
      failureCount: number;
    };
    const evidence = JSON.parse(readFileSync(join(artifactPath, "evidence.json"), "utf8")) as {
      discovery?: { acceptedUrlCount: number; acceptedUrls: string[]; failureCount: number };
    };
    expect(search).toHaveBeenCalledWith(
      { query: "premium photography studio landing page", limit: 5 },
      expect.objectContaining({ providerIds: ["web/default"] })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      { url: "https://www.pinterest.com/search/pins/?q=premium+photography+studio+landing+page" },
      expect.objectContaining({ source: "web" })
    );
    expect(fetch.mock.calls[0]?.[1]).not.toHaveProperty("providerIds");
    expect(fetch).toHaveBeenCalledWith(
      { url: "https://www.pinterest.com/pin/61572719900827789/" },
      expect.objectContaining({ source: "web" })
    );
    const pinterestPinFetchOptions = fetch.mock.calls.find(([input]) => (
      input.url === "https://www.pinterest.com/pin/61572719900827789/"
    ))?.[1];
    expect(pinterestPinFetchOptions).not.toHaveProperty("providerIds");
    expect(fetch).toHaveBeenCalledWith(
      { url: "https://example.com/studio-reference" },
      expect.objectContaining({
        providerIds: ["web/default"]
      })
    );
    expect(meta.discovery).toEqual(expect.objectContaining({
      siteRecipeId: "social/pinterest",
      acceptedUrls: ["https://www.pinterest.com/pin/61572719900827789/", "https://example.com/studio-reference"]
    }));
    expect(discoveryDiagnostics).toEqual(expect.objectContaining({
      acceptedUrlCount: 2,
      acceptedUrls: ["https://www.pinterest.com/pin/61572719900827789/", "https://example.com/studio-reference"],
      failureCount: 0
    }));
    expect(evidence.discovery).toEqual(expect.objectContaining({
      acceptedUrlCount: 2,
      acceptedUrls: ["https://www.pinterest.com/pin/61572719900827789/", "https://example.com/studio-reference"],
      failureCount: 0
    }));
    expect(meta.discovery?.browserNativeDiagnostics).toEqual(expect.objectContaining({
      standardAcceptedCount: 1,
      siteAcceptedCount: 1
    }));
    expect(meta.discovery?.browserNativeDiagnostics).not.toEqual(expect.objectContaining({
      skipped: true
    }));
    expect(meta.nextStepGuidance).toEqual(expect.objectContaining({
      readiness: "needs_recovery",
      reasonCode: "artifact_authority_missing"
    }));
    expect(meta.nextStepGuidance?.commands.map((entry) => entry.id)).not.toContain("canvas-session-open");
    expect(output).toEqual(expect.objectContaining({
      ready: false,
      readiness: "needs_recovery",
      productSuccess: false,
      artifactAuthority: "diagnostic_only",
      rankedReferenceCount: 1
    }));
    expect(output.meta).toEqual(expect.objectContaining({
      pinterestEvidenceRequired: true
    }));
    expect(output).not.toHaveProperty("canvasPlanRequest");
  });

  it("keeps Pinterest boards diagnostic unless concrete media evidence is captured", async () => {
    const outputDir = makeOutputDir();
    const boardUrl = "https://www.pinterest.com/studio/cinematic-fashion-board/";
    const output = await runInspiredesignWorkflow(toRuntime({
      fetch: async (input: { url: string }) => makeAggregate({
        records: [
          normalizeRecord("social/pinterest", "social", {
            url: input.url,
            title: "Cinematic fashion studio board",
            content: "Editorial atelier landing page moodboard with premium full-bleed imagery and strong typography"
          })
        ]
      })
    }), {
      brief: "Design a cinematic fashion studio landing page",
      harvest: true,
      providers: ["social/pinterest"],
      urls: [boardUrl],
      outputDir,
      mode: "path"
    });

    const artifactPath = String(output.artifact_path);
    const rankedReferences = JSON.parse(readFileSync(join(artifactPath, "ranked-references.json"), "utf8")) as {
      references: unknown[];
      rejectedReferences: Array<{ url: string; reason: string }>;
    };

    expect(output).toEqual(expect.objectContaining({
      ready: false,
      productSuccess: false,
      rankedReferenceCount: 0
    }));
    expect(rankedReferences.references).toEqual([]);
    expect(rankedReferences.rejectedReferences).toEqual([
      expect.objectContaining({
        url: boardUrl.replace(/\/$/, ""),
        diagnosticReasons: ["board_requires_concrete_media_extraction"],
        reason: expect.stringContaining("board_requires_concrete_media_extraction")
      })
    ]);
  });

  it("rejects Pinterest search-shell URLs returned by the standard lane in mixed provider harvests", async () => {
    const search = vi.fn(async () => makeAggregate({
      records: [
        normalizeRecord("web/default", "web", {
          url: "https://www.pinterest.com/search/pins/?q=premium+photography+studio",
          title: "Pinterest search shell from web",
          content: "Pinterest search chrome with no canonical reference."
        }),
        normalizeRecord("web/default", "web", {
          url: "https://example.com/studio-reference",
          title: "Photography studio landing page",
          content: "A premium photography studio landing page with cinematic portrait imagery, parallax sections, booking CTA, and editorial motion cues."
        })
      ]
    }));
    const fetch = vi.fn(async (input: { url: string }) => {
      if (input.url.includes("/search/pins/")) {
        return makeAggregate({
          records: [
            normalizeRecord("social/pinterest", "social", {
              url: input.url,
              title: "Pinterest mixed provider results",
              content: '<a href="/pin/61572719900827789/">Studio pin</a>'
            })
          ]
        });
      }
      return makeAggregate({
        records: [
          normalizeRecord("web/default", "web", {
            url: input.url,
            title: "Fetched studio reference",
            content: "A premium photography studio landing page with cinematic portrait imagery, parallax sections, booking CTA, and editorial motion cues."
          })
        ]
      });
    });

    const output = await runInspiredesignWorkflow(toRuntime({ fetch, search }), {
      brief: "Design a cinematic photography studio landing page",
      harvest: true,
      query: "premium photography studio landing page",
      providers: ["web/default", "social/pinterest"],
      visualEvidence: "off",
      mode: "json"
    }, {
      captureReference: async (url: string) => makeCapture(`Captured ${url}`)
    });

    const meta = output.meta as InspiredesignWorkflowMeta;
    expect(meta.discovery?.acceptedUrls).toEqual([
      "https://www.pinterest.com/pin/61572719900827789/",
      "https://example.com/studio-reference"
    ]);
    expect(meta.discovery?.acceptedUrls).not.toContain(
      "https://www.pinterest.com/search/pins/?q=premium+photography+studio"
    );
    expect(meta.discovery?.rejected).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rawUrl: "https://www.pinterest.com/search/pins/?q=premium+photography+studio",
        reason: "invalid_url"
      })
    ]));
    expect(fetch).not.toHaveBeenCalledWith(
      { url: "https://www.pinterest.com/search/pins/?q=premium+photography+studio" },
      expect.objectContaining({ providerIds: ["web/default"] })
    );
  });

  it("blocks Canvas continuation when a mixed Pinterest lane has a hard auth failure", async () => {
    const search = vi.fn(async () => makeAggregate({
      records: [
        normalizeRecord("web/default", "web", {
          url: "https://example.com/studio-reference",
          title: "Photography studio landing page",
          content: "A premium photography studio landing page with cinematic portrait imagery, parallax sections, booking CTA, and editorial motion cues."
        })
      ]
    }));
    const fetch = vi.fn(async (input: { url: string }) => {
      if (input.url.includes("/search/pins/")) {
        return makeAggregate({
          ok: false,
          records: [],
          failures: [
            makeFailure("social/pinterest", "social", {
              code: "auth",
              message: "Pinterest requires login.",
              reasonCode: "auth_required"
            })
          ]
        });
      }
      return makeAggregate({
        records: [
          normalizeRecord("web/default", "web", {
            url: input.url,
            title: "Fetched studio reference",
            content: "A premium photography studio landing page with cinematic portrait imagery, parallax sections, booking CTA, and editorial motion cues."
          })
        ]
      });
    });
    const captureReference = vi.fn(async (url: string) => makeCapture(`Captured ${url}`));

    const output = await runInspiredesignWorkflow(toRuntime({ fetch, search }), {
      brief: "Design a cinematic photography studio landing page",
      harvest: true,
      query: "premium photography studio landing page",
      providers: ["web/default", "social/pinterest"],
      visualEvidence: "off",
      mode: "json"
    }, {
      captureReference
    });

    const meta = output.meta as InspiredesignWorkflowMeta;
    expect(meta.discovery).toEqual(expect.objectContaining({
      siteRecipeId: "social/pinterest",
      acceptedUrls: ["https://example.com/studio-reference"]
    }));
    expect(meta.metrics.reasonCodeDistribution).toEqual(expect.objectContaining({
      auth_required: 1
    }));
    expect(meta.nextStepGuidance).toEqual(expect.objectContaining({
      readiness: "blocked",
      reasonCode: "provider_unavailable"
    }));
    expect(meta.nextStepGuidance?.commands.map((command) => command.command).join("\n")).not.toContain("canvas.plan.set");
  });

  it("keeps standard provider search first when Pinterest appears before web in a mixed provider harvest", async () => {
    const search = vi.fn(async () => makeAggregate({
      records: [
        normalizeRecord("web/default", "web", {
          url: "https://example.com/reverse-studio-reference",
          title: "Reverse provider photography studio landing page",
          content: "A premium photography studio landing page with cinematic portrait imagery, parallax sections, booking CTA, and editorial motion cues."
        })
      ]
    }));
    const fetch = vi.fn(async (input: { url: string }) => {
      if (input.url.includes("/search/pins/")) {
        return makeAggregate({
          records: [
            normalizeRecord("social/pinterest", "social", {
              url: input.url,
              title: "Pinterest reverse mixed provider results",
              content: '<a href="/pin/61572719900827790/">Reverse studio pin</a>'
            })
          ]
        });
      }
      return makeAggregate({
        records: [
          normalizeRecord("web/default", "web", {
            url: input.url,
            title: "Fetched reverse studio reference",
            content: "A premium photography studio landing page with cinematic portrait imagery, parallax sections, booking CTA, and editorial motion cues."
          })
        ]
      });
    });
    const captureReference = vi.fn(async (url: string) => makeCapture(`Captured ${url}`));

    const output = await runInspiredesignWorkflow(toRuntime({ fetch, search }), {
      brief: "Design a cinematic photography studio landing page",
      harvest: true,
      query: "premium photography studio landing page",
      providers: ["social/pinterest", "web/default"],
      visualEvidence: "off",
      mode: "json"
    }, {
      captureReference
    });

    const meta = output.meta as InspiredesignWorkflowMeta;
    expect(search).toHaveBeenCalledWith(
      { query: "premium photography studio landing page", limit: 5 },
      expect.objectContaining({ providerIds: ["web/default"] })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      { url: "https://www.pinterest.com/search/pins/?q=premium+photography+studio+landing+page" },
      expect.objectContaining({ source: "web" })
    );
    expect(fetch.mock.calls[0]?.[1]).not.toHaveProperty("providerIds");
    expect(fetch).toHaveBeenCalledWith(
      { url: "https://www.pinterest.com/pin/61572719900827790/" },
      expect.objectContaining({ source: "web" })
    );
    const reversePinterestPinFetchOptions = fetch.mock.calls.find(([input]) => (
      input.url === "https://www.pinterest.com/pin/61572719900827790/"
    ))?.[1];
    expect(reversePinterestPinFetchOptions).not.toHaveProperty("providerIds");
    expect(meta.discovery).toEqual(expect.objectContaining({
      siteRecipeId: "social/pinterest",
      acceptedUrls: ["https://www.pinterest.com/pin/61572719900827790/", "https://example.com/reverse-studio-reference"]
    }));
    expect(meta.discovery?.browserNativeDiagnostics).toEqual(expect.objectContaining({
      standardAcceptedCount: 1,
      siteAcceptedCount: 1
    }));
    expect(meta.discovery?.browserNativeDiagnostics).not.toEqual(expect.objectContaining({
      skipped: true
    }));
    expect(meta.nextStepGuidance).toEqual(expect.objectContaining({
      readiness: "needs_recovery",
      reasonCode: "artifact_authority_missing"
    }));
    expect(meta.nextStepGuidance?.commands.map((entry) => entry.id)).not.toContain("canvas-session-open");
  });

  it("keeps a Pinterest reference when standard search fills the mixed provider limit", async () => {
    const search = vi.fn(async () => makeAggregate({
      records: [
        normalizeRecord("web/default", "web", {
          url: "https://example.com/standard-one",
          title: "Standard studio one",
          content: "A premium photography studio landing page with cinematic portrait imagery, booking CTA, and editorial motion cues."
        }),
        normalizeRecord("web/default", "web", {
          url: "https://example.com/standard-two",
          title: "Standard studio two",
          content: "A premium photography studio landing page with cinematic portrait imagery, booking CTA, and editorial motion cues."
        })
      ]
    }));
    const fetch = vi.fn(async (input: { url: string }) => {
      if (input.url.includes("/search/pins/")) {
        return makeAggregate({
          records: [
            normalizeRecord("social/pinterest", "social", {
              url: input.url,
              title: "Pinterest cap preservation results",
              content: '<a href="/pin/61572719900827791/">Cap preserved studio pin</a>'
            })
          ]
        });
      }
      return makeAggregate({
        records: [
          normalizeRecord("web/default", "web", {
            url: input.url,
            title: "Fetched capped reference",
            content: "A premium photography studio landing page with cinematic portrait imagery, booking CTA, and editorial motion cues."
          })
        ]
      });
    });
    const captureReference = vi.fn(async (url: string) => makeCapture(`Captured ${url}`));

    const output = await runInspiredesignWorkflow(toRuntime({ fetch, search }), {
      brief: "Design a cinematic photography studio landing page",
      harvest: true,
      query: "premium photography studio landing page",
      providers: ["web/default", "social/pinterest"],
      maxReferences: 2,
      visualEvidence: "off",
      mode: "json"
    }, {
      captureReference
    });

    const meta = output.meta as InspiredesignWorkflowMeta;
    expect(meta.selection.urls).toEqual([
      "https://www.pinterest.com/pin/61572719900827791/",
      "https://example.com/standard-one"
    ]);
    expect(captureReference).toHaveBeenCalledWith(
      "https://www.pinterest.com/pin/61572719900827791/",
      expect.any(Object)
    );
    expect(captureReference).not.toHaveBeenCalledWith(
      "https://example.com/standard-two",
      expect.any(Object)
    );
  });

  it("keeps a standard provider reference when Pinterest fills the mixed provider limit", async () => {
    const search = vi.fn(async () => makeAggregate({
      records: [
        normalizeRecord("web/default", "web", {
          url: "https://example.com/standard-preserved",
          title: "Standard provider preserved",
          content: "A premium photography studio landing page with cinematic portrait imagery, booking CTA, and editorial motion cues."
        })
      ]
    }));
    const fetch = vi.fn(async (input: { url: string }) => {
      if (input.url.includes("/search/pins/")) {
        return makeAggregate({
          records: [
            normalizeRecord("social/pinterest", "social", {
              url: input.url,
              title: "Pinterest cap preservation results",
              content: [
                '<a href="/pin/61572719900827792/">First cap studio pin</a>',
                '<a href="/pin/61572719900827793/">Second cap studio pin</a>'
              ].join("")
            })
          ]
        });
      }
      return makeAggregate({
        records: [
          normalizeRecord("web/default", "web", {
            url: input.url,
            title: "Fetched cap fairness reference",
            content: "A premium photography studio landing page with cinematic portrait imagery, booking CTA, and editorial motion cues."
          })
        ]
      });
    });
    const captureReference = vi.fn(async (url: string) => makeCapture(`Captured ${url}`));

    const output = await runInspiredesignWorkflow(toRuntime({ fetch, search }), {
      brief: "Design a cinematic photography studio landing page",
      harvest: true,
      query: "premium photography studio landing page",
      providers: ["web/default", "social/pinterest"],
      maxReferences: 2,
      visualEvidence: "off",
      mode: "json"
    }, {
      captureReference
    });

    const meta = output.meta as InspiredesignWorkflowMeta;
    expect(meta.discovery?.acceptedUrls).toEqual([
      "https://www.pinterest.com/pin/61572719900827792/",
      "https://example.com/standard-preserved"
    ]);
    expect(meta.selection.urls).toEqual([
      "https://www.pinterest.com/pin/61572719900827792/",
      "https://example.com/standard-preserved"
    ]);
    expect(captureReference).not.toHaveBeenCalledWith(
      "https://www.pinterest.com/pin/61572719900827793/",
      expect.any(Object)
    );
  });

  it("keeps both mixed provider lanes when duplicate URLs appear before unique references", async () => {
    const duplicateUrl = "https://www.pinterest.com/pin/61572719900827794/";
    const search = vi.fn(async () => makeAggregate({
      records: [
        normalizeRecord("web/default", "web", {
          url: duplicateUrl,
          title: "Duplicate standard URL",
          content: "A duplicate reference that should not consume the standard provider lane."
        }),
        normalizeRecord("web/default", "web", {
          url: "https://example.com/standard-unique-after-duplicate",
          title: "Unique standard reference",
          content: "A premium photography studio landing page with cinematic portrait imagery, booking CTA, and editorial motion cues."
        })
      ]
    }));
    const fetch = vi.fn(async (input: { url: string }) => {
      if (input.url.includes("/search/pins/")) {
        return makeAggregate({
          records: [
            normalizeRecord("social/pinterest", "social", {
              url: input.url,
              title: "Pinterest duplicate fairness results",
              content: [
                '<a href="/pin/61572719900827794/">Duplicate studio pin</a>',
                '<a href="/pin/61572719900827795/">Second studio pin</a>'
              ].join("")
            })
          ]
        });
      }
      return makeAggregate({
        records: [
          normalizeRecord("web/default", "web", {
            url: input.url,
            title: "Fetched duplicate fairness reference",
            content: "A premium photography studio landing page with cinematic portrait imagery, booking CTA, and editorial motion cues."
          })
        ]
      });
    });

    const output = await runInspiredesignWorkflow(toRuntime({ fetch, search }), {
      brief: "Design a cinematic photography studio landing page",
      harvest: true,
      query: "premium photography studio landing page",
      providers: ["web/default", "social/pinterest"],
      maxReferences: 2,
      visualEvidence: "off",
      mode: "json"
    });

    const meta = output.meta as InspiredesignWorkflowMeta;
    expect(meta.selection.urls).toEqual([
      duplicateUrl,
      "https://example.com/standard-unique-after-duplicate"
    ]);
  });

  it("keeps generic recovery when mixed provider search is unavailable", async () => {
    const fetch = vi.fn(async () => makeAggregate({
      records: [
        normalizeRecord("social/pinterest", "social", {
          url: "https://www.pinterest.com/search/pins/?q=studio",
          title: "Pinterest search shell",
          content: "<main>No usable pins</main>"
        })
      ],
      error: {
        code: "unavailable",
        message: "Pinterest search did not expose references.",
        retryable: true,
        reasonCode: "env_limited"
      }
    }));

    const output = await runInspiredesignWorkflow(toRuntime({ fetch }), {
      brief: "Design a cinematic photography studio landing page",
      harvest: true,
      query: "premium photography studio landing page",
      providers: ["web/default", "social/pinterest"],
      visualEvidence: "off",
      mode: "json"
    });

    const meta = output.meta as InspiredesignWorkflowMeta;
    expect(meta.discovery).toEqual(expect.objectContaining({
      siteRecipeId: "social/pinterest",
      acceptedUrls: []
    }));
    expect(meta.nextStepGuidance).toEqual(expect.objectContaining({
      reasonCode: "provider_unavailable"
    }));
    expect(meta.nextStepGuidance?.commands[0]?.command).toContain("--provider web/default");
    expect(meta.nextStepGuidance?.commands[0]?.command).not.toContain("--cookie-policy required");
    expect(["blocked", "needs_recovery"]).toContain(meta.nextStepGuidance?.readiness);
  });

  it("attributes Pinterest browser-native fetch failures to the site recipe provider", async () => {
    const fetch = vi.fn(async () => makeAggregate({
      ok: false,
      records: [],
      providerOrder: ["web/default"],
      error: {
        code: "unavailable",
        message: "generic web fetch could not render Pinterest search",
        retryable: true,
        reasonCode: "env_limited"
      }
    }));

    const output = await runInspiredesignWorkflow(toRuntime({ fetch }), {
      brief: "Design a cinematic photography studio landing page",
      harvest: true,
      query: "premium photography studio landing page",
      providers: ["social/pinterest"],
      browserMode: "extension",
      useCookies: true,
      visualEvidence: "off",
      mode: "json"
    });

    const meta = output.meta as InspiredesignWorkflowMeta;
    const discovery = meta.discovery as InspiredesignWorkflowMeta["discovery"] & {
      failures?: ProviderFailureEntry[];
    };

    expect(discovery.failures?.[0]).toEqual(expect.objectContaining({
      provider: "social/pinterest",
      source: "social"
    }));
    expect(discovery.failures?.[0]?.error).toEqual(expect.objectContaining({
      details: expect.objectContaining({
        upstreamProvider: "web/default",
        upstreamSource: "web"
      })
    }));
    expect(meta.nextStepGuidance).toEqual(expect.objectContaining({
      reasonCode: "pinterest_browser_native_recovery"
    }));
  });

  it("attributes failed Pinterest reference fetches to the site recipe provider", async () => {
    const pinUrl = "https://www.pinterest.com/pin/61572719900827796/";
    const fetch = vi.fn(async (input: { url: string }) => {
      if (input.url.includes("/search/pins/")) {
        return makeAggregate({
          records: [
            normalizeRecord("social/pinterest", "social", {
              url: input.url,
              title: "Pinterest reference fetch attribution results",
              content: '<a href="/pin/61572719900827796/">Studio pin</a>'
            })
          ]
        });
      }
      return makeAggregate({
        ok: false,
        records: [],
        providerOrder: ["web/default"],
        error: {
          code: "unavailable",
          message: "generic web fetch could not render Pinterest pin",
          retryable: true,
          reasonCode: "env_limited"
        }
      });
    });

    const output = await runInspiredesignWorkflow(toRuntime({ fetch }), {
      brief: "Design a cinematic photography studio landing page",
      harvest: true,
      query: "premium photography studio landing page",
      providers: ["social/pinterest"],
      browserMode: "extension",
      useCookies: true,
      visualEvidence: "off",
      mode: "json"
    });

    const meta = output.meta as InspiredesignWorkflowMeta;
    expect(meta.selection.urls).toEqual([pinUrl]);
    expect(meta.primaryConstraint).toEqual(expect.objectContaining({
      provider: "social/pinterest",
      summary: "Pinterest requires manual browser follow-up; this run did not determine whether login or page rendering is required."
    }));
    expect(meta.primaryConstraintSummary).toBe(
      "Pinterest requires manual browser follow-up; this run did not determine whether login or page rendering is required."
    );
  });

  it("keeps real Pinterest diagnostic harvest artifacts blocked when discovered pins render only chrome", async () => {
    const outputDir = makeOutputDir();
    const pinUrls = [
      "https://www.pinterest.com/pin/27654985208435505/",
      "https://www.pinterest.com/pin/8022105583048554/",
      "https://www.pinterest.com/pin/31525266137895345/",
      "https://www.pinterest.com/pin/11188699075430754/",
      "https://www.pinterest.com/pin/14355292557606825/"
    ];
    const fetch = vi.fn(async (input: { url: string }) => {
      if (input.url.includes("/search/pins/")) {
        return makeAggregate({
          records: [
            normalizeRecord("social/pinterest", "social", {
              url: input.url,
              title: "Pinterest visual search shell",
              content: pinUrls.map((url) => `<a href="${url}">Studio reference</a>`).join("\n"),
              attributes: {
                html: pinUrls.map((url) => `<div data-grid-item="true"><a href="${url}"><img alt="Premium studio pin" src="/pin.jpg"></a></div>`).join("\n")
              }
            })
          ]
        });
      }
      return makeAggregate({
        records: [
          normalizeRecord("social/pinterest", "social", {
            url: input.url,
            title: "[r1] link \"Skip to content\" [r2] link \"Your profile\" [r3] button \"Accounts\" [r4] link \"Home\"",
            content: "[r1] link \"Skip to content\" [r2] link \"Your profile\" [r3] button \"Accounts\" [r4] link \"Home\" [r5] link \"Your boards\" [r6] button \"Settings & Support\" [r7] button \"Updates\" [r8] button \"Messages\""
          })
        ]
      });
    });
    const captureReference = vi.fn(async (_url: string, options) => {
      if (!options?.visualEvidencePath) {
        throw new Error("visual evidence path missing");
      }
      writeFileSync(options.visualEvidencePath, Buffer.from("png bytes"));
      return {
        ...makeCapture("[r1] link \"Skip to content\" [r2] link \"Your profile\" [r3] button \"Accounts\" [r4] link \"Home\""),
        visual: {
          status: "captured",
          kind: "viewport",
          fullPage: false,
          capturedAt: "2026-05-21T00:00:00.000Z",
          tempPath: options.visualEvidencePath,
          warnings: []
        }
      };
    });

    const output = await runInspiredesignWorkflow(toRuntime({ fetch }), {
      brief: "Design a prototype landing page for a design agency studio with premium cinematic visual direction",
      harvest: true,
      query: "Pinterest premium design agency studio landing page cinematic 3D parallax portfolio",
      providers: ["social/pinterest"],
      browserMode: "extension",
      useCookies: true,
      cookiePolicyOverride: "required",
      referenceLimit: 5,
      visualEvidence: "required",
      outputDir,
      mode: "path"
    }, {
      captureReference
    });

    const meta = output.meta as InspiredesignWorkflowMeta;
    const artifactPath = String(output.artifact_path);
    const rankedReferences = JSON.parse(readFileSync(join(artifactPath, "ranked-references.json"), "utf8")) as {
      qualitySummary: { rankedReferenceCount: number; rejectedReferenceCount: number; missingScreenshotCount: number };
      references: unknown[];
      rejectedReferences: Array<{ captureStatus?: string; diagnosticReasons?: string[]; fetchStatus?: string; reason?: string }>;
    };
    const screenshotIndex = JSON.parse(readFileSync(join(artifactPath, "screenshot-index.json"), "utf8")) as {
      screenshots: Array<{ path: string }>;
    };
    const designMarkdown = readFileSync(join(artifactPath, "design.md"), "utf8");
    const handoff = JSON.parse(readFileSync(join(artifactPath, "design-agent-handoff.json"), "utf8")) as {
      commandExamples: { continueInCanvas: string };
      nextStepGuidance: NextStepGuidance;
    };

    expect(output).toEqual(expect.objectContaining({
      ready: false,
      readiness: "diagnostic_only",
      harvestReadiness: "diagnostic_only",
      productSuccess: false,
      artifactAuthority: "diagnostic_only",
      rankedReferenceCount: 0
    }));
    expect(meta.selection).toEqual(expect.objectContaining({
      primary_capture_strategy: "source_diagnostic"
    }));
    expect(meta.discovery).toEqual(expect.objectContaining({
      siteRecipeId: "social/pinterest",
      acceptedUrls: pinUrls,
      browserNativeDiagnostics: expect.objectContaining({
        extractedUrlCount: 5,
        sourcePageQuality: "pin_grid_media",
        classificationCounts: expect.objectContaining({ unknown_pin: 5 })
      })
    }));
    expect(meta.nextStepGuidance).toEqual(expect.objectContaining({
      readiness: "diagnostic_only",
      reasonCode: "pinterest_browser_native_recovery"
    }));
    expect(rankedReferences).toMatchObject({
      qualitySummary: {
        rankedReferenceCount: 0,
        rejectedReferenceCount: 5,
        missingScreenshotCount: 0
      },
      references: [],
      rejectedReferences: expect.arrayContaining([
        expect.objectContaining({
          captureStatus: "off",
          fetchStatus: "captured",
          diagnosticReasons: expect.arrayContaining(["interface_chrome_shell"]),
          reason: expect.stringContaining("interface_chrome_shell")
        })
      ])
    });
    expect(screenshotIndex.screenshots).toHaveLength(0);
	expect(designMarkdown).toContain("Canvas plan request omitted until harvest readiness is ready with authoritative visual, motion, or pin-media evidence.");
    expect(designMarkdown).not.toContain("Ready-to-fill `canvasPlanRequest` JSON for `canvas.plan.set`");
	expect(handoff.commandExamples.continueInCanvas).toBe("Unavailable until harvest readiness is ready with authoritative visual, motion, or pin-media evidence.");
    expect(handoff.nextStepGuidance.readiness).toBe("diagnostic_only");
    expect(handoff.nextStepGuidance.commands[0]?.command).toContain("--query");
    expect(handoff.nextStepGuidance.commands[0]?.command).not.toContain("--url");
    expect(handoff.nextStepGuidance.commands[0]?.command).not.toContain(pinUrls[0]);
  });

  it("preserves generic recovery when mixed standard provider search throws", async () => {
    const search = vi.fn(async () => {
      throw new Error("standard provider search failed");
    });
    const fetch = vi.fn(async () => makeAggregate({
      records: [
        normalizeRecord("social/pinterest", "social", {
          url: "https://www.pinterest.com/search/pins/?q=studio",
          title: "Pinterest search shell",
          content: "<main>No usable pins</main>"
        })
      ]
    }));

    const output = await runInspiredesignWorkflow(toRuntime({ fetch, search }), {
      brief: "Design a cinematic photography studio landing page",
      harvest: true,
      query: "premium photography studio landing page",
      providers: ["web/default", "social/pinterest"],
      visualEvidence: "off",
      mode: "json"
    });

    const meta = output.meta as InspiredesignWorkflowMeta;
    expect(meta.discovery).toEqual(expect.objectContaining({
      failure: "standard provider search failed",
      siteRecipeId: "social/pinterest"
    }));
    expect(meta.nextStepGuidance).toEqual(expect.objectContaining({
      reasonCode: "provider_unavailable"
    }));
    expect(meta.nextStepGuidance?.commands[0]?.command).toContain("--provider web/default");
    expect(meta.nextStepGuidance?.commands[0]?.command).not.toContain("--cookie-policy required");
  });

  it("keeps Pinterest browser-native auth failures diagnostic when explicit references succeed", async () => {
    const fetch = vi.fn(async (input: { url: string }) => makeAggregate({
      records: [
        normalizeRecord("web/default", "web", {
          url: input.url,
          title: "Explicit reference",
          content: "Premium ceramic coffee roaster landing page with warm product photography, editorial hero rhythm, and conversion CTA."
        })
      ]
    }));
    const captureReference = vi.fn(async (url: string) => makeCapture(`Captured ${url}`));

    const output = await runInspiredesignWorkflow(toRuntime({ fetch }), {
      brief: "Design a coffee roaster landing page",
      harvest: true,
      query: "premium ceramic coffee roaster landing page design",
      providers: ["social/pinterest"],
      urls: ["https://www.pinterest.com/pin/61572719900827789/"],
      browserMode: "managed",
      useCookies: false,
      cookiePolicyOverride: "required",
      visualEvidence: "off",
      mode: "json"
    }, {
      captureReference
    });

    const meta = output.meta as InspiredesignWorkflowMeta;
    expect(meta.metrics).toEqual(expect.objectContaining({
      reference_count: 1,
      fetched_references: 1,
      captured_references: 0
    }));
    expect(meta.metrics.reasonCodeDistribution).toEqual(expect.objectContaining({
      auth_required: 1
    }));
    expect(meta.discovery).toEqual(expect.objectContaining({
      requested: true,
      searchAvailable: true,
      failure: "social/pinterest requires an authenticated browser session before search results are visible.",
      siteRecipeId: "social/pinterest"
    }));
    expect(meta.primaryConstraintSummary).toBeUndefined();
    expect(meta.primaryConstraint).toBeUndefined();
    expect(meta.nextStepGuidance).toEqual(expect.objectContaining({
      readiness: "blocked",
      reasonCode: "pinterest_browser_native_recovery"
    }));
    expect(output).toEqual(expect.objectContaining({
      ready: false,
      productSuccess: false,
      rankedReferenceCount: 0
    }));
  });

  it("rejects Pinterest provider query harvests with unrelated explicit references", async () => {
    await expect(runInspiredesignWorkflow(toRuntime({}), {
      brief: "Design a coffee roaster landing page",
      harvest: true,
      query: "premium ceramic coffee roaster landing page design",
      providers: ["social/pinterest"],
      urls: ["https://example.com/coffee-roaster-reference"],
      browserMode: "managed",
      useCookies: false,
      cookiePolicyOverride: "required",
      visualEvidence: "off",
      mode: "json"
    })).rejects.toThrow(
      "URL https://example.com/coffee-roaster-reference is not a canonical social/pinterest reference URL"
    );
  });

  it("does not cap explicit non-harvest URLs when visual evidence is enabled", async () => {
    const urls = Array.from({ length: 11 }, (_, index) => `https://example.com/reference-${index + 1}`);
    const fetch = vi.fn(async (input: { url: string }) => makeAggregate({
      records: [
        normalizeRecord("web/default", "web", {
          url: input.url,
          title: `Fetched ${input.url}`,
          content: "Reference content with enough detail for a design excerpt."
        })
      ]
    }));
    const captureReference = vi.fn(async (url: string) => makeCapture(`Captured ${url}`));

    await runInspiredesignWorkflow(toRuntime({ fetch }), {
      brief: "Design a docs workspace",
      urls,
      visualEvidence: "auto",
      mode: "json"
    }, {
      captureReference
    });

    expect(fetch.mock.calls.map((call) => call[0].url)).toEqual(urls);
  });

  it("rejects workflow visual temp paths that do not match the capture plan", async () => {
    const outputDir = makeOutputDir();
    const roguePath = join(outputDir, "rogue.png");
    writeFileSync(roguePath, Buffer.from("rogue png bytes"));
    const captureReference = vi.fn(async () => ({
      ...makeCapture("Captured mismatched visual"),
      visual: {
        status: "captured" as const,
        kind: "viewport" as const,
        fullPage: false,
        capturedAt: "2026-05-18T00:00:00.000Z",
        tempPath: roguePath,
        warnings: []
      }
    }));

    const output = await runInspiredesignWorkflow(toRuntime({
      fetch: async (input: { url: string }) => makeAggregate({
        records: [
          normalizeRecord("web/default", "web", {
            url: input.url,
            title: "Reference title",
            content: "Reference content with enough detail for a design excerpt."
          })
        ]
      })
    }), {
      brief: "Design a docs workspace",
      urls: ["https://example.com/reference"],
      outputDir,
      visualEvidence: "required",
      mode: "path"
    }, {
      captureReference
    });

    const meta = output.meta as InspiredesignWorkflowMeta;
    const artifactPath = String(output.artifact_path);
    const visualEvidence = JSON.parse(readFileSync(join(artifactPath, "visual-evidence.json"), "utf8")) as {
      visualEvidence: Array<{ visual: { status: string; path?: string; failure?: string; warnings: string[] } }>;
    };
    const screenshotIndex = JSON.parse(readFileSync(join(artifactPath, "screenshot-index.json"), "utf8")) as {
      screenshots: unknown[];
    };

    expect(meta.metrics.failed_captures).toBe(1);
    expect(visualEvidence.visualEvidence[0]?.visual).toEqual(expect.objectContaining({
      status: "failed",
      failure: "Visual evidence temp path did not match the workflow capture plan.",
      warnings: ["visual_temp_path_mismatch"]
    }));
    expect(visualEvidence.visualEvidence[0]?.visual.path).toBeUndefined();
    expect(screenshotIndex.screenshots).toEqual([]);
  });

  it("rejects captured visual metadata that lacks the planned temp path", async () => {
    const outputDir = makeOutputDir();
    const rogueArtifactPath = "visual-evidence/attacker/viewport.png";
    const captureReference = vi.fn(async () => ({
      ...makeCapture("Captured visual without planned temp path"),
      visual: {
        status: "captured" as const,
        kind: "viewport" as const,
        fullPage: false,
        capturedAt: "2026-05-18T00:00:00.000Z",
        artifactPath: rogueArtifactPath,
        warnings: []
      }
    }));

    const output = await runInspiredesignWorkflow(toRuntime({
      fetch: async (input: { url: string }) => makeAggregate({
        records: [
          normalizeRecord("web/default", "web", {
            url: input.url,
            title: "Reference title",
            content: "Reference content with enough detail for a design excerpt."
          })
        ]
      })
    }), {
      brief: "Design a docs workspace",
      urls: ["https://example.com/reference-without-temp-path"],
      outputDir,
      visualEvidence: "required",
      mode: "path"
    }, {
      captureReference
    });

    const meta = output.meta as InspiredesignWorkflowMeta;
    const artifactPath = String(output.artifact_path);
    const visualEvidenceJson = readFileSync(join(artifactPath, "visual-evidence.json"), "utf8");
    const screenshotIndexJson = readFileSync(join(artifactPath, "screenshot-index.json"), "utf8");
    const evidenceJson = readFileSync(join(artifactPath, "evidence.json"), "utf8");
    const visualEvidence = JSON.parse(visualEvidenceJson) as {
      visualEvidence: Array<{ visual: { status: string; path?: string; failure?: string; warnings: string[] } }>;
    };
    const screenshotIndex = JSON.parse(screenshotIndexJson) as {
      screenshots: unknown[];
    };

    expect(meta.metrics.failed_captures).toBe(1);
    expect(visualEvidence.visualEvidence[0]?.visual).toEqual(expect.objectContaining({
      status: "failed",
      failure: "Visual evidence temp path did not match the workflow capture plan.",
      warnings: ["visual_temp_path_mismatch"]
    }));
    expect(visualEvidence.visualEvidence[0]?.visual.path).toBeUndefined();
    expect(screenshotIndex.screenshots).toEqual([]);
    for (const jsonText of [visualEvidenceJson, screenshotIndexJson, evidenceJson]) {
      expect(jsonText).not.toContain(rogueArtifactPath);
      expect(jsonText).not.toContain("attacker");
    }
  });

  it("rejects captured visual metadata with an invalid visual kind", async () => {
    const outputDir = makeOutputDir();
    const maliciousKind = "../outside";
    const captureReference = vi.fn(async (_url: string, options?: { visualEvidencePath?: string }) => {
      if (!options?.visualEvidencePath) {
        throw new Error("visual evidence path missing");
      }
      writeFileSync(options.visualEvidencePath, Buffer.from("valid planned png bytes"));
      return {
        ...makeCapture("Captured visual with invalid kind"),
        visual: {
          status: "captured" as const,
          kind: maliciousKind as "viewport",
          fullPage: false,
          capturedAt: "2026-05-18T00:00:00.000Z",
          tempPath: options.visualEvidencePath,
          warnings: []
        }
      };
    });

    const output = await runInspiredesignWorkflow(toRuntime({
      fetch: async (input: { url: string }) => makeAggregate({
        records: [
          normalizeRecord("web/default", "web", {
            url: input.url,
            title: "Reference title",
            content: "Reference content with enough detail for a design excerpt."
          })
        ]
      })
    }), {
      brief: "Design a docs workspace",
      urls: ["https://example.com/reference-invalid-kind"],
      outputDir,
      visualEvidence: "required",
      mode: "path"
    }, {
      captureReference
    });

    const meta = output.meta as InspiredesignWorkflowMeta;
    const artifactPath = String(output.artifact_path);
    const visualEvidenceJson = readFileSync(join(artifactPath, "visual-evidence.json"), "utf8");
    const screenshotIndexJson = readFileSync(join(artifactPath, "screenshot-index.json"), "utf8");
    const evidenceJson = readFileSync(join(artifactPath, "evidence.json"), "utf8");
    const visualEvidence = JSON.parse(visualEvidenceJson) as {
      visualEvidence: Array<{ visual: { status: string; kind: string; path?: string; failure?: string; warnings: string[] } }>;
    };
    const screenshotIndex = JSON.parse(screenshotIndexJson) as {
      screenshots: unknown[];
    };

    expect(meta.metrics.failed_captures).toBe(1);
    expect(visualEvidence.visualEvidence[0]?.visual).toEqual(expect.objectContaining({
      status: "failed",
      kind: "viewport",
      failure: "Visual evidence kind did not match the workflow capture contract.",
      warnings: ["visual_kind_mismatch"]
    }));
    expect(visualEvidence.visualEvidence[0]?.visual.path).toBeUndefined();
    expect(screenshotIndex.screenshots).toEqual([]);
    for (const jsonText of [visualEvidenceJson, screenshotIndexJson, evidenceJson]) {
      expect(jsonText).not.toContain(maliciousKind);
    }
  });

  it("rejects unplanned workflow visual temp paths when visual evidence is disabled", async () => {
    const outputDir = makeOutputDir();
    const roguePath = join(outputDir, "unplanned-rogue.png");
    writeFileSync(roguePath, Buffer.from("unplanned rogue png bytes"));
    const captureReference = vi.fn(async () => ({
      ...makeCapture("Captured unplanned visual"),
      visual: {
        status: "captured" as const,
        kind: "viewport" as const,
        fullPage: false,
        capturedAt: "2026-05-18T00:00:00.000Z",
        tempPath: roguePath,
        warnings: []
      }
    }));

    const output = await runInspiredesignWorkflow(toRuntime({
      fetch: async (input: { url: string }) => makeAggregate({
        records: [
          normalizeRecord("web/default", "web", {
            url: input.url,
            title: "Reference title",
            content: "Reference content with enough detail for a design excerpt."
          })
        ]
      })
    }), {
      brief: "Design a docs workspace",
      urls: ["https://example.com/reference"],
      outputDir,
      visualEvidence: "off",
      mode: "path"
    }, {
      captureReference
    });

    const artifactPath = String(output.artifact_path);
    const evidence = JSON.parse(readFileSync(join(artifactPath, "evidence.json"), "utf8")) as InspiredesignWorkflowEvidence;
    const evidenceText = JSON.stringify(evidence);

    expect(evidence.references[0]?.capture?.visual).toEqual(expect.objectContaining({
      status: "failed",
      failure: "Visual evidence temp path did not match the workflow capture plan.",
      warnings: ["visual_temp_path_mismatch"]
    }));
    expect(evidenceText).not.toContain(roguePath);
    expect(evidenceText).not.toContain("unplanned rogue png bytes");
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

  it("keeps deep capture mode for harvest inputs with non-Pinterest explicit urls", async () => {
    const { resolveInspiredesignHarvestCaptureMode } = await import("../src/inspiredesign/capture-mode");

    expect(resolveInspiredesignHarvestCaptureMode({
      requested: "off",
      harvest: true,
      providers: ["social/pinterest"],
      urls: ["https://example.com/reference"]
    })).toBe("deep");
    expect(resolveInspiredesignHarvestCaptureMode({
      requested: "off",
      harvest: true,
      providers: ["web/default"],
      urls: ["https://www.pinterest.com/pin/27654985208435505/"]
    })).toBe("deep");
    expect(resolveInspiredesignHarvestCaptureMode({
      requested: "off",
      harvest: true,
      providers: ["social/pinterest", "web/default"],
      urls: ["https://www.pinterest.com/pin/27654985208435505/"]
    })).toBe("deep");
  });

  it("disables deep capture mode for Pinterest-only harvest inputs", async () => {
    const { resolveInspiredesignHarvestCaptureMode } = await import("../src/inspiredesign/capture-mode");

    expect(resolveInspiredesignHarvestCaptureMode({
      requested: "deep",
      harvest: true,
      providers: ["social/pinterest"],
      urls: ["https://www.pinterest.com/pin/27654985208435505/"]
    })).toBe("off");
    expect(resolveInspiredesignHarvestCaptureMode({
      requested: "deep",
      harvest: true,
      providers: ["pinterest"]
    })).toBe("off");
  });

  it("disables deep capture mode for direct canonical Pinterest pin inputs by default", async () => {
    const { resolveInspiredesignHarvestCaptureMode } = await import("../src/inspiredesign/capture-mode");

    expect(resolveInspiredesignHarvestCaptureMode({
      requested: undefined,
      harvest: false,
      providers: [],
      urls: ["https://www.pinterest.com/pin/84301824269977360"]
    })).toBe("off");
    expect(resolveInspiredesignHarvestCaptureMode({
      requested: "off",
      harvest: false,
      providers: [],
      urls: ["https://uk.pinterest.com/pin/1055599900892243/"]
    })).toBe("off");
    expect(resolveInspiredesignHarvestCaptureMode({
      requested: "deep",
      harvest: false,
      providers: [],
      urls: ["https://www.pinterest.com/pin/84301824269977360"]
    })).toBe("deep");
    expect(resolveInspiredesignHarvestCaptureMode({
      requested: undefined,
      harvest: false,
      providers: [],
      urls: ["https://www.pinterest.com/search/pins/?q=studio"]
    })).toBe("deep");
  });

  it("parses valid inspiredesign envelopes and forwards every optional runtime override", async () => {
    const fetch = vi.fn(async (input: { url: string }) => makeAggregate({
      records: [
        normalizeRecord("web/default", "web", {
          url: input.url,
          title: "Premium docs workspace landing reference",
          content: "Premium docs workspace landing page with editorial hero, docs homepage navigation, refined typography, product story, knowledge base structure, and restrained motion cues."
        })
      ]
    }));
    const captureReference = vi.fn(async (url: string, options?: { visualEvidencePath?: string }) => {
      if (!options?.visualEvidencePath) {
        throw new Error("visual evidence path missing");
      }
      writeFileSync(options.visualEvidencePath, Buffer.from("docs workspace visual artifact"));
      return {
        ...makeCapture(`Premium docs workspace captured reference ${url}`),
        visual: {
          status: "captured",
          kind: "viewport",
          fullPage: false,
          capturedAt: "2026-05-26T00:00:00.000Z",
          tempPath: options.visualEvidencePath,
			sourceUrl: url,
          warnings: []
        }
      };
    });
    const runtime = toRuntime({ fetch });

    const output = await runInspiredesignWorkflow(runtime, buildWorkflowResumeEnvelope("inspiredesign", {
      brief: "Design a docs workspace",
      urls: [" https://example.com/reference ", "https://example.com/reference"],
      captureMode: "deep",
      visualEvidence: "required",
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
    expect(meta.deepCaptureRecommendation).toContain("Use captureMode=deep");
  });

  it("drops primitive cached brief formats while accepting valid envelope browser mode", async () => {
    const staleBriefExpansion: JsonValue = {
      sourceBrief: "Design a premium launch surface",
      advancedBrief: "Primitive cached brief should be ignored.",
      templateVersion: "inspiredesign-advanced-brief.v1",
      format: "not-a-format"
    };

    const output = await runInspiredesignWorkflow(toRuntime({}), buildWorkflowResumeEnvelope("inspiredesign", {
      brief: "Design a premium launch surface",
      briefExpansion: staleBriefExpansion,
      browserMode: "managed",
      mode: "context"
    }));

    const context = output.context as InspiredesignWorkflowContext;
    const meta = output.meta as InspiredesignWorkflowMeta;

    expect(context.advancedBriefMarkdown).toContain("Selected prompt format:");
    expect(context.advancedBriefMarkdown).not.toContain("Primitive cached brief should be ignored.");
    expect(meta.selection.requested_browser_mode).toBe("managed");
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

  it("rejects blank inspiredesign envelope output dirs", async () => {
    const fetch = vi.fn(async () => makeAggregate());
    const runtime = toRuntime({ fetch });

    await expect(runInspiredesignWorkflow(runtime, {
      kind: "inspiredesign",
      input: {
        brief: "Design a calm control surface",
        outputDir: ""
      }
    } as never)).rejects.toThrow("outputDir cannot be empty");
    await expect(runInspiredesignWorkflow(runtime, {
      kind: "inspiredesign",
      input: {
        brief: "Design a calm control surface",
        outputDir: "   "
      }
    } as never)).rejects.toThrow("outputDir cannot be empty");
    expect(fetch).not.toHaveBeenCalled();
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

  it("regenerates cached brief expansions whose source brief no longer matches", async () => {
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
        sourceBrief: "Design an unrelated support portal",
        advancedBrief: "Selected prompt format: Stale source brief\n\nSource brief:\nDesign an unrelated support portal"
      }),
      urls: ["https://example.com/cached"],
      mode: "context"
    }));

    const context = output.context as InspiredesignWorkflowContext;

    expect(context.advancedBriefMarkdown).toContain("Selected prompt format:");
    expect(context.advancedBriefMarkdown).toContain("Design a premium launch surface");
    expect(context.advancedBriefMarkdown).not.toContain("Stale source brief");
    expect(context.advancedBriefMarkdown).not.toContain("Design an unrelated support portal");
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
      primaryConstraintSummary: "Pinterest requires a live browser-rendered page.",
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
      primaryConstraintSummary: "Pinterest requires a live browser-rendered page."
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
