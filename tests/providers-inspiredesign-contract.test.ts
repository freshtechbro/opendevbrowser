import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import type {
  InspiredesignBriefExpansion,
  InspiredesignBriefFormat
} from "../src/inspiredesign/brief-expansion";
import type { NextStepGuidance } from "../src/guidance/types";
import type { JsonValue } from "../src/providers/types";
import {
  buildInspiredesignPacket,
  formatInspiredesignCaptureAttemptSummary,
  hasInspiredesignCaptureArtifacts,
  normalizeInspiredesignCaptureEvidence,
  type InspiredesignReferenceEvidence
} from "../src/inspiredesign/contract";
import { validateGenerationPlan } from "../src/canvas/document-store";
import {
  INSPIREDESIGN_ARTIFACT_GUIDE,
  INSPIREDESIGN_CONTRACT_SECTION_GUIDE,
  INSPIREDESIGN_HANDOFF_COMMANDS,
  INSPIREDESIGN_HANDOFF_FILES,
  INSPIREDESIGN_HANDOFF_GUIDANCE,
  INSPIREDESIGN_HANDOFF_RECOMMENDED_SKILLS,
  buildInspiredesignFollowthroughSummary,
  buildInspiredesignNextStep
} from "../src/inspiredesign/handoff";
import {
  buildInspiredesignRankedArtifactPatternBoard,
  buildInspiredesignReferencePatternBoard,
  hasInspiredesignUsableReferenceEvidence
} from "../src/inspiredesign/reference-pattern-board";
import { renderInspiredesign } from "../src/providers/renderer";
import { buildInspiredesignSuccessHandoff } from "../src/providers/workflow-handoff";

type InspiredesignEvidenceJson = {
  brief: string;
  briefHash: string;
  advancedBrief: string;
  advancedBriefHash: string;
  briefExpansion: {
    templateVersion: string;
    format: InspiredesignBriefFormat;
  };
  urls: string[];
  referenceCount: number;
  references: Array<{
    id: string;
    url: string;
    title?: string;
    excerpt?: string;
    fetchStatus: string;
    captureStatus: string;
    fetchFailure?: string;
    captureFailure?: string;
    capture: JsonValue;
  }>;
  referencePatternBoard?: {
    references: Array<{
      id: string;
      rank?: number;
      score?: number;
      confidence?: number;
      capturedVia: string[];
      visualStrengths?: string[];
      visualRisks?: string[];
      layoutRecipe: string;
      patternsToBorrow: string[];
      patternsToReject: string[];
    }>;
    rejectedReferences?: Array<{
      id: string;
      fetchStatus: string;
      captureStatus: string;
    }>;
    synthesis: {
      dominantDirection: string;
      sharedStrengths: string[];
      contractDeltas: string[];
    };
  };
  rankedReferences?: NonNullable<InspiredesignEvidenceJson["referencePatternBoard"]>["references"];
  visualEvidence?: Array<{
    referenceId: string;
    visual: {
      path?: string;
      sha256?: string;
      bytes?: number;
    };
  }>;
  screenshotIndex?: Array<{
    referenceId: string;
    path: string;
    sha256: string;
    bytes: number;
  }>;
  designVectors?: {
    sourcePriority: string;
    directionLabel: string;
    surfaceIntent: string;
    compositionModel: string[];
    premiumPosture: string[];
    motionPosture: string[];
    sectionArchitecture: string[];
    typographyPosture: string[];
    imageryPosture: string[];
    interactionDensity: string;
    interactionMoments: string[];
    materialEffects: string[];
    advancedMotionAdvisory: string[];
    referenceInfluence: string[];
    patternsToBorrow: string[];
    patternsToReject: string[];
  };
  targetAnalysis?: InspiredesignTargetAnalysisJson;
};

type InspiredesignTargetKind = "page" | "component" | "asset";

type InspiredesignTargetAnalysisJson = {
  primaryKind: InspiredesignTargetKind;
  kinds: InspiredesignTargetKind[];
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
  page?: {
    canvasType: "CanvasPage";
    assemblyFocus: string[];
  };
  component?: {
    canvasType: "CanvasComponentInventoryItem";
    inventoryItems: Array<{
      name: string;
      props: Array<{ name: string; type: string }>;
      slots: Array<{ name: string; allowedKinds: string[] }>;
      events: Array<{ name: string }>;
      content: { acceptsText: boolean; acceptsRichText: boolean; slotNames: string[] };
    }>;
  };
  asset?: {
    canvasType: "CanvasAsset";
    assets: Array<{
      id: string;
      sourceType: string;
      kind: string;
      usageNotes: string[];
    }>;
  };
};

type PlanMotionMaterialFields = {
  interactionMoments?: string[];
  materialEffects?: string[];
};

type HandoffTargetAnalysisFields = {
  implementationContext: {
    targetAnalysis?: InspiredesignTargetAnalysisJson;
  };
};

type GenerationTargetAnalysisFields = {
  targetAnalysis?: InspiredesignTargetAnalysisJson;
};

type CanvasTargetAnalysisLeakFields = {
  targetAnalysis?: InspiredesignTargetAnalysisJson;
  prototypeScope?: string;
  sourceArtifacts?: string[];
  artifactGuide?: string;
  contractSectionGuide?: string;
};

const FORBIDDEN_CANVAS_PLAN_KEYS = new Set([
  "targetAnalysis",
  "confidence",
  "triggeringSignals",
  "prototypeScope",
  "sourceArtifacts",
  "artifactGuide",
  "contractSectionGuide"
]);

const hasForbiddenCanvasPlanKey = (value: JsonValue): boolean => {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => hasForbiddenCanvasPlanKey(item));
  return Object.entries(value).some(([key, nested]) => (
    FORBIDDEN_CANVAS_PLAN_KEYS.has(key) || hasForbiddenCanvasPlanKey(nested)
  ));
};

const makeReference = (
  overrides: Partial<InspiredesignReferenceEvidence> = {}
): InspiredesignReferenceEvidence => ({
  id: "ref-1",
  url: "https://example.com/ref-1",
  fetchStatus: "captured",
  captureStatus: "off",
  ...overrides
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
  sourceBrief: "Design a premium product narrative landing page",
  advancedBrief: "Selected prompt format: Premium editorial landing page\n\nSource brief:\nDesign a premium product narrative landing page\n\nPrompt objective:\nStudy the inspiration references and synthesize a premium editorial landing page system that translates the source brief into a reusable, brand-specific direction.",
  templateVersion: "inspiredesign-advanced-brief.v1",
  format: makeBriefFormat(),
  ...overrides
});

