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
import type { InspiredesignMediaAnalysis } from "../src/inspiredesign/media-analysis";
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
  type InspiredesignPinterestPinMediaIndexEntry,
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

const makePinterestPinMediaMp4Bytes = (): Buffer => {
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
  tkhd.writeUInt32BE(720 * 65_536, 84);
  tkhd.writeUInt32BE(1280 * 65_536, 88);
  const trak = Buffer.alloc(100, 0);
  trak.writeUInt32BE(100, 0);
  trak.write("trak", 4, "ascii");
  tkhd.copy(trak, 8);
  const moov = Buffer.alloc(108, 0);
  moov.writeUInt32BE(108, 0);
  moov.write("moov", 4, "ascii");
  trak.copy(moov, 8);
  const media = Buffer.concat([ftyp, moov]);
  return Buffer.concat([media, Buffer.alloc(MIN_PIN_MEDIA_EVIDENCE_BYTES + 1 - media.length, 0)]);
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
  const isVideo = metadata.kind === "video";
  const basename = isVideo ? "video" : metadata.kind === "video_poster" ? "poster" : "main";
  const extension = isVideo ? "mp4" : "jpg";
  const buffer = isVideo ? makePinterestPinMediaMp4Bytes() : makePinterestPinMediaJpegBytes();
  return persistInspiredesignPinterestPinMediaEvidence(
    metadata,
    shouldInspectBytes
      ? { artifactPath: `pin-media-evidence/${metadata.referenceId}/${basename}.${extension}`, buffer }
      : {}
  );
};

const makePinterestPinMediaIndexEntry = (
  evidence: InspiredesignPersistedPinterestPinMediaEvidence
): InspiredesignPinterestPinMediaIndexEntry => {
  if (!evidence.path || !evidence.sha256 || !evidence.bytes || !evidence.width || !evidence.height || !evidence.contentType || !evidence.mediaUrl) {
    throw new Error("Expected complete pin-media evidence for index fixture.");
  }
  return {
    referenceId: evidence.referenceId,
    url: evidence.url,
    sourceUrl: evidence.sourceUrl ?? evidence.url,
    mediaUrl: evidence.mediaUrl,
    pinterestPageQuality: evidence.pinterestPageQuality ?? "pin_media",
    path: evidence.path,
    sha256: evidence.sha256,
    bytes: evidence.bytes,
    width: evidence.width,
    height: evidence.height,
    contentType: evidence.contentType,
    kind: evidence.kind,
    authority: "design_evidence",
    capturedAt: evidence.capturedAt,
    ...(evidence.candidateSelector ? { candidateSelector: evidence.candidateSelector } : {}),
    ...(evidence.candidateRole ? { candidateRole: evidence.candidateRole } : {}),
    ...(evidence.candidateAlt ? { candidateAlt: evidence.candidateAlt } : {}),
    warnings: evidence.warnings,
    firstPartyProvenance: evidence.firstPartyProvenance
  };
};

