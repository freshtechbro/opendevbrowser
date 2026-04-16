import { randomUUID } from "node:crypto";
import type { BrowserManagerLike, BrowserReviewResult } from "../browser/manager-types";
import { buildBrowserReviewResult } from "../browser/review-surface";
import type { ProvidersChallengeGovernedLanesConfig } from "../config";
import type {
  DesktopAuditInfo,
  DesktopCapability,
  DesktopAccessibilityValue,
  DesktopCaptureValue,
  DesktopResult,
  DesktopRuntimeLike,
  DesktopRuntimeStatus,
  DesktopWindowSummary
} from "../desktop";
import type {
  ChallengeAutomationMode,
  ChallengeGovernedLaneKind,
  ChallengeInspectPlan
} from "../challenges";

type WindowScopedObservationMode = "active_window" | "hinted_window";
type DesktopObservationFailure = Extract<DesktopResult<never>, { ok: false }>;

export type DesktopObservationRequest = {
  reason: string;
  browserSessionId?: string;
  targetWindowHint?: {
    ownerName?: string;
    title?: string;
  };
  includeWindows?: boolean;
  includeActiveWindow?: boolean;
  capture?: "none" | "desktop" | WindowScopedObservationMode;
  accessibility?: "none" | WindowScopedObservationMode;
};

export type DesktopObservationEnvelope = {
  observationId: string;
  requestedAt: string;
  browserSessionId?: string;
  status: DesktopRuntimeStatus;
  windows?: DesktopWindowSummary[];
  windowsAudit?: DesktopAuditInfo;
  windowsFailure?: DesktopObservationFailure;
  activeWindow?: DesktopWindowSummary | null;
  activeWindowAudit?: DesktopAuditInfo;
  activeWindowFailure?: DesktopObservationFailure;
  capture?: DesktopCaptureValue;
  captureAudit?: DesktopAuditInfo;
  captureFailure?: DesktopObservationFailure;
  accessibility?: DesktopAccessibilityValue;
  accessibilityAudit?: DesktopAuditInfo;
  accessibilityFailure?: DesktopObservationFailure;
};

export type BrowserVerificationEnvelope = {
  observationId: string;
  verifiedAt: string;
  review: BrowserReviewResult;
};

export type DesktopReviewRequest = Omit<DesktopObservationRequest, "reason"> & {
  browserSessionId: string;
  reason?: string;
  targetId?: string | null;
  maxChars?: number;
  cursor?: string;
};

export type DesktopReviewResult = {
  browserSessionId: string;
  observation: DesktopObservationEnvelope;
  verification: BrowserVerificationEnvelope;
};

export type RuntimeCapabilityDiscovery = {
  host: {
    desktopObservation: DesktopRuntimeStatus & {
      accessibilityAvailable: boolean;
    };
    browserReplay: {
      available: true;
    };
    browserScopedComputerUse: {
      mode: ChallengeAutomationMode;
      helperBridgeEnabled: boolean;
      governedLanes: ChallengeGovernedLaneKind[];
    };
    firstClassSurfaces: {
      reviewDesktop: true;
      sessionInspectorPlan: true;
      sessionInspectorAudit: true;
      statusCapabilities: true;
    };
  };
  session?: {
    sessionId: string;
    targetId?: string | null;
    challengePlan: ChallengeInspectPlan;
  };
};

export interface AutomationCoordinatorLike {
  desktopAvailable(): Promise<boolean>;
  requestDesktopObservation(
    args: DesktopObservationRequest
  ): Promise<DesktopObservationEnvelope>;
  verifyAfterDesktopObservation(args: {
    browserSessionId: string;
    targetId?: string | null;
    observationId: string;
    maxChars?: number;
    cursor?: string;
  }): Promise<BrowserVerificationEnvelope>;
  reviewDesktop(args: DesktopReviewRequest): Promise<DesktopReviewResult>;
  inspectChallengePlan(args: {
    browserSessionId: string;
    targetId?: string | null;
    runMode?: ChallengeAutomationMode;
  }): Promise<ChallengeInspectPlan>;
  statusCapabilities(args: {
    browserSessionId?: string;
    targetId?: string | null;
    runMode?: ChallengeAutomationMode;
  }): Promise<RuntimeCapabilityDiscovery>;
}

type CreateAutomationCoordinatorArgs = {
  manager: BrowserManagerLike;
  desktopRuntime: DesktopRuntimeLike;
  challengeMode: ChallengeAutomationMode;
  governedLanes: ProvidersChallengeGovernedLanesConfig;
  helperBridgeEnabled: boolean;
  snapshotMaxChars: number;
};

const normalizeText = (value: string | undefined): string | undefined => {
  return value?.trim().toLowerCase() || undefined;
};

const findHintedWindow = (
  windows: DesktopWindowSummary[],
  hint?: DesktopObservationRequest["targetWindowHint"]
): DesktopWindowSummary | null => {
  if (!hint) {
    return null;
  }
  const ownerName = normalizeText(hint.ownerName);
  const title = normalizeText(hint.title);
  for (const window of windows) {
    const ownerMatches = !ownerName || normalizeText(window.ownerName) === ownerName;
    const titleMatches = !title || normalizeText(window.title) === title;
    if (ownerMatches && titleMatches) {
      return window;
    }
  }
  return null;
};

