import { describe, expect, it } from "vitest";
import {
  buildCapabilityMatrix,
  buildChallengeEvidenceBundle,
  buildChallengePolicyGate,
  interpretChallengeEvidence,
  resolveChallengeAutomationPolicy,
  selectChallengeStrategy
} from "../src/challenges";
import type {
  ChallengeAutomationHelperEligibility,
  ChallengeAutomationMode,
  ChallengeCapabilityMatrix,
  ChallengeInterpreterResult,
  ChallengePolicyGate
} from "../src/challenges";
import type { ProvidersChallengeOrchestrationConfig } from "../src/config";

const makeConfig = (overrides: Partial<ProvidersChallengeOrchestrationConfig> = {}): ProvidersChallengeOrchestrationConfig => ({
  mode: "browser",
  attemptBudget: 6,
  noProgressLimit: 3,
  stepTimeoutMs: 5000,
  minAttemptGapMs: 10000,
  allowAuthNavigation: true,
  allowSessionReuse: true,
  allowCookieReuse: true,
  allowNonSecretFormFill: true,
  allowInteractionExploration: true,
  governed: {
    allowOwnedEnvironmentFixtures: true,
    allowSanctionedIdentity: false,
    allowServiceAdapters: false,
    requireAuditMetadata: true
  },
  optionalComputerUseBridge: {
    enabled: false,
    maxSuggestions: 3
  },
  ...overrides
});

const makeBundle = (args: {
  url: string;
  title: string;
  snapshot: string;
  blockerType?: "auth_required" | "anti_bot_challenge";
  reasonCode?: "token_required" | "challenge_detected";
  cookieCount?: number;
  blockerState?: "active" | "clear";
  taskData?: Record<string, string>;
  registryPressure?: {
    providerId: string;
    activeChallenges: number;
    recentChallengeRatio: number;
    recentRateLimitRatio: number;
    cooldownUntilMs: number;
  };
}) => buildChallengeEvidenceBundle({
  status: {
    mode: "extension",
    activeTargetId: "tab-1",
    url: args.url,
    title: args.title,
    meta: {
      blocker: args.blockerType ? {
        schemaVersion: "1.0",
        type: args.blockerType,
        source: "navigation",
        reasonCode: args.reasonCode ?? "token_required",
        confidence: 0.9,
        retryable: true,
        detectedAt: "2026-03-22T00:00:00.000Z",
        evidence: {
          matchedPatterns: [],
          networkHosts: []
        },
        actionHints: []
      } : undefined,
      blockerState: args.blockerState ?? "active"
    }
  },
  snapshot: {
    content: args.snapshot
  },
  cookieCount: args.cookieCount ?? 0,
  canImportCookies: true,
  ...(args.taskData ? { taskData: args.taskData } : {}),
  ...(args.registryPressure ? { registryPressure: args.registryPressure } : {})
});

const makeHelperEligibility = (
  allowed: boolean,
  overrides: Partial<ChallengeAutomationHelperEligibility> = {}
): ChallengeAutomationHelperEligibility => ({
  allowed,
  reason: allowed
    ? "Optional helper bridge remains eligible after mode resolution."
    : "Browser mode keeps the optional helper bridge disabled.",
  ...overrides
});

const makeGate = (
  allowedActions: ChallengePolicyGate["allowedActions"],
  governedLanes: ChallengePolicyGate["governedLanes"] = [],
  options: {
    mode?: ChallengeAutomationMode;
    helperEligibility?: ChallengeAutomationHelperEligibility;
  } = {}
): ChallengePolicyGate => {
  const mode = options.mode ?? "browser";
  const helperEligibility = options.helperEligibility
    ?? (mode === "off"
      ? makeHelperEligibility(false, {
        reason: "Challenge automation mode is off; detection and reporting remain active.",
        standDownReason: "challenge_automation_off"
      })
      : mode === "browser_with_helper"
        ? makeHelperEligibility(true)
        : makeHelperEligibility(false, {
          standDownReason: "helper_disabled_for_browser_mode"
        }));
  return {
    resolvedPolicy: resolveChallengeAutomationPolicy({ configMode: mode }),
    allowedActions,
    forbiddenActions: [],
    handoffTriggers: ["secret_entry", "mfa", "explicit_consent", "policy_blocked", "unsupported_third_party", "exhausted_no_progress"],
    governedLanes,
    optionalComputerUseBridge: helperEligibility.allowed,
    helperEligibility
  };
};

