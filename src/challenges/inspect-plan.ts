import type { ChallengeRuntimeHandle } from "../browser/manager-types";
import type { ProvidersChallengeOrchestrationConfig } from "../config";
import { buildCapabilityMatrix } from "./capability-matrix";
import { captureChallengeEvidence } from "./capture";
import { shouldYieldToHuman } from "./human-yield-gate";
import { interpretChallengeEvidence } from "./interpreter";
import { suggestComputerUseActions } from "./optional-computer-use-bridge";
import { buildChallengePolicyGate, resolveChallengeAutomationPolicy } from "./policy-gate";
import { selectChallengeStrategy } from "./strategy-selector";
import type {
  ChallengeActionStep,
  ChallengeActionable,
  ChallengeAutomationHelperEligibility,
  ChallengeAutomationMode,
  ChallengeEvidenceBundle,
  ChallengeInspectPlan,
  ChallengeStrategyDecision,
  ComputerUseBridgeResult
} from "./types";

const SENSITIVE_FIELD_RE = /\b(password|passcode|secret|otp|mfa|token|verification code|passkey)\b/i;

const hasExecuted = (
  steps: ChallengeActionStep[],
  kind: ChallengeActionStep["kind"],
  ref?: string,
  url?: string
): boolean => {
  return steps.some((step) => step.kind === kind && step.ref === ref && step.url === url);
};

const getActionable = (
  bundle: ChallengeEvidenceBundle,
  ref: string
): ChallengeActionable | undefined => {
  return bundle.actionables.find((entry) => entry.ref === ref);
};

const deriveAuthUrls = (url: string | undefined): string[] => {
  if (!url) {
    return [];
  }
  try {
    const current = new URL(url);
    const candidates = [
      "/login",
      "/signin",
      "/sign-in",
      "/account/login",
      "/session",
      "/auth/login"
    ];
    return candidates.map((path) => new URL(path, current.origin).toString());
  } catch {
    return [];
  }
};

const resolveTaskValue = (
  bundle: ChallengeEvidenceBundle,
  ref: string
): string | undefined => {
  const actionable = getActionable(bundle, ref);
  const name = actionable?.name?.toLowerCase();
  if (!name || !bundle.taskData) {
    return undefined;
  }
  for (const [key, value] of Object.entries(bundle.taskData)) {
    if (SENSITIVE_FIELD_RE.test(key) || SENSITIVE_FIELD_RE.test(name)) {
      continue;
    }
    if (!name.includes(key.toLowerCase())) {
      continue;
    }
    if (
      typeof value === "string"
      || typeof value === "number"
      || typeof value === "boolean"
    ) {
      return String(value);
    }
  }
  return undefined;
};

const nextUnusedRef = (
  refs: string[],
  steps: ChallengeActionStep[],
  kind: "click" | "click_and_hold" | "hover" | "type"
): string | undefined => {
  return refs.find((ref) => !hasExecuted(steps, kind, ref));
};

const planInteractionStep = (
  bundle: ChallengeEvidenceBundle,
  decision: ChallengeStrategyDecision,
  executedSteps: ChallengeActionStep[]
): ChallengeActionStep | undefined => {
  const interaction = bundle.interaction;
  if (!interaction || interaction.preferredAction === "unknown") {
    return undefined;
  }
  if (interaction.preferredAction === "click" && decision.allowedActionFamilies.includes("click_path")) {
    const clickRef = nextUnusedRef(interaction.clickRefs, executedSteps, "click");
    if (clickRef) {
      return {
        kind: "click",
        ref: clickRef,
        reason: "Visible popup or interstitial exposes a bounded click path."
      };
    }
  }
  if (
    interaction.preferredAction === "click_and_hold"
    && decision.allowedActionFamilies.includes("click_and_hold")
  ) {
    const holdRef = nextUnusedRef(interaction.holdRefs, executedSteps, "click_and_hold");
    if (holdRef || !hasExecuted(executedSteps, "click_and_hold")) {
      return {
        kind: "click_and_hold",
        ...(holdRef ? { ref: holdRef } : {}),
        ...(typeof interaction.holdMs === "number" ? { holdMs: interaction.holdMs } : {}),
        reason: "Visible challenge requests a bounded click-and-hold gesture."
      };
    }
  }
  if (
    interaction.preferredAction === "drag"
    && decision.allowedActionFamilies.includes("drag")
    && !hasExecuted(executedSteps, "drag")
  ) {
    return {
      kind: "drag",
      ...(interaction.dragRefs[0] ? { ref: interaction.dragRefs[0] } : {}),
      coordinates: { x: 640, y: 360 },
      reason: "Visible challenge requests a bounded drag gesture."
    };
  }
  return undefined;
};

