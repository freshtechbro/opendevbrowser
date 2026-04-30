import { describe, expect, it } from "vitest";
import type {
  InspiredesignBriefExpansion,
  InspiredesignBriefFormat
} from "../src/inspiredesign/brief-expansion";
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
      capturedVia: string[];
      layoutRecipe: string;
      patternsToBorrow: string[];
      patternsToReject: string[];
    }>;
    synthesis: {
      dominantDirection: string;
      sharedStrengths: string[];
      contractDeltas: string[];
    };
  };
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
    expect(packet.designContract.intent.referenceCount).toBe(3);
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
    expect(packet.followthrough.implementationContext.referenceSynthesis.requiredArtifacts.slice(0, 3)).toEqual([
      "evidence.json",
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
    expect(packet.advancedBriefMarkdown).toContain(
      "https://example.com/protected: fetch=failed, capture=failed, reason=Authentication required"
    );
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
        expect((rendered.response.suggestedSteps as Array<Record<string, unknown>>)[3]?.reason).toBe(
          INSPIREDESIGN_HANDOFF_GUIDANCE.prepareCanvasPlanRequest
        );
        expect((rendered.response.suggestedSteps as Array<Record<string, unknown>>)[3]?.command).toBe(
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
          designAgentHandoff: packet.followthrough,
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
            designAgentHandoff: packet.followthrough
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
