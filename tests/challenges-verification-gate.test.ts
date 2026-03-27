import { describe, expect, it, vi } from "vitest";
import { buildChallengeEvidenceBundle, verifyChallengeProgress } from "../src/challenges";
import * as evidenceBundleModule from "../src/challenges/evidence-bundle";
import type { ChallengeRuntimeHandle } from "../src/browser/manager-types";

const buildHandle = (args: {
  cleared?: boolean;
  deferred?: boolean;
  snapshot?: string;
  url?: string | null;
  title?: string;
  cookieCount?: number;
}): ChallengeRuntimeHandle => ({
  status: vi.fn(async () => ({
    mode: "extension",
    activeTargetId: "tab-1",
    ...(args.url === null ? {} : {
      url: args.url ?? (args.cleared ? "https://example.com/home" : "https://example.com/login")
    }),
    title: args.title ?? (args.cleared ? "Home" : "Sign in"),
    meta: args.cleared
      ? { blockerState: "clear" as const }
      : args.deferred
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
          }
        }
  })),
  goto: vi.fn(async () => ({ timingMs: 1 })),
  waitForLoad: vi.fn(async () => ({ timingMs: 1 })),
  snapshot: vi.fn(async () => ({
    content: args.snapshot ?? (args.cleared ? "[r9] button \"Done\"" : "[r1] link \"Sign in\""),
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
  cookieList: vi.fn(async () => ({ count: args.cookieCount ?? (args.cleared ? 2 : 0) })),
  cookieImport: vi.fn(async () => ({ imported: 0, rejected: [] })),
  debugTraceSnapshot: vi.fn(async () => ({
    channels: {
      console: { events: [] },
      network: { events: [] },
      exception: { events: [] }
    }
  }))
});

const previous = buildChallengeEvidenceBundle({
  status: {
    mode: "extension",
    activeTargetId: "tab-1",
    url: "https://example.com/login",
    title: "Sign in",
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
      }
    }
  },
  snapshot: { content: "[r1] link \"Sign in\"" }
});