const makeInterpretation = (overrides: Partial<ChallengeInterpreterResult> = {}): ChallengeInterpreterResult => ({
  classification: "checkpoint_or_friction",
  authState: "unknown",
  humanBoundary: "none",
  requiredVerification: "full",
  continuityOpportunities: [],
  allowedActionFamilies: ["verification"],
  laneHints: ["generic_browser_autonomy"],
  stopRisk: "medium",
  summary: "classification=checkpoint_or_friction",
  likelyCheckpoint: undefined,
  ...overrides
});

const disabledHelperEligibility = makeHelperEligibility(false, {
  standDownReason: "helper_disabled_for_browser_mode"
});

const baseCapabilityMatrix: ChallengeCapabilityMatrix = {
  canNavigateToAuth: false,
  canReuseExistingSession: false,
  canReuseCookies: false,
  canFillNonSecretFields: false,
  canExploreClicks: false,
  canUseOwnedEnvironmentFixture: false,
  canUseSanctionedIdentity: false,
  canUseServiceAdapter: false,
  canUseComputerUseBridge: false,
  helperEligibility: disabledHelperEligibility,
  mustYield: false,
  mustDefer: false
};

describe("challenge policy gate", () => {
  it("disables every action when orchestration mode is off", () => {
    const gate = buildChallengePolicyGate(
      makeConfig({ mode: "off" }),
      makeInterpretation()
    );

    expect(gate.allowedActions).toEqual([]);
    expect(gate.forbiddenActions).toContain("verification");
    expect(gate.optionalComputerUseBridge).toBe(false);
    expect(gate.helperEligibility.standDownReason).toBe("challenge_automation_off");
  });

  it("forces helper stand-down in browser mode even when bridge policy is enabled", () => {
    const gate = buildChallengePolicyGate(
      makeConfig({
        mode: "browser",
        optionalComputerUseBridge: {
          enabled: true,
          maxSuggestions: 3
        }
      }),
      makeInterpretation()
    );

    expect(gate.optionalComputerUseBridge).toBe(false);
    expect(gate.helperEligibility.allowed).toBe(false);
    expect(gate.helperEligibility.standDownReason).toBe("helper_disabled_for_browser_mode");
  });

  it("keeps the helper disabled in browser_with_helper mode when bridge policy is off", () => {
    const gate = buildChallengePolicyGate(
      makeConfig({
        mode: "browser_with_helper",
        optionalComputerUseBridge: {
          enabled: false,
          maxSuggestions: 3
        }
      }),
      makeInterpretation()
    );

    expect(gate.optionalComputerUseBridge).toBe(false);
    expect(gate.helperEligibility).toEqual({
      allowed: false,
      reason: "Optional computer-use bridge is disabled by policy.",
      standDownReason: "helper_disabled_by_policy"
    });
  });

  it("removes non-secret form fill for secret boundaries and exposes governed lanes", () => {
    const gate = buildChallengePolicyGate(
      makeConfig({
        mode: "browser_with_helper",
        governed: {
          allowOwnedEnvironmentFixtures: true,
          allowSanctionedIdentity: true,
          allowServiceAdapters: true,
          requireAuditMetadata: true
        },
        optionalComputerUseBridge: {
          enabled: true,
          maxSuggestions: 3
        }
      }),
      makeInterpretation({ humanBoundary: "secret_entry" })
    );

    expect(gate.allowedActions).not.toContain("non_secret_form_fill");
    expect(gate.allowedActions).toContain("dropdown");
    expect(gate.governedLanes).toEqual([
      "owned_environment_fixture",
      "sanctioned_identity",
      "service_adapter"
    ]);
    expect(gate.optionalComputerUseBridge).toBe(true);
    expect(gate.helperEligibility.allowed).toBe(true);
  });
});

