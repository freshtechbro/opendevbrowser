import { describe, expect, it, vi } from "vitest";
import { buildChallengeEvidenceBundle, runChallengeActionLoop } from "../src/challenges";
import type {
  ChallengeActionStep,
  ChallengeAutomationHelperEligibility,
  ChallengeEvidenceBundle,
  ChallengeStrategyDecision
} from "../src/challenges";
import type { ChallengeRuntimeHandle } from "../src/browser/manager-types";
import type { ProvidersChallengeOrchestrationConfig } from "../src/config";

const config: ProvidersChallengeOrchestrationConfig = {
  mode: "browser",
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

const deriveHelperEligibility = (
  challengeConfig: ProvidersChallengeOrchestrationConfig
): ChallengeAutomationHelperEligibility => {
  return challengeConfig.optionalComputerUseBridge.enabled
    ? { allowed: true, reason: "Helper bridge enabled for action-loop test coverage." }
    : { allowed: false, reason: "Helper bridge disabled for action-loop test coverage." };
};

const runLoop = (
  args: Omit<Parameters<typeof runChallengeActionLoop>[0], "helperEligibility">
    & { helperEligibility?: ChallengeAutomationHelperEligibility }
) => {
  return runChallengeActionLoop({
    ...args,
    helperEligibility: args.helperEligibility ?? deriveHelperEligibility(args.config)
  });
};

const makeBundle = (args: {
  url?: string;
  title?: string;
  snapshot: string;
  cookieCount?: number;
  taskData?: Record<string, unknown>;
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
    resolveRefPoints?: Record<string, { x: number; y: number }>;
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
    })),
    resolveRefPoint: vi.fn(async (_sessionId: string, ref: string) => (
      options.resolveRefPoints?.[ref] ?? { x: 640, y: 360 }
    ))
  };
};

