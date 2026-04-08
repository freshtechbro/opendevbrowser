import { randomUUID } from "node:crypto";
import type { BrowserManagerLike, BrowserReviewResult } from "../browser/manager-types";
import { buildBrowserReviewResult } from "../browser/review-surface";
import type {
  DesktopCaptureValue,
  DesktopRuntimeLike,
  DesktopRuntimeStatus,
  DesktopWindowSummary
} from "../desktop";

export type DesktopObservationRequest = {
  reason: string;
  browserSessionId?: string;
  targetWindowHint?: {
    ownerName?: string;
    title?: string;
  };
  includeWindows?: boolean;
  includeActiveWindow?: boolean;
  capture?: "none" | "desktop" | "active_window" | "hinted_window";
};

export type DesktopObservationEnvelope = {
  observationId: string;
  requestedAt: string;
  browserSessionId?: string;
  status: DesktopRuntimeStatus;
  windows?: DesktopWindowSummary[];
  activeWindow?: DesktopWindowSummary | null;
  capture?: DesktopCaptureValue;
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
      const includeWindows = request.includeWindows || request.capture === "hinted_window";
      const includeActiveWindow = request.includeActiveWindow || request.capture === "active_window";

      const windowsResult = includeWindows
        ? await args.desktopRuntime.listWindows(request.reason)
        : null;
      const windows = windowsResult?.ok ? windowsResult.value.windows : undefined;

      const activeWindowResult = includeActiveWindow
        ? await args.desktopRuntime.activeWindow(request.reason)
        : null;
      const activeWindow = activeWindowResult?.ok ? activeWindowResult.value : undefined;

      let capture: DesktopCaptureValue | undefined;
      if (request.capture === "desktop") {
        const captureResult = await args.desktopRuntime.captureDesktop({ reason: request.reason });
        if (captureResult.ok) {
          capture = captureResult.value;
        }
      } else if (request.capture === "active_window") {
        const resolvedActiveWindow = activeWindowResult ?? await args.desktopRuntime.activeWindow(request.reason);
        if (resolvedActiveWindow.ok && resolvedActiveWindow.value) {
          const captureResult = await args.desktopRuntime.captureWindow(
            resolvedActiveWindow.value.id,
            { reason: request.reason }
          );
          if (captureResult.ok) {
            capture = captureResult.value;
          }
        }
      } else if (request.capture === "hinted_window") {
        const knownWindows = windowsResult ?? await args.desktopRuntime.listWindows(request.reason);
        if (knownWindows.ok) {
          const hintedWindow = findHintedWindow(knownWindows.value.windows, request.targetWindowHint);
          if (hintedWindow) {
            const captureResult = await args.desktopRuntime.captureWindow(hintedWindow.id, {
              reason: request.reason
            });
            if (captureResult.ok) {
              capture = captureResult.value;
            }
          }
        }
      }

      return {
        observationId,
        requestedAt,
        ...(request.browserSessionId ? { browserSessionId: request.browserSessionId } : {}),
        status,
        ...(windows ? { windows } : {}),
        ...(typeof activeWindow !== "undefined" ? { activeWindow } : {}),
        ...(capture ? { capture } : {})
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
