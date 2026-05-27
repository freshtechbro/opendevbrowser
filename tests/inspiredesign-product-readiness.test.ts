import { describe, expect, it } from "vitest";
import {
  buildInspiredesignProductReadinessFields,
  deriveInspiredesignProductReadinessFields,
  hasActiveInspiredesignCanvasDoNotProceedBlocker,
  isInactiveInspiredesignCanvasDoNotProceedCondition,
  isInspiredesignAuthoritativeRankedReference,
  isInspiredesignPinterestOwnedReferenceUrl,
  isInspiredesignPinterestPinReferenceUrl,
  readExplicitInspiredesignProductReadinessFields
} from "../src/inspiredesign/product-readiness";
import {
  buildMotionEvidenceArtifactPath,
  persistInspiredesignMotionEvidence,
  sanitizeInspiredesignMotionReferenceId
} from "../src/inspiredesign/motion-evidence";
import { expandInspiredesignBrief } from "../src/inspiredesign/brief-expansion";
import { buildInspiredesignMetaPrompt } from "../src/inspiredesign/meta-prompt";
import type {
  InspiredesignDesignVectors,
  InspiredesignReferencePatternBoard
} from "../src/inspiredesign/reference-pattern-board";
import {
  classifyPinterestCandidate,
  classifyPinterestSourcePage,
  resolvePinterestPrimaryCaptureStrategy,
  shouldBlockPinterestSourceExtraction,
  summarizePinterestClassifications
} from "../src/inspiredesign/pinterest-media-classification";