describe("challenge capability matrix", () => {
  it("derives continuity, generic exploration, and bridge capabilities from canonical evidence", () => {
    const bundle = makeBundle({
      url: "https://example.com/login",
      title: "Sign in",
      snapshot: [
        "[r1] link \"Sign in\"",
        "[r2] textbox \"Email\"",
        "[r3] button \"Use existing session\"",
        "[r4] button \"Continue\""
      ].join("\n"),
      blockerType: "auth_required",
      cookieCount: 2,
      taskData: {
        email: "agent@example.com"
      }
    });
    const interpretation = makeInterpretation({
      classification: "auth_required",
      authState: "login_page",
      allowedActionFamilies: ["auth_navigation", "session_reuse", "cookie_reuse", "non_secret_form_fill", "click_path", "verification"]
    });
    const gate = makeGate(
      ["auth_navigation", "session_reuse", "cookie_reuse", "non_secret_form_fill", "click_path", "verification"],
      ["owned_environment_fixture"],
      {
        mode: "browser_with_helper",
        helperEligibility: makeHelperEligibility(true)
      }
    );

    const capabilityMatrix = buildCapabilityMatrix(bundle, interpretation, gate);

    expect(capabilityMatrix.canNavigateToAuth).toBe(true);
    expect(capabilityMatrix.canReuseExistingSession).toBe(true);
    expect(capabilityMatrix.canReuseCookies).toBe(true);
    expect(capabilityMatrix.canFillNonSecretFields).toBe(true);
    expect(capabilityMatrix.canExploreClicks).toBe(true);
    expect(capabilityMatrix.canUseComputerUseBridge).toBe(true);
  });

  it("marks yield and defer conditions from interpretation and blocker state", () => {
    const clearBundle = makeBundle({
      url: "https://example.com/app",
      title: "Workspace",
      snapshot: "",
      blockerState: "clear"
    });

    const yieldMatrix = buildCapabilityMatrix(
      clearBundle,
      makeInterpretation({ humanBoundary: "explicit_consent" }),
      makeGate(["verification"])
    );
    const deferMatrix = buildCapabilityMatrix(
      clearBundle,
      makeInterpretation({ humanBoundary: "policy_blocked" }),
      makeGate(["verification"])
    );

    expect(yieldMatrix.mustYield).toBe(true);
    expect(deferMatrix.mustDefer).toBe(true);
  });

  it("treats checkpoint refs as click-exploration evidence even without parsed actionables", () => {
    const bundle = makeBundle({
      url: "https://example.com/challenge",
      title: "Checkpoint",
      snapshot: "[r8] button \"Continue\""
    });

    const capabilityMatrix = buildCapabilityMatrix(
      bundle,
      makeInterpretation(),
      makeGate(["click_path"])
    );

    expect(capabilityMatrix.canExploreClicks).toBe(true);
  });
});

