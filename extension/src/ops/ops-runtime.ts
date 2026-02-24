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
import { CDPRouter } from "../services/CDPRouter.js";
import { TabManager } from "../services/TabManager.js";
import { getRestrictionMessage, isRestrictedUrl } from "../services/url-restrictions.js";
import { logError } from "../logging.js";
import { DomBridge } from "./dom-bridge.js";
import { buildSnapshot, type SnapshotMode } from "./snapshot-builder.js";
import { OpsSessionStore, type OpsSession, type OpsConsoleEvent, type OpsNetworkEvent } from "./ops-session-store.js";
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

const TARGET_SCOPED_COMMANDS = new Set<string>([
  "storage.setCookies",
  "storage.getCookies",
  "nav.goto",
  "nav.wait",
  "nav.snapshot",
  "interact.click",
  "interact.hover",
  "interact.press",
  "interact.check",
  "interact.uncheck",
  "interact.type",
  "interact.select",
  "interact.scroll",
  "interact.scrollIntoView",
  "dom.getHtml",
  "dom.getText",
  "dom.getAttr",
  "dom.getValue",
  "dom.isVisible",
  "dom.isEnabled",
  "dom.isChecked",
  "export.clonePage",
  "export.cloneComponent",
  "devtools.perf",
  "page.screenshot"
]);

type OpsParallelWaiter = {
  targetId: string;
  enqueuedAt: number;
  timeoutMs: number;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: number | null;
};

export type OpsRuntimeOptions = {
  send: (message: OpsEnvelope) => void;
  cdp: CDPRouter;
};

export class OpsRuntime {
  private readonly sendEnvelope: (message: OpsEnvelope) => void;
  private readonly cdp: CDPRouter;
  private readonly tabs = new TabManager();
  private readonly dom = new DomBridge();
  private readonly sessions = new OpsSessionStore();
  private readonly encoder = new TextEncoder();
  private closingTimers = new Map<string, number>();
  private parallelWaiters = new Map<string, OpsParallelWaiter[]>();

  constructor(options: OpsRuntimeOptions) {
    this.sendEnvelope = options.send;
    this.cdp = options.cdp;
    chrome.tabs.onRemoved.addListener(this.handleTabRemoved);
    chrome.tabs.onUpdated.addListener(this.handleTabUpdated);
    chrome.debugger.onEvent.addListener(this.handleDebuggerEvent);
    chrome.debugger.onDetach.addListener(this.handleDebuggerDetach);
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
    const sessions = this.sessions.listOwnedBy(clientId);
    for (const session of sessions) {
      this.markSessionClosing(session, "ops_session_expired");
    }
  }

  private handleTabRemoved = (tabId: number): void => {
    this.handleClosedTarget(tabId, "ops_tab_closed");
  };

