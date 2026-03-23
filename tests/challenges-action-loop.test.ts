import { describe, expect, it, vi } from "vitest";
import { buildChallengeEvidenceBundle, runChallengeActionLoop } from "../src/challenges";
import type {
  ChallengeActionStep,
  ChallengeEvidenceBundle,
  ChallengeStrategyDecision
} from "../src/challenges";
import type { ChallengeRuntimeHandle } from "../src/browser/manager-types";
import type { ProvidersChallengeOrchestrationConfig } from "../src/config";

const config: ProvidersChallengeOrchestrationConfig = {
  enabled: true,
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
    allowOwnedEnvironmentFixtures: true,
    allowSanctionedIdentity: false,
    allowServiceAdapters: false,
    requireAuditMetadata: true
  },
  optionalComputerUseBridge: {
    enabled: false,
    maxSuggestions: 3
  }
};

const makeBundle = (args: {
  url?: string;
  title?: string;
  snapshot: string;
  cookieCount?: number;
  taskData?: Record<string, string | number | boolean>;
}): ChallengeEvidenceBundle => buildChallengeEvidenceBundle({
  status: {
    mode: "extension",
    activeTargetId: "tab-1",
    url: args.url ?? "https://example.com/login",
    title: args.title ?? "Sign in",
    meta: {
      blockerState: "active",
      blocker: {
        schemaVersion: "1.0",
        type: "auth_required",
        source: "navigation",
        reasonCode: "token_required",
        confidence: 0.9,
        retryable: true,
        detectedAt: "2026-03-22T00:00:00.000Z",
        evidence: { matchedPatterns: [], networkHosts: [] },
        actionHints: []
      },
      challenge: {
        challengeId: "challenge-1",
        blockerType: "auth_required",
        ownerSurface: "direct_browser",
        resumeMode: "manual",
        status: "active",
        updatedAt: "2026-03-22T00:00:00.000Z",
        preservedSessionId: "session-1"
      }
    }
  },
  snapshot: {
    content: args.snapshot
  },
  cookieCount: args.cookieCount ?? 1,
  canImportCookies: true,
  ...(args.taskData ? { taskData: args.taskData } : {})
});

const makeDecision = (
  allowedActionFamilies: ChallengeStrategyDecision["allowedActionFamilies"],
  overrides: Partial<ChallengeStrategyDecision> = {}
): ChallengeStrategyDecision => ({
  lane: "generic_browser_autonomy",
  rationale: "bounded browser action",
  attemptBudget: 1,
  noProgressLimit: 4,
  verificationLevel: "full",
  stopConditions: [],
  allowedActionFamilies,
  ...overrides
});

