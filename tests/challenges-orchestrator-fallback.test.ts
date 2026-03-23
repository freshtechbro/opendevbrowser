import { describe, expect, it, vi } from "vitest";

vi.mock("../src/challenges/action-loop", () => ({
  runChallengeActionLoop: vi.fn(async () => ({
    status: "still_blocked" as const,
    attempts: 1,
    noProgressCount: 1,
    executedSteps: [],
    verification: {
      status: "still_blocked" as const,
      blockerState: "active" as const,
      changed: false,
      reason: "mocked-still-blocked"
    },
    reusedExistingSession: false,
    reusedCookies: false
  }))
}));

import { ChallengeOrchestrator } from "../src/challenges";
import type { ChallengeRuntimeHandle } from "../src/browser/manager-types";
import type { ProvidersChallengeOrchestrationConfig } from "../src/config";

const config: ProvidersChallengeOrchestrationConfig = {
  enabled: true,
  attemptBudget: 1,
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
    enabled: false,
    maxSuggestions: 1
  }
};

const handle: ChallengeRuntimeHandle = {
  status: vi.fn(async () => ({
    mode: "extension",
    activeTargetId: "tab-1",
    url: "https://example.com/login",
    title: "Sign in",
    meta: {
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
  goto: vi.fn(async () => ({ timingMs: 1 })),
  waitForLoad: vi.fn(async () => ({ timingMs: 1 })),
  snapshot: vi.fn(async () => ({
    content: "[r1] link \"Sign in\"",
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
};

describe("challenge orchestrator fallback branches", () => {
  it("falls back to captured evidence when the action loop verification omits a bundle", async () => {
    const orchestrator = new ChallengeOrchestrator(config);
    const result = await orchestrator.orchestrate({
      handle,
      sessionId: "session-orchestrator-fallback",
      canImportCookies: false
    });

    expect(result.outcome.status).toBe("still_blocked");
    expect(result.outcome.evidence.url).toBe("https://example.com/login");
    expect(result.bundle.url).toBe("https://example.com/login");
  });
});
