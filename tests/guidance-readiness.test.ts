import { describe, expect, it } from "vitest";
import { classifyGuidanceReadiness } from "../src/guidance/readiness";
import type { GuidanceContext } from "../src/guidance/types";

const context = (overrides: Partial<GuidanceContext>): GuidanceContext => ({
  workflow: "inspiredesign",
  ...overrides
});

describe("classifyGuidanceReadiness", () => {
  it("classifies ready evidence", () => {
    expect(classifyGuidanceReadiness(context({
      evidence: { referenceCount: 2, rankedReferenceCount: 2, topReferenceScore: 82, topReferenceConfidence: 0.82 }
    }))).toBe("ready");
  });

  it("classifies missing input", () => {
    expect(classifyGuidanceReadiness(context({ reasonCode: "missing_input" }))).toBe("needs_input");
    expect(classifyGuidanceReadiness({
      workflow: "cli",
      reasonCode: "missing_params"
    })).toBe("needs_input");
  });

  it("classifies provider blockers", () => {
    expect(classifyGuidanceReadiness(context({ providerUnavailable: true }))).toBe("blocked");
    expect(classifyGuidanceReadiness(context({ reasonCode: "provider_unavailable" }))).toBe("blocked");
  });

  it("classifies daemon fingerprint mismatch as blocked", () => {
    expect(classifyGuidanceReadiness({
      workflow: "daemon",
      reasonCode: "daemon_fingerprint_mismatch"
    })).toBe("blocked");
  });

  it("classifies diagnostic-only evidence", () => {
    expect(classifyGuidanceReadiness(context({
      evidence: { referenceCount: 1, rankedReferenceCount: 0, diagnosticOnlyReasons: ["cookie_or_consent_modal"] }
    }))).toBe("diagnostic_only");
  });

  it("classifies weak and empty evidence as recovery", () => {
    expect(classifyGuidanceReadiness(context({ evidence: { referenceCount: 0 } }))).toBe("needs_recovery");
    expect(classifyGuidanceReadiness(context({ evidence: { rankedReferenceCount: 0 } }))).toBe("needs_recovery");
    expect(classifyGuidanceReadiness(context({
      evidence: { referenceCount: 0, referenceEvidenceRequired: false }
    }))).toBe("ready");
    expect(classifyGuidanceReadiness(context({
      evidence: { referenceEvidenceRequired: false }
    }))).toBe("ready");
    expect(classifyGuidanceReadiness(context({
      evidence: { referenceCount: 1, rankedReferenceCount: 1, topReferenceScore: 22, topReferenceConfidence: 0.22 }
    }))).toBe("needs_recovery");
  });

  it("classifies high-quality off-brief evidence as recovery", () => {
    expect(classifyGuidanceReadiness(context({
      evidence: {
        referenceCount: 1,
        rankedReferenceCount: 1,
        topReferenceScore: 82,
        topReferenceConfidence: 0.82,
        topReferenceIntentMatched: false
      }
    }))).toBe("needs_recovery");
  });

  it("classifies no-ranked, missing-screenshot, auth-required, and boundary evidence branches", () => {
    expect(classifyGuidanceReadiness(context({
      reasonCode: "auth_required",
      evidence: { referenceCount: 1, rankedReferenceCount: 1, topReferenceScore: 80, topReferenceConfidence: 0.8 }
    }))).toBe("blocked");
    expect(classifyGuidanceReadiness(context({
      evidence: { referenceCount: 1, rankedReferenceCount: 0, diagnosticOnlyReasons: [] }
    }))).toBe("needs_recovery");
    expect(classifyGuidanceReadiness(context({
      evidence: { referenceCount: 1, diagnosticOnlyReasons: [] }
    }))).toBe("needs_recovery");
    expect(classifyGuidanceReadiness(context({
      evidence: {
        referenceCount: 1,
        rankedReferenceCount: 1,
        topReferenceScore: 80,
        topReferenceConfidence: 0.8,
        visualEvidenceRequired: true,
        missingScreenshotCount: 1
      }
    }))).toBe("needs_recovery");
    expect(classifyGuidanceReadiness(context({
      evidence: {
        referenceCount: 1,
        rankedReferenceCount: 1,
        topReferenceScore: 50,
        topReferenceConfidence: 0.5,
        visualEvidenceRequired: false,
        failedCaptureCount: 1
      }
    }))).toBe("ready");
  });

  it("covers diagnostic, capture, and weak-reference branch boundaries", () => {
    expect(classifyGuidanceReadiness(context({}))).toBe("needs_recovery");
    expect(classifyGuidanceReadiness(context({
      evidence: {
        referenceCount: 1,
        diagnosticOnlyReasons: ["blocked_shell"]
      }
    }))).toBe("diagnostic_only");
    expect(classifyGuidanceReadiness(context({
      evidence: {
        referenceCount: 1,
        rankedReferenceCount: 1,
        diagnosticOnlyReasons: ["cookie_or_consent_modal"],
        topReferenceScore: 80,
        topReferenceConfidence: 0.8
      }
    }))).toBe("ready");
    expect(classifyGuidanceReadiness(context({
      evidence: {
        referenceCount: 1,
        rankedReferenceCount: 1,
        visualEvidenceRequired: true,
        failedCaptureCount: 1,
        topReferenceScore: 80,
        topReferenceConfidence: 0.8
      }
    }))).toBe("needs_recovery");
    expect(classifyGuidanceReadiness(context({
      evidence: {
        referenceCount: 1,
        rankedReferenceCount: 1,
        topReferenceScore: 80,
        topReferenceConfidence: 0.2
      }
    }))).toBe("needs_recovery");
    expect(classifyGuidanceReadiness(context({
      evidence: {
        referenceCount: 1,
        rankedReferenceCount: 1
      }
    }))).toBe("needs_recovery");
    expect(classifyGuidanceReadiness(context({
      evidence: {
        referenceCount: 1,
        rankedReferenceCount: 1,
        diagnosticOnlyReasons: ["blocked_shell"],
        visualEvidenceRequired: true,
        failedCaptureCount: 0,
        missingScreenshotCount: 0,
        topReferenceScore: 80
      }
    }))).toBe("needs_recovery");
    expect(classifyGuidanceReadiness(context({
      evidence: {
        referenceCount: 1,
        rankedReferenceCount: 1,
        visualEvidenceRequired: true,
        topReferenceScore: 80,
        topReferenceConfidence: 0.8
      }
    }))).toBe("ready");
    expect(classifyGuidanceReadiness(context({
      evidence: {
        referenceCount: 1,
        rankedReferenceCount: 1,
        topReferenceConfidence: 0.8
      }
    }))).toBe("needs_recovery");
  });
});
