import {
  MAX_OPS_PAYLOAD_BYTES,
  MAX_SNAPSHOT_BYTES,
  OPS_PROTOCOL_VERSION,
  type OpsEnvelope,
  type OpsError,
  type OpsErrorCode,
  type OpsErrorResponse,
  type OpsEvent,
  type OpsHello,
  type OpsHelloAck,
  type OpsPing,
  type OpsPong,
  type OpsRequest,
  type OpsResponse,
  type OpsChunk
} from "../types.js";
import {
  CDPRouter,
  type CDPRouterEvent,
  type ChildTargetAttachDiagnostic,
  type RootAttachDiagnostic,
  type RootRefreshDiagnostic
} from "../services/CDPRouter.js";
import type { DebuggerSession } from "../services/TargetSessionMap.js";
import { isAttachBlockedError } from "../services/attach-errors.js";
import { TabManager } from "../services/TabManager.js";
import { getRestrictionMessage, isRestrictedUrl } from "../services/url-restrictions.js";
import { logError } from "../logging.js";
import type { CanvasPageElementAction, CanvasPageState } from "../canvas/model.js";
import { DomBridge, type DomCapture } from "./dom-bridge.js";
import { buildSnapshot, type SnapshotMode } from "./snapshot-builder.js";
import {
  OpsSessionStore,
  type OpsSession,
  type OpsConsoleEvent,
  type OpsDialogState,
  type OpsFileChooserState,
  type OpsNetworkEvent,
  type OpsTargetInfo,
  type OpsSyntheticTargetRecord
} from "./ops-session-store.js";
import {
  DEFAULT_OPS_PARALLELISM_POLICY,
  evaluateOpsGovernor,
  type OpsParallelismGovernorPolicy,
  type OpsParallelismGovernorSnapshot
} from "./parallelism-governor.js";
import { redactConsoleText, redactUrl } from "./redaction.js";

const MAX_CONSOLE_EVENTS = 200;
const MAX_NETWORK_EVENTS = 300;
const SESSION_TTL_MS = 20_000;
const SCREENSHOT_TIMEOUT_MS = 8000;
const TAB_CLOSE_TIMEOUT_MS = 5000;
const OPS_SESSION_DETACH_TIMEOUT_MS = 3000;
const POPUP_ATTACH_RETRY_DELAY_MS = 100;
const ROOT_DETACH_VERIFY_DELAY_MS = 250;
const ROOT_DETACH_VERIFY_ATTEMPTS = 4;
const STALE_REF_ERROR_SUFFIX = "Take a new snapshot first.";

const DOM_OUTER_HTML_DECLARATION = `
  function() {
    if (!(this instanceof Element)) return "";
    return this.outerHTML;
  }
`;

const DOM_INNER_TEXT_DECLARATION = `
  function() {
    if (!(this instanceof Element)) return "";
    return this instanceof HTMLElement ? (this.innerText || this.textContent || "") : (this.textContent || "");
  }
`;

const DOM_GET_ATTR_DECLARATION = `
  function(name) {
    if (!(this instanceof Element)) return null;
    const value = this.getAttribute(name);
    return value === null ? null : String(value);
  }
`;

const DOM_GET_VALUE_DECLARATION = `
  function() {
    if (this instanceof HTMLInputElement || this instanceof HTMLTextAreaElement || this instanceof HTMLSelectElement) {
      return this.value;
    }
    if (!(this instanceof Element)) return null;
    const value = this.getAttribute("value");
    return value === null ? null : String(value);
  }
`;

const DOM_IS_VISIBLE_DECLARATION = `
  function() {
    if (!(this instanceof Element)) return false;
    const style = window.getComputedStyle(this);
    if (!style || style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    const rect = this.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
`;

const DOM_IS_ENABLED_DECLARATION = `
  function() {
    if (!(this instanceof Element)) return false;
    return !this.hasAttribute("disabled") && this.getAttribute("aria-disabled") !== "true";
  }
`;

const DOM_IS_CHECKED_DECLARATION = `
  function() {
    if (this instanceof HTMLInputElement && (this.type === "checkbox" || this.type === "radio")) {
      return this.checked;
    }
    if (!(this instanceof Element)) return false;
    return this.getAttribute("aria-checked") === "true";
  }
`;

const DOM_SELECTOR_STATE_DECLARATION = `
  function() {
    if (!(this instanceof Element)) {
      return { attached: false, visible: false };
    }
    const style = window.getComputedStyle(this);
    const rect = this.getBoundingClientRect();
    return {
      attached: true,
      visible: Boolean(style && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0" && rect.width > 0 && rect.height > 0)
    };
  }
`;

const DOM_HOVER_DECLARATION = `
  function() {
    if (!(this instanceof Element)) return;
    const init = { bubbles: true, cancelable: true, view: window };
    this.dispatchEvent(new MouseEvent("mouseenter", init));
    this.dispatchEvent(new MouseEvent("mouseover", init));
    this.dispatchEvent(new MouseEvent("mousemove", init));
  }
`;

const DOM_FOCUS_DECLARATION = `
  function() {
    if (this instanceof HTMLElement) {
      this.focus();
    }
  }
`;

const DOM_SET_CHECKED_DECLARATION = `
  function(checked) {
    if (this instanceof HTMLInputElement && (this.type === "checkbox" || this.type === "radio")) {
      this.checked = Boolean(checked);
      this.dispatchEvent(new Event("input", { bubbles: true }));
      this.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    if (this instanceof Element) {
      this.setAttribute("aria-checked", checked ? "true" : "false");
    }
  }
`;

const DOM_TYPE_DECLARATION = `
  function(value, clear, submit) {
    if (!(this instanceof Element)) return;
    if (this instanceof HTMLElement) {
      this.focus();
    }
    if (this instanceof HTMLInputElement || this instanceof HTMLTextAreaElement) {
      this.value = clear ? "" : this.value;
      this.value = String(value);
      this.dispatchEvent(new Event("input", { bubbles: true }));
      this.dispatchEvent(new Event("change", { bubbles: true }));
      if (submit) {
        this.form?.requestSubmit?.();
      }
      return;
    }
    if (this instanceof HTMLSelectElement) {
      this.value = String(value);
      this.dispatchEvent(new Event("input", { bubbles: true }));
      this.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
`;

const DOM_SELECT_DECLARATION = `
  function(values) {
    if (!(this instanceof HTMLSelectElement)) return;
    const nextValues = Array.isArray(values) ? values.map((value) => String(value)) : [];
    for (const option of Array.from(this.options)) {
      option.selected = nextValues.includes(option.value);
    }
    this.dispatchEvent(new Event("input", { bubbles: true }));
    this.dispatchEvent(new Event("change", { bubbles: true }));
  }
`;

const DOM_SCROLL_BY_DECLARATION = `
  function(dy) {
    if (!(this instanceof HTMLElement)) return;
    this.scrollBy(0, Number(dy) || 0);
  }
`;

const DOM_SCROLL_INTO_VIEW_DECLARATION = `
  function() {
    if (this instanceof Element) {
      this.scrollIntoView({ block: "center", inline: "center", behavior: "auto" });
    }
  }
`;

const DOM_REF_POINT_DECLARATION = `
  function() {
    if (!(this instanceof Element)) return null;
    const rect = this.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
  }
`;

const DOM_SCREENSHOT_CLIP_DECLARATION = `
  function() {
    /* odb-dom-screenshot-clip */
    if (!(this instanceof Element)) return null;
    const rect = this.getBoundingClientRect();
    if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    return {
      x: rect.left + window.scrollX,
      y: rect.top + window.scrollY,
      width: rect.width,
      height: rect.height
    };
  }
`;

const DOM_FILE_INPUT_INFO_DECLARATION = `
  function() {
    /* odb-dom-file-input-info */
    const isFileInput = this instanceof HTMLInputElement && this.type === "file";
    return {
      isFileInput,
      disabled: isFileInput ? this.disabled : false
    };
  }
`;

const TARGET_SCOPED_COMMANDS = new Set<string>([
  "storage.setCookies",
  "storage.getCookies",
  "nav.goto",
  "nav.wait",
  "nav.snapshot",
  "nav.review",
  "interact.click",
  "interact.hover",
  "interact.press",
  "interact.check",
  "interact.uncheck",
  "interact.type",
  "interact.select",
  "interact.scroll",
  "interact.scrollIntoView",
  "interact.upload",
  "pointer.move",
  "pointer.down",
  "pointer.up",
  "pointer.drag",
  "dom.getHtml",
  "dom.getText",
  "dom.getAttr",
  "dom.getValue",
  "dom.isVisible",
  "dom.isEnabled",
  "dom.isChecked",
  "dom.refPoint",
  "canvas.overlay.mount",
  "canvas.overlay.unmount",
  "canvas.overlay.select",
  "canvas.overlay.sync",
  "canvas.applyRuntimePreviewBridge",
  "export.clonePage",
  "export.cloneComponent",
  "devtools.perf",
  "page.screenshot"
]);

const DIALOG_SCOPED_COMMANDS = new Set<string>([
  "page.dialog"
]);

type OpsParallelWaiter = {
  targetId: string;
  enqueuedAt: number;
  timeoutMs: number;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: number | null;
};

type ResolvedOpsTarget = {
  targetId: string;
  tabId: number;
  type: string;
  synthetic: boolean;
  url?: string;
  title?: string;
  sessionId?: string;
  openerTargetId?: string;
  debuggee: chrome.debugger.Debuggee & { sessionId?: string };
};

type ResolvedOpsRef = {
  target: ResolvedOpsTarget;
  ref: string;
  selector: string;
  backendNodeId: number;
  snapshotId: string;
  frameId?: string;
  role?: string;
  name?: string;
};

type PopupAttachDiagnosticStage =
  | "targets_lookup_failed"
  | "resolve_tab_target_failed"
  | ChildTargetAttachDiagnostic["stage"];

type PopupAttachMatcher =
  | "url"
  | "title"
  | "non_opener"
  | "resolve_tab_target_id";

type PopupAttachDiagnostic = {
  targetId: string;
  tabId: number;
  openerTargetId?: string;
  popupTargetId?: string;
  stage: PopupAttachDiagnosticStage;
  matcher?: PopupAttachMatcher;
  initialStage?: ChildTargetAttachDiagnostic["initialStage"];
  rootTargetRetryStage?: ChildTargetAttachDiagnostic["rootTargetRetryStage"];
  attachedRootRecoveryStage?: ChildTargetAttachDiagnostic["attachedRootRecoveryStage"];
  attachedRootRecoverySource?: ChildTargetAttachDiagnostic["attachedRootRecoverySource"];
  attachedRootRecoveryAttachTargetId?: ChildTargetAttachDiagnostic["attachedRootRecoveryAttachTargetId"];
  attachedRootRecoveryRetriedAfterRegisterRoot?: ChildTargetAttachDiagnostic["attachedRootRecoveryRetriedAfterRegisterRoot"];
  attachedRootRecoveryRegisterRootChanged?: ChildTargetAttachDiagnostic["attachedRootRecoveryRegisterRootChanged"];
  attachedRootRecoveryRegisterRootAttachTargetChanged?: ChildTargetAttachDiagnostic["attachedRootRecoveryRegisterRootAttachTargetChanged"];
  attachedRootRecoveryRegisterAttachedRootSessionCalled?: ChildTargetAttachDiagnostic["attachedRootRecoveryRegisterAttachedRootSessionCalled"];
  attachedRootUnavailableTerminalBranch?: ChildTargetAttachDiagnostic["attachedRootUnavailableTerminalBranch"];
  reattachRecoveryStage?: ChildTargetAttachDiagnostic["reattachRecoveryStage"];
  reattachRecoveryReason?: ChildTargetAttachDiagnostic["reattachRecoveryReason"];
  attachedRootRecoveryReason?: ChildTargetAttachDiagnostic["attachedRootRecoveryReason"];
  refreshPath?: RootRefreshDiagnostic["path"];
  refreshCompleted?: boolean;
  refreshDebuggeePresent?: boolean;
  refreshRootSessionPresent?: boolean;
  refreshRootTargetId?: string;
  refreshProbeMethod?: RootRefreshDiagnostic["probeMethod"];
  refreshProbeStage?: RootRefreshDiagnostic["probeStage"];
  refreshProbeReason?: string;
  refreshReason?: string;
  targetsLookupFailed?: boolean;
  reason?: string;
  at: number;
};

type RootEnablementFailureStage =
  | "resolve_ready_debuggee"
  | "set_discover_targets"
  | "configure_auto_attach"
  | "page_enable"
  | "page_file_chooser"
  | "runtime_enable"
  | "network_enable"
  | "performance_enable";

type DirectAttachFailureDetails = {
  origin?: RootAttachDiagnostic["origin"];
  stage?: RootAttachDiagnostic["stage"];
  attachBy?: RootAttachDiagnostic["attachBy"];
  probeMethod?: RootAttachDiagnostic["probeMethod"];
  phase?: "strict_enablement";
  enablementStage?: RootEnablementFailureStage;
  tabId?: number;
  strict?: boolean;
  allowRefresh?: boolean;
  refreshedAfterBlock?: boolean;
  reason?: string;
};

type DirectAttachDecoratedError = Error & {
  directAttachDetails?: DirectAttachFailureDetails;
};

type CommandCreatedTabKind = "targets.new" | "page.open";

export type OpsRuntimeOptions = {
  send: (message: OpsEnvelope) => void;
  cdp: CDPRouter;
  getCanvasPageState?: (targetId: string) => CanvasPageState | null;
  performCanvasPageAction?: (targetId: string, action: CanvasPageElementAction, selector?: string | null) => Promise<unknown>;
};

export class OpsRuntime {
  private readonly sendEnvelope: (message: OpsEnvelope) => void;
  private readonly cdp: CDPRouter;
  private readonly getCanvasPageState?: (targetId: string) => CanvasPageState | null;
  private readonly performCanvasPageAction?: (targetId: string, action: CanvasPageElementAction, selector?: string | null) => Promise<unknown>;
  private readonly tabs = new TabManager();
  private readonly dom = new DomBridge();
  private readonly sessions = new OpsSessionStore();
  private readonly encoder = new TextEncoder();
  private readonly popupOpenerTabIds = new Map<number, number>();
  private readonly popupAttachDiagnostics = new Map<string, PopupAttachDiagnostic>();
  private readonly commandCreatedTabs = new Map<number, { sessionId: string; kind: CommandCreatedTabKind }>();
  private readonly dialogQueues = new Map<string, Promise<void>>();
  private closingTimers = new Map<string, number>();
  private parallelWaiters = new Map<string, OpsParallelWaiter[]>();

  constructor(options: OpsRuntimeOptions) {
    this.sendEnvelope = options.send;
    this.cdp = options.cdp;
    this.getCanvasPageState = options.getCanvasPageState;
    this.performCanvasPageAction = options.performCanvasPageAction;
    chrome.tabs.onCreated.addListener(this.handleTabCreated);
    chrome.tabs.onRemoved.addListener(this.handleTabRemoved);
    chrome.tabs.onUpdated.addListener(this.handleTabUpdated);
    chrome.webNavigation?.onCreatedNavigationTarget?.addListener?.(this.handleCreatedNavigationTarget);
    chrome.debugger.onEvent.addListener(this.handleDebuggerEvent);
    chrome.debugger.onDetach.addListener(this.handleDebuggerDetach);
    if (typeof this.cdp.addEventListener === "function") {
      this.cdp.addEventListener(this.handleCdpRouterEvent);
    }
  }

  async registerCanvasTargetForSession(
    opsSessionId: string,
    targetId: string
  ): Promise<{ targetId: string; url?: string; title?: string; adopted?: boolean } | null> {
    const session = this.sessions.get(opsSessionId);
    if (!session) {
      return null;
    }
    return await this.registerCanvasTarget(session, targetId);
  }

  unregisterCanvasTargetForSession(opsSessionId: string, targetId: string): boolean {
    const session = this.sessions.get(opsSessionId);
    if (!session || targetId === session.targetId) {
      return false;
    }
    return this.sessions.removeTarget(session.id, targetId) !== null;
  }

  handleMessage(message: OpsEnvelope): void {
    if (message.type === "ops_hello") {
      this.handleHello(message);
      return;
    }
    if (message.type === "ops_ping") {
      this.handlePing(message);
      return;
    }
    if (message.type === "ops_event" && message.event === "ops_client_disconnected") {
      this.handleClientDisconnected(message);
      return;
    }
    if (message.type === "ops_request") {
      void this.handleRequest(message).catch((error) => {
        logError("ops.handle_request", error, { code: "ops_request_failed" });
        this.sendError(message, {
          code: "execution_failed",
          message: error instanceof Error ? error.message : "Ops request failed",
          retryable: false
        });
      });
    }
  }

  handleRelayDisconnected(): void {
    this.cdp.markClientClosed();
    for (const session of this.sessions.list()) {
      void this.cleanupSession(session, "ops_session_expired");
    }
  }

  private handleHello(message: OpsHello): void {
    if (message.version !== OPS_PROTOCOL_VERSION) {
      const error: OpsErrorResponse = {
        type: "ops_error",
        requestId: "ops_hello",
        clientId: message.clientId,
        error: {
          code: "not_supported",
          message: "Unsupported ops protocol version.",
          retryable: false,
          details: { supported: [OPS_PROTOCOL_VERSION], received: message.version }
        }
      };
      this.sendEnvelope(error);
      return;
    }
    const ack: OpsHelloAck = {
      type: "ops_hello_ack",
      version: OPS_PROTOCOL_VERSION,
      clientId: message.clientId,
      maxPayloadBytes: MAX_OPS_PAYLOAD_BYTES,
      capabilities: []
    };
    this.sendEnvelope(ack);
  }

  private handlePing(message: OpsPing): void {
    const pong: OpsPong = {
      type: "ops_pong",
      id: message.id,
      clientId: message.clientId
    };
    this.sendEnvelope(pong);
  }

  private handleClientDisconnected(message: OpsEvent): void {
    const clientId = message.clientId;
    if (!clientId) return;
    this.cdp.markClientClosed();
    const sessions = this.sessions.listOwnedBy(clientId);
    for (const session of sessions) {
      if (this.markSessionClosing(session, "ops_session_expired")) {
        this.emitSessionEvent(session, "ops_session_released");
      }
    }
  }

  private handleTabRemoved = (tabId: number): void => {
    this.forgetCommandCreatedTab(tabId);
    this.popupOpenerTabIds.delete(tabId);
    this.handleClosedTarget(tabId, "ops_tab_closed");
  };

  private handleCreatedNavigationTarget = (
    details: chrome.webNavigation.WebNavigationSourceCallbackDetails
  ): void => {
    const tabId = typeof details.tabId === "number" ? details.tabId : null;
    const openerTabId = typeof details.sourceTabId === "number" ? details.sourceTabId : null;
    if (tabId === null || openerTabId === null) {
      return;
    }
    this.popupOpenerTabIds.set(tabId, openerTabId);
  };

  private handleTabCreated = (tab: chrome.tabs.Tab): void => {
    const tabId = typeof tab.id === "number" ? tab.id : null;
    if (tabId === null) {
      return;
    }
    if (this.isCommandCreatedTab(tabId)) {
      return;
    }
    const openerTabId = typeof tab.openerTabId === "number" ? tab.openerTabId : null;
    if (openerTabId !== null) {
      const session = this.sessions.getByTabId(openerTabId);
      if (!session) {
        return;
      }
      this.finishCreatedTab(
        session,
        this.sessions.getTargetIdByTabId(session.id, openerTabId) ?? session.targetId,
        tab,
        tabId
      );
      return;
    }
    void this.handleCreatedTab(tab, tabId);
  };

  private async handleCreatedTab(tab: chrome.tabs.Tab, tabId: number): Promise<void> {
    const opener = await this.resolvePopupOpenerContext(
      tabId,
      typeof tab.openerTabId === "number" ? tab.openerTabId : null
    );
    if (!opener) {
      return;
    }
    this.finishCreatedTab(opener.session, opener.openerTargetId, tab, tabId);
  }

  private finishCreatedTab(
    session: OpsSession,
    openerTargetId: string,
    tab: chrome.tabs.Tab,
    tabId: number
  ): void {
    this.popupOpenerTabIds.delete(tabId);
    const existingTargetId = this.updateKnownTabTarget(session, tab);
    if (existingTargetId) {
      const existingTarget = session.targets.get(existingTargetId) ?? null;
      if (existingTarget && !existingTarget.openerTargetId) {
        existingTarget.openerTargetId = openerTargetId;
      }
      const resolvedTarget = this.resolveTargetContext(session, existingTargetId);
      if (
        resolvedTarget
        && this.shouldPromotePopupTarget(session, openerTargetId, resolvedTarget)
      ) {
        session.activeTargetId = existingTargetId;
      }
      return;
    }
    const target = this.sessions.addTarget(session.id, tabId, {
      url: tab.url ?? undefined,
      title: tab.title ?? undefined,
      openerTargetId: openerTargetId
    });
    void this.attachCreatedTab(session, target.targetId, tabId);
  }

  private async resolvePopupOpenerContext(
    tabId: number,
    openerTabId: number | null
  ): Promise<{ session: OpsSession; openerTargetId: string } | null> {
    let resolvedOpenerTabId = openerTabId ?? this.popupOpenerTabIds.get(tabId) ?? null;
    if (resolvedOpenerTabId === null && typeof this.cdp.resolveTabOpenerTargetId === "function") {
      const openerTargetId = await this.cdp.resolveTabOpenerTargetId(tabId).catch(() => null);
      resolvedOpenerTabId = parseTargetAliasTabId(openerTargetId ?? undefined);
    }
    if (resolvedOpenerTabId === null) {
      return null;
    }
    const session = this.sessions.getByTabId(resolvedOpenerTabId);
    if (!session) {
      return null;
    }
    return {
      session,
      openerTargetId: this.sessions.getTargetIdByTabId(session.id, resolvedOpenerTabId) ?? session.targetId
    };
  }

  private async hydratePopupOpenerTarget(session: OpsSession, targetId: string): Promise<OpsTargetInfo | null> {
    const target = session.targets.get(targetId) ?? null;
    if (!target || target.openerTargetId) {
      return target;
    }
    const opener = await this.resolvePopupOpenerContext(target.tabId, null);
    if (!opener || opener.session.id !== session.id) {
      return target;
    }
    target.openerTargetId = opener.openerTargetId;
    return target;
  }

  private handleTabUpdated = (tabId: number, changeInfo: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab): void => {
    const session = this.sessions.getByTabId(tabId);
    if (!session) {
      if (this.isCommandCreatedTab(tabId)) {
        return;
      }
      if (changeInfo.status === "complete" || tab.status === "complete" || typeof tab.openerTabId === "number") {
        void this.handleCreatedTab(tab, tabId);
      }
      return;
    }
    const targetId = this.updateKnownTabTarget(session, tab);
    if (
      targetId
      && tab.active === true
      && (changeInfo.status === "complete" || tab.status === "complete")
    ) {
      const target = this.resolveTargetContext(session, targetId);
      if (target && (!target.openerTargetId || this.hasUsableDebuggee(target))) {
        session.activeTargetId = targetId;
      }
    }
    if (changeInfo.discarded === true || tab.discarded === true) {
      session.discardedSignals += 1;
    }
    const frozenChange = (changeInfo as { frozen?: boolean }).frozen === true;
    const frozenTab = (tab as { frozen?: boolean }).frozen === true;
    if (frozenChange || frozenTab) {
      session.frozenSignals += 1;
    }
  };

  private handleDebuggerDetach = (source: chrome.debugger.Debuggee): void => {
    if (typeof source.tabId !== "number") return;
    void this.handleDebuggerDetachForTab(source.tabId);
  };

  private updateKnownTabTarget(session: OpsSession, tab: chrome.tabs.Tab): string | null {
    const tabId = typeof tab.id === "number" ? tab.id : null;
    if (tabId === null) {
      return null;
    }
    const targetId = this.sessions.getTargetIdByTabId(session.id, tabId);
    if (!targetId) {
      return null;
    }
    const target = session.targets.get(targetId);
    if (!target) {
      return targetId;
    }
    const nextUrl = getReportedTabUrl(tab);
    const nextTitle = getReportedTabTitle(tab);
    if (typeof nextUrl === "string" && nextUrl.length > 0) {
      target.url = nextUrl;
    }
    if (typeof nextTitle === "string" && nextTitle.length > 0) {
      target.title = nextTitle;
    }
    return targetId;
  }

  private async attachCreatedTab(session: OpsSession, targetId: string, tabId: number): Promise<void> {
    const target = await this.hydratePopupOpenerTarget(session, targetId);
    if (target?.openerTargetId) {
      // Keep the opener root stable and attach popup tabs only when the caller explicitly targets them.
      return;
    }
    await this.tabs.waitForTabComplete(tabId, 5000).catch(() => undefined);
    try {
      await this.attachTargetTab(tabId);
      await this.enableTargetDomains(tabId, true);
      this.promotePopupTarget(session, targetId);
    } catch (error) {
      if (target && isAttachBlockedError(error)) {
        const bridged = await this.attachTargetViaOpenerSession(session, target).catch(() => false);
        if (bridged) {
          this.promotePopupTarget(session, targetId);
          return;
        }
      }
      logError("ops.popup_tab_attach", error, {
        code: "popup_tab_attach_failed",
        extra: { tabId }
      });
    }
  }

