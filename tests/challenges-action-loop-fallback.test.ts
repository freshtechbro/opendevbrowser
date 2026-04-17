import { describe, expect, it, vi } from "vitest";

vi.mock("../src/challenges/verification-gate", () => ({
  verifyChallengeProgress: vi.fn(async () => ({
    status: "still_blocked" as const,
    blockerState: "active" as const,
    changed: false,
    reason: "mocked-still-blocked"
  }))
}));

import { buildChallengeEvidenceBundle, runChallengeActionLoop } from "../src/challenges";
import type {
  ChallengeActionStep,
  ChallengeAutomationHelperEligibility,
  ChallengeStrategyDecision
} from "../src/challenges";
import type { ChallengeRuntimeHandle } from "../src/browser/manager-types";
import type { ProvidersChallengeOrchestrationConfig } from "../src/config";

const config: ProvidersChallengeOrchestrationConfig = {
  mode: "browser",
  attemptBudget: 1,
  noProgressLimit: 2,
  stepTimeoutMs: 1000,
  minAttemptGapMs: 0,
  allowAuthNavigation: false,
  allowSessionReuse: false,
  allowCookieReuse: false,
  allowNonSecretFormFill: false,
  allowInteractionExploration: false,
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

const bundle = buildChallengeEvidenceBundle({
  status: {
    mode: "extension",
    activeTargetId: "tab-1",
    url: "https://example.com/challenge",
    title: "Challenge",
    meta: {
      blockerState: "active",
      blocker: {
        schemaVersion: "1.0",
        type: "anti_bot_challenge",
        source: "navigation",
        reasonCode: "challenge_detected",
        confidence: 0.9,
        retryable: true,
        detectedAt: "2026-03-22T00:00:00.000Z",
        evidence: { matchedPatterns: [], networkHosts: [] },
        actionHints: []
      }
    }
  },
  snapshot: {
    content: ""
  }
});

const handle: ChallengeRuntimeHandle = {
  status: vi.fn(async () => ({
    mode: "extension",
    activeTargetId: "tab-1",
    url: "https://example.com/challenge",
    title: "Challenge",
    meta: {
      blockerState: "active" as const
    }
  })),
  goto: vi.fn(async () => ({ timingMs: 1 })),
  waitForLoad: vi.fn(async () => ({ timingMs: 1 })),
  snapshot: vi.fn(async () => ({ content: "", warnings: [] })),
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

const decision: ChallengeStrategyDecision = {
  lane: "generic_browser_autonomy",
  rationale: "exercise fallback branches",
  attemptBudget: 1,
  noProgressLimit: 2,
  verificationLevel: "full",
  stopConditions: [],
  allowedActionFamilies: ["verification"]
};

const runLoop = (
  args: Omit<Parameters<typeof runChallengeActionLoop>[0], "helperEligibility">
    & { helperEligibility?: ChallengeAutomationHelperEligibility }
) => {
  return runChallengeActionLoop({
    ...args,
    helperEligibility: args.helperEligibility ?? {
      allowed: args.config.optionalComputerUseBridge.enabled,
      reason: args.config.optionalComputerUseBridge.enabled
        ? "Helper bridge enabled for fallback coverage."
        : "Helper bridge disabled for fallback coverage."
    }
  });
};

describe("challenge action loop fallback branches", () => {
  it("keeps the current bundle when verification omits one and ignores unknown suggested step kinds", async () => {
    const result = await runLoop({
      handle,
      sessionId: "session-fallback",
      initialBundle: bundle,
      decision,
      suggestedSteps: [
        {
          kind: "unsupported_kind" as ChallengeActionStep["kind"],
          reason: "unknown step kind"
        }
      ],
      config
    });

    expect(result.status).toBe("still_blocked");
    expect(result.verification.bundle?.url).toBe("https://example.com/challenge");
    expect(handle.goto).not.toHaveBeenCalled();
    expect(handle.click).not.toHaveBeenCalled();
  });
});
