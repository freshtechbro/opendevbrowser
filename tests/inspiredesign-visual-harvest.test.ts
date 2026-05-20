import { describe, expect, it } from "vitest";
import {
  buildVisualEvidenceArtifactPath,
  hashVisualEvidenceBuffer,
  isInspiredesignVisualEvidenceKind,
  isInspiredesignVisualEvidenceMode,
  sanitizeInspiredesignVisualReferenceId,
  persistInspiredesignVisualEvidence
} from "../src/inspiredesign/visual-evidence";
import { decideInspiredesignVisualCapturePolicy } from "../src/inspiredesign/visual-policy";
import {
  mergeInspiredesignReferenceUrls,
  normalizeInspiredesignDiscoveryRecords,
  normalizeInspiredesignProviders
} from "../src/inspiredesign/reference-discovery";
import type { InspiredesignBriefFormat } from "../src/inspiredesign/brief-expansion";
import {
  buildInspiredesignDesignVectors,
  buildInspiredesignReferencePatternBoard,
  hasInspiredesignUsableReferenceEvidence,
  summarizeInspiredesignReferenceQuality
} from "../src/inspiredesign/reference-pattern-board";
import type { NormalizedRecord, ProviderFailureEntry, ProviderSource } from "../src/providers/types";

const makeRecord = (url: string | undefined, provider = "web/default"): NormalizedRecord => ({
  id: `record-${provider}-${url ?? "missing"}`,
  source: "web",
  provider,
  ...(url ? { url } : {}),
  title: `Title ${url ?? "missing"}`,
  content: "Reference content",
  timestamp: "2026-05-18T00:00:00.000Z",
  confidence: 0.9,
  attributes: {}
});

const makeFailure = (reasonCode: ProviderFailureEntry["error"]["reasonCode"]): ProviderFailureEntry => ({
  provider: "web/default",
  source: "web" as ProviderSource,
  error: {
    code: "unavailable",
    message: "blocked",
    retryable: false,
    ...(reasonCode ? { reasonCode } : {})
  }
});

const VALID_VISUAL_SHA256 = "a".repeat(64);

const minimalBriefFormat: InspiredesignBriefFormat = {
  id: "minimal",
  label: "Minimal",
  keywords: ["and"],
  bestFor: ["for"],
  businessFocus: ["landing"],
  archetype: "site",
  layoutArchetype: "page",
  surfaceTreatment: "design",
  shapeLanguage: "rectangular",
  paletteIntent: "with",
  typographySystem: "editorial serif with grotesk support",
  motionGrammar: "scroll reveal",
  componentGrammar: "hero, proof, services, and CTA",
  visualDensity: "airy",
  designVariance: "balanced",
  responsiveCollapseRules: ["Collapse to one column."],
  guardrails: ["Keep evidence first."],
  antiPatterns: ["Do not use generic cards."],
  deliverables: ["Design contract."],
  route: {
    profile: "product-story",
    themeStrategy: "single-theme",
    navigationModel: "global-header",
    layoutApproach: "editorial-hero-sequence"
  }
};

