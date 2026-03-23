import { describe, expect, it } from "vitest";
import { buildChallengeEvidenceBundle, suggestComputerUseActions } from "../src/challenges";
import type { ChallengeAutomationHelperEligibility } from "../src/challenges";

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

const makeHelperEligibility = (
  allowed: boolean,
  overrides: Partial<ChallengeAutomationHelperEligibility> = {}
): ChallengeAutomationHelperEligibility => ({
  allowed,
  reason: allowed
    ? "Optional helper bridge remains eligible after mode resolution."
    : "Optional computer-use bridge is disabled by policy.",
  ...overrides
});

describe("optional computer-use bridge", () => {
  it("returns disabled when helper eligibility is denied", () => {
    const result = suggestComputerUseActions({
      helperEligibility: makeHelperEligibility(false, {
        standDownReason: "helper_disabled_by_policy"
      }),
      bundle: makeBundle("[r1] button \"Verify you're human\""),
      maxSuggestions: 3
    });

    expect(result.status).toBe("disabled");
    expect(result.standDownReason).toBe("helper_disabled_by_policy");
    expect(result.suggestedSteps).toEqual([]);
  });

  it("returns unsupported when canonical evidence has no safe refs", () => {
    const result = suggestComputerUseActions({
      helperEligibility: makeHelperEligibility(true),
      bundle: makeBundle("[r1] heading \"Challenge\""),
      maxSuggestions: 3
    });

    expect(result.status).toBe("unsupported");
    expect(result.reason).toContain("did not expose");
    expect(result.suggestedSteps).toEqual([]);
  });

  it("returns bounded browser-scoped suggestions from canonical refs", () => {
    const result = suggestComputerUseActions({
      helperEligibility: makeHelperEligibility(true),
      bundle: makeBundle([
        "[r1] link \"Sign in\"",
        "[r2] button \"Use existing session\"",
        "[r3] button \"Verify you're human\"",
        "[r4] button \"Continue\""
      ].join("\n")),
      maxSuggestions: 2
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
