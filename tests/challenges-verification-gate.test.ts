import { describe, expect, it, vi } from "vitest";
import { buildChallengeEvidenceBundle, verifyChallengeProgress } from "../src/challenges";
import type { ChallengeRuntimeHandle } from "../src/browser/manager-types";
import type { BrowserResponseMeta } from "../src/browser/manager-types";

type EvidenceArgs = {
  snapshotId: string;
  content: string;
  cookieCount?: number;
  meta?: BrowserResponseMeta;
  url?: string;
  title?: string;
  activeTargetId?: string | null;
};

const activeMeta = (overrides: Partial<BrowserResponseMeta> = {}): BrowserResponseMeta => ({
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
  },
  ...overrides
});

const buildStatus = (args: EvidenceArgs) => ({
  status: {
    mode: "extension",
    activeTargetId: args.activeTargetId ?? "tab-1",
    url: args.url ?? "https://example.com/challenge",
    title: args.title ?? "Challenge",
    meta: args.meta ?? activeMeta()
  }
});

const makeBundle = (args: EvidenceArgs) => buildChallengeEvidenceBundle({
  ...buildStatus(args),
  snapshot: {
    snapshotId: args.snapshotId,
    content: args.content,
    warnings: []
  },
  debugTrace: {
    channels: {
      console: { events: [] },
      network: { events: [] },
      exception: { events: [] }
    }
  },
  cookieCount: args.cookieCount ?? 1,
  canImportCookies: true
});