describe("challenge action loop", () => {
  it("reuses the existing-session lane and resolves after verification clears the blocker", async () => {
    const result = await runLoop({
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
    const authRefResult = await runLoop({
      handle: makeHandle("[r2] link \"Sign in\""),
      sessionId: "session-login-ref",
      initialBundle: makeBundle({
        snapshot: "[r2] link \"Sign in\""
      }),
      decision: makeDecision(["auth_navigation", "verification"]),
      config
    });
    const gotoResult = await runLoop({
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

  it("prefers chooser account rows before the alternate-account path", async () => {
    const result = await runLoop({
      handle: makeHandle([
        "[r1] button \"bishop@example.com\"",
        "[r2] button \"team@example.com\"",
        "[r3] button \"Use another account\""
      ].join("\n"), {
        clearOnRef: "r1"
      }),
      sessionId: "session-chooser",
      initialBundle: makeBundle({
        url: "https://accounts.google.com/v3/signin/identifier",
        title: "Choose an account",
        snapshot: [
          "[r1] button \"bishop@example.com\"",
          "[r2] button \"team@example.com\"",
          "[r3] button \"Use another account\""
        ].join("\n")
      }),
      decision: makeDecision(["session_reuse", "auth_navigation", "verification"]),
      config
    });

    expect(result.executedSteps[0]).toMatchObject({ kind: "click", ref: "r1" });
    expect(result.reusedExistingSession).toBe(true);
  });

  it("prefers Google, then GitHub, then Apple when auth navigation is required", async () => {
    const result = await runLoop({
      handle: makeHandle([
        "[r1] button \"Continue with Apple\"",
        "[r2] button \"Continue with GitHub\"",
        "[r3] button \"Continue with Google\""
      ].join("\n"), {
        clearOnRef: "r3"
      }),
      sessionId: "session-social-auth",
      initialBundle: makeBundle({
        snapshot: [
          "[r1] button \"Continue with Apple\"",
          "[r2] button \"Continue with GitHub\"",
          "[r3] button \"Continue with Google\""
        ].join("\n"),
        cookieCount: 0
      }),
      decision: makeDecision(["auth_navigation", "verification"]),
      config
    });

    expect(result.executedSteps[0]).toMatchObject({ kind: "click", ref: "r3" });
  });

  it("fills non-secret fields from task data and avoids secret-bearing names", async () => {
    const handle = makeHandle("[r3] textbox \"Email\"\n[r4] textbox \"Password\"");
    const result = await runLoop({
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
    expect(handle.type).toHaveBeenCalledWith("session-type", "r3", "agent@example.com", true, false, "tab-1");
  });

  it("chooses a bounded click-and-hold step when the visible challenge requests it", async () => {
    vi.useFakeTimers();
    try {
      const handle = makeHandle("[r30] button \"Press and hold for 1 second\"", {
        advanceOnKinds: ["pointer"],
        resolveRefPoints: {
          r30: { x: 450, y: 275 }
        }
      });
      const pending = runLoop({
        handle,
        sessionId: "session-hold",
        initialBundle: makeBundle({
          url: "https://example.com/challenge",
          title: "Press and hold",
          snapshot: "[r30] button \"Press and hold for 1 second\""
        }),
        decision: makeDecision(["click_and_hold", "pointer", "verification"]),
        config
      });
      await vi.advanceTimersByTimeAsync(1000);
      const result = await pending;

      expect(result.executedSteps[0]).toMatchObject({
        kind: "click_and_hold",
        ref: "r30",
        holdMs: 1000
      });
      expect(handle.resolveRefPoint).toHaveBeenCalledWith("session-hold", "r30", "tab-1");
      expect(handle.pointerDown).toHaveBeenCalledWith("session-hold", 450, 275, "tab-1", "left", 1);
      expect(handle.pointerUp).toHaveBeenCalledWith("session-hold", 450, 275, "tab-1", "left", 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("chooses popup clicks, default hold gestures, drag prompts without refs, and respects explicit target ids", async () => {
    vi.useFakeTimers();
    try {
      const popupResult = await runLoop({
        handle: makeHandle("[r40] dialog \"Choose where you'd like to shop\"\n[r41] button \"Pickup\"", {
          advanceOnKinds: ["click"]
        }),
        sessionId: "session-popup-click",
        initialBundle: makeBundle({
          url: "https://example.com/challenge",
          title: "Choose where you'd like to shop",
          snapshot: "[r40] dialog \"Choose where you'd like to shop\"\n[r41] button \"Pickup\""
        }),
        decision: makeDecision(["click_path", "verification"]),
        config
      });
      const holdHandle = makeHandle("Press and hold to continue.", {
        advanceOnKinds: ["pointer"]
      });
      const holdPending = runLoop({
        handle: holdHandle,
        sessionId: "session-hold-default",
        targetId: "override-target",
        initialBundle: makeBundle({
          url: "https://example.com/challenge",
          title: "Press and hold",
          snapshot: "Press and hold to continue."
        }),
        decision: makeDecision(["click_and_hold", "verification"]),
        config
      });
      await vi.advanceTimersByTimeAsync(1500);
      const holdResult = await holdPending;
      const dragResult = await runLoop({
        handle: makeHandle("Drag the slider to continue.", {
          advanceOnKinds: ["drag"]
        }),
        sessionId: "session-drag-no-ref",
        initialBundle: makeBundle({
          url: "https://example.com/challenge",
          title: "Drag the slider",
          snapshot: "Drag the slider to continue."
        }),
        decision: makeDecision(["drag", "verification"]),
        config
      });

      expect(popupResult.executedSteps[0]).toMatchObject({
        kind: "click",
        ref: "r41"
      });
      expect(holdResult.executedSteps[0]).toMatchObject({
        kind: "click_and_hold",
        holdMs: 1500
      });
      expect(holdHandle.pointerDown).toHaveBeenCalledWith("session-hold-default", 640, 360, "override-target", "left", 1);
      expect(dragResult.executedSteps[0]).toMatchObject({
        kind: "drag",
        coordinates: { x: 640, y: 360 }
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls through popup click prompts with no safe click refs to a bounded wait", async () => {
    const bundle = makeBundle({
      url: "https://example.com/challenge",
      title: "Choose where you'd like to shop",
      snapshot: "[r40] dialog \"Choose where you'd like to shop\""
    });
    const result = await runLoop({
      handle: makeHandle("[r40] dialog \"Choose where you'd like to shop\"", {
        advanceOnKinds: ["wait"]
      }),
      sessionId: "session-popup-no-click-ref",
      initialBundle: {
        ...bundle,
        interaction: {
          ...bundle.interaction,
          surface: "popup",
          preferredAction: "click",
          clickRefs: []
        }
      },
      decision: makeDecision(["click_path", "verification"]),
      config
    });

    expect(result.executedSteps[0]).toEqual({
      kind: "wait",
      reason: "Give the page a short bounded settle window before yielding."
    });
  });

  it("defaults hold timing and falls through repeated hold prompts without refs", async () => {
    vi.useFakeTimers();
    try {
      const handle = makeHandle("Press and hold to continue.");
      const bundle = makeBundle({
        url: "https://example.com/challenge",
        title: "Press and hold",
        snapshot: "Press and hold to continue."
      });
      const { holdMs: _ignoredHoldMs, ...interactionWithoutHoldMs } = bundle.interaction;
      const pending = runLoop({
        handle,
        sessionId: "session-repeat-hold",
        initialBundle: {
          ...bundle,
          interaction: {
            ...interactionWithoutHoldMs,
            preferredAction: "click_and_hold",
            holdRefs: []
          }
        },
        decision: makeDecision(["click_and_hold", "verification"], {
          attemptBudget: 2,
          noProgressLimit: 4
        }),
        config
      });

      await vi.advanceTimersByTimeAsync(1499);
      expect(handle.pointerUp).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      const result = await pending;

      expect(result.executedSteps[0]).toEqual({
        kind: "click_and_hold",
        reason: "Visible challenge requests a bounded click-and-hold gesture."
      });
      expect(result.executedSteps[1]).toEqual({
        kind: "wait",
        reason: "Give the page a short bounded settle window before yielding."
      });
      expect(handle.pointerDown).toHaveBeenCalledWith("session-repeat-hold", 640, 360, "tab-1", "left", 1);
      expect(handle.pointerUp).toHaveBeenCalledWith("session-repeat-hold", 640, 360, "tab-1", "left", 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("chooses drag first when the visible challenge requests a slider-style action", async () => {
    const handle = makeHandle("[r31] button \"Drag the slider\"", {
      advanceOnKinds: ["drag"],
      resolveRefPoints: {
        r31: { x: 520, y: 210 }
      }
    });
    const result = await runLoop({
      handle,
      sessionId: "session-drag",
      initialBundle: makeBundle({
        url: "https://example.com/challenge",
        title: "Drag the slider",
        snapshot: "[r31] button \"Drag the slider\""
      }),
      decision: makeDecision(["drag", "pointer", "verification"]),
      config
    });

    expect(result.executedSteps[0]).toMatchObject({
      kind: "drag",
      ref: "r31"
    });
    expect(handle.resolveRefPoint).toHaveBeenCalledWith("session-drag", "r31", "tab-1");
    expect(handle.drag).toHaveBeenCalledWith(
      "session-drag",
      { x: 520, y: 210 },
      { x: 520, y: 470 },
      "tab-1",
      16
    );
  });

  it("explores checkpoint, hover, scroll, press, pointer, and drag paths in bounded order", async () => {
    const checkpoint = await runLoop({
      handle: makeHandle("[r5] button \"Continue\""),
      sessionId: "session-checkpoint",
      initialBundle: makeBundle({
        snapshot: "[r5] button \"Continue\""
      }),
      decision: makeDecision(["click_path", "verification"]),
      config
    });
    const hover = await runLoop({
      handle: makeHandle("[r6] link \"Sign in\""),
      sessionId: "session-hover",
      initialBundle: makeBundle({
        snapshot: "[r6] link \"Sign in\""
      }),
      decision: makeDecision(["hover", "verification"]),
      config
    });
    const scroll = await runLoop({
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
    const press = await runLoop({
      handle: makeHandle(""),
      sessionId: "session-press",
      initialBundle: makeBundle({
        snapshot: ""
      }),
      decision: makeDecision(["press", "verification"]),
      config
    });
    const pointer = await runLoop({
      handle: makeHandle(""),
      sessionId: "session-pointer",
      initialBundle: makeBundle({
        snapshot: ""
      }),
      decision: makeDecision(["pointer", "verification"]),
      config
    });
    const drag = await runLoop({
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

  it("skips checkpoint clicks when click_path is disallowed and uses hover instead", async () => {
    const result = await runLoop({
      handle: makeHandle("[r5] button \"Continue\"", {
        advanceOnKinds: ["hover"]
      }),
      sessionId: "session-checkpoint-hover-fallback",
      initialBundle: makeBundle({
        snapshot: "[r5] button \"Continue\""
      }),
      decision: makeDecision(["hover", "verification"]),
      config
    });

    expect(result.executedSteps[0]).toEqual({
      kind: "hover",
      ref: "r5",
      reason: "Hover a likely action target to reveal hidden menus or session pickers."
    });
  });

  it("falls back to wait and then optional bridge suggestions when no DOM-native step remains", async () => {
    const result = await runLoop({
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

  it("uses the optional bridge lane with explicit suggestions before falling back to canonical helper refs", async () => {
    const explicitSuggestion: ChallengeActionStep = {
      kind: "click",
      ref: "r20",
      reason: "Worker-selected helper suggestion."
    };
    const explicit = await runLoop({
      handle: makeHandle("[r20] button \"Resume\"\n[r21] button \"Verify you're human\"", {
        advanceOnKinds: ["click"]
      }),
      sessionId: "session-optional-explicit",
      initialBundle: makeBundle({
        url: "https://example.com/challenge",
        title: "Challenge",
        snapshot: "[r20] button \"Resume\"\n[r21] button \"Verify you're human\""
      }),
      decision: makeDecision(["verification"], {
        lane: "optional_computer_use_bridge"
      }),
      suggestedSteps: [explicitSuggestion],
      config: {
        ...config,
        optionalComputerUseBridge: {
          enabled: true,
          maxSuggestions: 1
        }
      }
    });
    const fallback = await runLoop({
      handle: makeHandle("[r21] button \"Verify you're human\"", {
        advanceOnKinds: ["click"]
      }),
      sessionId: "session-optional-fallback",
      initialBundle: makeBundle({
        url: "https://example.com/challenge",
        title: "Challenge",
        snapshot: "[r21] button \"Verify you're human\""
      }),
      decision: makeDecision(["verification"], {
        lane: "optional_computer_use_bridge"
      }),
      config: {
        ...config,
        optionalComputerUseBridge: {
          enabled: true,
          maxSuggestions: 1
        }
      }
    });

    expect(explicit.executedSteps).toEqual([explicitSuggestion]);
    expect(fallback.executedSteps).toEqual([
      {
        kind: "click",
        ref: "r21",
        reason: "Optional bridge suggested a browser-scoped click follow-up from canonical evidence."
      }
    ]);
  });

  it("falls through invalid auth and task-data inputs to a bounded wait", async () => {
    const result = await runLoop({
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
    const noUrlOrTaskData = await runLoop({
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
    const sensitiveTaskKey = await runLoop({
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
    const unmatchedTaskKey = await runLoop({
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
    const numericTaskValue = await runLoop({
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
    const booleanTaskValue = await runLoop({
      handle: makeHandle("[r16] textbox \"Company\""),
      sessionId: "session-boolean-task-value",
      initialBundle: makeBundle({
        snapshot: "[r16] textbox \"Company\"",
        taskData: {
          company: true
        }
      }),
      decision: makeDecision(["non_secret_form_fill", "verification"]),
      config
    });
    const structuredTaskValue = await runLoop({
      handle: makeHandle("[r17] textbox \"Company\""),
      sessionId: "session-structured-task-value",
      initialBundle: makeBundle({
        snapshot: "[r17] textbox \"Company\"",
        taskData: {
          company: {
            legalName: "Acme"
          }
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
    expect(booleanTaskValue.executedSteps[0]).toMatchObject({
      kind: "type",
      ref: "r16",
      text: "true"
    });
    expect(structuredTaskValue.executedSteps[0]).toEqual({
      kind: "wait",
      reason: "Give the page a short bounded settle window before yielding."
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

    const result = await runLoop({
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

    expect(handle.select).toHaveBeenCalledWith("session-suggested", "r8", ["ca"], "tab-1");
    expect(handle.hover).toHaveBeenCalledWith("session-suggested", "r8", "tab-1");
    expect(result.executedSteps).toEqual(suggestedSteps);
  });

  it("skips malformed suggested steps, uses default values, and avoids invalid handler calls", async () => {
    const handle = makeHandle("[r11] button \"Continue\"", {
      advanceOnKinds: ["press", "scroll", "pointer", "drag", "wait"]
    });
    const result = await runLoop({
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
    expect(handle.press).toHaveBeenCalledWith("session-defaults", "Tab", undefined, "tab-1");
    expect(handle.scroll).toHaveBeenCalledWith("session-defaults", 600, undefined, "tab-1");
    expect(handle.pointerMove).toHaveBeenCalledWith("session-defaults", 640, 360, "tab-1", 12);
    expect(handle.drag).toHaveBeenCalledWith(
      "session-defaults",
      { x: 640, y: 360 },
      { x: 640, y: 620 },
      "tab-1",
      16
    );
    expect(result.executedSteps).toHaveLength(10);
  });

  it("executes cookie, snapshot, and debug-trace suggested steps directly", async () => {
    const cookies = [{
      name: "session",
      value: "abc123",
      domain: ".example.com",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "Lax" as const
    }];
    const handle = makeHandle("[r11] button \"Continue\"", {
      advanceOnKinds: ["wait"]
    });
    const suggestedSteps: ChallengeActionStep[] = [
      {
        kind: "cookie_list",
        url: "https://example.com/challenge",
        reason: "Inspect current cookies first."
      },
      {
        kind: "cookie_import",
        cookies,
        reason: "Import a bounded cookie set."
      },
      {
        kind: "snapshot",
        snapshotChars: 1800,
        reason: "Capture a fresh actionables snapshot."
      },
      {
        kind: "debug_trace",
        traceMax: 12,
        reason: "Capture a bounded debug trace."
      }
    ];

    const result = await runLoop({
      handle,
      sessionId: "session-supported-suggestions",
      initialBundle: makeBundle({
        snapshot: "[r11] button \"Continue\""
      }),
      decision: makeDecision(["verification"], {
        attemptBudget: 4,
        noProgressLimit: 8
      }),
      suggestedSteps,
      config
    });

    expect(handle.cookieList).toHaveBeenCalledWith("session-supported-suggestions", ["https://example.com/challenge"]);
    expect(handle.cookieImport).toHaveBeenCalledWith("session-supported-suggestions", cookies, true);
    expect(handle.snapshot).toHaveBeenCalledWith("session-supported-suggestions", "actionables", 1800, undefined, "tab-1");
    expect(handle.debugTraceSnapshot).toHaveBeenCalledWith("session-supported-suggestions", { max: 12 });
    expect(result.executedSteps).toEqual(suggestedSteps);
  });

  it("stops after bounded no-progress attempts", async () => {
    const handle = makeHandle("[r1] button \"Use existing session\"", {
      advanceOnKinds: []
    });
    const result = await runLoop({
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

  it("uses a null target when no explicit or bundle target is available", async () => {
    const result = await runLoop({
      handle: makeHandle("", {
        advanceOnKinds: ["wait"]
      }),
      sessionId: "session-null-start-target",
      initialBundle: {
        ...makeBundle({
          snapshot: ""
        }),
        activeTargetId: null
      },
      decision: makeDecision(["verification"], {
        attemptBudget: 1,
        noProgressLimit: 2
      }),
      suggestedSteps: [
        {
          kind: "wait",
          reason: "settle first"
        }
      ],
      config
    });

    expect(result.executedSteps[0]?.reason).toBe("settle first");
    expect(result.status).toBe("still_blocked");
  });

  it("switches to the latest verified target on later attempts", async () => {
    const handle = makeHandle("[r21] button \"Continue\"\n[r22] button \"Continue again\"", {
      advanceOnKinds: ["click"]
    });
    (handle.status as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        mode: "extension",
        activeTargetId: "popup-target",
        url: "https://example.com/challenge?popup=1",
        title: "Choose where you'd like to shop",
        meta: {
          blockerState: "active",
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
      })
      .mockResolvedValueOnce({
        mode: "extension",
        activeTargetId: "popup-target",
        url: "https://example.com/home",
        title: "Home",
        meta: {
          blockerState: "clear" as const
        }
      });

    const result = await runLoop({
      handle,
      sessionId: "session-popup-target-follow",
      targetId: "root-target",
      initialBundle: makeBundle({
        url: "https://example.com/challenge",
        title: "Choose where you'd like to shop",
        snapshot: "[r21] button \"Continue\"\n[r22] button \"Continue again\""
      }),
      decision: makeDecision(["click_path", "verification"], {
        attemptBudget: 2,
        noProgressLimit: 2
      }),
      config
    });

    expect(handle.click).toHaveBeenNthCalledWith(1, "session-popup-target-follow", "r21", "root-target");
    expect(handle.click).toHaveBeenNthCalledWith(2, "session-popup-target-follow", "r22", "popup-target");
    expect(result.status).toBe("resolved");
  });

  it("clamps short hold suggestions and ignores unsupported suggested step kinds", async () => {
    vi.useFakeTimers();
    try {
      const handle = makeHandle("", {
        advanceOnKinds: ["pointer"]
      });
      const pending = runLoop({
        handle,
        sessionId: "session-short-hold",
        initialBundle: makeBundle({
          url: "https://example.com/challenge",
          title: "Press and hold",
          snapshot: ""
        }),
        decision: makeDecision(["verification"], {
          attemptBudget: 2,
          noProgressLimit: 4
        }),
        suggestedSteps: [
          {
            kind: "click_and_hold",
            holdMs: 10,
            reason: "short hold"
          },
          {
            kind: "unsupported" as unknown as ChallengeActionStep["kind"],
            reason: "noop"
          } as ChallengeActionStep
        ],
        config
      });

      await vi.advanceTimersByTimeAsync(249);
      expect(handle.pointerUp).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      const result = await pending;

      expect(handle.pointerDown).toHaveBeenCalledWith("session-short-hold", 640, 360, "tab-1", "left", 1);
      expect(handle.pointerUp).toHaveBeenCalledWith("session-short-hold", 640, 360, "tab-1", "left", 1);
      expect(result.executedSteps[0]).toMatchObject({ kind: "click_and_hold", holdMs: 10 });
      expect(result.executedSteps[1]?.reason).toBe("noop");
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns no_progress after an empty optional bridge and surfaces deferred verification results", async () => {
    const exhaustedBridge = await runLoop({
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
    const deferred = await runLoop({
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
