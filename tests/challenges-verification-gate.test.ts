import { describe, expect, it, vi } from "vitest";
import { buildChallengeEvidenceBundle, verifyChallengeProgress } from "../src/challenges";
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
});
