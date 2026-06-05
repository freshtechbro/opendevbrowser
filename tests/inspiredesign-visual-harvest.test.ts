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
import {
  MIN_PIN_MEDIA_EVIDENCE_BYTES,
  persistInspiredesignPinterestPinMediaEvidence,
  type InspiredesignPersistedPinterestPinMediaEvidence,
  type InspiredesignPinterestPinMediaRuntimeMetadata
} from "../src/inspiredesign/pinterest-pin-media-evidence";
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

const makePinterestPinMediaJpegBytes = (): Buffer => {
  const header = Buffer.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10,
    0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00,
    0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    0x06, 0x40,
    0x04, 0xb0,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9
  ]);
  return Buffer.concat([header, Buffer.alloc(MIN_PIN_MEDIA_EVIDENCE_BYTES + 1 - header.length, 0)]);
};

const makePinterestPinMediaEvidence = (
  overrides: Partial<InspiredesignPinterestPinMediaRuntimeMetadata & InspiredesignPersistedPinterestPinMediaEvidence> = {}
): InspiredesignPersistedPinterestPinMediaEvidence => {
  const metadata = {
    status: "captured" as const,
    kind: "image" as const,
    capturedAt: "2026-05-23T00:00:00.000Z",
    referenceId: "pin-ref",
    url: "https://www.pinterest.com/pin/1234567890/",
    sourceUrl: "https://www.pinterest.com/pin/1234567890/",
    pinterestPageQuality: "pin_media" as const,
    mediaUrl: "https://i.pinimg.com/originals/pin.jpg",
    width: 1200,
    height: 1600,
    contentType: "image/jpeg",
    warnings: [],
    rejectionReasons: [],
    ...overrides
  };
  const shouldInspectBytes = metadata.status === "captured" && overrides.authority !== "diagnostic";
  const basename = metadata.kind === "video_poster" ? "poster" : "main";
  return persistInspiredesignPinterestPinMediaEvidence(
    metadata,
    shouldInspectBytes
      ? { artifactPath: `pin-media-evidence/${metadata.referenceId}/${basename}.jpg`, buffer: makePinterestPinMediaJpegBytes() }
      : {}
  );
};