describe("inspiredesign visual evidence helpers", () => {
  it("builds deterministic artifact paths and hashes buffers", () => {
    expect(buildVisualEvidenceArtifactPath("Reference A/?*", "viewport")).toBe("visual-evidence/Reference-A/viewport.png");
    expect(hashVisualEvidenceBuffer(Buffer.from("png bytes"))).toHaveLength(64);
  });

  it("validates visual evidence modes and sanitizes empty reference ids", () => {
    expect(isInspiredesignVisualEvidenceMode("auto")).toBe(true);
    expect(isInspiredesignVisualEvidenceMode("required")).toBe(true);
    expect(isInspiredesignVisualEvidenceMode("visual")).toBe(false);
    expect(isInspiredesignVisualEvidenceMode(null)).toBe(false);
    expect(isInspiredesignVisualEvidenceKind("viewport")).toBe(true);
    expect(isInspiredesignVisualEvidenceKind("../viewport")).toBe(false);
    expect(sanitizeInspiredesignVisualReferenceId(" *** ")).toBe("reference");
    expect(sanitizeInspiredesignVisualReferenceId(".")).toBe("reference");
    expect(sanitizeInspiredesignVisualReferenceId("..")).toBe("reference");
    expect(sanitizeInspiredesignVisualReferenceId(`${".".repeat(120)}safe`)).toBe("reference");
    expect(buildVisualEvidenceArtifactPath("..", "viewport")).toBe("visual-evidence/reference/viewport.png");
  });

  it("persists visual metadata without temp paths or raw image data", () => {
    const persisted = persistInspiredesignVisualEvidence({
      status: "captured",
      kind: "viewport",
      fullPage: false,
      capturedAt: "2026-05-18T00:00:00.000Z",
      tempPath: "/tmp/private/reference.png",
      warnings: ["cdp fallback"],
      viewport: { width: 1440, height: 900 }
    }, {
      artifactPath: "visual-evidence/ref/viewport.png",
      sha256: VALID_VISUAL_SHA256,
      bytes: 42
    });

    expect(persisted).toEqual({
      status: "captured",
      kind: "viewport",
      fullPage: false,
      capturedAt: "2026-05-18T00:00:00.000Z",
      path: "visual-evidence/ref/viewport.png",
      sha256: VALID_VISUAL_SHA256,
      bytes: 42,
      viewport: { width: 1440, height: 900 },
      warnings: ["cdp fallback"]
    });
    expect(JSON.stringify(persisted)).not.toContain("/tmp/private");
  });

  it("sanitizes hostile visual metadata before persistence", () => {
    const persisted = persistInspiredesignVisualEvidence({
      status: "captured",
      kind: "../evil" as "viewport",
      fullPage: false,
      capturedAt: "/tmp/private/captured-at.png",
      artifactPath: "../outside.png",
      path: "visual-evidence/../viewport.png",
      sha256: "abc123",
      bytes: Number.POSITIVE_INFINITY,
      warnings: [
        "cdp fallback",
        "/tmp/private/reference.png",
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ"
      ],
      failure: "read /tmp/private/reference.png failed",
      viewport: {
        width: 1440,
        height: "900",
        deviceScaleFactor: 2
      }
    } as unknown as Parameters<typeof persistInspiredesignVisualEvidence>[0]);

    expect(persisted).toEqual({
      status: "captured",
      kind: "viewport",
      fullPage: false,
      capturedAt: "1970-01-01T00:00:00.000Z",
      viewport: { width: 1440, deviceScaleFactor: 2 },
      warnings: ["cdp fallback"]
    });
    const json = JSON.stringify(persisted);
    expect(json).not.toContain("/tmp/private");
    expect(json).not.toContain("base64");
    expect(json).not.toContain("../outside");
  });

  it("omits artifact paths for failed visual metadata", () => {
    const persisted = persistInspiredesignVisualEvidence({
      status: "failed",
      kind: "viewport",
      fullPage: false,
      capturedAt: "2026-05-18T00:00:00.000Z",
      artifactPath: "visual-evidence/ref/viewport.png",
      warnings: ["required_visual_evidence_missing"],
      failure: "Required visual evidence was not captured."
    });

    expect(persisted).toEqual({
      status: "failed",
      kind: "viewport",
      fullPage: false,
      capturedAt: "2026-05-18T00:00:00.000Z",
      warnings: ["required_visual_evidence_missing"],
      failure: "Required visual evidence was not captured."
    });
  });
});

describe("inspiredesign visual policy helpers", () => {
  it("skips visual capture when visual evidence is off", () => {
    expect(decideInspiredesignVisualCapturePolicy({ visualEvidence: "off" })).toEqual({
      status: "skipped",
      reason: "visual_evidence_off",
      message: "Visual evidence is disabled for this run."
    });
  });

  it("skips required visual capture for provider blockers", () => {
    expect(decideInspiredesignVisualCapturePolicy({
      visualEvidence: "required",
      failures: [makeFailure("auth_required")]
    })).toEqual({
      status: "skipped",
      reason: "auth_required",
      message: "Visual capture skipped because authenticated access is unresolved."
    });
  });

  it("skips optional visual capture for top-level blockers", () => {
    expect(decideInspiredesignVisualCapturePolicy({
      visualEvidence: "auto",
      topLevelError: {
        code: "rate_limited",
        message: "slow down",
        retryable: true,
        reasonCode: "rate_limited"
      }
    })).toEqual({
      status: "skipped",
      reason: "rate_limited",
      message: "Visual capture skipped because the provider is rate limited."
    });
  });

  it("continues past failures without reason codes and reports challenge blockers", () => {
    expect(decideInspiredesignVisualCapturePolicy({
      visualEvidence: "required",
      failures: [makeFailure(undefined), makeFailure("challenge_detected")]
    })).toEqual({
      status: "skipped",
      reason: "challenge_detected",
      message: "Visual capture skipped because a challenge was detected."
    });
  });

  it("allows visual capture when there are no blocker reasons", () => {
    expect(decideInspiredesignVisualCapturePolicy({
      visualEvidence: "auto",
      failures: [makeFailure("env_limited")]
    })).toEqual({
      status: "allowed",
      reason: "visual_capture_allowed",
      message: "Visual capture is allowed for this reference."
    });
  });

  it("allows visual capture for partial successes with usable records", () => {
    expect(decideInspiredesignVisualCapturePolicy({
      visualEvidence: "required",
      failures: [makeFailure("auth_required")],
      hasUsableRecords: true
    })).toEqual({
      status: "allowed",
      reason: "visual_capture_allowed",
      message: "Visual capture is allowed for this reference."
    });
  });
});

