import { randomUUID } from "node:crypto";
import type { BrowserManagerLike, BrowserReviewResult } from "../browser/manager-types";
import { buildBrowserReviewResult } from "../browser/review-surface";
import type {
  DesktopAccessibilityValue,
  DesktopCaptureValue,
  DesktopResult,
  DesktopRuntimeLike,
  DesktopRuntimeStatus,
  DesktopWindowSummary
} from "../desktop";

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
  windowsFailure?: DesktopObservationFailure;
  activeWindow?: DesktopWindowSummary | null;
  activeWindowFailure?: DesktopObservationFailure;
  capture?: DesktopCaptureValue;
  captureFailure?: DesktopObservationFailure;
  accessibility?: DesktopAccessibilityValue;
  accessibilityFailure?: DesktopObservationFailure;
};

export type BrowserVerificationEnvelope = {
  observationId: string;
  verifiedAt: string;
  review: BrowserReviewResult;
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
    maxChars: number;
    cursor?: string;
  }): Promise<BrowserVerificationEnvelope>;
}

type CreateAutomationCoordinatorArgs = {
  manager: BrowserManagerLike;
  desktopRuntime: DesktopRuntimeLike;
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

export function createAutomationCoordinator(
  args: CreateAutomationCoordinatorArgs
): AutomationCoordinatorLike {
  return {
    async desktopAvailable() {
      const status = await args.desktopRuntime.status();
      return status.available;
    },

    async requestDesktopObservation(request) {
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
      const windowsFailure = windowsResult && !windowsResult.ok ? windowsResult : undefined;

      const activeWindowResult = includeActiveWindow
        ? await args.desktopRuntime.activeWindow(request.reason)
        : null;
      const activeWindow = activeWindowResult?.ok ? activeWindowResult.value : undefined;
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
      let captureFailure: DesktopObservationFailure | undefined;
      if (request.capture === "desktop") {
        const captureResult = await args.desktopRuntime.captureDesktop({ reason: request.reason });
        if (captureResult.ok) {
          capture = captureResult.value;
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
          } else {
            captureFailure = captureResult;
          }
        } else {
          captureFailure = scopedWindow.failure;
        }
      }

      let accessibility: DesktopAccessibilityValue | undefined;
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
        ...(windowsFailure ? { windowsFailure } : {}),
        ...(typeof activeWindow !== "undefined" ? { activeWindow } : {}),
        ...(activeWindowFailure ? { activeWindowFailure } : {}),
        ...(capture ? { capture } : {}),
        ...(captureFailure ? { captureFailure } : {}),
        ...(accessibility ? { accessibility } : {}),
        ...(accessibilityFailure ? { accessibilityFailure } : {})
      };
    },

    async verifyAfterDesktopObservation(input) {
      const review = await buildBrowserReviewResult({
        manager: args.manager,
        sessionId: input.browserSessionId,
        targetId: input.targetId,
        maxChars: input.maxChars,
        cursor: input.cursor
      });

      return {
        observationId: input.observationId,
        verifiedAt: new Date().toISOString(),
        review
      };
    }
  };
}
