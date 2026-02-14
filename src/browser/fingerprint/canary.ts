export type Tier3CanaryPolicy = {
  windowSize: number;
  minSamples: number;
  promoteThreshold: number;
  rollbackThreshold: number;
};

export type Tier3CanarySample = {
  ts: number;
  score: number;
  success: boolean;
  reason: string;
};

export type Tier3CanaryAction = "none" | "promote" | "rollback";

export type Tier3CanaryState = {
  samples: Tier3CanarySample[];
  level: number;
  averageScore: number;
  lastAction: Tier3CanaryAction;
};

export function createCanaryState(initialLevel = 0): Tier3CanaryState {
  return {
    samples: [],
    level: initialLevel,
    averageScore: 100,
    lastAction: "none"
  };
}

function average(values: number[]): number {
  if (values.length === 0) return 100;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function pushCanarySample(
  state: Tier3CanaryState,
  policy: Tier3CanaryPolicy,
  sample: Tier3CanarySample
): { state: Tier3CanaryState; action: Tier3CanaryAction } {
  const windowSize = Math.max(1, policy.windowSize);
  const samples = [...state.samples, sample].slice(-windowSize);
  const averageScore = average(samples.map((entry) => Math.max(0, Math.min(100, entry.score))));
  const minSamples = Math.max(1, policy.minSamples);

  let action: Tier3CanaryAction = "none";
  let level = state.level;
  if (samples.length >= minSamples) {
    if (averageScore >= policy.promoteThreshold) {
      level += 1;
      action = "promote";
    } else if (averageScore <= policy.rollbackThreshold) {
      level = Math.max(0, level - 1);
      action = "rollback";
    }
  }

  return {
    action,
    state: {
      samples,
      level,
      averageScore,
      lastAction: action
    }
  };
}
