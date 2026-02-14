import {
  createFingerprintProfile,
  profileSeedFrom,
  rotateFingerprintProfile,
  type FingerprintProfile
} from "./profiles";

export type Tier2Mode = "off" | "deterministic" | "adaptive";

export type Tier2RuntimeConfig = {
  enabled: boolean;
  mode: Tier2Mode;
  rotationIntervalMs: number;
  challengePatterns: string[];
  maxChallengeEvents: number;
  scorePenalty: number;
  scoreRecovery: number;
  rotationHealthThreshold: number;
};

export type Tier2ChallengeEvent = {
  ts: number;
  type: "url-pattern" | "status";
  pattern: string;
  url: string;
  status?: number;
};

export type Tier2RuntimeState = {
  enabled: boolean;
  mode: Tier2Mode;
  profile: FingerprintProfile;
  lastRotationTs: number;
  challengeEvents: Tier2ChallengeEvent[];
};

export type Tier2NetworkSignal = {
  url: string;
  status?: number;
  ts?: number;
};

function applyProfileScore(profile: FingerprintProfile, delta: number): FingerprintProfile {
  const score = Math.max(0, Math.min(100, profile.healthScore + delta));
  return {
    ...profile,
    healthScore: score
  };
}

function withChallenge(profile: FingerprintProfile): FingerprintProfile {
  return {
    ...profile,
    challengeCount: profile.challengeCount + 1
  };
}

function compilePatterns(patterns: string[]): RegExp[] {
  const compiled: RegExp[] = [];
  for (const pattern of patterns) {
    try {
      compiled.push(new RegExp(pattern, "i"));
    } catch {
      // Ignore invalid custom patterns.
    }
  }
  return compiled;
}

export function detectTier2Challenge(
  signal: Tier2NetworkSignal,
  challengePatterns: string[]
): Tier2ChallengeEvent | null {
  const timestamp = signal.ts ?? Date.now();
  if (signal.status === 403 || signal.status === 429 || signal.status === 503) {
    return {
      ts: timestamp,
      type: "status",
      pattern: `status:${signal.status}`,
      url: signal.url,
      status: signal.status
    };
  }

  const compiled = compilePatterns(challengePatterns);
  const matched = compiled.find((pattern) => pattern.test(signal.url));
  if (!matched) {
    return null;
  }
  return {
    ts: timestamp,
    type: "url-pattern",
    pattern: matched.source,
    url: signal.url,
    status: signal.status
  };
}

export function createTier2RuntimeState(
  config: Tier2RuntimeConfig,
  sessionId: string,
  profileName?: string,
  now = Date.now()
): Tier2RuntimeState {
  const seed = profileSeedFrom(sessionId, profileName);
  return {
    enabled: config.enabled,
    mode: config.mode,
    profile: createFingerprintProfile(seed, 0, now),
    lastRotationTs: now,
    challengeEvents: []
  };
}

function maybeRotateByInterval(
  state: Tier2RuntimeState,
  config: Tier2RuntimeConfig,
  now: number
): { state: Tier2RuntimeState; rotated: boolean; reason?: string } {
  if (!config.enabled || config.mode === "off") {
    return { state, rotated: false };
  }
  if (config.rotationIntervalMs <= 0) {
    return { state, rotated: false };
  }
  if (now - state.lastRotationTs < config.rotationIntervalMs) {
    return { state, rotated: false };
  }
  return {
    state: {
      ...state,
      profile: rotateFingerprintProfile(state.profile, now),
      lastRotationTs: now
    },
    rotated: true,
    reason: "interval"
  };
}

export function applyTier2NetworkEvent(
  state: Tier2RuntimeState,
  config: Tier2RuntimeConfig,
  signal: Tier2NetworkSignal,
  now = Date.now()
): {
  state: Tier2RuntimeState;
  challenge: Tier2ChallengeEvent | null;
  rotated: boolean;
  reason?: string;
} {
  let nextState = { ...state };

  const intervalRotation = maybeRotateByInterval(nextState, config, now);
  nextState = intervalRotation.state;
  let rotated = intervalRotation.rotated;
  let reason = intervalRotation.reason;

  if (!config.enabled || config.mode === "off") {
    return { state: nextState, challenge: null, rotated, reason };
  }

  const challenge = detectTier2Challenge(signal, config.challengePatterns);
  if (!challenge) {
    if (config.scoreRecovery > 0) {
      nextState = {
        ...nextState,
        profile: applyProfileScore(nextState.profile, config.scoreRecovery)
      };
    }
    return { state: nextState, challenge: null, rotated, reason };
  }

  const challengeEvents = [...nextState.challengeEvents, challenge].slice(-Math.max(1, config.maxChallengeEvents));
  let profile = withChallenge(nextState.profile);
  profile = applyProfileScore(profile, -Math.abs(config.scorePenalty));

  nextState = {
    ...nextState,
    challengeEvents,
    profile
  };

  const shouldRotateForChallenge = config.mode === "adaptive"
    && profile.healthScore <= config.rotationHealthThreshold;
  if (shouldRotateForChallenge) {
    nextState = {
      ...nextState,
      profile: rotateFingerprintProfile(profile, now),
      lastRotationTs: now
    };
    rotated = true;
    reason = "challenge";
  }

  return { state: nextState, challenge, rotated, reason };
}