describe("challenge verification gate", () => {
  it("reports clear when manager verification clears the blocker", async () => {
    const result = await verifyChallengeProgress({
      handle: buildHandle({ cleared: true }),
      sessionId: "session-clear",
      previous,
      canImportCookies: true
    });

    expect(result.status).toBe("clear");
    expect(result.bundle?.blockerState).toBe("clear");
  });

  it("surfaces explicit manager deferrals", async () => {
    const result = await verifyChallengeProgress({
      handle: buildHandle({ deferred: true }),
      sessionId: "session-deferred",
      previous,
      canImportCookies: true
    });

    expect(result.status).toBe("deferred");
    expect(result.reason).toContain("deferred");
  });

  it("treats resolved manager blocker metadata as a clear result", async () => {
    const handle = buildHandle({});
    (handle.status as ReturnType<typeof vi.fn>).mockResolvedValue({
      mode: "extension",
      activeTargetId: "tab-1",
      url: "https://example.com/home",
      title: "Home",
      meta: {
        blockerState: "active",
        blockerResolution: {
          status: "resolved",
          reason: "manager cleared the blocker"
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
        }
      }
    });

    const result = await verifyChallengeProgress({
      handle,
      sessionId: "session-resolved",
      previous,
      canImportCookies: true
    });

    expect(result.status).toBe("clear");
    expect(result.reason).toContain("cleared");
  });

  it("yields when verification detects a human boundary", async () => {
    const result = await verifyChallengeProgress({
      handle: buildHandle({
        snapshot: "[r1] textbox \"Verification code\""
      }),
      sessionId: "session-mfa",
      previous,
      canImportCookies: true
    });

    expect(result.status).toBe("yield_required");
    expect(result.reason).toContain("mfa");
  });

  it("reports progress when state changed but the blocker is still active", async () => {
    const result = await verifyChallengeProgress({
      handle: buildHandle({
        url: "https://example.com/login?step=2",
        title: "Continue sign in",
        cookieCount: 2
      }),
      sessionId: "session-progress",
      previous,
      canImportCookies: true
    });

    expect(result.status).toBe("progress");
    expect(result.changed).toBe(true);
  });

  it("reports progress when drag interaction evidence disappears even if the page url is stable", async () => {
    const previousDrag = buildChallengeEvidenceBundle({
      status: {
        mode: "extension",
        activeTargetId: "tab-1",
        url: "https://example.com/challenge",
        title: "Drag the slider",
        meta: {
          blockerState: "active",
          blocker: {
            schemaVersion: "1.0",
            type: "anti_bot_challenge",
            source: "navigation",
            reasonCode: "challenge_detected",
            confidence: 0.95,
            retryable: true,
            detectedAt: "2026-03-22T00:00:00.000Z",
            evidence: { matchedPatterns: [], networkHosts: [] },
            actionHints: []
          }
        }
      },
      snapshot: {
        content: "Drag the slider to continue."
      }
    });

    const result = await verifyChallengeProgress({
      handle: buildHandle({
        url: "https://example.com/challenge",
        title: "Drag the slider",
        snapshot: "[r1] button \"Continue\""
      }),
      sessionId: "session-interaction-progress",
      previous: previousDrag,
      canImportCookies: true
    });

    expect(result.status).toBe("progress");
    expect(result.changed).toBe(true);
  });

  it("reports still blocked when verification observes no meaningful change", async () => {
    const result = await verifyChallengeProgress({
      handle: buildHandle({}),
      sessionId: "session-still-blocked",
      previous,
      canImportCookies: true
    });

    expect(result.status).toBe("still_blocked");
    expect(result.changed).toBe(false);
  });

  it("skips cookie listing when verification has no page url", async () => {
    const handle = buildHandle({ url: null });
    const result = await verifyChallengeProgress({
      handle,
      sessionId: "session-no-url",
      previous,
      canImportCookies: true
    });

    expect(handle.cookieList).not.toHaveBeenCalled();
    expect(result.bundle?.url).toBeUndefined();
  });

  it("follows the manager's active target when verification discovers a popup target", async () => {
    const handle = buildHandle({
      url: "https://example.com/challenge?popup=1",
      title: "Choose where you'd like to shop",
      snapshot: "[r10] dialog \"Choose where you'd like to shop\"\n[r11] button \"Pickup\""
    });
    (handle.status as ReturnType<typeof vi.fn>).mockResolvedValue({
      mode: "extension",
      activeTargetId: "popup-target",
      url: "https://example.com/challenge?popup=1",
      title: "Choose where you'd like to shop",
      meta: {
        blockerState: "active",
        blocker: {
          schemaVersion: "1.0" as const,
          type: "anti_bot_challenge" as const,
          source: "navigation" as const,
          reasonCode: "challenge_detected" as const,
          confidence: 0.95,
          retryable: true,
          detectedAt: "2026-03-22T00:00:00.000Z",
          evidence: { matchedPatterns: [], networkHosts: [] },
          actionHints: []
        }
      }
    });

    const result = await verifyChallengeProgress({
      handle,
      sessionId: "session-popup-target",
      targetId: "stale-target",
      previous,
      canImportCookies: true
    });

    expect(handle.snapshot).toHaveBeenCalledWith("session-popup-target", "actionables", 2400, undefined, "popup-target");
    expect(result.bundle?.activeTargetId).toBe("popup-target");
    expect(result.changed).toBe(true);
  });

  it("falls back to the provided target id and detects drag interaction changes", async () => {
    const handle = buildHandle({
      url: "https://example.com/challenge?drag=1",
      title: "Drag the slider",
      snapshot: "Drag the slider to continue."
    });
    (handle.status as ReturnType<typeof vi.fn>).mockResolvedValue({
      mode: "extension",
      activeTargetId: null,
      url: "https://example.com/challenge?drag=1",
      title: "Drag the slider",
      meta: {
        blockerState: "active",
        blocker: {
          schemaVersion: "1.0" as const,
          type: "anti_bot_challenge" as const,
          source: "navigation" as const,
          reasonCode: "challenge_detected" as const,
          confidence: 0.95,
          retryable: true,
          detectedAt: "2026-03-22T00:00:00.000Z",
          evidence: { matchedPatterns: [], networkHosts: [] },
          actionHints: []
        }
      }
    });

    const result = await verifyChallengeProgress({
      handle,
      sessionId: "session-drag-target",
      targetId: "provided-target",
      previous,
      canImportCookies: true
    });

    expect(handle.snapshot).toHaveBeenCalledWith("session-drag-target", "actionables", 2400, undefined, "provided-target");
    expect(result.bundle?.interaction).toMatchObject({
      preferredAction: "drag"
    });
    expect(result.changed).toBe(true);
  });

  it("passes a null target when neither the manager nor the caller provides one", async () => {
    const handle = buildHandle({
      url: "https://example.com/challenge",
      title: "Continue",
      snapshot: "[r1] button \"Continue\""
    });
    (handle.status as ReturnType<typeof vi.fn>).mockResolvedValue({
      mode: "extension",
      activeTargetId: null,
      url: "https://example.com/challenge",
      title: "Continue",
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
        }
      }
    });

    await verifyChallengeProgress({
      handle,
      sessionId: "session-null-target",
      previous,
      canImportCookies: true
    });

    expect(handle.snapshot).toHaveBeenCalledWith("session-null-target", "actionables", 2400, undefined, null);
  });

  it("treats missing drag metadata as unchanged when neither bundle exposes drag refs", async () => {
    const nextBundle = {
      ...buildChallengeEvidenceBundle({
        status: {
          mode: "extension",
          activeTargetId: "tab-1",
          url: "https://example.com/login",
          title: "Sign in",
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
            }
          }
        },
        snapshot: { content: "[r1] link \"Sign in\"" }
      }),
      interaction: undefined
    };
    const bundleSpy = vi.spyOn(evidenceBundleModule, "buildChallengeEvidenceBundle").mockReturnValue(
      nextBundle as ReturnType<typeof buildChallengeEvidenceBundle>
    );

    try {
      const result = await verifyChallengeProgress({
        handle: buildHandle({}),
        sessionId: "session-missing-drag-metadata",
        previous: {
          ...previous,
          interaction: undefined
        },
        canImportCookies: true
      });

      expect(result.status).toBe("still_blocked");
      expect(result.changed).toBe(false);
    } finally {
      bundleSpy.mockRestore();
    }
  });
});
