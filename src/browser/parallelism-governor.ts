import type { ParallelismGovernorConfig } from "../config";

export type ParallelModeVariant =
  | "managedHeaded"
  | "managedHeadless"
  | "cdpConnectHeaded"
  | "cdpConnectHeadless"
  | "extensionOpsHeaded"
  | "extensionLegacyCdpHeaded";

export type ParallelPressureClass = "healthy" | "medium" | "high" | "critical";

export type ParallelismPressureInput = {
  hostFreeMemPct: number;
  rssUsagePct: number;
  queueAgeMs: number;
  queueDepth: number;
  discardedSignals?: number;
  frozenSignals?: number;
};

export type ParallelismGovernorState = {
  modeVariant: ParallelModeVariant;
  staticCap: number;
  effectiveCap: number;
  healthyWindows: number;
  lastSampleAt: number;
  lastPressure: ParallelPressureClass;
};

export type ParallelismGovernorSnapshot = {
  state: ParallelismGovernorState;
  pressure: ParallelPressureClass;
  targetCap: number;
  waitQueueDepth: number;
  waitQueueAgeMs: number;
};

const clamp = (value: number, floor: number, ceil: number): number => {
  if (value < floor) return floor;
  if (value > ceil) return ceil;
  return value;
};

const floorPercent = (value: number): number => clamp(Number.isFinite(value) ? value : 0, 0, 100);

const classifyPressure = (
  policy: ParallelismGovernorConfig,
  input: ParallelismPressureInput
): ParallelPressureClass => {
  const hostFreeMemPct = floorPercent(input.hostFreeMemPct);
  const rssUsagePct = floorPercent(input.rssUsagePct);
  const queueAgeMs = Math.max(0, Number.isFinite(input.queueAgeMs) ? input.queueAgeMs : 0);
  const discardedSignals = Math.max(0, input.discardedSignals ?? 0);
  const frozenSignals = Math.max(0, input.frozenSignals ?? 0);

  const critical = hostFreeMemPct <= policy.hostFreeMemCriticalPct
    || rssUsagePct >= policy.rssCriticalPct
    || queueAgeMs >= policy.queueAgeCriticalMs;
  if (critical) return "critical";

  const high = hostFreeMemPct <= policy.hostFreeMemHighPct
    || rssUsagePct >= policy.rssHighPct
    || queueAgeMs >= policy.queueAgeHighMs
    || discardedSignals > 0;
  if (high) return "high";

  const medium = hostFreeMemPct <= policy.hostFreeMemMediumPct
    || rssUsagePct >= policy.rssSoftPct
    || frozenSignals > 0;
  return medium ? "medium" : "healthy";
};

const pressurePenalty = (pressure: ParallelPressureClass): number => {
  switch (pressure) {
    case "medium":
      return 1;
    case "high":
      return 2;
    case "critical":
      return Number.MAX_SAFE_INTEGER;
    default:
      return 0;
  }
};

export const resolveStaticCap = (
  policy: ParallelismGovernorConfig,
  modeVariant: ParallelModeVariant
): number => {
  const cap = policy.modeCaps[modeVariant];
  return clamp(cap, policy.floor, cap);
};

export const createGovernorState = (
  policy: ParallelismGovernorConfig,
  modeVariant: ParallelModeVariant
): ParallelismGovernorState => {
  const staticCap = resolveStaticCap(policy, modeVariant);
  return {
    modeVariant,
    staticCap,
    effectiveCap: staticCap,
    healthyWindows: 0,
    lastSampleAt: 0,
    lastPressure: "healthy"
  };
};

export const evaluateGovernor = (
  policy: ParallelismGovernorConfig,
  current: ParallelismGovernorState,
  input: ParallelismPressureInput,
  sampledAt = Date.now()
): ParallelismGovernorSnapshot => {
  const normalizedQueueDepth = Math.max(0, Number.isFinite(input.queueDepth) ? input.queueDepth : 0);
  const normalizedQueueAgeMs = Math.max(0, Number.isFinite(input.queueAgeMs) ? input.queueAgeMs : 0);
  const pressure = classifyPressure(policy, input);
  const basePenalty = pressurePenalty(pressure);
  const lifecyclePenalty = Math.max(0, input.discardedSignals ?? 0) + Math.max(0, input.frozenSignals ?? 0);
  const targetCap = pressure === "critical"
    ? policy.floor
    : clamp(
      current.staticCap - basePenalty - lifecyclePenalty,
      policy.floor,
      current.staticCap
    );

  let effectiveCap = current.effectiveCap;
  let healthyWindows = pressure === "healthy" ? current.healthyWindows + 1 : 0;

  if (targetCap < current.effectiveCap) {
    effectiveCap = targetCap;
    healthyWindows = 0;
  } else if (targetCap > current.effectiveCap) {
    const windowsRequired = Math.max(1, policy.recoveryStableWindows);
    if (healthyWindows >= windowsRequired) {
      effectiveCap = clamp(current.effectiveCap + 1, policy.floor, targetCap);
      healthyWindows = 0;
    }
  }

  return {
    state: {
      modeVariant: current.modeVariant,
      staticCap: current.staticCap,
      effectiveCap,
      healthyWindows,
      lastSampleAt: sampledAt,
      lastPressure: pressure
    },
    pressure,
    targetCap,
    waitQueueDepth: normalizedQueueDepth,
    waitQueueAgeMs: normalizedQueueAgeMs
  };
};

export const rssUsagePercent = (rssBytes: number, budgetMb: number): number => {
  const budgetBytes = Math.max(1, budgetMb) * 1024 * 1024;
  return Math.max(0, (rssBytes / budgetBytes) * 100);
};
