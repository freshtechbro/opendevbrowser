import { describe, expect, it } from "vitest";
import { buildChallengeEvidenceBundle, buildHumanYieldPacket, shouldYieldToHuman } from "../src/challenges";

const makeBundle = (args: {
  url?: string;
  title?: string;
  snapshot: string;
  challengeId?: string;
  ownerSurface?: "direct_browser" | "ops" | "provider_fallback";
}) => buildChallengeEvidenceBundle({
  status: {
    mode: "extension",
    activeTargetId: "tab-1",
    url: args.url,
    title: args.title,
    meta: {
      blockerState: "active",
      ...(args.challengeId || args.ownerSurface ? {
        challenge: {
          ...(args.challengeId ? { challengeId: args.challengeId } : {}),
          blockerType: "auth_required",
          ownerSurface: args.ownerSurface ?? "direct_browser",
          resumeMode: "manual",
          status: "active",
          updatedAt: "2026-03-22T00:00:00.000Z",
          preserveUntil: "2026-03-22T00:15:00.000Z",
          verifyUntil: "2026-03-22T00:05:00.000Z"
        }
      } : {})
    }
  },
  snapshot: {
    content: args.snapshot
  }
});

describe("challenge human-yield gate", () => {
  it("yields for secret-entry boundaries and returns a reclaimable packet", () => {
    const bundle = makeBundle({
      url: "https://example.com/login",
      title: "Sign in",
      snapshot: "[r1] textbox \"Password\"\n[r2] button \"Continue\"",
      challengeId: "challenge-yield"
    });
    const interpretation = {
      classification: "auth_required" as const,
      authState: "credentials_required" as const,
      humanBoundary: "secret_entry" as const,
      requiredVerification: "full" as const,
      continuityOpportunities: [],
      allowedActionFamilies: ["auth_navigation", "verification", "debug_trace"] as const,
      laneHints: ["human_yield"] as const,
      stopRisk: "high" as const,
      summary: "classification=auth_required",
      likelyCheckpoint: "r2"
    };

    expect(shouldYieldToHuman({
      interpretation,
      noProgressExhausted: false
    })).toEqual({
      yield: true,
      reason: "secret_entry"
    });

    const packet = buildHumanYieldPacket({
      bundle,
      interpretation,
      sessionId: "session-yield",
      targetId: "tab-1",
      reason: "secret_entry",
      verification: {
        status: "yield_required",
        reason: "Human authority boundary detected: secret_entry."
      }
    });

    expect(packet.challengeId).toBe("challenge-yield");
    expect(packet.ownerSurface).toBe("direct_browser");
    expect(packet.lastVerificationStatus).toBe("yield_required");
    expect(packet.requiredHumanStep).toContain("secret-bearing credentials");
    expect(packet.expectedPostAuthCheckpoint).toBe("r2");
    expect(packet.resumeRule).toContain("manager-owned verification");
  });

  it("forces a yield when the bounded loop exhausts progress and falls back to bundle metadata", () => {
    const bundle = makeBundle({
      snapshot: "[r1] button \"Continue\"",
      ownerSurface: "ops"
    });
    const interpretation = {
      classification: "checkpoint_or_friction" as const,
      authState: "unknown" as const,
      humanBoundary: "none" as const,
      requiredVerification: "full" as const,
      continuityOpportunities: [],
      allowedActionFamilies: ["verification"] as const,
      laneHints: ["generic_browser_autonomy"] as const,
      stopRisk: "medium" as const,
      summary: "classification=checkpoint_or_friction",
      likelyCheckpoint: "r1"
    };

    expect(shouldYieldToHuman({
      interpretation,
      noProgressExhausted: true
    })).toEqual({
      yield: true,
      reason: "exhausted_no_progress"
    });

    const packet = buildHumanYieldPacket({
      bundle,
      interpretation,
      sessionId: "session-no-progress",
      reason: "exhausted_no_progress"
    });

    expect(packet.challengeId).toMatch(/^challenge-/);
    expect(packet.ownerSurface).toBe("ops");
    expect(packet.targetId).toBe("tab-1");
    expect(packet.requiredHumanStep).toBe("Review the page state and continue when ready.");
  });

  it("specializes MFA and unsupported third-party guidance", () => {
    const bundle = makeBundle({
      url: "https://example.com/challenge",
      title: "Security check",
      snapshot: "[r4] button \"Verify you're human\""
    });
    const interpretation = {
      classification: "unsupported_third_party_challenge" as const,
      authState: "human_verification" as const,
      humanBoundary: "unsupported_third_party" as const,
      requiredVerification: "full" as const,
      continuityOpportunities: [],
      allowedActionFamilies: ["verification"] as const,
      laneHints: ["human_yield"] as const,
      stopRisk: "high" as const,
      summary: "classification=unsupported_third_party_challenge",
      likelyCheckpoint: undefined
    };

    const mfaPacket = buildHumanYieldPacket({
      bundle,
      interpretation,
      sessionId: "session-mfa",
      reason: "mfa"
    });
    const unsupportedPacket = buildHumanYieldPacket({
      bundle,
      interpretation,
      sessionId: "session-third-party",
      reason: "unsupported_third_party"
    });

    expect(mfaPacket.requiredHumanStep).toContain("Complete MFA");
    expect(unsupportedPacket.requiredHumanStep).toContain("unsupported third-party challenge");
  });
});
