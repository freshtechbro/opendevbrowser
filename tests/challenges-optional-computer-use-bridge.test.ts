import { describe, expect, it } from "vitest";
import { buildChallengeEvidenceBundle, suggestComputerUseActions } from "../src/challenges";
import type { ProvidersChallengeOrchestrationConfig } from "../src/config";

const makeConfig = (enabled: boolean, maxSuggestions = 3): ProvidersChallengeOrchestrationConfig => ({
  enabled: true,
  attemptBudget: 6,
  noProgressLimit: 3,
  stepTimeoutMs: 5000,
  minAttemptGapMs: 10000,
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
    enabled,
    maxSuggestions
  }
});

const makeBundle = (snapshot: string) => buildChallengeEvidenceBundle({
  status: {
    mode: "extension",
    activeTargetId: "tab-1",
    url: "https://example.com/challenge",
    title: "Challenge",
    meta: { blockerState: "active" }
  },
  snapshot: {
    content: snapshot
  }
});

describe("optional computer-use bridge", () => {
  it("returns disabled when the bridge is off", () => {
    const result = suggestComputerUseActions({
      config: makeConfig(false),
      bundle: makeBundle("[r1] button \"Verify you're human\"")
    });

    expect(result.status).toBe("disabled");
    expect(result.suggestedSteps).toEqual([]);
  });

  it("returns unsupported when canonical evidence has no safe refs", () => {
    const result = suggestComputerUseActions({
      config: makeConfig(true),
      bundle: makeBundle("[r1] heading \"Challenge\"")
    });

    expect(result.status).toBe("unsupported");
    expect(result.reason).toContain("did not expose");
    expect(result.suggestedSteps).toEqual([]);
  });

  it("returns bounded browser-scoped suggestions from canonical refs", () => {
    const result = suggestComputerUseActions({
      config: makeConfig(true, 2),
      bundle: makeBundle([
        "[r1] link \"Sign in\"",
        "[r2] button \"Use existing session\"",
        "[r3] button \"Verify you're human\"",
        "[r4] button \"Continue\""
      ].join("\n"))
    });

    expect(result.status).toBe("suggested");
    expect(result.suggestedSteps).toEqual([
      {
        kind: "click",
        ref: "r1",
        reason: "Optional bridge suggested a browser-scoped click follow-up from canonical evidence."
      },
      {
        kind: "click",
        ref: "r2",
        reason: "Optional bridge suggested a browser-scoped click follow-up from canonical evidence."
      }
    ]);
    expect(result.auditMetadata).toEqual({
      suggestions: 2,
      source: "canonical_evidence"
    });
  });
});
