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
} from "../src/providers/inspiredesign-contract";
import {
  INSPIREDESIGN_HANDOFF_COMMANDS,
  INSPIREDESIGN_HANDOFF_FILES,
  INSPIREDESIGN_HANDOFF_GUIDANCE,
  INSPIREDESIGN_HANDOFF_RECOMMENDED_SKILLS,
  buildInspiredesignFollowthroughSummary,
  buildInspiredesignNextStep
} from "../src/inspiredesign/handoff";
import { renderInspiredesign } from "../src/providers/renderer";

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
      generationPlan: packet.generationPlan
    });
    expect(packet.followthrough).toMatchObject({
      summary: buildInspiredesignFollowthroughSummary(),
      nextStep: buildInspiredesignNextStep(),
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
    expect(packet.advancedBriefMarkdown).toContain("Premium editorial landing page");
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
        snapshot: expect.any(Object),
        dom: expect.any(Object),
        clone: expect.any(Object),
        attempts: {
          snapshot: { status: "captured" },
          clone: { status: "captured" },
          dom: { status: "captured" }
        }
      })
    });
    expect(evidence.references[2]).toMatchObject({
      fetchStatus: "skipped",
      captureStatus: "failed",
      fetchFailure: "Manual notes only",
      captureFailure: "Browser capture unavailable"
    });
    expect(packet.designMarkdown).toContain("### Source 1: Docs Home");
    expect(packet.designMarkdown).toContain("Capture warnings: network idle timeout");
    expect(packet.designMarkdown).toContain("Only operator brief context was available for this reference.");
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

    expect(packet.advancedBriefMarkdown).toBe(advancedBrief);
    expect(evidence.advancedBrief).toBe(advancedBrief);
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
        INSPIREDESIGN_HANDOFF_FILES.advancedBrief,
        INSPIREDESIGN_HANDOFF_FILES.designMarkdown,
        INSPIREDESIGN_HANDOFF_FILES.implementationPlanMarkdown,
        INSPIREDESIGN_HANDOFF_FILES.evidence
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