  private handleDebuggerEvent = (source: chrome.debugger.Debuggee, method: string, params?: object): void => {
    const eventTabId = this.cdp.resolveSourceTabId(source);
    if (eventTabId === null) return;
    const session = this.sessions.getByTabId(eventTabId);
    if (!session) return;
    if (method === "Runtime.consoleAPICalled") {
      const payload = params as { type?: string; args?: Array<{ value?: unknown; description?: string }> };
      const parts = Array.isArray(payload?.args)
        ? payload.args.map((arg) => {
          if (typeof arg.value === "string") return arg.value;
          if (typeof arg.value === "number" || typeof arg.value === "boolean") return String(arg.value);
          if (typeof arg.description === "string") return arg.description;
          return "";
        })
        : [];
      const text = redactConsoleText(parts.filter(Boolean).join(" "));
      const event: OpsConsoleEvent = {
        seq: ++session.consoleSeq,
        level: payload?.type ?? "log",
        text,
        ts: Date.now()
      };
      session.consoleEvents.push(event);
      if (session.consoleEvents.length > MAX_CONSOLE_EVENTS) {
        session.consoleEvents.shift();
      }
      return;
    }

    if (method === "Page.javascriptDialogOpening") {
      const targetId = this.resolveDebuggerEventTargetId(session, source, eventTabId);
      if (!targetId) {
        return;
      }
      this.applyDialogOpening(session, targetId, params);
      return;
    }

    if (method === "Page.javascriptDialogClosed") {
      const targetId = this.resolveDebuggerEventTargetId(session, source, eventTabId);
      if (targetId) {
        this.applyDialogClosed(session, targetId);
      }
      return;
    }

    if (method === "Page.fileChooserOpened") {
      const targetId = this.resolveDebuggerEventTargetId(session, source, eventTabId);
      if (!targetId) {
        return;
      }
      this.applyFileChooserOpened(session, targetId, params);
      return;
    }

    if (method === "Network.requestWillBeSent") {
      const payload = params as { requestId?: string; request?: { method?: string; url?: string }; type?: string };
      const requestId = payload.requestId;
      if (requestId && payload.request) {
        const methodValue = payload.request.method ?? "GET";
        const urlValue = payload.request.url ?? "";
        session.networkRequests.set(requestId, {
          method: methodValue,
          url: urlValue,
          resourceType: payload.type
        });
        const event: OpsNetworkEvent = {
          seq: ++session.networkSeq,
          method: methodValue,
          url: redactUrl(urlValue),
          resourceType: payload.type,
          ts: Date.now()
        };
        session.networkEvents.push(event);
        if (session.networkEvents.length > MAX_NETWORK_EVENTS) {
          session.networkEvents.shift();
        }
      }
      return;
    }

    if (method === "Network.responseReceived") {
      const payload = params as { requestId?: string; response?: { url?: string; status?: number } };
      const requestId = payload.requestId;
      if (requestId) {
        const pending = session.networkRequests.get(requestId);
        const urlValue = payload.response?.url ?? pending?.url ?? "";
        const methodValue = pending?.method ?? "GET";
        const event: OpsNetworkEvent = {
          seq: ++session.networkSeq,
          method: methodValue,
          url: redactUrl(urlValue),
          status: payload.response?.status,
          resourceType: pending?.resourceType,
          ts: Date.now()
        };
        session.networkEvents.push(event);
        if (session.networkEvents.length > MAX_NETWORK_EVENTS) {
          session.networkEvents.shift();
        }
        session.networkRequests.delete(requestId);
      }
    }
  };

  private handleCdpRouterEvent = (event: CDPRouterEvent): void => {
    const session = this.sessions.getByTabId(event.tabId);
    if (!session) {
      return;
    }
    switch (event.method) {
      case "Page.javascriptDialogOpening": {
        const targetId = this.resolveRouterEventTargetId(session, event);
        if (!targetId) {
          return;
        }
        this.applyDialogOpening(session, targetId, event.params);
        return;
      }
      case "Page.javascriptDialogClosed": {
        const targetId = this.resolveRouterEventTargetId(session, event);
        if (!targetId) {
          return;
        }
        this.applyDialogClosed(session, targetId);
        return;
      }
      case "Page.fileChooserOpened": {
        const targetId = this.resolveRouterEventTargetId(session, event);
        if (!targetId) {
          return;
        }
        this.applyFileChooserOpened(session, targetId, event.params);
        return;
      }
      case "Target.targetCreated":
        this.handleSyntheticTargetCreated(session, event);
        return;
      case "Target.attachedToTarget":
        this.handleSyntheticTargetAttached(session, event);
        return;
      case "Target.targetDestroyed":
        this.handleSyntheticTargetDestroyed(session, event);
        return;
      case "Target.detachedFromTarget":
        this.handleSyntheticTargetDetached(session, event);
        return;
      default:
        return;
    }
  };

  private handleSyntheticTargetCreated(session: OpsSession, event: CDPRouterEvent): void {
    const targetInfo = extractTargetInfo(event.params);
    if (!targetInfo || !isSyntheticPageTarget(session, targetInfo.targetId, targetInfo.type)) {
      return;
    }
    const resolvedTabId = parseTabTargetId(targetInfo.targetId) ?? event.tabId;
    this.sessions.upsertSyntheticTarget(session.id, {
      targetId: targetInfo.targetId,
      tabId: resolvedTabId,
      type: targetInfo.type,
      ...(typeof targetInfo.url === "string" ? { url: targetInfo.url } : {}),
      ...(typeof targetInfo.title === "string" ? { title: targetInfo.title } : {}),
      ...(typeof targetInfo.openerId === "string" ? { openerTargetId: targetInfo.openerId } : {}),
      attachedAt: Date.now()
    });
  }

  private handleSyntheticTargetAttached(session: OpsSession, event: CDPRouterEvent): void {
    const payload = isRecord(event.params) ? event.params : null;
    const targetInfo = extractTargetInfo(payload);
    const childSessionId = payload && typeof payload.sessionId === "string" ? payload.sessionId : undefined;
    if (!targetInfo || !isSyntheticPageTarget(session, targetInfo.targetId, targetInfo.type)) {
      return;
    }
    const resolvedTabId = parseTabTargetId(targetInfo.targetId) ?? event.tabId;
    const synthetic = this.sessions.upsertSyntheticTarget(session.id, {
      targetId: targetInfo.targetId,
      tabId: resolvedTabId,
      type: targetInfo.type,
      ...(typeof targetInfo.url === "string" ? { url: targetInfo.url } : {}),
      ...(typeof targetInfo.title === "string" ? { title: targetInfo.title } : {}),
      ...(childSessionId ? { sessionId: childSessionId } : {}),
      ...(typeof targetInfo.openerId === "string" ? { openerTargetId: targetInfo.openerId } : {}),
      attachedAt: Date.now()
    });
    if (
      !session.activeTargetId
      || session.activeTargetId === session.targetId
      || session.activeTargetId === synthetic.openerTargetId
    ) {
      session.activeTargetId = synthetic.targetId;
    }
  }

  private handleSyntheticTargetDestroyed(session: OpsSession, event: CDPRouterEvent): void {
    const payload = isRecord(event.params) ? event.params : null;
    const targetId = payload && typeof payload.targetId === "string" ? payload.targetId : null;
    if (!targetId) {
      return;
    }
    const removed = this.sessions.removeSyntheticTarget(session.id, targetId);
    if (!removed) {
      return;
    }
    this.restoreSyntheticFallbackTarget(session, removed);
  }

  private handleSyntheticTargetDetached(session: OpsSession, event: CDPRouterEvent): void {
    const payload = isRecord(event.params) ? event.params : null;
    const targetId = payload && typeof payload.targetId === "string" ? payload.targetId : null;
    const sessionId = payload && typeof payload.sessionId === "string" ? payload.sessionId : null;
    const removed = targetId
      ? this.sessions.removeSyntheticTarget(session.id, targetId)
      : (sessionId ? this.sessions.findSyntheticTargetBySessionId(session.id, sessionId) : null);
    if (!removed) {
      return;
    }
    if (!targetId && sessionId) {
      this.sessions.removeSyntheticTarget(session.id, removed.targetId);
    }
    this.restoreSyntheticFallbackTarget(session, removed);
  }

  private restoreSyntheticFallbackTarget(session: OpsSession, removed: OpsSyntheticTargetRecord): void {
    if (session.activeTargetId !== removed.targetId) {
      return;
    }
    if (removed.openerTargetId && this.hasOpsTarget(session, removed.openerTargetId)) {
      session.activeTargetId = removed.openerTargetId;
      return;
    }
    const firstSynthetic = this.sessions.listSyntheticTargets(session.id)[0];
    session.activeTargetId = firstSynthetic?.targetId ?? session.targetId;
  }

  private async handleRequest(message: OpsRequest): Promise<void> {
    const clientId = message.clientId;
    if (!clientId) {
      this.sendError(message, buildError("invalid_request", "Missing clientId", false));
      return;
    }

    switch (message.command) {
      case "session.launch":
      case "session.connect":
        await this.handleSessionLaunch(message, clientId);
        return;
      case "session.disconnect":
        await this.handleSessionDisconnect(message, clientId);
        return;
      case "session.status":
        await this.handleSessionStatus(message, clientId);
        return;
      case "storage.setCookies":
        await this.withSession(message, clientId, (session) => this.handleStorageSetCookies(message, session));
        return;
      case "storage.getCookies":
        await this.withSession(message, clientId, (session) => this.handleStorageGetCookies(message, session));
        return;
      case "targets.list":
        await this.withSession(message, clientId, (session) => this.handleTargetsList(message, session));
        return;
      case "targets.use":
        await this.withSession(message, clientId, (session) => this.handleTargetsUse(message, session));
        return;
      case "targets.registerCanvas":
        await this.withSession(message, clientId, (session) => this.handleTargetsRegisterCanvas(message, session));
        return;
      case "targets.new":
        await this.withSession(message, clientId, (session) => this.handleTargetsNew(message, session));
        return;
      case "targets.close":
        await this.withSession(message, clientId, (session) => this.handleTargetsClose(message, session));
        return;
      case "page.open":
        await this.withSession(message, clientId, (session) => this.handlePageOpen(message, session));
        return;
      case "page.list":
        await this.withSession(message, clientId, (session) => this.handlePageList(message, session));
        return;
      case "page.close":
        await this.withSession(message, clientId, (session) => this.handlePageClose(message, session));
        return;
      case "nav.goto":
        await this.withSession(message, clientId, (session) => this.handleGoto(message, session));
        return;
      case "nav.wait":
        await this.withSession(message, clientId, (session) => this.handleWait(message, session));
        return;
      case "nav.snapshot":
        await this.withSession(message, clientId, (session) => this.handleSnapshot(message, session));
        return;
      case "nav.review":
        await this.withSession(message, clientId, (session) => this.handleReview(message, session));
        return;
      case "interact.click":
        await this.withSession(message, clientId, (session) => this.handleClick(message, session));
        return;
      case "interact.hover":
        await this.withSession(message, clientId, (session) => this.handleHover(message, session));
        return;
      case "interact.press":
        await this.withSession(message, clientId, (session) => this.handlePress(message, session));
        return;
      case "interact.check":
        await this.withSession(message, clientId, (session) => this.handleCheck(message, session, true));
        return;
      case "interact.uncheck":
        await this.withSession(message, clientId, (session) => this.handleCheck(message, session, false));
        return;
      case "interact.type":
        await this.withSession(message, clientId, (session) => this.handleType(message, session));
        return;
      case "interact.select":
        await this.withSession(message, clientId, (session) => this.handleSelect(message, session));
        return;
      case "interact.scroll":
        await this.withSession(message, clientId, (session) => this.handleScroll(message, session));
        return;
      case "interact.scrollIntoView":
        await this.withSession(message, clientId, (session) => this.handleScrollIntoView(message, session));
        return;
      case "interact.upload":
        await this.withSession(message, clientId, (session) => this.handleUpload(message, session));
        return;
      case "pointer.move":
        await this.withSession(message, clientId, (session) => this.handlePointerMove(message, session));
        return;
      case "pointer.down":
        await this.withSession(message, clientId, (session) => this.handlePointerDown(message, session));
        return;
      case "pointer.up":
        await this.withSession(message, clientId, (session) => this.handlePointerUp(message, session));
        return;
      case "pointer.drag":
        await this.withSession(message, clientId, (session) => this.handlePointerDrag(message, session));
        return;
      case "dom.getHtml":
        await this.withSession(message, clientId, (session) => this.handleDomGetHtml(message, session));
        return;
      case "dom.getText":
        await this.withSession(message, clientId, (session) => this.handleDomGetText(message, session));
        return;
      case "dom.getAttr":
        await this.withSession(message, clientId, (session) => this.handleDomGetAttr(message, session));
        return;
      case "dom.getValue":
        await this.withSession(message, clientId, (session) => this.handleDomGetValue(message, session));
        return;
      case "dom.isVisible":
        await this.withSession(message, clientId, (session) => this.handleDomIsVisible(message, session));
        return;
      case "dom.isEnabled":
        await this.withSession(message, clientId, (session) => this.handleDomIsEnabled(message, session));
        return;
      case "dom.isChecked":
        await this.withSession(message, clientId, (session) => this.handleDomIsChecked(message, session));
        return;
      case "dom.refPoint":
        await this.withSession(message, clientId, (session) => this.handleDomRefPoint(message, session));
        return;
      case "canvas.overlay.mount":
        await this.withSession(message, clientId, (session) => this.handleCanvasOverlayMount(message, session));
        return;
      case "canvas.overlay.unmount":
        await this.withSession(message, clientId, (session) => this.handleCanvasOverlayUnmount(message, session));
        return;
      case "canvas.overlay.select":
        await this.withSession(message, clientId, (session) => this.handleCanvasOverlaySelect(message, session));
        return;
      case "canvas.overlay.sync":
        await this.withSession(message, clientId, (session) => this.handleCanvasOverlaySync(message, session));
        return;
      case "canvas.applyRuntimePreviewBridge":
        await this.withSession(message, clientId, (session) => this.handleCanvasRuntimePreviewBridge(message, session));
        return;
      case "export.clonePage":
        await this.withSession(message, clientId, (session) => this.handleClonePage(message, session));
        return;
      case "export.cloneComponent":
        await this.withSession(message, clientId, (session) => this.handleCloneComponent(message, session));
        return;
      case "devtools.perf":
        await this.withSession(message, clientId, (session) => this.handlePerf(message, session));
        return;
      case "page.screenshot":
        await this.withSession(message, clientId, (session) => this.handleScreenshot(message, session));
        return;
      case "page.dialog":
        await this.withSession(message, clientId, (session) => this.handleDialog(message, session));
        return;
      case "devtools.consolePoll":
        await this.withSession(message, clientId, (session) => this.handleConsolePoll(message, session));
        return;
      case "devtools.networkPoll":
        await this.withSession(message, clientId, (session) => this.handleNetworkPoll(message, session));
        return;
      default:
        this.sendError(message, buildError("invalid_request", `Unknown ops command: ${message.command}`, false));
    }
  }

  private async handleSessionLaunch(message: OpsRequest, clientId: string): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const parallelismPolicy = parseParallelismPolicy(payload.parallelismPolicy);
    const startUrl = typeof payload.startUrl === "string" ? payload.startUrl : undefined;
    const isStartUrlConnect = message.command === "session.connect" && typeof startUrl === "string";
    const requestedSessionId = typeof payload.sessionId === "string" && payload.sessionId.trim().length > 0
      ? payload.sessionId.trim()
      : undefined;
    const requestedTabId = typeof payload.tabId === "number" && Number.isInteger(payload.tabId)
      ? payload.tabId
      : undefined;
    if (startUrl) {
      try {
        const restriction = getRestrictionMessage(new URL(startUrl));
        if (restriction) {
          this.sendError(message, buildError("restricted_url", restriction, false));
          return;
        }
      } catch {
        this.sendError(message, buildError("invalid_request", "Invalid startUrl", false));
        return;
      }
    }
    let activeTab = startUrl
      ? await this.tabs.createTab(startUrl, true)
      : typeof requestedTabId === "number"
        ? await this.tabs.getTab(requestedTabId)
        : await this.tabs.getActiveTab();

    if (!startUrl && typeof requestedTabId !== "number") {
      const currentRawUrl = activeTab?.url ?? activeTab?.pendingUrl ?? "";
      const needsFallback = !activeTab
        || typeof activeTab.id !== "number"
        || currentRawUrl.length === 0
        || isRestrictedUrl(currentRawUrl).restricted;
      if (needsFallback) {
        activeTab = await this.tabs.getFirstAttachableTab(typeof activeTab?.id === "number" ? activeTab.id : undefined) ?? activeTab;
      }
    }

    if (!activeTab || typeof activeTab.id !== "number") {
      if (typeof requestedTabId === "number") {
        this.sendError(message, buildError("invalid_request", `Unknown tabId: ${requestedTabId}`, false));
        return;
      }
      this.sendError(message, buildError("ops_unavailable", "No active tab to attach.", true));
      return;
    }
    const activeTabId = activeTab.id;

    let resolvedTab = startUrl
      ? await this.tabs.waitForTabComplete(activeTabId)
        .catch(() => undefined)
        .then(async () => await this.tabs.getTab(activeTabId) ?? activeTab)
      : activeTab;

    if (resolvedTab.url) {
      const restriction = isRestrictedUrl(resolvedTab.url);
      if (restriction.restricted) {
        this.sendError(message, buildError("restricted_url", restriction.message ?? "Restricted tab.", false));
        return;
      }
    }

    try {
      const refreshedTab = isStartUrlConnect
        ? await this.attachStartUrlConnectTab(activeTabId)
        : await this.attachLaunchTargetTab(activeTabId, false);
      if (refreshedTab) {
        resolvedTab = refreshedTab;
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Debugger attach failed";
      this.sendError(message, buildError("cdp_attach_failed", detail, false, this.getDirectAttachErrorDetails(error)));
      return;
    }
    if (!startUrl) {
      await this.tabs.waitForTabComplete(activeTab.id).catch(() => undefined);
    }

    try {
      await this.enableTargetDomains(activeTabId, true);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Debugger attach failed";
      this.sendError(message, buildError("cdp_attach_failed", detail, false, this.getDirectAttachErrorDetails(error)));
      return;
    }

    const leaseId = typeof message.leaseId === "string" && message.leaseId.trim().length > 0
      ? message.leaseId.trim()
      : createId();
    const session = this.sessions.createSession(clientId, activeTabId, leaseId, {
      url: resolvedTab.url ?? undefined,
      title: resolvedTab.title ?? undefined
    }, {
      parallelismPolicy
    }, requestedSessionId);

    this.emitSessionEvent(session, "ops_session_created");

    this.sendResponse(message, {
      opsSessionId: session.id,
      activeTargetId: session.activeTargetId,
      url: resolvedTab.url ?? undefined,
      title: resolvedTab.title ?? undefined,
      leaseId: session.leaseId
    });
  }

  private async handleSessionDisconnect(message: OpsRequest, clientId: string): Promise<void> {
    const session = this.getSessionForMessage(message, clientId);
    if (!session) return;
    this.sendResponse(message, { ok: true });
    this.scheduleSessionCleanup(session.id, "ops_session_closed");
  }

  private async handleSessionStatus(message: OpsRequest, clientId: string): Promise<void> {
    const session = this.getSessionForMessage(message, clientId);
    if (!session) return;
    const activeTargetId = session.activeTargetId ?? session.targetId;
    const reportedTarget = activeTargetId
      ? this.resolveRequestedTargetContext(session, activeTargetId, false)
      : null;
    const reportedTargetId = reportedTarget?.targetId ?? null;
    const tab = reportedTarget ? await this.tabs.getTab(reportedTarget.tabId) : null;
    this.sendResponse(message, {
      mode: "extension",
      activeTargetId: reportedTargetId,
      url: resolveReportedTargetUrl(reportedTarget, tab),
      title: resolveReportedTargetTitle(reportedTarget, tab),
      dialog: this.serializeDialogState(session, reportedTargetId),
      leaseId: session.leaseId,
      state: session.state
    });
  }

  private async handleTargetsList(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const includeUrls = payload.includeUrls === true;
    const targetContexts = [
      ...Array.from(session.targets.values()).map((target) => ({
        targetId: target.targetId,
        tabId: target.tabId
      })),
      ...this.sessions.listSyntheticTargets(session.id)
        .filter((target) => !session.targets.has(target.targetId))
        .map((target) => ({
        targetId: target.targetId,
        tabId: target.tabId
        }))
    ];
    const targets = await Promise.all(targetContexts.map(async ({ targetId, tabId }) => {
      const target = this.resolveTargetContext(session, targetId);
      const tab = await this.tabs.getTab(tabId);
      return {
        targetId,
        type: "page" as const,
        title: resolveReportedTargetTitle(target, tab),
        url: includeUrls ? resolveReportedTargetUrl(target, tab) : undefined
      };
    }));
    this.sendResponse(message, { activeTargetId: session.activeTargetId || null, targets });
  }

  private async handleTargetsUse(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const targetId = typeof payload.targetId === "string" ? payload.targetId : null;
    if (!targetId || !this.hasOpsTarget(session, targetId)) {
      this.sendError(message, buildError("invalid_request", "Unknown targetId", false));
      return;
    }
    let target = this.rehydrateSyntheticPopupBridge(session, targetId) ?? this.resolveTargetContext(session, targetId);
    if (target && !this.hasUsableDebuggee(target) && (target.synthetic || !!target.openerTargetId)) {
      try {
        target = await this.preparePopupTarget(session, targetId) ?? target;
        target = this.rehydrateSyntheticPopupBridge(session, targetId) ?? target;
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Debugger attach failed";
        this.sendError(message, buildError("cdp_attach_failed", detail, false, this.getDirectAttachErrorDetails(error)));
        return;
      }
    }
    if (target?.synthetic && !target.sessionId) {
      const syntheticPopupTarget = target.openerTargetId
        ? {
          targetId,
          tabId: target.tabId,
          ...(typeof target.url === "string" ? { url: target.url } : {}),
          ...(typeof target.title === "string" ? { title: target.title } : {}),
          openerTargetId: target.openerTargetId
        }
        : null;
      if (syntheticPopupTarget && await this.attachTargetViaOpenerSession(session, syntheticPopupTarget).catch(() => false)) {
        this.clearPopupAttachDiagnostic(session.id, targetId);
        await this.activateTargetAndRespond(message, session, targetId);
        return;
      }
      this.sendPopupAttachPendingError(message, session, targetId);
      return;
    }
    if (target && !target.synthetic) {
      const targetHasUsableDebuggee = this.hasUsableDebuggee(target);
      const hydratedPopupTarget = !targetHasUsableDebuggee
        ? await this.hydratePopupOpenerTarget(session, targetId)
        : null;
      const popupTarget: OpsTargetInfo | null = hydratedPopupTarget?.openerTargetId
        ? hydratedPopupTarget
        : target.openerTargetId
          ? {
            targetId,
            tabId: target.tabId,
            ...(typeof target.url === "string" ? { url: target.url } : {}),
            ...(typeof target.title === "string" ? { title: target.title } : {}),
            openerTargetId: target.openerTargetId
          }
          : null;
      if (popupTarget?.openerTargetId) {
        const resolvedPopupTarget = this.resolveTargetContext(session, targetId);
        if (resolvedPopupTarget && this.hasUsableDebuggee(resolvedPopupTarget)) {
          this.clearPopupAttachDiagnostic(session.id, targetId);
          await this.activateTargetAndRespond(message, session, targetId);
          return;
        }
      }
      const deferPopupActivation = Boolean(popupTarget?.openerTargetId && !targetHasUsableDebuggee);
      if (!deferPopupActivation) {
        await this.tabs.activateTab(target.tabId).catch(() => undefined);
      }
      if (!targetHasUsableDebuggee) {
        if (popupTarget?.openerTargetId && await this.attachTargetViaOpenerSession(session, popupTarget).catch(() => false)) {
          this.clearPopupAttachDiagnostic(session.id, targetId);
          await this.activateTargetAndRespond(message, session, targetId);
          return;
        }
        if (popupTarget?.openerTargetId) {
          const resolvedPopupTarget = this.resolveTargetContext(session, targetId);
          if (resolvedPopupTarget && this.hasUsableDebuggee(resolvedPopupTarget)) {
            this.clearPopupAttachDiagnostic(session.id, targetId);
            await this.activateTargetAndRespond(message, session, targetId);
            return;
          }
          if (this.shouldPreferDirectPopupTabAttach(popupTarget)) {
            try {
              await this.attachTargetTab(target.tabId);
              await this.enableTargetDomains(target.tabId, true);
              this.clearPopupAttachDiagnostic(session.id, targetId);
              await this.activateTargetAndRespond(message, session, targetId);
              return;
            } catch (error) {
              if (!isAttachBlockedError(error)) {
                const detail = error instanceof Error ? error.message : "Debugger attach failed";
                this.sendError(message, buildError("cdp_attach_failed", detail, false, this.getDirectAttachErrorDetails(error)));
                return;
              }
            }
          }
          this.sendPopupAttachPendingError(message, session, targetId);
          return;
        }
        try {
          await this.attachTargetTab(target.tabId);
          await this.enableTargetDomains(target.tabId, true);
          this.clearPopupAttachDiagnostic(session.id, targetId);
        } catch (error) {
          if (isAttachBlockedError(error) && popupTarget && await this.attachTargetViaOpenerSession(session, popupTarget).catch(() => false)) {
            session.activeTargetId = targetId;
            this.clearPopupAttachDiagnostic(session.id, targetId);
            await this.tabs.activateTab(target.tabId).catch(() => undefined);
            const tab = await this.tabs.getTab(target.tabId);
            this.sendResponse(message, {
              activeTargetId: targetId,
              url: resolveReportedTargetUrl(this.resolveTargetContext(session, targetId), tab),
              title: resolveReportedTargetTitle(this.resolveTargetContext(session, targetId), tab)
            });
            return;
          }
          const detail = error instanceof Error ? error.message : "Debugger attach failed";
          this.sendError(message, buildError("cdp_attach_failed", detail, false, this.getDirectAttachErrorDetails(error)));
          return;
        }
      }
    }
    await this.activateTargetAndRespond(message, session, targetId);
  }

  private async handleTargetsRegisterCanvas(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const targetId = typeof payload.targetId === "string" ? payload.targetId.trim() : "";
    if (!targetId) {
      this.sendError(message, buildError("invalid_request", "Missing targetId", false));
      return;
    }
    try {
      this.sendResponse(message, await this.registerCanvasTarget(session, targetId));
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Canvas target registration failed";
      if (detail === "Canvas targetId must be tab-<id>.") {
        this.sendError(message, buildError("invalid_request", detail, false));
        return;
      }
      if (detail === "Unknown targetId") {
        this.sendError(message, buildError("invalid_request", detail, false));
        return;
      }
      if (detail === "Only the extension canvas tab can be registered.") {
        this.sendError(message, buildError("restricted_url", detail, false));
        return;
      }
      logError("ops.register_canvas_target", error, {
        code: "canvas_target_attach_failed",
        extra: { targetId }
      });
      this.sendError(message, buildError("execution_failed", detail, false));
      return;
    }
  }

