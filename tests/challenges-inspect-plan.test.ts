import { describe, expect, it, vi } from "vitest";
import {
  buildChallengeActionSuggestions,
  buildChallengeEvidenceBundle,
  buildChallengeInspectPlan,
  inspectChallengePlanFromRuntime
} from "../src/challenges";
import type { ChallengeEvidenceBundle, ChallengeStrategyDecision } from "../src/challenges";
import type { ChallengeRuntimeHandle } from "../src/browser/manager-types";
import type { ProvidersChallengeOrchestrationConfig } from "../src/config";

const helperConfig: ProvidersChallengeOrchestrationConfig = {
  mode: "browser_with_helper",
  attemptBudget: 3,
  noProgressLimit: 2,
  stepTimeoutMs: 1000,
  minAttemptGapMs: 0,
  allowAuthNavigation: true,
  allowSessionReuse: true,
  allowCookieReuse: true,
  allowNonSecretFormFill: true,
  allowInteractionExploration: true,
  governed: {
    allowOwnedEnvironmentFixtures: false,
    allowSanctionedIdentity: false,
    allowServiceAdapters: false,
    requireAuditMetadata: true
  },
  optionalComputerUseBridge: {
    enabled: true,
    maxSuggestions: 3
  }
};

const makeBundle = (): ChallengeEvidenceBundle => buildChallengeEvidenceBundle({
  status: {
    mode: "managed",
    activeTargetId: "target-1",
    url: "https://example.com/login",
    title: "Login",
    meta: {
      blockerState: "active",
      blocker: {
        schemaVersion: "1.0",
        type: "auth_required",
        source: "navigation",
        reasonCode: "token_required",
        confidence: 0.9,
        retryable: true,
        detectedAt: "2026-04-15T00:00:00.000Z",
        evidence: { matchedPatterns: [], networkHosts: [] },
        actionHints: []
      }
    }
  },
  snapshot: {
    snapshotId: "snapshot-1",
    content: [
      "[r1] button \"Continue with Google\"",
      "[r2] button \"Next\"",
      "[r3] textbox \"Email\""
    ].join("\n")
  },
  cookieCount: 1,
  canImportCookies: true,
  taskData: {
    email: "person@example.com"
  }
});

const makeDecision = (
  lane: ChallengeStrategyDecision["lane"]
): ChallengeStrategyDecision => ({
  lane,
  rationale: "Exercise inspect-plan coverage.",
  attemptBudget: 1,
  noProgressLimit: 1,
  verificationLevel: "full",
  stopConditions: [],
  allowedActionFamilies: ["auth_navigation", "click_path", "verification"]
});

const makeRuntimeHandle = (): ChallengeRuntimeHandle => ({
  status: vi.fn(async () => ({
    mode: "managed",
    activeTargetId: "target-2",
    url: "https://example.com/login",
    title: "Login",
    meta: {
      blockerState: "active",
      blocker: {
        schemaVersion: "1.0" as const,
        type: "auth_required" as const,
        source: "navigation" as const,
        reasonCode: "token_required" as const,
        confidence: 0.9,
        retryable: true,
        detectedAt: "2026-04-15T00:00:00.000Z",
        evidence: { matchedPatterns: [], networkHosts: [] },
        actionHints: []
      }
    }
  })),
  goto: vi.fn(async () => ({ timingMs: 1 })),
  waitForLoad: vi.fn(async () => ({ timingMs: 1 })),
  snapshot: vi.fn(async () => ({
    snapshotId: "snapshot-runtime",
    content: "[r1] button \"Continue with Google\"",
    warnings: []
  })),
  click: vi.fn(async () => ({ timingMs: 1, navigated: false })),
  hover: vi.fn(async () => ({ timingMs: 1 })),
  press: vi.fn(async () => ({ timingMs: 1 })),
  type: vi.fn(async () => ({ timingMs: 1 })),
  select: vi.fn(async () => undefined),
  scroll: vi.fn(async () => undefined),
  pointerMove: vi.fn(async () => ({ timingMs: 1 })),
  pointerDown: vi.fn(async () => ({ timingMs: 1 })),
  pointerUp: vi.fn(async () => ({ timingMs: 1 })),
  drag: vi.fn(async () => ({ timingMs: 1 })),
  cookieList: vi.fn(async () => ({ count: 0 })),
  cookieImport: vi.fn(async () => ({ imported: 0, rejected: [] })),
  debugTraceSnapshot: vi.fn(async () => ({
    channels: {
      console: { events: [] },
      network: { events: [] },
      exception: { events: [] }
    }
  }))
});