describe("inspiredesign reference discovery helpers", () => {
  it("rejects invalid candidates and duplicate URLs", () => {
    const result = normalizeInspiredesignDiscoveryRecords([
      makeRecord(" https://example.com/a#hero "),
      makeRecord("notaurl"),
      makeRecord(undefined),
      makeRecord("https://example.com/a")
    ]);

    expect(result.accepted.map((candidate) => candidate.url)).toEqual(["https://example.com/a"]);
    expect(result.rejected.map((candidate) => candidate.reason)).toEqual([
      "invalid_url",
      "missing_url",
      "duplicate_url"
    ]);
  });

  it("rejects unsupported schemes and records candidates without titles", () => {
    const result = normalizeInspiredesignDiscoveryRecords([
      { ...makeRecord("ftp://example.com/file"), title: undefined },
      { ...makeRecord("   "), title: undefined },
      { ...makeRecord("https://example.com/no-title"), title: undefined }
    ]);

    expect(result.rejected[0]).toEqual(expect.objectContaining({
      reason: "invalid_url",
      rawUrl: "ftp://example.com/file"
    }));
    expect(result.rejected[1]).toEqual(expect.objectContaining({
      reason: "missing_url"
    }));
    expect(result.accepted[0]).toEqual(expect.objectContaining({
      url: "https://example.com/no-title",
      rank: 3
    }));
    expect("title" in result.accepted[0]!).toBe(false);
  });

  it("merges explicit URLs before discovered URLs and normalizes providers", () => {
    expect(mergeInspiredesignReferenceUrls(
      ["https://example.com/explicit", "https://example.com/shared", "notaurl"],
      ["https://example.com/shared", "https://example.com/discovered", "https://root.example.com/"],
      3
    )).toEqual([
      "https://example.com/explicit",
      "https://example.com/shared",
      "https://example.com/discovered"
    ]);
    expect(normalizeInspiredesignProviders([" web/default ", "web/default", "community/reddit"])).toEqual([
      "web/default",
      "community/reddit"
    ]);
  });

  it.each([
    ["404", "https://www.etsy.com/listing/missing", "404 Page not found"],
    ["cookie", "https://themeforest.net/item/example", "Accept all cookies to continue"],
    ["login", "https://www.pinterest.com/pin/example", "Sign in to continue"],
    ["search shell", "https://www.pinterest.com/search/pins/?q=studio", "Search results for studio Pin card Your profile"],
    ["marketplace", "https://elements.envato.com/example", "Sort by Filter by Template kits marketplace"]
  ])("rejects %s references as unusable creative evidence", (_label, url, content) => {
    expect(hasInspiredesignUsableReferenceEvidence({
      id: "ref",
      url,
      title: content,
      excerpt: content,
      fetchStatus: "captured",
      captureStatus: "captured",
      capture: {
        title: content,
        snapshot: { content },
        visual: {
          status: "captured",
          path: "visual-evidence/ref/viewport.png",
          sha256: VALID_VISUAL_SHA256,
          bytes: 10,
          warnings: []
        }
      }
    })).toBe(false);
  });

  it("keeps single commerce markers usable when the reference has creative landing-page evidence", () => {
    const content = "Luxury product studio hero with editorial photography, add to cart interaction, and immersive service story.";

    expect(hasInspiredesignUsableReferenceEvidence({
      id: "commerce-landing",
      url: "https://example.com/product-studio",
      title: content,
      excerpt: content,
      fetchStatus: "captured",
      captureStatus: "captured",
      capture: {
        title: content,
        snapshot: { content },
        visual: {
          status: "captured",
          path: "visual-evidence/commerce-landing/viewport.png",
          sha256: VALID_VISUAL_SHA256,
          bytes: 10,
          warnings: []
        }
      }
    })).toBe(true);
  });

  it("builds pattern boards with empty-intent matching, deterministic URL tie-breaks, and failed-reference reasons", () => {
    const board = buildInspiredesignReferencePatternBoard("brief-empty-intent", minimalBriefFormat, [
      {
        id: "tie",
        url: "https://example.com/b",
        title: "Hero CTA website",
        excerpt: "Full-bleed hero with website CTA and editorial proof.",
        fetchStatus: "captured",
        captureStatus: "captured",
        capture: {
          title: "Hero CTA website",
          snapshot: { content: "Hero CTA website with full-bleed image and proof section." },
          visual: {
            status: "captured",
            path: "visual-evidence/tie-b/viewport.png",
            sha256: VALID_VISUAL_SHA256,
            bytes: 10,
            warnings: []
          }
        }
      },
      {
        id: "tie",
        url: "https://example.com/a",
        title: "Hero CTA website",
        excerpt: "Full-bleed hero with website CTA and editorial proof.",
        fetchStatus: "captured",
        captureStatus: "captured",
        capture: {
          title: "Hero CTA website",
          snapshot: { content: "Hero CTA website with full-bleed image and proof section." },
          visual: {
            status: "captured",
            path: "visual-evidence/tie-a/viewport.png",
            sha256: VALID_VISUAL_SHA256,
            bytes: 10,
            warnings: []
          }
        }
      },
      {
        id: "failed",
        url: "https://example.com/failed",
        fetchStatus: "failed",
        captureStatus: "failed"
      }
    ]);
    const vectors = buildInspiredesignDesignVectors(minimalBriefFormat, board);
    const textEvidenceBoard = buildInspiredesignReferencePatternBoard("brief-text-evidence", minimalBriefFormat, [{
      id: "text-reference",
      url: "https://example.com/text-reference",
      title: "Hero CTA website",
      excerpt: "Full-bleed hero with website CTA and editorial proof.",
      fetchStatus: "captured",
      captureStatus: "captured",
      capture: {
        title: "Hero CTA website",
        snapshot: { content: "Hero CTA website with full-bleed image, CTA, website navigation, and proof section." },
        dom: { outerHTML: "<main><section>Hero CTA website proof section</section></main>" },
        clone: {
          componentPreview: "<main><section>Hero CTA website proof section</section></main>",
          cssPreview: ".hero { display: grid; }"
        }
      }
    }]);

    expect(board.references.map((entry) => entry.url)).toEqual([
      "https://example.com/a",
      "https://example.com/b"
    ]);
    expect(textEvidenceBoard.references[0]?.selectionReason).toContain("strong text and structural evidence");
    expect(board.targetSurface).toBe("reference-led public landing page");
    expect(board.rejectedReferences[0]?.reason).toBe("Fetch and capture did not produce usable creative evidence.");
    expect(summarizeInspiredesignReferenceQuality(board)).toMatchObject({
      rankedReferenceCount: 2,
      rejectedReferenceCount: 1,
      failedCaptureCount: 0,
      missingScreenshotCount: 0
    });
    expect(vectors.sourcePriority).toBe("reference-evidence-first");
    expect(vectors.surfaceIntent).toBe("reference-led public landing page");
  });

  it("preserves high-scoring off-brief reference intent in quality summary", () => {
    const board = buildInspiredesignReferencePatternBoard("brief-off-intent", minimalBriefFormat, [{
      id: "off-brief",
      url: "https://example.com/off-brief",
      title: "Ceramic kiln inventory module",
      excerpt: "Glaze recipes, firing schedules, clay batches, and warehouse inventory.",
      fetchStatus: "captured",
      captureStatus: "captured",
      capture: {
        title: "Ceramic kiln inventory module",
        snapshot: { content: "Glaze recipes, firing schedules, clay batches, and warehouse inventory." },
        dom: { outerHTML: "<main><section>Glaze recipes and kiln inventory</section></main>" },
        clone: {
          componentPreview: "<main><section>Glaze recipes and kiln inventory</section></main>",
          cssPreview: ".kiln { display: grid; }"
        },
        visual: {
          status: "captured",
          path: "visual-evidence/off-brief/viewport.png",
          sha256: VALID_VISUAL_SHA256,
          bytes: 10,
          warnings: []
        }
      }
    }], "Premium digital photography studio landing page");
    const quality = summarizeInspiredesignReferenceQuality(board);

    expect(board.references[0]?.intentMatched).toBe(false);
    expect(board.references[0]?.score).toBeLessThan(50);
    expect(quality.topReferenceIntentMatched).toBe(false);
  });

  it("requires more than broad style adjectives to match brief intent", () => {
    const board = buildInspiredesignReferencePatternBoard("brief-style-only", minimalBriefFormat, [{
      id: "style-only",
      url: "https://example.com/style-only",
      title: "Premium digital cinematic portfolio",
      excerpt: "Premium digital cinematic parallax motion and dark theme.",
      fetchStatus: "captured",
      captureStatus: "captured",
      capture: {
        title: "Premium digital cinematic portfolio",
        snapshot: { content: "Premium digital cinematic parallax motion and dark theme." },
        visual: {
          status: "captured",
          path: "visual-evidence/style-only/viewport.png",
          sha256: VALID_VISUAL_SHA256,
          bytes: 10,
          warnings: []
        }
      }
    }], "Premium digital photography studio landing page with cinematic parallax");

    expect(board.references[0]?.intentMatched).toBe(false);
    expect(summarizeInspiredesignReferenceQuality(board).topReferenceIntentMatched).toBe(false);
  });

  it("matches photography studio brief intent with related photo vocabulary", () => {
    const board = buildInspiredesignReferencePatternBoard("brief-photo", minimalBriefFormat, [{
      id: "photo-studio",
      url: "https://example.com/photo-studio",
      title: "Editorial photographer studio portfolio",
      excerpt: "A photographer studio portfolio with campaign galleries and client proof.",
      fetchStatus: "captured",
      captureStatus: "captured",
      capture: {
        title: "Editorial photographer studio portfolio",
        snapshot: { content: "A photographer studio portfolio with campaign galleries and client proof." },
        visual: {
          status: "captured",
          path: "visual-evidence/photo-studio/viewport.png",
          sha256: VALID_VISUAL_SHA256,
          bytes: 10,
          warnings: []
        }
      }
    }], "Premium digital photography studio landing page");

    expect(board.references[0]?.intentMatched).toBe(true);
  });

  it("treats references as intent-matched when the brief and format have no intent tokens", () => {
    const emptyIntentFormat: InspiredesignBriefFormat = {
      ...minimalBriefFormat,
      keywords: [],
      bestFor: [],
      businessFocus: [],
      archetype: "",
      layoutArchetype: "",
      surfaceTreatment: "",
      shapeLanguage: "",
      paletteIntent: "",
      typographySystem: "",
      motionGrammar: "",
      componentGrammar: "",
      visualDensity: "",
      designVariance: "",
      responsiveCollapseRules: [],
      guardrails: [],
      antiPatterns: [],
      deliverables: []
    };
    const board = buildInspiredesignReferencePatternBoard("", emptyIntentFormat, [{
      id: "unscoped-reference",
      url: "https://example.com/unscoped",
      title: "Atmospheric editorial hero with cinematic pacing",
      excerpt: "Full-bleed hero with immersive image treatment and clear CTA.",
      fetchStatus: "captured",
      captureStatus: "captured",
      capture: {
        title: "Atmospheric editorial hero",
        snapshot: { content: "Full-bleed hero with immersive image treatment and clear CTA." },
        visual: {
          status: "captured",
          path: "visual-evidence/unscoped-reference/viewport.png",
          sha256: VALID_VISUAL_SHA256,
          bytes: 10,
          warnings: []
        }
      }
    }]);

    expect(board.references[0]?.intentMatched).toBe(true);
  });

  it("does not let generic format tokens override a mismatched source brief", () => {
    const board = buildInspiredesignReferencePatternBoard("brief-mismatch", {
      ...minimalBriefFormat,
      businessFocus: ["documentation"],
      surfaceTreatment: "documentation"
    }, [{
      id: "example-domain",
      url: "https://example.com",
      title: "Example Domain",
      excerpt: "This domain is for use in documentation examples without needing permission. Learn more.",
      fetchStatus: "captured",
      captureStatus: "captured",
      capture: {
        title: "Example Domain",
        snapshot: { content: "Example Domain documentation examples Learn more." },
        visual: {
          status: "captured",
          path: "visual-evidence/example-domain/viewport.png",
          sha256: VALID_VISUAL_SHA256,
          bytes: 10,
          warnings: []
        }
      }
    }], "Premium digital photography studio landing page");

    expect(board.references[0]?.intentMatched).toBe(false);
    expect(summarizeInspiredesignReferenceQuality(board).topReferenceIntentMatched).toBe(false);
  });
});