describe("challenge strategy selector", () => {
  it("defers when orchestration mode is off", () => {
    const bundle = makeBundle({
      url: "https://example.com/login",
      title: "Sign in",
      snapshot: "[r1] link \"Sign in\""
    });

    const decision = selectChallengeStrategy({
      config: makeConfig({ mode: "off" }),
      bundle,
      interpretation: makeInterpretation(),
      capabilityMatrix: {
        ...baseCapabilityMatrix,
        helperEligibility: makeHelperEligibility(false, {
          reason: "Challenge automation mode is off; detection and reporting remain active.",
          standDownReason: "challenge_automation_off"
        })
      },
      gate: makeGate([], [], { mode: "off" })
    });

    expect(decision.lane).toBe("defer");
    expect(decision.stopConditions).toContain("challenge_automation_off");
  });

  it("defers when capability evaluation says automation must stop", () => {
    const bundle = makeBundle({
      url: "https://example.com/app",
      title: "Workspace",
      snapshot: ""
    });

    const decision = selectChallengeStrategy({
      config: makeConfig(),
      bundle,
      interpretation: makeInterpretation(),
      capabilityMatrix: {
        ...baseCapabilityMatrix,
        mustDefer: true
      },
      gate: makeGate(["verification"])
    });

    expect(decision.lane).toBe("defer");
    expect(decision.stopConditions).toContain("policy_blocked_or_clear_state");
  });

  it("prefers the owned-environment governed lane for approved fixtures", () => {
    const evidence = makeBundle({
      url: "file:///tmp/recaptcha-v2-checkbox.html",
      title: "recaptcha-v2-checkbox fixture",
      snapshot: "[r1] button \"Verify you're human\"",
      blockerType: "anti_bot_challenge",
      reasonCode: "challenge_detected"
    });
    const interpretation = interpretChallengeEvidence(evidence);
    const gate = buildChallengePolicyGate(makeConfig(), interpretation);
    const capabilityMatrix = buildCapabilityMatrix(evidence, interpretation, gate);

    const decision = selectChallengeStrategy({
      config: makeConfig(),
      bundle: evidence,
      interpretation,
      capabilityMatrix,
      gate
    });

    expect(decision.lane).toBe("owned_environment_fixture");
    expect(decision.governedLane).toBe("owned_environment_fixture");
  });

  it("forces human yield when capability mapping reaches a hard boundary", () => {
    const bundle = makeBundle({
      url: "https://example.com/login",
      title: "Sign in",
      snapshot: "[r1] textbox \"Password\"",
      blockerType: "auth_required"
    });

    const decision = selectChallengeStrategy({
      config: makeConfig(),
      bundle,
      interpretation: makeInterpretation({ humanBoundary: "mfa" }),
      capabilityMatrix: {
        ...baseCapabilityMatrix,
        mustYield: true
      },
      gate: makeGate(["verification"])
    });

    expect(decision.lane).toBe("human_yield");
    expect(decision.stopConditions).toContain("human_authority_required");
  });

  it("keeps generic browser autonomy available under elevated registry pressure when legitimate continuity remains", () => {
    const bundle = makeBundle({
      url: "https://example.com/login",
      title: "Sign in",
      snapshot: "[r1] button \"Use existing session\"",
      blockerType: "auth_required",
      cookieCount: 1,
      registryPressure: {
        providerId: "shopping/temu",
        activeChallenges: 1,
        recentChallengeRatio: 1,
        recentRateLimitRatio: 0.6,
        cooldownUntilMs: Date.now() + 60_000
      }
    });

    const decision = selectChallengeStrategy({
      config: makeConfig(),
      bundle,
      interpretation: makeInterpretation({ classification: "existing_session_reuse" }),
      capabilityMatrix: {
        ...baseCapabilityMatrix,
        canReuseExistingSession: true
      },
      gate: makeGate(["session_reuse", "verification"])
    });

    expect(decision.lane).toBe("generic_browser_autonomy");
    expect(decision.stopConditions).toContain("registry_pressure_elevated");
  });

  it("defers when registry cooldown is active and no continuity lane is available", () => {
    const bundle = makeBundle({
      url: "https://example.com/challenge",
      title: "Security verification",
      snapshot: "[r1] button \"Verify you're human\"",
      blockerType: "anti_bot_challenge",
      reasonCode: "challenge_detected",
      registryPressure: {
        providerId: "shopping/temu",
        activeChallenges: 1,
        recentChallengeRatio: 1,
        recentRateLimitRatio: 0,
        cooldownUntilMs: Date.now() + 60_000
      }
    });

    const decision = selectChallengeStrategy({
      config: makeConfig(),
      bundle,
      interpretation: makeInterpretation(),
      capabilityMatrix: baseCapabilityMatrix,
      gate: makeGate(["verification"])
    });

    expect(decision.lane).toBe("defer");
    expect(decision.stopConditions).toContain("registry_cooldown_active");
  });

  it("routes to the optional bridge when generic DOM autonomy is exhausted", () => {
    const bundle = makeBundle({
      url: "https://example.com/challenge",
      title: "Security verification",
      snapshot: "[r1] button \"Verify you're human\"",
      blockerType: "anti_bot_challenge",
      reasonCode: "challenge_detected"
    });

    const decision = selectChallengeStrategy({
      config: makeConfig({
        mode: "browser_with_helper",
        optionalComputerUseBridge: {
          enabled: true,
          maxSuggestions: 2
        }
      }),
      bundle,
      interpretation: makeInterpretation(),
      capabilityMatrix: {
        ...baseCapabilityMatrix,
        canUseComputerUseBridge: true,
        helperEligibility: makeHelperEligibility(true)
      },
      gate: makeGate(["verification"], [], {
        mode: "browser_with_helper",
        helperEligibility: makeHelperEligibility(true)
      })
    });

    expect(decision.lane).toBe("optional_computer_use_bridge");
  });

  it("uses the default off stand-down reason when the resolved policy omits it", () => {
    const bundle = makeBundle({
      url: "https://example.com/challenge",
      title: "Security verification",
      snapshot: "",
      blockerType: "anti_bot_challenge",
      reasonCode: "challenge_detected"
    });

    const decision = selectChallengeStrategy({
      config: makeConfig({ mode: "off" }),
      bundle,
      interpretation: makeInterpretation(),
      capabilityMatrix: baseCapabilityMatrix,
      gate: {
        ...makeGate([], [], { mode: "off" }),
        resolvedPolicy: {
          mode: "off",
          source: "config"
        }
      }
    });

    expect(decision.lane).toBe("defer");
    expect(decision.stopConditions).toEqual(["challenge_automation_off"]);
  });

  it("falls through to sanctioned identity and service adapters when they are the only governed lanes left", () => {
    const bundle = makeBundle({
      url: "https://example.com/challenge",
      title: "Security verification",
      snapshot: "[r1] button \"Verify you're human\"",
      blockerType: "anti_bot_challenge",
      reasonCode: "challenge_detected"
    });

    const sanctionedDecision = selectChallengeStrategy({
      config: makeConfig(),
      bundle,
      interpretation: makeInterpretation(),
      capabilityMatrix: {
        ...baseCapabilityMatrix,
        canUseSanctionedIdentity: true
      },
      gate: makeGate(["verification"], ["sanctioned_identity"])
    });
    const serviceDecision = selectChallengeStrategy({
      config: makeConfig(),
      bundle,
      interpretation: makeInterpretation(),
      capabilityMatrix: {
        ...baseCapabilityMatrix,
        canUseServiceAdapter: true
      },
      gate: makeGate(["verification"], ["service_adapter"])
    });

    expect(sanctionedDecision.lane).toBe("sanctioned_identity");
    expect(sanctionedDecision.governedLane).toBe("sanctioned_identity");
    expect(serviceDecision.lane).toBe("service_adapter");
    expect(serviceDecision.governedLane).toBe("service_adapter");
  });

  it("yields when no legitimate autonomous lane remains", () => {
    const evidence = makeBundle({
      url: "https://example.com/challenge",
      title: "Security verification",
      snapshot: "[r1] button \"Verify you're human\"",
      blockerType: "anti_bot_challenge",
      reasonCode: "challenge_detected"
    });

    const decision = selectChallengeStrategy({
      config: makeConfig(),
      bundle: evidence,
      interpretation: makeInterpretation(),
      capabilityMatrix: baseCapabilityMatrix,
      gate: makeGate(["verification"])
    });

    expect(decision.lane).toBe("human_yield");
    expect(decision.stopConditions).toContain("no_legitimate_lane_remaining");
  });
});
