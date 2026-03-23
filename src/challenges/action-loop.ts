import type { ChallengeRuntimeHandle } from "../browser/manager-types";
import { suggestComputerUseActions } from "./optional-computer-use-bridge";
import { verifyChallengeProgress } from "./verification-gate";
import type { ProvidersChallengeOrchestrationConfig } from "../config";
import type {
  ChallengeActionResult,
  ChallengeActionStep,
  ChallengeActionable,
  ChallengeEvidenceBundle,
  ChallengeStrategyDecision
} from "./types";

const SENSITIVE_FIELD_RE = /\b(password|passcode|secret|otp|mfa|token|verification code|passkey)\b/i;

const hasExecuted = (steps: ChallengeActionStep[], kind: ChallengeActionStep["kind"], ref?: string, url?: string): boolean => {
  return steps.some((step) => step.kind === kind && step.ref === ref && step.url === url);
};

const getActionable = (bundle: ChallengeEvidenceBundle, ref: string): ChallengeActionable | undefined => {
  return bundle.actionables.find((entry) => entry.ref === ref);
};

const deriveAuthUrls = (url: string | undefined): string[] => {
  if (!url) return [];
  try {
    const current = new URL(url);
    const candidates = ["/login", "/signin", "/sign-in", "/account/login", "/session", "/auth/login"];
    return candidates.map((path) => new URL(path, current.origin).toString());
  } catch {
    return [];
  }
};