const makeInspiredesignMediaAnalysis = (
  overrides: Partial<InspiredesignMediaAnalysis["references"][number]> = {}
): InspiredesignMediaAnalysis => {
	const trustedPinMedia = makePinterestPinMediaEvidence();
	return {
  version: 1,
  generatedAt: "2026-06-06T00:00:00.000Z",
  nonGoals: ["Readable exact text extraction is not part of v1."],
  references: [{
    referenceId: "pin-ref",
	mediaPath: trustedPinMedia.path ?? "pin-media-evidence/pin-ref/main.jpg",
    sourceUrl: "https://www.pinterest.com/pin/1234567890/",
    mediaUrl: "https://i.pinimg.com/originals/pin.jpg",
    kind: "image",
	contentType: trustedPinMedia.contentType,
	bytes: trustedPinMedia.bytes,
	hash: trustedPinMedia.sha256,
	dimensions: { width: trustedPinMedia.width ?? 1200, height: trustedPinMedia.height ?? 1600, aspectRatio: 0.75 },
    authority: "design_evidence",
    claimLevels: ["metadata_only", "pixel_stats", "palette_quantized", "layout_heuristic", "typography_structure", "text_region_layout"],
    facts: {},
    designGuidance: {
      visualStrengths: [
        "high contrast with 85 percent dark coverage and sparse edge density.",
        "Quantized palette led by #080808, #141414, #8E8E8E.",
        "Layout heuristic reads as left-weighted split hero.",
        "OCR-free typography structure detected 5 role candidate regions."
      ],
      visualRisks: ["Readable exact text extraction was not performed, so exact copy strings are unavailable."],
      layoutRecipe: "left-weighted split hero with lower portfolio grid.",
      contentHierarchy: [
        "nav_row_candidate from OCR-free text-region geometry",
        "hero_headline_candidate from OCR-free text-region geometry",
        "cta_cluster_candidate from OCR-free text-region geometry"
      ],
      componentFamilies: ["hero", "CTA cluster", "portfolio grid or card set"],
      motionPosture: "Static source only, use still-image adaptation such as reveal, fade, or hover exposure shift.",
      tokenNotes: [
        "#080808 as background at 49 percent coverage",
        "#8E8E8E as muted foreground at 5 percent coverage",
        "high contrast posture, mean luminance 23.41."
      ],
      patternsToBorrow: [
        "left-weighted split hero with lower portfolio grid.",
        "dark-dominant cinematic canvas with sparse bright controls",
        "OCR-free typography hierarchy using measured role candidates"
      ],
      patternsToReject: [
        "generic route-default direction that ignores measured media facts",
        "claiming exact headlines, nav labels, CTA copy, or font families from v1 media analysis"
      ],
      typographyPosture: "sparse, high-contrast, editorial, left-weighted; exact readable text unavailable",
      imageryPosture: "dark-dominant, high contrast, sparse detail posture",
      confidence: 0.86
    },
    confidence: 0.86,
    limitations: ["Exact readable text extraction was not performed."],
    ...overrides
  }]
	};
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
      ["profile chrome", "https://example.com/profile", "Your profile"],
      ["Adobe chrome", "https://example.com/company", "Adobe, Inc."],
      ["Dribbble chrome", "https://example.com/community", "Dribbble: the community for graphic design"],
      ["Dribbble promotional chrome", "https://example.com/community", "Get 20% off Dribbble Pro. Dribbble: the community for graphic design"],
      ["WordPress theme chrome", "https://example.com/themes", "Our free WordPress themes are downloaded every day. Get them now"]
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
    const pinMediaIndex = [makePinterestPinMediaIndexEntry(reference.capture.pinMedia)];
    const board = buildInspiredesignReferencePatternBoard(
      "brief-pin-media",
      minimalBriefFormat,
      [reference],
      "Premium digital photography studio landing page",
      undefined,
      pinMediaIndex
    );

    expect(hasInspiredesignUsableReferenceEvidence(reference, pinMediaIndex)).toBe(true);
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

  it("does not let duplicate reference ids corrupt ranked pin-media readiness counts", () => {
    const readyUrl = "https://www.pinterest.com/pin/1234567890/";
    const diagnosticUrl = "https://www.pinterest.com/pin/9999999999/";
    const pinMedia = makePinterestPinMediaEvidence({
      referenceId: "shared-pin-ref",
      url: readyUrl,
      sourceUrl: readyUrl
    });
    const pinMediaIndex = [makePinterestPinMediaIndexEntry(pinMedia)];
    const board = buildInspiredesignReferencePatternBoard(
      "brief-duplicate-pin-media",
      minimalBriefFormat,
      [
        {
          id: "shared-pin-ref",
          url: readyUrl,
          title: "Editorial photography studio pin",
          excerpt: "Full-bleed portrait image with premium studio lighting and clear hero focus.",
          fetchStatus: "captured" as const,
          captureStatus: "captured" as const,
          capture: { pinMedia }
        },
        {
          id: "shared-pin-ref",
          url: diagnosticUrl,
          title: "Pinterest shell sibling",
          excerpt: "Interface shell without saved design evidence.",
          fetchStatus: "captured" as const,
          captureStatus: "off" as const
        }
      ],
      "Premium digital photography studio landing page",
      undefined,
      pinMediaIndex
    );

    expect(board.references).toHaveLength(1);
    expect(board.references[0]).toEqual(expect.objectContaining({
      url: readyUrl,
      evidenceAuthority: "pin_media_ready",
      mediaArtifactPath: "pin-media-evidence/shared-pin-ref/main.jpg"
    }));
    expect(summarizeInspiredesignReferenceQuality(board)).toEqual(expect.objectContaining({
      rankedReferenceCount: 1,
      missingScreenshotCount: 0,
      allAttemptMissingScreenshotCount: 1,
      allAttemptVisualFailureCount: 1
    }));
  });

		  it("rejects persisted Pinterest pin media when the manifest index is missing", () => {
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
	      "brief-pin-media-missing-index",
	      minimalBriefFormat,
	      [reference],
	      "Premium digital photography studio landing page"
	    );

	    expect(hasInspiredesignUsableReferenceEvidence(reference)).toBe(false);
	    expect(board.references).toEqual([]);
	    expect(summarizeInspiredesignReferenceQuality(board)).toEqual(expect.objectContaining({
	      rankedReferenceCount: 0,
	      allAttemptMissingScreenshotCount: 1,
	      allAttemptVisualFailureCount: 1
	    }));
	  });

  it("uses trusted media-analysis facts for ranked references and design vectors", () => {
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
    const pinMediaIndex = [makePinterestPinMediaIndexEntry(reference.capture.pinMedia)];
    const board = buildInspiredesignReferencePatternBoard(
      "brief-pin-media-analysis",
      minimalBriefFormat,
      [reference],
      "Premium digital photography studio landing page",
      makeInspiredesignMediaAnalysis(),
      pinMediaIndex
    );
    const vectors = buildInspiredesignDesignVectors(minimalBriefFormat, board);
    const rankedReferenceText = JSON.stringify(board.references[0]);
    const vectorText = JSON.stringify(vectors);

    expect(board.references[0]).toEqual(expect.objectContaining({
      evidenceAuthority: "pin_media_ready",
      mediaAnalysisBacked: true,
      mediaAnalysisSource: expect.objectContaining({
        referenceId: "pin-ref",
        mediaPath: "pin-media-evidence/pin-ref/main.jpg",
        hash: reference.capture.pinMedia.sha256,
        kind: "image",
        contentType: "image/jpeg"
      }),
      layoutRecipe: expect.stringContaining("left-weighted split hero"),
      visualStrengths: expect.arrayContaining([
        expect.stringContaining("#080808"),
        expect.stringContaining("OCR-free typography")
      ]),
      contentHierarchy: expect.arrayContaining([expect.stringContaining("hero_headline_candidate")]),
      componentFamilies: expect.arrayContaining(["hero", "CTA cluster"]),
      motionPosture: expect.arrayContaining([expect.stringContaining("Static source only")]),
      tokenNotes: expect.arrayContaining([expect.stringContaining("#080808")]),
      patternsToReject: expect.arrayContaining([expect.stringContaining("claiming exact headlines")])
    }));
    expect(board.references[0]?.visualStrengths.join(" ")).not.toContain("Manifest-ready Pinterest pin media artifact");
    expect(vectors.directionLabel).toContain("left-weighted split hero");
    expect(vectors.premiumPosture).toEqual(expect.arrayContaining([expect.stringContaining("#080808")]));
    expect(vectors.typographyPosture).toEqual(expect.arrayContaining([expect.stringContaining("OCR-free")]));
    expect(vectors.imageryPosture).toEqual(expect.arrayContaining([expect.stringContaining("dark-dominant")]));
    expect(vectors.motionPosture).toEqual(expect.arrayContaining([expect.stringContaining("Static source only")]));
    expect(rankedReferenceText).not.toContain("Browse my latest work");
    expect(rankedReferenceText).not.toContain("Home");
    expect(vectorText).not.toContain("Browse my latest work");
    expect(vectorText).not.toContain("Home");
  });

	it("selects the media-analysis entry matching the trusted pin-media path", () => {
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
	const pinMediaIndex = [makePinterestPinMediaIndexEntry(reference.capture.pinMedia)];
	const mediaAnalysis = makeInspiredesignMediaAnalysis();
	const matchingReference = mediaAnalysis.references.at(0);
	expect(matchingReference).toBeDefined();
	if (!matchingReference) return;
	const mismatchedGuidance = {
		...matchingReference.designGuidance,
		visualStrengths: ["Mismatched media analysis should not be used."],
		layoutRecipe: "mismatched layout recipe",
		tokenNotes: ["#FF00FF should not appear"]
	};
	const mismatchedReferences = [
		{ ...matchingReference, mediaPath: "pin-media-evidence/pin-ref/wrong.jpg", designGuidance: mismatchedGuidance },
		{ ...matchingReference, hash: "b".repeat(64), designGuidance: mismatchedGuidance },
		{ ...matchingReference, kind: "video_poster" as const, designGuidance: mismatchedGuidance },
		{ ...matchingReference, contentType: "image/webp", designGuidance: mismatchedGuidance },
		{ ...matchingReference, bytes: (matchingReference.bytes ?? 0) + 1, designGuidance: mismatchedGuidance },
		{ ...matchingReference, dimensions: { width: 1, height: 1, aspectRatio: 1 }, designGuidance: mismatchedGuidance },
		{ ...matchingReference, sourceUrl: "https://www.pinterest.com/pin/9999999999/", designGuidance: mismatchedGuidance },
		{ ...matchingReference, mediaUrl: "https://i.pinimg.com/originals/other.jpg", designGuidance: mismatchedGuidance }
	];
	const board = buildInspiredesignReferencePatternBoard(
		"brief-pin-media-analysis-duplicate-paths",
		minimalBriefFormat,
		[reference],
		"Premium digital photography studio landing page",
		{ ...mediaAnalysis, references: [...mismatchedReferences, matchingReference] },
		pinMediaIndex
	);
	const boardText = JSON.stringify(board.references[0]);

	expect(board.references[0]).toEqual(expect.objectContaining({
		layoutRecipe: expect.stringContaining("left-weighted split hero"),
		tokenNotes: expect.arrayContaining([expect.stringContaining("#080808")])
	}));
	expect(boardText).not.toContain("#FF00FF");
	expect(boardText).not.toContain("mismatched layout recipe");
	});

	it("keeps duplicate reference IDs separated by canonical source URL for media-analysis trust", () => {
	const firstReference = {
		id: "pin-ref",
		url: "https://www.pinterest.com/pin/1234567890/",
		title: "First editorial photography studio pin",
		excerpt: "First full-bleed portrait image with premium studio lighting.",
		fetchStatus: "captured" as const,
		captureStatus: "captured" as const,
		capture: { pinMedia: makePinterestPinMediaEvidence() }
	};
	const secondReference = {
		id: "pin-ref",
		url: "https://www.pinterest.com/pin/9999999999/",
		title: "Second editorial photography studio pin",
		excerpt: "Second full-bleed portrait image with premium studio lighting.",
		fetchStatus: "captured" as const,
		captureStatus: "captured" as const,
		capture: {
		pinMedia: makePinterestPinMediaEvidence({
			url: "https://www.pinterest.com/pin/9999999999/",
			sourceUrl: "https://www.pinterest.com/pin/9999999999/",
			firstPartyProvenance: {
			canonicalReferenceUrl: "https://www.pinterest.com/pin/9999999999/",
			canonicalSourceUrl: "https://www.pinterest.com/pin/9999999999/",
			referenceUrlCanonical: true,
			sourceUrlMatchesReference: true,
			mediaUrlFirstParty: true
			}
		})
		}
	};
	const pinMediaIndex = [
		makePinterestPinMediaIndexEntry(firstReference.capture.pinMedia),
		makePinterestPinMediaIndexEntry(secondReference.capture.pinMedia)
	];
	const board = buildInspiredesignReferencePatternBoard(
		"brief-pin-media-analysis-duplicate-ids",
		minimalBriefFormat,
		[firstReference, secondReference],
		"Premium digital photography studio landing page",
		makeInspiredesignMediaAnalysis({ sourceUrl: "https://www.pinterest.com/pin/9999999999/" }),
		pinMediaIndex
	);
	const firstEntry = board.references.find((reference) => reference.url === firstReference.url);
	const secondEntry = board.references.find((reference) => reference.url === secondReference.url);

	expect(firstEntry?.mediaAnalysisBacked).toBeUndefined();
	expect(firstEntry?.visualStrengths.join(" ")).toContain("Manifest-ready Pinterest pin media artifact");
	expect(secondEntry).toEqual(expect.objectContaining({ mediaAnalysisBacked: true }));
	expect(secondEntry?.layoutRecipe).toContain("left-weighted split hero");
	});

  it("ignores diagnostic media-analysis entries for trusted pin-media references", () => {
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
    const pinMediaIndex = [makePinterestPinMediaIndexEntry(reference.capture.pinMedia)];
    const board = buildInspiredesignReferencePatternBoard(
      "brief-pin-media-analysis-diagnostic",
      minimalBriefFormat,
      [reference],
      "Premium digital photography studio landing page",
      makeInspiredesignMediaAnalysis({ authority: "diagnostic" }),
      pinMediaIndex
    );

    expect(board.references[0]).toEqual(expect.objectContaining({
      evidenceAuthority: "pin_media_ready",
      visualStrengths: expect.arrayContaining([
        "Manifest-ready Pinterest pin media artifact is available for still-image direction."
      ])
    }));
    expect(JSON.stringify(board.references[0])).not.toContain("#080808");
    expect(board.references[0]?.layoutRecipe).not.toContain("left-weighted split hero");
  });

  it("keeps metadata-only media-analysis out of media-backed ranked guidance", () => {
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
    const pinMediaIndex = [makePinterestPinMediaIndexEntry(reference.capture.pinMedia)];
    const mediaAnalysis = makeInspiredesignMediaAnalysis({
      claimLevels: ["metadata_only"],
      facts: {},
      designGuidance: {
        ...makeInspiredesignMediaAnalysis().references[0]!.designGuidance,
        layoutRecipe: "metadata-only layout should not be used",
        tokenNotes: ["#FF00FF metadata-only token should not be used"],
        patternsToBorrow: ["metadata-only pattern should not be used"]
      }
    });

    const board = buildInspiredesignReferencePatternBoard(
      "brief-pin-media-analysis-metadata-only",
      minimalBriefFormat,
      [reference],
      "Premium digital photography studio landing page",
      mediaAnalysis,
      pinMediaIndex
    );
    const entryText = JSON.stringify(board.references[0]);

    expect(board.references[0]).toEqual(expect.objectContaining({
      evidenceAuthority: "pin_media_ready",
      visualStrengths: expect.arrayContaining([
        "Media analysis confirmed persisted image metadata only; inspect saved pin media before making palette, layout, typography, or motion claims."
      ])
    }));
    expect(board.references[0]?.mediaAnalysisBacked).toBeUndefined();
    expect(entryText).not.toContain("metadata-only layout should not be used");
    expect(entryText).not.toContain("#FF00FF");
    expect(entryText).not.toContain("metadata-only pattern should not be used");
  });

  it("rejects pin-media readiness when individual authority fields are malformed", () => {
    const validPinMedia = makePinterestPinMediaEvidence();
    const validIndex = makePinterestPinMediaIndexEntry(validPinMedia);
    const makeReference = (pinMedia: InspiredesignPersistedPinterestPinMediaEvidence, url = "https://www.pinterest.com/pin/1234567890/") => ({
      id: "pin-ref",
      url,
      title: "Editorial photography studio pin",
      excerpt: "Full-bleed portrait image with premium studio lighting and clear hero focus.",
      fetchStatus: "captured" as const,
      captureStatus: "captured" as const,
      capture: { pinMedia }
    });
    const withPinMedia = (
      overrides: Partial<InspiredesignPersistedPinterestPinMediaEvidence>
    ): InspiredesignPersistedPinterestPinMediaEvidence => ({
      ...validPinMedia,
      ...overrides
    });
    const withIndex = (
      overrides: Partial<InspiredesignPinterestPinMediaIndexEntry>
    ): InspiredesignPinterestPinMediaIndexEntry => ({
      ...validIndex,
      ...overrides
    });
    const malformedCases: Array<{
      label: string;
      pinMedia: InspiredesignPersistedPinterestPinMediaEvidence;
      pinMediaIndex?: InspiredesignPinterestPinMediaIndexEntry[];
      url?: string;
    }> = [
      {
        label: "non-pin URL",
        pinMedia: validPinMedia,
        pinMediaIndex: [validIndex],
        url: "https://www.pinterest.com/search/pins/?q=studio"
      },
      {
        label: "missing matching index",
        pinMedia: validPinMedia,
        pinMediaIndex: undefined
      },
      {
		label: "index reference id mismatch",
		pinMedia: validPinMedia,
		pinMediaIndex: [withIndex({ referenceId: "other-pin-ref" })]
		},
		{
		label: "index path mismatch",
		pinMedia: validPinMedia,
		pinMediaIndex: [withIndex({ path: "pin-media-evidence/pin-ref/other.jpg" })]
		},
		{
		label: "index hash mismatch",
		pinMedia: validPinMedia,
		pinMediaIndex: [withIndex({ sha256: "b".repeat(64) })]
		},
		{
		label: "index kind mismatch",
		pinMedia: validPinMedia,
		pinMediaIndex: [withIndex({ kind: "video_poster" })]
		},
		{
		label: "index content type mismatch",
		pinMedia: validPinMedia,
		pinMediaIndex: [withIndex({ contentType: "image/webp" })]
		},
		{
		label: "index bytes mismatch",
		pinMedia: validPinMedia,
		pinMediaIndex: [withIndex({ bytes: validPinMedia.bytes + 1 })]
		},
		{
		label: "index width mismatch",
		pinMedia: validPinMedia,
		pinMediaIndex: [withIndex({ width: 1199 })]
		},
		{
		label: "index height mismatch",
		pinMedia: validPinMedia,
		pinMediaIndex: [withIndex({ height: 1599 })]
		},
		{
		label: "index source mismatch",
		pinMedia: validPinMedia,
		pinMediaIndex: [withIndex({ sourceUrl: "https://www.pinterest.com/pin/9999999999/" })]
		},
		{
		label: "index media URL mismatch",
		pinMedia: validPinMedia,
		pinMediaIndex: [withIndex({ mediaUrl: "https://i.pinimg.com/originals/other.jpg" })]
		},
		{
		label: "index invalid media URL",
		pinMedia: validPinMedia,
		pinMediaIndex: [withIndex({ mediaUrl: "not a url" })]
		},
		{
        label: "remote media URL",
        pinMedia: withPinMedia({ mediaUrl: "https://example.com/not-first-party.jpg" }),
        pinMediaIndex: [withIndex({ mediaUrl: "https://example.com/not-first-party.jpg" })]
      },
      {
        label: "video path mismatch",
        pinMedia: withPinMedia({
          kind: "video",
          contentType: "video/mp4",
          mediaUrl: "https://v.pinimg.com/videos/mc/720p/pin.mp4",
          path: "pin-media-evidence/pin-ref/main.jpg"
        }),
        pinMediaIndex: [withIndex({
          kind: "video",
          contentType: "video/mp4",
          mediaUrl: "https://v.pinimg.com/videos/mc/720p/pin.mp4",
          path: "pin-media-evidence/pin-ref/main.jpg"
        })]
      },
      {
        label: "invalid hash",
        pinMedia: withPinMedia({ sha256: "not-a-sha" }),
        pinMediaIndex: [withIndex({ sha256: "not-a-sha" })]
      },
      {
        label: "too few bytes",
        pinMedia: withPinMedia({ bytes: MIN_PIN_MEDIA_EVIDENCE_BYTES - 1 }),
        pinMediaIndex: [withIndex({ bytes: MIN_PIN_MEDIA_EVIDENCE_BYTES - 1 })]
      },
      {
        label: "too narrow",
        pinMedia: withPinMedia({ width: 1 }),
        pinMediaIndex: [withIndex({ width: 1 })]
      },
      {
        label: "too short",
        pinMedia: withPinMedia({ height: 1 }),
        pinMediaIndex: [withIndex({ height: 1 })]
      },
      {
        label: "unsupported content type",
        pinMedia: withPinMedia({ contentType: "image/svg+xml" }),
        pinMediaIndex: [withIndex({ contentType: "image/svg+xml" })]
      },
      {
        label: "kind content-type mismatch",
        pinMedia: withPinMedia({ kind: "video", contentType: "image/jpeg", path: "pin-media-evidence/pin-ref/video.mp4" }),
        pinMediaIndex: [withIndex({ kind: "video", contentType: "image/jpeg", path: "pin-media-evidence/pin-ref/video.mp4" })]
      },
      {
        label: "failure recorded",
        pinMedia: withPinMedia({ failure: "pin media capture failed" }),
        pinMediaIndex: [withIndex({})]
      },
      {
        label: "rejection reasons recorded",
        pinMedia: withPinMedia({ rejectionReasons: ["missing_trusted_byte_inspection"] }),
        pinMediaIndex: [withIndex({})]
      },
      {
        label: "blocking warning",
        pinMedia: withPinMedia({ warnings: ["login challenge blocked media extraction"] }),
        pinMediaIndex: [withIndex({ warnings: ["login challenge blocked media extraction"] })]
      },
      {
        label: "broken provenance",
        pinMedia: withPinMedia({
          firstPartyProvenance: {
            ...validPinMedia.firstPartyProvenance,
            referenceUrlCanonical: false
          }
        }),
        pinMediaIndex: [withIndex({})]
      }
    ];

    for (const { label, pinMedia, pinMediaIndex, url } of malformedCases) {
      const reference = makeReference(pinMedia, url);
      const board = buildInspiredesignReferencePatternBoard(
        `brief-pin-media-malformed-${label}`,
        minimalBriefFormat,
        [reference],
        "Premium digital photography studio landing page",
        undefined,
        pinMediaIndex
      );

      expect(hasInspiredesignUsableReferenceEvidence(reference, pinMediaIndex), label).toBe(false);
      expect(board.references, label).toEqual([]);
    }
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
	    const pinMediaIndex = [makePinterestPinMediaIndexEntry(reference.capture.pinMedia)];
	    const board = buildInspiredesignReferencePatternBoard(
	      "brief-pin-media-poster",
	      minimalBriefFormat,
	      [reference],
	      "Premium digital photography studio landing page",
	      undefined,
	      pinMediaIndex
	    );

	    expect(hasInspiredesignUsableReferenceEvidence(reference, pinMediaIndex)).toBe(true);
	    expect(board.references[0]).toEqual(expect.objectContaining({
	      id: "pin-ref",
	      evidenceAuthority: "pin_media_ready",
	      capturedVia: expect.arrayContaining(["pin_media", "pin_media_ready"]),
	      selectionReason: expect.stringContaining("manifest-ready Pinterest pin media evidence")
	    }));
	    expect(board.qualitySummary.diagnosticOnlyReasons).toEqual([]);
	  });

	  it("ranks actual Pinterest video pin media as manifest-ready evidence", () => {
	    const reference = {
	      id: "pin-ref",
	      url: "https://www.pinterest.com/pin/1234567890/",
	      title: "Editorial photography studio motion pin",
	      excerpt: "Cinematic portrait motion with controlled studio lighting and premium hero pacing.",
	      fetchStatus: "captured" as const,
	      captureStatus: "captured" as const,
	      capture: {
	        pinMedia: makePinterestPinMediaEvidence({
	          kind: "video",
	          mediaUrl: "https://v.pinimg.com/videos/mc/720p/pin.mp4",
	          width: 720,
	          height: 1280,
	          contentType: "video/mp4"
	        })
	      }
	    };
	    const pinMediaIndex = [makePinterestPinMediaIndexEntry(reference.capture.pinMedia)];
	    const board = buildInspiredesignReferencePatternBoard(
	      "brief-pin-media-video",
	      minimalBriefFormat,
	      [reference],
	      "Premium digital photography studio landing page",
	      undefined,
	      pinMediaIndex
	    );

	    expect(reference.capture.pinMedia.path).toBe("pin-media-evidence/pin-ref/video.mp4");
	    expect(hasInspiredesignUsableReferenceEvidence(reference, pinMediaIndex)).toBe(true);
	    expect(board.references[0]).toEqual(expect.objectContaining({
	      id: "pin-ref",
	      evidenceAuthority: "pin_media_ready",
	      capturedVia: expect.arrayContaining(["pin_media", "pin_media_ready"])
	    }));
	    expect(board.rejectedReferences).toEqual([]);
	  });

	  it("keeps malformed Pinterest video pin media diagnostic", () => {
	    const validVideoPinMedia = makePinterestPinMediaEvidence({
	      kind: "video",
	      mediaUrl: "https://v.pinimg.com/videos/mc/720p/pin.mp4",
	      width: 720,
	      height: 1280,
	      contentType: "video/mp4"
	    });
	    const invalidVideoEvidence = [
	      {
	        ...validVideoPinMedia,
	        path: "pin-media-evidence/pin-ref/main.mp4"
	      },
	      {
	        ...validVideoPinMedia,
	        contentType: "image/jpeg"
	      },
	      {
	        ...validVideoPinMedia,
	        kind: "video_poster" as const,
	        contentType: "video/mp4"
	      },
	      {
	        ...validVideoPinMedia,
	        kind: "video_poster" as const,
	        path: "pin-media-evidence/pin-ref/poster.mp4",
	        contentType: "image/jpeg"
	      },
	      {
	        ...validVideoPinMedia,
	        path: undefined
	      }
	    ];

	    for (const pinMedia of invalidVideoEvidence) {
	      const reference = {
	        id: "pin-ref",
	        url: "https://www.pinterest.com/pin/1234567890/",
	        title: "Editorial photography studio motion pin",
	        excerpt: "Cinematic portrait motion with controlled studio lighting and premium hero pacing.",
	        fetchStatus: "captured" as const,
	        captureStatus: "captured" as const,
	        capture: { pinMedia }
	      };
	      const board = buildInspiredesignReferencePatternBoard(
	        "brief-pin-media-invalid-video",
	        minimalBriefFormat,
	        [reference],
	        "Premium digital photography studio landing page"
	      );

	      expect(hasInspiredesignUsableReferenceEvidence(reference)).toBe(false);
	      expect(board.references).toEqual([]);
	      expect(board.rejectedReferences[0]).toEqual(expect.objectContaining({
	        id: "pin-ref"
	      }));
	    }
	  });

	  it("ranks trusted Pinterest video poster media as fallback still evidence", () => {
	    const reference = {
	      id: "pin-ref",
	      url: "https://www.pinterest.com/pin/1234567890/",
	      title: "Editorial photography studio video poster pin",
	      excerpt: "A cinematic poster frame with premium studio lighting, useful when video bytes are unavailable.",
	      fetchStatus: "captured" as const,
      captureStatus: "captured" as const,
      capture: {
        pinMedia: makePinterestPinMediaEvidence({
          kind: "video_poster"
        })
      }
    };
	    const pinMediaIndex = [makePinterestPinMediaIndexEntry(reference.capture.pinMedia)];
	    const board = buildInspiredesignReferencePatternBoard(
	      "brief-pin-media-video-poster",
	      minimalBriefFormat,
	      [reference],
	      "Premium digital photography studio landing page",
	      undefined,
	      pinMediaIndex
	    );

	    expect(reference.capture.pinMedia.path).toBe("pin-media-evidence/pin-ref/poster.jpg");
	    expect(hasInspiredesignUsableReferenceEvidence(reference, pinMediaIndex)).toBe(true);
	    expect(board.references[0]).toEqual(expect.objectContaining({
	      id: "pin-ref",
	      evidenceAuthority: "pin_media_ready",
	      capturedVia: expect.arrayContaining(["pin_media_ready"])
	    }));
	    expect(board.rejectedReferences).toEqual([]);
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
	    const pinMediaIndex = [makePinterestPinMediaIndexEntry(reference.capture.pinMedia)];
	    const board = buildInspiredesignReferencePatternBoard(
	      "brief-pin-media-chrome-shell",
	      minimalBriefFormat,
	      [reference],
	      "Premium digital photography studio landing page",
	      undefined,
	      pinMediaIndex
	    );

	    expect(hasInspiredesignUsableReferenceEvidence(reference, pinMediaIndex)).toBe(true);
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
	    const pinMediaIndex = [makePinterestPinMediaIndexEntry(reference.capture.pinMedia)];
	    const board = buildInspiredesignReferencePatternBoard(
	      "brief-locale-pin-media",
	      minimalBriefFormat,
	      [reference],
	      "Premium digital photography studio landing page",
	      undefined,
	      pinMediaIndex
	    );

	    expect(hasInspiredesignUsableReferenceEvidence(reference, pinMediaIndex)).toBe(true);
	    expect(board.references[0]).toEqual(expect.objectContaining({
	      id: "pin-ref",
	      evidenceAuthority: "pin_media_ready",
	      capturedVia: expect.arrayContaining(["pin_media_ready"])
	    }));
	  });

	it("ranks trusted canonical pin media despite an interface chrome shell warning", () => {
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
	const pinMediaIndex = [makePinterestPinMediaIndexEntry(reference.capture.pinMedia)];
	    const board = buildInspiredesignReferencePatternBoard(
	"brief-pin-media-interface-chrome-shell",
	      minimalBriefFormat,
	      [reference],
	      "Premium digital photography studio landing page",
	      undefined,
	      pinMediaIndex
	    );

	expect(hasInspiredesignUsableReferenceEvidence(reference, pinMediaIndex)).toBe(true);
	expect(board.references[0]).toEqual(expect.objectContaining({
	id: "pin-ref",
	evidenceAuthority: "pin_media_ready",
	capturedVia: expect.arrayContaining(["pin_media_ready"])
	}));
	expect(board.rejectedReferences).toEqual([]);
	});

	it("keeps interface chrome media diagnostic without trusted byte proof", () => {
	const forgedPinMedia = JSON.parse(JSON.stringify(
	makePinterestPinMediaEvidence({ warnings: ["interface_chrome_shell"] })
	)) as InspiredesignPersistedPinterestPinMediaEvidence;
	const reference = {
	id: "pin-ref",
	url: "https://www.pinterest.com/pin/1234567890/",
	title: "Search results for studio. Editorial photography studio pin.",
	excerpt: "Pin card Your profile Related searches and promoted pins with full-bleed portrait lighting.",
	fetchStatus: "captured" as const,
	captureStatus: "captured" as const,
	capture: {
	pinMedia: forgedPinMedia
	}
	};
	const board = buildInspiredesignReferencePatternBoard(
	"brief-untrusted-pin-media-interface-chrome-shell",
	minimalBriefFormat,
	[reference],
	"Premium digital photography studio landing page"
	);

	    expect(hasInspiredesignUsableReferenceEvidence(reference)).toBe(false);
	    expect(board.references).toEqual([]);
	    expect(board.rejectedReferences[0]).toEqual(expect.objectContaining({
	      id: "pin-ref",
	diagnosticReasons: expect.arrayContaining(["interface_chrome_shell"])
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

  it("describes metadata-only references as limited but usable cues", () => {
    const board = buildInspiredesignReferencePatternBoard("brief-metadata-text", minimalBriefFormat, [{
      id: "metadata-text",
      url: "https://example.com/editorial-studio",
      title: "Premium digital photography studio landing page hero CTA website full-bleed service story portfolio gallery",
      excerpt: "Editorial photographer studio with cinematic portrait lighting, conversion CTA, booking flow, service story, proof band, and immersive gallery.",
      fetchStatus: "captured" as const,
      captureStatus: "off" as const
    }], "Premium digital photography studio landing page");

    expect(board.references[0]).toEqual(expect.objectContaining({
      id: "metadata-text",
      selectionReason: "Ranked for limited but usable reference cues."
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
    const pinMediaIndex = [makePinterestPinMediaIndexEntry(reference.capture.pinMedia)];
    const board = buildInspiredesignReferencePatternBoard(
      "brief-motion-and-pin-media",
      minimalBriefFormat,
      [reference],
      "Premium motion-led landing page",
      undefined,
      pinMediaIndex
    );

    expect(hasInspiredesignUsableReferenceEvidence(reference, pinMediaIndex)).toBe(true);
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
