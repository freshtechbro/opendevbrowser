/* c8 ignore file */
import type { BrowserManager } from "./browser-manager";
import type { BrowserMode } from "./session-store";
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

export type BrowserClonePageOptions = {
  maxNodes?: number;
  inlineStyles?: boolean;
};

export type BrowserCloneHtmlResult = {
  html: string;
  warnings?: string[];
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

export type BrowserScreenshotOptions = {
  targetId?: string | null;
  path?: string;
  ref?: string;
  fullPage?: boolean;
};

export type BrowserScreenshotResult = {
  path?: string;
  base64?: string;
  warnings?: string[];
};

export type BrowserScreencastStartOptions = {
  targetId?: string | null;
  outputDir?: string;
  intervalMs?: number;
  maxFrames?: number;
};

export type BrowserScreencastSession = {
  screencastId: string;
  sessionId: string;
  targetId: string;
  outputDir: string;
  startedAt: string;
  intervalMs: number;
  maxFrames: number;
  warnings?: string[];
};

export type BrowserScreencastEndedReason =
  | "stopped"
  | "max_frames_reached"
  | "session_closed"
  | "target_closed"
  | "capture_failed";

export type BrowserScreencastResult = {
  screencastId: string;
  sessionId: string;
  targetId: string;
  outputDir: string;
  startedAt: string;
  endedAt: string;
  endedReason: BrowserScreencastEndedReason;
  frameCount: number;
  manifestPath: string;
  replayHtmlPath: string;
  previewPath?: string;
  warnings?: string[];
};

export const SCREENCAST_RETENTION_MS = 10 * 60_000;

export type BrowserUploadInput = {
  targetId?: string | null;
  ref: string;
  files: string[];
};

export type BrowserUploadResult = {
  targetId?: string;
  fileCount: number;
  mode: "direct_input" | "file_chooser";
  warnings?: string[];
};

export type BrowserDialogAction = "status" | "accept" | "dismiss";

export type BrowserDialogType = "alert" | "confirm" | "prompt" | "beforeunload";

export type BrowserDialogInput = {
  targetId?: string | null;
  action?: BrowserDialogAction;
  promptText?: string;
};

export type BrowserDialogState = {
  open: boolean;
  targetId?: string;
  type?: BrowserDialogType;
  message?: string;
  defaultPrompt?: string;
  url?: string;
  openedAt?: string;
};

export type BrowserDialogResult = {
  dialog: BrowserDialogState;
  handled?: boolean;
};

export type BrowserResponseMeta = {
  blocker?: BlockerSignalV1;
  blockerState: "clear" | "active" | "resolving";
  blockerUpdatedAt?: string;
  blockerResolution?: BrowserBlockerResolutionMeta;
  challenge?: BrowserChallengeMeta;
  challengeOrchestration?: ChallengeOrchestrationSnapshot;
  dialog?: BrowserDialogState;
};

export type BrowserReviewResult = {
  sessionId: string;
  targetId: string | null;
  mode: BrowserMode;
  snapshotId: string;
  url?: string;
  title?: string;
  content: string;
  truncated: boolean;
  nextCursor?: string;
  refCount: number;
  timingMs: number;
  warnings?: string[];
  meta?: BrowserResponseMeta;
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
  | "startScreencast"
  | "stopScreencast"
  | "upload"
  | "dialog"
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
  createSessionInspector?: () => SessionInspectorHandle;
  clonePageHtmlWithOptions?: (
    sessionId: string,
    targetId?: string | null,
    options?: BrowserClonePageOptions
  ) => Promise<BrowserCloneHtmlResult>;
  clonePageWithOptions?: (
    sessionId: string,
    targetId?: string | null,
    options?: BrowserClonePageOptions
  ) => ReturnType<BrowserManager["clonePage"]>;
  monitorScreencastCompletion?: (
    screencastId: string,
    listener: (result: BrowserScreencastResult) => void
  ) => () => void;
};

export type SessionInspectorHandle = Pick<BrowserManagerLike,
  | "status"
  | "listTargets"
  | "consolePoll"
  | "networkPoll"
  | "debugTraceSnapshot"
>;

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
> & {
  resolveRefPoint: (
    sessionId: string,
    ref: string,
    targetId?: string | null
  ) => Promise<{ x: number; y: number }>;
};