const planGenericStep = (
  bundle: ChallengeEvidenceBundle,
  decision: ChallengeStrategyDecision,
  executedSteps: ChallengeActionStep[]
): ChallengeActionStep | undefined => {
  const sessionRef = nextUnusedRef(
    bundle.continuity.sessionReuseRefs,
    executedSteps,
    "click"
  );
  if (sessionRef) {
    return {
      kind: "click",
      ref: sessionRef,
      reason: "Try the existing-session or account-selection path first."
    };
  }

  const loginRef = nextUnusedRef(bundle.continuity.loginRefs, executedSteps, "click");
  if (decision.allowedActionFamilies.includes("auth_navigation") && loginRef) {
    return {
      kind: "click",
      ref: loginRef,
      reason: "Try the visible auth-navigation entrypoint."
    };
  }

  if (decision.allowedActionFamilies.includes("auth_navigation")) {
    const loginUrl = deriveAuthUrls(bundle.url).find((candidate) => {
      return !hasExecuted(executedSteps, "goto", undefined, candidate);
    });
    if (loginUrl) {
      return {
        kind: "goto",
        url: loginUrl,
        reason: "Try a conventional auth-navigation URL on the current origin."
      };
    }
  }

  const fieldRef = nextUnusedRef(
    bundle.continuity.nonSecretFieldRefs,
    executedSteps,
    "type"
  );
  const fieldValue = fieldRef ? resolveTaskValue(bundle, fieldRef) : undefined;
  if (
    decision.allowedActionFamilies.includes("non_secret_form_fill")
    && fieldRef
    && fieldValue
  ) {
    return {
      kind: "type",
      ref: fieldRef,
      text: fieldValue,
      reason: "Fill a non-secret field from caller-provided task data."
    };
  }

  const checkpointRef = nextUnusedRef(
    bundle.continuity.checkpointRefs,
    executedSteps,
    "click"
  );
  if (decision.allowedActionFamilies.includes("click_path") && checkpointRef) {
    return {
      kind: "click",
      ref: checkpointRef,
      reason: "Try the next visible checkpoint or continue action."
    };
  }

  const hoverRef = nextUnusedRef(
    [...bundle.continuity.loginRefs, ...bundle.continuity.checkpointRefs],
    executedSteps,
    "hover"
  );
  if (decision.allowedActionFamilies.includes("hover") && hoverRef) {
    return {
      kind: "hover",
      ref: hoverRef,
      reason: "Hover a likely action target to reveal hidden menus or session pickers."
    };
  }

  if (decision.allowedActionFamilies.includes("scroll") && !hasExecuted(executedSteps, "scroll")) {
    return {
      kind: "scroll",
      dy: 900,
      reason: "Scroll down to uncover the next actionable region."
    };
  }

  if (
    decision.allowedActionFamilies.includes("scroll")
    && executedSteps.filter((step) => step.kind === "scroll").length === 1
  ) {
    return {
      kind: "scroll",
      dy: -450,
      reason: "Scroll back up to re-evaluate the visible challenge state."
    };
  }

  if (decision.allowedActionFamilies.includes("press") && !hasExecuted(executedSteps, "press")) {
    return {
      kind: "press",
      text: "Tab",
      reason: "Advance focus through the challenge surface."
    };
  }

  if (decision.allowedActionFamilies.includes("pointer") && !hasExecuted(executedSteps, "pointer")) {
    return {
      kind: "pointer",
      coordinates: { x: 640, y: 360 },
      reason: "Move the pointer through the center of the current browser surface."
    };
  }

  if (decision.allowedActionFamilies.includes("drag") && !hasExecuted(executedSteps, "drag")) {
    return {
      kind: "drag",
      coordinates: { x: 640, y: 360 },
      reason: "Attempt one bounded vertical drag across the visible surface."
    };
  }

  if (!hasExecuted(executedSteps, "wait")) {
    return {
      kind: "wait",
      reason: "Give the page a short bounded settle window before yielding."
    };
  }

  return undefined;
};

const pendingSteps = (
  steps: ChallengeActionStep[] | undefined,
  executedSteps: ChallengeActionStep[]
): ChallengeActionStep[] => {
  return (steps ?? []).filter((step) => {
    return !hasExecuted(executedSteps, step.kind, step.ref, step.url);
  });
};

