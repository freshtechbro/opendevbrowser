export type FingerprintProfile = {
  id: string;
  seed: string;
  index: number;
  userAgentBrand: string;
  webglVendor: string;
  webglRenderer: string;
  createdAt: number;
  healthScore: number;
  challengeCount: number;
  rotationCount: number;
};

const USER_AGENT_BRANDS = [
  "Chrome/122.0.0.0",
  "Chrome/123.0.0.0",
  "Chrome/124.0.0.0"
];

const WEBGL_VENDORS = [
  "Google Inc.",
  "Intel Inc.",
  "NVIDIA Corporation"
];

const WEBGL_RENDERERS = [
  "ANGLE (Intel, Intel(R) Iris OpenGL Engine, OpenGL 4.1)",
  "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060, OpenGL 4.6)",
  "ANGLE (Apple, Apple M2, OpenGL 4.1)"
];

function stableHash(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pickBySeed(values: string[], seed: string): string {
  const index = stableHash(seed) % values.length;
  return values[index] ?? values[0]!;
}

export function profileSeedFrom(sessionId: string, profileName?: string): string {
  return `${profileName ?? "default"}:${sessionId}`;
}

export function createFingerprintProfile(seed: string, index = 0, now = Date.now()): FingerprintProfile {
  const profileSeed = `${seed}:${index}`;
  return {
    id: `fp-${stableHash(profileSeed).toString(16).padStart(8, "0")}`,
    seed,
    index,
    userAgentBrand: pickBySeed(USER_AGENT_BRANDS, `${profileSeed}:ua`),
    webglVendor: pickBySeed(WEBGL_VENDORS, `${profileSeed}:vendor`),
    webglRenderer: pickBySeed(WEBGL_RENDERERS, `${profileSeed}:renderer`),
    createdAt: now,
    healthScore: 100,
    challengeCount: 0,
    rotationCount: 0
  };
}

export function rotateFingerprintProfile(
  current: FingerprintProfile,
  now = Date.now()
): FingerprintProfile {
  const next = createFingerprintProfile(current.seed, current.index + 1, now);
  return {
    ...next,
    challengeCount: current.challengeCount,
    rotationCount: current.rotationCount + 1,
    healthScore: Math.max(40, current.healthScore)
  };
}