describe("inspiredesign packet + renderer", () => {
  it("builds an auth-focused dark packet without live references", () => {
    const packet = buildInspiredesignPacket({
      brief: "  Design a dark login experience for enterprise onboarding teams. Keep the flow calm and premium.  ",
      briefExpansion: makeBriefExpansion({
        sourceBrief: "Design a dark login experience for enterprise onboarding teams. Keep the flow calm and premium.",
        advancedBrief: "Selected prompt format: Mobile-first onboarding and activation flow\n\nSource brief:\nDesign a dark login experience for enterprise onboarding teams. Keep the flow calm and premium.\n\nPrompt objective:\nWork from the inspiration references and source brief to define a mobile-first onboarding and activation experience that moves a user from curiosity to a confident first action.",
        format: makeBriefFormat({
          id: "mobile-first-onboarding-activation",
          label: "Mobile-first onboarding and activation flow",
          bestFor: ["consumer apps"],
          businessFocus: ["consumer mobile apps"],
          keywords: ["mobile", "onboarding", "activation"],
          archetype: "trust-forward activation flow",
          layoutArchetype: "screen-sequenced onboarding stack with clear first-action transition",
          typographySystem: "high-legibility mobile sans with deliberate contrast between titles, helper copy, and CTA labels",
          surfaceTreatment: "native-feeling surfaces, clean overlays, and quiet previews of the core product",
          shapeLanguage: "soft, tap-friendly forms and decisive CTA containers",
          componentGrammar: "value slides, progress moments, CTA stacks, trust cues, first-session empty states",
          motionGrammar: "confident screen pacing, low-friction transitions, and gentle confirmation motion",
          paletteIntent: "safe, modern mobile palette with one brand accent and generous clean space",
          visualDensity: "balanced",
          designVariance: "low-noise clarity",
          responsiveCollapseRules: ["Treat mobile as the source layout and only expand supporting previews for larger breakpoints."],
          guardrails: ["Keep the system simple, emotionally clear, and conversion-focused instead of overloaded with feature marketing."],
          antiPatterns: ["No marketing landing page hero inside onboarding."],
          deliverables: ["Return a reusable onboarding direction."],
          route: {
            profile: "auth-focused",
            themeStrategy: "light-dark-parity",
            navigationModel: "contextual",
            layoutApproach: "stacked-mobile-flow"
          }
        })
      }),
      urls: [" https://example.com/login "],
      references: []
    });

    expect(packet.generationPlan.visualDirection.profile).toBe("auth-focused");
    expect(packet.generationPlan.visualDirection.themeStrategy).toBe("light-dark-parity");
    expect(packet.canvasPlanRequest).toMatchObject({
      requestId: expect.stringMatching(/^req_plan_/),
      canvasSessionId: "<canvas-session-id>",
      leaseId: "<lease-id>",
      documentId: "<document-id>",
      generationPlan: {
        targetOutcome: packet.generationPlan.targetOutcome,
        visualDirection: packet.generationPlan.visualDirection,
        layoutStrategy: packet.generationPlan.layoutStrategy,
        contentStrategy: packet.generationPlan.contentStrategy,
        componentStrategy: packet.generationPlan.componentStrategy,
        motionPosture: packet.generationPlan.motionPosture,
        responsivePosture: packet.generationPlan.responsivePosture,
        accessibilityPosture: packet.generationPlan.accessibilityPosture,
        validationTargets: packet.generationPlan.validationTargets
      }
    });
    expect("referencePatternBoard" in packet.canvasPlanRequest.generationPlan).toBe(false);
    expect(packet.canvasPlanRequest.generationPlan.designVectors).toMatchObject({
      premiumPosture: expect.arrayContaining([expect.stringContaining("Premium typography")]),
      motionPosture: expect.arrayContaining([expect.stringContaining("reveal")]),
      sectionArchitecture: expect.arrayContaining([expect.stringContaining("screen sequence")]),
      referenceInfluence: expect.arrayContaining([expect.stringContaining("trust-forward")])
    });
    expect(packet.followthrough).toMatchObject({
      summary: buildInspiredesignFollowthroughSummary(),
      nextStep: buildInspiredesignNextStep(),
      artifactGuide: {
        "advanced-brief.md": expect.objectContaining({
          purpose: expect.stringContaining("reference-first brief"),
          expectedContents: expect.arrayContaining(["Selected prompt format"]),
          howToUse: expect.arrayContaining(["Read first"]),
          mustNot: expect.arrayContaining([expect.stringContaining("captured references")])
        }),
        "canvas-plan.request.json": expect.objectContaining({
          howToUse: expect.arrayContaining([expect.stringContaining("canvas.plan.set")]),
          mustNot: expect.arrayContaining([expect.stringContaining("handoff-only fields")])
        }),
        "design-agent-handoff.json": expect.objectContaining({
          expectedContents: expect.arrayContaining(["artifact and section guides"])
        })
      },
      contractSectionGuide: {
        generationPlan: expect.objectContaining({
          purpose: expect.stringContaining("Mutation-safe subset"),
          mustNot: expect.arrayContaining([expect.stringContaining("handoff-only guide fields")])
        }),
        motionSystem: expect.objectContaining({
          howToUse: expect.arrayContaining([expect.stringContaining("shader")]),
          mustNot: expect.arrayContaining([expect.stringContaining("runtime libraries")])
        }),
        navigationModel: expect.objectContaining({
          mustNot: expect.arrayContaining([expect.stringContaining("Canvas governance")])
        })
      },
      briefExpansion: {
        templateVersion: "inspiredesign-advanced-brief.v1",
        file: "advanced-brief.md",
        format: {
          id: "mobile-first-onboarding-activation",
          label: "Mobile-first onboarding and activation flow",
          bestFor: ["consumer apps"],
          route: {
            profile: "auth-focused",
            themeStrategy: "light-dark-parity",
            navigationModel: "contextual",
            layoutApproach: "stacked-mobile-flow"
          }
        }
      },
      recommendedSkills: [...INSPIREDESIGN_HANDOFF_RECOMMENDED_SKILLS],
      commandExamples: {
        loadBestPractices: INSPIREDESIGN_HANDOFF_COMMANDS.loadBestPractices,
        loadDesignAgent: INSPIREDESIGN_HANDOFF_COMMANDS.loadDesignAgent,
        loadMotionDesign: INSPIREDESIGN_HANDOFF_COMMANDS.loadMotionDesign,
        continueInCanvas: INSPIREDESIGN_HANDOFF_COMMANDS.continueInCanvas
      },
      deepCaptureRecommendation: INSPIREDESIGN_HANDOFF_GUIDANCE.deepCaptureRecommendation,
      contractScope: {
        emittedContract: "CanvasDesignGovernance",
        omittedTemplateBlocks: ["navigationModel", "asyncModel", "performanceModel"],
        note: expect.stringContaining("design-contract.json is the narrowed canvas governance contract")
      },
      implementationContext: expect.objectContaining({
        navigationModel: expect.any(Object),
        asyncModel: expect.any(Object),
        performanceModel: expect.any(Object)
      })
    });
    expect(packet.followthrough.artifactGuide).toEqual(INSPIREDESIGN_ARTIFACT_GUIDE);
    expect(packet.followthrough.contractSectionGuide).toEqual(INSPIREDESIGN_CONTRACT_SECTION_GUIDE);
    expect(packet.prototypeGuidanceMarkdown).toBeNull();
    expect(packet.advancedBriefMarkdown).toContain("Selected prompt format:");
    expect(packet.designMarkdown).toContain("No live inspiration source was provided. The system is derived entirely from the brief.");
    expect(packet.designMarkdown).toContain("layout archetype:");
    expect(packet.implementationPlan.risksAndAmbiguities[0]).toContain("No live references were supplied");
  });

  it("requires light and dark validation targets for multi-theme routes", () => {
    const packet = buildInspiredesignPacket({
      brief: "Design a cultural festival atlas with a themed system that shifts across contexts.",
      briefExpansion: makeBriefExpansion({
        format: makeBriefFormat({
          id: "cultural-festival-atlas",
          label: "Cultural festival atlas",
          route: {
            profile: "documentation",
            themeStrategy: "multi-theme-system",
            navigationModel: "sidebar",
            layoutApproach: "festival-atlas-system"
          }
        })
      }),
      urls: [],
      references: []
    });

    expect(packet.generationPlan.visualDirection.themeStrategy).toBe("multi-theme-system");
    expect(packet.generationPlan.validationTargets.requiredThemes).toEqual(["light", "dark"]);
  });

  it("builds a reference-rich packet with trimmed evidence, failures, and prototype guidance", () => {
    const packet = buildInspiredesignPacket({
      brief: "  Design a documentation hub that feels premium but remains implementation-aware.  ",
      briefExpansion: makeBriefExpansion({
        sourceBrief: "Design a documentation hub that feels premium but remains implementation-aware.",
        advancedBrief: "Selected prompt format: Premium editorial landing page\n\nSource brief:\nDesign a documentation hub that feels premium but remains implementation-aware.\n\nPrompt objective:\nStudy the inspiration references and synthesize a premium editorial landing page system that translates the source brief into a reusable, brand-specific direction."
      }),
      urls: [
        " https://example.com/docs ",
        "https://example.com/docs",
        "https://example.com/cards"
      ],
      includePrototypeGuidance: true,
      references: [
        makeReference({
          id: "docs-home",
          url: "https://example.com/docs",
          title: "  Docs Home  ",
          excerpt: "  Rich product documentation with deep navigation and strong hero clarity.  ",
          captureStatus: "captured",
          capture: {
            title: "Docs Home",
            snapshot: {
              content: "Hero, sidebar navigation, feature cards",
              refCount: 9,
              warnings: ["network idle timeout"]
            },
            dom: {
              outerHTML: "<main>docs</main>",
              truncated: false
            },
            clone: {
              componentPreview: "<section>Docs hero</section>",
              cssPreview: ".docs-hero { display: grid; }",
              warnings: []
            },
            attempts: {
              snapshot: { status: "captured" },
              clone: { status: "captured" },
              dom: { status: "captured" }
            }
          }
        }),
        makeReference({
          id: "cards",
          url: "https://example.com/cards",
          excerpt: "  Quiet editorial cards with generous whitespace and strong CTA focus.  ",
          fetchStatus: "captured",
          captureStatus: "off"
        }),
        makeReference({
          id: "notes-only",
          url: "https://example.com/notes",
          fetchStatus: "skipped",
          captureStatus: "failed",
          fetchFailure: "Manual notes only",
          captureFailure: "Browser capture unavailable"
        })
      ]
    });

    const evidence = packet.evidence as InspiredesignEvidenceJson;

    expect(packet.prototypeGuidanceMarkdown).toContain("# 6. Optional Prototype Plan");
    expect(packet.advancedBriefMarkdown).toContain("Reference-led public landing page");
    expect(packet.designContract.intent.referenceCount).toBe(2);
    expect(evidence.briefExpansion.templateVersion).toBe("inspiredesign-advanced-brief.v1");
    expect(evidence.advancedBrief).toContain("Prompt objective:");
    expect(evidence.urls).toEqual([
      "https://example.com/docs",
      "https://example.com/cards"
    ]);
    expect(evidence.referenceCount).toBe(3);
    expect(evidence.references[0]).toMatchObject({
      id: "docs-home",
      title: "Docs Home",
      excerpt: "Rich product documentation with deep navigation and strong hero clarity.",
      fetchStatus: "captured",
      captureStatus: "captured",
      capture: expect.objectContaining({
        title: "Docs Home",
        signals: expect.arrayContaining([
          "Docs Home",
          "Rich product documentation with deep navigation and strong hero clarity.",
          "Hero, sidebar navigation, feature cards"
        ]),
        attempts: {
          snapshot: { status: "captured" },
          clone: { status: "captured" },
          dom: { status: "captured" }
        }
      })
    });
    const captureText = JSON.stringify(evidence.references[0]?.capture);
    expect(captureText).not.toContain("<main>docs</main>");
    expect(captureText).not.toContain("<section>Docs hero</section>");
    expect(captureText).not.toContain(".docs-hero");
    expect(evidence.references[2]).toMatchObject({
      fetchStatus: "skipped",
      captureStatus: "failed",
      fetchFailure: "Manual notes only",
      captureFailure: "Browser capture unavailable"
    });
    expect(packet.designMarkdown).toContain("### Source 1: Docs Home");
    expect(packet.designMarkdown).toContain("Capture warnings: network idle timeout");
    expect(packet.designMarkdown).not.toContain("Only operator brief context was available for this reference.");
    expect(packet.designMarkdown).not.toContain("Browser capture unavailable");
    expect(packet.designMarkdown).toContain("Prototype guidance Markdown for the first HTML pass");
  });

  it("threads reference-specific cues through every Canvas handoff artifact", () => {
    const packet = buildInspiredesignPacket({
      brief: "Create a launch page inspired by an architectural lighting studio.",
      briefExpansion: makeBriefExpansion({
        sourceBrief: "Create a launch page inspired by an architectural lighting studio."
      }),
      urls: ["https://example.com/lighting-studio"],
      includePrototypeGuidance: true,
      references: [
        makeReference({
          id: "lighting-studio",
          url: "https://example.com/lighting-studio",
          title: "Atelier Luma Studio",
          excerpt: "Monochrome gallery rhythm with a limestone hero, brass CTA rail, and calm project index.",
          captureStatus: "captured",
          capture: {
            snapshot: {
              content: "Full-bleed limestone hero, brass CTA rail, staggered project index, atelier footer.",
              refCount: 7,
              warnings: []
            },
            clone: {
              componentPreview: "<section class=\"limestone-hero\"><nav>brass CTA rail</nav><article>staggered project index</article></section>",
              cssPreview: ".limestone-hero { background: #d8d0bf; letter-spacing: .04em; }",
              warnings: []
            }
          }
        })
      ]
    });

    const canvasPlan = JSON.stringify(packet.canvasPlanRequest);
    const handoff = JSON.stringify(packet.followthrough);

    for (const artifact of [
      packet.advancedBriefMarkdown,
      packet.designMarkdown,
      packet.implementationPlanMarkdown,
      packet.prototypeGuidanceMarkdown ?? "",
      canvasPlan,
      handoff
    ]) {
      expect(artifact).toContain("Atelier Luma Studio");
      expect(artifact).toContain("limestone hero");
      expect(artifact).toContain("brass CTA rail");
      expect(artifact).toContain("staggered project index");
    }
  });

  it("ranks screenshot-backed references deterministically and builds metadata-only meta prompts", () => {
    const packet = buildInspiredesignPacket({
      brief: "Create a premium public launch page with cinematic reference evidence.",
      briefExpansion: makeBriefExpansion({
        sourceBrief: "Create a premium public launch page with cinematic reference evidence."
      }),
      urls: ["https://example.com/text-first", "https://example.com/visual-first"],
      references: [
        makeReference({
          id: "text-first",
          url: "https://example.com/text-first",
          title: "Text First Reference",
          excerpt: "Editorial hero with proof bands and CTA clarity.",
          captureStatus: "captured",
          capture: {
            snapshot: {
              content: "Editorial hero and proof bands.",
              refCount: 4,
              warnings: []
            }
          }
        }),
        makeReference({
          id: "visual-first",
          url: "https://example.com/visual-first",
          title: "Visual First Reference",
          excerpt: "Full-bleed hero with cinematic product staging and refined CTA.",
          captureStatus: "captured",
          capture: {
            snapshot: {
              content: "Full-bleed hero, cinematic product staging, refined CTA, gallery proof.",
              refCount: 7,
              warnings: []
            },
            clone: {
              componentPreview: "<main>cinematic product staging</main>",
              cssPreview: ".hero { min-height: 100vh; }",
              warnings: []
            },
            visual: {
              status: "captured",
              kind: "viewport",
              fullPage: false,
              capturedAt: "2026-05-18T00:00:00.000Z",
              path: "visual-evidence/visual-first/viewport.png",
              sha256: "a".repeat(64),
              bytes: 123,
              warnings: ["cdp fallback"]
            }
          }
        }),
        makeReference({
          id: "blocked",
          url: "https://example.com/blocked",
          fetchStatus: "failed",
          captureStatus: "failed",
          fetchFailure: "Authentication required"
        })
      ]
    });
    const evidence = packet.evidence as InspiredesignEvidenceJson;

    expect(evidence.referencePatternBoard?.references.map((reference) => reference.id)).toEqual([
      "visual-first",
      "text-first"
    ]);
    expect(evidence.referencePatternBoard?.references[0]).toMatchObject({
      rank: 1,
      score: expect.any(Number),
      confidence: expect.any(Number),
      capturedVia: expect.arrayContaining(["visual"]),
      visualStrengths: expect.arrayContaining([
        "Screenshot artifact is available for direct visual inspection."
      ]),
      visualRisks: expect.arrayContaining([
        "Screenshot warning: cdp fallback."
      ])
    });
    expect(evidence.referencePatternBoard?.synthesis.dominantDirection).toBe(
      evidence.referencePatternBoard?.references[0]?.layoutRecipe
    );
    expect(evidence.referencePatternBoard?.rejectedReferences).toEqual([]);
    expect(evidence.referencePatternBoard?.qualitySummary.rejectedReferenceCount).toBeGreaterThan(0);
    expect(evidence.rankedReferences).toEqual(evidence.referencePatternBoard?.references);
    expect(evidence.visualEvidence).toEqual([
      expect.objectContaining({
        referenceId: "visual-first",
        visual: expect.objectContaining({
          path: "visual-evidence/visual-first/viewport.png",
          sha256: "a".repeat(64),
          bytes: 123
        })
      })
    ]);
    expect(evidence.screenshotIndex).toEqual([
      expect.objectContaining({
        referenceId: "visual-first",
        path: "visual-evidence/visual-first/viewport.png",
        sha256: "a".repeat(64),
        bytes: 123
      })
    ]);
    const evidenceText = JSON.stringify(evidence);
    expect(evidenceText).not.toContain("/tmp/");
    expect(evidenceText).not.toContain("base64");
    expect(packet.metaPromptMarkdown).toContain("# InspireDesign Meta Prompt");
    expect(packet.metaPromptMarkdown).toContain("Rank 1: Visual First Reference");
    expect(packet.metaPromptMarkdown).toContain("Borrow Guidance");
    expect(packet.metaPromptMarkdown).toContain("Reject Guidance");
    expect(packet.metaPromptMarkdown).toContain("Motion Posture");
    expect(packet.metaPromptMarkdown).toContain("Accessibility Constraints");
    expect(packet.metaPromptMarkdown).toContain("Do not copy logos");
    expect(packet.metaPromptMarkdown).toContain("Validation Gates");
  });

  it("keeps the reference pattern board template aligned with emitted board keys", () => {
    const template = JSON.parse(
      readFileSync("skills/opendevbrowser-design-agent/assets/templates/reference-pattern-board.v1.json", "utf8")
    ) as {
      references: Array<Record<string, unknown>>;
      rejectedReferences: Array<Record<string, unknown>>;
      synthesis: Record<string, unknown>;
    };
    const packet = buildInspiredesignPacket({
      brief: "Create a premium coffee landing page.",
      briefExpansion: makeBriefExpansion(),
      urls: ["https://example.com/visual", "https://example.com/blocked"],
      references: [
        makeReference({
          id: "visual",
          url: "https://example.com/visual",
          title: "Visual reference",
          excerpt: "Premium full-bleed hero, editorial sections, CTA rhythm.",
          capture: {
            snapshot: {
              content: "Premium full-bleed hero, editorial sections, CTA rhythm.",
              refCount: 4,
              warnings: []
            },
            visual: {
              status: "captured",
              kind: "viewport",
              fullPage: false,
              capturedAt: "2026-05-18T00:00:00.000Z",
              path: "visual-evidence/visual/viewport.png",
              sha256: "b".repeat(64),
              bytes: 321,
              warnings: []
            }
          }
        }),
        makeReference({
          id: "blocked",
          url: "https://example.com/blocked",
          fetchStatus: "failed",
          captureStatus: "failed",
          fetchFailure: "Authentication required"
        })
      ]
    });
    const board = (packet.evidence as InspiredesignEvidenceJson).referencePatternBoard;

    expect(board?.references[0]).toBeDefined();
    expect(board?.rejectedReferences).toEqual([]);
    expect(Object.keys(template.references[0] ?? {}).sort()).toEqual(Object.keys(board?.references[0] ?? {}).sort());
    expect(Object.keys(template.synthesis).sort()).toEqual(Object.keys(board?.synthesis ?? {}).sort());
  });

  it("keeps provider UI chrome out of ranked creative guidance", () => {
    const packet = buildInspiredesignPacket({
      brief: "Create a premium public landing page for a ceramic coffee roaster.",
      briefExpansion: makeBriefExpansion({
        sourceBrief: "Create a premium public landing page for a ceramic coffee roaster."
      }),
      urls: ["https://www.pinterest.com/search/pins?q=coffee", "https://example.com/coffee-roaster"],
      references: [
        makeReference({
          id: "pinterest-shell",
          url: "https://www.pinterest.com/search/pins?q=coffee",
          title: "Your profile",
          excerpt: "Skip to content Your profile Accounts Home Your boards Create Settings & Support Remove search input Explore Updates Messages Pin card Pin card",
          captureStatus: "captured",
          capture: {
            snapshot: {
              content: ":root --gestalt-theme: calico --gestalt-color-scheme: lightMode; Skip to content Your profile Accounts Home Your boards Create Settings & Support Remove search input Explore Updates Messages Pin card Pin card",
              refCount: 8,
              warnings: []
            },
            visual: {
              status: "captured",
              kind: "viewport",
              fullPage: false,
              capturedAt: "2026-05-18T00:00:00.000Z",
              path: "visual-evidence/pinterest-shell/viewport.png",
              sha256: "c".repeat(64),
              bytes: 456,
              warnings: []
            }
          }
        }),
        makeReference({
          id: "coffee-roaster",
          url: "https://example.com/coffee-roaster",
          title: "Ceramic Coffee Roaster Landing Page",
          excerpt: "Full-bleed landing page hero with tactile ceramic product staging, origin story, roast notes, and conversion CTA.",
          captureStatus: "captured",
          capture: {
            snapshot: {
              content: "Full-bleed landing page hero, tactile ceramic product staging, origin story, roast notes, subscription CTA, and editorial section rhythm.",
              refCount: 7,
              warnings: []
            },
            visual: {
              status: "captured",
              kind: "viewport",
              fullPage: false,
              capturedAt: "2026-05-18T00:00:00.000Z",
              path: "visual-evidence/coffee-roaster/viewport.png",
              sha256: "d".repeat(64),
              bytes: 789,
              warnings: []
            }
          }
        })
      ]
    });
    const evidence = packet.evidence as InspiredesignEvidenceJson;
    const guidanceText = [
      JSON.stringify(evidence.referencePatternBoard),
      packet.metaPromptMarkdown,
      evidence.designVectors?.directionLabel,
      ...(evidence.designVectors?.referenceInfluence ?? [])
    ].join(" ");

    expect(evidence.referencePatternBoard?.references.map((reference) => reference.id)).toEqual(["coffee-roaster"]);
    expect(evidence.referencePatternBoard?.rejectedReferences).toEqual([]);
    expect(evidence.referencePatternBoard?.qualitySummary.rejectedReferenceCount).toBe(1);
    expect(guidanceText).not.toContain("Your profile");
    expect(guidanceText).not.toContain("Pin card");
    expect(guidanceText).not.toContain("--gestalt-theme");
  });

  it("ranks strong structural references without screenshot evidence and records low-risk visual guidance", () => {
    const packet = buildInspiredesignPacket({
      brief: "Create a premium public landing page for an enterprise AI advisory firm.",
      briefExpansion: makeBriefExpansion({
        sourceBrief: "Create a premium public landing page for an enterprise AI advisory firm."
      }),
      urls: ["https://example.com/visual-clean", "https://example.com/structural"],
      references: [
        makeReference({
          id: "visual-clean",
          url: "https://example.com/visual-clean",
          title: "Visual Clean Reference",
          captureStatus: "captured",
          capture: {
            snapshot: {
              content: "Full-bleed public landing page hero, service narrative, client proof, and conversion CTA.",
              refCount: 6,
              warnings: []
            },
            visual: {
              status: "captured",
              kind: "viewport",
              fullPage: false,
              capturedAt: "2026-05-18T00:00:00.000Z",
              path: "visual-evidence/visual-clean/viewport.png",
              sha256: "b".repeat(64),
              bytes: 321,
              warnings: []
            }
          }
        }),
        makeReference({
          id: "structural",
          url: "https://example.com/structural",
          title: "Structural Reference",
          captureStatus: "captured",
          capture: {
            snapshot: {
              content: "Premium consulting public landing page with service narrative, client proof, case studies, industries, and conversion CTAs.",
              refCount: 8,
              warnings: []
            },
            clone: {
              componentPreview: "<main><section>Enterprise AI transformation advisory</section><section>Client services</section></main>",
              cssPreview: ".hero { display: grid; }",
              warnings: []
            },
            dom: {
              outerHTML: "<main><h1>Enterprise AI transformation</h1><section>Case studies and industries</section></main>",
              truncated: false
            }
          }
        })
      ]
    });
    const evidence = packet.evidence as InspiredesignEvidenceJson;
    const visualEntry = evidence.referencePatternBoard?.references.find((reference) => reference.id === "visual-clean");
    const structuralEntry = evidence.referencePatternBoard?.references.find((reference) => reference.id === "structural");

    expect(visualEntry?.visualRisks).toEqual([
      "No major visual evidence risk detected in the captured reference."
    ]);
    expect(structuralEntry?.selectionReason).toContain("Ranked for strong text and structural evidence");
    expect(structuralEntry?.capturedVia).toEqual(expect.arrayContaining(["fetch", "snapshot", "clone", "dom"]));
    expect(structuralEntry?.capturedVia).not.toContain("visual");
  });

  it("downgrades references with weak brief intent overlap", () => {
    const packet = buildInspiredesignPacket({
      brief: "Design a premium photography studio landing page with cinematic portraits.",
      briefExpansion: makeBriefExpansion({
        sourceBrief: "Design a premium photography studio landing page with cinematic portraits."
      }),
      urls: ["https://example.com/photo", "https://example.com/unrelated"],
      references: [
        makeReference({
          id: "photo-studio",
          url: "https://example.com/photo",
          title: "Photography studio landing page",
          excerpt: "Premium portrait gallery, cinematic studio hero, booking CTA, and editorial project rhythm.",
          captureStatus: "captured",
          capture: {
            snapshot: { content: "Photography studio portrait grid with cinematic image sequencing.", refCount: 8, warnings: [] }
          }
        }),
        makeReference({
          id: "unrelated",
          url: "https://example.com/unrelated",
          title: "Inventory analytics control room",
          excerpt: "Warehouse operational dashboards, SKU tables, and logistics exception alerts.",
          captureStatus: "captured",
          capture: {
            snapshot: { content: "Dense inventory tables and supply-chain monitoring widgets.", refCount: 8, warnings: [] }
          }
        })
      ]
    });
    const references = (packet.evidence as InspiredesignEvidenceJson).referencePatternBoard?.references ?? [];

    expect(references[0]?.id).toBe("photo-studio");
    expect(references.find((reference) => reference.id === "unrelated")?.selectionReason).toContain("Intent overlap with the brief is weak");
  });

  it("finalizes advanced briefs from reference evidence before fixed route guardrails", () => {
    const packet = buildInspiredesignPacket({
      brief: "Create a launch page inspired by an architectural lighting studio.",
      briefExpansion: makeBriefExpansion({
        sourceBrief: "Create a launch page inspired by an architectural lighting studio."
      }),
      urls: ["https://example.com/lighting-studio"],
      references: [
        makeReference({
          id: "lighting-studio",
          url: "https://example.com/lighting-studio",
          title: "Atelier Luma Studio",
          excerpt: "Monochrome gallery rhythm with a limestone hero, brass CTA rail, and calm project index.",
          captureStatus: "captured",
          capture: {
            snapshot: {
              content: "Full-bleed limestone hero, brass CTA rail, staggered project index, atelier footer.",
              refCount: 7,
              warnings: []
            },
            clone: {
              componentPreview: "<section class=\"limestone-hero\"><nav>brass CTA rail</nav><article>staggered project index</article></section>",
              cssPreview: ".limestone-hero { background: #d8d0bf; letter-spacing: .04em; }",
              warnings: []
            },
            dom: {
              outerHTML: "<main><h1>Atelier Luma Studio</h1><p>limestone hero and brass CTA rail</p></main>",
              truncated: false
            }
          }
        })
      ]
    });
    const evidence = packet.evidence as InspiredesignEvidenceJson;
    const analysisIndex = packet.advancedBriefMarkdown.indexOf("Reference pattern board:");
    const formatIndex = packet.advancedBriefMarkdown.indexOf("Selected prompt format:");

    expect(analysisIndex).toBe(0);
    expect(formatIndex).toBeGreaterThan(analysisIndex);
    expect(packet.advancedBriefMarkdown).toContain(
      "URL reference evidence is the creative source of truth when references are supplied."
    );
    expect(packet.advancedBriefMarkdown).toContain(
      "Selected prompt format supplies route defaults and guardrails, not the creative source of truth."
    );
    expect(packet.advancedBriefMarkdown.indexOf("limestone hero")).toBeLessThan(formatIndex);
    expect(packet.advancedBriefMarkdown.indexOf("brass CTA rail")).toBeLessThan(formatIndex);
    expect(evidence.referencePatternBoard?.references[0]).toMatchObject({
      id: "lighting-studio",
      capturedVia: ["fetch", "snapshot", "clone", "dom"],
      layoutRecipe: expect.stringContaining("limestone hero"),
      patternsToBorrow: expect.arrayContaining([expect.stringContaining("brass CTA rail")]),
      patternsToReject: expect.arrayContaining(["No feature-card hero."])
    });
    expect(evidence.referencePatternBoard?.synthesis.contractDeltas).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Selected prompt format supplies route defaults")
      ])
    );
  });

  it("threads pattern boards and design vectors through generated JSON artifacts", () => {
    const packet = buildInspiredesignPacket({
      brief: "Create a premium public church landing page inspired by a global ministry homepage.",
      briefExpansion: makeBriefExpansion({
        sourceBrief: "Create a premium public church landing page inspired by a global ministry homepage."
      }),
      urls: ["https://example.com/global-church"],
      references: [
        makeReference({
          id: "global-church",
          url: "https://example.com/global-church",
          title: "Global Church Home",
          excerpt: "Worship-led public homepage with immersive hero, service pathways, giving CTA, and stories of impact.",
          captureStatus: "captured",
          capture: {
            snapshot: {
              content: "Immersive worship hero, magnetic cursor CTA, frosted glass overlay, service pathways, giving CTA, impact stories, event rhythm.",
              refCount: 9,
              warnings: []
            },
            clone: {
              componentPreview: "<main><section>worship hero</section><section>service pathways</section></main>",
              cssPreview: ".hero { min-height: 100vh; } .reveal { transition: opacity 480ms; }",
              warnings: []
            }
          }
        })
      ]
    });
    const evidence = packet.evidence as InspiredesignEvidenceJson;

    for (const value of [
      evidence.referencePatternBoard,
      packet.followthrough.implementationContext.referencePatternBoard,
      packet.generationPlan.referencePatternBoard
    ]) {
      expect(value).toMatchObject({
        references: [
          expect.objectContaining({
            id: "global-church",
            layoutRecipe: expect.stringContaining("Immersive worship hero")
          })
        ]
      });
    }

    for (const value of [
      evidence.designVectors,
      packet.followthrough.implementationContext.designVectors,
      packet.generationPlan.designVectors
    ]) {
      expect(value).toMatchObject({
        sourcePriority: "reference-evidence-first",
        directionLabel: expect.stringContaining("worship hero"),
        surfaceIntent: "reference-led public landing page",
        compositionModel: expect.arrayContaining([expect.stringContaining("worship hero")]),
        premiumPosture: expect.arrayContaining([expect.stringContaining("premium")]),
        motionPosture: expect.arrayContaining([expect.stringContaining("reveal")]),
        sectionArchitecture: expect.arrayContaining([expect.stringContaining("8 to 12")]),
        typographyPosture: expect.arrayContaining([expect.stringContaining("headlines")]),
        imageryPosture: expect.arrayContaining([expect.stringContaining("imagery")]),
        interactionDensity: expect.stringContaining("public-page CTAs"),
        interactionMoments: expect.arrayContaining([
          expect.stringContaining("Microinteractions"),
          expect.stringContaining("Cursor effects"),
          expect.stringContaining("Animation choreography")
        ]),
        materialEffects: expect.arrayContaining([
          expect.stringContaining("parallax"),
          expect.stringContaining("Glassmorphism"),
          expect.stringContaining("Reduced-motion material fallback")
        ]),
        advancedMotionAdvisory: expect.arrayContaining([
          expect.stringContaining("shader-style"),
          expect.stringContaining("WebGL-style"),
          expect.stringContaining("Spline-style"),
          expect.stringContaining("Runtime boundary")
        ]),
        referenceInfluence: expect.arrayContaining([expect.stringContaining("worship hero")]),
        patternsToBorrow: expect.arrayContaining([expect.stringContaining("service pathways")]),
        patternsToReject: expect.arrayContaining(["No feature-card hero."])
      });
    }
    expect(packet.generationPlan.contentStrategy.source).toMatch(/^evidence\.json, advanced-brief\.md, design\.md\./);
    expect(packet.canvasPlanRequest.generationPlan.contentStrategy.source).toMatch(/^evidence\.json, advanced-brief\.md, design\.md\./);
    expect(packet.followthrough.implementationContext.referenceSynthesis.requiredArtifacts.slice(0, 7)).toEqual([
      "evidence.json",
      "visual-evidence.json",
      "screenshot-index.json",
      "ranked-references.json",
      "meta-prompt.md",
      "advanced-brief.md",
      "design.md"
    ]);
    expect(packet.followthrough.implementationContext.referenceSynthesis.requiredArtifacts).toEqual(
      expect.arrayContaining([
        "generation-plan.json",
        "canvas-plan.request.json",
        "design-contract.json"
      ])
    );
    expect("referencePatternBoard" in packet.canvasPlanRequest.generationPlan).toBe(false);
    expect(packet.canvasPlanRequest.generationPlan.designVectors).toMatchObject({
      premiumPosture: expect.arrayContaining([expect.stringContaining("premium")]),
      motionPosture: expect.arrayContaining([expect.stringContaining("reveal")]),
      sectionArchitecture: expect.arrayContaining([expect.stringContaining("8 to 12")]),
      interactionMoments: expect.arrayContaining([expect.stringContaining("Microinteractions")]),
      materialEffects: expect.arrayContaining([expect.stringContaining("Glassmorphism")]),
      advancedMotionAdvisory: packet.generationPlan.designVectors.advancedMotionAdvisory,
      referenceInfluence: expect.arrayContaining([expect.stringContaining("worship hero")])
    });
    expect(packet.canvasPlanRequest.generationPlan.designVectors?.advancedMotionAdvisory).toEqual(
      packet.generationPlan.designVectors.advancedMotionAdvisory
    );
    expect("advancedMotionAdvisory" in packet.canvasPlanRequest.generationPlan).toBe(false);
    expect(packet.generationPlan as PlanMotionMaterialFields).toMatchObject({
      interactionMoments: packet.generationPlan.designVectors.interactionMoments,
      materialEffects: packet.generationPlan.designVectors.materialEffects
    });
    expect(packet.canvasPlanRequest.generationPlan as PlanMotionMaterialFields).toMatchObject({
      interactionMoments: packet.generationPlan.designVectors.interactionMoments,
      materialEffects: packet.generationPlan.designVectors.materialEffects
    });
    expect(JSON.stringify(packet.designContract.motionSystem)).toContain("Microinteractions");
    expect(JSON.stringify(packet.designContract.motionSystem)).toContain("Cursor effects");
    expect(JSON.stringify(packet.designContract.motionSystem)).toContain("parallax");
    expect(JSON.stringify(packet.designContract.motionSystem)).toContain("Glassmorphism");
    expect(JSON.stringify(packet.designContract.motionSystem)).toContain("shader-style");
    expect(JSON.stringify(packet.designContract.motionSystem)).toContain("WebGL-style");
    expect(JSON.stringify(packet.designContract.motionSystem)).toContain("Spline-style");
    expect(JSON.stringify(packet.designContract.motionSystem)).toContain("advisory contract metadata only");
    expect(packet.designContract.libraryPolicy).toMatchObject({
      motion: [],
      threeD: []
    });
    expect(validateGenerationPlan(packet.canvasPlanRequest.generationPlan)).toMatchObject({
      ok: true,
      plan: {
        interactionMoments: packet.generationPlan.designVectors.interactionMoments,
        materialEffects: packet.generationPlan.designVectors.materialEffects,
        designVectors: {
          advancedMotionAdvisory: packet.generationPlan.designVectors.advancedMotionAdvisory
        }
      }
    });
    expect(packet.followthrough.artifactGuide).toEqual(INSPIREDESIGN_ARTIFACT_GUIDE);
    expect(packet.followthrough.contractSectionGuide).toEqual(INSPIREDESIGN_CONTRACT_SECTION_GUIDE);
  });

  it("keeps blocked diagnostic references out of creative synthesis", () => {
    const packet = buildInspiredesignPacket({
      brief: "Create a premium public church website for a global congregation.",
      briefExpansion: makeBriefExpansion({
        sourceBrief: "Create a premium public church website for a global congregation."
      }),
      urls: ["https://example.com/blocked-dashboard"],
      references: [
        makeReference({
          id: "blocked-dashboard",
          url: "https://example.com/blocked-dashboard",
          fetchStatus: "failed",
          captureStatus: "failed",
          title: "Sign in",
          excerpt: "Authentication required for admin dashboard analytics.",
          fetchFailure: "Authentication required",
          captureFailure: "Challenge page blocked capture."
        })
      ]
    });
    const evidence = packet.evidence as InspiredesignEvidenceJson;

    expect(evidence.references).toHaveLength(1);
    expect(evidence.referencePatternBoard?.references).toEqual([]);
    expect(evidence.designVectors?.sourcePriority).toBe("brief-only");
    expect(evidence.designVectors?.interactionMoments.join(" ")).not.toContain("Cursor effects");
    expect(evidence.designVectors?.materialEffects.join(" ")).not.toContain("Glassmorphism");
    expect(evidence.designVectors?.materialEffects.join(" ")).not.toContain("parallax");
    expect(JSON.stringify(packet.generationPlan)).not.toContain("admin dashboard analytics");
    expect(JSON.stringify(packet.designContract.contentModel)).not.toContain("admin dashboard analytics");
    expect(packet.designMarkdown).not.toContain("admin dashboard analytics");
    expect(packet.advancedBriefMarkdown).not.toContain(
      "URL reference evidence is the creative source of truth when references are supplied."
    );
    expect(packet.advancedBriefMarkdown).not.toContain("admin dashboard analytics");
  });

  it("rejects login and challenge pages even when they contain otherwise clean text", () => {
    expect(hasInspiredesignUsableReferenceEvidence(makeReference({
      fetchStatus: "captured",
      captureStatus: "captured",
      title: "Premium studio photography editorial layout",
      excerpt: "Full-bleed hero treatment with cinematic portrait galleries.",
      capture: {
        title: "Premium studio photography",
        snapshot: {
          content: "Sign in to continue. Premium studio photography editorial layout with cinematic galleries."
        }
      }
    }))).toBe(false);

    expect(hasInspiredesignUsableReferenceEvidence(makeReference({
      fetchStatus: "captured",
      captureStatus: "captured",
      title: "Cinematic landing page",
      capture: {
        dom: {
          outerHTML: "<main>Complete the verification challenge to continue. Cinematic landing page with parallax hero.</main>"
        }
      }
    }))).toBe(false);

    for (const content of [
      "Authentication required before viewing this premium editorial studio layout.",
      "Access denied for a cinematic portrait landing page reference.",
      "Enable cookies to view this full-bleed photography website.",
      "Complete the verification before opening this gallery reference."
    ]) {
      expect(hasInspiredesignUsableReferenceEvidence(makeReference({
        fetchStatus: "captured",
        captureStatus: "off",
        title: "Premium studio photography editorial layout",
        excerpt: content
      }))).toBe(false);
    }
  });

  it("rejects captured interface chrome instead of falling back to clean metadata", () => {
    expect(hasInspiredesignUsableReferenceEvidence(makeReference({
      fetchStatus: "captured",
      captureStatus: "captured",
      title: "Premium studio photography editorial layout",
      excerpt: "Full-bleed hero treatment with cinematic portrait galleries.",
      capture: {
        snapshot: {
          content: "Your profile. Pin card. Search results for premium studio photography.",
          refCount: 4,
          warnings: []
        },
        visual: {
          status: "captured",
          path: "/tmp/pinterest-shell.png",
          sha256: "abc123"
        }
      }
    }))).toBe(false);

    const chromeOnlyReference = makeReference({
      url: "https://www.pinterest.com/pin/955748352150564605/",
      fetchStatus: "failed",
      captureStatus: "captured",
      title: "[r1] link \"Skip to content\" [r2] link \"Your profile\" [r3] button \"Accounts\" [r4] link \"Home\"",
      excerpt: "[r1] link \"Skip to content\" [r2] link \"Your profile\" [r3] button \"Accounts\" [r4] link \"Home\" [r5] link \"Your boards\" [r6] button \"Settings & Support\" [r7] button \"Updates\" [r8] button \"Messages\"",
      fetchFailure: "Provider circuit is open",
      capture: {
        visual: {
          status: "captured",
          path: "/tmp/pinterest-chrome.png",
          sha256: "e".repeat(64),
          warnings: []
        }
      }
    });
    const chromeOnlyBoard = buildInspiredesignReferencePatternBoard(
      "chrome-only",
      makeBriefFormat(),
      [chromeOnlyReference],
      "Design a premium landing page prototype for a design agency studio."
    );

    expect(hasInspiredesignUsableReferenceEvidence(chromeOnlyReference)).toBe(false);
    expect(chromeOnlyBoard.rejectedReferences[0]).toEqual(expect.objectContaining({
      captured: true,
      diagnosticReasons: expect.arrayContaining(["interface_chrome_shell"]),
      capturedButRejectedReason: expect.stringContaining("interface_chrome_shell"),
      evidenceGap: expect.stringContaining("diagnostic browser chrome")
    }));
  });

  it("keeps screenshot-backed Pinterest pin references usable when page chrome surrounds clean pin metadata", () => {
    const reference = makeReference({
      id: "pinterest-pin",
      url: "https://www.pinterest.com/pin/11188699075430754/",
      fetchStatus: "captured",
      captureStatus: "captured",
      title: "KINETIC | CREATIVE AGENCY STUDIO WEBSITE | DESIGN BY.SHIVAA",
      excerpt: "KINETIC | CREATIVE AGENCY STUDIO WEBSITE | DESIGN BY.SHIVAA Skip to content When autocomplete results are available use up and down arrows to review and enter to select. Touch device users, explore by touch or with swipe gestures.",
      capture: {
        title: "KINETIC | CREATIVE AGENCY STUDIO WEBSITE | DESIGN BY.SHIVAA",
        snapshot: {
          content: "KINETIC | CREATIVE AGENCY STUDIO WEBSITE | DESIGN BY.SHIVAA Skip to content When autocomplete results are available use up and down arrows to review and enter to select. Touch device users, explore by touch or with swipe gestures."
        },
        visual: {
          status: "captured",
          path: "/tmp/pinterest-pin.png",
          sha256: "d".repeat(64),
          warnings: []
        }
      }
    });

    const board = buildInspiredesignReferencePatternBoard(
      "pinterest-pin",
      makeBriefFormat(),
      [reference],
      "Design a premium landing page prototype for a design agency studio."
    );

    expect(hasInspiredesignUsableReferenceEvidence(reference)).toBe(true);
    expect(board.references[0]).toEqual(expect.objectContaining({
      id: "pinterest-pin",
      capturedVia: expect.arrayContaining(["fetch", "visual"])
    }));
    expect(board.references[0]?.score).toBeLessThan(50);
    expect(board.rejectedReferences).toEqual([]);
  });

  it("keeps Pinterest chrome-only screenshot metadata out of design-facing artifacts", () => {
    const references = Array.from({ length: 5 }, (_, index) => {
      const pinId = `1118869907543075${index}`;
      const title = `Kinetic creative agency studio website concept ${index + 1}`;
      return makeReference({
        id: `chrome-pin-${index + 1}`,
        url: `https://www.pinterest.com/pin/${pinId}/`,
        fetchStatus: "captured",
        captureStatus: "captured",
        title,
        excerpt: `${title} Skip to content When autocomplete results are available use up and down arrows to review and enter to select. Touch device users, explore by touch or with swipe gestures.`,
        capture: {
          title,
          snapshot: {
            content: `${title} Skip to content Your profile Pin card Home Updates Messages`
          },
          visual: {
            status: "captured",
            path: `/tmp/chrome-pin-${index + 1}.png`,
            sha256: `${index}`.repeat(64).slice(0, 64),
            warnings: []
          }
        }
      });
    });

    const packet = buildInspiredesignPacket({
      brief: "Design a premium landing page prototype for a design agency studio.",
      briefExpansion: makeBriefExpansion({
        sourceBrief: "Design a premium landing page prototype for a design agency studio."
      }),
      urls: references.map((reference) => reference.url),
      references
    });
    const designFacingArtifacts = JSON.stringify({
      rankedReferences: packet.rankedReferences,
      board: packet.generationPlan.referencePatternBoard,
      canvas: packet.canvasPlanRequest,
      designContract: packet.designContract,
      generationPlan: packet.generationPlan,
      followthrough: packet.followthrough.implementationContext,
      metaPrompt: packet.metaPromptMarkdown,
      designMarkdown: packet.designMarkdown,
      implementationPlan: packet.implementationPlan,
      implementationPlanMarkdown: packet.implementationPlanMarkdown
    });

    expect(packet.rankedReferences).toEqual([]);
    expect(packet.generationPlan.designVectors.sourcePriority).toBe("brief-only");
    expect(packet.generationPlan.referencePatternBoard.qualitySummary).toMatchObject({
      rankedReferenceCount: 0,
      rejectedReferenceCount: 5,
      missingScreenshotCount: 0
    });
    expect(packet.advancedBriefMarkdown.indexOf("Reference evidence unavailable:")).toBe(0);
    expect(designFacingArtifacts).not.toContain("Kinetic creative agency studio website concept");
    expect(designFacingArtifacts).not.toContain("1118869907543075");
    expect(designFacingArtifacts).not.toContain("/tmp/chrome-pin");
  });

  it("keeps clean screenshot-backed Pinterest pins usable without interface-chrome diagnostics", () => {
    const reference = makeReference({
      id: "clean-pinterest-pin",
      url: "https://www.pinterest.com/pin/27654985208435505/",
      fetchStatus: "captured",
      captureStatus: "captured",
      title: "Pumpkin modern creative agency landing page",
      excerpt: "Premium design agency studio landing page with editorial typography, cinematic hero motion, portfolio proof, and service sections.",
      capture: {
        title: "Pumpkin modern creative agency landing page",
        visual: {
          status: "captured",
          path: "/tmp/clean-pinterest-pin.png",
          sha256: "c".repeat(64),
          warnings: []
        }
      }
    });

    const board = buildInspiredesignReferencePatternBoard(
      "clean-pinterest-pin",
      makeBriefFormat(),
      [reference],
      "Design a premium landing page prototype for a design agency studio."
    );

    expect(hasInspiredesignUsableReferenceEvidence(reference)).toBe(true);
    expect(board.references[0]).toEqual(expect.objectContaining({
      id: "clean-pinterest-pin",
      capturedVia: expect.arrayContaining(["fetch", "visual"]),
      intentMatched: true
    }));
    expect(board.references[0]?.score).toBeGreaterThanOrEqual(50);
    expect(board.references[0]?.confidence).toBeGreaterThanOrEqual(0.5);
    expect(board.qualitySummary).toMatchObject({
      failedCaptureCount: 0,
      missingScreenshotCount: 0
    });
  });

  it("rejects Pinterest-owned asset hosts from creative synthesis", () => {
    const reference = makeReference({
      id: "asset-pinterest-pin",
      url: "https://assets.pinterest.com/pin/27654985208435505/",
      fetchStatus: "captured",
      captureStatus: "captured",
      title: "Pumpkin modern creative agency landing page",
      excerpt: "Premium design agency studio landing page with editorial typography, cinematic hero motion, portfolio proof, and service sections.",
      capture: {
        title: "Pumpkin modern creative agency landing page",
        visual: {
          status: "captured",
          path: "/tmp/asset-pinterest-pin.png",
          sha256: "b".repeat(64),
          warnings: []
        }
      }
    });

    const board = buildInspiredesignReferencePatternBoard(
      "asset-pinterest-pin",
      makeBriefFormat(),
      [reference],
      "Design a premium landing page prototype for a design agency studio."
    );

    expect(hasInspiredesignUsableReferenceEvidence(reference)).toBe(false);
    expect(board.references).toEqual([]);
    expect(board.rejectedReferences).toEqual([
      expect.objectContaining({
        id: "asset-pinterest-pin",
        reason: "Pinterest reference host is not approved for creative synthesis."
      })
    ]);
  });

  it("keeps weak off-brief Pinterest references out of Canvas design direction", () => {
    const packet = buildInspiredesignPacket({
      brief: "Design a premium landing page prototype for a design agency studio.",
      briefExpansion: makeBriefExpansion({
        sourceBrief: "Design a premium landing page prototype for a design agency studio."
      }),
      urls: [
        "https://www.pinterest.com/pin/31525266137895345/",
        "https://www.pinterest.com/offbrief/portal-board/"
      ],
      references: [
        makeReference({
          id: "off-brief-pin",
          url: "https://www.pinterest.com/pin/31525266137895345/",
          fetchStatus: "captured",
          captureStatus: "captured",
          title: "Estilo de portal digital funcional",
          excerpt: "Estilo de portal digital funcional Skip to content When autocomplete results are available use up and down arrows to review and enter to select. Touch device users, explore by touch or with swipe gestures.",
          capture: {
            title: "Estilo de portal digital funcional",
            visual: {
              status: "captured",
              path: "/tmp/off-brief-pin.png",
              sha256: "f".repeat(64),
              warnings: []
            }
          }
        }),
        makeReference({
          id: "off-brief-board",
          url: "https://www.pinterest.com/offbrief/portal-board/",
          fetchStatus: "captured",
          captureStatus: "captured",
          title: "Functional portal moodboard",
          excerpt: "Functional portal moodboard with app chrome and operational panels.",
          capture: {
            title: "Functional portal moodboard",
            visual: {
              status: "captured",
              path: "/tmp/off-brief-board.png",
              sha256: "a".repeat(64),
              warnings: []
            }
          }
        })
      ]
    });
    const evidence = packet.evidence as InspiredesignEvidenceJson;

    expect(evidence.references).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "off-brief-pin" }),
      expect.objectContaining({ id: "off-brief-board" })
    ]));
    expect(evidence.designVectors?.sourcePriority).toBe("brief-only");
    expect(evidence.referencePatternBoard?.qualitySummary).toMatchObject({
      rejectedReferenceCount: 2,
      failedCaptureCount: 0,
      missingScreenshotCount: 0
    });
    expect(JSON.stringify(evidence.referencePatternBoard)).not.toContain("Estilo de portal digital funcional");
    expect(JSON.stringify(evidence.referencePatternBoard)).not.toContain("Functional portal moodboard");
    expect(JSON.stringify(evidence.rankedReferences)).not.toContain("Estilo de portal digital funcional");
    expect(JSON.stringify(evidence.rankedReferences)).not.toContain("https://www.pinterest.com/pin/31525266137895345/");
    expect(JSON.stringify(packet.rankedReferences)).not.toContain("Functional portal moodboard");
    expect(packet.rankedReferences).toEqual([]);
    expect(packet.designContract.intent.referenceUrls).toEqual([]);
    expect(packet.advancedBriefMarkdown.indexOf("Reference evidence unavailable:")).toBe(0);
    expect(JSON.stringify(packet.designContract)).not.toContain("Estilo de portal digital funcional");
    expect(JSON.stringify(packet.designContract)).not.toContain("Functional portal moodboard");
    expect(JSON.stringify(packet.generationPlan)).not.toContain("Estilo de portal digital funcional");
    expect(JSON.stringify(packet.generationPlan)).not.toContain("Functional portal moodboard");
    expect(JSON.stringify(packet.followthrough.implementationContext)).not.toContain("Estilo de portal digital funcional");
    expect(JSON.stringify(packet.followthrough.implementationContext)).not.toContain("Functional portal moodboard");
    expect(JSON.stringify(packet.implementationPlan)).not.toContain("Estilo de portal digital funcional");
    expect(JSON.stringify(packet.implementationPlan)).not.toContain("Functional portal moodboard");
    expect(packet.implementationPlanMarkdown).not.toContain("Estilo de portal digital funcional");
    expect(packet.implementationPlanMarkdown).not.toContain("Functional portal moodboard");
    expect(packet.implementationPlanMarkdown).not.toContain("31525266137895345");
    expect(packet.implementationPlanMarkdown).not.toContain("off-brief");
    expect(JSON.stringify(packet.canvasPlanRequest.generationPlan)).not.toContain("Estilo de portal digital funcional");
    expect(JSON.stringify(packet.canvasPlanRequest.generationPlan)).not.toContain("Functional portal moodboard");
    expect(packet.designMarkdown).not.toContain("Estilo de portal digital funcional");
    expect(packet.designMarkdown).not.toContain("Functional portal moodboard");
    expect(packet.metaPromptMarkdown).not.toContain("Estilo de portal digital funcional");
    expect(packet.metaPromptMarkdown).not.toContain("Functional portal moodboard");
    expect(packet.metaPromptMarkdown).toContain("No ready references were ranked.");
    expect(packet.metaPromptMarkdown).toContain("ranked reference(s) were not ready for creative synthesis");
    expect(packet.metaPromptMarkdown).not.toContain("https://www.pinterest.com/pin/31525266137895345/");
  });

  it("classifies page, component, and asset prototype targets without changing the Canvas request shape", () => {
    const cases: Array<{
      brief: string;
      expectedKind: InspiredesignTargetKind;
      expectedKinds: InspiredesignTargetKind[];
      expectedText: string;
      expectedGuidance: string;
    }> = [
      {
        brief: "Design a premium documentation landing page with a homepage hero and section flow.",
        expectedKind: "page",
        expectedKinds: ["page"],
        expectedText: "CanvasPage",
        expectedGuidance: "Page prototype target"
      },
      {
        brief: "Prototype a reusable pricing card component family with badge slots, CTA props, hover focus disabled loading and error states.",
        expectedKind: "component",
        expectedKinds: ["component"],
        expectedText: "CanvasComponentInventoryItem",
        expectedGuidance: "Component prototype target"
      },
      {
        brief: "Create a logo icon visual asset pack with responsive artwork variants and tokenized usage rules.",
        expectedKind: "asset",
        expectedKinds: ["asset"],
        expectedText: "CanvasAsset",
        expectedGuidance: "Asset prototype target"
      }
    ];

    for (const item of cases) {
      const packet = buildInspiredesignPacket({
        brief: item.brief,
        briefExpansion: makeBriefExpansion({ sourceBrief: item.brief }),
        urls: [],
        includePrototypeGuidance: true,
        references: []
      });
      const evidence = packet.evidence as InspiredesignEvidenceJson;
      const generationPlan = packet.generationPlan as GenerationTargetAnalysisFields;
      const handoff = packet.followthrough as HandoffTargetAnalysisFields;
      const canvasPlan = packet.canvasPlanRequest.generationPlan as CanvasTargetAnalysisLeakFields;

      expect(evidence.targetAnalysis).toMatchObject({
        primaryKind: item.expectedKind,
        kinds: item.expectedKinds
      });
      expect(evidence.targetAnalysis?.confidence).toBeGreaterThan(0);
      expect(evidence.targetAnalysis?.triggeringSignals.length).toBeGreaterThan(0);
      expect(generationPlan.targetAnalysis).toEqual(evidence.targetAnalysis);
      expect(handoff.implementationContext.targetAnalysis).toEqual(evidence.targetAnalysis);
      expect(JSON.stringify(evidence.targetAnalysis)).toContain(item.expectedText);
      expect(evidence.targetAnalysis?.evidenceBuckets).toMatchObject({
        anatomy: expect.arrayContaining([expect.any(String)]),
        propsSlots: expect.arrayContaining([expect.any(String)]),
        stateMatrix: expect.arrayContaining([expect.any(String)]),
        tokens: expect.arrayContaining([expect.any(String)]),
        assets: expect.arrayContaining([expect.any(String)]),
        accessibility: expect.arrayContaining([expect.any(String)]),
        motion: expect.arrayContaining([expect.any(String)]),
        previewFixtures: expect.arrayContaining([expect.any(String)])
      });
      expect(packet.prototypeGuidanceMarkdown).toContain(item.expectedGuidance);
      expect(packet.prototypeGuidanceMarkdown).toContain("props/slots");
      expect(canvasPlan.targetAnalysis).toBeUndefined();
      expect(canvasPlan.prototypeScope).toBeUndefined();
      expect(canvasPlan.sourceArtifacts).toBeUndefined();
      expect(canvasPlan.artifactGuide).toBeUndefined();
      expect(canvasPlan.contractSectionGuide).toBeUndefined();
      expect("advancedMotionAdvisory" in packet.canvasPlanRequest.generationPlan).toBe(false);
      expect(hasForbiddenCanvasPlanKey(packet.canvasPlanRequest as JsonValue)).toBe(false);
    }
  });

  it("keeps landing pages with incidental card button image media words classified as page", () => {
    const brief = "Design a landing page with hero media, image-backed cards, CTA buttons, and a section flow.";
    const packet = buildInspiredesignPacket({
      brief,
      briefExpansion: makeBriefExpansion({ sourceBrief: brief }),
      urls: ["https://example.com/reference"],
      includePrototypeGuidance: true,
      references: [
        makeReference({
          id: "reference",
          url: "https://example.com/reference",
          title: "Reference landing page",
          excerpt: "Hero image, media panels, cards, buttons, and background artwork inside a page flow.",
          captureStatus: "captured",
          capture: {
            snapshot: { content: "Hero, CTA buttons, image cards, media rows, footer.", refCount: 6, warnings: [] },
            clone: null,
            dom: null,
            screenshot: null,
            diagnostics: { blocker: null, warnings: [] }
          }
        })
      ]
    });
    const evidence = packet.evidence as InspiredesignEvidenceJson;
    const canvasPlan = packet.canvasPlanRequest.generationPlan as CanvasTargetAnalysisLeakFields;

    expect(evidence.targetAnalysis).toMatchObject({
      primaryKind: "page",
      kinds: ["page"]
    });
    expect(evidence.targetAnalysis?.component).toBeUndefined();
    expect(evidence.targetAnalysis?.asset).toBeUndefined();
    expect(evidence.targetAnalysis?.triggeringSignals).toContain(
      "page default: non-page targets did not clear brief intent plus support gates"
    );
    expect(packet.prototypeGuidanceMarkdown).toContain("Page prototype target");
    expect(packet.prototypeGuidanceMarkdown).not.toContain("Component prototype target");
    expect(packet.prototypeGuidanceMarkdown).not.toContain("Asset prototype target");
    expect(canvasPlan.targetAnalysis).toBeUndefined();
    expect(hasForbiddenCanvasPlanKey(packet.canvasPlanRequest as JsonValue)).toBe(false);
  });

  it("keeps landing pages with incidental icon logo artwork words classified as page", () => {
    const brief = "Design a landing page with logo placement, icon rows, background artwork, and image-led sections.";
    const packet = buildInspiredesignPacket({
      brief,
      briefExpansion: makeBriefExpansion({ sourceBrief: brief }),
      urls: [],
      includePrototypeGuidance: true,
      references: []
    });
    const evidence = packet.evidence as InspiredesignEvidenceJson;

    expect(evidence.targetAnalysis).toMatchObject({
      primaryKind: "page",
      kinds: ["page"]
    });
    expect(evidence.targetAnalysis?.asset).toBeUndefined();
    expect(evidence.targetAnalysis?.triggeringSignals).toContain(
      "page default: non-page targets did not clear brief intent plus support gates"
    );
    expect(packet.prototypeGuidanceMarkdown).toContain("Page prototype target");
    expect(packet.prototypeGuidanceMarkdown).not.toContain("Asset prototype target");
    expect(hasForbiddenCanvasPlanKey(packet.canvasPlanRequest as JsonValue)).toBe(false);
  });

  it("requires non-page brief intent instead of reference-only component language", () => {
    const brief = "Design a polished landing page for a premium checkout experience.";
    const packet = buildInspiredesignPacket({
      brief,
      briefExpansion: makeBriefExpansion({ sourceBrief: brief }),
      urls: ["https://example.com/storybook-reference"],
      includePrototypeGuidance: true,
      references: [
        makeReference({
          id: "storybook-reference",
          url: "https://example.com/storybook-reference",
          title: "Storybook component props slots variants",
          excerpt: "Reusable component family with props, slots, variants, hover focus disabled loading and error states.",
          captureStatus: "captured",
          capture: {
            snapshot: {
              content: "Component prototype anatomy with props slots variants states fixtures.",
              refCount: 8,
              warnings: []
            },
            clone: null,
            dom: null,
            screenshot: null,
            diagnostics: { blocker: null, warnings: [] }
          }
        })
      ]
    });
    const evidence = packet.evidence as InspiredesignEvidenceJson;

    expect(evidence.targetAnalysis).toMatchObject({
      primaryKind: "page",
      kinds: ["page"]
    });
    expect(evidence.targetAnalysis?.component).toBeUndefined();
    expect(evidence.targetAnalysis?.triggeringSignals).toContain(
      "page default: non-page targets did not clear brief intent plus support gates"
    );
    expect(packet.prototypeGuidanceMarkdown).not.toContain("Component prototype target");
  });

  it("keeps component intent without usable support classified as page", () => {
    const brief = "Prototype a reusable component for a checkout card.";
    const packet = buildInspiredesignPacket({
      brief,
      briefExpansion: makeBriefExpansion({ sourceBrief: brief }),
      urls: ["https://example.com/failed-reference"],
      includePrototypeGuidance: true,
      references: [
        makeReference({
          id: "failed-reference",
          url: "https://example.com/failed-reference",
          title: "Component props slots variants states",
          excerpt: "Failed page mentions hover focus disabled loading error fixtures.",
          fetchStatus: "failed",
          captureStatus: "failed",
          fetchFailure: "network_error",
          captureFailure: "capture_failed",
          capture: null
        })
      ]
    });
    const evidence = packet.evidence as InspiredesignEvidenceJson;

    expect(evidence.targetAnalysis).toMatchObject({
      primaryKind: "page",
      kinds: ["page"]
    });
    expect(evidence.targetAnalysis?.component).toBeUndefined();
    expect(evidence.targetAnalysis?.triggeringSignals).toContain(
      "page default: non-page targets did not clear brief intent plus support gates"
    );
  });

  it("keeps asset intent without usable support classified as page", () => {
    const brief = "Create a logo asset pack.";
    const packet = buildInspiredesignPacket({
      brief,
      briefExpansion: makeBriefExpansion({ sourceBrief: brief }),
      urls: [],
      includePrototypeGuidance: true,
      references: []
    });
    const evidence = packet.evidence as InspiredesignEvidenceJson;

    expect(evidence.targetAnalysis).toMatchObject({
      primaryKind: "page",
      kinds: ["page"]
    });
    expect(evidence.targetAnalysis?.asset).toBeUndefined();
    expect(evidence.targetAnalysis?.triggeringSignals).toContain(
      "page default: non-page targets did not clear brief intent plus support gates"
    );
    expect(hasForbiddenCanvasPlanKey(packet.canvasPlanRequest as JsonValue)).toBe(false);
  });

  it("keeps support-only non-page language classified as page", () => {
    const cases = [
      "Design variants with hover focus disabled loading fixtures and state matrix coverage.",
      "Design responsive variants with provenance, alt text, usage rules, and replacement rules."
    ];

    for (const brief of cases) {
      const packet = buildInspiredesignPacket({
        brief,
        briefExpansion: makeBriefExpansion({ sourceBrief: brief }),
        urls: [],
        includePrototypeGuidance: true,
        references: []
      });
      const evidence = packet.evidence as InspiredesignEvidenceJson;

      expect(evidence.targetAnalysis).toMatchObject({
        primaryKind: "page",
        kinds: ["page"]
      });
      expect(evidence.targetAnalysis?.component).toBeUndefined();
      expect(evidence.targetAnalysis?.asset).toBeUndefined();
    }
  });

  it("keeps an explicit hero component target despite page preview fixture wording", () => {
    const brief = "Prototype a reusable hero component with props, slots, variants, states, and page preview fixtures.";
    const packet = buildInspiredesignPacket({
      brief,
      briefExpansion: makeBriefExpansion({ sourceBrief: brief }),
      urls: [],
      includePrototypeGuidance: true,
      references: []
    });
    const evidence = packet.evidence as InspiredesignEvidenceJson;

    expect(evidence.targetAnalysis).toMatchObject({
      primaryKind: "component",
      kinds: ["component"],
      component: { canvasType: "CanvasComponentInventoryItem" }
    });
    expect(evidence.targetAnalysis?.asset).toBeUndefined();
    expect(evidence.targetAnalysis?.triggeringSignals).toEqual(
      expect.arrayContaining([
        expect.stringContaining("component intent"),
        expect.stringContaining("component support")
      ])
    );
    expect(packet.prototypeGuidanceMarkdown).toContain("Component prototype target");
  });

  it("keeps page-first briefs classified as page even with component detail words", () => {
    const brief = "Design a landing page with a reusable hero component, variants, hover focus states, and preview fixtures.";
    const packet = buildInspiredesignPacket({
      brief,
      briefExpansion: makeBriefExpansion({ sourceBrief: brief }),
      urls: [],
      includePrototypeGuidance: true,
      references: []
    });
    const evidence = packet.evidence as InspiredesignEvidenceJson;

    expect(evidence.targetAnalysis).toMatchObject({
      primaryKind: "page",
      kinds: ["page"]
    });
    expect(evidence.targetAnalysis?.component).toBeUndefined();
    expect(evidence.targetAnalysis?.triggeringSignals).toContain(
      "page default: page was the first explicit target in the brief"
    );
    expect(packet.prototypeGuidanceMarkdown).toContain("Page prototype target");
    expect(packet.prototypeGuidanceMarkdown).not.toContain("Component prototype target");
  });

  it("keeps component-first briefs classified as page when page confidence is stronger", () => {
    const brief = "Prototype a component with props for a landing page website homepage dashboard microsite surface.";
    const packet = buildInspiredesignPacket({
      brief,
      briefExpansion: makeBriefExpansion({ sourceBrief: brief }),
      urls: [],
      includePrototypeGuidance: true,
      references: []
    });
    const evidence = packet.evidence as InspiredesignEvidenceJson;

    expect(evidence.targetAnalysis).toMatchObject({
      primaryKind: "page",
      kinds: ["page"]
    });
    expect(evidence.targetAnalysis?.component).toBeUndefined();
    expect(evidence.targetAnalysis?.triggeringSignals).toContain(
      "page default: non-page targets did not beat page confidence"
    );
    expect(packet.prototypeGuidanceMarkdown).toContain("Page prototype target");
    expect(packet.prototypeGuidanceMarkdown).not.toContain("Component prototype target");
  });

  it("uses page tie-break when eligible component and asset targets have equal confidence", () => {
    const brief = "Prototype a component and asset for a landing page with props and usage rules.";
    const packet = buildInspiredesignPacket({
      brief,
      briefExpansion: makeBriefExpansion({ sourceBrief: brief }),
      urls: [],
      includePrototypeGuidance: true,
      references: []
    });
    const evidence = packet.evidence as InspiredesignEvidenceJson;

    expect(evidence.targetAnalysis).toMatchObject({
      primaryKind: "page",
      kinds: ["page"]
    });
    expect(evidence.targetAnalysis?.component).toBeUndefined();
    expect(evidence.targetAnalysis?.asset).toBeUndefined();
    expect(evidence.targetAnalysis?.triggeringSignals).toEqual(
      expect.arrayContaining([
        "page default: page intent won a tied non-page confidence score",
        expect.stringContaining("component intent"),
        expect.stringContaining("asset intent")
      ])
    );
    expect(packet.prototypeGuidanceMarkdown).toContain("Page prototype target");
    expect(packet.prototypeGuidanceMarkdown).not.toContain("Component prototype target");
    expect(packet.prototypeGuidanceMarkdown).not.toContain("Asset prototype target");
  });

  it("emits mixed component and asset details only when both targets clear evidence gates", () => {
    const brief = "Prototype a reusable checkout card component with price props, badge slot, media slot, hover focus disabled loading and error states plus an asset pack with responsive variants and usage rules.";
    const packet = buildInspiredesignPacket({
      brief,
      briefExpansion: makeBriefExpansion({ sourceBrief: brief }),
      urls: [],
      includePrototypeGuidance: true,
      references: []
    });
    const evidence = packet.evidence as InspiredesignEvidenceJson;
    const canvasPlan = packet.canvasPlanRequest.generationPlan as CanvasTargetAnalysisLeakFields;

    expect(evidence.targetAnalysis?.kinds).toEqual(["component", "asset"]);
    expect(evidence.targetAnalysis?.component?.canvasType).toBe("CanvasComponentInventoryItem");
    expect(evidence.targetAnalysis?.asset?.canvasType).toBe("CanvasAsset");
    expect(evidence.targetAnalysis?.triggeringSignals).toEqual(
      expect.arrayContaining([
        expect.stringContaining("component intent"),
        expect.stringContaining("asset intent")
      ])
    );
    expect(packet.prototypeGuidanceMarkdown).toContain("Component prototype target");
    expect(packet.prototypeGuidanceMarkdown).toContain("Asset prototype target");
    expect(canvasPlan.targetAnalysis).toBeUndefined();
  });

  it("turns landing-page vectors into rich section and motion guidance", () => {
    const packet = buildInspiredesignPacket({
      brief: "Create a premium public church landing page inspired by a global ministry homepage.",
      briefExpansion: makeBriefExpansion({
        sourceBrief: "Create a premium public church landing page inspired by a global ministry homepage."
      }),
      urls: ["https://example.com/global-church"],
      references: [
        makeReference({
          id: "global-church",
          url: "https://example.com/global-church",
          title: "Global Church Home",
          excerpt: "Worship-led homepage with service pathways and story-led impact.",
          captureStatus: "captured",
          capture: {
            snapshot: {
              content: "Worship hero, find a church pathway, regional navigation, impact stories.",
              refCount: 8,
              warnings: []
            }
          }
        })
      ],
      includePrototypeGuidance: true
    });
    const pageGuidance = [
      packet.generationPlan.targetOutcome.summary,
      packet.generationPlan.contentStrategy.source,
      packet.generationPlan.componentStrategy.mode,
      packet.canvasPlanRequest.generationPlan.contentStrategy.source,
      packet.implementationPlanMarkdown,
      packet.designMarkdown,
      packet.prototypeGuidanceMarkdown ?? ""
    ].join(" ");

    expect(pageGuidance).toContain("8 to 12");
    expect(pageGuidance).toContain("hero entrance reveal");
    expect(pageGuidance).toContain("section scroll reveal");
    expect(pageGuidance).toContain("CTA/focus feedback");
    expect(pageGuidance).toContain("prefers-reduced-motion");
    expect(pageGuidance).toContain("Microinteractions");
    expect(pageGuidance).toContain("hover");
    expect(pageGuidance).toContain("Cursor effects");
    expect(pageGuidance).toContain("Animation choreography");
    expect(pageGuidance).toContain("parallax");
    expect(pageGuidance).toContain("Glassmorphism");
    expect(pageGuidance).toContain("content-rich");
    expect(pageGuidance).toContain("Capture desktop and mobile browser proof");
    expect(pageGuidance).toContain("reduced-motion");
    expect(packet.generationPlan.targetOutcome.summary).toContain("Reference cues:");
    expect(packet.generationPlan.componentStrategy.mode.indexOf("captured references")).toBeLessThan(
      packet.generationPlan.componentStrategy.mode.indexOf("microinteractions")
    );
  });

  it("lets public reference evidence override stale dashboard route defaults", () => {
    const packet = buildInspiredesignPacket({
      brief: "Create a premium public church landing page inspired by a global ministry homepage.",
      briefExpansion: makeBriefExpansion({
        sourceBrief: "Create a premium public church landing page inspired by a global ministry homepage.",
        format: makeBriefFormat({
          id: "stale-dashboard-route",
          label: "Stale dashboard route",
          archetype: "B2B dashboard or app shell",
          layoutArchetype: "sidebar workspace shell",
          componentGrammar: "dashboard panels, filters, charts, command surface",
          route: {
            profile: "control-room",
            themeStrategy: "multi-theme-system",
            navigationModel: "sidebar",
            layoutApproach: "workspace-dashboard-grid"
          }
        })
      }),
      urls: ["https://example.com/global-church"],
      references: [
        makeReference({
          id: "global-church",
          url: "https://example.com/global-church",
          title: "Global Church Home",
          excerpt: "Find a church, church locations, worship music, global regions, stories, conferences, and online participation.",
          captureStatus: "captured",
          capture: {
            snapshot: {
              content: "Full-bleed worship hero, find a church pathway, church locations, regional navigation, stories, events, and online service CTA.",
              refCount: 12,
              warnings: []
            }
          }
        })
      ],
      includePrototypeGuidance: true
    });
    const artifacts = JSON.stringify({
      plan: packet.generationPlan,
      canvas: packet.canvasPlanRequest,
      design: packet.designMarkdown,
      implementation: packet.implementationPlanMarkdown,
      prototype: packet.prototypeGuidanceMarkdown,
      evidence: packet.evidence
    });

    expect(packet.generationPlan.visualDirection.profile).toBe("product-story");
    expect(packet.canvasPlanRequest.generationPlan.layoutStrategy.navigationModel).toBe("global-header");
    expect(packet.generationPlan.designVectors.sourcePriority).toBe("reference-evidence-first");
    expect(packet.generationPlan.designVectors.surfaceIntent).toContain("public landing page");
    expect(packet.generationPlan.designVectors.sectionArchitecture.join(" ")).toContain("8 to 12");
    expect(artifacts).toContain("location-first church discovery");
    expect(artifacts).not.toContain("workspace shell zones");
    expect(artifacts).not.toContain("command surfaces");
    expect(artifacts).not.toContain("dashboard panels");
  });

  it("filters browser and challenge blocker phrases from creative synthesis", () => {
    const references = [
      ["javascript", "JavaScript is required to view this page."],
      ["captcha", "CAPTCHA verification required before continuing."],
      ["challenge", "Complete the verification challenge to continue."],
      ["cookies", "Please enable cookies to view this website."]
    ].map(([id, excerpt]) => makeReference({
      id,
      url: `https://example.com/${id}`,
      title: "Blocked reference",
      excerpt,
      captureStatus: "captured",
      capture: {
        snapshot: {
          content: excerpt,
          refCount: 1,
          warnings: []
        }
      }
    }));
    const packet = buildInspiredesignPacket({
      brief: "Create a premium public church website for a global congregation.",
      briefExpansion: makeBriefExpansion({
        sourceBrief: "Create a premium public church website for a global congregation."
      }),
      urls: references.map((reference) => reference.url),
      references
    });
    const evidence = packet.evidence as InspiredesignEvidenceJson;
    const guidance = JSON.stringify({
      board: evidence.referencePatternBoard,
      vectors: evidence.designVectors,
      generationPlan: packet.generationPlan
    });

    expect(evidence.referencePatternBoard?.references).toEqual([]);
    expect(evidence.designVectors?.sourcePriority).toBe("brief-only");
    expect(guidance).not.toContain("JavaScript is required");
    expect(guidance).not.toContain("CAPTCHA");
    expect(guidance).not.toContain("verification challenge");
    expect(guidance).not.toContain("enable cookies");
  });

  it("does not treat fetch-only sign-in pages as creative evidence", () => {
    const packet = buildInspiredesignPacket({
      brief: "Create a premium public church landing page for a global congregation.",
      briefExpansion: makeBriefExpansion({
        sourceBrief: "Create a premium public church landing page for a global congregation."
      }),
      urls: ["https://example.com/sign-in"],
      references: [
        makeReference({
          id: "sign-in",
          url: "https://example.com/sign-in",
          title: "Sign in",
          excerpt: "Authentication required before viewing this dashboard.",
          captureStatus: "off"
        })
      ]
    });
    const evidence = packet.evidence as InspiredesignEvidenceJson;
    const guidance = JSON.stringify({
      board: packet.generationPlan.referencePatternBoard,
      vectors: packet.generationPlan.designVectors,
      design: packet.designMarkdown
    });

    expect(evidence.referencePatternBoard?.references).toEqual([]);
    expect(evidence.designVectors?.sourcePriority).toBe("brief-only");
    expect(guidance).not.toContain("Authentication required");
    expect(guidance).not.toContain("viewing this dashboard");
  });

  it("makes all-failed URL evidence explicit without treating it as creative direction", () => {
    const packet = buildInspiredesignPacket({
      brief: "Create a premium public church website for a global congregation.",
      briefExpansion: makeBriefExpansion({
        sourceBrief: "Create a premium public church website for a global congregation."
      }),
      urls: ["https://example.com/protected"],
      references: [
        makeReference({
          id: "protected",
          url: "https://example.com/protected",
          fetchStatus: "failed",
          captureStatus: "failed",
          title: "Sign in",
          excerpt: "Authentication required for admin dashboard analytics.",
          fetchFailure: "Authentication required",
          captureFailure: "Challenge page blocked capture."
        })
      ]
    });

    expect(packet.advancedBriefMarkdown.indexOf("Reference evidence unavailable:")).toBe(0);
    expect(packet.advancedBriefMarkdown).toContain("1 attempted reference(s) are retained in diagnostic artifacts only.");
    expect(packet.advancedBriefMarkdown).not.toContain("https://example.com/protected");
    expect(packet.advancedBriefMarkdown).not.toContain("Authentication required");
    expect(packet.advancedBriefMarkdown).toContain("Selected prompt format: Premium editorial landing page");
    expect(packet.advancedBriefMarkdown).not.toContain("admin dashboard analytics");
    expect(packet.implementationPlan.risksAndAmbiguities[0]).toContain(
      "Reference URLs were attempted, but no usable creative evidence was captured"
    );
    expect(packet.implementationPlan.risksAndAmbiguities[0]).not.toContain(
      "Live references were reduced into reusable patterns"
    );
    expect(packet.implementationPlanMarkdown).not.toContain("Live references were reduced into reusable patterns");
    expect(packet.designMarkdown).not.toContain("Live references were reduced into reusable patterns");
  });

  it("uses only usable references for mixed reference pattern boards", () => {
    const packet = buildInspiredesignPacket({
      brief: "Create a premium public church landing page inspired by a ministry homepage.",
      briefExpansion: makeBriefExpansion({
        sourceBrief: "Create a premium public church landing page inspired by a ministry homepage."
      }),
      urls: ["https://example.com/church", "https://example.com/blocked"],
      references: [
        makeReference({
          id: "church",
          url: "https://example.com/church",
          title: "Global Church Home",
          excerpt: "Worship-led homepage with service pathways and story-led impact.",
          captureStatus: "captured",
          capture: {
            snapshot: {
              content: "Worship hero, find a church pathway, regional navigation, impact stories.",
              refCount: 8,
              warnings: []
            }
          }
        }),
        makeReference({
          id: "blocked",
          url: "https://example.com/blocked",
          fetchStatus: "failed",
          captureStatus: "failed",
          title: "Admin dashboard",
          excerpt: "Authentication required for analytics control room.",
          fetchFailure: "Authentication required",
          captureFailure: "Challenge page blocked capture."
        })
      ]
    });
    const evidence = packet.evidence as InspiredesignEvidenceJson;

    expect(evidence.referencePatternBoard?.references).toHaveLength(1);
    expect(evidence.referencePatternBoard?.references[0]?.id).toBe("church");
    expect(evidence.referencePatternBoard?.references[0]?.layoutRecipe).toContain("church discovery");
    expect(JSON.stringify(evidence.referencePatternBoard)).not.toContain("analytics control room");
    expect(evidence.designVectors?.sourcePriority).toBe("reference-evidence-first");
  });

  it("keeps section architecture route-aware and aligned with runtime budgets", () => {
    const cases = [
      {
        label: "landing",
        format: makeBriefFormat(),
        expected: "8 to 12",
        rejected: "workspace shell zones",
        maxPrimarySections: 12
      },
      {
        label: "dashboard",
        format: makeBriefFormat({
          route: {
            profile: "ops-control",
            themeStrategy: "single-theme",
            navigationModel: "sidebar",
            layoutApproach: "workspace-shell"
          }
        }),
        expected: "workspace shell zones",
        rejected: "landing-page sections",
        maxPrimarySections: 8
      },
      {
        label: "docs",
        format: makeBriefFormat({
          route: {
            profile: "documentation",
            themeStrategy: "multi-theme-system",
            navigationModel: "sidebar",
            layoutApproach: "documentation-hub"
          }
        }),
        expected: "text-light overview sequence",
        rejected: "landing-page sections",
        maxPrimarySections: 8
      },
      {
        label: "onboarding",
        format: makeBriefFormat({
          route: {
            profile: "auth-focused",
            themeStrategy: "light-dark-parity",
            navigationModel: "contextual",
            layoutApproach: "stacked-mobile-flow"
          }
        }),
        expected: "screen sequence",
        rejected: "landing-page sections",
        maxPrimarySections: 8
      },
      {
        label: "immersive",
        format: makeBriefFormat({
          route: {
            profile: "cinematic-minimal",
            themeStrategy: "single-theme",
            navigationModel: "immersive",
            layoutApproach: "product-scene-scroll"
          }
        }),
        expected: "scene beats",
        rejected: "landing-page sections",
        maxPrimarySections: 8
      }
    ];

    for (const { label, format, expected, rejected, maxPrimarySections } of cases) {
      const packet = buildInspiredesignPacket({
        brief: `Design a ${label} experience.`,
        briefExpansion: makeBriefExpansion({ format }),
        urls: [],
        references: []
      });
      const architecture = packet.generationPlan.designVectors.sectionArchitecture.join(" ");

      expect(architecture).toContain(expected);
      expect(architecture).not.toContain(rejected);
      expect(packet.designContract.runtimeBudgets).toMatchObject({ maxPrimarySections });
      if (format.route.navigationModel === "sidebar") {
        expect(packet.generationPlan.designVectors.interactionDensity).not.toContain("public-page CTAs");
        expect(packet.generationPlan.designVectors.interactionDensity).toContain("command surfaces");
      }
    }
  });

  it("uses documentation interaction density when documentation is not a sidebar shell", () => {
    const packet = buildInspiredesignPacket({
      brief: "Design a public documentation landing page.",
      briefExpansion: makeBriefExpansion({
        format: makeBriefFormat({
          route: {
            profile: "documentation",
            themeStrategy: "multi-theme-system",
            navigationModel: "global-header",
            layoutApproach: "documentation-homepage"
          }
        })
      }),
      urls: [],
      references: []
    });

    expect(packet.generationPlan.designVectors.interactionDensity).toContain(
      "visual overview"
    );
  });

  it("turns stale research atlas routing into a text-light public consulting landing direction", () => {
    const documentationFormat = makeBriefFormat({
      id: "luminous-research-atlas",
      label: "Luminous research atlas",
      archetype: "annotated evidence atlas",
      layoutArchetype: "bright scroll atlas with chaptered evidence bands and annotation rails",
      componentGrammar: "evidence chapters, methodology blocks, chart plates, callout annotations, citation modules",
      antiPatterns: [
        "No feature-card hero.",
        "Do not bury the conversion CTA.",
        "Use dense data tables."
      ],
      route: {
        profile: "documentation",
        themeStrategy: "single-theme",
        navigationModel: "contextual",
        layoutApproach: "annotated-atlas-scroll"
      }
    });
    const packet = buildInspiredesignPacket({
      brief: "Create a premium public AI consulting landing page for enterprise advisory services.",
      briefExpansion: makeBriefExpansion({ format: documentationFormat }),
      urls: ["https://www.bcg.com/capabilities/artificial-intelligence"],
      includePrototypeGuidance: true,
      references: [
        makeReference({
          id: "bcg-ai",
          url: "https://www.bcg.com/capabilities/artificial-intelligence",
          title: "Artificial Intelligence Consulting and Strategy | BCG",
          excerpt: "AI consulting services, agentic AI, generative AI, responsible AI, client case studies, industries, and business transformation.",
          captureStatus: "captured",
          capture: {
            snapshot: {
              content: "BCG AI consulting services help companies deliver ROI from AI with agentic AI, generative AI, responsible AI, client case studies, industries, and transformation pathways.",
              refCount: 10,
              warnings: []
            }
          }
        })
      ]
    });
    const guidance = JSON.stringify({
      generationPlan: packet.generationPlan,
      designMarkdown: packet.designMarkdown,
      implementation: packet.implementationPlanMarkdown,
      prototype: packet.prototypeGuidanceMarkdown
    });

    expect(packet.generationPlan.visualDirection.profile).toBe("product-story");
    expect(packet.generationPlan.layoutStrategy.navigationModel).toBe("global-header");
    expect(packet.generationPlan.designVectors.surfaceIntent).toBe("reference-led public landing page");
    expect(packet.advancedBriefMarkdown).toContain("Selected prompt format: Reference-led public landing page");
    expect(packet.advancedBriefMarkdown).toContain("layout approach: reference-led-landing-page");
    expect(packet.advancedBriefMarkdown).toContain("Focus areas:");
    expect(packet.advancedBriefMarkdown).toContain("Treat missing details as open constraints");
    expect(packet.advancedBriefMarkdown).toContain("Keep the direction premium, specific, and implementable");
    expect(packet.generationPlan.designVectors.sectionArchitecture).toEqual(
      expect.arrayContaining([expect.stringContaining("8 to 12")])
    );
    expect(packet.followthrough.briefExpansion.format.componentGrammar).not.toContain("event sections");
    expect(packet.followthrough.briefExpansion.format.componentGrammar).not.toContain("visit CTA");
    expect(packet.designMarkdown).toContain("Don't use feature-card hero.");
    expect(packet.designMarkdown).toContain("Don't bury the conversion CTA.");
    expect(packet.designMarkdown).toContain("Don't use dense data tables.");
    expect(packet.designMarkdown).not.toContain("Don't no");
    expect(packet.prototypeGuidanceMarkdown).toContain("# 6. Optional Prototype Plan");
    for (const forbidden of [
      "documentation zones",
      "citation modules",
      "annotation rails",
      "methodology blocks",
      "reference depth",
      "event sections",
      "visit CTA",
      "events",
      "event, visit",
      "visit",
      "documentation zones",
      "citation modules",
      "annotation rails",
      "methodology blocks"
    ]) {
      expect(guidance).not.toContain(forbidden);
      expect(packet.advancedBriefMarkdown).not.toContain(forbidden);
    }
  });

  it("does not promote a generic service reference into a public landing route", () => {
    const dashboardFormat = makeBriefFormat({
      id: "b2b-dashboard-app-shell",
      label: "B2B dashboard or app shell",
      archetype: "operator dashboard",
      layoutArchetype: "workspace shell",
      route: {
        profile: "ops-control",
        themeStrategy: "single-theme",
        navigationModel: "sidebar",
        layoutApproach: "workspace-shell"
      }
    });
    const packet = buildInspiredesignPacket({
      brief: "Design an internal operator dashboard for service health teams.",
      briefExpansion: makeBriefExpansion({ format: dashboardFormat }),
      urls: ["https://example.com/service-status"],
      references: [
        makeReference({
          id: "service-status",
          url: "https://example.com/service-status",
          title: "Service health status",
          excerpt: "Service status history and response time charts for operators.",
          captureStatus: "captured",
          capture: {
            snapshot: {
              content: "Service response time, operational queues, and internal status details.",
              refCount: 4,
              warnings: []
            }
          }
        })
      ]
    });

    expect(packet.generationPlan.designVectors.surfaceIntent).toBe("operator dashboard");
    expect(packet.generationPlan.visualDirection.profile).toBe("ops-control");
    expect(packet.generationPlan.layoutStrategy.navigationModel).toBe("sidebar");
    expect(packet.advancedBriefMarkdown).not.toContain("Selected prompt format: Reference-led public landing page");
  });

  it("does not promote service event operations evidence into a public landing route", () => {
    const dashboardFormat = makeBriefFormat({
      id: "b2b-dashboard-app-shell",
      label: "B2B dashboard or app shell",
      archetype: "operator dashboard",
      layoutArchetype: "workspace shell",
      route: {
        profile: "ops-control",
        themeStrategy: "single-theme",
        navigationModel: "sidebar",
        layoutApproach: "workspace-shell"
      }
    });
    const packet = buildInspiredesignPacket({
      brief: "Design an internal operator dashboard for service event response teams.",
      briefExpansion: makeBriefExpansion({ format: dashboardFormat }),
      urls: ["https://example.com/service-events"],
      references: [
        makeReference({
          id: "service-events",
          url: "https://example.com/service-events",
          title: "Service events console",
          excerpt: "Service events history, response queues, operator status, and incident charts.",
          captureStatus: "captured",
          capture: {
            snapshot: {
              content: "Service events timeline, response time panels, incident queues, and internal operator charts.",
              refCount: 5,
              warnings: []
            }
          }
        })
      ]
    });

    expect(packet.generationPlan.designVectors.surfaceIntent).toBe("operator dashboard");
    expect(packet.generationPlan.visualDirection.profile).toBe("ops-control");
    expect(packet.advancedBriefMarkdown).not.toContain("Selected prompt format: Reference-led public landing page");
  });

  it("synthesizes noisy captured church evidence into semantic pattern board cues", () => {
    const packet = buildInspiredesignPacket({
      brief: "Create a premium public church landing page inspired by a global ministry homepage.",
      briefExpansion: makeBriefExpansion({
        sourceBrief: "Create a premium public church landing page inspired by a global ministry homepage."
      }),
      urls: ["https://example.com/global-church"],
      references: [
        makeReference({
          id: "global-church",
          url: "https://example.com/global-church",
          title: "Hillsong Church - Welcome Home - Hillsong",
          excerpt: "Check our Church Locations, Listen to Hillsong Music and Exclusive Content from the Hillsong Team",
          captureStatus: "captured",
          capture: {
            snapshot: {
              content: "[r1] link \"Hillsong Logo CHURCH\"\n[r2] combobox value=\"EN\"\n[r3] button \"USE MY CURRENT LOCATION\"\n[r4] button \"FIND A CHURCH\"\n[r9] link \"ASIA PACIFIC\"\n[r10] link \"EUROPE\"\n[r11] link \"NORTH AMERICA\"\n[r18] link \"MUSIC\"\n[r19] link \"CONFERENCE\"\n[r21] link \"BLOG\"",
              refCount: 12,
              warnings: []
            },
            clone: {
              componentPreview: "import \"./opendevbrowser.css\"; export default function OpenDevBrowserComponent() { return <div dangerouslySetInnerHTML={{ __html: \"...\" }} /> }",
              cssPreview: ".opendevbrowser-root { align-content: normal; background-color: rgba(0, 0, 0, 0); font-family: Arial; }",
              warnings: []
            }
          }
        })
      ]
    });
    const evidence = packet.evidence as InspiredesignEvidenceJson;
    const entry = evidence.referencePatternBoard?.references[0];
    const vectors = evidence.designVectors;
    const boardText = JSON.stringify({
      entry,
      vectors
    });

    expect(entry?.layoutRecipe).toContain("church discovery");
    expect(entry?.layoutRecipe).toContain("worship and music");
    expect(entry?.patternsToBorrow).toEqual(expect.arrayContaining([
      "location-first church discovery with regional pathways",
      "worship and music content as atmosphere and ministry proof",
      "global region navigation with online participation path"
    ]));
    expect(vectors?.directionLabel).toContain("church discovery");
    expect(vectors?.referenceInfluence).toEqual(expect.arrayContaining([
      "location-first church discovery with regional pathways"
    ]));
    expect(packet.designMarkdown).toContain("Hillsong Church");
    expect(packet.designMarkdown).not.toContain("[r1]");
    expect(packet.designMarkdown).not.toContain("value=");
    expect(packet.designMarkdown).not.toContain("opendevbrowser-root");
    expect(boardText).not.toContain("[r1]");
    expect(boardText).not.toContain("opendevbrowser-root");
    expect(boardText).not.toContain("dangerouslySetInnerHTML");
    expect(boardText).not.toContain("align-content");
  });

  it("does not turn raw CSS previews into creative guidance", () => {
    const packet = buildInspiredesignPacket({
      brief: "Create a premium public landing page inspired by a minimal hero reference.",
      briefExpansion: makeBriefExpansion({
        sourceBrief: "Create a premium public landing page inspired by a minimal hero reference."
      }),
      urls: ["https://example.com/minimal"],
      references: [
        makeReference({
          id: "minimal",
          url: "https://example.com/minimal",
          title: "Minimal Hero Reference",
          captureStatus: "captured",
          capture: {
            clone: {
              componentPreview: "",
              cssPreview: ".hero { min-height: 100vh; color: red; transition: opacity 480ms; }",
              warnings: []
            }
          }
        })
      ]
    });
    const guidanceText = JSON.stringify({
      board: packet.generationPlan.referencePatternBoard,
      vectors: packet.generationPlan.designVectors,
      advancedBrief: packet.advancedBriefMarkdown,
      designMarkdown: packet.designMarkdown
    });

    expect(guidanceText).toContain("Minimal Hero Reference");
    expect(packet.generationPlan.referencePatternBoard.references[0]?.capturedVia).not.toContain("clone");
    expect(guidanceText).not.toContain(".hero");
    expect(guidanceText).not.toContain("min-height");
    expect(guidanceText).not.toContain("transition: opacity");
  });

  it("does not treat CSS-only clone captures as usable creative evidence", () => {
    const packet = buildInspiredesignPacket({
      brief: "Create a premium public landing page inspired by a minimal hero reference.",
      briefExpansion: makeBriefExpansion({
        sourceBrief: "Create a premium public landing page inspired by a minimal hero reference."
      }),
      urls: ["https://example.com/css-only"],
      references: [
        makeReference({
          id: "css-only",
          url: "https://example.com/css-only",
          fetchStatus: "failed",
          captureStatus: "captured",
          capture: {
            clone: {
              componentPreview: "",
              cssPreview: ".hero { min-height: 100vh; color: red; transition: opacity 480ms; }",
              warnings: []
            }
          }
        })
      ]
    });
    const evidence = packet.evidence as InspiredesignEvidenceJson;

    expect(evidence.referencePatternBoard?.references).toEqual([]);
    expect(evidence.designVectors?.sourcePriority).toBe("brief-only");
  });

  it("threads DOM-only capture cues when fetch and clone signals are unavailable", () => {
    const packet = buildInspiredesignPacket({
      brief: "Create an editorial fashion studio landing page.",
      briefExpansion: makeBriefExpansion({
        sourceBrief: "Create an editorial fashion studio landing page."
      }),
      urls: ["https://example.com/archive-studio"],
      includePrototypeGuidance: true,
      references: [
        makeReference({
          id: "archive-studio",
          url: "https://example.com/archive-studio",
          fetchStatus: "failed",
          captureStatus: "captured",
          capture: {
            dom: {
              outerHTML: "<main><h1>Archive fashion grid</h1><p>Charcoal runway index with ivory margins and garment detail captions.</p></main>",
              truncated: false
            }
          }
        })
      ]
    });

    const artifacts = [
      packet.advancedBriefMarkdown,
      packet.designMarkdown,
      packet.implementationPlanMarkdown,
      packet.prototypeGuidanceMarkdown ?? "",
      JSON.stringify(packet.canvasPlanRequest),
      JSON.stringify(packet.followthrough)
    ];

    for (const artifact of artifacts) {
      expect(artifact).toContain("Archive fashion grid");
      expect(artifact).toContain("Charcoal runway index");
      expect(artifact).toContain("garment detail captions");
    }
  });

  it("uses clean DOM cues after duplicate and empty cleaned signals", () => {
    const packet = buildInspiredesignPacket({
      brief: "Create an editorial studio landing page.",
      briefExpansion: makeBriefExpansion({
        sourceBrief: "Create an editorial studio landing page."
      }),
      urls: ["https://example.com/deduped"],
      references: [
        makeReference({
          id: "deduped",
          url: "https://example.com/deduped",
          title: "Ivory editorial hero",
          excerpt: "Ivory editorial hero",
          captureStatus: "captured",
          capture: {
            snapshot: {
              content: "[r1] link ; {}",
              refCount: 1,
              warnings: []
            },
            dom: {
              outerHTML: "<main><h1>Obsidian gallery rhythm</h1><p>Ivory margin system with calm project sequencing.</p></main>",
              truncated: false
            }
          }
        })
      ]
    });
    const evidence = packet.evidence as InspiredesignEvidenceJson;
    const artifacts = JSON.stringify({
      board: evidence.referencePatternBoard,
      vectors: evidence.designVectors,
      plan: packet.generationPlan,
      design: packet.designMarkdown,
      handoff: packet.followthrough
    });

    expect(evidence.designVectors?.sourcePriority).toBe("reference-evidence-first");
    expect(artifacts).toContain("Obsidian gallery rhythm");
    expect(artifacts).toContain("Ivory margin system");
    expect(artifacts).not.toContain("[r1]");
    expect(artifacts).not.toContain("; {}");
  });

  it("uses later DOM cues when earlier evidence is diagnostic or code-like", () => {
    const packet = buildInspiredesignPacket({
      brief: "Create an editorial studio landing page.",
      briefExpansion: makeBriefExpansion({
        sourceBrief: "Create an editorial studio landing page."
      }),
      urls: ["https://example.com/studio"],
      references: [
        makeReference({
          id: "studio",
          url: "https://example.com/studio",
          title: "Sign in",
          excerpt: "Authentication required before viewing this dashboard.",
          captureStatus: "captured",
          capture: {
            snapshot: {
              content: "CAPTCHA verification required before continuing.",
              refCount: 1,
              warnings: []
            },
            clone: {
              componentPreview: "import \"./opendevbrowser.css\"; export default function Component() { return <div dangerouslySetInnerHTML={{ __html: \"...\" }} /> }",
              cssPreview: ".opendevbrowser-root { align-content: normal; color: red; }",
              warnings: []
            },
            dom: {
              outerHTML: "<main><h1>Obsidian gallery rhythm</h1><p>Ivory margin system with calm project sequencing.</p></main>",
              truncated: false
            }
          }
        })
      ]
    });
    const evidence = packet.evidence as InspiredesignEvidenceJson;
    const artifacts = JSON.stringify({
      board: evidence.referencePatternBoard,
      vectors: evidence.designVectors,
      plan: packet.generationPlan,
      design: packet.designMarkdown,
      handoff: packet.followthrough
    });

    expect(evidence.designVectors?.sourcePriority).toBe("reference-evidence-first");
    expect(evidence.referencePatternBoard?.references[0]?.layoutRecipe).toContain(
      "Obsidian gallery rhythm"
    );
    expect(artifacts).toContain("Ivory margin system");
    expect(artifacts).not.toContain("Authentication required");
    expect(artifacts).not.toContain("CAPTCHA");
    expect(artifacts).not.toContain("dangerouslySetInnerHTML");
    expect(artifacts).not.toContain("opendevbrowser-root");
    expect(artifacts).not.toContain("align-content");
  });

  it("clips long reference cues before writing generation-plan summaries", () => {
    const longCue = `${"Opening marble runway cadence ".repeat(40)}terminal marker`;
    const packet = buildInspiredesignPacket({
      brief: "Create a luxury collection page.",
      briefExpansion: makeBriefExpansion({
        sourceBrief: "Create a luxury collection page."
      }),
      urls: ["https://example.com/collection"],
      references: [
        makeReference({
          id: "collection",
          url: "https://example.com/collection",
          title: "Collection reference",
          excerpt: longCue
        })
      ]
    });

    const { targetOutcome, contentStrategy, componentStrategy } = packet.canvasPlanRequest.generationPlan;

    for (const value of [targetOutcome.summary, contentStrategy.source, componentStrategy.mode]) {
      expect(value.length).toBeLessThanOrEqual(600);
      expect(value).toContain("Opening marble runway cadence");
      expect(value).not.toContain("terminal marker");
    }
  });

  it("preserves advanced brief markdown and routes generation from the selected format metadata", () => {
    const brief = "Design a premium consumer landing page";
    const advancedBrief = [
      "Selected prompt format: Premium editorial landing page",
      "",
      "Source brief:",
      brief,
      "",
      "Focus areas:",
      "- dashboard metrics",
      "- operator analytics",
      "",
      "Prompt objective:",
      "Keep the direction premium and product-led."
    ].join("\n");

    const packet = buildInspiredesignPacket({
      brief,
      briefExpansion: makeBriefExpansion({
        sourceBrief: brief,
        advancedBrief,
        format: makeBriefFormat({
          id: "custom-ops-route",
          label: "Custom ops route",
          bestFor: ["operator surfaces"],
          businessFocus: ["operations software"],
          keywords: ["dashboard", "operator"],
          archetype: "operational workspace shell",
          layoutArchetype: "predictable desktop shell with fixed navigation zones and state-aware work panels",
          typographySystem: "sharp grotesk UI type with monospaced numeric support for tables and diagnostics",
          surfaceTreatment: "bright control-room surfaces with disciplined dividers and low-elevation panels",
          shapeLanguage: "rectilinear structure with restrained radii and explicit separators",
          componentGrammar: "sidebar, command toolbar, filter rail, data tables, detail drawers, empty states",
          motionGrammar: "state-transition clarity, panel continuity, and zero decorative animation noise",
          paletteIntent: "crisp neutral shell with one utility accent and clear semantic state colors",
          visualDensity: "dense but breathable",
          designVariance: "low-variance structure",
          responsiveCollapseRules: ["Collapse secondary panes before compressing the primary work surface."],
          guardrails: ["Favor predictable layout zones, strong state communication, and clean action paths over decorative UI noise."],
          antiPatterns: ["No floating-window chaos."],
          deliverables: ["Return a dashboard contract."],
          route: {
            profile: "ops-control",
            themeStrategy: "single-theme",
            navigationModel: "sidebar",
            layoutApproach: "workspace-shell"
          }
        })
      }),
      urls: [],
      references: []
    });

    const evidence = packet.evidence as InspiredesignEvidenceJson;

    expect(packet.advancedBriefMarkdown).toContain(advancedBrief);
    expect(evidence.advancedBrief).toContain(advancedBrief);
    expect(packet.generationPlan.visualDirection.profile).toBe("ops-control");
  });

  it("keeps the selected format route even when skipped references imply another profile", () => {
    const packet = buildInspiredesignPacket({
      brief: "Design a premium consumer landing page",
      briefExpansion: makeBriefExpansion(),
      urls: ["https://example.com/blocked"],
      references: [
        makeReference({
          id: "blocked-dashboard",
          url: "https://example.com/blocked",
          fetchStatus: "skipped",
          captureStatus: "failed",
          title: "Admin dashboard",
          excerpt: "Dark analytics control room with dense reporting.",
          fetchFailure: "Authentication required"
        })
      ]
    });

    expect(packet.generationPlan.visualDirection.profile).toBe("product-story");
    expect(packet.generationPlan.visualDirection.themeStrategy).toBe("single-theme");
  });

  it("renders inspiredesign output across every supported mode", () => {
    const brief = "Design a premium product narrative landing page";
    const urls = ["https://example.com/product"];
    const packet = buildInspiredesignPacket({
      brief,
      briefExpansion: makeBriefExpansion({
        sourceBrief: brief,
        advancedBrief: "Selected prompt format: Cinematic product-story or photostudio direction\n\nSource brief:\nDesign a premium product narrative landing page",
        format: makeBriefFormat({
          id: "cinematic-product-story",
          label: "Cinematic product-story or photostudio direction",
          bestFor: ["showcase pages"],
          businessFocus: ["hardware launches"],
          keywords: ["product story", "hardware", "showcase"],
          archetype: "photostudio launch narrative",
          layoutArchetype: "scene-based scroll story with full-bleed product reveals",
          typographySystem: "restrained sans or condensed display with large scale contrast and minimal body copy",
          surfaceTreatment: "dark or bright studio backdrops, high-contrast product planes, and controlled material highlights",
          shapeLanguage: "large uninterrupted planes with almost no ornamental framing",
          componentGrammar: "scene hero, proof interludes, spec reveals, testimonial or quote punctuations",
          motionGrammar: "slow dissolves, glide transitions, and product-led reveal timing",
          paletteIntent: "controlled studio palette that serves material realism instead of interface variety",
          visualDensity: "sparse",
          designVariance: "high cinematic contrast",
          responsiveCollapseRules: ["Keep one scene per scroll beat on mobile instead of compressing multiple proof layers together."],
          guardrails: ["Do not fall back to generic ecommerce grids, trust-badge clutter, or spec-dump layouts."],
          antiPatterns: ["No marketplace product grid."],
          deliverables: ["Return a premium product-led story."],
          route: {
            profile: "cinematic-minimal",
            themeStrategy: "single-theme",
            navigationModel: "immersive",
            layoutApproach: "product-scene-scroll"
          }
        })
      }),
      urls,
      includePrototypeGuidance: true,
      references: [
        makeReference({
          id: "product-ref",
          url: "https://example.com/product",
          title: "Product reference",
          excerpt: "Hero-first product storytelling with tight proof sections.",
          captureStatus: "captured",
          capture: {
            snapshot: {
              content: "Hero, CTA, proof strip",
              refCount: 6,
              warnings: []
            },
            clone: {
              componentPreview: "<section>Hero</section>",
              cssPreview: ".hero { display: grid; }",
              warnings: []
            }
          }
        })
      ]
    });

    const readyNextStepGuidance = {
      id: "inspiredesign.design_ready",
      recipeType: "artifact_handoff",
      workflow: "inspiredesign",
      severity: "info",
      readiness: "ready",
      reasonCode: "design_ready",
      primaryAction: {
        id: "continue_to_canvas",
        label: "Continue in Canvas",
        summary: "Continue in Canvas with the generated request."
      },
      commands: [],
      paramsExamples: [],
      fieldExamples: [],
      artifactInputs: [],
      validationChecks: [],
      fallbackPolicy: { allowed: false, requiresUserConfirmation: false, reason: "Use the generated Canvas request." },
      doNotProceedIf: []
    } satisfies NextStepGuidance;

    const modes = ["compact", "json", "md", "context", "path"] as const;
    for (const mode of modes) {
      const rendered = renderInspiredesign({
        mode,
        brief,
        advancedBriefMarkdown: packet.advancedBriefMarkdown,
        urls,
        designContract: packet.designContract,
        canvasPlanRequest: packet.canvasPlanRequest,
        designAgentHandoff: packet.followthrough,
        generationPlan: packet.generationPlan,
        implementationPlan: packet.implementationPlan,
        designMarkdown: packet.designMarkdown,
        implementationPlanMarkdown: packet.implementationPlanMarkdown,
        prototypeGuidanceMarkdown: packet.prototypeGuidanceMarkdown,
        evidence: packet.evidence,
        visualEvidence: packet.visualEvidence,
        screenshotIndex: packet.screenshotIndex,
        rankedReferences: packet.rankedReferences,
        metaPromptMarkdown: packet.metaPromptMarkdown,
        nextStepGuidance: readyNextStepGuidance,
        meta: {
          requestId: "req-1",
          captureAttemptSummary: "worked=snapshot (captured 1); did_not_work=clone (failed 1), dom (skipped 1)",
          captureAttemptReport: {
            worked: ["snapshot (captured 1)"],
            didNotWork: ["clone (failed 1)", "dom (skipped 1)"]
          }
        }
      });

      expect(rendered.files.some((file) => file.path === INSPIREDESIGN_HANDOFF_FILES.designMarkdown)).toBe(true);
      expect(rendered.files.some((file) => file.path === INSPIREDESIGN_HANDOFF_FILES.advancedBrief)).toBe(true);
      expect(rendered.files.some((file) => file.path === INSPIREDESIGN_HANDOFF_FILES.prototypeGuidance)).toBe(true);
      expect(rendered.files.some((file) => file.path === INSPIREDESIGN_HANDOFF_FILES.canvasPlanRequest)).toBe(true);
      expect(rendered.files.some((file) => file.path === INSPIREDESIGN_HANDOFF_FILES.designAgentHandoff)).toBe(true);
      expect(rendered.files).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: INSPIREDESIGN_HANDOFF_FILES.visualEvidence }),
        expect.objectContaining({ path: INSPIREDESIGN_HANDOFF_FILES.screenshotIndex }),
        expect.objectContaining({ path: INSPIREDESIGN_HANDOFF_FILES.rankedReferences }),
        expect.objectContaining({ path: INSPIREDESIGN_HANDOFF_FILES.metaPrompt })
      ]));

      if (mode === "compact") {
        expect(rendered.response).toMatchObject({
          mode,
          summary: expect.stringContaining("Brief: Design a premium product narrative landing page"),
          captureAttemptSummary: "worked=snapshot (captured 1); did_not_work=clone (failed 1), dom (skipped 1)",
          captureAttemptReport: {
            worked: ["snapshot (captured 1)"],
            didNotWork: ["clone (failed 1)", "dom (skipped 1)"]
          },
          followthroughSummary: packet.followthrough.summary,
          suggestedNextAction: packet.followthrough.nextStep
        });
        expect(rendered.response.summary).toEqual(expect.stringContaining(
          "Capture: worked=snapshot (captured 1); did_not_work=clone (failed 1), dom (skipped 1)"
        ));
        expect((rendered.response.suggestedSteps as Array<Record<string, unknown>>)[0]?.reason).toBe(
          INSPIREDESIGN_HANDOFF_GUIDANCE.reviewAdvancedBrief
        );
        expect((rendered.response.suggestedSteps as Array<Record<string, unknown>>)[1]?.command).toBe(
          packet.followthrough.commandExamples.loadBestPractices
        );
        expect((rendered.response.suggestedSteps as Array<Record<string, unknown>>)[3]?.command).toBe(
          packet.followthrough.commandExamples.loadMotionDesign
        );
        expect((rendered.response.suggestedSteps as Array<Record<string, unknown>>)[4]?.reason).toBe(
          INSPIREDESIGN_HANDOFF_GUIDANCE.visualArtifactRecommendation
        );
        expect((rendered.response.suggestedSteps as Array<Record<string, unknown>>)[5]?.reason).toBe(
          INSPIREDESIGN_HANDOFF_GUIDANCE.prepareCanvasPlanRequest
        );
        expect((rendered.response.suggestedSteps as Array<Record<string, unknown>>)[5]?.command).toBe(
          INSPIREDESIGN_HANDOFF_COMMANDS.continueInCanvas
        );
        expect(rendered.response.suggestedSteps).toEqual(buildInspiredesignSuccessHandoff({
          summary: packet.followthrough.summary,
          nextStep: packet.followthrough.nextStep,
          commandExamples: packet.followthrough.commandExamples,
          deepCaptureRecommendation: packet.followthrough.deepCaptureRecommendation
        }).suggestedSteps);
      } else if (mode === "json") {
        expect(rendered.response).toMatchObject({
          mode,
          brief,
          advancedBriefMarkdown: packet.advancedBriefMarkdown,
          urls,
          prototypeGuidanceMarkdown: packet.prototypeGuidanceMarkdown,
          canvasPlanRequest: packet.canvasPlanRequest,
          designAgentHandoff: expect.objectContaining({
            commandExamples: expect.objectContaining({
              continueInCanvas: INSPIREDESIGN_HANDOFF_COMMANDS.continueInCanvas
            })
          }),
          captureAttemptSummary: "worked=snapshot (captured 1); did_not_work=clone (failed 1), dom (skipped 1)",
          followthroughSummary: packet.followthrough.summary,
          suggestedNextAction: packet.followthrough.nextStep
        });
      } else if (mode === "md") {
        expect(rendered.response).toMatchObject({
          mode,
          markdown: packet.designMarkdown,
          implementationPlanMarkdown: packet.implementationPlanMarkdown,
          prototypeGuidanceMarkdown: packet.prototypeGuidanceMarkdown,
          captureAttemptSummary: "worked=snapshot (captured 1); did_not_work=clone (failed 1), dom (skipped 1)",
          followthroughSummary: packet.followthrough.summary,
          suggestedNextAction: packet.followthrough.nextStep
        });
      } else if (mode === "context") {
        expect(rendered.response).toMatchObject({
          mode,
          context: expect.objectContaining({
            brief,
            advancedBriefMarkdown: packet.advancedBriefMarkdown,
            urls,
            designContract: packet.designContract,
            evidence: packet.evidence,
            canvasPlanRequest: packet.canvasPlanRequest,
            designAgentHandoff: expect.objectContaining({
              commandExamples: expect.objectContaining({
                continueInCanvas: INSPIREDESIGN_HANDOFF_COMMANDS.continueInCanvas
              })
            }),
            metaPromptMarkdown: packet.metaPromptMarkdown
          }),
          captureAttemptSummary: "worked=snapshot (captured 1); did_not_work=clone (failed 1), dom (skipped 1)",
          followthroughSummary: packet.followthrough.summary,
          suggestedNextAction: packet.followthrough.nextStep
        });
      } else {
        expect(rendered.response).toMatchObject({
          mode: "path",
          meta: {
            requestId: "req-1",
            captureAttemptSummary: "worked=snapshot (captured 1); did_not_work=clone (failed 1), dom (skipped 1)"
          },
          captureAttemptSummary: "worked=snapshot (captured 1); did_not_work=clone (failed 1), dom (skipped 1)",
          followthroughSummary: packet.followthrough.summary,
          suggestedNextAction: packet.followthrough.nextStep
        });
      }
    }
  });

  it("renders rejected references and synthesis in the ranked references artifact", () => {
    const brief = "Design a premium reference-led landing page";
    const usableUrl = "https://example.com/usable";
    const rejectedUrl = "https://example.com/rejected";
    const urls = [usableUrl, rejectedUrl];
    const packet = buildInspiredesignPacket({
      brief,
      briefExpansion: makeBriefExpansion({ sourceBrief: brief }),
      urls,
      references: [
        makeReference({
          id: "usable-reference",
          url: usableUrl,
          title: "Usable reference",
          excerpt: "Full-bleed public landing page with strong image hierarchy.",
          captureStatus: "captured",
          capture: {
            snapshot: {
              content: "Hero, CTA, proof strip",
              refCount: 4,
              warnings: []
            }
          }
        }),
        makeReference({
          id: "rejected-reference",
          url: rejectedUrl,
          fetchStatus: "failed",
          captureStatus: "failed",
          fetchFailure: "Provider unavailable",
          captureFailure: "No visual evidence available"
        })
      ]
    });

    const rendered = renderInspiredesign({
      mode: "path",
      brief,
      advancedBriefMarkdown: packet.advancedBriefMarkdown,
      urls,
      designContract: packet.designContract,
      canvasPlanRequest: packet.canvasPlanRequest,
      designAgentHandoff: packet.followthrough,
      generationPlan: packet.generationPlan,
      implementationPlan: packet.implementationPlan,
      designMarkdown: packet.designMarkdown,
      implementationPlanMarkdown: packet.implementationPlanMarkdown,
      prototypeGuidanceMarkdown: packet.prototypeGuidanceMarkdown,
      evidence: packet.evidence,
      visualEvidence: packet.visualEvidence,
      screenshotIndex: packet.screenshotIndex,
      rankedReferences: packet.rankedReferences,
      referencePatternBoard: buildInspiredesignRankedArtifactPatternBoard(
        packet.generationPlan.referencePatternBoard,
        packet.referencePatternBoard
      ),
      metaPromptMarkdown: packet.metaPromptMarkdown,
      meta: { requestId: "ranked-artifact" }
    });
    const rankedReferencesFile = rendered.files.find((file) => file.path === INSPIREDESIGN_HANDOFF_FILES.rankedReferences);

    expect(rankedReferencesFile?.content).toMatchObject({
      references: [expect.objectContaining({ id: "usable-reference", rank: 1 })],
      rejectedReferences: [expect.objectContaining({ id: "rejected-reference" })],
      qualitySummary: expect.objectContaining({ rejectedReferenceCount: 1 }),
      synthesis: expect.objectContaining({
        dominantDirection: expect.any(String),
        sharedFailuresToAvoid: expect.any(Array)
      })
    });
  });

  it("prefers the provided capture attempt summary and derives a fallback from the report when needed", () => {
    const brief = "Design a premium product narrative landing page";
    const packet = buildInspiredesignPacket({
      brief,
      briefExpansion: makeBriefExpansion(),
      urls: ["https://example.com/ref-1"],
      references: [makeReference()]
    });
    const report = {
      worked: ["snapshot (captured 1)"],
      didNotWork: ["clone (failed 1)", "dom (skipped 1)"]
    };

    const providedSummary = renderInspiredesign({
      mode: "compact",
      brief,
      advancedBriefMarkdown: packet.advancedBriefMarkdown,
      urls: ["https://example.com/ref-1"],
      designContract: packet.designContract,
      canvasPlanRequest: packet.canvasPlanRequest,
      designAgentHandoff: packet.followthrough,
      generationPlan: packet.generationPlan,
      implementationPlan: packet.implementationPlan,
      designMarkdown: packet.designMarkdown,
      implementationPlanMarkdown: packet.implementationPlanMarkdown,
      prototypeGuidanceMarkdown: packet.prototypeGuidanceMarkdown,
      evidence: packet.evidence,
      meta: {
        requestId: "req-1",
        captureAttemptSummary: "provided summary wins",
        captureAttemptReport: report
      }
    });

    expect(providedSummary.response).toMatchObject({
      captureAttemptSummary: "provided summary wins"
    });
    expect(providedSummary.response.summary).toEqual(expect.stringContaining("Capture: provided summary wins"));

    const derivedSummary = renderInspiredesign({
      mode: "compact",
      brief,
      advancedBriefMarkdown: packet.advancedBriefMarkdown,
      urls: ["https://example.com/ref-1"],
      designContract: packet.designContract,
      canvasPlanRequest: packet.canvasPlanRequest,
      designAgentHandoff: packet.followthrough,
      generationPlan: packet.generationPlan,
      implementationPlan: packet.implementationPlan,
      designMarkdown: packet.designMarkdown,
      implementationPlanMarkdown: packet.implementationPlanMarkdown,
      prototypeGuidanceMarkdown: packet.prototypeGuidanceMarkdown,
      evidence: packet.evidence,
      meta: {
        requestId: "req-2",
        captureAttemptReport: report
      }
    });
    const expectedSummary = formatInspiredesignCaptureAttemptSummary(report);

    expect(derivedSummary.response).toMatchObject({
      captureAttemptSummary: expectedSummary
    });
    expect(derivedSummary.response.summary).toEqual(expect.stringContaining(`Capture: ${expectedSummary}`));
  });

  it("ignores malformed capture attempt reports", () => {
    const brief = "Design a premium product narrative landing page";
    const packet = buildInspiredesignPacket({
      brief,
      briefExpansion: makeBriefExpansion(),
      urls: ["https://example.com/ref-1"],
      references: [makeReference()]
    });
    const renderWithReport = (captureAttemptReport: Record<string, string | Array<string | number>>) => renderInspiredesign({
      mode: "compact",
      brief,
      advancedBriefMarkdown: packet.advancedBriefMarkdown,
      urls: ["https://example.com/ref-1"],
      designContract: packet.designContract,
      canvasPlanRequest: packet.canvasPlanRequest,
      designAgentHandoff: packet.followthrough,
      generationPlan: packet.generationPlan,
      implementationPlan: packet.implementationPlan,
      designMarkdown: packet.designMarkdown,
      implementationPlanMarkdown: packet.implementationPlanMarkdown,
      prototypeGuidanceMarkdown: packet.prototypeGuidanceMarkdown,
      evidence: packet.evidence,
      meta: {
        requestId: "req-invalid",
        captureAttemptReport
      }
    });

    for (const rendered of [
      renderWithReport({ worked: "snapshot", didNotWork: ["dom"] }),
      renderWithReport({ worked: ["snapshot"], didNotWork: "dom" }),
      renderWithReport({ worked: ["snapshot", 1], didNotWork: ["dom"] })
    ]) {
      expect(rendered.response.captureAttemptReport).toBeUndefined();
      expect(rendered.response.captureAttemptSummary).toBeUndefined();
      expect(rendered.response.summary).not.toEqual(expect.stringContaining("Capture:"));
    }
  });

  it("omits the prototype guidance file when the packet does not include it", () => {
    const brief = "Design a product detail page";
    const packet = buildInspiredesignPacket({
      brief,
      briefExpansion: makeBriefExpansion({
        sourceBrief: brief,
        advancedBrief: "Selected prompt format: Cinematic product-story or photostudio direction\n\nSource brief:\nDesign a product detail page",
        format: makeBriefFormat({
          id: "cinematic-product-story",
          label: "Cinematic product-story or photostudio direction",
          bestFor: ["product detail pages"],
          route: {
            profile: "cinematic-minimal",
            themeStrategy: "single-theme",
            navigationModel: "immersive",
            layoutApproach: "product-scene-scroll"
          }
        })
      }),
      urls: ["https://example.com/detail"],
      references: [
        makeReference({
          id: "detail-ref",
          url: "https://example.com/detail",
          title: "Detail reference"
        })
      ]
    });

    const rendered = renderInspiredesign({
      mode: "json",
      brief,
      advancedBriefMarkdown: packet.advancedBriefMarkdown,
      urls: ["https://example.com/detail"],
      designContract: packet.designContract,
      canvasPlanRequest: packet.canvasPlanRequest,
      designAgentHandoff: packet.followthrough,
      generationPlan: packet.generationPlan,
      implementationPlan: packet.implementationPlan,
      designMarkdown: packet.designMarkdown,
      implementationPlanMarkdown: packet.implementationPlanMarkdown,
      prototypeGuidanceMarkdown: packet.prototypeGuidanceMarkdown,
      evidence: packet.evidence,
      meta: {}
    });

    expect(packet.generationPlan.visualDirection.profile).toBe("cinematic-minimal");
    expect(packet.followthrough.implementationContext.referenceSynthesis).toMatchObject({
      requiredArtifacts: [
        INSPIREDESIGN_HANDOFF_FILES.evidence,
        INSPIREDESIGN_HANDOFF_FILES.visualEvidence,
        INSPIREDESIGN_HANDOFF_FILES.screenshotIndex,
        INSPIREDESIGN_HANDOFF_FILES.rankedReferences,
        INSPIREDESIGN_HANDOFF_FILES.metaPrompt,
        INSPIREDESIGN_HANDOFF_FILES.advancedBrief,
        INSPIREDESIGN_HANDOFF_FILES.designMarkdown,
        INSPIREDESIGN_HANDOFF_FILES.generationPlan,
        INSPIREDESIGN_HANDOFF_FILES.canvasPlanRequest,
        INSPIREDESIGN_HANDOFF_FILES.designContract,
        INSPIREDESIGN_HANDOFF_FILES.implementationPlanMarkdown
      ]
    });
    expect(rendered.files.some((file) => file.path === INSPIREDESIGN_HANDOFF_FILES.prototypeGuidance)).toBe(false);
    expect(rendered.response).toMatchObject({
      mode: "json",
      prototypeGuidanceMarkdown: null
    });
  });

  it("blocks legacy Canvas command examples when typed guidance is not ready", () => {
    const packet = buildInspiredesignPacket({
      brief: "Create a photography studio landing page",
      briefExpansion: makeBriefExpansion(),
      urls: ["https://example.com/blocked"],
      references: [],
      includePrototypeGuidance: true
    });
    const nextStepGuidance = {
      id: "inspiredesign.harvest.zero_references",
      recipeType: "evidence_recovery",
      workflow: "inspiredesign",
      severity: "warning",
      readiness: "needs_recovery",
      reasonCode: "zero_references",
      primaryAction: {
        id: "recover_reference_evidence",
        label: "Recover reference evidence",
        summary: "Collect usable reference evidence before Canvas."
      },
      commands: [{
        id: "rerun",
        label: "Rerun harvest",
        command: "npx opendevbrowser inspiredesign harvest --brief \"Create a photography studio landing page\""
      }],
      paramsExamples: [],
      fieldExamples: [],
      artifactInputs: [],
      validationChecks: [],
      fallbackPolicy: { allowed: false, requiresUserConfirmation: true, reason: "Do not continue yet." },
      doNotProceedIf: ["reference_count is 0"]
    } satisfies NextStepGuidance;

    const rendered = renderInspiredesign({
      mode: "json",
      brief: "Create a photography studio landing page",
      advancedBriefMarkdown: packet.advancedBriefMarkdown,
      urls: ["https://example.com/blocked"],
      designContract: packet.designContract,
      canvasPlanRequest: packet.canvasPlanRequest,
      designAgentHandoff: packet.followthrough,
      generationPlan: packet.generationPlan,
      implementationPlan: packet.implementationPlan,
      designMarkdown: packet.designMarkdown,
      implementationPlanMarkdown: packet.implementationPlanMarkdown,
      prototypeGuidanceMarkdown: packet.prototypeGuidanceMarkdown,
      evidence: packet.evidence,
      nextStepGuidance,
      meta: {
        primaryConstraintSummary: "Pinterest requires a user-authorized signed-in browser session."
      }
    });
    const response = rendered.response as Record<string, unknown>;
    const responseHandoff = response.designAgentHandoff as {
      artifactGuide: Record<string, { purpose: string; howToUse: string[]; mustNot: string[] }>;
      commandExamples: { continueInCanvas: string };
      summary: string;
    };
    const handoffFile = rendered.files.find((file) => file.path === INSPIREDESIGN_HANDOFF_FILES.designAgentHandoff)?.content as typeof responseHandoff | undefined;

    expect(responseHandoff.commandExamples.continueInCanvas).not.toContain("canvas.plan.set");
    expect(responseHandoff.commandExamples.continueInCanvas).toContain("nextStepGuidance.readiness");
    expect(handoffFile?.commandExamples.continueInCanvas).toBe(responseHandoff.commandExamples.continueInCanvas);
    expect(responseHandoff.summary).toBe(response.followthroughSummary);
    expect(responseHandoff.summary).not.toContain("continue in OpenDevBrowser Canvas");
    expect(responseHandoff.artifactGuide[INSPIREDESIGN_HANDOFF_FILES.canvasPlanRequest]?.purpose).toContain(
      "Diagnostic Canvas request preview"
    );
    expect(responseHandoff.artifactGuide[INSPIREDESIGN_HANDOFF_FILES.canvasPlanRequest]?.mustNot).toContain(
      "Do not submit canvas.plan.set while nextStepGuidance.readiness is not ready."
    );
    expect(handoffFile?.artifactGuide[INSPIREDESIGN_HANDOFF_FILES.canvasPlanRequest]?.purpose).toBe(
      responseHandoff.artifactGuide[INSPIREDESIGN_HANDOFF_FILES.canvasPlanRequest]?.purpose
    );
    expect(response.suggestedNextAction).toBe("Collect usable reference evidence before Canvas.");
    expect(response.followthroughSummary).toBe(
      "Primary constraint: Pinterest requires a user-authorized signed-in browser session. Collect usable reference evidence before Canvas."
    );
    expect(response.prototypeGuidanceMarkdown).toBeNull();
    expect(rendered.files.some((file) => file.path === INSPIREDESIGN_HANDOFF_FILES.prototypeGuidance)).toBe(false);

    const renderedWithoutGuidance = renderInspiredesign({
      mode: "json",
      brief: "Create a photography studio landing page",
      advancedBriefMarkdown: packet.advancedBriefMarkdown,
      urls: ["https://example.com/blocked"],
      designContract: packet.designContract,
      canvasPlanRequest: packet.canvasPlanRequest,
      designAgentHandoff: packet.followthrough,
      generationPlan: packet.generationPlan,
      implementationPlan: packet.implementationPlan,
      designMarkdown: packet.designMarkdown,
      implementationPlanMarkdown: packet.implementationPlanMarkdown,
      prototypeGuidanceMarkdown: packet.prototypeGuidanceMarkdown,
      evidence: packet.evidence,
      meta: {}
    });
    const responseWithoutGuidance = renderedWithoutGuidance.response as Record<string, unknown>;
    const handoffWithoutGuidance = responseWithoutGuidance.designAgentHandoff as { commandExamples: { continueInCanvas: string } };

    expect(handoffWithoutGuidance.commandExamples.continueInCanvas).toBe(
      "Unavailable until nextStepGuidance.readiness is ready."
    );
    expect(responseWithoutGuidance.followthroughSummary).toBe(
      "Canvas continuation unavailable until nextStepGuidance.readiness is ready."
    );
    expect(responseWithoutGuidance.suggestedNextAction).toBe(
      "Canvas continuation unavailable until nextStepGuidance.readiness is ready."
    );
    expect(JSON.stringify(responseWithoutGuidance.designAgentHandoff)).not.toContain("continue in OpenDevBrowser Canvas");
  });

  it.each([
    { readiness: "blocked", reasonCode: "provider_unavailable" },
    { readiness: "needs_recovery", reasonCode: "zero_ranked_references" },
    { readiness: "diagnostic_only", reasonCode: "diagnostic_only" }
  ] as const)("blocks Canvas continuation for $readiness handoff guidance", ({ readiness, reasonCode }) => {
    const packet = buildInspiredesignPacket({
      brief: "Create a photography studio landing page",
      briefExpansion: makeBriefExpansion(),
      urls: ["https://example.com/blocked"],
      references: []
    });
    const nextStepGuidance = {
      id: `inspiredesign.harvest.${reasonCode}`,
      recipeType: "evidence_recovery",
      workflow: "inspiredesign",
      severity: readiness === "blocked" ? "blocked" : "warning",
      readiness,
      reasonCode,
      primaryAction: {
        id: "recover_reference_evidence",
        label: "Recover reference evidence",
        summary: "Collect usable reference evidence before Canvas."
      },
      commands: [{
        id: "rerun",
        label: "Rerun harvest",
        command: "npx opendevbrowser inspiredesign harvest --brief \"Create a photography studio landing page\" --query \"cinematic studio references\""
      }],
      paramsExamples: [],
      fieldExamples: [],
      artifactInputs: [],
      validationChecks: [],
      fallbackPolicy: { allowed: false, requiresUserConfirmation: true, reason: "Do not continue yet." },
      doNotProceedIf: ["reference_count is 0"]
    } satisfies NextStepGuidance;

    const rendered = renderInspiredesign({
      mode: "json",
      brief: "Create a photography studio landing page",
      advancedBriefMarkdown: packet.advancedBriefMarkdown,
      urls: ["https://example.com/blocked"],
      designContract: packet.designContract,
      canvasPlanRequest: packet.canvasPlanRequest,
      designAgentHandoff: packet.followthrough,
      generationPlan: packet.generationPlan,
      implementationPlan: packet.implementationPlan,
      designMarkdown: packet.designMarkdown,
      implementationPlanMarkdown: packet.implementationPlanMarkdown,
      prototypeGuidanceMarkdown: packet.prototypeGuidanceMarkdown,
      evidence: packet.evidence,
      nextStepGuidance,
      meta: {}
    });

    const response = rendered.response as Record<string, unknown>;
    const responseHandoff = response.designAgentHandoff as { commandExamples: { continueInCanvas: string } };
    expect(responseHandoff.commandExamples.continueInCanvas).toBe("Unavailable until nextStepGuidance.readiness is ready.");
  });

  it("does not label Canvas request artifacts as ready when attempted references are diagnostic-only", () => {
    const packet = buildInspiredesignPacket({
      brief: "Create a cinematic design agency studio landing page",
      briefExpansion: makeBriefExpansion(),
      urls: ["https://www.pinterest.com/pin/11188699075430754/"],
      references: [
        makeReference({
          id: "diagnostic-pin",
          url: "https://www.pinterest.com/pin/11188699075430754/",
          title: "Pinterest navigation shell",
          fetchStatus: "failed",
          captureStatus: "captured",
          fetchFailure: "Pinterest requires browser-native follow-up",
          capture: {
            status: "captured",
            kind: "viewport",
            path: "visual-evidence/diagnostic-pin/viewport.png",
            sha256: "a".repeat(64),
            bytes: 64000
          }
        })
      ]
    });

    expect(packet.rankedReferences).toEqual([]);
    expect(packet.designMarkdown).toContain(
      "Diagnostic `canvasPlanRequest` preview; do not submit to Canvas until next-step guidance is ready"
    );
    expect(packet.designMarkdown).not.toContain("Ready-to-fill `canvasPlanRequest` JSON for `canvas.plan.set`");

    const zeroReferenceHarvestPacket = buildInspiredesignPacket({
      brief: "Create a cinematic design agency studio landing page",
      briefExpansion: makeBriefExpansion(),
      urls: [],
      references: [],
      referenceEvidenceRequired: true
    });

    expect(zeroReferenceHarvestPacket.designMarkdown).toContain(
      "Diagnostic `canvasPlanRequest` preview; do not submit to Canvas until next-step guidance is ready"
    );
    expect(zeroReferenceHarvestPacket.designMarkdown).not.toContain(
      "Ready-to-fill `canvasPlanRequest` JSON for `canvas.plan.set`"
    );
  });

  it("handles sparse capture evidence, empty task summaries, and truncated excerpts", () => {
    const longExcerpt = "Quiet editorial cards with disciplined spacing and strong CTA focus. ".repeat(6).trim();
    const expectedExcerpt = `${longExcerpt.slice(0, 217).trimEnd()}...`;
    const packet = buildInspiredesignPacket({
      brief: "   ",
      briefExpansion: makeBriefExpansion({
        sourceBrief: "",
        advancedBrief: "Selected prompt format: Premium editorial landing page\n\nSource brief:\n",
        format: makeBriefFormat({
          bestFor: ["launch pages"]
        })
      }),
      urls: ["https://example.com/minimal"],
      references: [
        makeReference({
          id: "minimal-capture",
          url: "https://example.com/minimal",
          title: "Minimal capture",
          excerpt: longExcerpt,
          captureStatus: "captured",
          capture: {
            title: "Captured title only",
            attempts: {
              snapshot: { status: "captured" },
              clone: { status: "failed", detail: "clone capture timeout" },
              dom: { status: "skipped", detail: "DOM capture helper unavailable in this execution lane." }
            }
          }
        })
      ]
    });

    const evidence = packet.evidence as InspiredesignEvidenceJson;
    const capture = evidence.references[0]?.capture as Record<string, unknown>;

    expect(packet.designContract.intent.task).toBe("");
    expect(packet.advancedBriefMarkdown).toContain("Selected prompt format:");
    expect(packet.designMarkdown).toContain("- Purpose: ");
    expect(packet.designMarkdown).toContain(`layout and hierarchy observations: ${expectedExcerpt}`);
    expect(packet.designMarkdown).not.toContain("Capture warnings:");
    expect(capture).toEqual({
      title: "Captured title only",
      signals: expect.arrayContaining([
        "Minimal capture",
        "Captured title only",
        expect.stringContaining("Quiet editorial cards with disciplined spacing")
      ]),
      attempts: {
        snapshot: {
          status: "failed",
          detail: "Captured artifact was empty after normalization."
        },
        clone: { status: "failed", detail: "clone capture timeout" },
        dom: { status: "skipped", detail: "DOM capture helper unavailable in this execution lane." }
      }
    });
    expect("snapshot" in capture).toBe(false);
    expect("clone" in capture).toBe(false);
  });

  it("treats empty snapshot, DOM, and clone payloads as unusable capture artifacts", () => {
    expect(hasInspiredesignCaptureArtifacts({
      snapshot: {
        content: "   ",
        refCount: 1,
        warnings: []
      },
      dom: {
        outerHTML: "   ",
        truncated: false
      },
      clone: {
        componentPreview: "",
        cssPreview: "   ",
        warnings: []
      }
    })).toBe(false);

    expect(hasInspiredesignCaptureArtifacts({
      clone: {
        componentPreview: "",
        cssPreview: ".hero { display: grid; }",
        warnings: []
      }
    })).toBe(true);
  });

  it("downgrades captured attempts when normalization drops the artifact payload", () => {
    expect(normalizeInspiredesignCaptureEvidence({
      title: "Captured title only",
      snapshot: {
        content: "   ",
        refCount: 1,
        warnings: []
      },
      dom: {
        outerHTML: "",
        truncated: false
      },
      clone: {
        componentPreview: "",
        cssPreview: "   ",
        warnings: []
      },
      attempts: {
        snapshot: { status: "captured" },
        clone: { status: "captured" },
        dom: { status: "captured" }
      }
    })).toEqual({
      title: "Captured title only",
      attempts: {
        snapshot: {
          status: "failed",
          detail: "Captured artifact was empty after normalization."
        },
        clone: {
          status: "failed",
          detail: "Captured artifact was empty after normalization."
        },
        dom: {
          status: "failed",
          detail: "Captured artifact was empty after normalization."
        }
      }
    });
  });
});