  private async registerCanvasTarget(
    session: OpsSession,
    targetId: string
  ): Promise<{ targetId: string; url?: string; title?: string; adopted?: boolean }> {
    const tabId = parseTabTargetId(targetId);
    if (tabId === null) {
      throw new Error("Canvas targetId must be tab-<id>.");
    }
    let tab = await this.tabs.getTab(tabId);
    if (!tab) {
      throw new Error("Unknown targetId");
    }
    await this.tabs.waitForTabComplete(tabId, 5000).catch(() => undefined);
    tab = await this.tabs.getTab(tabId) ?? tab;
    if (!this.isAllowedCanvasTargetUrl(tab.url)) {
      throw new Error("Only the extension canvas tab can be registered.");
    }
    const existing = session.targets.get(targetId);
    if (existing) {
      existing.url = tab.url ?? existing.url;
      existing.title = tab.title ?? existing.title;
      session.activeTargetId = targetId;
      return {
        targetId,
        url: existing.url,
        title: existing.title,
        adopted: false
      };
    }
    try {
      await this.attachTargetTab(tabId);
      await this.enableTargetDomains(tabId);
    } catch (error) {
      logError("ops.register_canvas_target", error, {
        code: "canvas_target_attach_failed",
        extra: { tabId, targetId }
      });
    }
    const target = this.sessions.addTarget(session.id, tabId, { url: tab.url ?? undefined, title: tab.title ?? undefined });
    session.activeTargetId = target.targetId;
    return {
      targetId: target.targetId,
      url: target.url,
      title: target.title,
      adopted: true
    };
  }

  private async handleTargetsNew(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const url = typeof payload.url === "string" ? payload.url : undefined;
    const tab = await this.tabs.createTab(url, false);
    if (!tab?.id) {
      this.sendError(message, buildError("execution_failed", "Target creation failed", false));
      return;
    }
    this.rememberCommandCreatedTab(session.id, tab.id, "targets.new");
    try {
      const existingTarget = await this.claimCommandCreatedTab(session, tab);
      try {
        if (!this.hasAttachedTabDebuggee(tab.id)) {
          await this.attachCreatedTargetTab(tab.id);
        }
        await this.enableTargetDomains(tab.id, true);
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Debugger attach failed";
        this.sendError(message, buildError("cdp_attach_failed", detail, false, this.getDirectAttachErrorDetails(error)));
        return;
      }
      const target = existingTarget ?? this.sessions.addTarget(session.id, tab.id, await this.getCreatedTabSeed(tab));
      session.activeTargetId = target.targetId;
      await this.activateCreatedTab(tab.id);
      this.sendResponse(message, { targetId: target.targetId });
    } finally {
      this.forgetCommandCreatedTab(tab.id);
    }
  }

  private async handleTargetsClose(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const targetId = typeof payload.targetId === "string" ? payload.targetId : null;
    if (!targetId) {
      this.sendError(message, buildError("invalid_request", "Missing targetId", false));
      return;
    }
    const target = session.targets.get(targetId) ?? null;
    const synthetic = this.sessions.getSyntheticTarget(session.id, targetId);
    if (!target && !synthetic) {
      this.sendError(message, buildError("invalid_request", "Unknown targetId", false));
      return;
    }
    if (synthetic) {
      this.sessions.removeSyntheticTarget(session.id, targetId);
      await this.cdp.sendCommand(synthetic.sessionId ? { tabId: synthetic.tabId, sessionId: synthetic.sessionId } : { tabId: synthetic.tabId }, "Target.closeTarget", {
        targetId: synthetic.targetId
      }).catch(() => undefined);
      this.restoreSyntheticFallbackTarget(session, synthetic);
      this.sendResponse(message, { ok: true });
      return;
    }
    if (!target) {
      this.sendError(message, buildError("invalid_request", "Unknown targetId", false));
      return;
    }
    this.sessions.removeTarget(session.id, targetId);
    void this.closeTabBestEffort(target.tabId);
    if (target.targetId === session.targetId || session.targets.size === 0) {
      this.sendResponse(message, { ok: true });
      this.scheduleSessionCleanup(session.id, "ops_session_closed");
      return;
    }
    this.sendResponse(message, { ok: true });
  }

  private async handlePageOpen(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const name = typeof payload.name === "string" ? payload.name : null;
    if (!name) {
      this.sendError(message, buildError("invalid_request", "Missing name", false));
      return;
    }
    const existingTargetId = this.sessions.getTargetIdByName(session.id, name);
    if (existingTargetId) {
      const target = session.targets.get(existingTargetId) ?? null;
      this.sendResponse(message, { targetId: existingTargetId, created: false, url: target?.url, title: target?.title });
      return;
    }
    const url = typeof payload.url === "string" ? payload.url : undefined;
    const tab = await this.tabs.createTab(url, false);
    if (!tab?.id) {
      this.sendError(message, buildError("execution_failed", "Target creation failed", false));
      return;
    }
    this.rememberCommandCreatedTab(session.id, tab.id, "page.open");
    try {
      const existingTarget = await this.claimCommandCreatedTab(session, tab);
      try {
        if (!this.hasAttachedTabDebuggee(tab.id)) {
          await this.attachCreatedTargetTab(tab.id);
        }
        await this.enableTargetDomains(tab.id, true);
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Debugger attach failed";
        this.sendError(message, buildError("cdp_attach_failed", detail, false, this.getDirectAttachErrorDetails(error)));
        return;
      }
      const target = existingTarget ?? this.sessions.addTarget(session.id, tab.id, await this.getCreatedTabSeed(tab));
      this.sessions.setName(session.id, target.targetId, name);
      session.activeTargetId = target.targetId;
      await this.activateCreatedTab(tab.id);
      this.sendResponse(message, { targetId: target.targetId, created: true, url: target.url, title: target.title });
    } finally {
      this.forgetCommandCreatedTab(tab.id);
    }
  }

  private async handlePageList(message: OpsRequest, session: OpsSession): Promise<void> {
    const pages = await Promise.all(this.sessions.listNamedTargets(session.id).map(async ({ name, targetId }) => {
      const target = this.resolveTargetContext(session, targetId);
      const tab = target ? await this.tabs.getTab(target.tabId) : null;
      return {
        name,
        targetId,
        url: resolveReportedTargetUrl(target, tab),
        title: resolveReportedTargetTitle(target, tab)
      };
    }));
    this.sendResponse(message, { pages });
  }

  private async handlePageClose(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const name = typeof payload.name === "string" ? payload.name : null;
    if (!name) {
      this.sendError(message, buildError("invalid_request", "Missing name", false));
      return;
    }
    const targetId = this.sessions.getTargetIdByName(session.id, name);
    if (!targetId) {
      this.sendError(message, buildError("invalid_request", "Unknown page name", false));
      return;
    }
    const target = session.targets.get(targetId);
    if (target) {
      this.sessions.removeTarget(session.id, targetId);
      void this.closeTabBestEffort(target.tabId);
      if (target.targetId === session.targetId || session.targets.size === 0) {
        this.sendResponse(message, { ok: true });
        this.scheduleSessionCleanup(session.id, "ops_session_closed");
        return;
      }
    }
    this.sendResponse(message, { ok: true });
  }

  private async handleGoto(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const url = typeof payload.url === "string" ? payload.url : null;
    if (!url) {
      this.sendError(message, buildError("invalid_request", "Missing url", false));
      return;
    }
    const syntheticHtml = decodeHtmlDataUrl(url);
    try {
      if (syntheticHtml === null) {
        const restriction = getRestrictionMessage(new URL(url));
        if (restriction) {
          this.sendError(message, buildError("restricted_url", restriction, false));
          return;
        }
      }
    } catch {
      this.sendError(message, buildError("invalid_request", "Invalid url", false));
      return;
    }
    const timeoutMs = typeof payload.timeoutMs === "number" ? payload.timeoutMs : 30000;
    const start = Date.now();
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    await this.tabs.activateTab(target.tabId).catch(() => undefined);
    const targetRecord = session.targets.get(target.targetId);
    if (syntheticHtml !== null) {
      const result = await executeInTab(target.tabId, replaceDocumentWithHtmlScript, [{ html: syntheticHtml }]);
      session.refStore.clearTarget(target.targetId);
      this.sessions.upsertSyntheticTarget(session.id, {
        targetId: target.targetId,
        tabId: target.tabId,
        type: "page",
        url,
        title: typeof result?.title === "string" && result.title.trim().length > 0
          ? result.title
          : targetRecord?.title,
        attachedAt: Date.now()
      });
      this.sendResponse(message, {
        finalUrl: url,
        status: undefined,
        timingMs: Date.now() - start
      });
      return;
    }
    const updated = await new Promise<chrome.tabs.Tab | null>((resolve) => {
      chrome.tabs.update(target.tabId, { url }, (tab) => {
        resolve(tab ?? null);
      });
    });
    await this.tabs.waitForTabComplete(target.tabId, timeoutMs).catch(() => undefined);
    const refreshed = await this.tabs.getTab(target.tabId);
    this.sessions.removeSyntheticTarget(session.id, target.targetId);
    if (targetRecord) {
      session.targets.set(target.targetId, {
        ...targetRecord,
        url: refreshed?.url ?? updated?.url ?? url,
        title: refreshed?.title ?? updated?.title ?? targetRecord.title
      });
    }
    this.sendResponse(message, {
      finalUrl: refreshed?.url ?? updated?.url ?? url,
      status: undefined,
      timingMs: Date.now() - start
    });
  }

  private async handleWait(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const timeoutMs = typeof payload.timeoutMs === "number" ? payload.timeoutMs : 30000;
    const start = Date.now();
    const target = this.requireActiveTarget(session, message);
    if (!target) return;

    if (typeof payload.ref === "string") {
      const state = payload.state === "visible" || payload.state === "hidden" ? payload.state : "attached";
      const resolved = this.resolveRefFromPayload(session, payload.ref, message);
      if (!resolved) return;
      try {
        if (this.isAllowedCanvasTargetUrl(target.url)) {
          await this.waitForSelector(target, resolved.selector, state, timeoutMs);
        } else {
          await this.waitForRefState(resolved, state, timeoutMs);
        }
        this.sendResponse(message, { timingMs: Date.now() - start });
      } catch (error) {
        this.sendError(message, buildError("timeout", error instanceof Error ? error.message : "Timeout", true));
      }
      return;
    }

    try {
      await this.tabs.waitForTabComplete(target.tabId, timeoutMs);
      this.sendResponse(message, { timingMs: Date.now() - start });
    } catch (error) {
      this.sendError(message, buildError("timeout", error instanceof Error ? error.message : "Timeout", true));
    }
  }

  private async handleSnapshot(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const snapshot = await this.captureSnapshotPayload(message, session, {
      mode: payload.mode === "actionables" ? "actionables" : "outline",
      maxChars: typeof payload.maxChars === "number" ? payload.maxChars : 16000,
      cursor: typeof payload.cursor === "string" ? payload.cursor : undefined,
      maxNodes: typeof payload.maxNodes === "number" ? payload.maxNodes : undefined
    });
    if (!snapshot) return;
    this.sendResponse(message, {
      snapshotId: snapshot.snapshotId,
      url: snapshot.url,
      title: snapshot.title,
      content: snapshot.content,
      truncated: snapshot.truncated,
      ...(snapshot.nextCursor ? { nextCursor: snapshot.nextCursor } : {}),
      refCount: snapshot.refCount,
      timingMs: snapshot.timingMs,
      warnings: snapshot.warnings
    });
  }

  private async handleReview(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const snapshot = await this.captureSnapshotPayload(message, session, {
      mode: "actionables",
      maxChars: typeof payload.maxChars === "number" ? payload.maxChars : 16000,
      cursor: typeof payload.cursor === "string" ? payload.cursor : undefined,
      maxNodes: typeof payload.maxNodes === "number" ? payload.maxNodes : undefined
    });
    if (!snapshot) return;
    this.sendResponse(message, {
      sessionId: session.id,
      targetId: snapshot.target.targetId,
      mode: "extension",
      snapshotId: snapshot.snapshotId,
      url: snapshot.url,
      title: snapshot.title,
      content: snapshot.content,
      truncated: snapshot.truncated,
      ...(snapshot.nextCursor ? { nextCursor: snapshot.nextCursor } : {}),
      refCount: snapshot.refCount,
      timingMs: snapshot.timingMs,
      dialog: this.serializeDialogState(session, snapshot.target.targetId),
      ...(snapshot.warnings.length > 0 ? { warnings: snapshot.warnings } : {})
    });
  }

  private async handleClick(message: OpsRequest, session: OpsSession): Promise<void> {
    const resolved = this.resolveRefFromPayload(session, message.payload, message);
    if (!resolved) return;
    const start = Date.now();
    const before = await this.tabs.getTab(resolved.target.tabId);
    await this.tabs.activateTab(resolved.target.tabId).catch(() => undefined);
    if (this.isAllowedCanvasTargetUrl(resolved.target.url)) {
      await this.runElementAction(resolved.target, resolved.selector, { type: "click" }, () => this.dom.click(resolved.target.tabId, resolved.selector));
    } else {
      await this.callFunctionOnRef<void>(resolved, DOM_SCROLL_INTO_VIEW_DECLARATION);
      const point = await this.resolveRefPoint(resolved);
      await this.dispatchMouseEvent(resolved.target.debuggee, "mouseMoved", point.x, point.y);
      await this.dispatchMouseEvent(resolved.target.debuggee, "mousePressed", point.x, point.y, {
        button: "left",
        clickCount: 1
      });
      await this.dispatchMouseEvent(resolved.target.debuggee, "mouseReleased", point.x, point.y, {
        button: "left",
        clickCount: 1
      });
    }
    const after = await this.tabs.getTab(resolved.target.tabId);
    const navigated = Boolean(before?.url && after?.url && before.url !== after.url);
    this.sendResponse(message, { timingMs: Date.now() - start, navigated });
  }

  private async handleHover(message: OpsRequest, session: OpsSession): Promise<void> {
    const resolved = this.resolveRefFromPayload(session, message.payload, message);
    if (!resolved) return;
    const start = Date.now();
    if (this.isAllowedCanvasTargetUrl(resolved.target.url)) {
      await this.runElementAction(resolved.target, resolved.selector, { type: "hover" }, () => this.dom.hover(resolved.target.tabId, resolved.selector));
    } else {
      await this.callFunctionOnRef<void>(resolved, DOM_HOVER_DECLARATION);
    }
    this.sendResponse(message, { timingMs: Date.now() - start });
  }

  private async handlePress(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const key = typeof payload.key === "string" ? payload.key : null;
    if (!key) {
      this.sendError(message, buildError("invalid_request", "Missing key", false));
      return;
    }
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    const resolved = typeof payload.ref === "string" ? this.resolveRefFromPayload(session, payload.ref, message) : null;
    if (payload.ref && !resolved) return;
    const start = Date.now();
    if (resolved && this.isAllowedCanvasTargetUrl(target.url)) {
      await this.runCanvasPageAction(
        target,
        { type: "press", key },
        resolved.selector,
        () => this.dom.press(target.tabId, resolved.selector, key)
      );
    } else if (resolved) {
      await this.callFunctionOnRef<void>(resolved, DOM_FOCUS_DECLARATION);
      await this.dispatchKeyPress(target.debuggee, key);
    } else {
      await this.dispatchKeyPress(target.debuggee, key);
    }
    this.sendResponse(message, { timingMs: Date.now() - start });
  }

  private async handleCheck(message: OpsRequest, session: OpsSession, checked: boolean): Promise<void> {
    const resolved = this.resolveRefFromPayload(session, message.payload, message);
    if (!resolved) return;
    const start = Date.now();
    if (this.isAllowedCanvasTargetUrl(resolved.target.url)) {
      await this.runElementAction(
        resolved.target,
        resolved.selector,
        { type: "setChecked", checked },
        () => this.dom.setChecked(resolved.target.tabId, resolved.selector, checked)
      );
    } else {
      await this.callFunctionOnRef<void>(resolved, DOM_SET_CHECKED_DECLARATION, [checked]);
    }
    this.sendResponse(message, { timingMs: Date.now() - start });
  }

  private async handleType(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const ref = typeof payload.ref === "string" ? payload.ref : null;
    const text = typeof payload.text === "string" ? payload.text : null;
    if (!ref || text === null) {
      this.sendError(message, buildError("invalid_request", "Missing ref or text", false));
      return;
    }
    const resolved = this.resolveRefFromPayload(session, ref, message);
    if (!resolved) return;
    const start = Date.now();
    if (this.isAllowedCanvasTargetUrl(resolved.target.url)) {
      await this.runElementAction(
        resolved.target,
        resolved.selector,
        { type: "type", value: text, clear: payload.clear === true, submit: payload.submit === true },
        () => this.dom.type(resolved.target.tabId, resolved.selector, text, payload.clear === true, payload.submit === true)
      );
    } else {
      await this.callFunctionOnRef<void>(
        resolved,
        DOM_TYPE_DECLARATION,
        [text, payload.clear === true, payload.submit === true]
      );
    }
    this.sendResponse(message, { timingMs: Date.now() - start });
  }

  private async handleSelect(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const ref = typeof payload.ref === "string" ? payload.ref : null;
    const values = Array.isArray(payload.values) ? payload.values.filter((val) => typeof val === "string") : null;
    if (!ref || !values) {
      this.sendError(message, buildError("invalid_request", "Missing ref or values", false));
      return;
    }
    const resolved = this.resolveRefFromPayload(session, ref, message);
    if (!resolved) return;
    if (this.isAllowedCanvasTargetUrl(resolved.target.url)) {
      await this.runElementAction(
        resolved.target,
        resolved.selector,
        { type: "select", values: values as string[] },
        () => this.dom.select(resolved.target.tabId, resolved.selector, values as string[])
      );
    } else {
      await this.callFunctionOnRef<void>(resolved, DOM_SELECT_DECLARATION, [values as string[]]);
    }
    this.sendResponse(message, {});
  }

  private async handleScroll(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const dy = typeof payload.dy === "number" ? payload.dy : 0;
    const ref = typeof payload.ref === "string" ? payload.ref : undefined;
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    const resolved = ref ? this.resolveRefFromPayload(session, ref, message) : null;
    if (ref && !resolved) return;
    if (resolved && !this.isAllowedCanvasTargetUrl(target.url)) {
      await this.callFunctionOnRef<void>(resolved, DOM_SCROLL_BY_DECLARATION, [dy]);
    } else {
      const selector = resolved?.selector;
      await this.runCanvasPageAction(
        target,
        { type: "scroll", dy },
        selector ?? null,
        () => this.dom.scroll(target.tabId, dy, selector)
      );
    }
    this.sendResponse(message, {});
  }

  private async handleScrollIntoView(message: OpsRequest, session: OpsSession): Promise<void> {
    const resolved = this.resolveRefFromPayload(session, message.payload, message);
    if (!resolved) return;
    const start = Date.now();
    if (this.isAllowedCanvasTargetUrl(resolved.target.url)) {
      await this.runElementAction(
        resolved.target,
        resolved.selector,
        { type: "scrollIntoView" },
        () => this.dom.scrollIntoView(resolved.target.tabId, resolved.selector)
      );
    } else {
      await this.callFunctionOnRef<void>(resolved, DOM_SCROLL_INTO_VIEW_DECLARATION);
    }
    this.sendResponse(message, { timingMs: Date.now() - start });
  }

  private async handlePointerMove(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const coords = this.parsePointerCoords(payload);
    if (!coords) {
      this.sendError(message, buildError("invalid_request", "Pointer move requires numeric x and y.", false));
      return;
    }
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    const start = Date.now();
    await this.dispatchMouseEvent(target.debuggee, "mouseMoved", coords.x, coords.y, {
      steps: typeof payload.steps === "number" && Number.isFinite(payload.steps)
        ? Math.max(1, Math.floor(payload.steps))
        : undefined
    });
    this.sendResponse(message, { timingMs: Date.now() - start });
  }

  private async handlePointerDown(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const coords = this.parsePointerCoords(payload);
    if (!coords) {
      this.sendError(message, buildError("invalid_request", "Pointer down requires numeric x and y.", false));
      return;
    }
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    const start = Date.now();
    await this.dispatchMouseEvent(target.debuggee, "mouseMoved", coords.x, coords.y);
    await this.dispatchMouseEvent(target.debuggee, "mousePressed", coords.x, coords.y, {
      button: this.parsePointerButton(payload.button),
      clickCount: typeof payload.clickCount === "number" && Number.isFinite(payload.clickCount)
        ? Math.max(1, Math.floor(payload.clickCount))
        : 1
    });
    this.sendResponse(message, { timingMs: Date.now() - start });
  }

  private async handlePointerUp(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const coords = this.parsePointerCoords(payload);
    if (!coords) {
      this.sendError(message, buildError("invalid_request", "Pointer up requires numeric x and y.", false));
      return;
    }
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    const start = Date.now();
    await this.dispatchMouseEvent(target.debuggee, "mouseMoved", coords.x, coords.y);
    await this.dispatchMouseEvent(target.debuggee, "mouseReleased", coords.x, coords.y, {
      button: this.parsePointerButton(payload.button),
      clickCount: typeof payload.clickCount === "number" && Number.isFinite(payload.clickCount)
        ? Math.max(1, Math.floor(payload.clickCount))
        : 1
    });
    this.sendResponse(message, { timingMs: Date.now() - start });
  }

  private async handlePointerDrag(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const from = isRecord(payload.from) ? this.parsePointerCoords(payload.from) : null;
    const to = isRecord(payload.to) ? this.parsePointerCoords(payload.to) : null;
    if (!from || !to) {
      this.sendError(message, buildError("invalid_request", "Pointer drag requires numeric from/to coordinates.", false));
      return;
    }
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    const start = Date.now();
    const steps = typeof payload.steps === "number" && Number.isFinite(payload.steps)
      ? Math.max(1, Math.floor(payload.steps))
      : 1;
    await this.dispatchMouseEvent(target.debuggee, "mouseMoved", from.x, from.y);
    await this.dispatchMouseEvent(target.debuggee, "mousePressed", from.x, from.y);
    await this.dispatchMouseEvent(target.debuggee, "mouseMoved", to.x, to.y, { steps });
    await this.dispatchMouseEvent(target.debuggee, "mouseReleased", to.x, to.y);
    this.sendResponse(message, { timingMs: Date.now() - start });
  }

  private async handleDomGetHtml(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const ref = typeof payload.ref === "string" ? payload.ref : null;
    const maxChars = typeof payload.maxChars === "number" ? payload.maxChars : 8000;
    if (!ref) {
      this.sendError(message, buildError("invalid_request", "Missing ref", false));
      return;
    }
    const resolved = this.resolveRefFromPayload(session, ref, message);
    if (!resolved) return;
    const html = this.isAllowedCanvasTargetUrl(resolved.target.url)
      ? await this.runElementAction(
        resolved.target,
        resolved.selector,
        { type: "outerHTML" },
        () => this.dom.getOuterHtml(resolved.target.tabId, resolved.selector)
      )
      : await this.callFunctionOnRef<string>(resolved, DOM_OUTER_HTML_DECLARATION);
    const truncated = html.length > maxChars;
    const outerHTML = truncated ? html.slice(0, maxChars) : html;
    this.sendResponse(message, { outerHTML, truncated });
  }

  private async handleDomGetText(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const ref = typeof payload.ref === "string" ? payload.ref : null;
    const maxChars = typeof payload.maxChars === "number" ? payload.maxChars : 8000;
    if (!ref) {
      this.sendError(message, buildError("invalid_request", "Missing ref", false));
      return;
    }
    const resolved = this.resolveRefFromPayload(session, ref, message);
    if (!resolved) return;
    const text = this.isAllowedCanvasTargetUrl(resolved.target.url)
      ? await this.runElementAction(
        resolved.target,
        resolved.selector,
        { type: "innerText" },
        () => this.dom.getInnerText(resolved.target.tabId, resolved.selector)
      )
      : await this.callFunctionOnRef<string>(resolved, DOM_INNER_TEXT_DECLARATION);
    const truncated = text.length > maxChars;
    this.sendResponse(message, { text: truncated ? text.slice(0, maxChars) : text, truncated });
  }

  private async handleDomGetAttr(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const ref = typeof payload.ref === "string" ? payload.ref : null;
    const name = typeof payload.name === "string" ? payload.name : null;
    if (!ref || !name) {
      this.sendError(message, buildError("invalid_request", "Missing ref or name", false));
      return;
    }
    const resolved = this.resolveRefFromPayload(session, ref, message);
    if (!resolved) return;
    const value = this.isAllowedCanvasTargetUrl(resolved.target.url)
      ? await this.runElementAction(
        resolved.target,
        resolved.selector,
        { type: "getAttr", name },
        () => this.dom.getAttr(resolved.target.tabId, resolved.selector, name)
      )
      : await this.callFunctionOnRef<string | null>(resolved, DOM_GET_ATTR_DECLARATION, [name]);
    this.sendResponse(message, { value });
  }

  private async handleDomGetValue(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const ref = typeof payload.ref === "string" ? payload.ref : null;
    if (!ref) {
      this.sendError(message, buildError("invalid_request", "Missing ref", false));
      return;
    }
    const resolved = this.resolveRefFromPayload(session, ref, message);
    if (!resolved) return;
    const value = this.isAllowedCanvasTargetUrl(resolved.target.url)
      ? await this.runElementAction(
        resolved.target,
        resolved.selector,
        { type: "getValue" },
        () => this.dom.getValue(resolved.target.tabId, resolved.selector)
      )
      : await this.callFunctionOnRef<string | null>(resolved, DOM_GET_VALUE_DECLARATION);
    this.sendResponse(message, { value });
  }

