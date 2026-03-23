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
});