const toDesktopObservationFailure = (
  code: DesktopObservationFailure["code"],
  message: string,
  audit: DesktopObservationFailure["audit"]
): DesktopObservationFailure => ({
  ok: false,
  code,
  message,
  audit
});

const createWindowResolutionFailure = (
  audit: DesktopObservationFailure["audit"]
): DesktopObservationFailure => {
  return toDesktopObservationFailure(
    "desktop_window_not_found",
    "Requested desktop window could not be resolved.",
    audit
  );
};

const accessibilityAvailable = (capabilities: DesktopCapability[]): boolean => {
  return capabilities.includes("observe.accessibility");
};

const resolveGovernedLanes = (
  governedLanes: ProvidersChallengeGovernedLanesConfig
): ChallengeGovernedLaneKind[] => {
  return [
    ...(governedLanes.allowOwnedEnvironmentFixtures ? ["owned_environment_fixture" as const] : []),
    ...(governedLanes.allowSanctionedIdentity ? ["sanctioned_identity" as const] : []),
    ...(governedLanes.allowServiceAdapters ? ["service_adapter" as const] : [])
  ];
};

const DEFAULT_DESKTOP_REVIEW_REASON = "Desktop-assisted browser review.";

export function createAutomationCoordinator(
  args: CreateAutomationCoordinatorArgs
): AutomationCoordinatorLike {
  const desktopAvailable = async (): Promise<boolean> => {
    const status = await args.desktopRuntime.status();
    return status.available;
  };

  const requestDesktopObservation = async (
    request: DesktopObservationRequest
  ): Promise<DesktopObservationEnvelope> => {
    const status = await args.desktopRuntime.status();
    const requestedAt = new Date().toISOString();
    const observationId = randomUUID();
    const includeWindows =
      request.includeWindows ||
      request.capture === "hinted_window" ||
      request.accessibility === "hinted_window";
    const includeActiveWindow =
      request.includeActiveWindow ||
      request.capture === "active_window" ||
      request.accessibility === "active_window";

    const windowsResult = includeWindows
      ? await args.desktopRuntime.listWindows(request.reason)
      : null;
    const windows = windowsResult?.ok ? windowsResult.value.windows : undefined;
    const windowsAudit = windowsResult?.ok ? windowsResult.audit : undefined;
    const windowsFailure = windowsResult && !windowsResult.ok ? windowsResult : undefined;

    const activeWindowResult = includeActiveWindow
      ? await args.desktopRuntime.activeWindow(request.reason)
      : null;
    const activeWindow = activeWindowResult?.ok ? activeWindowResult.value : undefined;
    const activeWindowAudit = activeWindowResult?.ok ? activeWindowResult.audit : undefined;
    const activeWindowFailure = activeWindowResult && !activeWindowResult.ok
      ? activeWindowResult
      : undefined;

    const resolveScopedWindow = async (
      mode: WindowScopedObservationMode
    ): Promise<{ window: DesktopWindowSummary | null; failure?: DesktopObservationFailure }> => {
      if (mode === "active_window") {
        const resolvedActiveWindow = activeWindowResult!;
        if (!resolvedActiveWindow.ok) {
          return {
            window: null,
            failure: resolvedActiveWindow
          };
        }
        return resolvedActiveWindow.value
          ? { window: resolvedActiveWindow.value }
          : { window: null, failure: createWindowResolutionFailure(resolvedActiveWindow.audit) };
      }
      const knownWindows = windowsResult!;
      if (!knownWindows.ok) {
        return {
          window: null,
          failure: knownWindows
        };
      }
      const hintedWindow = findHintedWindow(knownWindows.value.windows, request.targetWindowHint);
      return hintedWindow
        ? { window: hintedWindow }
        : { window: null, failure: createWindowResolutionFailure(knownWindows.audit) };
    };

    let capture: DesktopCaptureValue | undefined;
    let captureAudit: DesktopAuditInfo | undefined;
    let captureFailure: DesktopObservationFailure | undefined;
    if (request.capture === "desktop") {
      const captureResult = await args.desktopRuntime.captureDesktop({ reason: request.reason });
      if (captureResult.ok) {
        capture = captureResult.value;
        captureAudit = captureResult.audit;
      } else {
        captureFailure = captureResult;
      }
    } else if (request.capture === "active_window" || request.capture === "hinted_window") {
      const scopedWindow = await resolveScopedWindow(request.capture);
      if (scopedWindow.window) {
        const captureResult = await args.desktopRuntime.captureWindow(scopedWindow.window.id, {
          reason: request.reason
        });
        if (captureResult.ok) {
          capture = captureResult.value;
          captureAudit = captureResult.audit;
        } else {
          captureFailure = captureResult;
        }
      } else {
        captureFailure = scopedWindow.failure;
      }
    }

    let accessibility: DesktopAccessibilityValue | undefined;
    let accessibilityAudit: DesktopAuditInfo | undefined;
    let accessibilityFailure: DesktopObservationFailure | undefined;
    if (
      request.accessibility === "active_window" ||
      request.accessibility === "hinted_window"
    ) {
      const scopedWindow = await resolveScopedWindow(request.accessibility);
      if (scopedWindow.window) {
        const accessibilityResult = await args.desktopRuntime.accessibilitySnapshot(
          request.reason,
          scopedWindow.window.id
        );
        if (accessibilityResult.ok) {
          accessibility = accessibilityResult.value;
          accessibilityAudit = accessibilityResult.audit;
        } else {
          accessibilityFailure = accessibilityResult;
        }
      } else {
        accessibilityFailure = scopedWindow.failure;
      }
    }

    return {
      observationId,
      requestedAt,
      ...(request.browserSessionId ? { browserSessionId: request.browserSessionId } : {}),
      status,
      ...(windows ? { windows } : {}),
      ...(windowsAudit ? { windowsAudit } : {}),
      ...(windowsFailure ? { windowsFailure } : {}),
      ...(typeof activeWindow !== "undefined" ? { activeWindow } : {}),
      ...(activeWindowAudit ? { activeWindowAudit } : {}),
      ...(activeWindowFailure ? { activeWindowFailure } : {}),
      ...(capture ? { capture } : {}),
      ...(captureAudit ? { captureAudit } : {}),
      ...(captureFailure ? { captureFailure } : {}),
      ...(accessibility ? { accessibility } : {}),
      ...(accessibilityAudit ? { accessibilityAudit } : {}),
      ...(accessibilityFailure ? { accessibilityFailure } : {})
    };
  };

  const verifyAfterDesktopObservation = async (input: {
    browserSessionId: string;
    targetId?: string | null;
    observationId: string;
    maxChars?: number;
    cursor?: string;
  }): Promise<BrowserVerificationEnvelope> => {
    const review = await buildBrowserReviewResult({
      manager: args.manager,
      sessionId: input.browserSessionId,
      targetId: input.targetId,
      maxChars: input.maxChars ?? args.snapshotMaxChars,
      cursor: input.cursor
    });

    return {
      observationId: input.observationId,
      verifiedAt: new Date().toISOString(),
      review
    };
  };

  const inspectChallengePlan = async (input: {
    browserSessionId: string;
    targetId?: string | null;
    runMode?: ChallengeAutomationMode;
  }): Promise<ChallengeInspectPlan> => {
    const challengePlan = await args.manager.inspectChallengePlan?.({
      sessionId: input.browserSessionId,
      targetId: input.targetId,
      runMode: input.runMode
    });
    if (!challengePlan) {
      throw new Error("Challenge inspect-plan is unavailable for the current runtime.");
    }
    return challengePlan;
  };

  const reviewDesktop = async (input: DesktopReviewRequest): Promise<DesktopReviewResult> => {
    const capture = input.capture ?? "active_window";
    const accessibility = input.accessibility ?? "active_window";
    const observation = await requestDesktopObservation({
      ...input,
      reason: input.reason?.trim() || DEFAULT_DESKTOP_REVIEW_REASON,
      capture,
      accessibility,
      includeActiveWindow: input.includeActiveWindow ?? (
        capture === "active_window" || accessibility === "active_window"
      )
    });
    const verification = await verifyAfterDesktopObservation({
      browserSessionId: input.browserSessionId,
      targetId: input.targetId,
      observationId: observation.observationId,
      maxChars: input.maxChars,
      cursor: input.cursor
    });

    return {
      browserSessionId: input.browserSessionId,
      observation,
      verification
    };
  };

  const statusCapabilities = async (input: {
    browserSessionId?: string;
    targetId?: string | null;
    runMode?: ChallengeAutomationMode;
  }): Promise<RuntimeCapabilityDiscovery> => {
    const status = await args.desktopRuntime.status();
    const host: RuntimeCapabilityDiscovery["host"] = {
      desktopObservation: {
        ...status,
        accessibilityAvailable: accessibilityAvailable(status.capabilities)
      },
      browserReplay: {
        available: true
      },
      browserScopedComputerUse: {
        mode: args.challengeMode,
        helperBridgeEnabled: args.helperBridgeEnabled,
        governedLanes: resolveGovernedLanes(args.governedLanes)
      },
      firstClassSurfaces: {
        reviewDesktop: true,
        sessionInspectorPlan: true,
        sessionInspectorAudit: true,
        statusCapabilities: true
      }
    };
    if (!input.browserSessionId) {
      return { host };
    }

    const challengePlan = await inspectChallengePlan({
      browserSessionId: input.browserSessionId,
      targetId: input.targetId,
      runMode: input.runMode
    });

    return {
      host,
      session: {
        sessionId: input.browserSessionId,
        ...(typeof input.targetId !== "undefined" ? { targetId: input.targetId } : {}),
        challengePlan
      }
    };
  };

  return {
    desktopAvailable,
    requestDesktopObservation,
    verifyAfterDesktopObservation,
    reviewDesktop,
    inspectChallengePlan,
    statusCapabilities
  };
}