describe("inspiredesign product readiness helpers", () => {
  it("reads explicit daemon product authority without deriving conflicting readiness", () => {
    expect(readExplicitInspiredesignProductReadinessFields({ productSuccess: "true" })).toBeUndefined();
    expect(readExplicitInspiredesignProductReadinessFields({ productSuccess: false })).toBeUndefined();
    expect(readExplicitInspiredesignProductReadinessFields({
      productSuccess: false,
      artifactAuthority: "product_ready",
      evidenceAuthority: "unknown"
    })).toBeUndefined();

    expect(readExplicitInspiredesignProductReadinessFields({
      ready: true,
      readiness: "ready",
      harvestReadiness: "ready",
      productSuccess: true,
      artifactAuthority: "product_ready",
      evidenceAuthority: "snapshot_ready",
      rankedReferenceCount: 1,
      authoritativeReferenceCount: 1,
      snapshotReadyReferenceCount: 1,
      motionReadyReferenceCount: 0,
      rankedReferences: [{
        id: "pin-123",
        url: "https://www.pinterest.com/pin/123/",
        evidenceAuthority: "snapshot_ready"
      }],
      screenshotIndex: [{
        referenceId: "pin-123",
        url: "https://www.pinterest.com/pin/123/",
        sourceUrl: "https://www.pinterest.com/pin/123/",
		pinterestPageQuality: "pin_media",
        path: "visual-evidence/pin-123/viewport.png",
        sha256: "a".repeat(64),
        bytes: 2048,
        warnings: []
      }]
    })).toEqual({
      ready: true,
      readiness: "ready",
      harvestReadiness: "ready",
      productSuccess: true,
      artifactAuthority: "product_ready",
      evidenceAuthority: "snapshot_ready",
      rankedReferenceCount: 1,
      authoritativeReferenceCount: 1,
      snapshotReadyReferenceCount: 1,
      motionReadyReferenceCount: 0
    });

    expect(readExplicitInspiredesignProductReadinessFields({
      ready: true,
      productSuccess: true,
      artifactAuthority: "product_ready",
      evidenceAuthority: "snapshot_ready",
      rankedReferenceCount: 1,
      authoritativeReferenceCount: 1,
      snapshotReadyReferenceCount: 1,
      motionReadyReferenceCount: 0
    })).toEqual(expect.objectContaining({
      ready: true,
      readiness: "ready",
      harvestReadiness: "ready",
      productSuccess: false,
      artifactAuthority: "diagnostic_only",
      evidenceAuthority: "diagnostic_only",
      rankedReferenceCount: 1,
      authoritativeReferenceCount: 1,
      snapshotReadyReferenceCount: 1,
      motionReadyReferenceCount: 0
    }));

    expect(readExplicitInspiredesignProductReadinessFields({
      ready: false,
      readiness: "ready",
      harvestReadiness: "ready",
      productSuccess: true,
      artifactAuthority: "product_ready",
      evidenceAuthority: "snapshot_ready",
      rankedReferenceCount: 1,
      authoritativeReferenceCount: 1,
      snapshotReadyReferenceCount: 1,
      motionReadyReferenceCount: 0
    })).toEqual(expect.objectContaining({
      ready: false,
      productSuccess: false,
      artifactAuthority: "diagnostic_only",
      evidenceAuthority: "diagnostic_only"
    }));

    expect(readExplicitInspiredesignProductReadinessFields({
		productSuccess: false,
		artifactAuthority: "diagnostic_only",
		evidenceAuthority: "diagnostic_only",
		rankedReferenceCount: 0,
		authoritativeReferenceCount: 0,
		snapshotReadyReferenceCount: 0,
		motionReadyReferenceCount: 0
	})).toEqual({
		ready: false,
		readiness: "unknown",
		harvestReadiness: "unknown",
		productSuccess: false,
		artifactAuthority: "diagnostic_only",
		evidenceAuthority: "diagnostic_only",
		rankedReferenceCount: 0,
		authoritativeReferenceCount: 0,
		snapshotReadyReferenceCount: 0,
		motionReadyReferenceCount: 0
	});

	expect(readExplicitInspiredesignProductReadinessFields({
		ready: true,
		readiness: "ready",
		harvestReadiness: "ready-for-reporting",
		productSuccess: false,
		artifactAuthority: "diagnostic_only",
		evidenceAuthority: "diagnostic_only"
	})).toEqual(expect.objectContaining({
		ready: true,
		readiness: "ready",
		harvestReadiness: "ready-for-reporting",
		productSuccess: false,
		rankedReferenceCount: 0
	}));

	expect(readExplicitInspiredesignProductReadinessFields({
      nextStepGuidance: { readiness: "diagnostic_only" },
      productSuccess: false,
      artifactAuthority: "diagnostic_only",
      evidenceAuthority: "diagnostic_only",
      rankedReferenceCount: -1,
      rankedReferences: [{ url: "https://example.com/reference" }],
      harvestReadiness: "",
      authoritativeReferenceCount: "invalid",
      snapshotReadyReferenceCount: Number.NaN,
      motionReadyReferenceCount: -1
    })).toEqual(expect.objectContaining({
      ready: false,
      readiness: "diagnostic_only",
      harvestReadiness: "diagnostic_only",
      productSuccess: false,
      artifactAuthority: "diagnostic_only",
      evidenceAuthority: "diagnostic_only",
      rankedReferenceCount: 1,
      authoritativeReferenceCount: 0,
      snapshotReadyReferenceCount: 0,
      motionReadyReferenceCount: 0
    }));

    expect(readExplicitInspiredesignProductReadinessFields({
      ready: true,
      readiness: "ready",
      harvestReadiness: "ready",
      productSuccess: true,
      artifactAuthority: "product_ready",
      evidenceAuthority: "snapshot_ready",
      rankedReferenceCount: 1,
      authoritativeReferenceCount: 1,
      snapshotReadyReferenceCount: 1,
      motionReadyReferenceCount: 0
    })).toEqual(expect.objectContaining({
      ready: true,
      readiness: "ready",
      harvestReadiness: "ready",
      productSuccess: false,
      artifactAuthority: "diagnostic_only",
      evidenceAuthority: "diagnostic_only",
      rankedReferenceCount: 1,
      authoritativeReferenceCount: 1,
      snapshotReadyReferenceCount: 1,
      motionReadyReferenceCount: 0
    }));

    expect(readExplicitInspiredesignProductReadinessFields({
      ready: true,
      readiness: "diagnostic_only",
      harvestReadiness: "diagnostic_only",
      productSuccess: true,
      artifactAuthority: "product_ready",
      evidenceAuthority: "snapshot_ready",
      rankedReferenceCount: 1,
      authoritativeReferenceCount: 1,
      snapshotReadyReferenceCount: 1,
      motionReadyReferenceCount: 0
    })).toEqual({
      ready: false,
      readiness: "diagnostic_only",
      harvestReadiness: "diagnostic_only",
      productSuccess: false,
      artifactAuthority: "diagnostic_only",
      evidenceAuthority: "diagnostic_only",
      rankedReferenceCount: 1,
      authoritativeReferenceCount: 1,
      snapshotReadyReferenceCount: 1,
      motionReadyReferenceCount: 0
    });

    expect(readExplicitInspiredesignProductReadinessFields({
      ready: true,
      readiness: "ready",
      harvestReadiness: "ready",
      productSuccess: true,
      artifactAuthority: "product_ready",
      evidenceAuthority: "snapshot_ready",
      pinterestEvidenceRequired: true,
      rankedReferenceCount: 1,
      authoritativeReferenceCount: 1,
      snapshotReadyReferenceCount: 0,
      motionReadyReferenceCount: 0
    })).toEqual(expect.objectContaining({
      ready: true,
      productSuccess: false,
      artifactAuthority: "diagnostic_only",
      evidenceAuthority: "diagnostic_only"
    }));

    expect(readExplicitInspiredesignProductReadinessFields({
      ready: true,
      productSuccess: true,
      artifactAuthority: "product_ready",
      evidenceAuthority: "motion_ready",
      meta: {
        nextStepGuidance: { readiness: "ready" },
        rankedReferenceCount: 3,
        authoritativeReferenceCount: 2,
        snapshotReadyReferenceCount: 1,
        motionReadyReferenceCount: 1
      }
    })).toEqual(expect.objectContaining({
      ready: true,
      readiness: "ready",
      harvestReadiness: "ready",
      productSuccess: false,
      artifactAuthority: "diagnostic_only",
      evidenceAuthority: "diagnostic_only",
      rankedReferenceCount: 3,
      authoritativeReferenceCount: 2,
      snapshotReadyReferenceCount: 1,
      motionReadyReferenceCount: 1
    }));

    expect(readExplicitInspiredesignProductReadinessFields({
      ready: true,
      productSuccess: true,
      artifactAuthority: "product_ready",
      evidenceAuthority: "motion_ready",
      meta: {
        nextStepGuidance: { readiness: "ready" },
        rankedReferenceCount: 3,
        authoritativeReferenceCount: 3,
        snapshotReadyReferenceCount: 1,
        motionReadyReferenceCount: 1
      }
    })).toEqual(expect.objectContaining({
      ready: true,
      readiness: "ready",
      harvestReadiness: "ready",
      productSuccess: false,
      artifactAuthority: "diagnostic_only",
      evidenceAuthority: "diagnostic_only",
      rankedReferenceCount: 3,
      authoritativeReferenceCount: 3,
      snapshotReadyReferenceCount: 1,
      motionReadyReferenceCount: 1
    }));

    expect(readExplicitInspiredesignProductReadinessFields({
      productSuccess: true,
      artifactAuthority: "product_ready",
      evidenceAuthority: "snapshot_ready",
      meta: {
        nextStepGuidance: { readiness: "ready" },
        rankedReferenceCount: 2
      }
    })).toEqual(expect.objectContaining({
      ready: true,
      readiness: "ready",
      harvestReadiness: "ready",
      rankedReferenceCount: 2,
      productSuccess: false,
      artifactAuthority: "diagnostic_only",
      evidenceAuthority: "diagnostic_only"
    }));

    expect(readExplicitInspiredesignProductReadinessFields({
      productSuccess: false,
      artifactAuthority: "diagnostic_only",
      evidenceAuthority: "diagnostic_only",
      meta: {
        rankedReferences: [
          { url: "https://example.com/a" },
          { url: "https://example.com/b" }
        ]
      }
    })).toEqual(expect.objectContaining({
      ready: false,
      readiness: "unknown",
      harvestReadiness: "unknown",
      rankedReferenceCount: 2
    }));

    expect(readExplicitInspiredesignProductReadinessFields({
      productSuccess: false,
      artifactAuthority: "diagnostic_only",
      evidenceAuthority: "diagnostic_only"
    })).toEqual(expect.objectContaining({
      readiness: "unknown",
      rankedReferenceCount: 0,
      productSuccess: false
    }));
  });

	it("uses ranked reference arrays as the readiness count source of truth", () => {
	const rankedReferences = [
		{
		id: "pin-array-1",
		url: "https://www.pinterest.com/pin/111/",
		evidenceAuthority: "snapshot_ready"
		},
		{
		id: "pin-array-2",
		url: "https://www.pinterest.com/pin/222/",
		evidenceAuthority: "snapshot_ready"
		}
	];
	const screenshotIndex = [{
		referenceId: "pin-array-1",
		url: "https://www.pinterest.com/pin/111/",
		sourceUrl: "https://www.pinterest.com/pin/111/",
		pinterestPageQuality: "pin_media",
		path: "visual-evidence/pin-array-1/viewport.png",
		sha256: "a".repeat(64),
		bytes: 2048,
		warnings: []
	}];

	expect(deriveInspiredesignProductReadinessFields({
		readiness: "ready",
		rankedReferenceCount: 1,
		authoritativeReferenceCount: 1,
		snapshotReadyReferenceCount: 1,
		motionReadyReferenceCount: 0,
		rankedReferences,
		screenshotIndex
	})).toEqual(expect.objectContaining({
		productSuccess: false,
		artifactAuthority: "diagnostic_only",
		evidenceAuthority: "diagnostic_only",
		rankedReferenceCount: 2,
		authoritativeReferenceCount: 1,
		snapshotReadyReferenceCount: 1,
		motionReadyReferenceCount: 0
	}));

	expect(readExplicitInspiredesignProductReadinessFields({
		ready: true,
		readiness: "ready",
		productSuccess: true,
		artifactAuthority: "product_ready",
		evidenceAuthority: "snapshot_ready",
		rankedReferenceCount: 1,
		authoritativeReferenceCount: 1,
		snapshotReadyReferenceCount: 1,
		motionReadyReferenceCount: 0,
		rankedReferences,
		screenshotIndex
	})).toEqual(expect.objectContaining({
		productSuccess: false,
		artifactAuthority: "diagnostic_only",
		evidenceAuthority: "diagnostic_only",
		rankedReferenceCount: 2,
		authoritativeReferenceCount: 1,
		snapshotReadyReferenceCount: 1,
		motionReadyReferenceCount: 0
	}));
	});

	it("requires coherent nonnegative integer counts before direct product readiness", () => {
	expect(buildInspiredesignProductReadinessFields("ready", -1, 0, 0, false, 0, 0, 0)).toEqual(expect.objectContaining({
		productSuccess: false,
		artifactAuthority: "diagnostic_only",
		evidenceAuthority: "diagnostic_only",
		rankedReferenceCount: 0,
		authoritativeReferenceCount: 0,
		snapshotReadyReferenceCount: 0,
		motionReadyReferenceCount: 0
	}));

	expect(buildInspiredesignProductReadinessFields("ready", 1.5, 0, 1, false, 1, 0, 1)).toEqual(expect.objectContaining({
		productSuccess: false,
		artifactAuthority: "diagnostic_only",
		evidenceAuthority: "diagnostic_only",
		rankedReferenceCount: 0,
		authoritativeReferenceCount: 0
	}));

	expect(buildInspiredesignProductReadinessFields("ready", 1, 0, 1, false, 1, 1, 1)).toEqual(expect.objectContaining({
		productSuccess: false,
		artifactAuthority: "diagnostic_only",
		evidenceAuthority: "diagnostic_only",
		rankedReferenceCount: 1,
		authoritativeReferenceCount: 1,
		snapshotReadyReferenceCount: 1,
		motionReadyReferenceCount: 0
	}));

	expect(buildInspiredesignProductReadinessFields("ready", 1, 0, 1, false, 1, 0, 2)).toEqual(expect.objectContaining({
		productSuccess: false,
		artifactAuthority: "diagnostic_only",
		evidenceAuthority: "diagnostic_only",
		rankedReferenceCount: 1,
		authoritativeReferenceCount: 1,
		snapshotReadyReferenceCount: 1
	}));
	});

	it("requires artifact-backed integer counts before preserving explicit product readiness", () => {
	const explicitScreenshot = {
		referenceId: "explicit-pin",
		url: "https://www.pinterest.com/pin/123/",
		sourceUrl: "https://www.pinterest.com/pin/123/",
		pinterestPageQuality: "pin_media",
		path: "visual-evidence/explicit-pin/viewport.png",
		sha256: "a".repeat(64),
		bytes: 2048,
		warnings: []
	};
	const explicitSnapshotReady = {
		ready: true,
		readiness: "ready",
		harvestReadiness: "ready",
		productSuccess: true,
		artifactAuthority: "product_ready",
		evidenceAuthority: "snapshot_ready",
		rankedReferenceCount: 1,
		authoritativeReferenceCount: 1,
		snapshotReadyReferenceCount: 1,
		motionReadyReferenceCount: 0,
		rankedReferences: [{
		id: "explicit-pin",
		url: "https://www.pinterest.com/pin/123/",
		evidenceAuthority: "snapshot_ready"
		}],
		screenshotIndex: [explicitScreenshot]
	};

	expect(readExplicitInspiredesignProductReadinessFields(explicitSnapshotReady)).toEqual(expect.objectContaining({
		productSuccess: true,
		artifactAuthority: "product_ready",
		evidenceAuthority: "snapshot_ready",
		rankedReferenceCount: 1,
		authoritativeReferenceCount: 1,
		snapshotReadyReferenceCount: 1
	}));

	expect(readExplicitInspiredesignProductReadinessFields({
		ready: true,
		readiness: "ready",
		productSuccess: true,
		artifactAuthority: "product_ready",
		evidenceAuthority: "snapshot_ready",
		rankedReferenceCount: 1,
		authoritativeReferenceCount: 1,
		snapshotReadyReferenceCount: 1,
		motionReadyReferenceCount: 0
	})).toEqual(expect.objectContaining({
		productSuccess: false,
		artifactAuthority: "diagnostic_only",
		evidenceAuthority: "diagnostic_only"
	}));

	expect(readExplicitInspiredesignProductReadinessFields({
		...explicitSnapshotReady,
		authoritativeReferenceCount: 2
	})).toEqual(expect.objectContaining({
		productSuccess: false,
		artifactAuthority: "diagnostic_only",
		evidenceAuthority: "diagnostic_only",
		authoritativeReferenceCount: 2
	}));

	expect(readExplicitInspiredesignProductReadinessFields({
		...explicitSnapshotReady,
		rankedReferenceCount: 1.5
	})).toEqual(expect.objectContaining({
		productSuccess: false,
		artifactAuthority: "diagnostic_only",
		evidenceAuthority: "diagnostic_only"
	}));

	expect(readExplicitInspiredesignProductReadinessFields({
		...explicitSnapshotReady,
		screenshotIndex: [{
		...explicitScreenshot,
		warnings: ["login challenge"]
		}]
	})).toEqual(expect.objectContaining({
		productSuccess: false,
		artifactAuthority: "diagnostic_only",
		evidenceAuthority: "diagnostic_only"
	}));
	});

  it("derives snapshot and motion authority from ranked reference records", () => {
    expect(isInspiredesignAuthoritativeRankedReference({
      url: "https://www.pinterest.com/pin/1234567890/",
      evidenceAuthority: "snapshot_ready"
    }, {
      screenshots: [{
        url: "https://pinterest.com/pin/1234567890/?utm_source=share",
        sourceUrl: "https://pinterest.com/pin/1234567890/?utm_source=share",
        pinterestPageQuality: "pin_media",
        path: "visual-evidence/pin/viewport.png",
        sha256: "a".repeat(64),
        bytes: 2048,
        warnings: []
      }]
    })).toBe(true);

    expect(deriveInspiredesignProductReadinessFields({
      nextStepGuidance: { readiness: "ready", doNotProceedIf: ["rankedReferences is empty"] },
      rankedReferences: [
        {
          id: "pin-123",
          url: "https://www.pinterest.com/pin/123/",
          evidenceAuthority: "snapshot_ready",
          capturedVia: ["fetch", "snapshot_ready"]
        },
        {
          id: "pin-456",
          url: "https://www.pinterest.com/pin/456/",
          evidenceAuthority: "motion_ready",
          capturedVia: ["fetch"]
        },
        {
          url: "https://example.com/reference",
          capturedVia: ["fetch"]
        }
      ],
      screenshotIndex: [{
        referenceId: "pin-123",
        url: "https://www.pinterest.com/pin/123/",
        sourceUrl: "https://www.pinterest.com/pin/123/",
		pinterestPageQuality: "pin_media",
        path: "visual-evidence/pin-123/viewport.png",
        sha256: "a".repeat(64),
        bytes: 2048,
        warnings: []
      }, {
        url: "https://example.com/reference",
        sourceUrl: "https://example.com/reference",
        path: "visual-evidence/example-reference/full_page.png",
        sha256: "b".repeat(64),
        bytes: 2048,
        warnings: []
      }],
      motionEvidence: [{
        referenceId: "pin-456",
        url: "https://www.pinterest.com/pin/456/",
        motion: {
            status: "captured",
            authority: "design_evidence",
	          diagnostic: false,
	          diagnosticReasons: [],
	          sourceUrl: "https://www.pinterest.com/pin/456/",
	          startedSourceUrl: "https://www.pinterest.com/pin/456/",
	          endedSourceUrl: "https://www.pinterest.com/pin/456/",
	pinterestPageQuality: "pin_media",
	startedPinterestPageQuality: "pin_media",
	endedPinterestPageQuality: "pin_media",
	          frameCount: 3,
          replay: { path: "motion-evidence/pin-456/replay.json", sha256: "c".repeat(64), bytes: 64 },
          preview: { path: "motion-evidence/pin-456/preview.png", sha256: "d".repeat(64), bytes: 2048 }
        }
      }],
      qualitySummary: { missingScreenshotCount: 0 }
    })).toEqual(expect.objectContaining({
      productSuccess: true,
      artifactAuthority: "product_ready",
      evidenceAuthority: "snapshot_ready",
      rankedReferenceCount: 3,
      authoritativeReferenceCount: 3,
      snapshotReadyReferenceCount: 2,
      motionReadyReferenceCount: 1
    }));
  });

  it("falls back through meta counts, quality counters, and direct blocker fields", () => {
    expect(deriveInspiredesignProductReadinessFields({
      meta: {
        nextStepGuidance: {
          readiness: "ready",
          doNotProceedIf: ["screenshot paths are missing when visual evidence was required"]
        },
        rankedReferences: [
          {
            url: "https://www.pinterest.com/pin/789/",
            capturedVia: ["fetch"],
            evidenceAuthority: "diagnostic_only"
          }
        ],
        quality: { missingScreenshotCount: 1 }
      }
    })).toEqual(expect.objectContaining({
      productSuccess: false,
      evidenceAuthority: "diagnostic_only",
      rankedReferenceCount: 1,
      authoritativeReferenceCount: 0
    }));

    expect(deriveInspiredesignProductReadinessFields({
      readiness: "ready",
      rankedReferenceCount: 1,
      snapshotReadyReferenceCount: 1,
      authoritativeReferenceCount: 1,
      metrics: { missing_screenshot_count: 0 },
      doNotProceedIf: ["screenshot paths are missing when visual evidence was required"]
    })).toEqual(expect.objectContaining({
      productSuccess: false,
      evidenceAuthority: "diagnostic_only",
      snapshotReadyReferenceCount: 0,
      authoritativeReferenceCount: 0
    }));
  });

  it("handles malformed authority inputs as diagnostic-only", () => {
    expect(deriveInspiredesignProductReadinessFields({
      nextStepGuidance: { readiness: "" },
      rankedReferences: [
        null,
        { url: 123 },
        { url: "not a url", capturedVia: ["snapshot_ready"] },
        { url: "https://www.pinterest.com/pin/100/", capturedVia: "snapshot_ready" }
      ],
      nextStepGuidanceExtra: { doNotProceedIf: ["ignored"] }
    })).toEqual(expect.objectContaining({
      readiness: "unknown",
      productSuccess: false,
      rankedReferenceCount: 4,
      authoritativeReferenceCount: 0
    }));
  });

  it("rejects Pinterest authority when artifacts miss source or visual review evidence", () => {
    const rankedReferences = [{
      id: "pin-789",
      url: "https://www.pinterest.com/pin/789/",
      evidenceAuthority: "snapshot_ready"
    }];
	    expect(deriveInspiredesignProductReadinessFields({
	      nextStepGuidance: { readiness: "ready" },
	      rankedReferences,
      screenshotIndex: [{
        referenceId: "pin-789",
        url: "https://www.pinterest.com/pin/789/",
        sourceUrl: "https://www.pinterest.com/pin/999/",
        path: "visual-evidence/pin-789/viewport.png",
        sha256: "b".repeat(64),
        bytes: 4096,
        warnings: []
      }]
    })).toEqual(expect.objectContaining({
      productSuccess: false,
	      snapshotReadyReferenceCount: 0,
	      authoritativeReferenceCount: 0
	    }));

	    expect(deriveInspiredesignProductReadinessFields({
	      nextStepGuidance: { readiness: "ready" },
	      rankedReferences: [{
	        id: "board-reference",
	        url: "https://www.pinterest.com/couture/atelier/",
	        evidenceAuthority: "snapshot_ready"
	      }],
	      screenshotIndex: [{
	        referenceId: "board-reference",
	        url: "https://www.pinterest.com/couture/atelier/",
	        sourceUrl: "https://www.pinterest.com/couture/atelier/",
	        path: "visual-evidence/board-reference/viewport.png",
	        sha256: "b".repeat(64),
	        bytes: 4096,
	        warnings: []
	      }]
	    })).toEqual(expect.objectContaining({
	      productSuccess: false,
	      snapshotReadyReferenceCount: 0,
	      authoritativeReferenceCount: 0
	    }));

	    expect(deriveInspiredesignProductReadinessFields({
	      nextStepGuidance: { readiness: "ready" },
      rankedReferences: [{
        id: "pin-video",
        url: "https://www.pinterest.com/pin/456/",
        evidenceAuthority: "motion_ready"
      }],
      motionEvidence: [{
        referenceId: "pin-video",
        url: "https://www.pinterest.com/pin/456/",
        motion: {
	          status: "captured",
	          authority: "design_evidence",
	          diagnostic: false,
	          diagnosticReasons: [],
	          sourceUrl: "https://www.pinterest.com/pin/456/",
	          startedSourceUrl: "https://www.pinterest.com/pin/456/",
	          endedSourceUrl: "https://www.pinterest.com/pin/999/",
	          frameCount: 3,
	          replay: { path: "motion-evidence/pin-video/replay.json", sha256: "e".repeat(64), bytes: 64 },
	          preview: { path: "motion-evidence/pin-video/preview.png", sha256: "f".repeat(64), bytes: 2048 }
	        }
	      }]
	    })).toEqual(expect.objectContaining({
      productSuccess: false,
      motionReadyReferenceCount: 0,
      authoritativeReferenceCount: 0
    }));
  });

  it("rejects Pinterest motion authority with diagnostic reasons, unstable provenance, or controls-only warnings", () => {
    const rankedReferences = [{
      id: "pin-motion-tight",
      url: "https://www.pinterest.com/pin/456/",
      evidenceAuthority: "motion_ready"
    }];
    const baseMotion = {
      status: "captured",
      authority: "design_evidence",
      diagnostic: false,
      diagnosticReasons: [],
      sourceUrl: "https://www.pinterest.com/pin/456/",
      startedSourceUrl: "https://www.pinterest.com/pin/456/",
      endedSourceUrl: "https://www.pinterest.com/pin/456/",
      pinterestPageQuality: "pin_media",
      startedPinterestPageQuality: "pin_media",
      endedPinterestPageQuality: "pin_media",
      frameCount: 3,
      replay: { path: "motion-evidence/pin-motion-tight/replay.json", sha256: "e".repeat(64), bytes: 64 },
      preview: { path: "motion-evidence/pin-motion-tight/preview.png", sha256: "f".repeat(64), bytes: 2048 }
    };
    const deriveWithMotion = (motion: Record<string, unknown>) => deriveInspiredesignProductReadinessFields({
      nextStepGuidance: { readiness: "ready" },
      rankedReferences,
      motionEvidence: [{
        referenceId: "pin-motion-tight",
        url: "https://www.pinterest.com/pin/456/",
        motion
      }]
    });

    expect(deriveWithMotion({ ...baseMotion, diagnosticReasons: ["motion_source_changed"] })).toEqual(expect.objectContaining({
      productSuccess: false,
      motionReadyReferenceCount: 0,
      authoritativeReferenceCount: 0
    }));
    expect(deriveWithMotion({ ...baseMotion, sourceUrl: undefined })).toEqual(expect.objectContaining({
      productSuccess: false,
      motionReadyReferenceCount: 0,
      authoritativeReferenceCount: 0
    }));
    expect(deriveWithMotion({ ...baseMotion, startedSourceUrl: "https://www.pinterest.com/pin/999/" })).toEqual(expect.objectContaining({
      productSuccess: false,
      motionReadyReferenceCount: 0,
      authoritativeReferenceCount: 0
    }));
    for (const warning of ["controls-only overlay", "controls only overlay", "controls_only overlay"]) {
      expect(deriveWithMotion({ ...baseMotion, warnings: [warning] })).toEqual(expect.objectContaining({
        productSuccess: false,
        motionReadyReferenceCount: 0,
        authoritativeReferenceCount: 0
      }));
    }
  });

	it("rejects Pinterest authority when page quality is missing or login challenged", () => {
	const snapshotReference = {
		id: "pin-quality-snapshot",
		url: "https://www.pinterest.com/pin/789/",
		evidenceAuthority: "snapshot_ready"
	};
	const validScreenshot = {
		referenceId: "pin-quality-snapshot",
		url: "https://www.pinterest.com/pin/789/",
		sourceUrl: "https://www.pinterest.com/pin/789/",
		path: "visual-evidence/pin-quality-snapshot/viewport.png",
		sha256: "a".repeat(64),
		bytes: 4096,
		warnings: []
	};

	expect(deriveInspiredesignProductReadinessFields({
		nextStepGuidance: { readiness: "ready" },
		rankedReferences: [snapshotReference],
		screenshotIndex: [validScreenshot]
	})).toEqual(expect.objectContaining({
		productSuccess: false,
		snapshotReadyReferenceCount: 0,
		authoritativeReferenceCount: 0
	}));

	expect(deriveInspiredesignProductReadinessFields({
		nextStepGuidance: { readiness: "ready" },
		rankedReferences: [snapshotReference],
		screenshotIndex: [{ ...validScreenshot, pinterestPageQuality: "login_challenge" }]
	})).toEqual(expect.objectContaining({
		productSuccess: false,
		snapshotReadyReferenceCount: 0,
		authoritativeReferenceCount: 0
	}));

	const motionReference = {
		id: "pin-quality-motion",
		url: "https://www.pinterest.com/pin/456/",
		evidenceAuthority: "motion_ready"
	};
	const validMotion = {
		status: "captured",
		authority: "design_evidence",
		diagnostic: false,
		diagnosticReasons: [],
		sourceUrl: "https://www.pinterest.com/pin/456/",
		startedSourceUrl: "https://www.pinterest.com/pin/456/",
		endedSourceUrl: "https://www.pinterest.com/pin/456/",
		frameCount: 3,
		replay: { path: "motion-evidence/pin-quality-motion/replay.json", sha256: "e".repeat(64), bytes: 64 },
		preview: { path: "motion-evidence/pin-quality-motion/preview.png", sha256: "f".repeat(64), bytes: 2048 }
	};

	expect(deriveInspiredesignProductReadinessFields({
		nextStepGuidance: { readiness: "ready" },
		rankedReferences: [motionReference],
		motionEvidence: [{
		referenceId: "pin-quality-motion",
		url: "https://www.pinterest.com/pin/456/",
		motion: validMotion
		}]
	})).toEqual(expect.objectContaining({
		productSuccess: false,
		motionReadyReferenceCount: 0,
		authoritativeReferenceCount: 0
	}));

	expect(deriveInspiredesignProductReadinessFields({
		nextStepGuidance: { readiness: "ready" },
		rankedReferences: [motionReference],
		motionEvidence: [{
		referenceId: "pin-quality-motion",
		url: "https://www.pinterest.com/pin/456/",
		motion: {
			...validMotion,
			pinterestPageQuality: "pin_media",
			startedPinterestPageQuality: "pin_media",
			endedPinterestPageQuality: "login_challenge"
		}
		}]
	})).toEqual(expect.objectContaining({
		productSuccess: false,
		motionReadyReferenceCount: 0,
		authoritativeReferenceCount: 0
	}));
	});

  it("treats direct and meta readiness counts without ranked reference arrays as diagnostic-only", () => {
    expect(deriveInspiredesignProductReadinessFields({
      readiness: "ready",
      rankedReferenceCount: 2,
      snapshotReadyReferenceCount: 1,
      motionReadyReferenceCount: 1,
      authoritativeReferenceCount: 2,
      qualitySummary: { missingScreenshotCount: 0 }
    })).toEqual(expect.objectContaining({
      productSuccess: false,
      evidenceAuthority: "diagnostic_only",
      authoritativeReferenceCount: 0,
      snapshotReadyReferenceCount: 0,
      motionReadyReferenceCount: 0
    }));

    expect(deriveInspiredesignProductReadinessFields({
      meta: {
        nextStepGuidance: { readiness: "ready" },
        rankedReferenceCount: 1,
        snapshotReadyReferenceCount: 0,
        motionReadyReferenceCount: 1,
        authoritativeReferenceCount: 1,
        metrics: { missing_screenshot_count: 0 }
      }
    })).toEqual(expect.objectContaining({
      productSuccess: false,
      evidenceAuthority: "diagnostic_only",
      motionReadyReferenceCount: 0,
      authoritativeReferenceCount: 0
    }));

    expect(deriveInspiredesignProductReadinessFields({
      meta: {
        nextStepGuidance: { readiness: "ready" },
        rankedReferenceCount: 1,
        qualitySummary: { missingScreenshotCount: 1 }
      },
      doNotProceedIf: ["screenshot paths are missing when visual evidence was required"]
    })).toEqual(expect.objectContaining({
      productSuccess: false,
      evidenceAuthority: "diagnostic_only"
    }));

    expect(deriveInspiredesignProductReadinessFields({
      meta: {
        nextStepGuidance: { readiness: "ready" },
        rankedReferences: [{
          url: "https://example.com/reference",
          capturedVia: ["fetch"]
        }],
        quality: { missingScreenshotCount: 0 }
      }
    })).toEqual(expect.objectContaining({
      rankedReferenceCount: 1,
      productSuccess: false,
      evidenceAuthority: "diagnostic_only"
    }));

    expect(deriveInspiredesignProductReadinessFields({
      meta: {
        nextStepGuidance: { readiness: "ready" },
        rankedReferences: [{
          url: "https://example.com/meta-reference",
          capturedVia: ["fetch"]
        }],
        qualitySummary: { missingScreenshotCount: 0 }
      }
    })).toEqual(expect.objectContaining({
      rankedReferenceCount: 1,
      authoritativeReferenceCount: 0,
      productSuccess: false,
      evidenceAuthority: "diagnostic_only"
    }));

    expect(deriveInspiredesignProductReadinessFields({
      readiness: "ready",
      rankedReferenceCount: 1,
      snapshotReadyReferenceCount: 1,
      authoritativeReferenceCount: 1,
      missingScreenshotCount: 0,
      doNotProceedIf: ["screenshot paths are missing when visual evidence was required"]
    })).toEqual(expect.objectContaining({
      productSuccess: false,
      evidenceAuthority: "diagnostic_only",
      snapshotReadyReferenceCount: 0,
      authoritativeReferenceCount: 0
    }));

    expect(deriveInspiredesignProductReadinessFields({
      readiness: "ready",
      rankedReferenceCount: 1,
      snapshotReadyReferenceCount: 1,
      authoritativeReferenceCount: 1,
      metrics: { missing_screenshot_count: 1 },
      doNotProceedIf: ["screenshot paths are missing when visual evidence was required"]
    })).toEqual(expect.objectContaining({
      productSuccess: false,
      evidenceAuthority: "diagnostic_only"
    }));

    expect(deriveInspiredesignProductReadinessFields({
      meta: {
        nextStepGuidance: { readiness: "ready" },
        rankedReferences: "not-an-array",
        rankedReferenceCount: 1,
        snapshotReadyReferenceCount: 1,
        authoritativeReferenceCount: 1
      },
      missingScreenshotCount: "unknown",
      qualitySummary: { missingScreenshotCount: 0 }
    })).toEqual(expect.objectContaining({
      productSuccess: false,
      rankedReferenceCount: 1,
      evidenceAuthority: "diagnostic_only",
      snapshotReadyReferenceCount: 0,
      authoritativeReferenceCount: 0
    }));

    expect(deriveInspiredesignProductReadinessFields({
      readiness: "ready",
      pinterestEvidenceRequired: true,
      rankedReferenceCount: 1,
      pinterestRankedReferenceCount: 1,
      snapshotReadyReferenceCount: 1,
      authoritativeReferenceCount: 1,
      missingScreenshotCount: 0
    })).toEqual(expect.objectContaining({
      productSuccess: false,
      artifactAuthority: "diagnostic_only",
      evidenceAuthority: "diagnostic_only",
      snapshotReadyReferenceCount: 0,
      authoritativeReferenceCount: 0
    }));
  });

  it("keeps inactive blocker and direct builder branches explicit", () => {
    expect(isInactiveInspiredesignCanvasDoNotProceedCondition("planStatus is not accepted", 0)).toBe(true);
    expect(isInactiveInspiredesignCanvasDoNotProceedCondition("rankedReferences is empty", 1)).toBe(true);
    expect(isInactiveInspiredesignCanvasDoNotProceedCondition("rankedReferences is empty", 0)).toBe(false);
    expect(isInactiveInspiredesignCanvasDoNotProceedCondition(
      "screenshot paths are missing when visual evidence was required",
      1,
      1
    )).toBe(false);
    expect(hasActiveInspiredesignCanvasDoNotProceedBlocker(["custom blocker"], 1, 0)).toBe(true);

    expect(buildInspiredesignProductReadinessFields("ready", 1, 1, 0, false, 0, 0, 1)).toEqual(expect.objectContaining({
      productSuccess: false,
      evidenceAuthority: "diagnostic_only"
    }));
    expect(buildInspiredesignProductReadinessFields("ready", 1, 0, 1, false, 0, 1, 1)).toEqual(expect.objectContaining({
      productSuccess: true,
      evidenceAuthority: "motion_ready"
    }));
    expect(buildInspiredesignProductReadinessFields("ready", 1, 1, 0, false, 0, 0, 1, true)).toEqual(expect.objectContaining({
      productSuccess: false,
      artifactAuthority: "diagnostic_only",
      evidenceAuthority: "diagnostic_only"
    }));

    expect(deriveInspiredesignProductReadinessFields({
      nextStepGuidance: { readiness: "ready" },
      pinterestEvidenceRequired: true,
      rankedReferences: [{
        url: "https://example.com/reference",
        capturedVia: ["fetch"]
      }],
      qualitySummary: { missingScreenshotCount: 0 }
    })).toEqual(expect.objectContaining({
      productSuccess: false,
      rankedReferenceCount: 1,
      authoritativeReferenceCount: 0
    }));
  });

  it("requires persisted artifacts for generic references when Pinterest harvest authority is mixed", () => {
    const genericReference = { url: "https://example.com/reference" };

    expect(isInspiredesignAuthoritativeRankedReference(
      { url: "ftp://example.com/reference" }
    )).toBe(false);
    expect(isInspiredesignAuthoritativeRankedReference(
      genericReference,
      { requireArtifactEvidence: true }
    )).toBe(false);
    const genericScreenshotArtifact = {
      url: "https://example.com/reference",
      path: "visual-evidence/example/full_page.png",
      sha256: "b".repeat(64),
      bytes: 1,
      warnings: []
    };

    expect(isInspiredesignAuthoritativeRankedReference(
      genericReference,
      {
        requireArtifactEvidence: true,
        screenshots: [genericScreenshotArtifact]
      }
    )).toBe(false);
    for (const sourceUrl of ["https://example.com/other", "ftp://example.com/reference"]) {
      expect(isInspiredesignAuthoritativeRankedReference(
        genericReference,
        {
          requireArtifactEvidence: true,
          screenshots: [{ ...genericScreenshotArtifact, sourceUrl }]
        }
      )).toBe(false);
    }
    expect(isInspiredesignAuthoritativeRankedReference(
      genericReference,
      {
        requireArtifactEvidence: true,
        screenshots: [{ ...genericScreenshotArtifact, sourceUrl: "https://example.com/reference" }]
      }
    )).toBe(true);
    expect(isInspiredesignAuthoritativeRankedReference(
      genericReference,
      {
        requireArtifactEvidence: true,
        motions: [{
          url: "https://example.com/reference",
        motion: {
          status: "captured",
          authority: "design_evidence",
          diagnostic: false,
          diagnosticReasons: [],
          sourceUrl: "https://example.com/reference",
          startedSourceUrl: "https://example.com/reference",
          endedSourceUrl: "https://example.com/reference",
          frameCount: 1,
          replay: { path: "motion-evidence/example/replay.json", sha256: "c".repeat(64), bytes: 64 },
          preview: { path: "motion-evidence/example/preview.png", sha256: "d".repeat(64), bytes: 2048 }
        }
      }]
      }
    )).toBe(true);

    for (const motion of [
      {
        status: "captured",
        authority: "design_evidence",
        diagnostic: false,
        diagnosticReasons: [],
        frameCount: 1,
        replay: { path: "motion-evidence/example/replay.json", sha256: "c".repeat(64), bytes: 64 },
        preview: { path: "motion-evidence/example/preview.png", sha256: "d".repeat(64), bytes: 2048 }
      },
      {
        status: "captured",
        authority: "design_evidence",
        diagnostic: false,
        diagnosticReasons: [],
        sourceUrl: "https://example.com/reference",
        startedSourceUrl: "https://example.com/other",
        endedSourceUrl: "https://example.com/reference",
        frameCount: 1,
        replay: { path: "motion-evidence/example/replay.json", sha256: "c".repeat(64), bytes: 64 },
        preview: { path: "motion-evidence/example/preview.png", sha256: "d".repeat(64), bytes: 2048 }
      }
    ]) {
      expect(isInspiredesignAuthoritativeRankedReference(
        genericReference,
        {
          requireArtifactEvidence: true,
          motions: [{ url: "https://example.com/reference", motion }]
        }
      )).toBe(false);
    }

    expect(deriveInspiredesignProductReadinessFields({
      nextStepGuidance: { readiness: "ready" },
      rankedReferences: [genericReference],
      motionEvidence: [{
        url: "https://example.com/reference",
        motion: {
          status: "captured",
          authority: "design_evidence",
          diagnostic: false,
          diagnosticReasons: [],
          sourceUrl: "https://example.com/reference",
          startedSourceUrl: "https://example.com/reference",
          endedSourceUrl: "https://example.com/reference",
          frameCount: 1,
          replay: { path: "motion-evidence/example/replay.json", sha256: "c".repeat(64), bytes: 64 },
          preview: { path: "motion-evidence/example/preview.png", sha256: "d".repeat(64), bytes: 2048 }
        }
      }]
    })).toEqual(expect.objectContaining({
      productSuccess: true,
      authoritativeReferenceCount: 1,
      motionReadyReferenceCount: 1,
      evidenceAuthority: "motion_ready"
    }));

    expect(deriveInspiredesignProductReadinessFields({
      nextStepGuidance: { readiness: "ready", doNotProceedIf: [] },
      rankedReferences: [
        {
          id: "pin",
          url: "https://www.pinterest.com/pin/123/",
          evidenceAuthority: "snapshot_ready"
        },
        genericReference
      ],
      screenshotIndex: [{
        referenceId: "pin",
        url: "https://www.pinterest.com/pin/123/",
        sourceUrl: "https://www.pinterest.com/pin/123/",
		pinterestPageQuality: "pin_media",
        path: "visual-evidence/pin/viewport.png",
        sha256: "a".repeat(64),
        bytes: 2048,
        warnings: []
      }],
      qualitySummary: { missingScreenshotCount: 0 }
    })).toEqual(expect.objectContaining({
      productSuccess: false,
      artifactAuthority: "diagnostic_only",
      authoritativeReferenceCount: 1
    }));
  });

  it("rejects malformed artifact authority branches explicitly", () => {
    const pinterestSnapshotReference = {
      id: "pin-snapshot",
      url: "https://www.pinterest.com/pin/111/",
      evidenceAuthority: "snapshot_ready"
    };
    const pinterestMotionReference = {
      id: "pin-motion",
      url: "https://www.pinterest.com/pin/222/",
      evidenceAuthority: "motion_ready"
    };
    const genericReference = { id: "generic", url: "https://example.com/reference" };

    expect(isInspiredesignAuthoritativeRankedReference(
      pinterestSnapshotReference,
      {
        screenshots: [{
          referenceId: "pin-snapshot",
          url: "https://www.pinterest.com/pin/111/",
          sourceUrl: "not-a-url",
          path: "visual-evidence/pin-snapshot/viewport.png",
          sha256: "c".repeat(64),
          bytes: 4096,
          warnings: []
        }]
      }
    )).toBe(false);
    expect(isInspiredesignAuthoritativeRankedReference(
      pinterestSnapshotReference,
      {
        screenshots: [{
          referenceId: "pin-snapshot",
          url: "https://www.pinterest.com/pin/111/",
          sourceUrl: undefined,
          path: "visual-evidence/pin-snapshot/viewport.png",
          sha256: "c".repeat(64),
          bytes: 4096,
          warnings: []
        }]
      }
    )).toBe(false);
    expect(isInspiredesignAuthoritativeRankedReference(
      pinterestMotionReference,
      {
        motions: [{
          referenceId: "pin-motion",
          url: "https://www.pinterest.com/pin/222/",
          motion: {
            status: "captured",
            authority: "design_evidence",
            diagnostic: false,
            sourceUrl: "https://www.pinterest.com/pin/222/",
            frameCount: 1,
            replay: { path: "motion-evidence/pin-motion/replay.json" },
            preview: { path: "motion-evidence/pin-motion/replay.html" }
          }
        }]
      }
    )).toBe(false);
    expect(isInspiredesignAuthoritativeRankedReference(
      pinterestMotionReference,
      {
        motions: [{
          referenceId: "other-motion",
          url: "https://www.pinterest.com/pin/999/",
          motion: {
            status: "captured",
            authority: "design_evidence",
            diagnostic: false,
            sourceUrl: "https://www.pinterest.com/pin/999/",
            frameCount: 1,
            replay: { path: "motion-evidence/pin-motion/replay.json" },
            preview: { path: "motion-evidence/pin-motion/preview.png" }
          }
        }]
      }
    )).toBe(false);
    expect(isInspiredesignAuthoritativeRankedReference(
      genericReference,
      {
        requireArtifactEvidence: true,
        motions: [
          { referenceId: "other", url: "https://example.com/other", motion: {} },
          {
            referenceId: "generic",
            motion: {
            status: "captured",
            authority: "design_evidence",
            diagnostic: false,
            diagnosticReasons: [],
            sourceUrl: "https://example.com/reference",
            startedSourceUrl: "https://example.com/reference",
            endedSourceUrl: "https://example.com/reference",
            failure: "failed",
            frameCount: 1,
              replay: { path: "motion-evidence/generic/replay.json" },
              preview: { path: "motion-evidence/generic/preview.png" }
            }
          },
          {
            referenceId: "generic",
            motion: {
              status: "captured",
              authority: "design_evidence",
              diagnostic: false,
              diagnosticReasons: [],
              sourceUrl: "https://example.com/reference",
              startedSourceUrl: "https://example.com/reference",
              endedSourceUrl: "https://example.com/reference",
              frameCount: 0,
              replay: { path: "motion-evidence/generic/replay.json" },
              preview: { path: "motion-evidence/generic/preview.png" }
            }
          },
          {
            referenceId: "generic",
            motion: {
              status: "captured",
              authority: "design_evidence",
              diagnostic: false,
              diagnosticReasons: [],
              sourceUrl: "https://example.com/reference",
              startedSourceUrl: "https://example.com/reference",
              endedSourceUrl: "https://example.com/reference",
              frameCount: 1,
              replay: { path: "motion-evidence/generic/replay.html" },
              preview: { path: "motion-evidence/generic/preview.png" }
            }
          }
        ]
      }
    )).toBe(false);

    expect(deriveInspiredesignProductReadinessFields({
      meta: {
        nextStepGuidance: { readiness: "ready" },
        rankedReferences: "not-an-array"
      }
    })).toEqual(expect.objectContaining({
      rankedReferenceCount: 0,
      productSuccess: false
    }));
  });

  it("rejects motion authority when replay or preview metadata is weak", () => {
    const reference = {
      id: "pin-motion",
      url: "https://www.pinterest.com/pin/222/",
      evidenceAuthority: "motion_ready"
    };
    const baseMotion = {
      status: "captured",
      authority: "design_evidence",
      diagnostic: false,
      diagnosticReasons: [],
      sourceUrl: "https://www.pinterest.com/pin/222/",
      frameCount: 2
    };

    expect(isInspiredesignAuthoritativeRankedReference(reference, {
      motions: [{
        referenceId: "pin-motion",
        url: "https://www.pinterest.com/pin/222/",
        motion: {
          ...baseMotion,
          replay: { path: "motion-evidence/pin-motion/replay.json" },
          preview: { path: "motion-evidence/pin-motion/preview.png" }
        }
      }]
    })).toBe(false);
    expect(isInspiredesignAuthoritativeRankedReference(reference, {
      motions: [{
        referenceId: "pin-motion",
        url: "https://www.pinterest.com/pin/222/",
        motion: {
          ...baseMotion,
          replay: { path: "motion-evidence/pin-motion/replay.json", sha256: "e".repeat(64), bytes: 64 },
          preview: { path: "motion-evidence/pin-motion/preview.png", sha256: "f".repeat(64), bytes: 12 }
        }
      }]
    })).toBe(false);
  });

  it("derives authority from meta-level persisted artifact indexes", () => {
    expect(deriveInspiredesignProductReadinessFields({
      meta: {
        nextStepGuidance: { readiness: "ready" },
        rankedReferences: [{
          id: "meta-pin",
          url: "https://www.pinterest.com/pin/333/",
          evidenceAuthority: "snapshot_ready"
        }],
        screenshotIndex: [{
          referenceId: "meta-pin",
          url: "https://www.pinterest.com/pin/333/",
          sourceUrl: "https://www.pinterest.com/pin/333/",
			pinterestPageQuality: "pin_media",
          path: "visual-evidence/meta-pin/viewport.png",
          sha256: "d".repeat(64),
          bytes: 4096,
          warnings: []
        }]
      }
    })).toEqual(expect.objectContaining({
      productSuccess: true,
      snapshotReadyReferenceCount: 1,
      authoritativeReferenceCount: 1
    }));

    expect(deriveInspiredesignProductReadinessFields({
      meta: {
        nextStepGuidance: { readiness: "ready" },
        rankedReferences: [{
          id: "meta-motion-pin",
          url: "https://www.pinterest.com/pin/444/",
          evidenceAuthority: "motion_ready"
        }],
        motionEvidence: [{
          referenceId: "meta-motion-pin",
          url: "https://www.pinterest.com/pin/444/",
          motion: {
            status: "captured",
            authority: "design_evidence",
	            diagnostic: false,
	            diagnosticReasons: [],
	            sourceUrl: "https://www.pinterest.com/pin/444/",
	            startedSourceUrl: "https://www.pinterest.com/pin/444/",
	            endedSourceUrl: "https://www.pinterest.com/pin/444/",
	pinterestPageQuality: "pin_media",
	startedPinterestPageQuality: "pin_media",
	endedPinterestPageQuality: "pin_media",
	            frameCount: 2,
            replay: { path: "motion-evidence/meta-motion-pin/replay.json", sha256: "e".repeat(64), bytes: 64 },
            preview: { path: "motion-evidence/meta-motion-pin/preview.png", sha256: "f".repeat(64), bytes: 2048 }
          }
        }]
      }
    })).toEqual(expect.objectContaining({
      productSuccess: true,
      motionReadyReferenceCount: 1,
      authoritativeReferenceCount: 1
    }));
  });
});