  private async handleDomIsVisible(message: OpsRequest, session: OpsSession): Promise<void> {
    const resolved = this.resolveRefFromPayload(session, message.payload, message);
    if (!resolved) return;
    const visible = this.isAllowedCanvasTargetUrl(resolved.target.url)
      ? await this.runElementAction(
        resolved.target,
        resolved.selector,
        { type: "getSelectorState" },
        async () => await this.dom.getSelectorState(resolved.target.tabId, resolved.selector)
      )
      : await this.callFunctionOnRef<boolean>(resolved, DOM_IS_VISIBLE_DECLARATION);
    const isVisible = typeof visible === "object" && visible !== null && "visible" in visible
      ? Boolean((visible as { visible?: unknown }).visible)
      : Boolean(visible);
    this.sendResponse(message, { value: isVisible });
  }

  private async handleDomIsEnabled(message: OpsRequest, session: OpsSession): Promise<void> {
    const resolved = this.resolveRefFromPayload(session, message.payload, message);
    if (!resolved) return;
    const enabled = this.isAllowedCanvasTargetUrl(resolved.target.url)
      ? await this.runElementAction(
        resolved.target,
        resolved.selector,
        { type: "isEnabled" },
        () => this.dom.isEnabled(resolved.target.tabId, resolved.selector)
      )
      : await this.callFunctionOnRef<boolean>(resolved, DOM_IS_ENABLED_DECLARATION);
    this.sendResponse(message, { value: enabled });
  }

  private async handleDomIsChecked(message: OpsRequest, session: OpsSession): Promise<void> {
    const resolved = this.resolveRefFromPayload(session, message.payload, message);
    if (!resolved) return;
    const checked = this.isAllowedCanvasTargetUrl(resolved.target.url)
      ? await this.runElementAction(
        resolved.target,
        resolved.selector,
        { type: "isChecked" },
        () => this.dom.isChecked(resolved.target.tabId, resolved.selector)
      )
      : await this.callFunctionOnRef<boolean>(resolved, DOM_IS_CHECKED_DECLARATION);
    this.sendResponse(message, { value: checked });
  }

  private async handleDomRefPoint(message: OpsRequest, session: OpsSession): Promise<void> {
    const resolved = this.resolveRefFromPayload(session, message.payload, message);
    if (!resolved) return;
    const point = await this.resolveRefPoint(resolved);
    this.sendResponse(message, point);
  }

  private async handleCanvasOverlayMount(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const mountId = typeof payload.mountId === "string" && payload.mountId.trim().length > 0
      ? payload.mountId.trim()
      : `mount_${createId()}`;
    const title = typeof payload.title === "string" && payload.title.trim().length > 0
      ? payload.title.trim()
      : "OpenDevBrowser Canvas";
    const prototypeId = typeof payload.prototypeId === "string" && payload.prototypeId.trim().length > 0
      ? payload.prototypeId.trim()
      : "prototype";
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    const selection = parseCanvasOverlaySelection(payload.selection, target.targetId);
    const result = await this.dom.mountCanvasOverlay(target.tabId, {
      mountId,
      title,
      prototypeId,
      selection
    });
    this.sendResponse(message, {
      mountId,
      targetId: target.targetId,
      previewState: "background",
      overlayState: result.overlayState ?? "mounted",
      capabilities: { selection: true, guides: true }
    });
  }

  private async handleCanvasOverlayUnmount(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const mountId = typeof payload.mountId === "string" ? payload.mountId.trim() : "";
    if (!mountId) {
      this.sendError(message, buildError("invalid_request", "Missing mountId", false));
      return;
    }
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    await this.dom.unmountCanvasOverlay(target.tabId, mountId);
    this.sendResponse(message, {
      ok: true,
      mountId,
      targetId: target.targetId,
      overlayState: "idle"
    });
  }

  private async handleCanvasOverlaySelect(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const mountId = typeof payload.mountId === "string" ? payload.mountId.trim() : "";
    const nodeId = typeof payload.nodeId === "string" && payload.nodeId.trim().length > 0
      ? payload.nodeId.trim()
      : null;
    const selectionHint = isRecord(payload.selectionHint) ? payload.selectionHint : {};
    if (!mountId || (!nodeId && Object.keys(selectionHint).length === 0)) {
      this.sendError(message, buildError("invalid_request", "Missing mountId or selection target", false));
      return;
    }
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    const selection = await this.dom.selectCanvasOverlay(target.tabId, { nodeId, selectionHint });
    this.sendResponse(message, {
      mountId,
      targetId: target.targetId,
      selection
    });
  }

  private async handleCanvasOverlaySync(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const mountId = typeof payload.mountId === "string" ? payload.mountId.trim() : "";
    if (!mountId) {
      this.sendError(message, buildError("invalid_request", "Missing mountId", false));
      return;
    }
    const title = typeof payload.title === "string" && payload.title.trim().length > 0
      ? payload.title.trim()
      : "OpenDevBrowser Canvas";
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    const selection = parseCanvasOverlaySelection(payload.selection, target.targetId);
    const result = await this.dom.syncCanvasOverlay(target.tabId, {
      mountId,
      title,
      selection
    });
    this.sendResponse(message, {
      ok: true,
      mountId,
      targetId: target.targetId,
      overlayState: result.overlayState ?? "mounted"
    });
  }

  private async handleCanvasRuntimePreviewBridge(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const bindingId = typeof payload.bindingId === "string" ? payload.bindingId.trim() : "";
    const rootSelector = typeof payload.rootSelector === "string" ? payload.rootSelector.trim() : "";
    const html = typeof payload.html === "string" ? payload.html : "";
    if (!bindingId || !rootSelector) {
      this.sendError(message, buildError("invalid_request", "Missing bindingId or rootSelector", false));
      return;
    }
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    const result = await this.dom.applyRuntimePreviewBridge(target.tabId, bindingId, rootSelector, html);
    this.sendResponse(message, result);
  }

  private async handleClonePage(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    const canvasCapture = await this.captureCanvasPage(target.tabId, target.targetId);
    if (canvasCapture) {
      this.sendResponse(message, { capture: canvasCapture });
      return;
    }
    const capture = await this.dom.captureDom(target.tabId, "body", {
      sanitize: payload.sanitize !== false,
      maxNodes: typeof payload.maxNodes === "number" ? payload.maxNodes : undefined,
      inlineStyles: payload.inlineStyles !== false,
      styleAllowlist: Array.isArray(payload.styleAllowlist) ? payload.styleAllowlist.filter((item) => typeof item === "string") : [],
      skipStyleValues: Array.isArray(payload.skipStyleValues) ? payload.skipStyleValues.filter((item) => typeof item === "string") : []
    });
    this.sendResponse(message, { capture });
  }

  private async handleCloneComponent(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const ref = typeof payload.ref === "string" ? payload.ref : null;
    if (!ref) {
      this.sendError(message, buildError("invalid_request", "Missing ref", false));
      return;
    }
    const selector = this.resolveSelector(session, ref, message);
    if (!selector) return;
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    const capture = await this.dom.captureDom(target.tabId, selector, {
      sanitize: payload.sanitize !== false,
      maxNodes: typeof payload.maxNodes === "number" ? payload.maxNodes : undefined,
      inlineStyles: payload.inlineStyles !== false,
      styleAllowlist: Array.isArray(payload.styleAllowlist) ? payload.styleAllowlist.filter((item) => typeof item === "string") : [],
      skipStyleValues: Array.isArray(payload.skipStyleValues) ? payload.skipStyleValues.filter((item) => typeof item === "string") : []
    });
    this.sendResponse(message, { capture });
  }

  private async handlePerf(message: OpsRequest, session: OpsSession): Promise<void> {
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    const result = await this.cdp.sendCommand(target.debuggee, "Performance.getMetrics", {}) as { metrics?: Array<{ name: string; value: number }> };
    this.sendResponse(message, { metrics: Array.isArray(result.metrics) ? result.metrics : [] });
  }

  private async handleScreenshot(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    if (payload.fullPage === true && typeof payload.ref === "string") {
      this.sendError(message, buildError("invalid_request", "ref and fullPage cannot be combined.", false));
      return;
    }

    if (typeof payload.ref === "string") {
      const resolved = this.resolveRefFromPayload(session, payload, message);
      if (!resolved) return;
      try {
        await this.callFunctionOnRef<void>(resolved, DOM_SCROLL_INTO_VIEW_DECLARATION);
        const clip = await this.callFunctionOnRef<{
          x?: unknown;
          y?: unknown;
          width?: unknown;
          height?: unknown;
        } | null>(resolved, DOM_SCREENSHOT_CLIP_DECLARATION);
        const result = await withTimeout(
          this.cdp.sendCommand(resolved.target.debuggee, "Page.captureScreenshot", {
            format: "png",
            captureBeyondViewport: true,
            clip: this.normalizeScreenshotClip(clip, resolved.ref)
          }),
          SCREENSHOT_TIMEOUT_MS,
          "Ops screenshot timed out"
        ) as { data?: string };
        if (result?.data) {
          this.sendResponse(message, { base64: result.data });
          return;
        }
      } catch (error) {
        logError("ops.screenshot.ref", error, { code: "screenshot_failed" });
      }
      this.sendError(message, buildError("execution_failed", "Screenshot failed", false));
      return;
    }

    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    if (payload.fullPage === true) {
      try {
        const metrics = await this.cdp.sendCommand(target.debuggee, "Page.getLayoutMetrics", {}) as {
          contentSize?: { width?: number; height?: number };
          cssContentSize?: { width?: number; height?: number };
        };
        const contentSize = isRecord(metrics.cssContentSize) ? metrics.cssContentSize : metrics.contentSize;
        const width = typeof contentSize?.width === "number" && Number.isFinite(contentSize.width)
          ? Math.max(1, Math.ceil(contentSize.width))
          : null;
        const height = typeof contentSize?.height === "number" && Number.isFinite(contentSize.height)
          ? Math.max(1, Math.ceil(contentSize.height))
          : null;
        if (width === null || height === null) {
          throw new Error("Full-page screenshot metrics unavailable");
        }
        const result = await withTimeout(
          this.cdp.sendCommand(target.debuggee, "Page.captureScreenshot", {
            format: "png",
            captureBeyondViewport: true,
            clip: { x: 0, y: 0, width, height, scale: 1 }
          }),
          SCREENSHOT_TIMEOUT_MS,
          "Ops screenshot timed out"
        ) as { data?: string };
        if (result?.data) {
          this.sendResponse(message, { base64: result.data });
          return;
        }
      } catch (error) {
        logError("ops.screenshot.full_page", error, { code: "screenshot_failed" });
      }
      this.sendError(message, buildError("execution_failed", "Screenshot failed", false));
      return;
    }

    try {
      const result = await withTimeout(
        this.cdp.sendCommand(target.debuggee, "Page.captureScreenshot", { format: "png" }),
        SCREENSHOT_TIMEOUT_MS,
        "Ops screenshot timed out"
      ) as { data?: string };
      if (result?.data) {
        this.sendResponse(message, { base64: result.data });
        return;
      }
    } catch (error) {
      logError("ops.screenshot", error, { code: "screenshot_failed" });
    }
    const fallback = await this.captureVisibleTab(target.tabId);
    if (fallback) {
      this.sendResponse(message, { base64: fallback, warning: "visible_only_fallback" });
      return;
    }
    this.sendError(message, buildError("execution_failed", "Screenshot failed", false));
  }

  private async handleUpload(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const files = Array.isArray(payload.files)
      ? payload.files.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    if (files.length === 0) {
      this.sendError(message, buildError("invalid_request", "Missing files", false));
      return;
    }
    const resolved = this.resolveRefFromPayload(session, payload, message);
    if (!resolved) return;
    try {
      const info = await this.callFunctionOnRef<{
        isFileInput?: unknown;
        disabled?: unknown;
      }>(resolved, DOM_FILE_INPUT_INFO_DECLARATION);
      if (info?.disabled === true) {
        this.sendError(message, buildError("execution_failed", `Cannot upload files to disabled ref: ${resolved.ref}`, false));
        return;
      }

      if (info?.isFileInput === true) {
        await this.cdp.sendCommand(resolved.target.debuggee, "DOM.setFileInputFiles", {
          backendNodeId: resolved.backendNodeId,
          files
        });
        this.sendResponse(message, {
          targetId: resolved.target.targetId,
          fileCount: files.length,
          mode: "direct_input"
        });
        return;
      }

      this.sessions.clearFileChooser(session.id, resolved.target.targetId);
      await this.cdp.sendCommand(resolved.target.debuggee, "Page.setInterceptFileChooserDialog", { enabled: true });
      await this.callFunctionOnRef<void>(resolved, DOM_SCROLL_INTO_VIEW_DECLARATION);
      const point = await this.resolveRefPoint(resolved);
      await this.dispatchMouseEvent(resolved.target.debuggee, "mouseMoved", point.x, point.y);
      await this.dispatchMouseEvent(resolved.target.debuggee, "mousePressed", point.x, point.y, {
        button: "left",
        clickCount: 1
      });
      await this.dispatchMouseEvent(resolved.target.debuggee, "mouseReleased", point.x, point.y, {
        button: "left",
        clickCount: 1
      });
      const chooser = await this.waitForFileChooser(session.id, resolved.target.targetId);
      if (typeof chooser.backendNodeId !== "number") {
        throw new Error("File chooser opened without backend node id");
      }
      await this.cdp.sendCommand(resolved.target.debuggee, "DOM.setFileInputFiles", {
        backendNodeId: chooser.backendNodeId,
        files
      });
      this.sessions.clearFileChooser(session.id, resolved.target.targetId);
      this.sendResponse(message, {
        targetId: resolved.target.targetId,
        fileCount: files.length,
        mode: "file_chooser"
      });
    } catch (error) {
      this.sessions.clearFileChooser(session.id, resolved.target.targetId);
      logError("ops.upload", error, { code: "upload_failed" });
      this.sendError(message, buildError("execution_failed", error instanceof Error ? error.message : "Upload failed", false));
    }
  }

  private async handleDialog(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const action = payload.action === "accept" || payload.action === "dismiss" || payload.action === "status"
      ? payload.action
      : "status";
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    const dialog = this.serializeDialogState(session, target.targetId);
    if (!dialog.open || action === "status") {
      this.sendResponse(message, {
        dialog,
        ...(action === "status" ? {} : { handled: false })
      });
      return;
    }
    try {
      await this.cdp.sendCommand(target.debuggee, "Page.handleJavaScriptDialog", {
        accept: action === "accept",
        ...(action === "accept" && typeof payload.promptText === "string" ? { promptText: payload.promptText } : {})
      });
      this.sessions.clearDialog(session.id, target.targetId);
      this.sendResponse(message, {
        dialog: { open: false, targetId: target.targetId },
        handled: true
      });
    } catch (error) {
      logError("ops.dialog", error, { code: "dialog_failed" });
      this.sendError(message, buildError("execution_failed", error instanceof Error ? error.message : "Dialog handling failed", false));
    }
  }

  private async handleConsolePoll(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const sinceSeq = typeof payload.sinceSeq === "number" ? payload.sinceSeq : 0;
    const max = typeof payload.max === "number" ? payload.max : 50;
    const events = session.consoleEvents.filter((event) => event.seq > sinceSeq).slice(0, max);
    const lastEvent = events.at(-1);
    const nextSeq = lastEvent ? lastEvent.seq : sinceSeq;
    this.sendResponse(message, { events, nextSeq });
  }

  private async handleNetworkPoll(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const sinceSeq = typeof payload.sinceSeq === "number" ? payload.sinceSeq : 0;
    const max = typeof payload.max === "number" ? payload.max : 50;
    const events = session.networkEvents.filter((event) => event.seq > sinceSeq).slice(0, max);
    const lastEvent = events.at(-1);
    const nextSeq = lastEvent ? lastEvent.seq : sinceSeq;
    this.sendResponse(message, { events, nextSeq });
  }

  private async handleStorageSetCookies(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const cookies = Array.isArray(payload.cookies) ? payload.cookies : null;
    if (!cookies) {
      this.sendError(message, buildError("invalid_request", "Missing cookies", false));
      return;
    }

    const strict = payload.strict !== false;
    const requestId = typeof payload.requestId === "string" && payload.requestId.trim().length > 0
      ? payload.requestId
      : createId();

    const normalized: CookieImportRecord[] = [];
    const rejected: Array<{ index: number; reason: string }> = [];
    cookies.forEach((entry, index) => {
      if (!isRecord(entry)) {
        rejected.push({ index, reason: "Invalid cookie entry: expected object." });
        return;
      }
      const validation = validateCookieRecord(entry as CookieImportRecord);
      if (!validation.valid) {
        rejected.push({ index, reason: validation.reason });
        return;
      }
      normalized.push(validation.cookie);
    });

    if (strict && rejected.length > 0) {
      this.sendError(message, buildError("invalid_request", `Cookie import rejected ${rejected.length} entries.`, false));
      return;
    }

    if (normalized.length > 0) {
      const target = this.requireActiveTarget(session, message);
      if (!target) return;
      try {
        await this.cdp.sendCommand(
          target.debuggee,
          "Network.setCookies",
          { cookies: normalized }
        );
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Cookie import failed";
        this.sendError(message, buildError("execution_failed", detail, false));
        return;
      }
    }

    this.sendResponse(message, {
      requestId,
      imported: normalized.length,
      rejected
    });
  }

  private async handleStorageGetCookies(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const requestId = typeof payload.requestId === "string" && payload.requestId.trim().length > 0
      ? payload.requestId
      : createId();

    let urls: string[] | undefined;
    try {
      urls = parseCookieFilterUrls(payload.urls);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Invalid cookie url filter.";
      this.sendError(message, buildError("invalid_request", detail, false));
      return;
    }

    const target = this.requireActiveTarget(session, message);
    if (!target) return;

    let rawCookies: unknown[] = [];
    try {
      const response = await this.cdp.sendCommand(
        target.debuggee,
        "Network.getCookies",
        urls ? { urls } : {}
      ) as { cookies?: unknown[] };
      rawCookies = Array.isArray(response.cookies) ? response.cookies : [];
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Cookie list failed";
      this.sendError(message, buildError("execution_failed", detail, false));
      return;
    }

    const cookies = rawCookies
      .map((entry) => toCookieListRecord(entry))
      .filter((entry): entry is CookieListRecord => entry !== null);

    this.sendResponse(message, {
      requestId,
      cookies,
      count: cookies.length
    });
  }

  private async attachTargetTab(tabId: number): Promise<void> {
    try {
      await this.cdp.attach(tabId);
    } catch (error) {
      if (isAttachBlockedError(error)) {
        await delay(50);
        try {
          await this.cdp.attach(tabId);
          return;
        } catch (retryError) {
          error = retryError;
        }
      }
      const diagnostic = this.cdp.getLastRootAttachDiagnostic?.(tabId) ?? null;
      const detail = error instanceof Error ? error.message : "Debugger attach failed";
      logError("ops.direct_attach_stage", error instanceof Error ? error : new Error(detail), {
        code: "direct_attach_stage",
        extra: {
          tabId,
          ...(this.toDirectAttachDiagnosticDetails(diagnostic) ?? {}),
          ...(!diagnostic ? { reason: detail } : {})
        }
      });
      throw this.decorateDirectAttachError(error, diagnostic);
    }
  }

  private async attachCreatedTargetTab(tabId: number): Promise<void> {
    try {
      await this.attachTargetTab(tabId);
      return;
    } catch (error) {
      if (!isAttachBlockedError(error)) {
        throw error;
      }
    }

    await this.tabs.waitForTabComplete(tabId).catch(() => undefined);
    if (this.hasAttachedTabDebuggee(tabId)) {
      return;
    }
    this.cdp.markClientClosed();
    await this.attachTargetTab(tabId);
  }

  private async attachStartUrlConnectTab(tabId: number): Promise<chrome.tabs.Tab | null> {
    return this.attachLaunchTargetTab(tabId, true);
  }

  private async attachLaunchTargetTab(
    tabId: number,
    waitForTabCompleteBeforeRetry: boolean
  ): Promise<chrome.tabs.Tab | null> {
    try {
      await this.attachTargetTab(tabId);
      return null;
    } catch (error) {
      if (!isAttachBlockedError(error)) {
        throw error;
      }
    }

    this.cdp.markClientClosed();
    if (waitForTabCompleteBeforeRetry) {
      await this.tabs.waitForTabComplete(tabId).catch(() => undefined);
    }
    const refreshedTab = waitForTabCompleteBeforeRetry
      ? await this.tabs.getTab(tabId)
      : null;
    try {
      await this.attachTargetTab(tabId);
      return refreshedTab ?? null;
    } catch (error) {
      if (!isAttachBlockedError(error) || typeof this.cdp.refreshTabAttachment !== "function") {
        throw error;
      }
      await this.cdp.refreshTabAttachment(tabId);
      await this.resolveReadyTabDebuggee(tabId, { strict: true, allowRefresh: false });
      return await this.tabs.getTab(tabId) ?? refreshedTab ?? null;
    }
  }

  private async getCreatedTabSeed(tab: chrome.tabs.Tab): Promise<{ url?: string; title?: string }> {
    const refreshedTab = typeof tab.id === "number"
      ? await this.tabs.getTab(tab.id)
      : null;
    return getReportedTabSeed(refreshedTab ?? tab);
  }

  private async claimCommandCreatedTab(session: OpsSession, tab: chrome.tabs.Tab): Promise<OpsTargetInfo | null> {
    const tabId = typeof tab.id === "number" ? tab.id : null;
    if (tabId === null) {
      return null;
    }
    const currentOwner = this.sessions.getByTabId(tabId);
    if (currentOwner && currentOwner.id !== session.id) {
      this.sessions.removeTargetByTabId(currentOwner.id, tabId);
    }
    const existingTargetId = this.sessions.getTargetIdByTabId(session.id, tabId);
    if (!existingTargetId) {
      return null;
    }
    const target = session.targets.get(existingTargetId) ?? null;
    if (!target) {
      return null;
    }
    const seed = await this.getCreatedTabSeed(tab);
    if (typeof seed.url === "string" && seed.url.length > 0) {
      target.url = seed.url;
    }
    if (typeof seed.title === "string" && seed.title.length > 0) {
      target.title = seed.title;
    }
    target.openerTargetId = undefined;
    return target;
  }

  private async activateCreatedTab(tabId: number): Promise<void> {
    await this.tabs.activateTab(tabId).catch(() => undefined);
  }

  private rememberCommandCreatedTab(sessionId: string, tabId: number, kind: CommandCreatedTabKind): void {
    this.commandCreatedTabs.set(tabId, { sessionId, kind });
  }

  private isCommandCreatedTab(tabId: number, sessionId?: string): boolean {
    const entry = this.commandCreatedTabs.get(tabId);
    return sessionId ? entry?.sessionId === sessionId : Boolean(entry);
  }

  private forgetCommandCreatedTab(tabId: number): void {
    this.commandCreatedTabs.delete(tabId);
  }

  private isConcreteDebuggee(
    debuggee: (chrome.debugger.Debuggee & { sessionId?: string; targetId?: string }) | null | undefined
  ): debuggee is chrome.debugger.Debuggee & { sessionId?: string; targetId?: string } {
    return Boolean(
      debuggee
      && (
        (typeof debuggee.sessionId === "string" && debuggee.sessionId.length > 0)
        || (typeof debuggee.targetId === "string" && debuggee.targetId.length > 0)
      )
    );
  }

  private hasAttachedSessionDebuggee(
    debuggee: (chrome.debugger.Debuggee & { sessionId?: string; targetId?: string }) | null | undefined
  ): debuggee is chrome.debugger.Debuggee & { sessionId: string; targetId?: string } {
    return Boolean(debuggee && typeof debuggee.sessionId === "string" && debuggee.sessionId.length > 0);
  }

  private hasAttachedTabDebuggee(tabId: number): boolean {
    if (typeof this.cdp.isTabAttached === "function") {
      return this.cdp.isTabAttached(tabId);
    }
    if (typeof this.cdp.getAttachedTabIds === "function") {
      return this.cdp.getAttachedTabIds().includes(tabId);
    }
    return false;
  }

  private async resolveReadyTabDebuggee(
    tabId: number,
    options: { strict: boolean; allowRefresh: boolean }
  ): Promise<chrome.debugger.Debuggee> {
    const readDebuggee = () => this.cdp.getTabDebuggee?.(tabId);
    let pageDebuggee = readDebuggee();
    if (this.hasAttachedSessionDebuggee(pageDebuggee)) {
      return pageDebuggee;
    }
    if (!options.strict && this.isConcreteDebuggee(pageDebuggee)) {
      return pageDebuggee;
    }

    await this.cdp.primeAttachedRootSession?.(tabId);
    pageDebuggee = readDebuggee();
    if (this.hasAttachedSessionDebuggee(pageDebuggee)) {
      return pageDebuggee;
    }
    if (!options.strict && this.isConcreteDebuggee(pageDebuggee)) {
      return pageDebuggee;
    }

    if (options.allowRefresh && typeof this.cdp.refreshTabAttachment === "function") {
      await this.cdp.refreshTabAttachment(tabId);
      await this.cdp.primeAttachedRootSession?.(tabId);
      pageDebuggee = readDebuggee();
      if (this.hasAttachedSessionDebuggee(pageDebuggee)) {
        return pageDebuggee;
      }
      if (!options.strict && this.isConcreteDebuggee(pageDebuggee)) {
        return pageDebuggee;
      }
    }

    if (this.isConcreteDebuggee(pageDebuggee)) {
      return pageDebuggee;
    }

    if (options.strict) {
      throw new Error(`Concrete debugger session unavailable for tab ${tabId}.`);
    }

    return pageDebuggee ?? { tabId };
  }

