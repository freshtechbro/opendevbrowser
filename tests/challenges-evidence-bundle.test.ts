import { describe, expect, it } from "vitest";
import { buildChallengeEvidenceBundle } from "../src/challenges";

const blocker = {
  schemaVersion: "1.0" as const,
  type: "auth_required" as const,
  source: "navigation" as const,
  reasonCode: "token_required" as const,
  confidence: 0.95,
  retryable: true,
  detectedAt: "2026-03-22T00:00:00.000Z",
  evidence: {
    matchedPatterns: ["login"],
    networkHosts: ["example.com"]
  },
  actionHints: []
};

describe("challenge evidence bundle", () => {
  it("normalizes snapshot, continuity, diagnostics, and preserved-session signals", () => {
    const bundle = buildChallengeEvidenceBundle({
      status: {
        mode: "extension",
        activeTargetId: "tab-1",
        url: "https://example.com/login",
        title: "Sign in",
        meta: {
          blocker,
          blockerState: "active",
          challenge: {
            challengeId: "challenge-1",
            blockerType: "auth_required",
            ownerSurface: "provider_fallback",
            resumeMode: "auto",
            preservedSessionId: "session-1",
            preservedTargetId: "tab-1",
            status: "active",
            updatedAt: "2026-03-22T00:00:00.000Z",
            suspendedIntent: {
              kind: "workflow",
              workflow: "research"
            }
          }
        }
      },
      snapshot: {
        content: [
          "[r1] link \"Sign in\"",
          "[r2] textbox \"Email\"",
          "[r3] button \"Use existing session\"",
          "[r4] button \"Verify you're human\"",
          "[r5] button \"Continue\""
        ].join("\n"),
        warnings: ["snapshot warning"]
      },
      debugTrace: {
        requestId: "trace-1",
        channels: {
          console: { events: [{}] },
          network: {
            events: [
              { url: "https://example.com/login" },
              { url: "https://cdn.example.com/challenge.js" }
            ]
          },
          exception: { events: [{}] }
        }
      },
      cookieCount: 2,
      canImportCookies: true,
      taskData: {
        email: "agent@example.com"
      }
    });

    expect(bundle.challengeId).toBe("challenge-1");
    expect(bundle.continuity.hasPreservedSession).toBe(true);
    expect(bundle.continuity.hasSuspendedIntent).toBe(true);
    expect(bundle.continuity.loginRefs).toEqual(["r1"]);
    expect(bundle.continuity.sessionReuseRefs).toEqual(["r3"]);
    expect(bundle.continuity.humanVerificationRefs).toEqual(["r4"]);
    expect(bundle.continuity.nonSecretFieldRefs).toEqual(["r2"]);
    expect(bundle.continuity.checkpointRefs).toContain("r5");
    expect(bundle.continuity.canReuseExistingCookies).toBe(true);
    expect(bundle.diagnostics.traceRequestId).toBe("trace-1");
    expect(bundle.diagnostics.consoleCount).toBe(1);
    expect(bundle.diagnostics.exceptionCount).toBe(1);
    expect(bundle.diagnostics.networkHosts).toEqual(["example.com", "cdn.example.com"]);
  });

  it("sanitizes blank fields, tolerates invalid network URLs, and parses action flags", () => {
    const bundle = buildChallengeEvidenceBundle({
      status: {
        mode: "managed",
        activeTargetId: null,
        url: "   ",
        title: " ",
        meta: {
          blockerState: "clear"
        }
      },
      snapshot: {
        content: [
          "[r6] checkbox checked \"Remember me\"",
          "[r7] option disabled \"Canada\" value=\"ca\"",
          "not actionable"
        ].join("\n")
      },
      debugTrace: {
        requestId: "  ",
        channels: {
          network: {
            events: [
              { url: "not-a-url" },
              { url: "https://example.com/path" }
            ]
          }
        }
      }
    });

    expect(bundle.url).toBeUndefined();
    expect(bundle.title).toBeUndefined();
    expect(bundle.blockerState).toBe("clear");
    expect(bundle.actionables).toEqual([
      {
        ref: "r6",
        role: "checkbox",
        name: "Remember me",
        value: undefined,
        disabled: false,
        checked: true
      },
      {
        ref: "r7",
        role: "option",
        name: "Canada",
        value: "ca",
        disabled: true,
        checked: false
      }
    ]);
    expect(bundle.diagnostics.traceRequestId).toBeUndefined();
    expect(bundle.diagnostics.networkHosts).toEqual(["example.com"]);
    expect(bundle.continuity.canReuseExistingCookies).toBe(false);
    expect(bundle.continuity.hasNonSecretTaskData).toBe(false);
  });

  it("extracts chooser account rows as reusable sessions even without cookies and defers 'Use another account'", () => {
    const bundle = buildChallengeEvidenceBundle({
      status: {
        mode: "extension",
        activeTargetId: "tab-chooser",
        url: "https://accounts.google.com/v3/signin/identifier",
        title: "Choose an account",
        meta: {
          blockerState: "active"
        }
      },
      snapshot: {
        content: [
          "[r1] button \"bishop@example.com\"",
          "[r2] button \"team@example.com\"",
          "[r3] button \"Use another account\"",
          "[r4] link \"Help\""
        ].join("\n")
      },
      cookieCount: 0,
      canImportCookies: false
    });

    expect(bundle.continuity.likelySessionPicker).toBe(true);
    expect(bundle.continuity.sessionReuseRefs).toEqual(["r1", "r2"]);
    expect(bundle.continuity.loginRefs).toContain("r3");
    expect(bundle.continuity.sessionReuseRefs).not.toContain("r3");
  });

  it("defaults clear blocker state, keeps nameless actionables, and ignores missing network urls", () => {
    const bundle = buildChallengeEvidenceBundle({
      status: {
        mode: "managed",
        activeTargetId: "tab-2"
      },
      snapshot: {
        content: [
          "[r8] button",
          "[r9] textbox"
        ].join("\n")
      },
      debugTrace: {
        channels: {
          network: {
            events: [
              {},
              { url: "https://example.com/path" }
            ]
          }
        }
      }
    });

    expect(bundle.blockerState).toBe("clear");
    expect(bundle.actionables).toEqual([
      {
        ref: "r8",
        role: "button",
        name: undefined,
        value: undefined,
        disabled: false,
        checked: false
      },
      {
        ref: "r9",
        role: "textbox",
        name: undefined,
        value: undefined,
        disabled: false,
        checked: false
      }
    ]);
    expect(bundle.diagnostics.networkHosts).toEqual(["example.com"]);
  });

  it("detects popup click flows from dialog-like shopping interstitials", () => {
    const bundle = buildChallengeEvidenceBundle({
      status: {
        mode: "extension",
        activeTargetId: "tab-popup",
        url: "https://www.walmart.com/search?q=macbook",
        title: "Choose where you'd like to shop",
        meta: {
          blockerState: "active"
        }
      },
      snapshot: {
        content: [
          "[r10] dialog \"Choose where you'd like to shop\"",
          "[r11] button \"Pickup\"",
          "[r12] button \"Delivery\""
        ].join("\n")
      }
    });

    expect(bundle.interaction).toMatchObject({
      surface: "popup",
      preferredAction: "click",
      clickRefs: ["r11", "r12"]
    });
  });

  it("detects hold prompts and parses bounded hold durations", () => {
    const bundle = buildChallengeEvidenceBundle({
      status: {
        mode: "extension",
        activeTargetId: "tab-hold",
        url: "https://example.com/challenge",
        title: "Press and hold",
        meta: {
          blockerState: "active"
        }
      },
      snapshot: {
        content: "[r20] button \"Press and hold for 1 minute\""
      }
    });

    expect(bundle.interaction).toMatchObject({
      surface: "interstitial",
      preferredAction: "click_and_hold",
      holdRefs: ["r20"],
      holdMs: 60000
    });
  });

  it("defaults invalid hold durations and preserves unknown surfaces when no evidence exists", () => {
    const holdBundle = buildChallengeEvidenceBundle({
      status: {
        mode: "extension",
        activeTargetId: "tab-hold-default",
        url: "https://example.com/challenge",
        title: "Press and hold",
        meta: {
          blockerState: "active"
        }
      },
      snapshot: {
        content: "Press and hold for 0 seconds."
      }
    });
    const unknownSurfaceBundle = buildChallengeEvidenceBundle({
      status: {
        mode: "managed",
        activeTargetId: null
      }
    });

    expect(holdBundle.interaction).toMatchObject({
      surface: "interstitial",
      preferredAction: "click_and_hold",
      holdRefs: [],
      holdMs: 1500
    });
    expect(unknownSurfaceBundle.interaction).toMatchObject({
      surface: "unknown",
      preferredAction: "unknown",
      clickRefs: [],
      holdRefs: [],
      dragRefs: []
    });
  });
});
