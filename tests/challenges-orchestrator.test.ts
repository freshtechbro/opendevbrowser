import { describe, expect, it, vi } from "vitest";
import { ChallengeOrchestrator, OutcomeRecorder } from "../src/challenges";
import type { ChallengeActionStep } from "../src/challenges";
import type { ChallengeRuntimeHandle } from "../src/browser/manager-types";
import type { ProvidersChallengeOrchestrationConfig } from "../src/config";

const makeConfig = (overrides: Partial<ProvidersChallengeOrchestrationConfig> = {}): ProvidersChallengeOrchestrationConfig => ({
  mode: "browser",
  attemptBudget: 2,
  noProgressLimit: 1,
  stepTimeoutMs: 1000,
  minAttemptGapMs: 60_000,
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

const makeHandle = (options: {
  url?: string;
  title?: string;
  snapshot: string;
  blockerType?: "auth_required" | "anti_bot_challenge";
  reasonCode?: "token_required" | "challenge_detected";
  clearOnRef?: string;
  advanceOnKinds?: ChallengeActionStep["kind"][];
}): ChallengeRuntimeHandle => {
  let cleared = false;
  let stepIndex = 0;
  const shouldAdvance = (kind: ChallengeActionStep["kind"]) => options.advanceOnKinds?.includes(kind) ?? true;
  const maybeAdvance = (kind: ChallengeActionStep["kind"], ref?: string) => {
    if (options.clearOnRef && ref === options.clearOnRef) {
      cleared = true;
    }
    if (shouldAdvance(kind)) {
      stepIndex += 1;
    }
  };

  return {
    status: vi.fn(async () => ({
      mode: "extension",
      activeTargetId: "tab-1",
      ...(options.url === undefined && !cleared ? {} : { url: cleared ? "https://example.com/home" : (options.url ?? `https://example.com/state/${stepIndex}`) }),
      title: cleared ? "Home" : (options.title ?? `State ${stepIndex}`),
      meta: cleared
        ? {
          blockerState: "clear" as const,
          challenge: {
            challengeId: "challenge-1",
            blockerType: options.blockerType ?? "auth_required",
            ownerSurface: "direct_browser" as const,
            resumeMode: "manual" as const,
            status: "verified_clear" as const,
            updatedAt: "2026-03-22T00:00:00.000Z",
            preservedSessionId: "session-1"
          }
        }
        : {
          blockerState: "active" as const,
          blocker: {
            schemaVersion: "1.0" as const,
            type: options.blockerType ?? "auth_required",
            source: "navigation" as const,
            reasonCode: options.reasonCode ?? "token_required",
            confidence: 0.9,
            retryable: true,
            detectedAt: "2026-03-22T00:00:00.000Z",
            evidence: { matchedPatterns: [], networkHosts: [] },
            actionHints: []
          },
          challenge: {
            challengeId: "challenge-1",
            blockerType: options.blockerType ?? "auth_required",
            ownerSurface: "direct_browser" as const,
            resumeMode: "manual" as const,
            status: "active" as const,
            updatedAt: "2026-03-22T00:00:00.000Z",
            preservedSessionId: "session-1"
          }
        }
    })),
    goto: vi.fn(async () => {
      maybeAdvance("goto");
      return { timingMs: 1 };
    }),
    waitForLoad: vi.fn(async () => {
      maybeAdvance("wait");
      return { timingMs: 1 };
    }),
    snapshot: vi.fn(async () => ({
      content: cleared ? "[r9] button \"Done\"" : options.snapshot,
      warnings: []
    })),
    click: vi.fn(async (_sessionId: string, ref: string) => {
      maybeAdvance("click", ref);
      return { timingMs: 1, navigated: false };
    }),
    hover: vi.fn(async (_sessionId: string, ref: string) => {
      maybeAdvance("hover", ref);
      return { timingMs: 1 };
    }),
    press: vi.fn(async () => {
      maybeAdvance("press");
      return { timingMs: 1 };
    }),
    type: vi.fn(async (_sessionId: string, ref: string) => {
      maybeAdvance("type", ref);
      return { timingMs: 1 };
    }),
    select: vi.fn(async () => undefined),
    scroll: vi.fn(async () => {
      maybeAdvance("scroll");
      return undefined;
    }),
    pointerMove: vi.fn(async () => {
      maybeAdvance("pointer");
      return { timingMs: 1 };
    }),
    pointerDown: vi.fn(async () => ({ timingMs: 1 })),
    pointerUp: vi.fn(async () => ({ timingMs: 1 })),
    drag: vi.fn(async () => {
      maybeAdvance("drag");
      return { timingMs: 1 };
    }),
    cookieList: vi.fn(async () => ({ count: cleared ? 2 : stepIndex })),
    cookieImport: vi.fn(async () => ({ imported: 0, rejected: [] })),
    debugTraceSnapshot: vi.fn(async () => ({
      channels: {
        console: { events: [] },
        network: { events: [] },
        exception: { events: [] }
      }
    }))
  };
};

describe("challenge orchestrator", () => {
  it("captures evidence without querying cookies when the page has no URL", async () => {
    const handle = makeHandle({
      url: undefined,
      title: "Detached",
      snapshot: "[r1] heading \"Detached\""
    });
    const orchestrator = new ChallengeOrchestrator(makeConfig());

    const bundle = await orchestrator.captureEvidence({
      handle,
      sessionId: "session-detached",
      canImportCookies: false
    });

    expect(bundle.url).toBeUndefined();
    expect(bundle.continuity.cookieCount).toBe(0);
    expect(handle.cookieList).not.toHaveBeenCalled();
  });

  it("throttles repeated unresolved attempts for the same challenge id", async () => {
    const recorder = new OutcomeRecorder();
    recorder.record({
      at: new Date().toISOString(),
      challengeId: "challenge-1",
      lane: "generic_browser_autonomy",
      status: "still_blocked",
      reason: "previous run",
      attempts: 1,
      reusedExistingSession: false,
      reusedCookies: false,
      verification: {
        status: "still_blocked",
        blockerState: "active",
        changed: false,
        reason: "still blocked"
      },
      evidence: {
        url: "https://example.com/login",
        title: "Sign in",
        blockerType: "auth_required",
        loginRefs: ["r1"],
        humanVerificationRefs: [],
        checkpointRefs: []
      },
      resumeOutcome: "still_blocked",
      executedSteps: []
    });
    const orchestrator = new ChallengeOrchestrator(makeConfig(), recorder);

    const result = await orchestrator.orchestrate({
      handle: makeHandle({
        url: "https://example.com/login",
        snapshot: "[r1] link \"Sign in\""
      }),
      sessionId: "session-throttle",
      canImportCookies: true
    });

    expect(result.action.status).toBe("deferred");
    expect(result.outcome.reason).toContain("Recent attempt throttle");
    expect(recorder.read("challenge-1")).toHaveLength(1);
  });

  it("yields immediately for secret-entry boundaries", async () => {
    const recorder = new OutcomeRecorder();
    const orchestrator = new ChallengeOrchestrator(makeConfig(), recorder);

    const result = await orchestrator.orchestrate({
      handle: makeHandle({
        url: "https://example.com/login",
        title: "Sign in",
        snapshot: "[r1] textbox \"Password\"\n[r2] button \"Continue\""
      }),
      sessionId: "session-secret",
      canImportCookies: true
    });

    expect(result.outcome.status).toBe("yield_required");
    expect(result.outcome.yielded?.requiredHumanStep).toContain("secret-bearing credentials");
    expect(recorder.latest("challenge-1")?.resumeOutcome).toBe("awaiting_human_reclaim");
  });

  it("surfaces manager stand-down reasons when helper eligibility stays otherwise allowed", async () => {
    const orchestrator = new ChallengeOrchestrator(makeConfig({
      mode: "browser_with_helper",
      optionalComputerUseBridge: {
        enabled: true,
        maxSuggestions: 2
      }
    }));

    const result = await orchestrator.orchestrate({
      handle: makeHandle({
        url: "https://example.com/login",
        title: "Continue sign in",
        snapshot: "[r1] link \"Continue to sign in\"",
        clearOnRef: "r1"
      }),
      sessionId: "session-manager-stand-down",
      canImportCookies: true,
      policy: {
        mode: "browser_with_helper",
        source: "session",
        standDownReason: "suppressed_by_manager"
      }
    });

    expect(result.outcome.status).toBe("resolved");
    expect(result.outcome.standDownReason).toBe("suppressed_by_manager");
    expect(result.outcome.helperEligibility.allowed).toBe(true);
  });

  it("runs the optional browser-scoped helper lane when generic autonomy is exhausted", async () => {
    const orchestrator = new ChallengeOrchestrator(makeConfig({
      mode: "browser_with_helper",
      allowAuthNavigation: false,
      allowSessionReuse: false,
      allowCookieReuse: false,
      allowNonSecretFormFill: false,
      allowInteractionExploration: false,
      optionalComputerUseBridge: {
        enabled: true,
        maxSuggestions: 2
      }
    }));

    const result = await orchestrator.orchestrate({
      handle: makeHandle({
        url: "https://example.com/challenge",
        title: "Verification required",
        snapshot: "[r30] button \"Use existing session\"",
        blockerType: "anti_bot_challenge",
        reasonCode: "challenge_detected",
        advanceOnKinds: ["click"]
      }),
      sessionId: "session-helper-lane",
      canImportCookies: true
    });

    expect(result.decision.lane).toBe("optional_computer_use_bridge");
    expect(result.action.executedSteps).toEqual([
      {
        kind: "click",
        ref: "r30",
        reason: "Optional bridge suggested a browser-scoped click follow-up from canonical evidence."
      }
    ]);
  });

  it("blocks governed sanctioned-identity runs without explicit entitlement metadata", async () => {
    const orchestrator = new ChallengeOrchestrator(makeConfig({
      allowAuthNavigation: false,
      allowSessionReuse: false,
      allowCookieReuse: false,
      allowNonSecretFormFill: false,
      allowInteractionExploration: false,
      governed: {
        allowOwnedEnvironmentFixtures: false,
        allowSanctionedIdentity: true,
        allowServiceAdapters: false,
        requireAuditMetadata: true
      }
    }));

    const result = await orchestrator.orchestrate({
      handle: makeHandle({
        url: "https://example.com/challenge",
        title: "Security verification",
        snapshot: "challenge screen",
        blockerType: "anti_bot_challenge",
        reasonCode: "challenge_detected"
      }),
      sessionId: "session-governed",
      canImportCookies: false
    });

    expect(result.outcome.status).toBe("policy_blocked");
    expect(result.outcome.reason).toContain("explicit entitlement metadata");
  });

  it("records defer outcomes when config disables orchestration", async () => {
    const recorder = new OutcomeRecorder();
    const orchestrator = new ChallengeOrchestrator(makeConfig({
      mode: "off"
    }), recorder);

    const result = await orchestrator.orchestrate({
      handle: makeHandle({
        url: "https://example.com/login",
        title: "Sign in",
        snapshot: "[r1] link \"Sign in\""
      }),
      sessionId: "session-defer",
      canImportCookies: true
    });

    expect(result.outcome.status).toBe("deferred");
    expect(recorder.latest("challenge-1")?.resumeOutcome).toBe("deferred");
  });

  it("defaults omitted canImportCookies to false during orchestration capture", async () => {
    const orchestrator = new ChallengeOrchestrator(makeConfig({
      mode: "off"
    }));

    const result = await orchestrator.orchestrate({
      handle: makeHandle({
        url: "https://example.com/login",
        title: "Sign in",
        snapshot: "[r1] link \"Sign in\""
      }),
      sessionId: "session-default-cookies"
    });

    expect(result.bundle.continuity.canImportCookies).toBe(false);
    expect(result.outcome.status).toBe("deferred");
  });

  it("continues through an executed governed lane when entitlement metadata is present", async () => {
    const recorder = new OutcomeRecorder();
    const orchestrator = new ChallengeOrchestrator(makeConfig({
      minAttemptGapMs: 0,
      allowAuthNavigation: false,
      allowSessionReuse: false,
      allowCookieReuse: false,
      allowNonSecretFormFill: false,
      allowInteractionExploration: false,
      governed: {
        allowOwnedEnvironmentFixtures: false,
        allowSanctionedIdentity: true,
        allowServiceAdapters: false,
        requireAuditMetadata: true
      }
    }), recorder);

    const result = await orchestrator.orchestrate({
      handle: makeHandle({
        url: "https://example.com/challenge",
        title: "Security verification",
        snapshot: "challenge screen",
        blockerType: "anti_bot_challenge",
        reasonCode: "challenge_detected",
        advanceOnKinds: []
      }),
      sessionId: "session-governed-pass",
      canImportCookies: false,
      auditContext: {
        identityEntitlement: "employee-sso"
      }
    });

    expect(result.decision.governedLane).toBe("sanctioned_identity");
    expect(result.action.status).toBe("yield_required");
    expect(recorder.latest("challenge-1")?.resumeOutcome).toBe("awaiting_human_reclaim");
  });

  it("records resolved outcomes from bounded browser autonomy", async () => {
    const recorder = new OutcomeRecorder();
    const orchestrator = new ChallengeOrchestrator(makeConfig({
      minAttemptGapMs: 0
    }), recorder);

    const result = await orchestrator.orchestrate({
      handle: makeHandle({
        url: "https://example.com/login",
        title: "Sign in",
        snapshot: "[r1] button \"Use existing session\"",
        clearOnRef: "r1"
      }),
      sessionId: "session-resolve",
      canImportCookies: true
    });

    expect(result.outcome.status).toBe("resolved");
    expect(result.outcome.reusedExistingSession).toBe(true);
    expect(recorder.latest("challenge-1")?.resumeOutcome).toBe("continued");
    expect(orchestrator.getRecorder()).toBe(recorder);
  });

  it("records still_blocked outcomes when attempt budget ends before no-progress exhaustion", async () => {
    const recorder = new OutcomeRecorder();
    const orchestrator = new ChallengeOrchestrator(makeConfig({
      minAttemptGapMs: 0,
      attemptBudget: 1,
      noProgressLimit: 2
    }), recorder);

    const result = await orchestrator.orchestrate({
      handle: makeHandle({
        url: "https://example.com/login",
        title: "Sign in",
        snapshot: "[r1] link \"Sign in\"",
        advanceOnKinds: []
      }),
      sessionId: "session-still-blocked",
      canImportCookies: true
    });

    expect(result.action.status).toBe("still_blocked");
    expect(result.outcome.status).toBe("still_blocked");
    expect(recorder.latest("challenge-1")?.resumeOutcome).toBe("still_blocked");
  });

  it("turns bounded no-progress exhaustion into a reclaimable human yield", async () => {
    const recorder = new OutcomeRecorder();
    const orchestrator = new ChallengeOrchestrator(makeConfig({
      minAttemptGapMs: 0,
      noProgressLimit: 1
    }), recorder);

    const result = await orchestrator.orchestrate({
      handle: makeHandle({
        url: "https://example.com/challenge",
        title: "Continue",
        snapshot: "[r1] button \"Continue\"",
        advanceOnKinds: []
      }),
      sessionId: "session-no-progress",
      canImportCookies: false
    });

    expect(result.action.status).toBe("no_progress");
    expect(result.outcome.status).toBe("yield_required");
    expect(result.outcome.yielded?.reason).toBe("exhausted_no_progress");
    expect(recorder.latest("challenge-1")?.resumeOutcome).toBe("awaiting_human_reclaim");
  });
});