  private async enableTargetDomains(tabId: number, strict = false): Promise<void> {
    const buildEnablementFailureDetails = (
      allowRefresh: boolean,
      refreshedAfterBlock: boolean,
      enablementStage: RootEnablementFailureStage
    ): DirectAttachFailureDetails => ({
      phase: "strict_enablement",
      enablementStage,
      tabId,
      strict,
      allowRefresh,
      refreshedAfterBlock
    });
    const enableOnce = async (allowRefresh: boolean, refreshedAfterBlock: boolean): Promise<void> => {
      let pageDebuggee: chrome.debugger.Debuggee;
      try {
        pageDebuggee = await this.resolveReadyTabDebuggee(tabId, {
          strict,
          allowRefresh
        });
      } catch (error) {
        throw this.decorateCdpFailure(
          error,
          buildEnablementFailureDetails(allowRefresh, refreshedAfterBlock, "resolve_ready_debuggee")
        );
      }
      await this.enableRootTracking(buildEnablementFailureDetails(allowRefresh, refreshedAfterBlock, "configure_auto_attach"));
      await this.enableTargetDomainsOnDebuggee(
        pageDebuggee,
        buildEnablementFailureDetails(allowRefresh, refreshedAfterBlock, "page_enable")
      );
      await this.enableTargetDiscovery(
        buildEnablementFailureDetails(allowRefresh, refreshedAfterBlock, "set_discover_targets")
      );
    };

    try {
      try {
        await enableOnce(strict, false);
      } catch (error) {
        if (!strict || !isAttachBlockedError(error) || typeof this.cdp.refreshTabAttachment !== "function") {
          throw error;
        }
        this.cdp.markClientClosed?.();
        await this.cdp.refreshTabAttachment(tabId);
        await enableOnce(false, true);
      }
    } catch (error) {
      logError("ops.enable_domains", error, { code: "enable_domains_failed", extra: { tabId, strict } });
      if (strict) {
        throw error;
      }
    }
  }

  private async enableRootTracking(baseDetails: DirectAttachFailureDetails): Promise<void> {
    try {
      await this.cdp.configureAutoAttach?.({
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true
      });
    } catch (error) {
      throw this.decorateCdpFailure(error, {
        ...baseDetails,
        enablementStage: "configure_auto_attach"
      });
    }
  }

  private async enableTargetDiscovery(baseDetails: DirectAttachFailureDetails): Promise<void> {
    try {
      await this.cdp.setDiscoverTargetsEnabled?.(true);
    } catch (error) {
      if (isAttachBlockedError(error)) {
        return;
      }
      logError("ops.discover_targets", error, {
        code: "discover_targets_enable_failed",
        extra: baseDetails
      });
      if (baseDetails.strict) {
        throw this.decorateCdpFailure(error, {
          ...baseDetails,
          enablementStage: "set_discover_targets"
        });
      }
    }
  }

  private async enableTargetDomainsOnDebuggee(
    debuggee: chrome.debugger.Debuggee,
    baseDetails: DirectAttachFailureDetails
  ): Promise<void> {
    const enableCommands: Array<{
      method: string;
      params: Record<string, unknown>;
      stage: RootEnablementFailureStage;
    }> = [
      { method: "Page.enable", params: {}, stage: "page_enable" },
      { method: "Page.setInterceptFileChooserDialog", params: { enabled: true }, stage: "page_file_chooser" },
      { method: "Runtime.enable", params: {}, stage: "runtime_enable" },
      { method: "Network.enable", params: {}, stage: "network_enable" },
      { method: "Performance.enable", params: {}, stage: "performance_enable" }
    ];
    for (const command of enableCommands) {
      try {
        await this.cdp.sendCommand(debuggee, command.method, command.params);
      } catch (error) {
        throw this.decorateCdpFailure(error, {
          ...baseDetails,
          enablementStage: command.stage
        });
      }
    }
  }

  private parsePointerCoords(payload: Record<string, unknown>): { x: number; y: number } | null {
    const x = typeof payload.x === "number" && Number.isFinite(payload.x) ? payload.x : null;
    const y = typeof payload.y === "number" && Number.isFinite(payload.y) ? payload.y : null;
    return x === null || y === null ? null : { x, y };
  }

  private parsePointerButton(value: unknown): "left" | "middle" | "right" {
    return value === "middle" || value === "right" ? value : "left";
  }

  private async dispatchMouseEvent(
    debuggee: chrome.debugger.Debuggee,
    type: "mouseMoved" | "mousePressed" | "mouseReleased",
    x: number,
    y: number,
    options: {
      button?: "left" | "middle" | "right";
      clickCount?: number;
      steps?: number;
    } = {}
  ): Promise<void> {
    if (type === "mouseMoved" && options.steps && options.steps > 1) {
      const stepCount = Math.max(1, options.steps);
      for (let index = 1; index <= stepCount; index += 1) {
        await this.cdp.sendCommand(
          debuggee,
          "Input.dispatchMouseEvent",
          {
            type,
            x,
            y,
            button: options.button ?? "none",
            clickCount: options.clickCount ?? 0
          }
        );
      }
      return;
    }
    await this.cdp.sendCommand(
      debuggee,
      "Input.dispatchMouseEvent",
      {
        type,
        x,
        y,
        button: options.button ?? (type === "mouseMoved" ? "none" : "left"),
        clickCount: options.clickCount ?? (type === "mouseMoved" ? 0 : 1)
      }
    );
  }

  private async dispatchKeyPress(debuggee: chrome.debugger.Debuggee, key: string): Promise<void> {
    const text = key.length === 1 ? key : undefined;
    await this.cdp.sendCommand(debuggee, "Input.dispatchKeyEvent", {
      type: "keyDown",
      key,
      ...(text ? { text } : {})
    });
    await this.cdp.sendCommand(debuggee, "Input.dispatchKeyEvent", {
      type: "keyUp",
      key
    });
  }

  private async withSession(message: OpsRequest, clientId: string, handler: (session: OpsSession) => Promise<void>): Promise<void> {
    const session = this.getSessionForMessage(message, clientId);
    if (!session) return;
    if (DIALOG_SCOPED_COMMANDS.has(message.command)) {
      await this.withDialogQueue(message, session, handler);
      return;
    }
    if (!TARGET_SCOPED_COMMANDS.has(message.command)) {
      session.queue = session.queue.then(() => handler(session), () => handler(session));
      await session.queue;
      return;
    }
    try {
      await this.withTargetQueue(message, session, handler);
    } catch (error) {
      if (isParallelismBackpressureError(error)) {
        this.sendError(
          message,
          buildError("parallelism_backpressure", error.message, true, error.details)
        );
        return;
      }
      throw error;
    }
  }

  private resolveTargetIdForQueue(session: OpsSession, message: OpsRequest): string {
    const payload = isRecord(message.payload) ? message.payload : {};
    const requested = typeof payload.targetId === "string" ? payload.targetId.trim() : "";
    return requested || session.activeTargetId || session.targetId;
  }

  private dialogQueueKey(sessionId: string, targetId: string): string {
    return `${sessionId}:${targetId}`;
  }

  private sessionQueueAgeMs(session: OpsSession): number {
    let oldest: number | null = null;
    for (const value of session.targetQueueOldestAt.values()) {
      if (oldest === null || value < oldest) {
        oldest = value;
      }
    }
    return oldest === null ? 0 : Math.max(0, Date.now() - oldest);
  }

  private sampleParallelism(session: OpsSession): OpsParallelismGovernorSnapshot {
    const now = Date.now();
    const policy = session.parallelismPolicy;
    if (
      session.parallelismState.lastSampleAt > 0
      && now - session.parallelismState.lastSampleAt < policy.sampleIntervalMs
    ) {
      return {
        state: session.parallelismState,
        pressure: session.parallelismState.lastPressure,
        targetCap: session.parallelismState.effectiveCap,
        waitQueueDepth: session.pendingParallel,
        waitQueueAgeMs: this.sessionQueueAgeMs(session)
      };
    }
    const snapshot = evaluateOpsGovernor(
      policy,
      session.parallelismState,
      {
        hostFreeMemPct: 100,
        rssUsagePct: 0,
        queueAgeMs: this.sessionQueueAgeMs(session),
        queueDepth: session.pendingParallel,
        discardedSignals: session.discardedSignals,
        frozenSignals: session.frozenSignals
      },
      now
    );
    session.parallelismState = snapshot.state;
    session.discardedSignals = 0;
    session.frozenSignals = 0;
    return snapshot;
  }

  private wakeParallelWaiters(session: OpsSession): void {
    const waiters = this.parallelWaiters.get(session.id);
    if (!waiters || waiters.length === 0) {
      return;
    }
    this.sampleParallelism(session);
    while (waiters.length > 0 && session.parallelInFlight < session.parallelismState.effectiveCap) {
      const waiter = waiters.shift();
      if (!waiter) break;
      if (waiter.timer !== null) {
        clearTimeout(waiter.timer);
        waiter.timer = null;
      }
      session.parallelInFlight += 1;
      waiter.resolve();
    }
    if (waiters.length === 0) {
      this.parallelWaiters.delete(session.id);
    }
  }

  private createParallelismBackpressureError(
    session: OpsSession,
    targetId: string,
    timeoutMs: number
  ): Error {
    const snapshot = this.sampleParallelism(session);
    const details = {
      sessionId: session.id,
      targetId,
      effectiveParallelCap: session.parallelismState.effectiveCap,
      inFlight: session.parallelInFlight,
      waitQueueDepth: snapshot.waitQueueDepth,
      waitQueueAgeMs: snapshot.waitQueueAgeMs,
      pressure: snapshot.pressure,
      timeoutMs
    };
    const error = new Error(`Parallelism cap reached for target ${targetId}; retry later.`);
    (error as Error & { code: string; details: Record<string, unknown> }).code = "parallelism_backpressure";
    (error as Error & { code: string; details: Record<string, unknown> }).details = details;
    return error;
  }

