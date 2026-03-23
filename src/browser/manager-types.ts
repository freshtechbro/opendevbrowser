/* c8 ignore file */
import type { BrowserManager } from "./browser-manager";
import type { BlockerSignalV1, SessionChallengeSummary } from "../providers/types";
import type { ChallengeAutomationMode, ChallengeOrchestrationSnapshot } from "../challenges";
import type {
  RuntimePreviewBridgeInput,
  RuntimePreviewBridgeResult
} from "./canvas-runtime-preview-bridge";

export type BrowserCanvasOverlaySelection = {
  pageId: string | null;
  nodeId: string | null;
  targetId: string | null;
  updatedAt?: string;
};

export type BrowserCanvasOverlayMountInput = {
  mountId: string;
  title: string;
  prototypeId: string;
  selection: BrowserCanvasOverlaySelection;
};

export type BrowserCanvasOverlaySyncInput = {
  mountId: string;
  title: string;
  selection: BrowserCanvasOverlaySelection;
};

export type BrowserCanvasOverlaySelectInput = {
  mountId: string;
  nodeId: string | null;
  selectionHint: Record<string, unknown>;
};

export type BrowserCanvasOverlayResult = {
  mountId?: string;
  targetId?: string;
  overlayState?: string;
  previewState?: string;
  capabilities?: Record<string, unknown>;
  selection?: Record<string, unknown>;
  warnings?: Array<Record<string, unknown>>;
  ok?: boolean;
};

export type BrowserBlockerResolutionMeta = {
  status: "resolved" | "unresolved" | "deferred";
  reason: "verifier_passed" | "verification_timeout" | "verifier_failed" | "env_limited" | "manual_clear";
  updatedAt: string;
};

export type BrowserChallengeMeta = SessionChallengeSummary;

export type BrowserResponseMeta = {
  blocker?: BlockerSignalV1;
  blockerState: "clear" | "active" | "resolving";
  blockerUpdatedAt?: string;
  blockerResolution?: BrowserBlockerResolutionMeta;
  challenge?: BrowserChallengeMeta;
  challengeOrchestration?: ChallengeOrchestrationSnapshot;
};

export type BrowserManagerLike = Pick<BrowserManager,
  | "launch"
  | "connect"
  | "disconnect"
  | "status"
  | "withPage"
  | "cookieImport"
  | "cookieList"
  | "goto"
  | "waitForLoad"
  | "waitForRef"
  | "snapshot"
  | "click"
  | "hover"
  | "press"
  | "check"
  | "uncheck"
  | "type"
  | "select"
  | "scroll"
  | "scrollIntoView"
  | "domGetHtml"
  | "domGetText"
  | "domGetAttr"
  | "domGetValue"
  | "domIsVisible"
  | "domIsEnabled"
  | "domIsChecked"
  | "clonePage"
  | "cloneComponent"
  | "perfMetrics"
  | "screenshot"
  | "consolePoll"
  | "networkPoll"
  | "debugTraceSnapshot"
  | "listPages"
  | "page"
  | "closePage"
  | "listTargets"
  | "useTarget"
  | "newTarget"
  | "closeTarget"
  | "pointerMove"
  | "pointerDown"
  | "pointerUp"
  | "drag"
> & {
  connectRelay: (
    wsEndpoint: string,
    options?: { startUrl?: string }
  ) => ReturnType<BrowserManager["connectRelay"]>;
  registerCanvasTarget?: (
    sessionId: string,
    targetId: string
  ) => Promise<{ targetId: string; url?: string; title?: string; adopted?: boolean }>;
  supportsOpsOverlayTransport?: (
    sessionId: string
  ) => boolean;
  applyRuntimePreviewBridge?: (
    sessionId: string,
    targetId: string | null,
    input: RuntimePreviewBridgeInput
  ) => Promise<RuntimePreviewBridgeResult>;
  mountCanvasOverlay?: (
    sessionId: string,
    targetId: string,
    input: BrowserCanvasOverlayMountInput
  ) => Promise<BrowserCanvasOverlayResult>;
  unmountCanvasOverlay?: (
    sessionId: string,
    targetId: string,
    mountId: string
  ) => Promise<BrowserCanvasOverlayResult>;
  selectCanvasOverlay?: (
    sessionId: string,
    targetId: string,
    input: BrowserCanvasOverlaySelectInput
  ) => Promise<BrowserCanvasOverlayResult>;
  syncCanvasOverlay?: (
    sessionId: string,
    targetId: string,
    input: BrowserCanvasOverlaySyncInput
  ) => Promise<BrowserCanvasOverlayResult>;
  getSessionChallengeAutomationMode?: (
    sessionId: string
  ) => ChallengeAutomationMode | undefined;
  setSessionChallengeAutomationMode?: (
    sessionId: string,
    mode?: ChallengeAutomationMode
  ) => void;
  createChallengeRuntimeHandle?: () => ChallengeRuntimeHandle;
};

export type ChallengeRuntimeHandle = Pick<BrowserManagerLike,
  | "status"
  | "goto"
  | "waitForLoad"
  | "snapshot"
  | "click"
  | "hover"
  | "press"
  | "type"
  | "select"
  | "scroll"
  | "pointerMove"
  | "pointerDown"
  | "pointerUp"
  | "drag"
  | "cookieList"
  | "cookieImport"
  | "debugTraceSnapshot"
>;
