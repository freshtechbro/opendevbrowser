import {
  resolveTier3Adapter,
  type Tier3Adapter,
  type Tier3AdapterDecision,
  type Tier3EvaluationInput
} from "./adapters";
import {
  createCanaryState,
  pushCanarySample,
  type Tier3CanaryAction,
  type Tier3CanaryPolicy,
  type Tier3CanaryState
} from "./canary";

export type Tier3FallbackTier = "tier1" | "tier2";

export type Tier3RuntimeConfig = {
  enabled: boolean;
  fallbackTier: Tier3FallbackTier;
  canary: Tier3CanaryPolicy;
};

export type Tier3HistoryEntry = {
  ts: number;
  action: Tier3CanaryAction;
  reason: string;
};

export type Tier3RuntimeState = {
  enabled: boolean;
  adapterName: string;
  status: "active" | "fallback";
  fallbackTier: Tier3FallbackTier;
  fallbackReason?: string;
  canary: Tier3CanaryState;
  history: Tier3HistoryEntry[];
};

export function createTier3RuntimeState(
  config: Tier3RuntimeConfig,
  adapter?: Tier3Adapter
): Tier3RuntimeState {
  const resolved = resolveTier3Adapter(adapter);
  return {
    enabled: config.enabled,
    adapterName: resolved.name,
    status: "active",
    fallbackTier: config.fallbackTier,
    canary: createCanaryState(),
    history: []
  };
}

export function resolveTier3Fallback(
  state: Tier3RuntimeState,
  reason: string,
  now = Date.now()
): Tier3RuntimeState {
  const historyEntry: Tier3HistoryEntry = { ts: now, action: "rollback", reason };
  return {
    ...state,
    status: "fallback",
    fallbackReason: reason,
    history: [...state.history, historyEntry].slice(-50)
  };
}

export function evaluateTier3Adaptive(
  state: Tier3RuntimeState,
  config: Tier3RuntimeConfig,
  input: Tier3EvaluationInput,
  adapter?: Tier3Adapter,
  now = Date.now()
): {
  state: Tier3RuntimeState;
  action: Tier3CanaryAction;
  decision: Tier3AdapterDecision;
} {
  const resolvedAdapter = resolveTier3Adapter(adapter);
  const decision = resolvedAdapter.evaluate(input);

  if (!config.enabled || !state.enabled) {
    return { state, action: "none", decision };
  }

  const canaryResult = pushCanarySample(state.canary, config.canary, {
    ts: now,
    score: decision.score,
    success: !decision.forceRollback,
    reason: decision.reason
  });

  let action = canaryResult.action;
  const historyEntry: Tier3HistoryEntry = {
    ts: now,
    action: canaryResult.action,
    reason: decision.reason
  };

  let nextState: Tier3RuntimeState = {
    ...state,
    canary: canaryResult.state,
    history: [...state.history, historyEntry].slice(-50)
  };

  if (decision.forceRollback) {
    action = "rollback";
    nextState = resolveTier3Fallback(nextState, decision.reason, now);
    resolvedAdapter.onRollback?.(nextState.canary.level, decision.reason);
    return { state: nextState, action, decision };
  }

  if (action === "rollback") {
    nextState = resolveTier3Fallback(nextState, decision.reason, now);
    resolvedAdapter.onRollback?.(nextState.canary.level, decision.reason);
    return { state: nextState, action, decision };
  }

  if (action === "promote") {
    nextState = {
      ...nextState,
      status: "active",
      fallbackReason: undefined
    };
    resolvedAdapter.onPromote?.(nextState.canary.level);
  }

  return { state: nextState, action, decision };
}