  private async acquireParallelSlot(session: OpsSession, targetId: string, timeoutMs: number): Promise<void> {
    const waiters = this.parallelWaiters.get(session.id) ?? [];
    this.parallelWaiters.set(session.id, waiters);
    this.sampleParallelism(session);
    if (session.parallelInFlight < session.parallelismState.effectiveCap && waiters.length === 0) {
      session.parallelInFlight += 1;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const waiter: OpsParallelWaiter = {
        targetId,
        enqueuedAt: Date.now(),
        timeoutMs,
        resolve,
        reject,
        timer: null
      };
      waiter.timer = setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) {
          waiters.splice(index, 1);
        }
        if (waiters.length === 0) {
          this.parallelWaiters.delete(session.id);
        }
        reject(this.createParallelismBackpressureError(session, targetId, timeoutMs));
      }, timeoutMs) as unknown as number;
      waiters.push(waiter);
      this.wakeParallelWaiters(session);
    });
  }

  private releaseParallelSlot(session: OpsSession): void {
    session.parallelInFlight = Math.max(0, session.parallelInFlight - 1);
    this.wakeParallelWaiters(session);
  }

  private async withTargetQueue(
    message: OpsRequest,
    session: OpsSession,
    handler: (session: OpsSession) => Promise<void>
  ): Promise<void> {
    const targetId = this.resolveTargetIdForQueue(session, message);
    const enqueuedAt = Date.now();
    const previous = session.targetQueues.get(targetId) ?? Promise.resolve();
    let releaseQueue: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    const tail = previous.then(() => gate, () => gate);
    session.targetQueues.set(targetId, tail);
    session.pendingParallel += 1;
    session.targetQueueDepth.set(targetId, (session.targetQueueDepth.get(targetId) ?? 0) + 1);
    if (!session.targetQueueOldestAt.has(targetId)) {
      session.targetQueueOldestAt.set(targetId, enqueuedAt);
    }
    await previous;

    let acquired = false;
    try {
      await this.acquireParallelSlot(session, targetId, session.parallelismPolicy.backpressureTimeoutMs);
      acquired = true;
      await handler(session);
    } finally {
      if (acquired) {
        this.releaseParallelSlot(session);
      }
      releaseQueue();
      const depth = (session.targetQueueDepth.get(targetId) ?? 1) - 1;
      if (depth <= 0) {
        session.targetQueueDepth.delete(targetId);
        session.targetQueueOldestAt.delete(targetId);
      } else {
        session.targetQueueDepth.set(targetId, depth);
      }
      session.pendingParallel = Math.max(0, session.pendingParallel - 1);
      if (session.targetQueues.get(targetId) === tail) {
        session.targetQueues.delete(targetId);
      }
    }
  }

  private async withDialogQueue(
    message: OpsRequest,
    session: OpsSession,
    handler: (session: OpsSession) => Promise<void>
  ): Promise<void> {
    const targetId = this.resolveTargetIdForQueue(session, message);
    const queueKey = this.dialogQueueKey(session.id, targetId);
    const previous = this.dialogQueues.get(queueKey) ?? Promise.resolve();
    let releaseQueue: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    const tail = previous.then(() => gate, () => gate);
    this.dialogQueues.set(queueKey, tail);
    await previous;

    try {
      await handler(session);
    } finally {
      releaseQueue();
      if (this.dialogQueues.get(queueKey) === tail) {
        this.dialogQueues.delete(queueKey);
      }
    }
  }

  private getSessionForMessage(message: OpsRequest, clientId: string): OpsSession | null {
    const opsSessionId = message.opsSessionId;
    if (!opsSessionId) {
      this.sendError(message, buildError("invalid_request", "Missing opsSessionId", false));
      return null;
    }
    const session = this.sessions.get(opsSessionId);
    if (!session) {
      this.sendError(message, buildError("invalid_session", "Unknown ops session", false));
      return null;
    }
    const leaseId = typeof message.leaseId === "string" ? message.leaseId : "";
    if (session.ownerClientId !== clientId) {
      if (leaseId && leaseId === session.leaseId) {
        this.reclaimSession(session, clientId);
      } else {
        this.sendError(message, buildError("not_owner", "Client does not own session", false));
        return null;
      }
    } else if (session.state === "closing") {
      if (leaseId && leaseId === session.leaseId) {
        this.reclaimSession(session, clientId);
      } else {
        this.sendError(message, buildError("not_owner", "Client does not own session", false));
        return null;
      }
    }
    if (leaseId !== session.leaseId) {
      this.sendError(message, buildError("not_owner", "Lease does not match session owner", false));
      return null;
    }
    session.lastUsedAt = Date.now();
    return session;
  }

  private requestedTargetId(session: OpsSession, message: OpsRequest): string | null {
    return this.extractPayloadTargetId(message.payload) ?? session.activeTargetId ?? session.targetId;
  }

  private hasOpsTarget(session: OpsSession, targetId: string): boolean {
    return session.targets.has(targetId) || this.sessions.getSyntheticTarget(session.id, targetId) !== null;
  }

  private resolveTargetContext(session: OpsSession, targetId: string): ResolvedOpsTarget | null {
    const target = session.targets.get(targetId) ?? null;
    const explicitSynthetic = this.sessions.getSyntheticTarget(session.id, targetId);
    const bridgeSynthetic = explicitSynthetic ? null : this.findSyntheticSessionBridge(session, target);
    const synthetic = explicitSynthetic ?? bridgeSynthetic;
    if (!target && !synthetic) {
      return null;
    }
    const targetTabId = target?.tabId ?? synthetic?.tabId ?? session.tabId;
    const baseType = synthetic?.type ?? "page";
    return {
      targetId,
      tabId: targetTabId,
      type: baseType,
      synthetic: explicitSynthetic !== null && !session.targets.has(targetId),
      ...(explicitSynthetic?.url ? { url: explicitSynthetic.url } : target?.url ? { url: target.url } : bridgeSynthetic?.url ? { url: bridgeSynthetic.url } : {}),
      ...(explicitSynthetic?.title ? { title: explicitSynthetic.title } : target?.title ? { title: target.title } : bridgeSynthetic?.title ? { title: bridgeSynthetic.title } : {}),
      ...(synthetic?.sessionId ? { sessionId: synthetic.sessionId } : {}),
      ...(explicitSynthetic?.openerTargetId
        ? { openerTargetId: explicitSynthetic.openerTargetId }
        : target?.openerTargetId
          ? { openerTargetId: target.openerTargetId }
          : bridgeSynthetic?.openerTargetId
            ? { openerTargetId: bridgeSynthetic.openerTargetId }
            : {}),
      debuggee: synthetic?.sessionId
        ? { tabId: synthetic.tabId, sessionId: synthetic.sessionId }
        : this.cdp.getTabDebuggee?.(targetTabId) ?? { tabId: targetTabId }
    };
  }

  private resolveDebuggerEventTargetId(
    session: OpsSession,
    source: chrome.debugger.Debuggee,
    resolvedTabId?: number | null
  ): string | null {
    const sourceSessionId = typeof (source as { sessionId?: unknown }).sessionId === "string"
      ? (source as { sessionId: string }).sessionId
      : null;
    if (sourceSessionId) {
      const synthetic = this.sessions.findSyntheticTargetBySessionId(session.id, sourceSessionId);
      if (synthetic) {
        return synthetic.targetId;
      }
    }
    const sourceTargetId = typeof source.targetId === "string" ? source.targetId : null;
    if (sourceTargetId) {
      const synthetic = this.sessions.getSyntheticTarget(session.id, sourceTargetId);
      if (synthetic) {
        return synthetic.targetId;
      }
      if (session.targets.has(sourceTargetId)) {
        return sourceTargetId;
      }
    }
    const tabId = resolvedTabId ?? this.cdp.resolveSourceTabId(source);
    if (tabId !== null) {
      return this.sessions.getTargetIdByTabId(session.id, tabId) ?? session.activeTargetId ?? session.targetId;
    }
    return session.activeTargetId ?? session.targetId;
  }

  private resolveRouterEventTargetId(session: OpsSession, event: CDPRouterEvent): string | null {
    if (typeof event.sessionId === "string") {
      const synthetic = this.sessions.findSyntheticTargetBySessionId(session.id, event.sessionId);
      if (synthetic) {
        return synthetic.targetId;
      }
    }
    return this.sessions.getTargetIdByTabId(session.id, event.tabId) ?? session.activeTargetId ?? session.targetId;
  }

  private applyDialogOpening(session: OpsSession, targetId: string, params?: unknown): void {
    const payload = params as {
      type?: string;
      message?: string;
      defaultPrompt?: string;
      url?: string;
    };
    this.sessions.setDialog(session.id, targetId, {
      open: true,
      targetId,
      ...(typeof payload?.type === "string" ? { type: payload.type as OpsDialogState["type"] } : {}),
      ...(typeof payload?.message === "string" ? { message: payload.message } : {}),
      ...(typeof payload?.defaultPrompt === "string" ? { defaultPrompt: payload.defaultPrompt } : {}),
      ...(typeof payload?.url === "string" ? { url: payload.url } : {}),
      openedAt: new Date().toISOString()
    });
  }

  private applyDialogClosed(session: OpsSession, targetId: string): void {
    this.sessions.clearDialog(session.id, targetId);
  }

  private applyFileChooserOpened(session: OpsSession, targetId: string, params?: unknown): void {
    const payload = params as { backendNodeId?: number };
    this.sessions.setFileChooser(session.id, targetId, {
      open: true,
      targetId,
      ...(typeof payload?.backendNodeId === "number" ? { backendNodeId: payload.backendNodeId } : {}),
      openedAt: new Date().toISOString()
    });
  }

  private serializeDialogState(session: OpsSession, targetId?: string | null): OpsDialogState {
    if (!targetId) {
      return { open: false, targetId: session.activeTargetId ?? session.targetId };
    }
    return this.sessions.getDialog(session.id, targetId) ?? { open: false, targetId };
  }

  private hasUsableDebuggee(target: ResolvedOpsTarget): boolean {
    if (typeof target.sessionId === "string" && target.sessionId.length > 0) {
      if (typeof this.cdp.hasDebuggerSession === "function") {
        return this.cdp.hasDebuggerSession(target.sessionId);
      }
      return true;
    }
    return this.isConcreteDebuggee(this.cdp.getTabDebuggee?.(target.tabId));
  }

  private extractPayloadTargetId(payload: unknown): string | null {
    if (!isRecord(payload)) {
      return null;
    }
    return typeof payload.targetId === "string" && payload.targetId.trim().length > 0
      ? payload.targetId.trim()
      : null;
  }

  private resolveRequestedTargetContext(
    session: OpsSession,
    targetId: string,
    explicitTarget: boolean
  ): ResolvedOpsTarget | null {
    const target = this.resolveTargetContext(session, targetId);
    if (!target) {
      return null;
    }
    if (
      !explicitTarget
      && target.targetId !== session.targetId
      && !this.hasUsableDebuggee(target)
      && (target.synthetic || typeof target.openerTargetId === "string" || typeof target.sessionId === "string")
    ) {
      const fallbackTarget = this.resolveTargetContext(session, session.targetId);
      if (fallbackTarget) {
        session.activeTargetId = fallbackTarget.targetId;
        return fallbackTarget;
      }
    }
    return target;
  }

  private async preparePopupTarget(session: OpsSession, targetId: string): Promise<ResolvedOpsTarget | null> {
    let target = this.resolveTargetContext(session, targetId);
    if (!target || this.hasUsableDebuggee(target)) {
      return target;
    }

    const hydratedPopupTarget = typeof target.sessionId !== "string"
      ? await this.hydratePopupOpenerTarget(session, targetId)
      : null;
    const popupTarget: OpsTargetInfo | null = hydratedPopupTarget?.openerTargetId
      ? hydratedPopupTarget
      : target.openerTargetId
        ? {
          targetId,
          tabId: target.tabId,
          ...(typeof target.url === "string" ? { url: target.url } : {}),
          ...(typeof target.title === "string" ? { title: target.title } : {}),
          openerTargetId: target.openerTargetId
        }
        : null;
    if (!popupTarget?.openerTargetId) {
      return target;
    }

    if (this.shouldPreferDirectPopupTabAttach(popupTarget)) {
      await this.tabs.activateTab(popupTarget.tabId).catch(() => undefined);
      try {
        await this.attachTargetTab(popupTarget.tabId);
        await this.enableTargetDomains(popupTarget.tabId, true);
        this.clearPopupAttachDiagnostic(session.id, targetId);
        target = this.resolveTargetContext(session, targetId) ?? target;
        if (this.hasUsableDebuggee(target)) {
          return target;
        }
      } catch (error) {
        if (!isAttachBlockedError(error)) {
          throw error;
        }
        this.cdp.markClientClosed();
        try {
          await this.attachTargetTab(popupTarget.tabId);
          await this.enableTargetDomains(popupTarget.tabId, true);
          this.clearPopupAttachDiagnostic(session.id, targetId);
          target = this.resolveTargetContext(session, targetId) ?? target;
          if (this.hasUsableDebuggee(target)) {
            return target;
          }
        } catch (resetError) {
          if (!isAttachBlockedError(resetError)) {
            throw resetError;
          }
        }
      }
    }

    if (await this.attachTargetViaOpenerSession(session, popupTarget).catch(() => false)) {
      this.clearPopupAttachDiagnostic(session.id, targetId);
    }
    return this.resolveTargetContext(session, targetId) ?? target;
  }

  private shouldPreferDirectPopupTabAttach(target: Pick<OpsTargetInfo, "tabId" | "openerTargetId">): boolean {
    const openerTabId = parseTargetAliasTabId(target.openerTargetId);
    return openerTabId !== null && openerTabId !== target.tabId;
  }

  private async activateTargetAndRespond(message: OpsRequest, session: OpsSession, targetId: string): Promise<void> {
    session.activeTargetId = targetId;
    const target = this.resolveTargetContext(session, targetId);
    if (target) {
      await this.tabs.activateTab(target.tabId).catch(() => undefined);
    }
    const tab = target ? await this.tabs.getTab(target.tabId) : null;
    this.sendResponse(message, {
      activeTargetId: targetId,
      url: target ? resolveReportedTargetUrl(target, tab) : undefined,
      title: target ? resolveReportedTargetTitle(target, tab) : undefined
    });
  }

  private shouldPromotePopupTarget(
    session: OpsSession,
    openerTargetId: string,
    target: ResolvedOpsTarget
  ): boolean {
    return (
      (!!target.openerTargetId || target.targetId !== session.targetId)
      && this.hasUsableDebuggee(target)
      && (
        !session.activeTargetId
        || session.activeTargetId === session.targetId
        || session.activeTargetId === openerTargetId
      )
    );
  }

  private promotePopupTarget(session: OpsSession, targetId: string): void {
    const target = this.resolveTargetContext(session, targetId);
    if (!target || !target.openerTargetId) {
      return;
    }
    if (this.shouldPromotePopupTarget(session, target.openerTargetId, target)) {
      session.activeTargetId = targetId;
    }
  }

  private rehydrateSyntheticPopupBridge(session: OpsSession, targetId: string): ResolvedOpsTarget | null {
    const target = session.targets.get(targetId) ?? null;
    const bridge = this.findSyntheticSessionBridge(session, target);
    if (
      !bridge
      || typeof bridge.sessionId !== "string"
      || bridge.sessionId.length === 0
      || typeof this.cdp.registerChildSession !== "function"
      || this.cdp.hasDebuggerSession?.(bridge.sessionId) === true
    ) {
      return this.resolveTargetContext(session, targetId);
    }
    this.cdp.registerChildSession(bridge.tabId, {
      targetId: bridge.targetId,
      type: bridge.type,
      ...(typeof bridge.url === "string" ? { url: bridge.url } : {}),
      ...(typeof bridge.title === "string" ? { title: bridge.title } : {}),
      ...(typeof bridge.openerTargetId === "string" && !bridge.openerTargetId.startsWith("tab-")
        ? { openerId: bridge.openerTargetId }
        : {})
    }, bridge.sessionId);
    return this.resolveTargetContext(session, targetId);
  }

  private findSyntheticSessionBridge(
    session: OpsSession,
    target: OpsTargetInfo | null
  ): OpsSyntheticTargetRecord | null {
    if (!target) {
      return null;
    }
    const candidates = this.sessions
      .listSyntheticTargets(session.id)
      .filter((candidate) => typeof candidate.sessionId === "string" && candidate.sessionId.length > 0);
    if (candidates.length === 0) {
      return null;
    }

    const targetUrl = typeof target.url === "string" && target.url.length > 0 ? target.url : null;
    const targetTitle = typeof target.title === "string" && target.title.length > 0 ? target.title : null;
    let matches = targetUrl
      ? candidates.filter((candidate) => candidate.url === targetUrl)
      : [];

    if (matches.length === 0 && targetTitle) {
      matches = candidates.filter((candidate) => candidate.title === targetTitle);
    } else if (matches.length > 1 && targetTitle) {
      const titledMatches = matches.filter((candidate) => candidate.title === targetTitle);
      if (titledMatches.length > 0) {
        matches = titledMatches;
      }
    }

    if (matches.length === 0 && typeof target.openerTargetId === "string" && target.openerTargetId.length > 0) {
      const targetOpenerTabId = parseTargetAliasTabId(target.openerTargetId);
      matches = candidates.filter((candidate) => {
        if (candidate.openerTargetId === target.openerTargetId) {
          return true;
        }
        const candidateOpenerTabId = parseTargetAliasTabId(candidate.openerTargetId);
        return targetOpenerTabId !== null && candidateOpenerTabId === targetOpenerTabId;
      });
    }

    if (matches.length === 0) {
      return null;
    }
    if (matches.length === 1) {
      return matches[0] ?? null;
    }
    return matches.sort((left, right) => right.attachedAt - left.attachedAt)[0] ?? null;
  }

  private async attachTargetViaOpenerSession(session: OpsSession, target: OpsTargetInfo): Promise<boolean> {
    if (typeof target.openerTargetId !== "string" || target.openerTargetId.length === 0) {
      return false;
    }
    const opener = this.resolveTargetContext(session, target.openerTargetId)
      ?? this.resolveTargetContext(session, session.targetId);
    if (!opener) {
      return false;
    }
    const openerBridgeDebuggee: chrome.debugger.Debuggee = { tabId: opener.tabId };

    let targetsLookupFailedReason: string | null = null;
    let targetInfos: Array<NonNullable<ReturnType<typeof extractTargetInfo>>> = [];
    try {
      const rawTargets = await this.cdp.sendCommand(openerBridgeDebuggee, "Target.getTargets", {}, { preserveTab: true });
      targetInfos = isRecord(rawTargets) && Array.isArray(rawTargets.targetInfos)
        ? rawTargets.targetInfos.map((entry) => extractTargetInfo(entry)).filter((entry): entry is NonNullable<typeof entry> => entry !== null)
        : [];
    } catch (error) {
      targetsLookupFailedReason = error instanceof Error ? error.message : String(error);
      targetInfos = [];
    }
    const pageTargets = targetInfos.filter((info) => info.type === "page");
    const targetUrl = typeof target.url === "string" && target.url.length > 0 ? target.url : null;
    const targetTitle = typeof target.title === "string" && target.title.length > 0 ? target.title : null;
    let matcher: PopupAttachMatcher | undefined = targetUrl ? "url" : undefined;
    let matches = targetUrl
      ? pageTargets.filter((info) => info.url === targetUrl)
      : pageTargets;
    if (matches.length === 0 && targetTitle) {
      matches = pageTargets.filter((info) => info.title === targetTitle);
      if (matches.length > 0) {
        matcher = "title";
      }
    } else if (matches.length > 1 && targetTitle) {
      const titledMatches = matches.filter((info) => info.title === targetTitle);
      if (titledMatches.length > 0) {
        matches = titledMatches;
        matcher = "title";
      }
    }

    if (matches.length === 0 && typeof target.openerTargetId === "string" && target.openerTargetId.length > 0) {
      const openerUrl = typeof opener.url === "string" && opener.url.length > 0 ? opener.url : null;
      const openerTitle = typeof opener.title === "string" && opener.title.length > 0 ? opener.title : null;
      const nonOpenerMatches = pageTargets.filter((info) => {
        if (openerUrl && info.url === openerUrl) {
          return false;
        }
        if (openerTitle && info.title === openerTitle) {
          return false;
        }
        return true;
      });
      if (nonOpenerMatches.length === 1) {
        matches = nonOpenerMatches;
        matcher = "non_opener";
      }
    }

    const popupTargetInfo = matches[0] ?? null;
    const resolvedTabTargetId = popupTargetInfo?.targetId
      ? null
      : (typeof this.cdp.resolveTabTargetId === "function"
        ? await this.cdp.resolveTabTargetId(target.tabId)
        : null);
    const popupTargetId = popupTargetInfo?.targetId ?? resolvedTabTargetId;
    if (!popupTargetId) {
      this.recordPopupAttachDiagnostic(session, target, {
        stage: targetsLookupFailedReason ? "targets_lookup_failed" : "resolve_tab_target_failed",
        ...(matcher ? { matcher } : {}),
        ...(targetsLookupFailedReason ? { reason: targetsLookupFailedReason, targetsLookupFailed: true } : {})
      });
      return false;
    }
    if (resolvedTabTargetId) {
      matcher = "resolve_tab_target_id";
    }

    const shouldRefreshAfterResolvedFallback = Boolean(
      resolvedTabTargetId
      && typeof this.cdp.refreshTabAttachment === "function"
      && (
        (targetsLookupFailedReason
          && this.shouldRefreshPopupOpenerAfterLookupFailure(targetsLookupFailedReason))
        || (popupTargetInfo === null && pageTargets.length === 0)
      )
    );

    let refreshDiagnostic: RootRefreshDiagnostic | null = null;
    let refreshReasonOverride: string | null = null;
    if (shouldRefreshAfterResolvedFallback) {
      try {
        await this.cdp.refreshTabAttachment(opener.tabId);
      } catch (error) {
        refreshDiagnostic = this.cdp.getLastRootRefreshDiagnostic?.(opener.tabId) ?? null;
        const refreshReason = error instanceof Error ? error.message : String(error);
        const canProceedWithRetainedRoot = Boolean(
          refreshDiagnostic?.rootSessionPresentAfterRefresh
          && refreshDiagnostic?.rootTargetIdAfterRefresh
          && refreshReason.includes("Not allowed")
        );
        if (canProceedWithRetainedRoot) {
          refreshReasonOverride = refreshReason;
        } else {
          this.recordPopupAttachDiagnostic(session, target, {
            stage: "raw_attach_failed",
            popupTargetId,
            ...(matcher ? { matcher } : {}),
            ...this.toPopupRefreshDiagnostic(refreshDiagnostic),
            ...(targetsLookupFailedReason ? { targetsLookupFailed: true } : {}),
            reason: refreshReason
          });
          return false;
        }
      }
      refreshDiagnostic = this.cdp.getLastRootRefreshDiagnostic?.(opener.tabId) ?? null;
    }

    let sessionId: string | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        sessionId = typeof this.cdp.attachChildTarget === "function"
          ? await this.cdp.attachChildTarget(opener.tabId, popupTargetId)
          : await this.cdp.sendCommand(openerBridgeDebuggee, "Target.attachToTarget", {
            targetId: popupTargetId,
            flatten: true
          }).then((attached) => isRecord(attached) && typeof attached.sessionId === "string" ? attached.sessionId : null);
      } catch (error) {
        const routerDiagnostic = this.cdp.getLastChildAttachDiagnostic(opener.tabId, popupTargetId);
        const stage = routerDiagnostic?.stage ?? "attached_root_attach_failed";
        if (attempt === 0 && this.shouldRetryPopupAttachStage(stage)) {
          await this.waitForPopupAttachRetry();
          continue;
        }
        this.recordPopupAttachDiagnostic(session, target, {
          stage,
          popupTargetId,
          ...(matcher ? { matcher } : {}),
          ...this.toPopupChildAttachDiagnostic(routerDiagnostic),
          ...this.toPopupRefreshDiagnostic(refreshDiagnostic),
          ...(refreshReasonOverride ? { refreshReason: refreshReasonOverride } : {}),
          ...(targetsLookupFailedReason ? { targetsLookupFailed: true } : {}),
          reason: routerDiagnostic?.reason ?? (error instanceof Error ? error.message : String(error))
        });
        return false;
      }
      if (sessionId) {
        break;
      }
      const routerDiagnostic = this.cdp.getLastChildAttachDiagnostic(opener.tabId, popupTargetId);
      const stage = routerDiagnostic?.stage ?? "attached_root_attach_null";
      if (attempt === 0 && this.shouldRetryPopupAttachStage(stage)) {
        await this.waitForPopupAttachRetry();
        continue;
      }
      this.recordPopupAttachDiagnostic(session, target, {
        stage,
        popupTargetId,
        ...(matcher ? { matcher } : {}),
        ...this.toPopupChildAttachDiagnostic(routerDiagnostic),
        ...this.toPopupRefreshDiagnostic(refreshDiagnostic),
        ...(refreshReasonOverride ? { refreshReason: refreshReasonOverride } : {}),
        ...(targetsLookupFailedReason ? { targetsLookupFailed: true } : {}),
        ...(routerDiagnostic?.reason ? { reason: routerDiagnostic.reason } : {})
      });
      return false;
    }

    this.sessions.upsertSyntheticTarget(session.id, {
      targetId: popupTargetId,
      tabId: opener.tabId,
      type: popupTargetInfo?.type ?? "page",
      ...(typeof popupTargetInfo?.url === "string" ? { url: popupTargetInfo.url } : targetUrl ? { url: targetUrl } : {}),
      ...(typeof popupTargetInfo?.title === "string" ? { title: popupTargetInfo.title } : targetTitle ? { title: targetTitle } : {}),
      sessionId: sessionId ?? undefined,
      openerTargetId: target.openerTargetId,
      attachedAt: Date.now()
    });
    if (
      sessionId
      && popupTargetInfo
      && typeof this.cdp.registerChildSession === "function"
    ) {
      this.cdp.registerChildSession(opener.tabId, popupTargetInfo, sessionId);
    }
    this.clearPopupAttachDiagnostic(session.id, target.targetId);
    return true;
  }

  private popupAttachDiagnosticKey(sessionId: string, targetId: string): string {
    return `${sessionId}:${targetId}`;
  }

  private shouldRefreshPopupOpenerAfterLookupFailure(reason: string): boolean {
    return reason.includes("Debugger is not attached")
      || reason.includes("No tab attached")
      || reason.includes("Detached while handling command");
  }

  private shouldRetryPopupAttachStage(stage?: PopupAttachDiagnosticStage): boolean {
    return stage === "raw_attach_failed"
      || stage === "attached_root_unavailable"
      || stage === "attached_root_attach_null"
      || stage === "attached_root_attach_failed";
  }

  private async waitForPopupAttachRetry(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, POPUP_ATTACH_RETRY_DELAY_MS));
  }

  private toPopupChildAttachDiagnostic(
    diagnostic: ChildTargetAttachDiagnostic | null
  ): Partial<Omit<PopupAttachDiagnostic, "targetId" | "tabId" | "openerTargetId" | "at" | "stage">> {
    if (!diagnostic) {
      return {};
    }
    return {
      ...(diagnostic.initialStage ? { initialStage: diagnostic.initialStage } : {}),
      ...(diagnostic.rootTargetRetryStage ? { rootTargetRetryStage: diagnostic.rootTargetRetryStage } : {}),
      ...(diagnostic.attachedRootRecoveryStage
        ? { attachedRootRecoveryStage: diagnostic.attachedRootRecoveryStage }
        : {}),
      ...(diagnostic.attachedRootRecoverySource
        ? { attachedRootRecoverySource: diagnostic.attachedRootRecoverySource }
        : {}),
      ...(diagnostic.attachedRootRecoveryAttachTargetId
        ? { attachedRootRecoveryAttachTargetId: diagnostic.attachedRootRecoveryAttachTargetId }
        : {}),
      ...(typeof diagnostic.attachedRootRecoveryRetriedAfterRegisterRoot === "boolean"
        ? { attachedRootRecoveryRetriedAfterRegisterRoot: diagnostic.attachedRootRecoveryRetriedAfterRegisterRoot }
        : {}),
      ...(typeof diagnostic.attachedRootRecoveryRegisterRootChanged === "boolean"
        ? { attachedRootRecoveryRegisterRootChanged: diagnostic.attachedRootRecoveryRegisterRootChanged }
        : {}),
      ...(typeof diagnostic.attachedRootRecoveryRegisterRootAttachTargetChanged === "boolean"
        ? { attachedRootRecoveryRegisterRootAttachTargetChanged: diagnostic.attachedRootRecoveryRegisterRootAttachTargetChanged }
        : {}),
      ...(typeof diagnostic.attachedRootRecoveryRegisterAttachedRootSessionCalled === "boolean"
        ? {
          attachedRootRecoveryRegisterAttachedRootSessionCalled:
            diagnostic.attachedRootRecoveryRegisterAttachedRootSessionCalled
        }
        : {}),
      ...(diagnostic.attachedRootUnavailableTerminalBranch
        ? { attachedRootUnavailableTerminalBranch: diagnostic.attachedRootUnavailableTerminalBranch }
        : {}),
      ...(diagnostic.reattachRecoveryStage
        ? { reattachRecoveryStage: diagnostic.reattachRecoveryStage }
        : {}),
      ...(diagnostic.reattachRecoveryReason
        ? { reattachRecoveryReason: diagnostic.reattachRecoveryReason }
        : {}),
      ...(diagnostic.attachedRootRecoveryReason
        ? { attachedRootRecoveryReason: diagnostic.attachedRootRecoveryReason }
        : {})
    };
  }

  private formatCdpFailureDiagnosticSuffix(details?: DirectAttachFailureDetails): string {
    if (details?.phase === "strict_enablement" && details.enablementStage) {
      return ` (phase: ${details.phase}; stage: ${details.enablementStage})`;
    }
    if (!details?.stage) {
      return "";
    }
    return ` (origin: ${details.origin}; stage: ${details.stage})`;
  }

  private toDirectAttachDiagnosticDetails(diagnostic: RootAttachDiagnostic | null): DirectAttachFailureDetails | undefined {
    if (!diagnostic) {
      return undefined;
    }
    return {
      origin: diagnostic.origin,
      stage: diagnostic.stage,
      attachBy: diagnostic.attachBy,
      ...(diagnostic.probeMethod ? { probeMethod: diagnostic.probeMethod } : {}),
      ...(diagnostic.reason ? { reason: diagnostic.reason } : {})
    };
  }

  private decorateDirectAttachError(error: unknown, diagnostic: RootAttachDiagnostic | null): Error {
    const detail = this.getCdpFailureMessage(error);
    if (!diagnostic) {
      return error instanceof Error ? error : new Error(detail);
    }
    return this.decorateCdpFailure(error, this.toDirectAttachDiagnosticDetails(diagnostic) ?? {});
  }

  private getCdpFailureMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (error && typeof error === "object" && "message" in error) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string") {
        if ("code" in error) {
          const code = (error as { code?: unknown }).code;
          return typeof code === "number"
            ? JSON.stringify({ code, message })
            : message;
        }
        return message;
      }
    }
    return "Debugger attach failed";
  }

  private decorateCdpFailure(error: unknown, details: DirectAttachFailureDetails): Error {
    const detail = this.getCdpFailureMessage(error);
    const decorated = error instanceof Error ? error as DirectAttachDecoratedError : new Error(detail) as DirectAttachDecoratedError;
    const mergedDetails: DirectAttachFailureDetails = {
      ...(decorated.directAttachDetails ?? {}),
      ...details,
      ...(details.reason ? {} : { reason: detail })
    };
    const suffix = this.formatCdpFailureDiagnosticSuffix(mergedDetails);
    decorated.message = suffix.length > 0 && detail.endsWith(suffix)
      ? detail
      : `${detail}${suffix}`;
    decorated.directAttachDetails = mergedDetails;
    return decorated;
  }

  private getDirectAttachErrorDetails(error: unknown): Record<string, unknown> | undefined {
    if (!(error instanceof Error)) {
      return undefined;
    }
    const decorated = error as DirectAttachDecoratedError;
    return decorated.directAttachDetails;
  }

  private getPopupAttachDiagnostic(sessionId: string, targetId: string): PopupAttachDiagnostic | null {
    return this.popupAttachDiagnostics.get(this.popupAttachDiagnosticKey(sessionId, targetId)) ?? null;
  }

  private clearPopupAttachDiagnostic(sessionId: string, targetId: string): void {
    this.popupAttachDiagnostics.delete(this.popupAttachDiagnosticKey(sessionId, targetId));
  }

  private recordPopupAttachDiagnostic(
    session: OpsSession,
    target: OpsTargetInfo,
    diagnostic: Omit<PopupAttachDiagnostic, "targetId" | "tabId" | "openerTargetId" | "at">
  ): void {
    const entry: PopupAttachDiagnostic = {
      targetId: target.targetId,
      tabId: target.tabId,
      ...(target.openerTargetId ? { openerTargetId: target.openerTargetId } : {}),
      at: Date.now(),
      ...diagnostic
    };
    this.popupAttachDiagnostics.set(this.popupAttachDiagnosticKey(session.id, target.targetId), entry);
    logError("ops.popup_attach_stage", new Error(entry.stage), {
      code: "popup_attach_stage",
      extra: {
        targetId: entry.targetId,
        tabId: entry.tabId,
        ...(entry.openerTargetId ? { openerTargetId: entry.openerTargetId } : {}),
        ...(entry.popupTargetId ? { popupTargetId: entry.popupTargetId } : {}),
        ...(entry.matcher ? { matcher: entry.matcher } : {}),
        ...(entry.initialStage ? { initialStage: entry.initialStage } : {}),
        ...(entry.rootTargetRetryStage ? { rootTargetRetryStage: entry.rootTargetRetryStage } : {}),
        ...(entry.attachedRootRecoveryStage ? { attachedRootRecoveryStage: entry.attachedRootRecoveryStage } : {}),
        ...(entry.attachedRootRecoverySource ? { attachedRootRecoverySource: entry.attachedRootRecoverySource } : {}),
        ...(entry.attachedRootRecoveryAttachTargetId
          ? { attachedRootRecoveryAttachTargetId: entry.attachedRootRecoveryAttachTargetId }
          : {}),
        ...(typeof entry.attachedRootRecoveryRetriedAfterRegisterRoot === "boolean"
          ? { attachedRootRecoveryRetriedAfterRegisterRoot: entry.attachedRootRecoveryRetriedAfterRegisterRoot }
          : {}),
        ...(typeof entry.attachedRootRecoveryRegisterRootChanged === "boolean"
          ? { attachedRootRecoveryRegisterRootChanged: entry.attachedRootRecoveryRegisterRootChanged }
          : {}),
        ...(typeof entry.attachedRootRecoveryRegisterRootAttachTargetChanged === "boolean"
          ? { attachedRootRecoveryRegisterRootAttachTargetChanged: entry.attachedRootRecoveryRegisterRootAttachTargetChanged }
          : {}),
        ...(typeof entry.attachedRootRecoveryRegisterAttachedRootSessionCalled === "boolean"
          ? {
            attachedRootRecoveryRegisterAttachedRootSessionCalled:
              entry.attachedRootRecoveryRegisterAttachedRootSessionCalled
          }
          : {}),
        ...(entry.attachedRootUnavailableTerminalBranch
          ? { attachedRootUnavailableTerminalBranch: entry.attachedRootUnavailableTerminalBranch }
          : {}),
        ...(entry.reattachRecoveryStage ? { reattachRecoveryStage: entry.reattachRecoveryStage } : {}),
        ...(entry.reattachRecoveryReason ? { reattachRecoveryReason: entry.reattachRecoveryReason } : {}),
        ...(entry.attachedRootRecoveryReason ? { attachedRootRecoveryReason: entry.attachedRootRecoveryReason } : {}),
        ...(entry.refreshPath ? { refreshPath: entry.refreshPath } : {}),
        ...(typeof entry.refreshCompleted === "boolean" ? { refreshCompleted: entry.refreshCompleted } : {}),
        ...(typeof entry.refreshDebuggeePresent === "boolean" ? { refreshDebuggeePresent: entry.refreshDebuggeePresent } : {}),
        ...(typeof entry.refreshRootSessionPresent === "boolean"
          ? { refreshRootSessionPresent: entry.refreshRootSessionPresent }
          : {}),
        ...(entry.refreshRootTargetId ? { refreshRootTargetId: entry.refreshRootTargetId } : {}),
        ...(entry.refreshProbeMethod ? { refreshProbeMethod: entry.refreshProbeMethod } : {}),
        ...(entry.refreshProbeStage ? { refreshProbeStage: entry.refreshProbeStage } : {}),
        ...(entry.refreshProbeReason ? { refreshProbeReason: entry.refreshProbeReason } : {}),
        ...(entry.refreshReason ? { refreshReason: entry.refreshReason } : {}),
        ...(entry.targetsLookupFailed ? { targetsLookupFailed: true } : {}),
        ...(entry.reason ? { reason: entry.reason } : {})
      }
    });
  }

  private toPopupRefreshDiagnostic(
    diagnostic: RootRefreshDiagnostic | null
  ): Partial<Omit<PopupAttachDiagnostic, "targetId" | "tabId" | "openerTargetId" | "at" | "stage">> {
    if (!diagnostic) {
      return {};
    }
    return {
      refreshPath: diagnostic.path,
      refreshCompleted: diagnostic.refreshCompleted,
      refreshDebuggeePresent: diagnostic.debuggeePresentAfterRefresh,
      refreshRootSessionPresent: diagnostic.rootSessionPresentAfterRefresh,
      ...(diagnostic.rootTargetIdAfterRefresh ? { refreshRootTargetId: diagnostic.rootTargetIdAfterRefresh } : {}),
      refreshProbeMethod: diagnostic.probeMethod,
      refreshProbeStage: diagnostic.probeStage,
      ...(diagnostic.probeReason ? { refreshProbeReason: diagnostic.probeReason } : {}),
      ...(diagnostic.reason ? { refreshReason: diagnostic.reason } : {})
    };
  }

  private requireActiveTarget(session: OpsSession, message: OpsRequest): ResolvedOpsTarget | null {
    const explicitTargetId = this.extractPayloadTargetId(message.payload);
    const targetId = explicitTargetId ?? session.activeTargetId ?? session.targetId;
    if (!targetId) {
      this.sendError(message, buildError("invalid_request", "No active target", false));
      return null;
    }
    let target = this.resolveRequestedTargetContext(session, targetId, explicitTargetId !== null);
    if (
      !target
      && explicitTargetId !== null
      && this.shouldRecoverExplicitCanvasOverlayTarget(message.command, targetId)
    ) {
      target = this.recoverExplicitCanvasOverlayTarget(session, targetId);
    }
    if (!target) {
      this.sendError(message, buildError("invalid_request", "Active target missing", false));
      return null;
    }
    if (target.url) {
      const restriction = isRestrictedUrl(target.url);
      if (restriction.restricted && !this.isAllowedCanvasRestrictionTarget(session, targetId, target)) {
        this.sendError(message, buildError("restricted_url", restriction.message ?? "Restricted tab.", false));
        return null;
      }
    }
    if (target.synthetic && !target.sessionId && !this.isSyntheticRootPreviewTarget(session, targetId, target)) {
      this.sendPopupAttachPendingError(message, session, targetId);
      return null;
    }
    if (target.openerTargetId && !this.hasUsableDebuggee(target)) {
      this.sendPopupAttachPendingError(message, session, targetId);
      return null;
    }
    return target;
  }

  private shouldRecoverExplicitCanvasOverlayTarget(command: string, targetId: string): boolean {
    return command.startsWith("canvas.overlay.") && parseTabTargetId(targetId) !== null;
  }

  private recoverExplicitCanvasOverlayTarget(session: OpsSession, targetId: string): ResolvedOpsTarget | null {
    const tabId = parseTabTargetId(targetId);
    if (tabId === null) {
      return null;
    }
    const recoveredTarget = session.targets.get(targetId) ?? this.sessions.addTarget(session.id, tabId);
    session.activeTargetId = recoveredTarget.targetId;
    return this.resolveRequestedTargetContext(session, recoveredTarget.targetId, true);
  }

  private isAllowedCanvasRestrictionTarget(
    session: OpsSession,
    targetId: string,
    target: ResolvedOpsTarget
  ): boolean {
    if (this.isAllowedCanvasTargetUrl(target.url)) {
      return true;
    }
    if (isHtmlDataUrl(target.url ?? "") && this.isRegisteredCanvasTarget(session, targetId)) {
      return true;
    }
    return this.isSyntheticRootPreviewTarget(session, targetId, target)
      && isHtmlDataUrl(target.url ?? "");
  }

  private isRegisteredCanvasTarget(session: OpsSession, targetId: string): boolean {
    return this.isAllowedCanvasTargetUrl(session.targets.get(targetId)?.url);
  }

  private isSyntheticRootPreviewTarget(
    session: OpsSession,
    _targetId: string,
    target: ResolvedOpsTarget
  ): boolean {
    const rootSynthetic = this.sessions.getSyntheticTarget(session.id, session.targetId);
    const effectiveUrl = target.url ?? rootSynthetic?.url;
    return isHtmlDataUrl(rootSynthetic?.url ?? "")
      && isHtmlDataUrl(effectiveUrl ?? "")
      && !rootSynthetic?.openerTargetId
      && rootSynthetic?.tabId === session.tabId
      && !target.openerTargetId
      && target.tabId === session.tabId;
  }

  private isAllowedCanvasTargetUrl(rawUrl: string | undefined): boolean {
    if (typeof rawUrl !== "string" || rawUrl.length === 0) {
      return false;
    }
    try {
      const allowedUrl = chrome.runtime.getURL("canvas.html");
      return rawUrl === allowedUrl || rawUrl.startsWith(`${allowedUrl}#`) || rawUrl.startsWith(`${allowedUrl}?`);
    } catch {
      return false;
    }
  }

  private async captureCanvasPage(tabId: number, targetId: string): Promise<DomCapture | null> {
    if (!this.getCanvasPageState) {
      return null;
    }
    const state = this.getCanvasPageState(targetId);
    if (!state) {
      return null;
    }
    const previewHtml = typeof state.html === "string" && state.html.length > 0
      ? extractBodyHtml(state.html)
      : null;
    const shouldProbeLiveStage = Boolean(state.pendingMutation)
      || (canvasStateContainsRichMedia(state) && !htmlContainsRichMedia(previewHtml));
    if (shouldProbeLiveStage) {
      const liveStageCapture = await this.captureLiveCanvasStage(tabId);
      if (liveStageCapture) {
        return liveStageCapture;
      }
      const documentCapture = buildCanvasDocumentCapture(state);
      if (documentCapture) {
        return documentCapture;
      }
    }
    if (!previewHtml) {
      return buildCanvasDocumentCapture(state);
    }
    return {
      html: previewHtml,
      styles: {},
      warnings: ["canvas_state_capture"],
      inlineStyles: false
    };
  }

  private async runElementAction<T>(
    target: { tabId: number; targetId: string; url?: string },
    selector: string,
    action: CanvasPageElementAction,
    fallback: () => Promise<T>
  ): Promise<T> {
    return await this.runCanvasPageAction(target, action, selector, fallback);
  }

  private async runCanvasPageAction<T>(
    target: { tabId: number; targetId: string; url?: string },
    action: CanvasPageElementAction,
    selector: string | null | undefined,
    fallback: () => Promise<T>
  ): Promise<T> {
    if (!this.isAllowedCanvasTargetUrl(target.url) || !this.performCanvasPageAction) {
      return await fallback();
    }
    return await this.performCanvasPageAction(target.targetId, action, selector ?? null) as T;
  }

  private async captureLiveCanvasStage(tabId: number): Promise<DomCapture | null> {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const stage = document.getElementById("canvas-stage-inner");
          if (!(stage instanceof HTMLElement)) {
            return null;
          }
          const html = stage.innerHTML.trim();
          if (!html) {
            return null;
          }
          const width = stage.style.width || `${Math.max(stage.scrollWidth, 320)}px`;
          const height = stage.style.height || `${Math.max(stage.scrollHeight, 240)}px`;
          return `<body><main data-surface="canvas" style="position:relative;width:${width};min-height:${height};">${html}</main></body>`;
        }
      });
      const html = typeof results[0]?.result === "string" ? results[0].result : null;
      if (!html) {
        return null;
      }
      return {
        html,
        styles: {},
        warnings: ["canvas_state_capture"],
        inlineStyles: true
      };
    } catch {
      return null;
    }
  }

  private resolveRefContext(session: OpsSession, ref: string, targetId: string): ResolvedOpsRef | null {
    const target = this.resolveTargetContext(session, targetId);
    if (!target) {
      return null;
    }
    const entry = session.refStore.resolve(targetId, ref);
    if (!entry) {
      return null;
    }
    const snapshotId = session.refStore.getSnapshotId(targetId);
    if (!snapshotId || entry.snapshotId !== snapshotId) {
      return null;
    }
    return {
      target,
      ref,
      selector: entry.selector,
      backendNodeId: entry.backendNodeId,
      snapshotId: entry.snapshotId,
      ...(entry.frameId ? { frameId: entry.frameId } : {}),
      ...(entry.role ? { role: entry.role } : {}),
      ...(entry.name ? { name: entry.name } : {})
    };
  }

  private async captureSnapshotPayload(
    message: OpsRequest,
    session: OpsSession,
    options: {
      mode: SnapshotMode;
      maxChars: number;
      cursor?: string;
      maxNodes?: number;
    }
  ): Promise<{
    target: ResolvedOpsTarget;
    snapshotId: string;
    url: string | undefined;
    title: string | undefined;
    content: string;
    truncated: boolean;
    nextCursor?: string;
    refCount: number;
    timingMs: number;
    warnings: string[];
  } | null> {
    const explicitTargetId = this.extractPayloadTargetId(message.payload);
    if (explicitTargetId) {
      try {
        await this.preparePopupTarget(session, explicitTargetId);
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Debugger attach failed";
        this.sendError(message, buildError("cdp_attach_failed", detail, false, this.getDirectAttachErrorDetails(error)));
        return null;
      }
    }
    const target = this.requireActiveTarget(session, message);
    if (!target) return null;

    const start = Date.now();
    const entriesData = await buildSnapshot(
      (method, params) => this.cdp.sendCommand(target.debuggee, method, params as Record<string, unknown>),
      options.mode,
      () => session.refStore.nextRef(target.targetId),
      options.mode !== "actionables",
      options.maxNodes
    );
    const snapshot = session.refStore.setSnapshot(target.targetId, entriesData.entries);
    const startIndex = parseCursor(options.cursor);
    const { content, truncated, nextCursor } = paginate(entriesData.lines, startIndex, options.maxChars);
    const contentBytes = this.encoder.encode(content).length;
    if (contentBytes > MAX_SNAPSHOT_BYTES) {
      this.sendError(message, buildError("snapshot_too_large", "Snapshot exceeded max size.", false, {
        maxSnapshotBytes: MAX_SNAPSHOT_BYTES,
        actualBytes: contentBytes
      }));
      return null;
    }

    const tab = await this.tabs.getTab(target.tabId);
    return {
      target,
      snapshotId: snapshot.snapshotId,
      url: resolveReportedTargetUrl(target, tab),
      title: resolveReportedTargetTitle(target, tab),
      content,
      truncated,
      ...(nextCursor ? { nextCursor } : {}),
      refCount: snapshot.count,
      timingMs: Date.now() - start,
      warnings: entriesData.warnings
    };
  }

  private resolveRefFromPayload(session: OpsSession, refOrPayload: unknown, message: OpsRequest): ResolvedOpsRef | null {
    const ref = typeof refOrPayload === "string"
      ? refOrPayload
      : (isRecord(refOrPayload) && typeof refOrPayload.ref === "string" ? refOrPayload.ref : null);
    if (!ref) {
      this.sendError(message, buildError("invalid_request", "Missing ref", false));
      return null;
    }
    const targetId = this.requestedTargetId(session, message);
    if (!targetId) {
      this.sendError(message, buildError("invalid_request", "No active target", false));
      return null;
    }
    const resolved = this.resolveRefContext(session, ref, targetId);
    if (!resolved) {
      this.sendError(message, buildError("invalid_request", `Unknown ref: ${ref}. Take a new snapshot first.`, false));
      return null;
    }
    if (resolved.target.synthetic && !resolved.target.sessionId) {
      this.sendPopupAttachPendingError(message, session, resolved.target.targetId);
      return null;
    }
    return resolved;
  }

  private formatPopupAttachDiagnosticSuffix(diagnostic: PopupAttachDiagnostic | null): string {
    if (!diagnostic?.stage) {
      return "";
    }
    const parts = [`stage: ${diagnostic.stage}`];
    if (diagnostic.rootTargetRetryStage) {
      parts.push(`root-target-retry: ${diagnostic.rootTargetRetryStage}`);
    }
    if (diagnostic.attachedRootRecoveryStage) {
      const attachedRootPart = diagnostic.attachedRootRecoverySource
        ? `${diagnostic.attachedRootRecoveryStage} via ${diagnostic.attachedRootRecoverySource}`
        : diagnostic.attachedRootRecoveryStage;
      parts.push(`attached-root: ${attachedRootPart}`);
    }
    if (diagnostic.attachedRootUnavailableTerminalBranch) {
      parts.push(`terminal: ${diagnostic.attachedRootUnavailableTerminalBranch}`);
    }
    return ` (${parts.join("; ")})`;
  }

  private sendPopupAttachPendingError(message: OpsRequest, session?: OpsSession, targetId?: string | null): void {
    const diagnostic = session && typeof targetId === "string"
      ? this.getPopupAttachDiagnostic(session.id, targetId)
      : null;
    const stageSuffix = this.formatPopupAttachDiagnosticSuffix(diagnostic);
    this.sendError(message, buildError(
      "execution_failed",
      `Popup target has not finished attaching yet${stageSuffix}. Take a new review or snapshot and retry.`,
      true,
      diagnostic
        ? {
          stage: diagnostic.stage,
          ...(diagnostic.popupTargetId ? { popupTargetId: diagnostic.popupTargetId } : {}),
          ...(diagnostic.matcher ? { matcher: diagnostic.matcher } : {}),
          ...(diagnostic.initialStage ? { initialStage: diagnostic.initialStage } : {}),
          ...(diagnostic.rootTargetRetryStage ? { rootTargetRetryStage: diagnostic.rootTargetRetryStage } : {}),
          ...(diagnostic.attachedRootRecoveryStage
            ? { attachedRootRecoveryStage: diagnostic.attachedRootRecoveryStage }
            : {}),
          ...(diagnostic.attachedRootRecoverySource
            ? { attachedRootRecoverySource: diagnostic.attachedRootRecoverySource }
            : {}),
          ...(diagnostic.attachedRootRecoveryAttachTargetId
            ? { attachedRootRecoveryAttachTargetId: diagnostic.attachedRootRecoveryAttachTargetId }
            : {}),
          ...(typeof diagnostic.attachedRootRecoveryRetriedAfterRegisterRoot === "boolean"
            ? { attachedRootRecoveryRetriedAfterRegisterRoot: diagnostic.attachedRootRecoveryRetriedAfterRegisterRoot }
            : {}),
          ...(typeof diagnostic.attachedRootRecoveryRegisterRootChanged === "boolean"
            ? { attachedRootRecoveryRegisterRootChanged: diagnostic.attachedRootRecoveryRegisterRootChanged }
            : {}),
          ...(typeof diagnostic.attachedRootRecoveryRegisterRootAttachTargetChanged === "boolean"
            ? {
              attachedRootRecoveryRegisterRootAttachTargetChanged:
                diagnostic.attachedRootRecoveryRegisterRootAttachTargetChanged
            }
            : {}),
          ...(typeof diagnostic.attachedRootRecoveryRegisterAttachedRootSessionCalled === "boolean"
            ? {
              attachedRootRecoveryRegisterAttachedRootSessionCalled:
                diagnostic.attachedRootRecoveryRegisterAttachedRootSessionCalled
            }
            : {}),
          ...(diagnostic.attachedRootUnavailableTerminalBranch
            ? { attachedRootUnavailableTerminalBranch: diagnostic.attachedRootUnavailableTerminalBranch }
            : {}),
          ...(diagnostic.reattachRecoveryStage
            ? { reattachRecoveryStage: diagnostic.reattachRecoveryStage }
            : {}),
          ...(diagnostic.reattachRecoveryReason
            ? { reattachRecoveryReason: diagnostic.reattachRecoveryReason }
            : {}),
          ...(diagnostic.attachedRootRecoveryReason
            ? { attachedRootRecoveryReason: diagnostic.attachedRootRecoveryReason }
            : {}),
          ...(diagnostic.refreshPath ? { refreshPath: diagnostic.refreshPath } : {}),
          ...(typeof diagnostic.refreshCompleted === "boolean" ? { refreshCompleted: diagnostic.refreshCompleted } : {}),
          ...(typeof diagnostic.refreshDebuggeePresent === "boolean"
            ? { refreshDebuggeePresent: diagnostic.refreshDebuggeePresent }
            : {}),
          ...(typeof diagnostic.refreshRootSessionPresent === "boolean"
            ? { refreshRootSessionPresent: diagnostic.refreshRootSessionPresent }
            : {}),
          ...(diagnostic.refreshRootTargetId ? { refreshRootTargetId: diagnostic.refreshRootTargetId } : {}),
          ...(diagnostic.refreshProbeMethod ? { refreshProbeMethod: diagnostic.refreshProbeMethod } : {}),
          ...(diagnostic.refreshProbeStage ? { refreshProbeStage: diagnostic.refreshProbeStage } : {}),
          ...(diagnostic.refreshProbeReason ? { refreshProbeReason: diagnostic.refreshProbeReason } : {}),
          ...(diagnostic.refreshReason ? { refreshReason: diagnostic.refreshReason } : {}),
          ...(diagnostic.targetsLookupFailed ? { targetsLookupFailed: true } : {}),
          ...(diagnostic.reason ? { reason: diagnostic.reason } : {})
        }
        : undefined
    ));
  }

  private resolveSelector(session: OpsSession, refOrPayload: unknown, message: OpsRequest): string | null {
    return this.resolveRefFromPayload(session, refOrPayload, message)?.selector ?? null;
  }

  private async callFunctionOnRef<T>(
    resolved: ResolvedOpsRef,
    functionDeclaration: string,
    args: unknown[] = [],
    ref: string = resolved.ref
  ): Promise<T> {
    try {
      const resolvedNode = await this.cdp.sendCommand(resolved.target.debuggee, "DOM.resolveNode", {
        backendNodeId: resolved.backendNodeId
      }) as { object?: { objectId?: string } };
      const objectId = resolvedNode.object?.objectId;
      if (!objectId) {
        throw buildStaleSnapshotError(ref);
      }
      const result = await this.cdp.sendCommand(resolved.target.debuggee, "Runtime.callFunctionOn", {
        objectId,
        functionDeclaration,
        arguments: args.map((value) => ({ value })),
        returnByValue: true
      }) as { result?: { value?: unknown }; exceptionDetails?: { text?: string } };
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text ?? "Runtime.callFunctionOn failed");
      }
      return result.result?.value as T;
    } catch (error) {
      if (isSnapshotStaleMessage(error)) {
        throw buildStaleSnapshotError(ref);
      }
      throw error;
    }
  }

  private async resolveRefPoint(resolved: ResolvedOpsRef): Promise<{ x: number; y: number }> {
    try {
      const box = await this.cdp.sendCommand(resolved.target.debuggee, "DOM.getBoxModel", {
        backendNodeId: resolved.backendNodeId
      }) as { model?: { content?: number[] } };
      const quad = Array.isArray(box.model?.content) ? box.model?.content : [];
      if (quad.length >= 8) {
        const xs = [quad[0], quad[2], quad[4], quad[6]].filter((value): value is number => typeof value === "number");
        const ys = [quad[1], quad[3], quad[5], quad[7]].filter((value): value is number => typeof value === "number");
        if (xs.length === 4 && ys.length === 4) {
          return {
            x: Math.round((Math.min(...xs) + Math.max(...xs)) / 2),
            y: Math.round((Math.min(...ys) + Math.max(...ys)) / 2)
          };
        }
      }
    } catch (error) {
      if (isSnapshotStaleMessage(error)) {
        throw buildStaleSnapshotError(resolved.ref);
      }
    }
    const point = await this.callFunctionOnRef<{ x?: unknown; y?: unknown }>(resolved, DOM_REF_POINT_DECLARATION);
    const x = typeof point?.x === "number" && Number.isFinite(point.x) ? Math.round(point.x) : null;
    const y = typeof point?.y === "number" && Number.isFinite(point.y) ? Math.round(point.y) : null;
    if (x === null || y === null) {
      throw new Error(`Could not resolve a clickable point for ref: ${resolved.ref}`);
    }
    return { x, y };
  }

  private normalizeScreenshotClip(
    value: { x?: unknown; y?: unknown; width?: unknown; height?: unknown } | null,
    ref: string
  ): { x: number; y: number; width: number; height: number; scale: number } {
    const x = typeof value?.x === "number" && Number.isFinite(value.x) ? value.x : null;
    const y = typeof value?.y === "number" && Number.isFinite(value.y) ? value.y : null;
    const width = typeof value?.width === "number" && Number.isFinite(value.width) ? value.width : null;
    const height = typeof value?.height === "number" && Number.isFinite(value.height) ? value.height : null;
    if (x === null || y === null || width === null || height === null || width <= 0 || height <= 0) {
      throw new Error(`Could not resolve screenshot bounds for ref: ${ref}`);
    }
    return { x, y, width, height, scale: 1 };
  }

  private async waitForFileChooser(
    sessionId: string,
    targetId: string,
    timeoutMs = SCREENSHOT_TIMEOUT_MS
  ): Promise<OpsFileChooserState> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const chooser = this.sessions.getFileChooser(sessionId, targetId);
      if (chooser?.open) {
        return chooser;
      }
      await delay(50);
    }
    throw new Error("File chooser did not open");
  }

  private async waitForSelector(
    target: ResolvedOpsTarget,
    selector: string,
    state: "attached" | "visible" | "hidden",
    timeoutMs: number
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const snapshot = await this.runElementAction(
        target,
        selector,
        { type: "getSelectorState" },
        () => this.dom.getSelectorState(target.tabId, selector)
      ) as { attached?: boolean; visible?: boolean };
      if (state === "attached" && snapshot.attached) return;
      if (state === "visible" && snapshot.visible) return;
      if (state === "hidden" && (!snapshot.attached || !snapshot.visible)) return;
      await delay(200);
    }
    throw new Error("Wait for selector timed out");
  }

  private async waitForRefState(
    resolved: ResolvedOpsRef,
    state: "attached" | "visible" | "hidden",
    timeoutMs: number
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const snapshot = await this.callFunctionOnRef<{ attached?: unknown; visible?: unknown }>(
        resolved,
        DOM_SELECTOR_STATE_DECLARATION
      );
      const attached = snapshot?.attached === true;
      const visible = snapshot?.visible === true;
      if (state === "attached" && attached) return;
      if (state === "visible" && visible) return;
      if (state === "hidden" && (!attached || !visible)) return;
      await delay(200);
    }
    throw new Error("Wait for selector timed out");
  }

  private async cleanupSession(session: OpsSession, event: OpsEvent["event"]): Promise<void> {
    this.clearClosingTimer(session.id);
    const waiters = this.parallelWaiters.get(session.id);
    if (waiters) {
      for (const waiter of waiters) {
        if (waiter.timer !== null) {
          clearTimeout(waiter.timer);
          waiter.timer = null;
        }
        waiter.reject(new Error("Ops session closed while waiting for parallelism slot."));
      }
      this.parallelWaiters.delete(session.id);
    }
    this.sessions.delete(session.id);
    const targets = Array.from(session.targets.values());
    try {
      const results = await withTimeout(
        Promise.allSettled(targets.map(async (target) => this.cdp.detachTab(target.tabId))),
        OPS_SESSION_DETACH_TIMEOUT_MS,
        "Ops session detach timed out"
      );
      const failedTabIds = results.flatMap((result, index) => {
        const target = targets[index];
        return result.status === "rejected" && target ? [target.tabId] : [];
      });
      if (failedTabIds.length > 0) {
        logError("ops.session_detach", new Error("One or more ops session targets failed to detach"), {
          code: "session_detach_failed",
          extra: { sessionId: session.id, event, failedTabIds }
        });
      }
    } catch (error) {
      logError("ops.session_detach", error, {
        code: "session_detach_failed",
        extra: { sessionId: session.id, event }
      });
    }
    this.emitSessionEvent(session, event);
  }

  private handleClosedTarget(tabId: number, event: OpsEvent["event"]): void {
    const session = this.sessions.getByTabId(tabId);
    if (!session) return;
    const targetId = this.sessions.getTargetIdByTabId(session.id, tabId);
    if (!targetId) return;
    const removedTarget = this.sessions.removeTarget(session.id, targetId);
    if (!removedTarget) return;
    if (targetId === session.targetId || session.targets.size === 0) {
      void this.cleanupSession(session, event);
    }
  }

  private async handleDebuggerDetachForTab(tabId: number): Promise<void> {
    const session = this.sessions.getByTabId(tabId);
    if (!session) return;
    if (tabId === session.tabId) {
      // Root tab detach can be transient during child-target shutdown, but it must not retain ownership forever.
      this.scheduleRootDebuggerDetachVerification(session.id, tabId);
      return;
    }
    const targetId = this.sessions.getTargetIdByTabId(session.id, tabId);
    const target = targetId ? session.targets.get(targetId) ?? null : null;
    const liveTab = await this.tabs.getTab(tabId);
    if (target && this.isAllowedCanvasTargetUrl(target.url ?? liveTab?.url)) {
      if (liveTab && targetId) {
        session.targets.set(targetId, {
          ...target,
          url: liveTab.url ?? target.url,
          title: liveTab.title ?? target.title
        });
      }
      // Design tabs can detach transiently while the extension page stays open; retain the target so `/ops`
      // can reattach it later via `targets.use`.
      return;
    }
    this.handleClosedTarget(tabId, "ops_session_closed");
  }

  private scheduleRootDebuggerDetachVerification(sessionId: string, tabId: number): void {
    if (typeof this.cdp.getTabDebuggee !== "function") {
      return;
    }
    setTimeout(() => {
      void this.verifyRootDebuggerDetach(sessionId, tabId, ROOT_DETACH_VERIFY_ATTEMPTS);
    }, ROOT_DETACH_VERIFY_DELAY_MS);
  }

  private async verifyRootDebuggerDetach(sessionId: string, tabId: number, attemptsRemaining: number): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || session.tabId !== tabId) {
      return;
    }
    if (this.isConcreteDebuggee(this.cdp.getTabDebuggee?.(tabId))) {
      return;
    }
    let liveTab: chrome.tabs.Tab | null = null;
    try {
      liveTab = await this.tabs.getTab(tabId);
    } catch {
      liveTab = null;
    }
    const current = this.sessions.get(sessionId);
    if (!current || current.tabId !== tabId) {
      return;
    }
    if (!liveTab) {
      void this.cleanupSession(current, "ops_session_closed");
      return;
    }
    if (this.isConcreteDebuggee(this.cdp.getTabDebuggee?.(tabId))) {
      return;
    }
    if (attemptsRemaining > 1) {
      setTimeout(() => {
        void this.verifyRootDebuggerDetach(sessionId, tabId, attemptsRemaining - 1);
      }, ROOT_DETACH_VERIFY_DELAY_MS);
      return;
    }
    void this.cleanupSession(current, "ops_session_closed");
  }

  private async closeTabBestEffort(tabId: number): Promise<void> {
    try {
      await withTimeout(this.tabs.closeTab(tabId), TAB_CLOSE_TIMEOUT_MS, "Ops tab close timed out");
    } catch (error) {
      logError("ops.close_tab", error, {
        code: "close_tab_failed",
        extra: { tabId }
      });
    }
  }

  private scheduleSessionCleanup(sessionId: string, event: OpsEvent["event"]): void {
    setTimeout(() => {
      const session = this.sessions.get(sessionId);
      if (!session) {
        return;
      }
      void this.cleanupSession(session, event);
    }, 0);
  }

  private sendResponse(message: OpsRequest, payload: unknown): void {
    const response: OpsResponse = {
      type: "ops_response",
      requestId: message.requestId,
      clientId: message.clientId,
      opsSessionId: message.opsSessionId,
      payload
    };

    const serialized = JSON.stringify(payload ?? null);
    if (this.encoder.encode(serialized).length <= MAX_OPS_PAYLOAD_BYTES) {
      this.sendEnvelope(response);
      return;
    }

    const payloadId = createId();
    const chunkSize = Math.max(1024, MAX_OPS_PAYLOAD_BYTES - 1024);
    const chunks: string[] = [];
    for (let i = 0; i < serialized.length; i += chunkSize) {
      chunks.push(serialized.slice(i, i + chunkSize));
    }

    this.sendEnvelope({
      type: "ops_response",
      requestId: message.requestId,
      clientId: message.clientId,
      opsSessionId: message.opsSessionId,
      chunked: true,
      payloadId,
      totalChunks: chunks.length
    } satisfies OpsResponse);

    chunks.forEach((data, index) => {
      const chunk: OpsChunk = {
        type: "ops_chunk",
        requestId: message.requestId,
        clientId: message.clientId,
        opsSessionId: message.opsSessionId,
        payloadId,
        chunkIndex: index,
        totalChunks: chunks.length,
        data
      };
      this.sendEnvelope(chunk);
    });
  }

  private sendError(message: OpsRequest, error: OpsError): void {
    const payload: OpsErrorResponse = {
      type: "ops_error",
      requestId: message.requestId,
      clientId: message.clientId,
      opsSessionId: message.opsSessionId,
      error
    };
    this.sendEnvelope(payload);
  }

  private sendEvent(event: OpsEvent): void {
    this.sendEnvelope(event);
  }

  private emitSessionEvent(session: OpsSession, event: OpsEvent["event"]): void {
    this.sendEvent({
      type: "ops_event",
      clientId: session.ownerClientId,
      opsSessionId: session.id,
      event,
      payload: { tabId: session.tabId, targetId: session.targetId }
    });
  }

  private markSessionClosing(session: OpsSession, reason: OpsEvent["event"]): boolean {
    if (session.state === "closing") {
      return false;
    }
    session.state = "closing";
    session.closingReason = reason;
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    const timeoutId = setTimeout(() => {
      this.closingTimers.delete(session.id);
      const current = this.sessions.get(session.id);
      if (current && current.state === "closing") {
        void this.cleanupSession(current, "ops_session_expired");
      }
    }, SESSION_TTL_MS);
    this.closingTimers.set(session.id, timeoutId as unknown as number);
    return true;
  }

  private reclaimSession(session: OpsSession, clientId: string): void {
    const wasClosing = session.state === "closing";
    session.ownerClientId = clientId;
    session.state = "active";
    session.expiresAt = undefined;
    session.closingReason = undefined;
    this.clearClosingTimer(session.id);
    if (wasClosing) {
      this.emitSessionEvent(session, "ops_session_reclaimed");
    }
  }

  private clearClosingTimer(sessionId: string): void {
    const timer = this.closingTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.closingTimers.delete(sessionId);
    }
  }

  private async captureVisibleTab(tabId: number): Promise<string | null> {
    const tab = await this.tabs.getTab(tabId);
    const windowId = tab?.windowId ?? chrome.windows.WINDOW_ID_CURRENT;
    return await new Promise((resolve) => {
      chrome.tabs.captureVisibleTab(windowId, { format: "png" }, (dataUrl) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        if (!dataUrl) {
          resolve(null);
          return;
        }
        const match = dataUrl.match(/^data:image\/png;base64,(.+)$/);
        const base64 = match?.[1] ?? null;
        resolve(base64);
      });
    });
  }
}

