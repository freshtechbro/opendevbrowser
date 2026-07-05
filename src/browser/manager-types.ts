/* c8 ignore file */
import type { BrowserManager } from "./browser-manager";
import type { BrowserMode } from "./session-store";
import type { SessionProfileSummary } from "./session-profile-registry";
import type { GoogleAuthIntent } from "../core/auth-intent";
import type {
  BlockerSignalV1,
  ProviderCookiePolicy,
  ProviderCookieSourceConfig,
  ProviderReasonCode,
  SessionChallengeSummary
} from "../providers/types";
import type {
  ChallengeAutomationMode,
  ChallengeInspectPlan,
  ChallengeOrchestrationSnapshot
} from "../challenges";
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
  artifact_path?: string;
  base64?: string;
  warnings?: string[];
};

export type BrowserPinterestPinMediaKind = "image" | "video" | "video_poster";

export type BrowserPinterestPinMediaRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BrowserPinterestPinMediaRejectedCandidate = {
  kind: BrowserPinterestPinMediaKind;
  mediaUrl?: string;
  candidateSelector?: string;
  candidateRole?: string;
  alt?: string;
  width?: number;
  height?: number;
  rect?: BrowserPinterestPinMediaRect;
  ancestry?: string[];
  reasons: string[];
};

export type BrowserPinterestPinMediaOptions = {
  targetId?: string | null;
  path: string;
  timeoutMs?: number;
};

export type BrowserPinterestPinMediaResult = {
  status: "captured" | "not_found";
  sourceUrl: string;
  targetId: string;
  kind?: BrowserPinterestPinMediaKind;
  path?: string;
  mediaUrl?: string;
  contentType?: string;
  bytes?: number;
  candidateSelector?: string;
  candidateRole?: string;
  alt?: string;
  srcset?: string;
  width?: number;
  height?: number;
  naturalWidth?: number;
  naturalHeight?: number;
  poster?: string;
  rect?: BrowserPinterestPinMediaRect;
  ancestry?: string[];
  rejectedCandidates: BrowserPinterestPinMediaRejectedCandidate[];
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
  artifact_path?: string;
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
  artifact_path?: string;
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

export type BrowserAuthProfileSource =
  | "managed_profile"
  | "cdp_connected_profile"
  | "live_extension_profile";

export type BrowserCookieBootstrapProvenance = {
  readonly attempted: boolean;
  readonly disabled: boolean;
  readonly importedCount: number;
  readonly rejectedCount: number;
  readonly skippedGoogleSensitiveCount?: number;
  readonly googleSensitiveCookiePolicy?: "skip" | "include";
  readonly sourceBrowserName?: string;
};

export type BrowserProviderCookieImportProvenance = {
  readonly policy: ProviderCookiePolicy;
  readonly source: ProviderCookieSourceConfig["type"];
  readonly attempted: boolean;
  readonly available: boolean;
  readonly loadedCount: number;
  readonly importedCount: number;
  readonly rejectedCount: number;
  readonly verifiedCount: number;
  readonly strict: boolean;
  readonly sessionEvidence: "not_checked" | "cookies_missing" | "cookies_observable";
  readonly authStateVerified: boolean;
  readonly reasonCode?: ProviderReasonCode;
  readonly message?: string;
};

export type BrowserAuthProvenanceDiagnostics = {
  readonly googleAuthIntent: GoogleAuthIntent;
  readonly profileSource: BrowserAuthProfileSource;
  readonly profile?: SessionProfileSummary;
  readonly cookieBootstrap: BrowserCookieBootstrapProvenance;
  readonly explicitCookieImportAttempted?: boolean;
  readonly providerCookieImport?: BrowserProviderCookieImportProvenance;
};

export type BrowserSessionDiagnostics = {
  readonly authProvenance: BrowserAuthProvenanceDiagnostics;
};

export type BrowserCookieImportResult = {
  readonly requestId: string;
  readonly imported: number;
  readonly rejected: ReadonlyArray<{ readonly index: number; readonly reason: string }>;
  readonly diagnostics?: BrowserSessionDiagnostics;
};

export type BrowserAuthSessionOptions = {
  readonly googleAuthIntent?: GoogleAuthIntent;
  readonly disableSystemCookieBootstrap?: boolean;
  readonly allowGoogleCookieBootstrap?: boolean;
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
    options?: { startUrl?: string } & BrowserAuthSessionOptions
  ) => ReturnType<BrowserManager["connectRelay"]>;
  startExplicitCdpProfile?: BrowserManager["startExplicitCdpProfile"];
  statusExplicitCdpProfile?: BrowserManager["statusExplicitCdpProfile"];
  stopExplicitCdpProfile?: BrowserManager["stopExplicitCdpProfile"];
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
  recordProviderCookieImportProvenance?: (
    sessionId: string,
    input: BrowserProviderCookieImportProvenance
  ) => BrowserAuthProvenanceDiagnostics | undefined;
  inspectChallengePlan?: (input: {
    sessionId: string;
    targetId?: string | null;
    runMode?: ChallengeAutomationMode;
  }) => Promise<ChallengeInspectPlan>;
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
  capturePinterestPinMedia?: (
    sessionId: string,
    options: BrowserPinterestPinMediaOptions
  ) => Promise<BrowserPinterestPinMediaResult>;
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
