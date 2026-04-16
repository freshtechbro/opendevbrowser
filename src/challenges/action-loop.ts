import type { ChallengeRuntimeHandle } from "../browser/manager-types";
import { verifyChallengeProgress } from "./verification-gate";
import type { ProvidersChallengeOrchestrationConfig } from "../config";
import { selectChallengeActionStep } from "./inspect-plan";
import type {
  ChallengeActionResult,
  ChallengeActionStep,
  ChallengeAutomationHelperEligibility,
  ChallengeEvidenceBundle,
  ChallengeStrategyDecision
} from "./types";

const DEFAULT_HOLD_MS = 1500;

const resolveStepPoint = async (args: {
  handle: ChallengeRuntimeHandle;
  sessionId: string;
  step: ChallengeActionStep;
  targetId?: string | null;
  fallback: { x: number; y: number };
}): Promise<{ x: number; y: number }> => {
  if (!args.step.ref) {
    return args.step.coordinates ?? args.fallback;
  }
  return await args.handle.resolveRefPoint(args.sessionId, args.step.ref, args.targetId);
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
    case "click_and_hold": {
      const point = await resolveStepPoint({
        handle: args.handle,
        sessionId: args.sessionId,
        step: args.step,
        targetId: args.targetId,
        fallback: { x: 640, y: 360 }
      });
      await args.handle.pointerMove(args.sessionId, point.x, point.y, args.targetId, 12);
      await args.handle.pointerDown(args.sessionId, point.x, point.y, args.targetId, "left", 1);
      await new Promise((resolve) => setTimeout(resolve, Math.max(250, args.step.holdMs ?? DEFAULT_HOLD_MS)));
      await args.handle.pointerUp(args.sessionId, point.x, point.y, args.targetId, "left", 1);
      return;
    }
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
      {
        const point = await resolveStepPoint({
          handle: args.handle,
          sessionId: args.sessionId,
          step: args.step,
          targetId: args.targetId,
          fallback: args.step.coordinates ?? { x: 640, y: 360 }
        });
        await args.handle.drag(
          args.sessionId,
          point,
          {
            x: point.x,
            y: point.y + 260
          },
          args.targetId,
          16
        );
      }
      return;
    case "cookie_list":
      await args.handle.cookieList(args.sessionId, args.step.url ? [args.step.url] : undefined);
      return;
    case "cookie_import":
      await args.handle.cookieImport(args.sessionId, args.step.cookies ?? [], true);
      return;
    case "snapshot":
      await args.handle.snapshot(
        args.sessionId,
        "actionables",
        args.step.snapshotChars ?? 2400,
        undefined,
        args.targetId
      );
      return;
    case "debug_trace":
      await args.handle.debugTraceSnapshot(args.sessionId, { max: args.step.traceMax ?? 50 });
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
  helperEligibility: ChallengeAutomationHelperEligibility;
  config: ProvidersChallengeOrchestrationConfig;
  suggestedSteps?: ChallengeActionStep[];
}): Promise<ChallengeActionResult> => {
  let currentBundle = args.initialBundle;
  let currentTargetId = args.targetId ?? args.initialBundle.activeTargetId ?? null;
  const executedSteps: ChallengeActionStep[] = [];
  let noProgressCount = 0;
  let reusedExistingSession = false;
  let reusedCookies = false;

  for (let attempt = 1; attempt <= args.decision.attemptBudget; attempt += 1) {
    const step = selectChallengeActionStep({
      bundle: currentBundle,
      decision: args.decision,
      helperEligibility: args.helperEligibility,
      config: args.config,
      preferredSteps: args.suggestedSteps,
      executedSteps
    });

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
        targetId: currentTargetId,
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
      targetId: currentTargetId,
      previous: currentBundle,
      canImportCookies: currentBundle.continuity.canImportCookies,
      fallbackDisposition: currentBundle.fallbackDisposition,
      registryPressure: currentBundle.registryPressure,
      taskData: currentBundle.taskData
    });
    currentBundle = verification.bundle ?? currentBundle;
    currentTargetId = verification.bundle?.activeTargetId ?? currentTargetId;

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
