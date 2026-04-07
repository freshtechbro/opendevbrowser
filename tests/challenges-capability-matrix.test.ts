import { describe, expect, it } from "vitest";
import { buildCapabilityMatrix, buildChallengeEvidenceBundle } from "../src/challenges";
import type { ChallengeInterpreterResult, ChallengePolicyGate } from "../src/challenges";

const baseInterpretation: ChallengeInterpreterResult = {
  classification: "checkpoint_or_friction",
  authState: "unknown",
  humanBoundary: "none",
  requiredVerification: "light",
  continuityOpportunities: [],
  allowedActionFamilies: [],
  laneHints: ["generic_browser_autonomy"],
  stopRisk: "low",
  summary: "classification=checkpoint_or_friction"
};

const secretEntryInterpretation: ChallengeInterpreterResult = {
  ...baseInterpretation,
  humanBoundary: "secret_entry",
  summary: "classification=checkpoint_or_friction;humanBoundary=secret_entry"
};

const buildBundle = (
  snapshot: string,
  blockerState: "active" | "clear" = "active",
  options: {
    canImportCookies?: boolean;
    taskData?: Record<string, string>;
  } = {}
) => buildChallengeEvidenceBundle({
  status: {
    mode: "extension",
    activeTargetId: "tab-1",
    url: "https://example.com/challenge",
    title: "Challenge",
    ...(blockerState === "clear"
      ? {}
      : {
        meta: {
          blockerState,
          blocker: {
            schemaVersion: "1.0",
            type: "anti_bot_challenge",
            source: "navigation",
            reasonCode: "challenge_detected",
            confidence: 0.9,
            retryable: true,
            detectedAt: "2026-03-22T00:00:00.000Z",
            evidence: { matchedPatterns: [], networkHosts: [] },
            actionHints: []
          }
        }
      })
  },
  snapshot: {
    content: snapshot
  },
  canImportCookies: options.canImportCookies,
  ...(options.taskData ? { taskData: options.taskData } : {})
});

const buildGate = (allowedActions: ChallengePolicyGate["allowedActions"], overrides: Partial<ChallengePolicyGate> = {}): ChallengePolicyGate => ({
  allowedActions,
  forbiddenActions: [],
  handoffTriggers: [],
  governedLanes: [],
  optionalComputerUseBridge: false,
  ...overrides
});

describe("challenge capability matrix", () => {
  it("keeps click-path exploration disabled when no safe refs or actionables exist", () => {
    const matrix = buildCapabilityMatrix(
      buildBundle(""),
      baseInterpretation,
      buildGate(["click_path"])
    );

    expect(matrix.canExploreClicks).toBe(false);
    expect(matrix.mustDefer).toBe(false);
  });

  it("enables click-path exploration from checkpoint refs and honors optional bridge gating", () => {
    const matrix = buildCapabilityMatrix(
      buildBundle("[r1] button \"Continue\""),
      baseInterpretation,
      buildGate(["click_path"], { optionalComputerUseBridge: true })
    );

    expect(matrix.canExploreClicks).toBe(true);
    expect(matrix.canUseComputerUseBridge).toBe(true);
  });

  it("stands the helper bridge down when a human boundary is active", () => {
    const matrix = buildCapabilityMatrix(
      buildBundle("[r3] button \"Continue\""),
      secretEntryInterpretation,
      buildGate(["click_path"], { optionalComputerUseBridge: true })
    );

    expect(matrix.canUseComputerUseBridge).toBe(false);
    expect(matrix.helperEligibility).toEqual({
      allowed: false,
      reason: "Helper bridge is blocked by human boundary: secret_entry.",
      standDownReason: "helper_blocked_by_human_boundary"
    });
  });

  it("stands the helper bridge down when canonical evidence exposes no safe helper refs", () => {
    const matrix = buildCapabilityMatrix(
      buildBundle(""),
      baseInterpretation,
      buildGate(["click_path"], { optionalComputerUseBridge: true })
    );

    expect(matrix.canUseComputerUseBridge).toBe(false);
    expect(matrix.helperEligibility).toEqual({
      allowed: false,
      reason: "Canonical evidence did not expose any safe browser-scoped helper actions.",
      standDownReason: "helper_no_safe_actions"
    });
  });

  it("tolerates bundles that have no interaction metadata", () => {
    const bundleWithoutInteraction = {
      ...buildBundle(""),
      interaction: undefined
    };
    const matrix = buildCapabilityMatrix(
      bundleWithoutInteraction as ReturnType<typeof buildBundle>,
      baseInterpretation,
      buildGate(["click_path"], { optionalComputerUseBridge: true })
    );

    expect(matrix.canUseComputerUseBridge).toBe(false);
    expect(matrix.helperEligibility).toEqual({
      allowed: false,
      reason: "Canonical evidence did not expose any safe browser-scoped helper actions.",
      standDownReason: "helper_no_safe_actions"
    });
  });

  it("treats interaction-only refs as safe helper actions", () => {
    const matrix = buildCapabilityMatrix(
      buildBundle("[r20] button \"Press and hold for 1 second\"", "active"),
      baseInterpretation,
      buildGate([], { optionalComputerUseBridge: true })
    );

    expect(matrix.canUseComputerUseBridge).toBe(true);
    expect(matrix.helperEligibility).toEqual({
      allowed: true,
      reason: "Optional helper bridge remains eligible after policy resolution."
    });
  });

  it("enables auth, session, cookie, and non-secret form-fill continuity when evidence supports them", () => {
    const authInterpretation: ChallengeInterpreterResult = {
      ...baseInterpretation,
      classification: "auth_required",
      summary: "classification=auth_required"
    };
    const matrix = buildCapabilityMatrix(
      buildBundle(
        "[r1] link \"Sign in\"\n[r2] button \"Use existing session\"\n[r3] textbox \"Email\"",
        "active",
        {
          canImportCookies: true,
          taskData: { email: "agent@example.com" }
        }
      ),
      authInterpretation,
      buildGate(["auth_navigation", "session_reuse", "cookie_reuse", "non_secret_form_fill"])
    );

    expect(matrix.canNavigateToAuth).toBe(true);
    expect(matrix.canReuseExistingSession).toBe(true);
    expect(matrix.canReuseCookies).toBe(true);
    expect(matrix.canFillNonSecretFields).toBe(true);
  });

  it("defers when the blocker is already clear and no blocker payload remains", () => {
    const matrix = buildCapabilityMatrix(
      buildBundle("[r2] button \"Continue\"", "clear"),
      baseInterpretation,
      buildGate(["click_path"])
    );

    expect(matrix.mustDefer).toBe(true);
  });

  it("defers policy-blocked lanes and honors explicit helper eligibility overrides", () => {
    const policyBlockedInterpretation: ChallengeInterpreterResult = {
      ...baseInterpretation,
      humanBoundary: "policy_blocked",
      summary: "classification=checkpoint_or_friction;humanBoundary=policy_blocked"
    };
    const matrix = buildCapabilityMatrix(
      buildBundle("[r9] button \"Drag the slider\""),
      policyBlockedInterpretation,
      buildGate(["click_path"], {
        helperEligibility: {
          allowed: true,
          reason: "Manager override."
        }
      })
    );

    expect(matrix.canExploreClicks).toBe(true);
    expect(matrix.canUseComputerUseBridge).toBe(false);
    expect(matrix.helperEligibility).toEqual({
      allowed: false,
      reason: "Helper bridge is blocked by human boundary: policy_blocked.",
      standDownReason: "helper_blocked_by_human_boundary"
    });
    expect(matrix.mustDefer).toBe(true);
  });
});