describe("inspiredesign meta prompt branch coverage", () => {
  it("surfaces ranked references that are captured but not design-ready", () => {
    const reference: InspiredesignReferencePatternBoard["references"][number] = {
      id: "pin-low-confidence",
      rank: 1,
      score: 42,
      confidence: 0.42,
      name: "Low confidence pin",
      url: "https://www.pinterest.com/pin/123/",
      surfaceType: "pin",
      capturedVia: ["fetch", "visual", "snapshot_ready"],
      evidenceAuthority: "snapshot_ready",
      intentMatched: true,
      selectionReason: "Captured but below ranking threshold.",
      visualStrengths: ["editorial fabric study"],
      visualRisks: ["too narrow for landing-page direction"],
      layoutRecipe: "A centered pin detail with limited surrounding context.",
      contentHierarchy: ["hero image"],
      componentFamilies: ["media module"],
      motionPosture: ["static"],
      tokenNotes: ["soft neutral palette"],
      patternsToBorrow: ["fabric texture"],
      patternsToReject: ["Pinterest shell chrome"],
      whyItWorks: "The image has useful material cues but not enough page evidence."
    };
    const board: InspiredesignReferencePatternBoard = {
      briefId: "brief",
      targetSurface: "landing_page",
      qualitySummary: {
        rankedReferenceCount: 1,
        rejectedReferenceCount: 0,
        failedCaptureCount: 0,
        missingScreenshotCount: 0,
        attemptedReferenceCount: 1,
        allAttemptFailedCaptureCount: 0,
        allAttemptMissingScreenshotCount: 0,
        allAttemptVisualFailureCount: 0,
        allAttemptMotionFailureCount: 0,
        diagnosticOnlyReasons: []
      },
      references: [reference],
      rejectedReferences: [],
      synthesis: {
        dominantDirection: "Brief-led couture editorial direction",
        sharedStrengths: ["material texture"],
        sharedFailuresToAvoid: ["chrome-only evidence"],
        contractDeltas: ["Treat the pin as not ready for synthesis."]
      }
    };
    const designVectors: InspiredesignDesignVectors = {
      sourcePriority: "brief-only",
      directionLabel: "Couture atelier",
      surfaceIntent: "landing page",
      compositionModel: ["editorial hero"],
      premiumPosture: ["refined"],
      motionPosture: ["subtle"],
      sectionArchitecture: ["hero", "lookbook"],
      typographyPosture: ["editorial serif"],
      imageryPosture: ["fabric-led"],
      interactionDensity: "low",
      interactionMoments: ["gentle reveal"],
      materialEffects: ["soft grain"],
      advancedMotionAdvisory: ["keep motion bounded"],
      referenceInfluence: ["limited"],
      patternsToBorrow: ["fabric texture"],
      patternsToReject: ["Pinterest shell chrome"],
      guardrails: ["do not copy the pin"],
      antiPatterns: ["chrome-only screenshots"]
    };

    expect(buildInspiredesignMetaPrompt({
      brief: "Fashion design studio landing page",
      briefExpansion: expandInspiredesignBrief("Fashion design studio landing page"),
      referencePatternBoard: board,
      designVectors
    })).toContain("1 ranked reference(s) were not ready for creative synthesis");
  });
});

