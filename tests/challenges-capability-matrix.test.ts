import { describe, expect, it } from "vitest";
import { buildCapabilityMatrix, buildChallengeEvidenceBundle } from "../src/challenges";
import type { ChallengeInterpreterResult, ChallengePolicyGate } from "../src/challenges";

const baseInterpretation: ChallengeInterpreterResult = {
  classification: "checkpoint_or_friction",
  authState: "unknown",
  humanBoundary: "none",
  requiredVerification: "light",
  continuityOpportunities: [],
  allowedActionFamilies: [],
  laneHints: ["generic_browser_autonomy"],
  stopRisk: "low",
  summary: "classification=checkpoint_or_friction"
};

const buildBundle = (snapshot: string, blockerState: "active" | "clear" = "active") => buildChallengeEvidenceBundle({
  status: {
    mode: "extension",
    activeTargetId: "tab-1",
    url: "https://example.com/challenge",
    title: "Challenge",
    ...(blockerState === "clear"
      ? {}
      : {
        meta: {
          blockerState,
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
      })
  },
  snapshot: {
    content: snapshot
  }
});

const buildGate = (allowedActions: ChallengePolicyGate["allowedActions"], overrides: Partial<ChallengePolicyGate> = {}): ChallengePolicyGate => ({
  allowedActions,
  forbiddenActions: [],
  handoffTriggers: [],
  governedLanes: [],
  optionalComputerUseBridge: false,
  ...overrides
});

describe("challenge capability matrix", () => {
  it("keeps click-path exploration disabled when no safe refs or actionables exist", () => {
    const matrix = buildCapabilityMatrix(
      buildBundle(""),
      baseInterpretation,
      buildGate(["click_path"])
    );

    expect(matrix.canExploreClicks).toBe(false);
    expect(matrix.mustDefer).toBe(false);
  });

  it("enables click-path exploration from checkpoint refs and honors optional bridge gating", () => {
    const matrix = buildCapabilityMatrix(
      buildBundle("[r1] button \"Continue\""),
      baseInterpretation,
      buildGate(["click_path"], { optionalComputerUseBridge: true })
    );

    expect(matrix.canExploreClicks).toBe(true);
    expect(matrix.canUseComputerUseBridge).toBe(true);
  });

  it("defers when the blocker is already clear and no blocker payload remains", () => {
    const matrix = buildCapabilityMatrix(
      buildBundle("[r2] button \"Continue\"", "clear"),
      baseInterpretation,
      buildGate(["click_path"])
    );

    expect(matrix.mustDefer).toBe(true);
  });
});