const makeHandle = (
  initialSnapshot: string,
  options: {
    clearOnRef?: string;
    deferred?: boolean;
    throwKinds?: ChallengeActionStep["kind"][];
    advanceOnKinds?: ChallengeActionStep["kind"][];
  } = {}
): ChallengeRuntimeHandle => {
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
    if (options.throwKinds?.includes(kind)) {
      throw new Error(`${kind} failed`);
    }
  };

  return {
    status: vi.fn(async () => ({
      mode: "extension",
      activeTargetId: "tab-1",
      url: cleared ? "https://example.com/home" : `https://example.com/state/${stepIndex}`,
      title: cleared ? "Home" : `State ${stepIndex}`,
      meta: cleared
        ? { blockerState: "clear" as const }
        : options.deferred
          ? {
            blockerState: "active" as const,
            blockerResolution: {
              status: "deferred" as const,
              reason: "need-human-review"
            },
            blocker: {
              schemaVersion: "1.0" as const,
              type: "auth_required" as const,
              source: "navigation" as const,
              reasonCode: "token_required" as const,
              confidence: 0.9,
              retryable: true,
              detectedAt: "2026-03-22T00:00:00.000Z",
              evidence: { matchedPatterns: [], networkHosts: [] },
              actionHints: []
            },
            challenge: {
              challengeId: "challenge-1",
              blockerType: "auth_required" as const,
              ownerSurface: "direct_browser" as const,
              resumeMode: "manual" as const,
              status: "active" as const,
              updatedAt: "2026-03-22T00:00:00.000Z",
              preservedSessionId: "session-1"
            }
          }
        : {
          blockerState: "active" as const,
          blocker: {
            schemaVersion: "1.0" as const,
            type: "auth_required" as const,
            source: "navigation" as const,
            reasonCode: "token_required" as const,
            confidence: 0.9,
            retryable: true,
            detectedAt: "2026-03-22T00:00:00.000Z",
            evidence: { matchedPatterns: [], networkHosts: [] },
            actionHints: []
          },
          challenge: {
            challengeId: "challenge-1",
            blockerType: "auth_required" as const,
            ownerSurface: "direct_browser" as const,
            resumeMode: "manual" as const,
            status: "active" as const,
            updatedAt: "2026-03-22T00:00:00.000Z",
            preservedSessionId: "session-1"
          }
        }
    })),
    goto: vi.fn(async (_sessionId: string, _url: string) => {
      maybeAdvance("goto");
      return { timingMs: 1 };
    }),
    waitForLoad: vi.fn(async () => {
      maybeAdvance("wait");
      return { timingMs: 1 };
    }),
    snapshot: vi.fn(async () => ({
      content: cleared ? "[r9] button \"Done\"" : initialSnapshot,
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
    select: vi.fn(async () => {
      maybeAdvance("select");
      return undefined;
    }),
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
    cookieList: vi.fn(async () => ({ count: cleared ? 2 : 1 + stepIndex })),
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

describe("challenge action loop", () => {
  it("reuses the existing-session lane and resolves after verification clears the blocker", async () => {
    const result = await runChallengeActionLoop({
      handle: makeHandle("[r1] button \"Use existing session\"\n[r2] link \"Sign in\"", {
        clearOnRef: "r1"
      }),
      sessionId: "session-1",
      initialBundle: makeBundle({
        snapshot: "[r1] button \"Use existing session\"\n[r2] link \"Sign in\""
      }),
      decision: makeDecision(["session_reuse", "click_path", "verification"]),
      config
    });

    expect(result.status).toBe("resolved");
    expect(result.reusedExistingSession).toBe(true);
    expect(result.executedSteps[0]?.ref).toBe("r1");
  });

  it("tries visible auth refs before URL guesses and tracks cookie reuse on auth navigation", async () => {
    const authRefResult = await runChallengeActionLoop({
      handle: makeHandle("[r2] link \"Sign in\""),
      sessionId: "session-login-ref",
      initialBundle: makeBundle({
        snapshot: "[r2] link \"Sign in\""
      }),
      decision: makeDecision(["auth_navigation", "verification"]),
      config
    });
    const gotoResult = await runChallengeActionLoop({
      handle: makeHandle(""),
      sessionId: "session-login-url",
      initialBundle: makeBundle({
        url: "https://example.com/challenge",
        title: "Challenge",
        snapshot: ""
      }),
      decision: makeDecision(["auth_navigation", "verification"]),
      config
    });

    expect(authRefResult.executedSteps[0]).toMatchObject({ kind: "click", ref: "r2" });
    expect(gotoResult.executedSteps[0]).toMatchObject({
      kind: "goto",
      url: "https://example.com/login"
    });
    expect(gotoResult.reusedCookies).toBe(true);
  });

  it("fills non-secret fields from task data and avoids secret-bearing names", async () => {
    const handle = makeHandle("[r3] textbox \"Email\"\n[r4] textbox \"Password\"");
    const result = await runChallengeActionLoop({
      handle,
      sessionId: "session-type",
      initialBundle: makeBundle({
        snapshot: "[r3] textbox \"Email\"\n[r4] textbox \"Password\"",
        taskData: {
          email: "agent@example.com",
          password: "should-not-be-used"
        }
      }),
      decision: makeDecision(["non_secret_form_fill", "verification"]),
      config
    });

    expect(result.executedSteps[0]).toMatchObject({
      kind: "type",
      ref: "r3",
      text: "agent@example.com"
    });
    expect(handle.type).toHaveBeenCalledWith("session-type", "r3", "agent@example.com", true, false, undefined);
  });

  it("explores checkpoint, hover, scroll, press, pointer, and drag paths in bounded order", async () => {
    const checkpoint = await runChallengeActionLoop({
      handle: makeHandle("[r5] button \"Continue\""),
      sessionId: "session-checkpoint",
      initialBundle: makeBundle({
        snapshot: "[r5] button \"Continue\""
      }),
      decision: makeDecision(["click_path", "verification"]),
      config
    });
    const hover = await runChallengeActionLoop({
      handle: makeHandle("[r6] link \"Sign in\""),
      sessionId: "session-hover",
      initialBundle: makeBundle({
        snapshot: "[r6] link \"Sign in\""
      }),
      decision: makeDecision(["hover", "verification"]),
      config
    });
    const scroll = await runChallengeActionLoop({
      handle: makeHandle("", { advanceOnKinds: ["scroll"] }),
      sessionId: "session-scroll",
      initialBundle: makeBundle({
        snapshot: ""
      }),
      decision: makeDecision(["scroll", "verification"], {
        attemptBudget: 2
      }),
      config
    });
    const press = await runChallengeActionLoop({
      handle: makeHandle(""),
      sessionId: "session-press",
      initialBundle: makeBundle({
        snapshot: ""
      }),
      decision: makeDecision(["press", "verification"]),
      config
    });
    const pointer = await runChallengeActionLoop({
      handle: makeHandle(""),
      sessionId: "session-pointer",
      initialBundle: makeBundle({
        snapshot: ""
      }),
      decision: makeDecision(["pointer", "verification"]),
      config
    });
    const drag = await runChallengeActionLoop({
      handle: makeHandle(""),
      sessionId: "session-drag",
      initialBundle: makeBundle({
        snapshot: ""
      }),
      decision: makeDecision(["drag", "verification"]),
      config
    });

    expect(checkpoint.executedSteps[0]).toMatchObject({ kind: "click", ref: "r5" });
    expect(hover.executedSteps[0]).toMatchObject({ kind: "hover", ref: "r6" });
    expect(scroll.executedSteps).toEqual([
      {
        kind: "scroll",
        dy: 900,
        reason: "Scroll down to uncover the next actionable region."
      },
      {
        kind: "scroll",
        dy: -450,
        reason: "Scroll back up to re-evaluate the visible challenge state."
      }
    ]);
    expect(press.executedSteps[0]).toMatchObject({ kind: "press", text: "Tab" });
    expect(pointer.executedSteps[0]).toMatchObject({
      kind: "pointer",
      coordinates: { x: 640, y: 360 }
    });
    expect(drag.executedSteps[0]).toMatchObject({
      kind: "drag",
      coordinates: { x: 640, y: 360 }
    });
  });

  it("falls back to wait and then optional bridge suggestions when no DOM-native step remains", async () => {
    const result = await runChallengeActionLoop({
      handle: makeHandle("[r7] button \"Verify you're human\"", {
        advanceOnKinds: ["wait", "click"]
      }),
      sessionId: "session-bridge",
      initialBundle: makeBundle({
        url: "https://example.com/challenge",
        title: "Challenge",
        snapshot: "[r7] button \"Verify you're human\""
      }),
      decision: makeDecision(["verification"], {
        attemptBudget: 2
      }),
      config: {
        ...config,
        optionalComputerUseBridge: {
          enabled: true,
          maxSuggestions: 1
        }
      }
    });

    expect(result.executedSteps).toEqual([
      {
        kind: "wait",
        reason: "Give the page a short bounded settle window before yielding."
      },
      {
        kind: "click",
        ref: "r7",
        reason: "Optional bridge suggested a browser-scoped click follow-up from canonical evidence."
      }
    ]);
  });

  it("falls through invalid auth and task-data inputs to a bounded wait", async () => {
    const result = await runChallengeActionLoop({
      handle: makeHandle("[r10] textbox \"Password\""),
      sessionId: "session-invalid-inputs",
      initialBundle: makeBundle({
        url: "not-a-valid-url",
        title: "Challenge",
        snapshot: "[r10] textbox \"Password\"",
        taskData: {
          password: "secret",
          profile: JSON.stringify({ invalid: true })
        }
      }),
      decision: makeDecision(["auth_navigation", "non_secret_form_fill", "verification"]),
      config
    });

    expect(result.executedSteps[0]).toEqual({
      kind: "wait",
      reason: "Give the page a short bounded settle window before yielding."
    });
  });

  it("falls through blank auth URLs and filtered task-data entries before coercing numeric non-secret fields", async () => {
    const noUrlOrTaskData = await runChallengeActionLoop({
      handle: makeHandle("[r12] textbox \"Email\""),
      sessionId: "session-empty-url",
      initialBundle: makeBundle({
        url: "",
        title: "Challenge",
        snapshot: "[r12] textbox \"Email\""
      }),
      decision: makeDecision(["auth_navigation", "non_secret_form_fill", "verification"]),
      config
    });
    const sensitiveTaskKey = await runChallengeActionLoop({
      handle: makeHandle("[r13] textbox \"Email\""),
      sessionId: "session-sensitive-task-key",
      initialBundle: makeBundle({
        snapshot: "[r13] textbox \"Email\"",
        taskData: {
          password: "secret"
        }
      }),
      decision: makeDecision(["non_secret_form_fill", "verification"]),
      config
    });
    const unmatchedTaskKey = await runChallengeActionLoop({
      handle: makeHandle("[r14] textbox \"Email\""),
      sessionId: "session-unmatched-task-key",
      initialBundle: makeBundle({
        snapshot: "[r14] textbox \"Email\"",
        taskData: {
          company: "Acme"
        }
      }),
      decision: makeDecision(["non_secret_form_fill", "verification"]),
      config
    });
    const numericTaskValue = await runChallengeActionLoop({
      handle: makeHandle("[r15] textbox \"Company\""),
      sessionId: "session-numeric-task-value",
      initialBundle: makeBundle({
        snapshot: "[r15] textbox \"Company\"",
        taskData: {
          company: 42
        }
      }),
      decision: makeDecision(["non_secret_form_fill", "verification"]),
      config
    });

    expect(noUrlOrTaskData.executedSteps[0]).toEqual({
      kind: "wait",
      reason: "Give the page a short bounded settle window before yielding."
    });
    expect(sensitiveTaskKey.executedSteps[0]).toEqual({
      kind: "wait",
      reason: "Give the page a short bounded settle window before yielding."
    });
    expect(unmatchedTaskKey.executedSteps[0]).toEqual({
      kind: "wait",
      reason: "Give the page a short bounded settle window before yielding."
    });
    expect(numericTaskValue.executedSteps[0]).toMatchObject({
      kind: "type",
      ref: "r15",
      text: "42"
    });
  });

  it("runs suggested steps directly, including select, and swallows step execution errors", async () => {
    const handle = makeHandle("[r8] option \"Canada\"", {
      throwKinds: ["hover"],
      advanceOnKinds: ["select"]
    });
    const suggestedSteps: ChallengeActionStep[] = [
      {
        kind: "select",
        ref: "r8",
        values: ["ca"],
        reason: "Use a suggested dropdown value."
      },
      {
        kind: "hover",
        ref: "r8",
        reason: "Retry with hover."
      }
    ];

    const result = await runChallengeActionLoop({
      handle,
      sessionId: "session-suggested",
      initialBundle: makeBundle({
        snapshot: "[r8] option \"Canada\" value=\"ca\""
      }),
      decision: makeDecision(["verification"], {
        attemptBudget: 2
      }),
      suggestedSteps,
      config
    });

    expect(handle.select).toHaveBeenCalledWith("session-suggested", "r8", ["ca"], undefined);
    expect(handle.hover).toHaveBeenCalledWith("session-suggested", "r8", undefined);
    expect(result.executedSteps).toEqual(suggestedSteps);
  });

  it("skips malformed suggested steps, uses default values, and avoids invalid handler calls", async () => {
    const handle = makeHandle("[r11] button \"Continue\"", {
      advanceOnKinds: ["press", "scroll", "pointer", "drag", "wait"]
    });
    const result = await runChallengeActionLoop({
      handle,
      sessionId: "session-defaults",
      initialBundle: makeBundle({
        snapshot: "[r11] button \"Continue\""
      }),
      decision: makeDecision(["verification"], {
        attemptBudget: 10,
        noProgressLimit: 20
      }),
      suggestedSteps: [
        { kind: "goto", reason: "missing url" },
        { kind: "click", reason: "missing ref" },
        { kind: "hover", reason: "missing ref" },
        { kind: "type", ref: "r11", reason: "missing text" },
        { kind: "select", ref: "r11", reason: "missing values" },
        { kind: "press", reason: "default tab" },
        { kind: "scroll", reason: "default dy" },
        { kind: "pointer", reason: "default coords" },
        { kind: "drag", reason: "default coords" },
        { kind: "wait", reason: "settle" }
      ],
      config
    });

    expect(handle.goto).not.toHaveBeenCalled();
    expect(handle.click).not.toHaveBeenCalled();
    expect(handle.hover).not.toHaveBeenCalled();
    expect(handle.type).not.toHaveBeenCalled();
    expect(handle.select).not.toHaveBeenCalled();
    expect(handle.press).toHaveBeenCalledWith("session-defaults", "Tab", undefined, undefined);
    expect(handle.scroll).toHaveBeenCalledWith("session-defaults", 600, undefined, undefined);
    expect(handle.pointerMove).toHaveBeenCalledWith("session-defaults", 640, 360, undefined, 12);
    expect(handle.drag).toHaveBeenCalledWith(
      "session-defaults",
      { x: 640, y: 240 },
      { x: 640, y: 500 },
      undefined,
      16
    );
    expect(result.executedSteps).toHaveLength(10);
  });

  it("stops after bounded no-progress attempts", async () => {
    const handle = makeHandle("[r1] button \"Use existing session\"", {
      advanceOnKinds: []
    });
    const result = await runChallengeActionLoop({
      handle,
      sessionId: "session-2",
      initialBundle: makeBundle({
        snapshot: "[r1] button \"Use existing session\""
      }),
      decision: makeDecision(["session_reuse", "click_path", "verification"], {
        attemptBudget: 2,
        noProgressLimit: 1
      }),
      config
    });

    expect(result.status).toBe("no_progress");
  });

  it("returns no_progress after an empty optional bridge and surfaces deferred verification results", async () => {
    const exhaustedBridge = await runChallengeActionLoop({
      handle: makeHandle("", {
        advanceOnKinds: ["wait"]
      }),
      sessionId: "session-empty-bridge",
      initialBundle: makeBundle({
        url: "https://example.com/challenge",
        title: "Challenge",
        snapshot: ""
      }),
      decision: makeDecision(["verification"], {
        attemptBudget: 2,
        noProgressLimit: 4
      }),
      config: {
        ...config,
        optionalComputerUseBridge: {
          enabled: true,
          maxSuggestions: 1
        }
      }
    });
    const deferred = await runChallengeActionLoop({
      handle: makeHandle("[r16] link \"Sign in\"", {
        deferred: true
      }),
      sessionId: "session-deferred-verification",
      initialBundle: makeBundle({
        snapshot: "[r16] link \"Sign in\""
      }),
      decision: makeDecision(["auth_navigation", "verification"]),
      config
    });

    expect(exhaustedBridge.status).toBe("no_progress");
    expect(exhaustedBridge.executedSteps).toEqual([
      {
        kind: "wait",
        reason: "Give the page a short bounded settle window before yielding."
      }
    ]);
    expect(deferred.status).toBe("deferred");
    expect(deferred.verification.reason).toContain("deferred");
  });
});