  private handleTabUpdated = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab): void => {
    const session = this.sessions.getByTabId(tabId);
    if (!session) return;
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

  private handleDebuggerEvent = (source: chrome.debugger.Debuggee, method: string, params?: object): void => {
    if (typeof source.tabId !== "number") return;
    const session = this.sessions.getByTabId(source.tabId);
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
    const activeTab = startUrl
      ? await this.tabs.createTab(startUrl, true)
      : await this.tabs.getActiveTab();

    if (!activeTab || typeof activeTab.id !== "number") {
      this.sendError(message, buildError("ops_unavailable", "No active tab to attach.", true));
      return;
    }

    if (activeTab.url) {
      const restriction = isRestrictedUrl(activeTab.url);
      if (restriction.restricted) {
        this.sendError(message, buildError("restricted_url", restriction.message ?? "Restricted tab.", false));
        return;
      }
    }

    try {
      await this.cdp.attach(activeTab.id);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Debugger attach failed";
      this.sendError(message, buildError("cdp_attach_failed", detail, false));
      return;
    }

    await this.tabs.waitForTabComplete(activeTab.id).catch(() => undefined);

    const leaseId = typeof message.leaseId === "string" && message.leaseId.trim().length > 0
      ? message.leaseId.trim()
      : createId();
    const session = this.sessions.createSession(clientId, activeTab.id, leaseId, {
      url: activeTab.url ?? undefined,
      title: activeTab.title ?? undefined
    }, {
      parallelismPolicy
    });

    await this.enableSessionDomains(session);

    this.sendEvent({
      type: "ops_event",
      clientId,
      opsSessionId: session.id,
      event: "ops_session_created",
      payload: { tabId: session.tabId, targetId: session.targetId }
    });

    this.sendResponse(message, {
      opsSessionId: session.id,
      activeTargetId: session.activeTargetId,
      url: activeTab.url ?? undefined,
      title: activeTab.title ?? undefined,
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
    const tab = await this.tabs.getTab(session.tabId);
    this.sendResponse(message, {
      mode: "extension",
      activeTargetId: session.activeTargetId || null,
      url: tab?.url ?? undefined,
      title: tab?.title ?? undefined,
      leaseId: session.leaseId,
      state: session.state
    });
  }

  private async handleTargetsList(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const includeUrls = payload.includeUrls === true;
    const targets = await Promise.all(Array.from(session.targets.values()).map(async (target) => {
      const tab = await this.tabs.getTab(target.tabId);
      return {
        targetId: target.targetId,
        type: "page" as const,
        title: tab?.title ?? target.title,
        url: includeUrls ? tab?.url ?? target.url : undefined
      };
    }));
    this.sendResponse(message, { activeTargetId: session.activeTargetId || null, targets });
  }

  private async handleTargetsUse(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const targetId = typeof payload.targetId === "string" ? payload.targetId : null;
    if (!targetId || !session.targets.has(targetId)) {
      this.sendError(message, buildError("invalid_request", "Unknown targetId", false));
      return;
    }
    session.activeTargetId = targetId;
    const target = session.targets.get(targetId) ?? null;
    if (target) {
      await this.tabs.activateTab(target.tabId).catch(() => undefined);
    }
    const tab = target ? await this.tabs.getTab(target.tabId) : null;
    this.sendResponse(message, {
      activeTargetId: targetId,
      url: tab?.url ?? target?.url,
      title: tab?.title ?? target?.title
    });
  }

  private async handleTargetsNew(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const url = typeof payload.url === "string" ? payload.url : undefined;
    const tab = await this.tabs.createTab(url, true);
    if (!tab?.id) {
      this.sendError(message, buildError("execution_failed", "Target creation failed", false));
      return;
    }
    await this.tabs.waitForTabComplete(tab.id).catch(() => undefined);
    try {
      await this.cdp.attach(tab.id);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Debugger attach failed";
      this.sendError(message, buildError("cdp_attach_failed", detail, false));
      return;
    }
    const target = this.sessions.addTarget(session.id, tab.id, { url: tab.url ?? undefined, title: tab.title ?? undefined });
    session.activeTargetId = target.targetId;
    this.sendResponse(message, { targetId: target.targetId });
  }

  private async handleTargetsClose(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const targetId = typeof payload.targetId === "string" ? payload.targetId : null;
    if (!targetId) {
      this.sendError(message, buildError("invalid_request", "Missing targetId", false));
      return;
    }
    const target = session.targets.get(targetId);
    if (!target) {
      this.sendError(message, buildError("invalid_request", "Unknown targetId", false));
      return;
    }
    this.sessions.removeTarget(session.id, targetId);
    await this.closeTabBestEffort(target.tabId);
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
    const tab = await this.tabs.createTab(url, true);
    if (!tab?.id) {
      this.sendError(message, buildError("execution_failed", "Target creation failed", false));
      return;
    }
    await this.tabs.waitForTabComplete(tab.id).catch(() => undefined);
    try {
      await this.cdp.attach(tab.id);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Debugger attach failed";
      this.sendError(message, buildError("cdp_attach_failed", detail, false));
      return;
    }
    const target = this.sessions.addTarget(session.id, tab.id, { url: tab.url ?? undefined, title: tab.title ?? undefined });
    this.sessions.setName(session.id, target.targetId, name);
    session.activeTargetId = target.targetId;
    this.sendResponse(message, { targetId: target.targetId, created: true, url: target.url, title: target.title });
  }

  private async handlePageList(message: OpsRequest, session: OpsSession): Promise<void> {
    const pages = await Promise.all(this.sessions.listNamedTargets(session.id).map(async ({ name, targetId }) => {
      const target = session.targets.get(targetId);
      const tab = target ? await this.tabs.getTab(target.tabId) : null;
      return {
        name,
        targetId,
        url: tab?.url ?? target?.url,
        title: tab?.title ?? target?.title
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
      await this.closeTabBestEffort(target.tabId);
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
    try {
      const restriction = getRestrictionMessage(new URL(url));
      if (restriction) {
        this.sendError(message, buildError("restricted_url", restriction, false));
        return;
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
    const updated = await new Promise<chrome.tabs.Tab | null>((resolve) => {
      chrome.tabs.update(target.tabId, { url }, (tab) => {
        resolve(tab ?? null);
      });
    });
    await this.tabs.waitForTabComplete(target.tabId, timeoutMs).catch(() => undefined);
    const refreshed = await this.tabs.getTab(target.tabId);
    const targetRecord = session.targets.get(target.targetId);
    if (targetRecord) {
      targetRecord.url = refreshed?.url ?? updated?.url ?? url;
      targetRecord.title = refreshed?.title ?? updated?.title ?? targetRecord.title;
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
      const selector = this.resolveSelector(session, payload.ref, message);
      if (!selector) return;
      try {
        await this.waitForSelector(target.tabId, selector, state, timeoutMs);
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
    const mode = payload.mode === "actionables" ? "actionables" : "outline";
    const maxChars = typeof payload.maxChars === "number" ? payload.maxChars : 16000;
    const cursor = typeof payload.cursor === "string" ? payload.cursor : undefined;
    const maxNodes = typeof payload.maxNodes === "number" ? payload.maxNodes : undefined;
    const target = this.requireActiveTarget(session, message);
    if (!target) return;

    const start = Date.now();
    const entriesData = await buildSnapshot(
      (method, params) => this.cdp.sendCommand({ tabId: target.tabId }, method, params),
      mode as SnapshotMode,
      true,
      maxNodes
    );
    const snapshot = session.refStore.setSnapshot(target.targetId, entriesData.entries);
    const startIndex = parseCursor(cursor);
    const { content, truncated, nextCursor } = paginate(entriesData.lines, startIndex, maxChars);
    const contentBytes = this.encoder.encode(content).length;
    if (contentBytes > MAX_SNAPSHOT_BYTES) {
      this.sendError(message, buildError("snapshot_too_large", "Snapshot exceeded max size.", false, {
        maxSnapshotBytes: MAX_SNAPSHOT_BYTES,
        actualBytes: contentBytes
      }));
      return;
    }

    const tab = await this.tabs.getTab(target.tabId);
    this.sendResponse(message, {
      snapshotId: snapshot.snapshotId,
      url: tab?.url ?? undefined,
      title: tab?.title ?? undefined,
      content,
      truncated,
      nextCursor,
      refCount: snapshot.count,
      timingMs: Date.now() - start,
      warnings: entriesData.warnings
    });
  }

  private async handleClick(message: OpsRequest, session: OpsSession): Promise<void> {
    const selector = this.resolveSelector(session, message.payload, message);
    if (!selector) return;
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    const start = Date.now();
    const before = await this.tabs.getTab(target.tabId);
    await this.dom.click(target.tabId, selector);
    const after = await this.tabs.getTab(target.tabId);
    const navigated = Boolean(before?.url && after?.url && before.url !== after.url);
    this.sendResponse(message, { timingMs: Date.now() - start, navigated });
  }

  private async handleHover(message: OpsRequest, session: OpsSession): Promise<void> {
    const selector = this.resolveSelector(session, message.payload, message);
    if (!selector) return;
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    const start = Date.now();
    await this.dom.hover(target.tabId, selector);
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
    const selector = typeof payload.ref === "string" ? this.resolveSelector(session, payload.ref, message) : null;
    if (payload.ref && !selector) return;
    const start = Date.now();
    await this.dom.press(target.tabId, selector, key);
    this.sendResponse(message, { timingMs: Date.now() - start });
  }

  private async handleCheck(message: OpsRequest, session: OpsSession, checked: boolean): Promise<void> {
    const selector = this.resolveSelector(session, message.payload, message);
    if (!selector) return;
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    const start = Date.now();
    await this.dom.setChecked(target.tabId, selector, checked);
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
    const selector = this.resolveSelector(session, ref, message);
    if (!selector) return;
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    const start = Date.now();
    await this.dom.type(target.tabId, selector, text, payload.clear === true, payload.submit === true);
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
    const selector = this.resolveSelector(session, ref, message);
    if (!selector) return;
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    await this.dom.select(target.tabId, selector, values as string[]);
    this.sendResponse(message, {});
  }

  private async handleScroll(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const dy = typeof payload.dy === "number" ? payload.dy : 0;
    const ref = typeof payload.ref === "string" ? payload.ref : undefined;
    const selector = ref ? this.resolveSelector(session, ref, message) ?? undefined : undefined;
    if (ref && !selector) return;
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    await this.dom.scroll(target.tabId, dy, selector);
    this.sendResponse(message, {});
  }

  private async handleScrollIntoView(message: OpsRequest, session: OpsSession): Promise<void> {
    const selector = this.resolveSelector(session, message.payload, message);
    if (!selector) return;
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    const start = Date.now();
    await this.dom.scrollIntoView(target.tabId, selector);
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
    const selector = this.resolveSelector(session, ref, message);
    if (!selector) return;
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    const html = await this.dom.getOuterHtml(target.tabId, selector);
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
    const selector = this.resolveSelector(session, ref, message);
    if (!selector) return;
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    const text = await this.dom.getInnerText(target.tabId, selector);
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
    const selector = this.resolveSelector(session, ref, message);
    if (!selector) return;
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    const value = await this.dom.getAttr(target.tabId, selector, name);
    this.sendResponse(message, { value });
  }

  private async handleDomGetValue(message: OpsRequest, session: OpsSession): Promise<void> {
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
    const value = await this.dom.getValue(target.tabId, selector);
    this.sendResponse(message, { value });
  }

  private async handleDomIsVisible(message: OpsRequest, session: OpsSession): Promise<void> {
    const selector = this.resolveSelector(session, message.payload, message);
    if (!selector) return;
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    const visible = await this.dom.isVisible(target.tabId, selector);
    this.sendResponse(message, { value: visible });
  }

  private async handleDomIsEnabled(message: OpsRequest, session: OpsSession): Promise<void> {
    const selector = this.resolveSelector(session, message.payload, message);
    if (!selector) return;
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    const enabled = await this.dom.isEnabled(target.tabId, selector);
    this.sendResponse(message, { value: enabled });
  }

  private async handleDomIsChecked(message: OpsRequest, session: OpsSession): Promise<void> {
    const selector = this.resolveSelector(session, message.payload, message);
    if (!selector) return;
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    const checked = await this.dom.isChecked(target.tabId, selector);
    this.sendResponse(message, { value: checked });
  }

  private async handleClonePage(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
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
    const result = await this.cdp.sendCommand({ tabId: target.tabId }, "Performance.getMetrics", {}) as { metrics?: Array<{ name: string; value: number }> };
    this.sendResponse(message, { metrics: Array.isArray(result.metrics) ? result.metrics : [] });
  }

  private async handleScreenshot(message: OpsRequest, session: OpsSession): Promise<void> {
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    try {
      const result = await withTimeout(
        this.cdp.sendCommand({ tabId: target.tabId }, "Page.captureScreenshot", { format: "png" }),
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
          { tabId: target.tabId },
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
        { tabId: target.tabId },
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

  private async enableSessionDomains(session: OpsSession): Promise<void> {
    try {
      await this.cdp.sendCommand({ tabId: session.tabId }, "Runtime.enable", {});
      await this.cdp.sendCommand({ tabId: session.tabId }, "Network.enable", {});
      await this.cdp.sendCommand({ tabId: session.tabId }, "Performance.enable", {});
    } catch (error) {
      logError("ops.enable_domains", error, { code: "enable_domains_failed" });
    }
  }

  private async withSession(message: OpsRequest, clientId: string, handler: (session: OpsSession) => Promise<void>): Promise<void> {
    const session = this.getSessionForMessage(message, clientId);
    if (!session) return;
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
    if (session.state === "closing") {
      const leaseId = typeof message.leaseId === "string" ? message.leaseId : "";
      if (leaseId && leaseId === session.leaseId) {
        this.reclaimSession(session, clientId);
      } else {
        this.sendError(message, buildError("not_owner", "Client does not own session", false));
        return null;
      }
    }
    if (session.ownerClientId !== clientId) {
      this.sendError(message, buildError("not_owner", "Client does not own session", false));
      return null;
    }
    if (typeof message.leaseId !== "string" || message.leaseId !== session.leaseId) {
      this.sendError(message, buildError("not_owner", "Lease does not match session owner", false));
      return null;
    }
    session.lastUsedAt = Date.now();
    return session;
  }

  private requestedTargetId(session: OpsSession, message: OpsRequest): string | null {
    const payload = isRecord(message.payload) ? message.payload : {};
    if (typeof payload.targetId === "string" && payload.targetId.trim().length > 0) {
      return payload.targetId.trim();
    }
    return session.activeTargetId || null;
  }

  private requireActiveTarget(session: OpsSession, message: OpsRequest): { tabId: number; targetId: string } | null {
    const targetId = this.requestedTargetId(session, message);
    if (!targetId) {
      this.sendError(message, buildError("invalid_request", "No active target", false));
      return null;
    }
    const target = session.targets.get(targetId);
    if (!target) {
      this.sendError(message, buildError("invalid_request", "Active target missing", false));
      return null;
    }
    if (target.url) {
      const restriction = isRestrictedUrl(target.url);
      if (restriction.restricted) {
        this.sendError(message, buildError("restricted_url", restriction.message ?? "Restricted tab.", false));
        return null;
      }
    }
    return { tabId: target.tabId, targetId: target.targetId };
  }

  private resolveSelector(session: OpsSession, refOrPayload: unknown, message: OpsRequest): string | null {
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
    const entry = session.refStore.resolve(targetId, ref);
    if (!entry) {
      this.sendError(message, buildError("invalid_request", `Unknown ref: ${ref}`, false));
      return null;
    }
    return entry.selector;
  }

  private async waitForSelector(tabId: number, selector: string, state: "attached" | "visible" | "hidden", timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const snapshot = await this.dom.getSelectorState(tabId, selector);
      if (state === "attached" && snapshot.attached) return;
      if (state === "visible" && snapshot.visible) return;
      if (state === "hidden" && (!snapshot.attached || !snapshot.visible)) return;
      await delay(200);
    }
    throw new Error("Wait for selector timed out");
  }

  private cleanupSession(session: OpsSession, event: OpsEvent["event"]): void {
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
    for (const target of session.targets.values()) {
      void this.cdp.detachTab(target.tabId).catch(() => undefined);
    }
    this.sendEvent({
      type: "ops_event",
      clientId: session.ownerClientId,
      opsSessionId: session.id,
      event,
      payload: { tabId: session.tabId, targetId: session.targetId }
    });
  }

  private handleClosedTarget(tabId: number, event: OpsEvent["event"]): void {
    const session = this.sessions.getByTabId(tabId);
    if (!session) return;
    const targetId = this.sessions.getTargetIdByTabId(session.id, tabId);
    if (!targetId) return;
    const removedTarget = this.sessions.removeTarget(session.id, targetId);
    if (!removedTarget) return;
    if (targetId === session.targetId || session.targets.size === 0) {
      this.cleanupSession(session, event);
    }
  }

  private handleDebuggerDetachForTab(tabId: number): void {
    const session = this.sessions.getByTabId(tabId);
    if (!session) return;
    if (tabId === session.tabId) {
      // Root tab detach can be transient during child-target shutdown; tab removal handler owns root teardown.
      return;
    }
    this.handleClosedTarget(tabId, "ops_session_closed");
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
      this.cleanupSession(session, event);
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

  private markSessionClosing(session: OpsSession, reason: OpsEvent["event"]): void {
    if (session.state === "closing") return;
    session.state = "closing";
    session.closingReason = reason;
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    const timeoutId = setTimeout(() => {
      this.closingTimers.delete(session.id);
      const current = this.sessions.get(session.id);
      if (current && current.state === "closing") {
        this.cleanupSession(current, "ops_session_expired");
      }
    }, SESSION_TTL_MS);
    this.closingTimers.set(session.id, timeoutId as unknown as number);
  }

  private reclaimSession(session: OpsSession, clientId: string): void {
    session.ownerClientId = clientId;
    session.state = "active";
    session.expiresAt = undefined;
    session.closingReason = undefined;
    this.clearClosingTimer(session.id);
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