const resolveTaskValue = (bundle: ChallengeEvidenceBundle, ref: string): string | undefined => {
  const actionable = getActionable(bundle, ref);
  const name = actionable?.name?.toLowerCase();
  if (!name || !bundle.taskData) return undefined;
  const entries = Object.entries(bundle.taskData);
  for (const [key, value] of entries) {
    if (SENSITIVE_FIELD_RE.test(key) || SENSITIVE_FIELD_RE.test(name)) {
      continue;
    }
    if (!name.includes(key.toLowerCase())) {
      continue;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
  }
  return undefined;
};

const nextUnusedRef = (refs: string[], steps: ChallengeActionStep[], kind: "click" | "hover" | "type"): string | undefined => {
  return refs.find((ref) => !hasExecuted(steps, kind, ref));
};

const planGenericStep = (
  config: ProvidersChallengeOrchestrationConfig,
  bundle: ChallengeEvidenceBundle,
  decision: ChallengeStrategyDecision,
  executedSteps: ChallengeActionStep[]
): ChallengeActionStep | undefined => {
  const sessionRef = nextUnusedRef(bundle.continuity.sessionReuseRefs, executedSteps, "click");
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
    const loginUrl = deriveAuthUrls(bundle.url).find((candidate) => !hasExecuted(executedSteps, "goto", undefined, candidate));
    if (loginUrl) {
      return {
        kind: "goto",
        url: loginUrl,
        reason: "Try a conventional auth-navigation URL on the current origin."
      };
    }
  }

  const fieldRef = nextUnusedRef(bundle.continuity.nonSecretFieldRefs, executedSteps, "type");
  const fieldValue = fieldRef ? resolveTaskValue(bundle, fieldRef) : undefined;
  if (decision.allowedActionFamilies.includes("non_secret_form_fill") && fieldRef && fieldValue) {
    return {
      kind: "type",
      ref: fieldRef,
      text: fieldValue,
      reason: "Fill a non-secret field from caller-provided task data."
    };
  }

  const checkpointRef = nextUnusedRef(bundle.continuity.checkpointRefs, executedSteps, "click");
  if (decision.allowedActionFamilies.includes("click_path") && checkpointRef) {
    return {
      kind: "click",
      ref: checkpointRef,
      reason: "Try the next visible checkpoint or continue action."
    };
  }

  const hoverRef = nextUnusedRef([...bundle.continuity.loginRefs, ...bundle.continuity.checkpointRefs], executedSteps, "hover");
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

  if (decision.allowedActionFamilies.includes("scroll") && executedSteps.filter((step) => step.kind === "scroll").length === 1) {
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

  if (config.optionalComputerUseBridge.enabled) {
    return suggestComputerUseActions({ config, bundle }).suggestedSteps[0];
  }

  return undefined;
};

const executeStep = async (args: {
  handle: ChallengeRuntimeHandle;
  sessionId: string;
  targetId?: string | null;
  step: ChallengeActionStep;
  config: ProvidersChallengeOrchestrationConfig;
}): Promise<void> => {
  const timeoutMs = args.config.stepTimeoutMs;
  switch (args.step.kind) {
    case "goto":
      if (args.step.url) {
        await args.handle.goto(args.sessionId, args.step.url, "domcontentloaded", timeoutMs, undefined, args.targetId);
      }
      return;
    case "click":
      if (args.step.ref) {
        await args.handle.click(args.sessionId, args.step.ref, args.targetId);
      }
      return;
    case "hover":
      if (args.step.ref) {
        await args.handle.hover(args.sessionId, args.step.ref, args.targetId);
      }
      return;
    case "press":
      await args.handle.press(args.sessionId, args.step.text ?? "Tab", undefined, args.targetId);
      return;
    case "type":
      if (args.step.ref && typeof args.step.text === "string") {
        await args.handle.type(args.sessionId, args.step.ref, args.step.text, true, false, args.targetId);
      }
      return;
    case "select":
      if (args.step.ref && args.step.values?.length) {
        await args.handle.select(args.sessionId, args.step.ref, args.step.values, args.targetId);
      }
      return;
    case "scroll":
      await args.handle.scroll(args.sessionId, args.step.dy ?? 600, undefined, args.targetId);
      return;
    case "pointer":
      await args.handle.pointerMove(
        args.sessionId,
        args.step.coordinates?.x ?? 640,
        args.step.coordinates?.y ?? 360,
        args.targetId,
        12
      );
      return;
    case "drag":
      await args.handle.drag(
        args.sessionId,
        { x: args.step.coordinates?.x ?? 640, y: args.step.coordinates?.y ?? 240 },
        { x: args.step.coordinates?.x ?? 640, y: (args.step.coordinates?.y ?? 240) + 260 },
        args.targetId,
        16
      );
      return;
    case "wait":
      await args.handle.waitForLoad(args.sessionId, "networkidle", Math.min(timeoutMs, 3000), args.targetId);
      return;
    default:
      return;
  }
};

export const runChallengeActionLoop = async (args: {
  handle: ChallengeRuntimeHandle;
  sessionId: string;
  targetId?: string | null;
  initialBundle: ChallengeEvidenceBundle;
  decision: ChallengeStrategyDecision;
  config: ProvidersChallengeOrchestrationConfig;
  suggestedSteps?: ChallengeActionStep[];
}): Promise<ChallengeActionResult> => {
  let currentBundle = args.initialBundle;
  const executedSteps: ChallengeActionStep[] = [];
  let noProgressCount = 0;
  let reusedExistingSession = false;
  let reusedCookies = false;

  for (let attempt = 1; attempt <= args.decision.attemptBudget; attempt += 1) {
    const step = args.suggestedSteps?.find((candidate) => !hasExecuted(executedSteps, candidate.kind, candidate.ref, candidate.url))
      ?? planGenericStep(args.config, currentBundle, args.decision, executedSteps);

    if (!step) {
      return {
        status: "no_progress",
        attempts: attempt - 1,
        noProgressCount,
        executedSteps,
        verification: {
          status: "still_blocked",
          blockerState: currentBundle.blockerState,
          blocker: currentBundle.blocker,
          challenge: currentBundle.challenge,
          bundle: currentBundle,
          changed: false,
          reason: "No additional safe browser action remained.",
          url: currentBundle.url,
          title: currentBundle.title
        },
        reusedExistingSession,
        reusedCookies
      };
    }

    try {
      await executeStep({
        handle: args.handle,
        sessionId: args.sessionId,
        targetId: args.targetId,
        step,
        config: args.config
      });
    } catch {
      // Verification below decides whether the failed step changed anything meaningful.
    }

    executedSteps.push(step);
    if (step.ref && currentBundle.continuity.sessionReuseRefs.includes(step.ref)) {
      reusedExistingSession = true;
    }
    if (step.kind === "goto" && currentBundle.continuity.canReuseExistingCookies) {
      reusedCookies = true;
    }

    const verification = await verifyChallengeProgress({
      handle: args.handle,
      sessionId: args.sessionId,
      targetId: args.targetId,
      previous: currentBundle,
      canImportCookies: currentBundle.continuity.canImportCookies,
      fallbackDisposition: currentBundle.fallbackDisposition,
      registryPressure: currentBundle.registryPressure,
      taskData: currentBundle.taskData
    });
    currentBundle = verification.bundle ?? currentBundle;

    if (verification.status === "clear") {
      return {
        status: "resolved",
        attempts: attempt,
        noProgressCount,
        executedSteps,
        verification,
        reusedExistingSession,
        reusedCookies
      };
    }

    if (verification.status === "yield_required") {
      return {
        status: "yield_required",
        attempts: attempt,
        noProgressCount,
        executedSteps,
        verification,
        reusedExistingSession,
        reusedCookies
      };
    }

    if (verification.status === "deferred") {
      return {
        status: "deferred",
        attempts: attempt,
        noProgressCount,
        executedSteps,
        verification,
        reusedExistingSession,
        reusedCookies
      };
    }

    if (verification.changed) {
      noProgressCount = 0;
      continue;
    }

    noProgressCount += 1;
    if (noProgressCount >= args.decision.noProgressLimit) {
      return {
        status: "no_progress",
        attempts: attempt,
        noProgressCount,
        executedSteps,
        verification,
        reusedExistingSession,
        reusedCookies
      };
    }
  }

  return {
    status: "still_blocked",
    attempts: args.decision.attemptBudget,
    noProgressCount,
    executedSteps,
    verification: {
      status: "still_blocked",
      blockerState: currentBundle.blockerState,
      blocker: currentBundle.blocker,
      challenge: currentBundle.challenge,
      bundle: currentBundle,
      changed: false,
      reason: "Attempt budget exhausted without clearing the blocker.",
      url: currentBundle.url,
      title: currentBundle.title
    },
    reusedExistingSession,
    reusedCookies
  };
};