const makeHandle = (args: EvidenceArgs): ChallengeRuntimeHandle => ({
  status: vi.fn(async () => buildStatus(args).status),
  goto: vi.fn(async () => ({ timingMs: 1 })),
  waitForLoad: vi.fn(async () => ({ timingMs: 1 })),
  snapshot: vi.fn(async () => ({
    snapshotId: args.snapshotId,
    content: args.content,
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
  cookieList: vi.fn(async () => ({ count: args.cookieCount ?? 1 })),
  cookieImport: vi.fn(async () => ({ imported: 0, rejected: [] })),
  debugTraceSnapshot: vi.fn(async () => ({
    channels: {
      console: { events: [] },
      network: { events: [] },
      exception: { events: [] }
    }
  })),
  resolveRefPoint: vi.fn(async () => ({ x: 640, y: 360 }))
});

describe("challenge verification gate", () => {
  it("ignores regenerated snapshot ids when the blocker evidence is otherwise unchanged", async () => {
    const result = await verifyChallengeProgress({
      handle: makeHandle({ snapshotId: "snap-2", content: "[r1] button \"Continue\"" }),
      sessionId: "session-1",
      previous: makeBundle({ snapshotId: "snap-1", content: "[r1] button \"Continue\"" }),
      canImportCookies: true
    });

    expect(result.status).toBe("still_blocked");
    expect(result.changed).toBe(false);
  });

  it("ignores raw cookie-count churn when cookie reuse availability is unchanged", async () => {
    const result = await verifyChallengeProgress({
      handle: makeHandle({ snapshotId: "snap-2", content: "[r1] button \"Continue\"", cookieCount: 2 }),
      sessionId: "session-1",
      previous: makeBundle({ snapshotId: "snap-1", content: "[r1] button \"Continue\"", cookieCount: 1 }),
      canImportCookies: true
    });

    expect(result.status).toBe("still_blocked");
    expect(result.changed).toBe(false);
  });

  it("treats cookie reuse availability changes as meaningful progress", async () => {
    const result = await verifyChallengeProgress({
      handle: makeHandle({ snapshotId: "snap-2", content: "[r1] button \"Continue\"", cookieCount: 0 }),
      sessionId: "session-1",
      previous: makeBundle({ snapshotId: "snap-1", content: "[r1] button \"Continue\"", cookieCount: 1 }),
      canImportCookies: true
    });

    expect(result.status).toBe("progress");
    expect(result.changed).toBe(true);
  });

  it("still reports progress when only drag refs change", async () => {
    const result = await verifyChallengeProgress({
      handle: makeHandle({ snapshotId: "snap-2", content: "[r2] button \"Drag the slider\"" }),
      sessionId: "session-1",
      previous: makeBundle({ snapshotId: "snap-1", content: "[r1] button \"Drag the slider\"" }),
      canImportCookies: true
    });

    expect(result.status).toBe("progress");
    expect(result.changed).toBe(true);
  });

  it("treats isolated drag-ref changes as meaningful progress", async () => {
    vi.resetModules();
    const previous = makeBundle({
      snapshotId: "snap-1",
      content: ""
    });
    previous.interaction = {
      surface: "page",
      preferredAction: "drag",
      clickRefs: [],
      holdRefs: [],
      dragRefs: ["r1"],
      evidencePhrases: []
    };
    const nextBundle = {
      ...previous,
      interaction: {
        ...previous.interaction,
        dragRefs: ["r2"]
      }
    };

    vi.doMock("../src/challenges/evidence-bundle", () => ({
      buildChallengeEvidenceBundle: () => nextBundle
    }));
    vi.doMock("../src/challenges/interpreter", () => ({
      interpretChallengeEvidence: () => ({
        classification: "auth_required",
        authState: "credentials_required",
        humanBoundary: "none",
        requiredVerification: "full",
        continuityOpportunities: [],
        allowedActionFamilies: ["wait"],
        laneHints: ["generic_browser_autonomy"],
        stopRisk: "medium",
        summary: "mocked"
      })
    }));

    try {
      const { verifyChallengeProgress: verifyFresh } = await import("../src/challenges/verification-gate");
      const result = await verifyFresh({
        handle: makeHandle({ snapshotId: "snap-2", content: "" }),
        sessionId: "session-1",
        previous,
        canImportCookies: true
      });

      expect(result.status).toBe("progress");
      expect(result.changed).toBe(true);
    } finally {
      vi.doUnmock("../src/challenges/evidence-bundle");
      vi.doUnmock("../src/challenges/interpreter");
      vi.resetModules();
    }
  });

  it("ignores identical drag refs when the interaction bundle is otherwise unchanged", async () => {
    vi.resetModules();
    const previous = makeBundle({
      snapshotId: "snap-1",
      content: ""
    });
    previous.interaction = {
      surface: "page",
      preferredAction: "drag",
      clickRefs: [],
      holdRefs: [],
      dragRefs: ["r1"],
      evidencePhrases: []
    };
    const nextBundle = {
      ...previous,
      interaction: {
        ...previous.interaction
      }
    };

    vi.doMock("../src/challenges/evidence-bundle", () => ({
      buildChallengeEvidenceBundle: () => nextBundle
    }));
    vi.doMock("../src/challenges/interpreter", () => ({
      interpretChallengeEvidence: () => ({
        classification: "auth_required",
        authState: "credentials_required",
        humanBoundary: "none",
        requiredVerification: "full",
        continuityOpportunities: [],
        allowedActionFamilies: ["wait"],
        laneHints: ["generic_browser_autonomy"],
        stopRisk: "medium",
        summary: "mocked"
      })
    }));

    try {
      const { verifyChallengeProgress: verifyFresh } = await import("../src/challenges/verification-gate");
      const result = await verifyFresh({
        handle: makeHandle({ snapshotId: "snap-2", content: "" }),
        sessionId: "session-1",
        previous,
        canImportCookies: true
      });

      expect(result.status).toBe("still_blocked");
      expect(result.changed).toBe(false);
    } finally {
      vi.doUnmock("../src/challenges/evidence-bundle");
      vi.doUnmock("../src/challenges/interpreter");
      vi.resetModules();
    }
  });

  it("still reports progress when the actionable evidence changes", async () => {
    const result = await verifyChallengeProgress({
      handle: makeHandle({ snapshotId: "snap-2", content: "[r1] button \"Continue\"\n[r2] link \"Sign in\"" }),
      sessionId: "session-1",
      previous: makeBundle({ snapshotId: "snap-1", content: "[r1] button \"Continue\"" }),
      canImportCookies: true
    });

    expect(result.status).toBe("progress");
    expect(result.changed).toBe(true);
  });

  it("skips cookie inspection when the current status has no url", async () => {
    const handle = makeHandle({
      snapshotId: "snap-2",
      content: "[r1] button \"Continue\"",
      url: ""
    });

    const result = await verifyChallengeProgress({
      handle,
      sessionId: "session-1",
      previous: makeBundle({
        snapshotId: "snap-1",
        content: "[r1] button \"Continue\"",
        url: "",
        cookieCount: 0
      }),
      canImportCookies: true
    });

    expect(handle.cookieList).not.toHaveBeenCalled();
    expect(result.status).toBe("still_blocked");
    expect(result.changed).toBe(false);
  });

  it("returns clear when manager status clears the blocker", async () => {
    const result = await verifyChallengeProgress({
      handle: makeHandle({
        snapshotId: "snap-2",
        content: "",
        meta: activeMeta({ blockerState: "clear" }),
        title: ""
      }),
      sessionId: "session-1",
      previous: makeBundle({ snapshotId: "snap-1", content: "[r1] button \"Continue\"" }),
      canImportCookies: true
    });

    expect(result.status).toBe("clear");
    expect(result.changed).toBe(true);
  });

  it("returns clear when manager resolution marks the blocker resolved", async () => {
    const result = await verifyChallengeProgress({
      handle: makeHandle({
        snapshotId: "snap-2",
        content: "[r1] button \"Continue\"",
        meta: activeMeta({
          blockerResolution: {
            status: "resolved",
            reason: "verifier_passed",
            updatedAt: "2026-04-08T00:00:00.000Z"
          }
        })
      }),
      sessionId: "session-1",
      previous: makeBundle({ snapshotId: "snap-1", content: "[r1] button \"Continue\"" }),
      canImportCookies: true
    });

    expect(result.status).toBe("clear");
    expect(result.changed).toBe(true);
  });

  it("returns deferred when manager resolution defers the blocker", async () => {
    const result = await verifyChallengeProgress({
      handle: makeHandle({
        snapshotId: "snap-2",
        content: "[r1] button \"Continue\"",
        meta: activeMeta({
          blockerResolution: {
            status: "deferred",
            reason: "env_limited",
            updatedAt: "2026-04-08T00:00:00.000Z"
          }
        })
      }),
      sessionId: "session-1",
      previous: makeBundle({ snapshotId: "snap-1", content: "[r1] button \"Continue\"" }),
      canImportCookies: true
    });

    expect(result.status).toBe("deferred");
    expect(result.changed).toBe(false);
  });

  it("returns yield_required when verification detects an mfa boundary", async () => {
    const result = await verifyChallengeProgress({
      handle: makeHandle({
        snapshotId: "snap-2",
        content: "[r1] textbox \"Verification code\"\n[r2] button \"Continue\"",
        title: "Enter your verification code"
      }),
      sessionId: "session-1",
      previous: makeBundle({
        snapshotId: "snap-1",
        content: "[r1] textbox \"Verification code\"\n[r2] button \"Continue\"",
        title: "Enter your verification code"
      }),
      canImportCookies: true
    });

    expect(result.status).toBe("yield_required");
    expect(result.reason).toContain("mfa");
  });
});