describe("Pinterest media and motion evidence branch coverage", () => {
  it("normalizes motion evidence safety boundaries", () => {
    expect(sanitizeInspiredesignMotionReferenceId("...")).toBe("reference");
    expect(sanitizeInspiredesignMotionReferenceId("   ")).toBe("reference");
    expect(sanitizeInspiredesignMotionReferenceId(` ${"a".repeat(120)} `)).toHaveLength(96);
    expect(buildMotionEvidenceArtifactPath("pin/1", "../secret.txt")).toBe("motion-evidence/pin-1/replay.json");
    expect(buildMotionEvidenceArtifactPath("pin/1", "   ")).toBe("motion-evidence/pin-1/replay.json");
    expect(buildMotionEvidenceArtifactPath("pin/1", "replay.json")).toBe("motion-evidence/pin-1/replay.json");
    expect(buildMotionEvidenceArtifactPath("pin/1", "frames/frame-01.png")).toBe("motion-evidence/pin-1/frames/frame-01.png");

    expect(persistInspiredesignMotionEvidence({
      status: "captured",
      kind: "screencast",
      capturedAt: "not a date",
      frameCount: Number.NaN,
      warnings: ["Controls_Only overlay", "/Users/example/private-file"],
      diagnosticReasons: ["  explicit reason  "],
      replay: { path: "motion-evidence/.../replay.json" },
      replayHtml: { path: "motion-evidence/ref/replay.html" },
      preview: { path: "data:image/png;base64,AAAA" }
    })).toEqual(expect.objectContaining({
      capturedAt: "1970-01-01T00:00:00.000Z",
      frameCount: 0,
      diagnostic: true,
      diagnosticReasons: expect.arrayContaining(["explicit reason", "zero_frame_capture", "controls_only_capture"]),
      replayHtml: { path: "motion-evidence/ref/replay.html" }
    }));

    for (const warning of ["controls-only overlay", "controls only overlay", "controls_only overlay"]) {
      expect(persistInspiredesignMotionEvidence({
        status: "captured",
        kind: "screencast",
        capturedAt: "2026-05-24T12:00:00.000Z",
        frameCount: 2,
        warnings: [warning],
        diagnosticReasons: [],
        replay: { path: "motion-evidence/ref/replay.json" },
        preview: { path: "motion-evidence/ref/preview.png" }
      })).toEqual(expect.objectContaining({
        diagnostic: true,
        diagnosticReasons: expect.arrayContaining(["controls_only_capture"]),
        authority: "diagnostic"
      }));
    }

    expect(persistInspiredesignMotionEvidence({
      status: "captured",
      kind: "screencast",
      capturedAt: "2026-05-24T12:00:00.000Z",
      frameCount: 2,
      warnings: "not-an-array",
      replay: { path: "motion-evidence/ref/replay.json" },
      preview: { path: "motion-evidence/ref/preview.png" }
    })).toEqual(expect.objectContaining({
      capturedAt: "2026-05-24T12:00:00.000Z",
      frameCount: 2,
      diagnostic: false,
      diagnosticReasons: [],
      authority: "design_evidence"
    }));

    expect(persistInspiredesignMotionEvidence({
      status: "skipped",
      kind: "screencast",
      capturedAt: "/Users/example/private-timestamp",
      frameCount: 1,
      warnings: [],
      failure: "data:image/png;base64,unsafe",
      diagnostic: false,
      diagnosticReasons: []
    })).toEqual(expect.objectContaining({
      status: "skipped",
      capturedAt: "1970-01-01T00:00:00.000Z",
      diagnostic: false,
      authority: "diagnostic"
    }));
  });

  it("covers Pinterest classification strategy fallbacks", () => {
	expect(isInspiredesignPinterestOwnedReferenceUrl(undefined)).toBe(false);
    expect(isInspiredesignPinterestOwnedReferenceUrl("not a url")).toBe(false);
    expect(isInspiredesignPinterestPinReferenceUrl("https://www.pinterest.com/search/pins/?q=studio")).toBe(false);
    expect(isInspiredesignAuthoritativeRankedReference({
      id: "generic-ref",
      url: "https://example.com/reference",
      evidenceAuthority: "diagnostic_only"
    }, { requireArtifactEvidence: true })).toBe(false);
    expect(isInspiredesignAuthoritativeRankedReference({
      id: "generic-ref",
      url: "https://example.com/reference",
      evidenceAuthority: "diagnostic_only"
    })).toBe(false);

    expect(classifyPinterestCandidate({
      url: "https://www.pinterest.com/source/example.com/",
      content: "visual search source page"
    })).toEqual(expect.objectContaining({
      kind: "source_page",
      diagnosticBlockers: ["source_page_requires_concrete_pin_extraction"]
    }));
    expect(classifyPinterestCandidate({
      url: "https://www.pinterest.com/"
    })).toEqual(expect.objectContaining({
      kind: "source_page",
      productCandidate: false,
      sourcePageQuality: "unknown",
      diagnosticBlockers: ["source_page_requires_concrete_pin_extraction"]
    }));
    expect(classifyPinterestCandidate({
      url: "https://www.pinterest.com/pin/123/",
      content: "watch this pin video"
    })).toEqual(expect.objectContaining({
      kind: "unknown_pin",
      productCandidate: false,
      sourcePageQuality: "unknown",
      diagnosticBlockers: ["pin_media_type_unproven"]
    }));
    expect(classifyPinterestCandidate({
      url: "https://www.pinterest.com/pin/123/",
      html: "<main><video data-test-id=\"video\" src=\"pin.mp4\"></video></main>"
    })).toEqual(expect.objectContaining({
      kind: "video_pin",
      productCandidate: true,
      sourcePageQuality: "pin_media"
    }));
    expect(classifyPinterestCandidate({
      url: "https://www.pinterest.com/pin/123/",
      allowPinMediaPageQuality: false,
      html: "<main><video data-test-id=\"video\" src=\"pin.mp4\"></video></main>"
    })).toEqual(expect.objectContaining({
      kind: "video_pin",
      productCandidate: true,
      sourcePageQuality: "unknown"
    }));
    expect(classifyPinterestCandidate({
      url: "https://www.pinterest.com/pin/123/",
      content: "Search results for couture atelier with pin card suggestions When autocomplete results are available",
      html: "<main><img data-test-id=\"closeup-image\" src=\"pin.jpg\" /></main>"
    })).toEqual(expect.objectContaining({
      kind: "shell",
      productCandidate: false,
      sourcePageQuality: "search_shell",
      diagnosticBlockers: ["search_shell_without_media_signals"]
    }));
    expect(classifyPinterestCandidate({
      url: "https://www.pinterest.com/pin/123/",
      content: "Pinterest"
    })).toEqual(expect.objectContaining({
      kind: "unknown_pin",
      productCandidate: false,
      sourcePageQuality: "unknown",
      diagnosticBlockers: ["pin_media_type_unproven"]
    }));
    expect(classifyPinterestCandidate({
      url: "https://www.pinterest.com/pin/123/",
      content: "Search results for couture atelier with pin card suggestions"
    })).toEqual(expect.objectContaining({
      kind: "shell",
      productCandidate: false,
      sourcePageQuality: "search_shell",
      diagnosticBlockers: ["search_shell_without_media_signals"]
    }));
    expect(classifyPinterestCandidate({
      url: "https://www.pinterest.com/pin/123/",
      content: "Log in to continue with a video pin"
    })).toEqual(expect.objectContaining({
      kind: "login_challenge",
      productCandidate: false,
      sourcePageQuality: "login_challenge",
      diagnosticBlockers: ["login_or_challenge_blocks_reference_extraction"]
    }));
    expect(classifyPinterestCandidate({
      url: "https://www.pinterest.com/source/example.com/",
      html: "<div data-grid>Log in to continue</div>"
    })).toEqual(expect.objectContaining({
      sourcePageQuality: "login_challenge"
    }));
    expect(classifyPinterestSourcePage([
      {
        url: "https://www.pinterest.com/pin/123/",
        html: "<div data-grid data-test-id=\"pinwrapper\">Pin wrapper</div>"
      },
      {
        url: "https://www.pinterest.com/pin/456/",
        content: "Log in to continue"
      }
    ])).toEqual(expect.objectContaining({
      kind: "login_challenge",
      sourcePageQuality: "login_challenge"
    }));
	expect(classifyPinterestSourcePage([
		{
		url: "https://www.pinterest.com/pin/789/",
		html: "<img data-test-id=\"closeup-image\" src=\"pin.jpg\" alt=\"atelier reference\" />"
		}
	])).toEqual(expect.objectContaining({
		kind: "image_pin",
		productCandidate: true,
		sourcePageQuality: "unknown"
	}));
    expect(classifyPinterestSourcePage([])).toEqual(expect.objectContaining({ kind: "invalid" }));
    expect(shouldBlockPinterestSourceExtraction(classifyPinterestCandidate({
      url: "https://www.pinterest.com/search/pins/?q=studio",
      content: "Your profile"
    }))).toBe(true);
    expect(summarizePinterestClassifications([
      classifyPinterestCandidate({ url: "https://www.pinterest.com/pin/1/" }),
      classifyPinterestCandidate({ url: "https://www.pinterest.com/ideas/studio/2/" })
    ])).toEqual(expect.objectContaining({ unknown_pin: 1, idea_page: 1 }));
    expect(resolvePinterestPrimaryCaptureStrategy([], "deep")).toBe("deep_diagnostics");
    expect(resolvePinterestPrimaryCaptureStrategy(["https://example.com/not-pinterest"], "off")).toBe("capture_off");
    expect(resolvePinterestPrimaryCaptureStrategy(["https://www.pinterest.com/pin/1/?video pin"], "deep")).toBe("source_diagnostic");
    expect(resolvePinterestPrimaryCaptureStrategy(["https://www.pinterest.com/pin/1/?video pin"], "off")).toBe("source_diagnostic");
    expect(resolvePinterestPrimaryCaptureStrategy(["https://www.pinterest.com/pin/1/"], "deep")).toBe("source_diagnostic");
    expect(resolvePinterestPrimaryCaptureStrategy(["https://www.pinterest.com/pin/1/"], "off")).toBe("source_diagnostic");
    expect(resolvePinterestPrimaryCaptureStrategy(["https://www.pinterest.com/studio/board/"], "off")).toBe("source_diagnostic");
    expect(resolvePinterestPrimaryCaptureStrategy(["not-a-url"], "deep")).toBe("deep_diagnostics");
    expect(classifyPinterestCandidate({ url: undefined })).toEqual(expect.objectContaining({ kind: "invalid" }));
  });
});