describe("challenge inspect plan surfaces", () => {
  it("builds optional helper suggestions even when executedSteps are omitted", () => {
    const result = buildChallengeActionSuggestions({
      bundle: makeBundle(),
      decision: makeDecision("optional_computer_use_bridge"),
      helperEligibility: {
        allowed: true,
        reason: "Helper bridge remains eligible."
      },
      config: helperConfig
    });

    expect(result.helper.status).toBe("suggested");
    expect(result.suggestedSteps).toEqual([
      {
        kind: "click",
        ref: "r1",
        reason: "Optional bridge suggested a browser-scoped click follow-up from canonical evidence."
      },
      {
        kind: "click",
        ref: "r2",
        reason: "Optional bridge suggested a browser-scoped click follow-up from canonical evidence."
      }
    ]);
  });

  it("omits optional inspect fields when bundle metadata is absent and no stand-down reason applies", () => {
    const bundle: ChallengeEvidenceBundle = {
      ...makeBundle(),
      blocker: undefined,
      blockerState: "clear",
      mode: undefined,
      url: undefined,
      title: undefined,
      activeTargetId: undefined,
      snapshotId: undefined
    };

    const result = buildChallengeInspectPlan({
      bundle,
      config: helperConfig
    });

    expect(result).not.toHaveProperty("sessionMode");
    expect(result).not.toHaveProperty("standDownReason");
    expect(result.evidence).toEqual({
      blockerState: "clear",
      loginRefs: ["r1"],
      sessionReuseRefs: [],
      humanVerificationRefs: [],
      checkpointRefs: ["r1", "r2"]
    });
  });

  it("publishes a stand-down reason when browser mode disables the helper bridge", () => {
    const result = buildChallengeInspectPlan({
      bundle: makeBundle(),
      config: {
        ...helperConfig,
        mode: "browser"
      }
    });

    expect(result.mode).toBe("browser");
    expect(result.standDownReason).toBe("helper_disabled_for_browser_mode");
  });

  it("passes explicit cookie-import policy through runtime inspection", async () => {
    const handle = makeRuntimeHandle();

    const result = await inspectChallengePlanFromRuntime({
      handle,
      sessionId: "session-1",
      targetId: "target-2",
      config: helperConfig,
      canImportCookies: false
    });

    expect(handle.snapshot).toHaveBeenCalledWith(
      "session-1",
      "actionables",
      2400,
      undefined,
      "target-2"
    );
    expect(handle.cookieList).toHaveBeenCalledWith("session-1", ["https://example.com/login"]);
    expect(result.capabilityMatrix.canReuseCookies).toBe(false);
    expect(result.evidence.snapshotId).toBe("snapshot-runtime");
  });

  it("defaults cookie-import capability to true when runtime inspection does not override it", async () => {
    const handle = makeRuntimeHandle();

    const result = await inspectChallengePlanFromRuntime({
      handle,
      sessionId: "session-1",
      targetId: "target-2",
      config: helperConfig
    });

    expect(handle.cookieList).toHaveBeenCalledWith("session-1", ["https://example.com/login"]);
    expect(result.capabilityMatrix.canReuseCookies).toBe(true);
  });
});
