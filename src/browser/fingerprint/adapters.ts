export type Tier3EvaluationInput = {
  hasChallenge: boolean;
  healthScore: number;
  challengeCount: number;
  rotationCount: number;
  metadata?: Record<string, unknown>;
};

export type Tier3AdapterDecision = {
  score: number;
  reason: string;
  forceRollback?: boolean;
};

export type Tier3AdapterCallbacks = {
  onPromote?: (level: number) => void;
  onRollback?: (level: number, reason: string) => void;
};

export interface Tier3Adapter extends Tier3AdapterCallbacks {
  name: string;
  evaluate: (input: Tier3EvaluationInput) => Tier3AdapterDecision;
}

export class DeterministicTier3Adapter implements Tier3Adapter {
  name = "deterministic";

  evaluate(input: Tier3EvaluationInput): Tier3AdapterDecision {
    let score = input.healthScore;
    if (input.hasChallenge) {
      score -= 25;
    }
    if (input.challengeCount > 4) {
      score -= 10;
    }
    if (input.rotationCount > 2) {
      score -= 5;
    }
    const boundedScore = Math.max(0, Math.min(100, score));
    if (boundedScore <= 20) {
      return {
        score: boundedScore,
        reason: "health score critically low",
        forceRollback: true
      };
    }
    return {
      score: boundedScore,
      reason: input.hasChallenge ? "challenge detected" : "stable"
    };
  }
}

export function resolveTier3Adapter(adapter?: Tier3Adapter | null): Tier3Adapter {
  return adapter ?? new DeterministicTier3Adapter();
}