const makePinterestMotionEvidence = (overrides: Record<string, unknown> = {}) => ({
  status: "captured",
  kind: "screencast",
  capturedAt: "2026-05-23T00:00:00.000Z",
  sourceUrl: "https://www.pinterest.com/pin/1234567890/",
  startedSourceUrl: "https://www.pinterest.com/pin/1234567890/",
  endedSourceUrl: "https://www.pinterest.com/pin/1234567890/",
  pinterestPageQuality: "pin_media",
  startedPinterestPageQuality: "pin_media",
  endedPinterestPageQuality: "pin_media",
  replay: { path: "motion-evidence/pin-ref/replay.json", sha256: "b".repeat(64), bytes: 64 },
  preview: { path: "motion-evidence/pin-ref/preview.png", sha256: "c".repeat(64), bytes: 2048 },
  frameCount: 4,
  warnings: [],
  diagnostic: false,
  diagnosticReasons: [],
  authority: "design_evidence",
  ...overrides
});

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
      sourceUrl: "https://www.pinterest.com/pin/123/",
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
      sourceUrl: "https://www.pinterest.com/pin/123/",
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
      sourceUrl: "ftp://www.pinterest.com/pin/123/",
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

  it("normalizes sparse visual metadata without inventing optional fields", () => {
    const persisted = persistInspiredesignVisualEvidence({
      status: "captured",
      kind: "viewport",
      fullPage: true,
      capturedAt: 42,
      warnings: "not-an-array",
      viewport: {}
    } as unknown as Parameters<typeof persistInspiredesignVisualEvidence>[0], {
      artifactPath: "visual-evidence/ref/full_page.png",
      sha256: VALID_VISUAL_SHA256,
      bytes: 0
    });

    expect(persisted).toEqual({
      status: "captured",
      kind: "viewport",
      fullPage: true,
      capturedAt: "1970-01-01T00:00:00.000Z",
      path: "visual-evidence/ref/full_page.png",
      sha256: VALID_VISUAL_SHA256,
      bytes: 0,
      warnings: []
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
      ["marketplace", "https://elements.envato.com/example", "Sort by Filter by Template kits marketplace"],
      ["marketplace search shell", "https://www.etsy.com/search?q=studio", "Etsy search results for studio"],
      ["single template chrome", "https://elements.envato.com/example", "Envato template kits"],
      ["profile chrome", "https://example.com/profile", "Your profile"]
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

	  it("ranks manifest-ready Pinterest pin media as still-image reference evidence", () => {
	    const reference = {
	      id: "pin-ref",
      url: "https://www.pinterest.com/pin/1234567890/",
      title: "Editorial photography studio pin",
      excerpt: "Full-bleed portrait image with premium studio lighting and clear hero focus.",
      fetchStatus: "captured" as const,
      captureStatus: "captured" as const,
      capture: {
        pinMedia: makePinterestPinMediaEvidence()
      }
    };
    const board = buildInspiredesignReferencePatternBoard(
      "brief-pin-media",
      minimalBriefFormat,
      [reference],
      "Premium digital photography studio landing page"
    );

    expect(hasInspiredesignUsableReferenceEvidence(reference)).toBe(true);
    expect(board.references[0]).toEqual(expect.objectContaining({
      id: "pin-ref",
      evidenceAuthority: "pin_media_ready",
      capturedVia: expect.arrayContaining(["pin_media", "pin_media_ready"]),
      selectionReason: expect.stringContaining("manifest-ready Pinterest pin media evidence")
    }));
    expect(board.references[0]?.capturedVia).not.toContain("motion_ready");
    expect(summarizeInspiredesignReferenceQuality(board)).toEqual(expect.objectContaining({
      rankedReferenceCount: 1,
      missingScreenshotCount: 0,
      allAttemptMissingScreenshotCount: 0,
      allAttemptMotionFailureCount: 0
	    }));
	  });

	  it("keeps first-party pin-media poster proof authoritative through Pinterest login state", () => {
	    const reference = {
	      id: "pin-ref",
	      url: "https://www.pinterest.com/pin/1234567890/",
	      title: "Log in to continue. Editorial photography studio pin.",
	      excerpt: "Full-bleed portrait lighting and premium studio direction.",
	      fetchStatus: "captured" as const,
	      captureStatus: "captured" as const,
	      capture: {
	        pinMedia: makePinterestPinMediaEvidence({ kind: "video_poster" })
	      }
	    };
	    const board = buildInspiredesignReferencePatternBoard(
	      "brief-pin-media-poster",
	      minimalBriefFormat,
	      [reference],
	      "Premium digital photography studio landing page"
	    );

	    expect(hasInspiredesignUsableReferenceEvidence(reference)).toBe(true);
	    expect(board.references[0]).toEqual(expect.objectContaining({
	      id: "pin-ref",
	      evidenceAuthority: "pin_media_ready",
	      capturedVia: expect.arrayContaining(["pin_media", "pin_media_ready"]),
	      selectionReason: expect.stringContaining("manifest-ready Pinterest pin media evidence")
	    }));
	    expect(board.qualitySummary.diagnosticOnlyReasons).toEqual([]);
	  });

	  it("ranks trusted pin media despite surrounding Pinterest chrome shell text", () => {
	    const reference = {
	      id: "pin-ref",
	      url: "https://www.pinterest.com/pin/1234567890/",
	      title: "Search results for studio. Editorial photography studio pin.",
	      excerpt: "Pin card Your profile Related searches and promoted pins with full-bleed portrait lighting.",
	      fetchStatus: "captured" as const,
	      captureStatus: "captured" as const,
	      capture: {
	        pinMedia: makePinterestPinMediaEvidence({
	          sourceUrl: "https://uk.pinterest.com/pin/1234567890/"
	        })
	      }
	    };
	    const board = buildInspiredesignReferencePatternBoard(
	      "brief-pin-media-chrome-shell",
	      minimalBriefFormat,
	      [reference],
	      "Premium digital photography studio landing page"
	    );

	    expect(hasInspiredesignUsableReferenceEvidence(reference)).toBe(true);
	    expect(board.references[0]).toEqual(expect.objectContaining({
	      id: "pin-ref",
	      evidenceAuthority: "pin_media_ready",
	      capturedVia: expect.arrayContaining(["pin_media", "pin_media_ready"])
	    }));
	    expect(board.rejectedReferences).toEqual([]);
	  });

	  it("ranks trusted pin media for locale Pinterest pin URLs", () => {
	    const reference = {
	      id: "pin-ref",
	      url: "https://uk.pinterest.com/pin/1234567890/",
	      title: "Editorial photography studio pin",
	      excerpt: "Full-bleed portrait image with premium studio lighting and clear hero focus.",
	      fetchStatus: "captured" as const,
	      captureStatus: "captured" as const,
	      capture: {
	        pinMedia: makePinterestPinMediaEvidence()
	      }
	    };
	    const board = buildInspiredesignReferencePatternBoard(
	      "brief-locale-pin-media",
	      minimalBriefFormat,
	      [reference],
	      "Premium digital photography studio landing page"
	    );

	    expect(hasInspiredesignUsableReferenceEvidence(reference)).toBe(true);
	    expect(board.references[0]).toEqual(expect.objectContaining({
	      id: "pin-ref",
	      evidenceAuthority: "pin_media_ready",
	      capturedVia: expect.arrayContaining(["pin_media_ready"])
	    }));
	  });

	  it("keeps Pinterest pin-media blocking warnings diagnostic despite trusted-looking bytes", () => {
	    const reference = {
	      id: "pin-ref",
	      url: "https://www.pinterest.com/pin/1234567890/",
	      title: "Search results for studio. Editorial photography studio pin.",
	      excerpt: "Pin card Your profile Related searches and promoted pins with full-bleed portrait lighting.",
	      fetchStatus: "captured" as const,
	      captureStatus: "captured" as const,
	      capture: {
	        pinMedia: makePinterestPinMediaEvidence({ warnings: ["interface_chrome_shell"] })
	      }
	    };
	    const board = buildInspiredesignReferencePatternBoard(
	      "brief-pin-media-search-shell",
	      minimalBriefFormat,
	      [reference],
	      "Premium digital photography studio landing page"
	    );

	    expect(hasInspiredesignUsableReferenceEvidence(reference)).toBe(false);
	    expect(board.references).toEqual([]);
	    expect(board.rejectedReferences[0]).toEqual(expect.objectContaining({
	      id: "pin-ref",
	      diagnosticReasons: expect.arrayContaining(["interface_chrome_shell"]),
	      capturedButRejectedReason: expect.stringContaining("interface_chrome_shell")
	    }));
	  });

	  it("does not rank serialized forged Pinterest pin media as manifest-ready evidence", () => {
	    const forgedPinMedia = JSON.parse(JSON.stringify(makePinterestPinMediaEvidence())) as InspiredesignPersistedPinterestPinMediaEvidence;
    const reference = {
      id: "pin-ref",
      url: "https://www.pinterest.com/pin/1234567890/",
      title: "Editorial photography studio pin",
      excerpt: "Full-bleed portrait image with premium studio lighting and clear hero focus.",
      fetchStatus: "captured" as const,
      captureStatus: "captured" as const,
      capture: {
        pinMedia: forgedPinMedia
      }
    };
    const board = buildInspiredesignReferencePatternBoard(
      "brief-forged-pin-media",
      minimalBriefFormat,
      [reference],
      "Premium digital photography studio landing page"
    );

    expect(hasInspiredesignUsableReferenceEvidence(reference)).toBe(false);
      expect(board.references).toEqual([]);
      expect(board.rejectedReferences[0]).toEqual(expect.objectContaining({
        id: "pin-ref"
      }));
    });

  it("keeps mismatched Pinterest pin-media source proof diagnostic-only", () => {
    const reference = {
      id: "pin-ref",
      url: "https://www.pinterest.com/pin/1234567890/",
      title: "Editorial photography studio pin",
      fetchStatus: "captured" as const,
      captureStatus: "captured" as const,
      capture: {
        pinMedia: makePinterestPinMediaEvidence({
          sourceUrl: "https://www.pinterest.com/pin/9999999999/"
        })
      }
    };
    const board = buildInspiredesignReferencePatternBoard(
      "brief-pin-media-source-mismatch",
      minimalBriefFormat,
      [reference],
      "Premium digital photography studio landing page"
    );

    expect(hasInspiredesignUsableReferenceEvidence(reference)).toBe(false);
    expect(board.references).toEqual([]);
    expect(board.rejectedReferences[0]).toEqual(expect.objectContaining({
      id: "pin-ref"
    }));
  });

  it("describes high-scoring snapshot references as strong text and structural evidence", () => {
    const board = buildInspiredesignReferencePatternBoard("brief-snapshot-text", minimalBriefFormat, [{
      id: "snapshot-text",
      url: "https://example.com/editorial-studio",
      title: "Premium digital photography studio landing page hero CTA website full-bleed service story portfolio gallery",
      excerpt: "Editorial photographer studio with cinematic portrait lighting, conversion CTA, booking flow, service story, proof band, and immersive gallery.",
      fetchStatus: "captured" as const,
      captureStatus: "captured" as const,
      capture: {
        snapshot: {
          content: "Premium digital photography studio landing page with hero CTA, editorial gallery, service story, proof band, and booking conversion flow."
        }
      }
    }], "Premium digital photography studio landing page");

    expect(board.references[0]).toEqual(expect.objectContaining({
      id: "snapshot-text",
      capturedVia: ["fetch", "snapshot"],
      selectionReason: expect.stringContaining("strong text and structural evidence from fetch, snapshot")
    }));
  });

  it("does not describe diagnostic captured pin media as manifest-ready visual strength", () => {
    const reference = {
      id: "pin-ref",
      url: "https://www.pinterest.com/pin/1234567890/",
      title: "Editorial photography studio pin",
      excerpt: "Full-bleed portrait image with premium studio lighting and clear hero focus.",
      fetchStatus: "captured" as const,
      captureStatus: "captured" as const,
      capture: {
        visual: {
          status: "captured" as const,
          sourceUrl: "https://www.pinterest.com/pin/1234567890/",
          pinterestPageQuality: "pin_media" as const,
          path: "visual-evidence/pin-ref/viewport.png",
          sha256: VALID_VISUAL_SHA256,
          bytes: 4096,
          warnings: []
        },
        pinMedia: makePinterestPinMediaEvidence({
          authority: "diagnostic",
          rejectionReasons: ["missing_trusted_byte_inspection"]
        })
      }
    };
    const board = buildInspiredesignReferencePatternBoard(
      "brief-diagnostic-pin-media-strength",
      minimalBriefFormat,
      [reference],
      "Premium digital photography studio landing page"
    );

    expect(board.references[0]?.visualStrengths).toEqual(expect.arrayContaining([
      "Screenshot artifact is available for direct visual inspection."
    ]));
    expect(board.references[0]?.visualStrengths).not.toContain(
      "Manifest-ready Pinterest pin media artifact is available for still-image direction."
    );
  });

  it.each([
    ["failed", makePinterestPinMediaEvidence({ status: "failed", failure: "pin media fetch failed", warnings: ["pin media warning"], rejectionReasons: ["related_pin_candidate"] })],
    ["skipped", makePinterestPinMediaEvidence({ status: "skipped", failure: "pin media skipped", warnings: ["pin media skipped warning"], rejectionReasons: ["no_candidate"] })]
  ])("keeps snapshot-ready evidence when pin-media extraction is %s", (_label, pinMedia) => {
    const reference = {
      id: "pin-ref",
      url: "https://www.pinterest.com/pin/1234567890/",
      title: "Editorial photography studio pin",
      excerpt: "Full-bleed portrait image with premium studio lighting and clear hero focus.",
      fetchStatus: "captured" as const,
      captureStatus: "captured" as const,
      capture: {
        visual: {
          status: "captured" as const,
          sourceUrl: "https://www.pinterest.com/pin/1234567890/",
          pinterestPageQuality: "pin_media" as const,
          path: "visual-evidence/pin-ref/viewport.png",
          sha256: VALID_VISUAL_SHA256,
          bytes: 4096,
          warnings: []
        },
        pinMedia
      }
    };
    const board = buildInspiredesignReferencePatternBoard(
      "brief-snapshot-with-pin-media-failure",
      minimalBriefFormat,
      [reference],
      "Premium digital photography studio landing page"
    );

    expect(hasInspiredesignUsableReferenceEvidence(reference)).toBe(true);
    expect(board.references[0]).toEqual(expect.objectContaining({
      id: "pin-ref",
      evidenceAuthority: "snapshot_ready",
      capturedVia: expect.arrayContaining(["visual", "snapshot_ready"])
    }));
  });

  it.each([
    ["failed", makePinterestPinMediaEvidence({ status: "failed", failure: "pin media fetch failed", warnings: ["pin media warning"], rejectionReasons: ["related_pin_candidate"] })],
    ["skipped", makePinterestPinMediaEvidence({ status: "skipped", failure: "pin media skipped", warnings: ["pin media skipped warning"], rejectionReasons: ["no_candidate"] })]
  ])("keeps motion-ready evidence when pin-media extraction is %s", (_label, pinMedia) => {
    const reference = {
      id: "pin-ref",
      url: "https://www.pinterest.com/pin/1234567890/",
      title: "Cinematic product reveal motion reference",
      excerpt: "Premium motion-led product story with editorial landing page pacing.",
      fetchStatus: "captured" as const,
      captureStatus: "captured" as const,
      capture: {
        motion: makePinterestMotionEvidence(),
        pinMedia
      }
    };
    const board = buildInspiredesignReferencePatternBoard(
      "brief-motion-with-pin-media-failure",
      minimalBriefFormat,
      [reference],
      "Premium motion-led landing page"
    );

    expect(hasInspiredesignUsableReferenceEvidence(reference)).toBe(true);
    expect(board.references[0]).toEqual(expect.objectContaining({
      id: "pin-ref",
      evidenceAuthority: "motion_ready",
      capturedVia: expect.arrayContaining(["motion", "motion_ready"])
    }));
  });

  it("keeps motion authority when motion-ready and pin-media-ready evidence are both present", () => {
    const reference = {
      id: "pin-ref",
      url: "https://www.pinterest.com/pin/1234567890/",
      title: "Cinematic product reveal motion reference",
      excerpt: "Premium motion-led product story with editorial landing page pacing.",
      fetchStatus: "captured" as const,
      captureStatus: "captured" as const,
      capture: {
        motion: makePinterestMotionEvidence(),
        pinMedia: makePinterestPinMediaEvidence()
      }
    };
    const board = buildInspiredesignReferencePatternBoard(
      "brief-motion-and-pin-media",
      minimalBriefFormat,
      [reference],
      "Premium motion-led landing page"
    );

    expect(hasInspiredesignUsableReferenceEvidence(reference)).toBe(true);
    expect(board.references[0]).toEqual(expect.objectContaining({
      id: "pin-ref",
      evidenceAuthority: "motion_ready",
      capturedVia: expect.arrayContaining(["motion_ready", "pin_media_ready"])
    }));
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