const dedupeSteps = (steps: ChallengeActionStep[]): ChallengeActionStep[] => {
  const seen = new Set<string>();
  return steps.filter((step) => {
    const key = JSON.stringify([
      step.kind,
      step.ref ?? null,
      step.url ?? null,
      step.text ?? null,
      step.reason
    ]);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

export const buildChallengeActionSuggestions = (args: {
  bundle: ChallengeEvidenceBundle;
  decision: ChallengeStrategyDecision;
  helperEligibility: ChallengeAutomationHelperEligibility;
  config: ProvidersChallengeOrchestrationConfig;
  preferredSteps?: ChallengeActionStep[];
  executedSteps?: ChallengeActionStep[];
}): {
  helper: ComputerUseBridgeResult;
  suggestedSteps: ChallengeActionStep[];
} => {
  const executedSteps = args.executedSteps ?? [];
  const helper = suggestComputerUseActions({
    helperEligibility: args.helperEligibility,
    bundle: args.bundle,
    maxSuggestions: args.config.optionalComputerUseBridge.maxSuggestions
  });
  const preferredSteps = pendingSteps(args.preferredSteps, executedSteps);
  const interactionStep = planInteractionStep(args.bundle, args.decision, executedSteps);
  const genericStep = planGenericStep(args.bundle, args.decision, executedSteps);
  const helperSteps = pendingSteps(helper.suggestedSteps, executedSteps);

  const suggestedSteps = args.decision.lane === "optional_computer_use_bridge"
    ? dedupeSteps([...preferredSteps, ...helperSteps])
    : dedupeSteps([
      ...preferredSteps,
      ...(interactionStep ? [interactionStep] : []),
      ...(genericStep ? [genericStep] : []),
      ...helperSteps
    ]);

  return {
    helper,
    suggestedSteps
  };
};

export const selectChallengeActionStep = (args: {
  bundle: ChallengeEvidenceBundle;
  decision: ChallengeStrategyDecision;
  helperEligibility: ChallengeAutomationHelperEligibility;
  config: ProvidersChallengeOrchestrationConfig;
  preferredSteps?: ChallengeActionStep[];
  executedSteps?: ChallengeActionStep[];
}): ChallengeActionStep | undefined => {
  return buildChallengeActionSuggestions(args).suggestedSteps[0];
};

export function buildChallengeInspectPlan(args: {
  bundle: ChallengeEvidenceBundle;
  config: ProvidersChallengeOrchestrationConfig;
  runMode?: ChallengeAutomationMode;
  sessionMode?: ChallengeAutomationMode;
  preferredSteps?: ChallengeActionStep[];
  executedSteps?: ChallengeActionStep[];
}): ChallengeInspectPlan {
  const interpretation = interpretChallengeEvidence(args.bundle);
  const policy = resolveChallengeAutomationPolicy({
    runMode: args.runMode,
    sessionMode: args.sessionMode,
    configMode: args.config.mode
  });
  const gate = buildChallengePolicyGate(args.config, interpretation, policy);
  const capabilityMatrix = buildCapabilityMatrix(args.bundle, interpretation, gate);
  const decision = selectChallengeStrategy({
    config: args.config,
    bundle: args.bundle,
    interpretation,
    capabilityMatrix,
    gate
  });
  const actionSuggestions = buildChallengeActionSuggestions({
    bundle: args.bundle,
    decision,
    helperEligibility: capabilityMatrix.helperEligibility,
    config: args.config,
    preferredSteps: args.preferredSteps,
    executedSteps: args.executedSteps
  });
  const yieldDecision = shouldYieldToHuman({
    interpretation,
    noProgressExhausted: false
  });
  const standDownReason = capabilityMatrix.helperEligibility.standDownReason
    ?? gate.resolvedPolicy.standDownReason
    ?? actionSuggestions.helper.standDownReason;

  return {
    challengeId: args.bundle.challengeId,
    ...(args.bundle.mode ? { sessionMode: args.bundle.mode } : {}),
    classification: interpretation.classification,
    authState: interpretation.authState,
    summary: interpretation.summary,
    mode: gate.resolvedPolicy.mode,
    source: gate.resolvedPolicy.source,
    helperEligibility: capabilityMatrix.helperEligibility,
    ...(standDownReason ? { standDownReason } : {}),
    yield: {
      required: yieldDecision.yield,
      reason: yieldDecision.reason
    },
    decision,
    allowedActionFamilies: gate.allowedActions,
    forbiddenActionFamilies: gate.forbiddenActions,
    governedLanes: gate.governedLanes,
    capabilityMatrix,
    helper: actionSuggestions.helper,
    suggestedSteps: actionSuggestions.suggestedSteps,
    evidence: {
      blockerState: args.bundle.blockerState,
      ...(args.bundle.blocker?.type ? { blockerType: args.bundle.blocker.type } : {}),
      ...(args.bundle.url ? { url: args.bundle.url } : {}),
      ...(args.bundle.title ? { title: args.bundle.title } : {}),
      ...(typeof args.bundle.activeTargetId !== "undefined"
        ? { activeTargetId: args.bundle.activeTargetId }
        : {}),
      ...(args.bundle.snapshotId ? { snapshotId: args.bundle.snapshotId } : {}),
      loginRefs: args.bundle.continuity.loginRefs,
      sessionReuseRefs: args.bundle.continuity.sessionReuseRefs,
      humanVerificationRefs: args.bundle.continuity.humanVerificationRefs,
      checkpointRefs: args.bundle.continuity.checkpointRefs
    }
  };
}

export async function inspectChallengePlanFromRuntime(args: {
  handle: ChallengeRuntimeHandle;
  sessionId: string;
  targetId?: string | null;
  config: ProvidersChallengeOrchestrationConfig;
  runMode?: ChallengeAutomationMode;
  sessionMode?: ChallengeAutomationMode;
  canImportCookies?: boolean;
}): Promise<ChallengeInspectPlan> {
  const bundle = await captureChallengeEvidence({
    handle: args.handle,
    sessionId: args.sessionId,
    targetId: args.targetId,
    canImportCookies: args.canImportCookies ?? true
  });
  return buildChallengeInspectPlan({
    bundle,
    config: args.config,
    runMode: args.runMode,
    sessionMode: args.sessionMode
  });
}
