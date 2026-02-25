export type OpsParallelModeVariant =
  | "managedHeaded"
  | "managedHeadless"
  | "cdpConnectHeaded"
  | "cdpConnectHeadless"
  | "extensionOpsHeaded"
  | "extensionLegacyCdpHeaded";

export type OpsParallelismGovernorPolicy = {
  floor: number;
  backpressureTimeoutMs: number;
  sampleIntervalMs: number;
  recoveryStableWindows: number;
  hostFreeMemMediumPct: number;
  hostFreeMemHighPct: number;
  hostFreeMemCriticalPct: number;
  rssBudgetMb: number;
  rssSoftPct: number;
  rssHighPct: number;
  rssCriticalPct: number;
  queueAgeHighMs: number;
  queueAgeCriticalMs: number;
  modeCaps: {
    managedHeaded: number;
    managedHeadless: number;
    cdpConnectHeaded: number;
    cdpConnectHeadless: number;
    extensionOpsHeaded: number;
    extensionLegacyCdpHeaded: number;
  };
};

export const DEFAULT_OPS_PARALLELISM_POLICY: OpsParallelismGovernorPolicy = {
  floor: 1,
  backpressureTimeoutMs: 5000,
  sampleIntervalMs: 2000,
  recoveryStableWindows: 3,
  hostFreeMemMediumPct: 25,
  hostFreeMemHighPct: 18,
  hostFreeMemCriticalPct: 10,
  rssBudgetMb: 2048,
  rssSoftPct: 65,
  rssHighPct: 75,
  rssCriticalPct: 85,
  queueAgeHighMs: 2000,
  queueAgeCriticalMs: 5000,
  modeCaps: {
    managedHeaded: 6,
    managedHeadless: 8,
    cdpConnectHeaded: 6,
    cdpConnectHeadless: 8,
    extensionOpsHeaded: 6,
    extensionLegacyCdpHeaded: 1
  }
};

export type OpsParallelPressureClass = "healthy" | "medium" | "high" | "critical";

export type OpsParallelPressureInput = {
  hostFreeMemPct: number;
  rssUsagePct: number;
  queueAgeMs: number;
  queueDepth: number;
  discardedSignals?: number;
  frozenSignals?: number;
};

export type OpsParallelismGovernorState = {
  modeVariant: OpsParallelModeVariant;
  staticCap: number;
  effectiveCap: number;
  healthyWindows: number;
  lastSampleAt: number;
  lastPressure: OpsParallelPressureClass;
};

export type OpsParallelismGovernorSnapshot = {
  state: OpsParallelismGovernorState;
  pressure: OpsParallelPressureClass;
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
  policy: OpsParallelismGovernorPolicy,
  input: OpsParallelPressureInput
): OpsParallelPressureClass => {
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

const pressurePenalty = (pressure: OpsParallelPressureClass): number => {
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

export const resolveOpsStaticCap = (
  policy: OpsParallelismGovernorPolicy,
  modeVariant: OpsParallelModeVariant
): number => {
  const cap = policy.modeCaps[modeVariant];
  return clamp(cap, policy.floor, cap);
};

export const createOpsGovernorState = (
  policy: OpsParallelismGovernorPolicy,
  modeVariant: OpsParallelModeVariant
): OpsParallelismGovernorState => {
  const staticCap = resolveOpsStaticCap(policy, modeVariant);
  return {
    modeVariant,
    staticCap,
    effectiveCap: staticCap,
    healthyWindows: 0,
    lastSampleAt: 0,
    lastPressure: "healthy"
  };
};

export const evaluateOpsGovernor = (
  policy: OpsParallelismGovernorPolicy,
  current: OpsParallelismGovernorState,
  input: OpsParallelPressureInput,
  sampledAt = Date.now()
): OpsParallelismGovernorSnapshot => {
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