const numberInRange = (value: unknown, fallback: number, min: number, max: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
};

const parseParallelismPolicy = (value: unknown): OpsParallelismGovernorPolicy => {
  if (!isRecord(value)) {
    return DEFAULT_OPS_PARALLELISM_POLICY;
  }
  const modeCapsInput = isRecord(value.modeCaps) ? value.modeCaps : {};
  return {
    floor: numberInRange(value.floor, DEFAULT_OPS_PARALLELISM_POLICY.floor, 1, 32),
    backpressureTimeoutMs: numberInRange(
      value.backpressureTimeoutMs,
      DEFAULT_OPS_PARALLELISM_POLICY.backpressureTimeoutMs,
      100,
      120000
    ),
    sampleIntervalMs: numberInRange(
      value.sampleIntervalMs,
      DEFAULT_OPS_PARALLELISM_POLICY.sampleIntervalMs,
      250,
      60000
    ),
    recoveryStableWindows: numberInRange(
      value.recoveryStableWindows,
      DEFAULT_OPS_PARALLELISM_POLICY.recoveryStableWindows,
      1,
      20
    ),
    hostFreeMemMediumPct: numberInRange(
      value.hostFreeMemMediumPct,
      DEFAULT_OPS_PARALLELISM_POLICY.hostFreeMemMediumPct,
      1,
      99
    ),
    hostFreeMemHighPct: numberInRange(
      value.hostFreeMemHighPct,
      DEFAULT_OPS_PARALLELISM_POLICY.hostFreeMemHighPct,
      1,
      99
    ),
    hostFreeMemCriticalPct: numberInRange(
      value.hostFreeMemCriticalPct,
      DEFAULT_OPS_PARALLELISM_POLICY.hostFreeMemCriticalPct,
      1,
      99
    ),
    rssBudgetMb: numberInRange(
      value.rssBudgetMb,
      DEFAULT_OPS_PARALLELISM_POLICY.rssBudgetMb,
      64,
      65536
    ),
    rssSoftPct: numberInRange(
      value.rssSoftPct,
      DEFAULT_OPS_PARALLELISM_POLICY.rssSoftPct,
      1,
      99
    ),
    rssHighPct: numberInRange(
      value.rssHighPct,
      DEFAULT_OPS_PARALLELISM_POLICY.rssHighPct,
      1,
      99
    ),
    rssCriticalPct: numberInRange(
      value.rssCriticalPct,
      DEFAULT_OPS_PARALLELISM_POLICY.rssCriticalPct,
      1,
      99
    ),
    queueAgeHighMs: numberInRange(
      value.queueAgeHighMs,
      DEFAULT_OPS_PARALLELISM_POLICY.queueAgeHighMs,
      100,
      120000
    ),
    queueAgeCriticalMs: numberInRange(
      value.queueAgeCriticalMs,
      DEFAULT_OPS_PARALLELISM_POLICY.queueAgeCriticalMs,
      100,
      120000
    ),
    modeCaps: {
      managedHeaded: numberInRange(
        modeCapsInput.managedHeaded,
        DEFAULT_OPS_PARALLELISM_POLICY.modeCaps.managedHeaded,
        1,
        64
      ),
      managedHeadless: numberInRange(
        modeCapsInput.managedHeadless,
        DEFAULT_OPS_PARALLELISM_POLICY.modeCaps.managedHeadless,
        1,
        64
      ),
      cdpConnectHeaded: numberInRange(
        modeCapsInput.cdpConnectHeaded,
        DEFAULT_OPS_PARALLELISM_POLICY.modeCaps.cdpConnectHeaded,
        1,
        64
      ),
      cdpConnectHeadless: numberInRange(
        modeCapsInput.cdpConnectHeadless,
        DEFAULT_OPS_PARALLELISM_POLICY.modeCaps.cdpConnectHeadless,
        1,
        64
      ),
      extensionOpsHeaded: numberInRange(
        modeCapsInput.extensionOpsHeaded,
        DEFAULT_OPS_PARALLELISM_POLICY.modeCaps.extensionOpsHeaded,
        1,
        64
      ),
      extensionLegacyCdpHeaded: numberInRange(
        modeCapsInput.extensionLegacyCdpHeaded,
        DEFAULT_OPS_PARALLELISM_POLICY.modeCaps.extensionLegacyCdpHeaded,
        1,
        64
      )
    }
  };
};

