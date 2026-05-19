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
});