const isParallelismBackpressureError = (
  error: unknown
): error is Error & { code: "parallelism_backpressure"; details: Record<string, unknown> } => {
  if (!(error instanceof Error)) {
    return false;
  }
  const typed = error as Error & { code?: string; details?: Record<string, unknown> };
  return typed.code === "parallelism_backpressure" && typeof typed.details === "object" && typed.details !== null;
};

const buildError = (code: OpsErrorCode, message: string, retryable: boolean, details?: Record<string, unknown>): OpsError => ({
  code,
  message,
  retryable,
  details
});

type CookieImportRecord = {
  name: string;
  value: string;
  url?: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
};

type CookieListRecord = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: "Strict" | "Lax" | "None";
};

type CookieValidationResult = {
  valid: boolean;
  reason: string;
  cookie: CookieImportRecord;
};

const validateCookieRecord = (cookie: CookieImportRecord): CookieValidationResult => {
  const name = cookie.name?.trim();
  if (!name) {
    return { valid: false, reason: "Cookie name is required.", cookie };
  }
  if (!/^[^\s;=]+$/.test(name)) {
    return { valid: false, reason: `Invalid cookie name: ${cookie.name}.`, cookie };
  }
  if (typeof cookie.value !== "string" || /\r|\n|;/.test(cookie.value)) {
    return { valid: false, reason: `Invalid cookie value for ${name}.`, cookie };
  }

  const hasUrl = typeof cookie.url === "string" && cookie.url.trim().length > 0;
  const hasDomain = typeof cookie.domain === "string" && cookie.domain.trim().length > 0;
  if (!hasUrl && !hasDomain) {
    return { valid: false, reason: `Cookie ${name} requires url or domain.`, cookie };
  }

  let normalizedUrl: string | undefined;
  if (hasUrl) {
    try {
      const parsedUrl = new URL(cookie.url as string);
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        return { valid: false, reason: `Cookie ${name} url must be http(s).`, cookie };
      }
      normalizedUrl = parsedUrl.toString();
    } catch {
      return { valid: false, reason: `Cookie ${name} has invalid url.`, cookie };
    }
  }

  let normalizedDomain: string | undefined;
  if (hasDomain) {
    normalizedDomain = String(cookie.domain).trim().toLowerCase();
    if (!/^\.?[a-z0-9.-]+$/.test(normalizedDomain) || normalizedDomain.includes("..")) {
      return { valid: false, reason: `Cookie ${name} has invalid domain.`, cookie };
    }
  }

  const normalizedPath = typeof cookie.path === "string" ? cookie.path.trim() : undefined;
  if (typeof normalizedPath === "string" && !normalizedPath.startsWith("/")) {
    return { valid: false, reason: `Cookie ${name} path must start with '/'.`, cookie };
  }

  if (typeof cookie.expires !== "undefined") {
    if (!Number.isFinite(cookie.expires) || cookie.expires < -1) {
      return { valid: false, reason: `Cookie ${name} has invalid expires.`, cookie };
    }
  }

  if (cookie.sameSite === "None" && cookie.secure !== true) {
    return { valid: false, reason: `Cookie ${name} with SameSite=None must set secure=true.`, cookie };
  }

  const normalizedCookie: CookieImportRecord = {
    name,
    value: cookie.value,
    ...(typeof cookie.expires === "number" ? { expires: cookie.expires } : {}),
    ...(typeof cookie.httpOnly === "boolean" ? { httpOnly: cookie.httpOnly } : {}),
    ...(typeof cookie.secure === "boolean" ? { secure: cookie.secure } : {}),
    ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {})
  };

  if (normalizedDomain) {
    normalizedCookie.domain = normalizedDomain;
    normalizedCookie.path = normalizedPath ?? "/";
  } else if (normalizedUrl) {
    normalizedCookie.url = normalizedUrl;
  }

  return {
    valid: true,
    reason: "",
    cookie: normalizedCookie
  };
};

const parseCookieFilterUrls = (value: unknown): string[] | undefined => {
  if (typeof value === "undefined") {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error("Cookie url filters must be an array of strings.");
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") {
      throw new Error("Cookie url filters must be an array of strings.");
    }
    const trimmed = entry.trim();
    if (!trimmed) {
      throw new Error("Cookie url filters must be non-empty strings.");
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(trimmed);
    } catch {
      throw new Error(`Cookie url filter is invalid: ${trimmed}`);
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error(`Cookie url filter must be http(s): ${trimmed}`);
    }

    const normalizedUrl = parsedUrl.toString();
    if (seen.has(normalizedUrl)) {
      continue;
    }
    seen.add(normalizedUrl);
    normalized.push(normalizedUrl);
  }

  return normalized.length > 0 ? normalized : undefined;
};

const toCookieListRecord = (entry: unknown): CookieListRecord | null => {
  if (!isRecord(entry)) {
    return null;
  }

  const name = typeof entry.name === "string" ? entry.name : "";
  const value = typeof entry.value === "string" ? entry.value : "";
  const domain = typeof entry.domain === "string" ? entry.domain : "";
  const path = typeof entry.path === "string" ? entry.path : "";
  const expires = typeof entry.expires === "number" && Number.isFinite(entry.expires) ? entry.expires : -1;
  const httpOnly = entry.httpOnly === true;
  const secure = entry.secure === true;

  if (!name || !domain || !path) {
    return null;
  }

  const sameSiteRaw = entry.sameSite;
  const sameSite = sameSiteRaw === "Strict" || sameSiteRaw === "Lax" || sameSiteRaw === "None"
    ? sameSiteRaw
    : undefined;

  return {
    name,
    value,
    domain,
    path,
    expires,
    httpOnly,
    secure,
    ...(sameSite ? { sameSite } : {})
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
};

const parseCanvasOverlaySelection = (
  value: unknown,
  targetId: string
): { pageId: string | null; nodeId: string | null; targetId: string | null; updatedAt?: string } => {
  const record = isRecord(value) ? value : {};
  const updatedAt = typeof record.updatedAt === "string" && record.updatedAt.trim().length > 0
    ? record.updatedAt
    : undefined;
  return {
    pageId: typeof record.pageId === "string" && record.pageId.trim().length > 0 ? record.pageId : null,
    nodeId: typeof record.nodeId === "string" && record.nodeId.trim().length > 0 ? record.nodeId : null,
    targetId: typeof record.targetId === "string" && record.targetId.trim().length > 0 ? record.targetId : targetId,
    ...(updatedAt ? { updatedAt } : {})
  };
};

const parseCursor = (cursor?: string): number => {
  if (!cursor) return 0;
  const value = Number(cursor);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
};

const paginate = (lines: string[], startIndex: number, maxChars: number): { content: string; truncated: boolean; nextCursor?: string } => {
  let total = 0;
  const parts: string[] = [];
  let idx = startIndex;

  while (idx < lines.length) {
    const line = lines[idx];
    if (line === undefined) {
      break;
    }
    if (total + line.length + 1 > maxChars && parts.length > 0) {
      break;
    }
    parts.push(line);
    total += line.length + 1;
    idx += 1;
  }

  const truncated = idx < lines.length;
  const nextCursor = truncated ? String(idx) : undefined;
  return {
    content: parts.join("\n"),
    truncated,
    nextCursor
  };
};

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const parseTabTargetId = (targetId: string): number | null => {
  const match = /^tab-(\d+)$/.exec(targetId);
  if (!match) {
    return null;
  }
  const parsed = Number.parseInt(match[1]!, 10);
  return parsed;
};

const parseTargetAliasTabId = (targetId: string | undefined): number | null => {
  if (typeof targetId !== "string" || targetId.length === 0) {
    return null;
  }
  if (targetId.startsWith("target-")) {
    const parsed = Number.parseInt(targetId.slice(7), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return parseTabTargetId(targetId);
};

const extractBodyHtml = (html: string): string => {
  const bodyMatch = html.match(/<body\b[^>]*>[\s\S]*<\/body>/i);
  if (bodyMatch) {
    return bodyMatch[0];
  }
  return html;
};

const htmlContainsRichMedia = (html: string | null): boolean => {
  return typeof html === "string" && /<(img|video|audio)\b/i.test(html);
};

const canvasStateContainsRichMedia = (state: CanvasPageState): boolean => {
  const document = isRecord(state.document) ? state.document : null;
  const pages = Array.isArray(document?.pages) ? document.pages : [];
  const assets = Array.isArray(document?.assets) ? document.assets : [];
  const assetsById = new Map(assets.flatMap((asset) => typeof asset?.id === "string" ? [[asset.id, asset]] : []));
  return pages.some((page) => Array.isArray(page?.nodes) && page.nodes.some((node) => nodeContainsRichMedia(node, assetsById)));
};

const nodeContainsRichMedia = (
  node: CanvasPageState["document"]["pages"][number]["nodes"][number],
  assetsById: Map<string, CanvasPageState["document"]["assets"][number]>
): boolean => {
  const tagName = readCanvasMediaTagName(node);
  if (tagName === "img" || tagName === "video" || tagName === "audio") {
    return true;
  }
  const assetIds = Array.isArray(node.metadata.assetIds)
    ? node.metadata.assetIds.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
  return assetIds.some((assetId) => {
    const asset = assetsById.get(assetId);
    const kind = typeof asset?.kind === "string" ? asset.kind.toLowerCase() : "";
    const mime = typeof asset?.mime === "string" ? asset.mime.toLowerCase() : "";
    return kind === "image" || kind === "video" || kind === "audio" || mime.startsWith("image/") || mime.startsWith("video/") || mime.startsWith("audio/");
  });
};

const readCanvasMediaTagName = (node: CanvasPageState["document"]["pages"][number]["nodes"][number]): string | null => {
  if (typeof node.props.tagName === "string" && node.props.tagName.trim().length > 0) {
    return node.props.tagName.trim().toLowerCase();
  }
  const codeSync = isRecord(node.metadata.codeSync) ? node.metadata.codeSync : null;
  if (codeSync && typeof codeSync.tagName === "string" && codeSync.tagName.trim().length > 0) {
    return codeSync.tagName.trim().toLowerCase();
  }
  return null;
};

const buildCanvasDocumentCapture = (state: CanvasPageState): DomCapture | null => {
  const page = Array.isArray(state.document.pages) ? state.document.pages[0] : null;
  if (!page || !Array.isArray(page.nodes) || page.nodes.length === 0) {
    return null;
  }
  const { width, height } = computeCanvasDocumentBounds(page.nodes);
  const nodes = [...page.nodes]
    .sort(compareCanvasCaptureNodes)
    .map((node) => renderCanvasDocumentNode(state.document, node))
    .join("");
  return {
    html: `<body><main data-surface="canvas" style="position:relative;width:${width}px;min-height:${height}px;">${nodes}</main></body>`,
    styles: {},
    warnings: ["canvas_state_capture"],
    inlineStyles: true
  };
};

const computeCanvasDocumentBounds = (
  nodes: CanvasPageState["document"]["pages"][number]["nodes"]
): { width: number; height: number } => {
  if (nodes.length === 0) {
    return { width: 1600, height: 1200 };
  }
  const maxX = Math.max(...nodes.map((node) => node.rect.x + node.rect.width));
  const maxY = Math.max(...nodes.map((node) => node.rect.y + node.rect.height));
  return {
    width: Math.max(maxX + 240, 1600),
    height: Math.max(maxY + 240, 1200)
  };
};

const compareCanvasCaptureNodes = (
  left: CanvasPageState["document"]["pages"][number]["nodes"][number],
  right: CanvasPageState["document"]["pages"][number]["nodes"][number]
): number => {
  const rootOrder = Number(left.parentId !== null) - Number(right.parentId !== null);
  if (rootOrder !== 0) {
    return rootOrder;
  }
  const areaOrder = (right.rect.width * right.rect.height) - (left.rect.width * left.rect.height);
  if (areaOrder !== 0) {
    return areaOrder;
  }
  const verticalOrder = left.rect.y - right.rect.y;
  return verticalOrder !== 0 ? verticalOrder : left.rect.x - right.rect.x;
};

const renderCanvasDocumentNode = (
  document: CanvasPageState["document"],
  node: CanvasPageState["document"]["pages"][number]["nodes"][number]
): string => {
  const media = resolveCanvasDocumentMedia(document, node);
  const text = escapeCanvasHtml(nodeTextForCapture(node) || node.name);
  const style = serializeCanvasCaptureStyle({
    position: "absolute",
    left: `${node.rect.x}px`,
    top: `${node.rect.y}px`,
    width: `${Math.max(node.rect.width, 40)}px`,
    minHeight: `${Math.max(node.rect.height, readCanvasMediaTagName(node) === "audio" ? 64 : 40)}px`,
    overflow: "hidden",
    ...node.style
  });
  const title = escapeCanvasAttribute(`${node.kind} • ${node.name}`);
  if (media?.kind === "image" && media.src) {
    return `<div data-node-id="${escapeCanvasAttribute(node.id)}" title="${title}" style="${style}"><img src="${escapeCanvasAttribute(media.src)}" alt="${escapeCanvasAttribute(media.alt ?? node.name)}" loading="lazy" draggable="false" style="width:100%;height:100%;object-fit:cover;display:block;" /></div>`;
  }
  if (media?.kind === "video" && media.src) {
    const poster = media.poster ? ` poster="${escapeCanvasAttribute(media.poster)}"` : "";
    return `<div data-node-id="${escapeCanvasAttribute(node.id)}" title="${title}" style="${style}"><video src="${escapeCanvasAttribute(media.src)}"${poster} muted loop autoplay playsinline preload="metadata" style="width:100%;height:100%;object-fit:cover;display:block;"></video></div>`;
  }
  if (media?.kind === "audio" && media.src) {
    return `<div data-node-id="${escapeCanvasAttribute(node.id)}" title="${title}" style="${style}"><audio src="${escapeCanvasAttribute(media.src)}" controls preload="metadata" style="width:100%;display:block;"></audio>${text ? `<div style="margin-top:8px;font:500 12px/1.4 sans-serif;">${text}</div>` : ""}</div>`;
  }
  return `<div data-node-id="${escapeCanvasAttribute(node.id)}" title="${title}" style="${style}">${text}</div>`;
};

const nodeTextForCapture = (
  node: CanvasPageState["document"]["pages"][number]["nodes"][number]
): string => {
  const raw = node.props.text ?? node.metadata.text;
  if (raw !== undefined && raw !== null) {
    return typeof raw === "string" ? raw : String(raw);
  }
  return node.kind === "text" || node.kind === "note" || node.kind === "component-instance"
    ? node.name
    : "";
};

const resolveCanvasDocumentMedia = (
  document: CanvasPageState["document"],
  node: CanvasPageState["document"]["pages"][number]["nodes"][number]
): { kind: "image" | "video" | "audio"; src: string | null; poster: string | null; alt: string | null } | null => {
  const tagName = readCanvasMediaTagName(node);
  const attributes = isRecord(node.props.attributes) ? node.props.attributes : {};
  const assetIds = Array.isArray(node.metadata.assetIds)
    ? node.metadata.assetIds.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
  const asset = assetIds.length > 0
    ? document.assets.find((entry) => entry.id === assetIds[0])
    : null;
  const assetKind = typeof asset?.kind === "string" ? asset.kind.toLowerCase() : null;
  const assetMime = typeof asset?.mime === "string" ? asset.mime.toLowerCase() : null;
  const src = typeof node.props.src === "string"
    ? node.props.src
    : typeof attributes.src === "string"
      ? attributes.src
      : typeof asset?.url === "string"
        ? asset.url
        : typeof asset?.repoPath === "string"
          ? asset.repoPath
          : null;
  const poster = typeof node.props.poster === "string"
    ? node.props.poster
    : typeof attributes.poster === "string"
      ? attributes.poster
      : null;
  const alt = typeof node.props.alt === "string"
    ? node.props.alt
    : typeof attributes.alt === "string"
      ? attributes.alt
      : node.name;
  if (tagName === "img" || assetKind === "image" || assetMime?.startsWith("image/")) {
    return { kind: "image", src, poster: null, alt };
  }
  if (tagName === "video" || assetKind === "video" || assetMime?.startsWith("video/")) {
    return { kind: "video", src, poster, alt };
  }
  if (tagName === "audio" || assetKind === "audio" || assetMime?.startsWith("audio/")) {
    return { kind: "audio", src, poster: null, alt };
  }
  return null;
};

const serializeCanvasCaptureStyle = (style: Record<string, unknown>): string => {
  return Object.entries(style)
    .flatMap(([key, value]) => {
      if (typeof value !== "string" && typeof value !== "number") {
        return [];
      }
      const cssKey = key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
      const cssValue = typeof value === "number" && !CANVAS_CAPTURE_UNITLESS_STYLES.has(key) ? `${value}px` : String(value);
      return `${cssKey}:${escapeCanvasAttribute(cssValue)};`;
    })
    .join("");
};

const escapeCanvasHtml = (value: string): string => {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
};

const escapeCanvasAttribute = (value: string): string => {
  return escapeCanvasHtml(value)
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
};

const CANVAS_CAPTURE_UNITLESS_STYLES = new Set(["fontWeight", "lineHeight", "opacity", "zIndex"]);

const buildStaleSnapshotError = (ref: string): Error => (
  new Error(`Unknown ref: ${ref}. ${STALE_REF_ERROR_SUFFIX}`)
);

const isSnapshotStaleMessage = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (message.includes(STALE_REF_ERROR_SUFFIX)) {
    return true;
  }
  const normalized = message.toLowerCase();
  return normalized.includes("no node with given id")
    || normalized.includes("could not find node with given id")
    || normalized.includes("cannot find object with id")
    || normalized.includes("cannot find context with specified id")
    || normalized.includes("execution context was destroyed")
    || normalized.includes("inspected target navigated or closed");
};

const extractTargetInfo = (params: unknown): {
  targetId: string;
  type: string;
  url?: string;
  title?: string;
  openerId?: string;
} | null => {
  const payload = isRecord(params) && isRecord(params.targetInfo) ? params.targetInfo : params;
  if (!isRecord(payload) || typeof payload.targetId !== "string" || typeof payload.type !== "string") {
    return null;
  }
  return {
    targetId: payload.targetId,
    type: payload.type,
    ...(typeof payload.url === "string" ? { url: payload.url } : {}),
    ...(typeof payload.title === "string" ? { title: payload.title } : {}),
    ...(typeof payload.openerId === "string" ? { openerId: payload.openerId } : {})
  };
};

const isSyntheticPageTarget = (session: OpsSession, targetId: string, type: string): boolean => {
  if (type !== "page" || targetId === session.targetId) {
    return false;
  }
  const parsedTabId = parseTabTargetId(targetId);
  return session.targets.has(targetId) || parsedTabId === null || parsedTabId !== session.tabId;
};

const resolveReportedTargetUrl = (
  target: { url?: string; title?: string; sessionId?: string; synthetic?: boolean } | null | undefined,
  tab?: chrome.tabs.Tab | null
): string | undefined => {
  if (target?.synthetic === true && typeof target.url === "string" && target.url.length > 0) {
    return target.url;
  }
  if (typeof target?.url === "string" && isHtmlDataUrl(target.url)) {
    return target.url;
  }
  if (typeof target?.url === "string" && isCanvasExtensionUrl(target.url)) {
    return target.url;
  }
  return getReportedTabUrl(tab) ?? target?.url;
};

const resolveReportedTargetTitle = (
  target: { url?: string; title?: string; sessionId?: string; synthetic?: boolean } | null | undefined,
  tab?: chrome.tabs.Tab | null
): string | undefined => {
  if (target?.synthetic === true && typeof target.title === "string" && target.title.length > 0) {
    return target.title;
  }
  if (typeof target?.url === "string" && isHtmlDataUrl(target.url) && typeof target.title === "string" && target.title.length > 0) {
    return target.title;
  }
  if (typeof target?.url === "string" && isCanvasExtensionUrl(target.url) && typeof target.title === "string" && target.title.length > 0) {
    return target.title;
  }
  if (isTabNavigationPending(tab)) {
    return undefined;
  }
  return getReportedTabTitle(tab) ?? target?.title;
};

const getReportedTabSeed = (tab: chrome.tabs.Tab): { url?: string; title?: string } => {
  return {
    url: getReportedTabUrl(tab),
    title: getReportedTabTitle(tab)
  };
};

const getReportedTabUrl = (tab?: chrome.tabs.Tab | null): string | undefined => {
  if (!tab) {
    return undefined;
  }
  const pendingUrl = typeof tab.pendingUrl === "string" && tab.pendingUrl.length > 0 ? tab.pendingUrl : undefined;
  const liveUrl = typeof tab.url === "string" && tab.url.length > 0 ? tab.url : undefined;
  return pendingUrl ?? liveUrl;
};

const getReportedTabTitle = (tab?: chrome.tabs.Tab | null): string | undefined => {
  if (!tab || isTabNavigationPending(tab)) {
    return undefined;
  }
  return typeof tab.title === "string" && tab.title.length > 0 ? tab.title : undefined;
};

const isTabNavigationPending = (tab?: chrome.tabs.Tab | null): boolean => {
  return tab?.status === "loading";
};

const isHtmlDataUrl = (url: string): boolean => {
  return url.startsWith("data:text/html");
};

const isCanvasExtensionUrl = (url: string): boolean => {
  try {
    const canvasUrl = chrome.runtime.getURL("canvas.html");
    return url === canvasUrl || url.startsWith(`${canvasUrl}#`) || url.startsWith(`${canvasUrl}?`);
  } catch {
    return false;
  }
};

const decodeHtmlDataUrl = (url: string): string | null => {
  if (!isHtmlDataUrl(url)) {
    return null;
  }
  const commaIndex = url.indexOf(",");
  if (commaIndex === -1) {
    return null;
  }
  const metadata = url.slice(0, commaIndex).toLowerCase();
  const payload = url.slice(commaIndex + 1);
  if (metadata.includes(";base64")) {
    const decoded = atob(payload);
    const bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  try {
    return decodeURIComponent(payload);
  } catch {
    return payload;
  }
};

const executeInTab = async <TArg, TResult>(
  tabId: number,
  func: (arg: TArg) => TResult,
  args: [TArg]
): Promise<TResult> => {
  return await new Promise<TResult>((resolve, reject) => {
    chrome.scripting.executeScript(
      { target: { tabId }, func: func as never, args },
      (results) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        const [first] = results ?? [];
        resolve((first?.result ?? null) as TResult);
      }
    );
  });
};

function replaceDocumentWithHtmlScript(input: { html: string }): { title: string } {
  document.open();
  document.write(input.html);
  document.close();
  return { title: document.title };
}

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> => {
  return await new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise.then((value) => {
      clearTimeout(timeoutId);
      resolve(value);
    }).catch((error) => {
      clearTimeout(timeoutId);
      reject(error);
    });
  });
};

const createId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};
