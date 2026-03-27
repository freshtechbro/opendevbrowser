import type { RelayCommand, RelayEvent, RelayResponse } from "../types.js";
import { TabManager } from "./TabManager.js";
import { TargetSessionMap, type TargetInfo, type DebuggerSession } from "./TargetSessionMap.js";
import { logError } from "../logging.js";
import { getRestrictionMessage } from "./url-restrictions.js";
import {
  handleSetDiscoverTargets,
  handleSetAutoAttach,
  handleCreateTarget,
  handleCloseTarget,
  handleActivateTarget,
  handleAttachToTarget,
  handleRoutedCommand,
  type AutoAttachOptions,
  type RouterCommandContext
} from "./cdp-router-commands.js";

type RelayCallbacks = {
  onEvent: (event: RelayEvent) => void;
  onResponse: (response: RelayResponse) => void;
  onDetach: (detail?: { tabId?: number; reason?: string }) => void;
  onPrimaryTabChange?: (tabId: number | null) => void;
};

export type CDPRouterEvent = {
  tabId: number;
  method: string;
  params?: unknown;
  sessionId?: string;
};

const FLAT_SESSION_ERROR = "Chrome 125+ required for extension relay (flat sessions).";
const DEPRECATED_SEND_MESSAGE = "Target.sendMessageToTarget is deprecated in flat session mode. Use sessionId routing.";
const DEFAULT_BROWSER_CONTEXT_ID = "default";
const DEFAULT_BROWSER_TARGET_ID = "browser";
const STALE_TAB_ERROR_MARKERS = [
  "No tab with given id",
  "Debugger is not attached to the tab"
];

export class CDPRouter {
  private readonly debuggees = new Map<number, chrome.debugger.Debuggee>();
  private readonly rootTargetTabIds = new Map<string, number>();
  private readonly sessions = new TargetSessionMap();
  private readonly tabManager = new TabManager();
  private readonly rootAttachedSessions = new Set<string>();
  private readonly eventListeners = new Set<(event: CDPRouterEvent) => void>();
  private callbacks: RelayCallbacks | null = null;
  private autoAttachOptions: AutoAttachOptions = { autoAttach: false, waitForDebuggerOnStart: false, flatten: true };
  private discoverTargets = false;
  private listenersActive = false;
  private flatSessionValidated = false;
  private primaryTabId: number | null = null;
  private lastActiveTabId: number | null = null;
  private sessionCounter = 1;
  private readonly quarantinedSessions = new Map<string, { tabId: number; count: number; lastSeen: number }>();
  private readonly churnTracker = new Map<number, { count: number; resetAt: number }>();
  private readonly churnWindowMs = 5000;
  private readonly churnThreshold = 3;
  private clientResetPending = false;
  private handleEventBound = (source: chrome.debugger.Debuggee, method: string, params?: object) => {
    this.handleEvent(source, method, params);
  };
  private handleDetachBound = (source: chrome.debugger.Debuggee, reason?: string) => {
    this.handleDetach(source, reason);
  };

  setCallbacks(callbacks: RelayCallbacks): void {
    this.callbacks = callbacks;
  }

  addEventListener(listener: (event: CDPRouterEvent) => void): void {
    this.eventListeners.add(listener);
  }

  removeEventListener(listener: (event: CDPRouterEvent) => void): void {
    this.eventListeners.delete(listener);
  }

  async setDiscoverTargetsEnabled(discover: boolean): Promise<void> {
    const shouldEmit = discover && !this.discoverTargets;
    this.discoverTargets = discover;
    for (const debuggee of this.debuggees.values()) {
      await this.applyDiscoverTargets(debuggee, discover);
    }
    if (!shouldEmit) {
      return;
    }
    for (const targetInfo of this.sessions.listTargetInfos()) {
      const tabId = this.sessions.getByTargetId(targetInfo.targetId)?.tabId
        ?? this.rootTargetTabIds.get(targetInfo.targetId)
        ?? this.primaryTabId;
      if (typeof tabId === "number") {
        this.emitTargetCreated(tabId, targetInfo);
      }
    }
  }

  async configureAutoAttach(options: AutoAttachOptions): Promise<void> {
    if (options.flatten === false) {
      throw new Error(FLAT_SESSION_ERROR);
    }
    this.autoAttachOptions = { ...options, flatten: true };
    if (this.autoAttachOptions.autoAttach) {
      this.resetRootAttached();
    }
    for (const debuggee of this.debuggees.values()) {
      await this.applyAutoAttach(debuggee);
    }
    if (!this.autoAttachOptions.autoAttach) {
      this.emitRootDetached();
      return;
    }
    for (const tabId of this.sessions.listTabIds()) {
      await this.refreshRootTargetInfo(tabId);
    }
    for (const targetInfo of this.sessions.listTargetInfos()) {
      this.emitRootAttached(targetInfo);
    }
  }

  async attach(tabId: number): Promise<void> {
    await this.attachInternal(tabId, true);
  }

  private async attachInternal(tabId: number, allowRetry: boolean): Promise<void> {
    if (this.debuggees.has(tabId)) {
      this.updatePrimaryTab(tabId);
      await this.pruneRootDebuggees(tabId);
      return;
    }

    const debuggee = await this.resolveRootDebuggee(tabId);
    this.debuggees.set(tabId, debuggee);
    this.ensureListeners();

    try {
      await this.runDebuggerAction((done) => {
        chrome.debugger.attach(this.toChromeDebuggee(debuggee), "1.3", done);
      });
      await this.ensureFlatSessionSupport(debuggee);
      const targetInfo = await this.registerRootTab(tabId);

      if (this.discoverTargets) {
        await this.applyDiscoverTargets(debuggee, true);
        this.emitTargetCreated(tabId, targetInfo);
      }

      if (this.autoAttachOptions.autoAttach) {
        await this.applyAutoAttach(debuggee);
        this.emitRootAttached(targetInfo);
      }

      this.updatePrimaryTab(tabId);
      await this.pruneRootDebuggees(tabId);
    } catch (error) {
      this.debuggees.delete(tabId);
      if (typeof debuggee.targetId === "string") {
        this.rootTargetTabIds.delete(debuggee.targetId);
      }
      if (this.debuggees.size === 0) {
        this.removeListeners();
      }
      await this.safeDetach(debuggee);
      if (allowRetry && this.isStaleTabError(error)) {
        const attemptedTabIds = new Set<number>([tabId]);
        let lastStaleError: unknown = error;
        const activeTabId = await this.tabManager.getActiveTabId();
        if (activeTabId && !attemptedTabIds.has(activeTabId)) {
          attemptedTabIds.add(activeTabId);
          try {
            return await this.attachInternal(activeTabId, false);
          } catch (candidateError) {
            if (!this.isStaleTabError(candidateError)) {
              throw candidateError;
            }
            lastStaleError = candidateError;
          }
        }
        const fallbackTabId = await this.tabManager.getFirstHttpTabId();
        if (fallbackTabId && !attemptedTabIds.has(fallbackTabId)) {
          attemptedTabIds.add(fallbackTabId);
          try {
            return await this.attachInternal(fallbackTabId, false);
          } catch (candidateError) {
            if (!this.isStaleTabError(candidateError)) {
              throw candidateError;
            }
            lastStaleError = candidateError;
          }
        }
        try {
          const createdTab = await this.tabManager.createTab("about:blank", true);
          if (typeof createdTab.id === "number" && !attemptedTabIds.has(createdTab.id)) {
            return await this.attachInternal(createdTab.id, false);
          }
        } catch (candidateError) {
          if (!this.isStaleTabError(candidateError)) {
            throw candidateError;
          }
          lastStaleError = candidateError;
        }
        throw lastStaleError;
      }
      throw error;
    }
  }

  async detachAll(): Promise<void> {
    const entries = Array.from(this.debuggees.entries());
    this.debuggees.clear();
    this.removeListeners();

    for (const [tabId, debuggee] of entries) {
      this.detachTabState(tabId);
      await this.safeDetach(debuggee);
    }

    this.primaryTabId = null;
    this.lastActiveTabId = null;
    this.callbacks?.onDetach({ reason: "manual_disconnect" });
  }

  async detachTab(tabId: number): Promise<void> {
    const debuggee = this.debuggees.get(tabId);
    if (!debuggee) {
      return;
    }
    this.debuggees.delete(tabId);
    this.detachTabState(tabId);
    await this.safeDetach(debuggee);
    if (this.debuggees.size === 0) {
      this.removeListeners();
      this.primaryTabId = null;
      this.lastActiveTabId = null;
    } else if (this.primaryTabId === tabId) {
      this.updatePrimaryTab(this.selectFallbackPrimary());
    }
    this.callbacks?.onDetach({ tabId, reason: "manual_disconnect" });
  }

  getPrimaryTabId(): number | null {
    return this.primaryTabId;
  }

  getAttachedTabIds(): number[] {
    return Array.from(this.debuggees.keys());
  }

  async handleCommand(command: RelayCommand): Promise<void> {
    await this.prepareForNextClientIfNeeded();
    if (!this.callbacks) return;
    if (this.debuggees.size === 0) {
      this.respondError(command.id, "No tab attached");
      return;
    }

    const { method, params, sessionId } = command.params;
    const commandParams = isRecord(params) ? params : {};
    const ctx = this.buildCommandContext();

    switch (method) {
      case "Browser.getVersion": {
        const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "OpenDevBrowser Relay";
        this.respond(command.id, {
          protocolVersion: "1.3",
          product: "Chrome",
          revision: "",
          userAgent,
          jsVersion: ""
        });
        return;
      }
      case "Browser.setDownloadBehavior":
        this.respond(command.id, {});
        return;
      case "Target.getBrowserContexts":
        this.respond(command.id, { browserContextIds: [DEFAULT_BROWSER_CONTEXT_ID] });
        return;
      case "Target.attachToBrowserTarget": {
        const rootSession = await this.ensureRootSessionForPrimary();
        if (!rootSession) {
          this.respondError(command.id, "No tab attached");
          return;
        }
        const browserSessionId = await this.ensureBrowserSession(rootSession.tabId);
        this.respond(command.id, { sessionId: browserSessionId ?? rootSession.sessionId });
        return;
      }
      case "Target.sendMessageToTarget":
        this.respondError(command.id, DEPRECATED_SEND_MESSAGE);
        return;
      case "Target.setDiscoverTargets":
        await handleSetDiscoverTargets(ctx, command.id, commandParams);
        return;
      case "Target.getTargets":
        this.respond(command.id, { targetInfos: this.sessions.listTargetInfos() });
        return;
      case "Target.getTargetInfo": {
        const targetId = typeof commandParams.targetId === "string" ? commandParams.targetId : "";
        const targetInfo = this.resolveTargetInfo(targetId, sessionId);
        this.respond(command.id, { targetInfo });
        return;
      }
      case "Target.setAutoAttach":
        await handleSetAutoAttach(ctx, command.id, commandParams, sessionId);
        return;
      case "Target.createTarget":
        await handleCreateTarget(ctx, command.id, commandParams);
        return;
      case "Target.closeTarget":
        await handleCloseTarget(ctx, command.id, commandParams);
        return;
      case "Target.activateTarget":
        await handleActivateTarget(ctx, command.id, commandParams);
        return;
      case "Target.attachToTarget":
        await handleAttachToTarget(ctx, command.id, commandParams, sessionId);
        return;
      default:
        await handleRoutedCommand(ctx, command.id, method, commandParams, sessionId);
    }
  }

  markClientClosed(): void {
    this.clientResetPending = true;
  }

  private buildCommandContext(): RouterCommandContext {
    return {
      debuggees: this.debuggees,
      sessions: this.sessions,
      tabManager: this.tabManager,
      autoAttachOptions: this.autoAttachOptions,
      discoverTargets: this.discoverTargets,
      flatSessionError: FLAT_SESSION_ERROR,
      setAutoAttachOptions: (next) => {
        this.autoAttachOptions = next;
      },
      setDiscoverTargets: (value) => {
        this.discoverTargets = value;
      },
      applyDiscoverTargets: this.applyDiscoverTargets.bind(this),
      respond: this.respond.bind(this),
      respondError: this.respondError.bind(this),
      emitEvent: (method, params, sessionId) => {
        const tabId = sessionId
          ? this.sessions.getBySessionId(sessionId)?.tabId ?? this.primaryTabId
          : this.primaryTabId;
        if (typeof tabId === "number") {
          this.emitEvent(tabId, method, params, sessionId);
        }
      },
      emitTargetCreated: (targetInfo) => {
        const tabId = this.sessions.getByTargetId(targetInfo.targetId)?.tabId
          ?? this.rootTargetTabIds.get(targetInfo.targetId)
          ?? this.primaryTabId;
        if (typeof tabId === "number") {
          this.emitTargetCreated(tabId, targetInfo);
        }
      },
      emitRootAttached: this.emitRootAttached.bind(this),
      emitRootDetached: this.emitRootDetached.bind(this),
      resetRootAttached: this.resetRootAttached.bind(this),
      updatePrimaryTab: this.updatePrimaryTab.bind(this),
      detachTabState: this.detachTabState.bind(this),
      safeDetach: this.safeDetach.bind(this),
      attach: this.attach.bind(this),
      registerRootTab: this.registerRootTab.bind(this),
      refreshRootTargetInfo: this.refreshRootTargetInfo.bind(this),
      applyAutoAttach: this.applyAutoAttach.bind(this),
      sendCommand: this.sendCommand.bind(this),
      getPrimaryDebuggee: this.getPrimaryDebuggee.bind(this),
      resolveCommandDebuggee: this.resolveCommandDebuggee.bind(this)
    };
  }

  private async registerRootTab(tabId: number): Promise<TargetInfo> {
    const existing = this.sessions.getByTabId(tabId);
    const sessionId = existing?.rootSessionId ?? this.createRootSessionId();
    const targetInfo = await this.buildTargetInfo(tabId);
    const debuggerSession = await this.resolveRootSessionDebuggee(tabId);
    this.sessions.registerRootTab(tabId, targetInfo, sessionId, debuggerSession.targetId, debuggerSession);
    return targetInfo;
  }

  private async refreshRootTargetInfo(tabId: number): Promise<TargetInfo> {
    const existing = this.sessions.getByTabId(tabId);
    const sessionId = existing?.rootSessionId ?? this.createRootSessionId();
    const targetInfo = await this.buildTargetInfo(tabId);
    const debuggerSession = await this.resolveRootSessionDebuggee(tabId);
    const rootFrame = await this.readRootFrameInfo(tabId);
    const refreshed: TargetInfo = rootFrame
      ? {
        ...targetInfo,
        targetId: rootFrame.id,
        ...(rootFrame.url ? { url: rootFrame.url } : {})
      }
      : targetInfo;
    this.sessions.registerRootTab(tabId, refreshed, sessionId, debuggerSession.targetId, debuggerSession);
    return refreshed;
  }

  private async prepareForNextClientIfNeeded(): Promise<void> {
    if (!this.clientResetPending) {
      return;
    }

    const preferredTabId = await this.resolvePreferredResetTabId();
    this.clientResetPending = false;
    this.autoAttachOptions = { autoAttach: false, waitForDebuggerOnStart: false, flatten: true };
    this.discoverTargets = false;
    this.rootAttachedSessions.clear();
    this.quarantinedSessions.clear();
    this.churnTracker.clear();
    this.sessions.reset();

    for (const [tabId, debuggee] of Array.from(this.debuggees.entries())) {
      if (preferredTabId !== null && tabId === preferredTabId) {
        continue;
      }
      this.debuggees.delete(tabId);
      await this.safeDetach(debuggee);
    }

    if (preferredTabId === null) {
      this.primaryTabId = null;
      this.lastActiveTabId = null;
      if (this.debuggees.size === 0) {
        this.removeListeners();
      }
      return;
    }

    const attachedPrimary = this.debuggees.get(preferredTabId);
    if (attachedPrimary) {
      this.updatePrimaryTab(preferredTabId);
      await this.registerRootTab(preferredTabId);
      const refreshedRoot = this.sessions.getByTabId(preferredTabId);
      const refreshedSession = refreshedRoot
        ? this.sessions.getBySessionId(refreshedRoot.rootSessionId)
        : null;
      if (refreshedSession) {
        this.debuggees.set(preferredTabId, refreshedSession.debuggerSession);
      }
      return;
    }

    await this.attachInternal(preferredTabId, true);
  }

  private async resolvePreferredResetTabId(): Promise<number | null> {
    const candidateTabIds: number[] = [];
    const pushCandidate = (tabId: number | null) => {
      if (typeof tabId === "number" && !candidateTabIds.includes(tabId)) {
        candidateTabIds.push(tabId);
      }
    };

    pushCandidate(this.lastActiveTabId);
    pushCandidate(this.primaryTabId);
    pushCandidate(await this.tabManager.getActiveTabId());

    for (const tabId of candidateTabIds) {
      if (await this.isUsableResetTab(tabId)) {
        return tabId;
      }
    }

    const firstHttpTabId = await this.tabManager.getFirstHttpTabId();
    if (firstHttpTabId !== null) {
      return firstHttpTabId;
    }

    for (const tabId of candidateTabIds) {
      if (this.debuggees.has(tabId)) {
        return tabId;
      }
      const tab = await this.tabManager.getTab(tabId);
      if (tab) {
        return tabId;
      }
    }

    const [firstAttachedTabId] = this.debuggees.keys();
    return typeof firstAttachedTabId === "number" ? firstAttachedTabId : null;
  }

  private async isUsableResetTab(tabId: number): Promise<boolean> {
    const tab = await this.tabManager.getTab(tabId);
    if (!tab?.url) {
      return false;
    }
    try {
      return getRestrictionMessage(new URL(tab.url)) === null;
    } catch {
      return false;
    }
  }

  private updatePrimaryTab(tabId: number | null): void {
    if (tabId === this.primaryTabId) return;
    this.primaryTabId = tabId;
    if (tabId !== null) {
      this.lastActiveTabId = tabId;
    }
    this.callbacks?.onPrimaryTabChange?.(tabId);
  }

  private async pruneRootDebuggees(primaryTabId: number): Promise<void> {
    const staleTabIds = Array.from(this.debuggees.keys()).filter((tabId) => tabId !== primaryTabId);
    for (const staleTabId of staleTabIds) {
      const debuggee = this.debuggees.get(staleTabId);
      if (!debuggee) {
        continue;
      }
      this.debuggees.delete(staleTabId);
      this.detachTabState(staleTabId);
      await this.safeDetach(debuggee);
    }
  }

  private selectFallbackPrimary(): number | null {
    if (this.lastActiveTabId && this.debuggees.has(this.lastActiveTabId)) {
      return this.lastActiveTabId;
    }
    const [first] = this.debuggees.keys();
    return first ?? null;
  }

  private getPrimaryDebuggee(): DebuggerSession | null {
    if (this.primaryTabId !== null) {
      const primary = this.debuggees.get(this.primaryTabId);
      if (primary) {
        return primary;
      }
    }
    const [first] = this.debuggees.values();
    return first ?? null;
  }

  private async resolveCommandDebuggee(sessionId?: string): Promise<DebuggerSession | null> {
    if (!sessionId) {
      return this.getPrimaryDebuggee();
    }
    const session = this.sessions.getBySessionId(sessionId);
    if (!session) {
      return null;
    }
    if (session.kind !== "root") {
      return session.debuggerSession;
    }
    if (typeof session.debuggerSession.targetId === "string" && session.debuggerSession.targetId.length > 0) {
      return session.debuggerSession;
    }
    const attached = await this.ensureAttachedRootSession(session.tabId);
    return attached ?? session.debuggerSession;
  }

  private async ensureRootSessionForPrimary(): Promise<{ tabId: number; sessionId: string; targetInfo: TargetInfo } | null> {
    const tabId = this.primaryTabId ?? this.resolveSourceTabId(this.getPrimaryDebuggee() ?? {});
    if (typeof tabId !== "number") {
      return null;
    }
    const existing = this.sessions.getByTabId(tabId);
    if (existing) {
      return { tabId, sessionId: existing.rootSessionId, targetInfo: existing.targetInfo };
    }
    const targetInfo = await this.registerRootTab(tabId);
    const refreshed = this.sessions.getByTabId(tabId);
    if (!refreshed) {
      return null;
    }
    return { tabId, sessionId: refreshed.rootSessionId, targetInfo: targetInfo ?? refreshed.targetInfo };
  }

  private async ensureAttachedRootSession(tabId: number): Promise<DebuggerSession | null> {
    const existing = this.sessions.getAttachedRootSession(tabId);
    if (existing) {
      return existing.debuggerSession;
    }

    const record = this.sessions.getByTabId(tabId);
    if (!record) {
      return null;
    }

    let attachTargetId = record.attachTargetId ?? null;
    if (!attachTargetId) {
      attachTargetId = await this.readDebuggerTargetId(tabId) ?? await this.readAttachTargetId(tabId, record.targetInfo);
      if (!attachTargetId) {
        return null;
      }
      this.sessions.setRootAttachTargetId(tabId, attachTargetId);
    }

    try {
      const attached = await this.sendCommand({ tabId }, "Target.attachToTarget", {
        targetId: attachTargetId,
        flatten: true
      });
      if (!isRecord(attached) || typeof attached.sessionId !== "string") {
        return null;
      }
      const attachedRecord = this.sessions.registerAttachedRootSession(tabId, attached.sessionId);
      return attachedRecord?.debuggerSession ?? null;
    } catch {
      return null;
    }
  }

  private async readAttachTargetId(tabId: number, rootTargetInfo: TargetInfo): Promise<string | null> {
    try {
      const result = await this.sendCommand({ tabId }, "Target.getTargets", {});
      if (!isRecord(result) || !Array.isArray(result.targetInfos)) {
        return null;
      }
      const pageTargets = result.targetInfos.filter(isTargetInfo).filter((target) => target.type === "page");
      if (pageTargets.length === 0) {
        return null;
      }
      const tab = await this.tabManager.getTab(tabId);
      const preferredUrl = typeof rootTargetInfo.url === "string" && rootTargetInfo.url.length > 0
        ? rootTargetInfo.url
        : (typeof tab?.url === "string" ? tab.url : undefined);
      const preferredTitle = typeof rootTargetInfo.title === "string" && rootTargetInfo.title.length > 0
        ? rootTargetInfo.title
        : (typeof tab?.title === "string" ? tab.title : undefined);
      const byUrl = preferredUrl
        ? pageTargets.find((target) => target.url === preferredUrl)
        : null;
      const byTitle = preferredTitle
        ? pageTargets.find((target) => target.title === preferredTitle)
        : null;
      return byUrl?.targetId ?? byTitle?.targetId ?? pageTargets[0]?.targetId ?? null;
    } catch {
      return null;
    }
  }

  private async resolveRootSessionDebuggee(tabId: number): Promise<DebuggerSession> {
    const existing = this.sessions.getByTabId(tabId);
    const existingSession = existing ? this.sessions.getBySessionId(existing.rootSessionId) : null;
    if (existingSession?.debuggerSession?.targetId) {
      return existingSession.debuggerSession;
    }
    return await this.resolveRootDebuggee(tabId);
  }

  private async resolveRootDebuggee(tabId: number): Promise<DebuggerSession> {
    const attachTargetId = await this.readDebuggerTargetId(tabId);
    if (attachTargetId) {
      this.rootTargetTabIds.set(attachTargetId, tabId);
      return { tabId, targetId: attachTargetId };
    }
    return { tabId };
  }

  private async readDebuggerTargetId(tabId: number): Promise<string | null> {
    const tab = await this.tabManager.getTab(tabId);
    const targets = await new Promise<chrome.debugger.TargetInfo[]>((resolve) => {
      chrome.debugger.getTargets((records) => {
        const lastError = chrome.runtime.lastError;
        if (lastError || !Array.isArray(records)) {
          resolve([]);
          return;
        }
        resolve(records);
      });
    });
    const pageTargets = targets.filter((target) => target.tabId === tabId && target.type === "page");
    if (pageTargets.length === 0) {
      return null;
    }
    const preferredByUrl = typeof tab?.url === "string"
      ? pageTargets.find((target) => target.url === tab.url)
      : null;
    const preferredByTitle = typeof tab?.title === "string"
      ? pageTargets.find((target) => target.title === tab.title)
      : null;
    return preferredByUrl?.id ?? preferredByTitle?.id ?? pageTargets[0]?.id ?? null;
  }

  private resolveTargetInfo(targetId: string, sessionId?: string): TargetInfo | null {
    if (targetId) {
      const record = this.sessions.getByTargetId(targetId);
      return record?.targetInfo
        ?? (record?.kind === "root" ? this.sessions.getByTabId(record.tabId)?.targetInfo ?? null : null);
    }

    if (sessionId) {
      const session = this.sessions.getBySessionId(sessionId);
      return session?.targetInfo
        ?? (session?.kind === "root" ? this.sessions.getByTabId(session.tabId)?.targetInfo ?? null : null);
    }

    return {
      targetId: DEFAULT_BROWSER_TARGET_ID,
      type: "browser",
      title: "OpenDevBrowser Relay",
      url: ""
    };
  }

  private ensureListeners(): void {
    if (this.listenersActive) return;
    chrome.debugger.onEvent.addListener(this.handleEventBound);
    chrome.debugger.onDetach.addListener(this.handleDetachBound);
    this.listenersActive = true;
  }

  private removeListeners(): void {
    if (!this.listenersActive) return;
    chrome.debugger.onEvent.removeListener(this.handleEventBound);
    chrome.debugger.onDetach.removeListener(this.handleDetachBound);
    this.listenersActive = false;
  }

  private async ensureFlatSessionSupport(debuggee: chrome.debugger.Debuggee): Promise<void> {
    if (this.flatSessionValidated) return;
    try {
      await this.sendCommand(debuggee, "Target.setAutoAttach", {
        autoAttach: false,
        waitForDebuggerOnStart: false,
        flatten: true
      });
      this.flatSessionValidated = true;
    } catch (error) {
      const detail = getErrorMessage(error);
      console.warn(`[opendevbrowser] Target.setAutoAttach(flatten) failed: ${detail}`);
      throw new Error(`${FLAT_SESSION_ERROR} (${detail})`);
    }
  }

  private async applyDiscoverTargets(debuggee: DebuggerSession, discover: boolean): Promise<void> {
    await this.sendCommand(debuggee, "Target.setDiscoverTargets", { discover });
  }

  private async applyAutoAttach(debuggee: chrome.debugger.Debuggee): Promise<void> {
    const params: Record<string, unknown> = {
      autoAttach: this.autoAttachOptions.autoAttach,
      waitForDebuggerOnStart: this.autoAttachOptions.waitForDebuggerOnStart,
      flatten: true
    };
    if (typeof this.autoAttachOptions.filter !== "undefined") {
      params.filter = this.autoAttachOptions.filter;
    }
    try {
      await this.sendCommand(debuggee, "Target.setAutoAttach", params);
    } catch (error) {
      const detail = getErrorMessage(error);
      console.warn(`[opendevbrowser] Target.setAutoAttach failed: ${detail}`);
      throw new Error(`${FLAT_SESSION_ERROR} (${detail})`);
    }
  }

  private async applyAutoAttachToChild(tabId: number, sessionId: string): Promise<void> {
    if (!this.autoAttachOptions.autoAttach) return;
    const params: Record<string, unknown> = {
      autoAttach: true,
      waitForDebuggerOnStart: this.autoAttachOptions.waitForDebuggerOnStart,
      flatten: true
    };
    if (typeof this.autoAttachOptions.filter !== "undefined") {
      params.filter = this.autoAttachOptions.filter;
    }
    await this.sendCommand({ tabId, sessionId }, "Target.setAutoAttach", params);
  }

  private recordSessionChurn(tabId: number, sessionId: string, reason: string): void {
    const now = Date.now();
    const existing = this.churnTracker.get(tabId);
    const record = !existing || now > existing.resetAt
      ? { count: 0, resetAt: now + this.churnWindowMs }
      : existing;
    record.count += 1;
    this.churnTracker.set(tabId, record);

    const quarantined = this.quarantinedSessions.get(sessionId);
    if (!quarantined) {
      this.quarantinedSessions.set(sessionId, { tabId, count: 1, lastSeen: now });
    }

    if (record.count >= this.churnThreshold) {
      this.churnTracker.delete(tabId);
      this.reapplyAutoAttach(tabId, reason).catch((error) => {
        logError("cdp.reapply_auto_attach", error, { code: "auto_attach_failed" });
      });
    }
  }

  private quarantineUnknownSession(tabId: number, sessionId: string, method: string): void {
    const now = Date.now();
    const existing = this.quarantinedSessions.get(sessionId);
    if (existing) {
      existing.count += 1;
      existing.lastSeen = now;
      return;
    }
    this.quarantinedSessions.set(sessionId, { tabId, count: 1, lastSeen: now });
    this.recordSessionChurn(tabId, sessionId, `unknown_${method}`);
  }

  private async reapplyAutoAttach(tabId: number, reason: string): Promise<void> {
    if (!this.autoAttachOptions.autoAttach) return;
    const debuggee = this.debuggees.get(tabId);
    if (!debuggee) return;
    try {
      await this.applyAutoAttach(debuggee);
    } catch (error) {
      const detail = getErrorMessage(error);
      console.warn(`[opendevbrowser] Auto-attach retry failed (${reason}): ${detail}`);
    }
  }

  private handleEvent(source: chrome.debugger.Debuggee, method: string, params?: object): void {
    if (!this.callbacks) return;
    const tabId = this.resolveSourceTabId(source);
    if (tabId === null || !this.debuggees.has(tabId)) return;
    if (method === "Target.receivedMessageFromTarget") return;

    if (method === "Target.attachedToTarget" && params && isRecord(params)) {
      const sessionId = typeof params.sessionId === "string" ? params.sessionId : null;
      const targetInfo = isTargetInfo(params.targetInfo) ? params.targetInfo : null;
      if (sessionId && targetInfo) {
        if (this.isAttachedRootTarget(tabId, targetInfo)) {
          this.sessions.setRootAttachTargetId(tabId, targetInfo.targetId);
          this.sessions.registerAttachedRootSession(tabId, sessionId);
        } else {
          this.sessions.registerChildSession(tabId, targetInfo, sessionId);
        }
        this.quarantinedSessions.delete(sessionId);
        this.applyAutoAttachToChild(tabId, sessionId).catch((error) => {
          logError("cdp.apply_auto_attach_child", error, { code: "auto_attach_failed" });
        });
      } else if (sessionId) {
        this.recordSessionChurn(tabId, sessionId, "attach_missing_target");
      }
    }

    if (method === "Target.detachedFromTarget" && params && isRecord(params)) {
      const detachedSessionId = typeof params.sessionId === "string" ? params.sessionId : null;
      if (detachedSessionId) {
        const removed = this.sessions.removeBySessionId(detachedSessionId);
        if (!removed) {
          this.recordSessionChurn(tabId, detachedSessionId, "detach_unknown");
          this.quarantineUnknownSession(tabId, detachedSessionId, method);
          return;
        }
      }
    }

    const sourceSessionId = (source as { sessionId?: string }).sessionId;
    if (typeof sourceSessionId === "string" && !this.sessions.hasSession(sourceSessionId)) {
      this.quarantineUnknownSession(tabId, sourceSessionId, method);
      return;
    }

    const forwardSessionId = this.resolveForwardSessionId(method, source);
    this.emitEvent(tabId, method, params, forwardSessionId);
  }

  private handleDetach(source: chrome.debugger.Debuggee, reason?: string): void {
    const tabId = this.resolveSourceTabId(source);
    if (tabId === null || !this.debuggees.has(tabId)) return;
    this.debuggees.delete(tabId);
    this.detachTabState(tabId);

    if (this.debuggees.size === 0) {
      this.removeListeners();
      this.callbacks?.onDetach({ tabId, reason });
    }
  }

  private detachTabState(tabId: number): void {
    const record = this.sessions.removeByTabId(tabId);
    if (record) {
      if (record.attachTargetId) {
        this.rootTargetTabIds.delete(record.attachTargetId);
      }
      this.rootAttachedSessions.delete(record.rootSessionId);
      if (this.autoAttachOptions.autoAttach) {
        this.emitTargetDetached(record.tabId, record.rootSessionId, record.targetInfo.targetId);
      }
      if (this.discoverTargets) {
        this.emitTargetDestroyed(record.tabId, record.targetInfo.targetId);
      }
    }

    if (tabId === this.primaryTabId) {
      const next = this.selectFallbackPrimary();
      this.updatePrimaryTab(next);
    }
  }

  private resolveForwardSessionId(method: string, source: chrome.debugger.Debuggee): string | undefined {
    if (method === "Target.attachedToTarget" || method === "Target.detachedFromTarget") {
      return undefined;
    }
    const sessionId = (source as { sessionId?: string }).sessionId;
    if (typeof sessionId === "string") {
      return this.sessions.getBySessionId(sessionId) ? sessionId : undefined;
    }
    const tabId = this.resolveSourceTabId(source);
    if (tabId === null) return undefined;
    const record = this.sessions.getByTabId(tabId);
    if (!record) return undefined;
    const browserSession = this.sessions.getBrowserSession(tabId);
    if (browserSession) {
      return browserSession.sessionId;
    }
    return this.rootAttachedSessions.has(record.rootSessionId) ? record.rootSessionId : undefined;
  }

  private resolveSourceTabId(source: chrome.debugger.Debuggee): number | null {
    if (typeof source.tabId === "number") {
      return source.tabId;
    }
    if (typeof source.targetId === "string") {
      return this.rootTargetTabIds.get(source.targetId) ?? null;
    }
    return null;
  }

  private isAttachedRootTarget(tabId: number, targetInfo: TargetInfo): boolean {
    if (targetInfo.type !== "page") {
      return false;
    }
    const record = this.sessions.getByTabId(tabId);
    if (!record) {
      return false;
    }
    if (record.attachTargetId && targetInfo.targetId === record.attachTargetId) {
      return true;
    }
    if (targetInfo.targetId === record.targetInfo.targetId) {
      return true;
    }
    if (record.targetInfo.url && targetInfo.url === record.targetInfo.url) {
      return true;
    }
    if (record.targetInfo.title && targetInfo.title === record.targetInfo.title) {
      return true;
    }
    return false;
  }

  private async buildTargetInfo(tabId: number): Promise<TargetInfo> {
    const tab = await this.tabManager.getTab(tabId);
    return {
      targetId: `tab-${tabId}`,
      type: "page",
      browserContextId: DEFAULT_BROWSER_CONTEXT_ID,
      title: tab?.title ?? undefined,
      url: tab?.url ?? undefined
    };
  }

  private async readRootFrameInfo(tabId: number): Promise<{ id: string; url?: string } | null> {
    try {
      const result = await Promise.race([
        this.sendCommand({ tabId }, "Page.getFrameTree", {}),
        new Promise<null>((resolve) => {
          setTimeout(() => resolve(null), 750);
        })
      ]);
      const rootFrame = readRootFrame(result);
      if (!rootFrame) {
        return null;
      }
      return rootFrame;
    } catch {
      return null;
    }
  }

  private emitTargetCreated(tabId: number, targetInfo: TargetInfo): void {
    this.emitEvent(tabId, "Target.targetCreated", { targetInfo });
  }

  private emitTargetDestroyed(tabId: number, targetId: string): void {
    this.emitEvent(tabId, "Target.targetDestroyed", { targetId });
  }

  private emitTargetDetached(tabId: number, sessionId: string, targetId: string): void {
    this.emitEvent(tabId, "Target.detachedFromTarget", { sessionId, targetId });
  }

  private emitRootAttached(targetInfo: TargetInfo): void {
    const record = this.sessions.getByTargetId(targetInfo.targetId);
    if (!record || record.kind !== "root") return;
    if (this.rootAttachedSessions.has(record.sessionId)) return;
    this.rootAttachedSessions.add(record.sessionId);
    this.emitEvent(record.tabId, "Target.attachedToTarget", {
      sessionId: record.sessionId,
      targetInfo,
      waitingForDebugger: false
    });
  }

  private emitRootDetached(): void {
    for (const targetInfo of this.sessions.listTargetInfos()) {
      const record = this.sessions.getByTargetId(targetInfo.targetId);
      if (!record || record.kind !== "root") continue;
      if (!this.rootAttachedSessions.has(record.sessionId)) continue;
      this.rootAttachedSessions.delete(record.sessionId);
      this.emitTargetDetached(record.tabId, record.sessionId, targetInfo.targetId);
    }
  }

  private resetRootAttached(): void {
    this.rootAttachedSessions.clear();
  }

  private createRootSessionId(): string {
    const sessionId = `pw-tab-${this.sessionCounter}`;
    this.sessionCounter += 1;
    return sessionId;
  }

  private createBrowserSessionId(): string {
    const sessionId = `pw-browser-${this.sessionCounter}`;
    this.sessionCounter += 1;
    return sessionId;
  }

  private async ensureBrowserSession(tabId: number): Promise<string | null> {
    const existing = this.sessions.getBrowserSession(tabId);
    if (existing) {
      return existing.sessionId;
    }
    const browserSessionId = this.createBrowserSessionId();
    return this.sessions.registerBrowserSession(tabId, browserSessionId)?.sessionId ?? null;
  }

  async sendCommand(debuggee: DebuggerSession, method: string, params: Record<string, unknown>): Promise<unknown> {
    try {
      return await this.sendCommandOnce(debuggee, method, params);
    } catch (error) {
      const hasChildSession = typeof (debuggee as { sessionId?: unknown }).sessionId === "string";
      if (!this.isStaleTabError(error) || hasChildSession) {
        throw error;
      }

      const recovered = await this.recoverFromStaleTab(debuggee);
      if (!recovered) {
        throw error;
      }
      return await this.sendCommandOnce(recovered, method, params);
    }
  }

  private async sendCommandOnce(debuggee: DebuggerSession, method: string, params: Record<string, unknown>): Promise<unknown> {
    const chromeDebuggee = this.toChromeDebuggee(debuggee);
    const sendCommandFn = chrome.debugger.sendCommand as unknown as { mock?: unknown };
    if (!("mock" in sendCommandFn) || chrome.debugger.sendCommand.length < 4) {
      return await (chrome.debugger.sendCommand as unknown as (
        debuggee: chrome.debugger.Debuggee,
        method: string,
        commandParams?: Record<string, unknown>
      ) => Promise<unknown>)(chromeDebuggee, method, params);
    }
    return await new Promise((resolve, reject) => {
      chrome.debugger.sendCommand(chromeDebuggee, method, params, (result) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        resolve(result);
      });
    });
  }

  private async recoverFromStaleTab(debuggee: DebuggerSession): Promise<DebuggerSession | null> {
    const staleTabId = typeof debuggee.tabId === "number"
      ? debuggee.tabId
      : (typeof debuggee.targetId === "string" ? this.rootTargetTabIds.get(debuggee.targetId) ?? null : null);
    if (staleTabId === null) {
      return null;
    }

    this.debuggees.delete(staleTabId);
    this.detachTabState(staleTabId);
    await this.safeDetach({ tabId: staleTabId });

    try {
      await this.attachInternal(staleTabId, true);
    } catch {
      return null;
    }

    return this.getPrimaryDebuggee();
  }

  private isStaleTabError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return STALE_TAB_ERROR_MARKERS.some((marker) => message.includes(marker));
  }

  private toChromeDebuggee(debuggee: DebuggerSession): chrome.debugger.Debuggee {
    if (typeof debuggee.targetId === "string" && debuggee.targetId.length > 0) {
      return (typeof debuggee.sessionId === "string"
        ? { targetId: debuggee.targetId, sessionId: debuggee.sessionId }
        : { targetId: debuggee.targetId }) as chrome.debugger.Debuggee;
    }
    return (typeof debuggee.sessionId === "string"
      ? { tabId: debuggee.tabId as number, sessionId: debuggee.sessionId }
      : { tabId: debuggee.tabId as number }) as chrome.debugger.Debuggee;
  }

  private async runDebuggerAction(action: (done: () => void) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      action(() => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        resolve();
      });
    });
  }

  private async safeDetach(debuggee: DebuggerSession): Promise<void> {
    try {
      await this.runDebuggerAction((done) => {
        chrome.debugger.detach(this.toChromeDebuggee(debuggee), done);
      });
    } catch (error) {
      logError("cdp.safe_detach", error, { code: "detach_failed" });
    }
  }

  private respond(id: RelayResponse["id"], result: unknown, sessionId?: string): void {
    if (!this.callbacks) return;
    this.callbacks.onResponse({ id, result, ...(sessionId ? { sessionId } : {}) });
  }

  private respondError(id: RelayResponse["id"], message: string, sessionId?: string): void {
    if (!this.callbacks) return;
    this.callbacks.onResponse({ id, error: { message }, ...(sessionId ? { sessionId } : {}) });
  }

  private emitEvent(tabId: number, method: string, params?: unknown, sessionId?: string): void {
    const event: CDPRouterEvent = { tabId, method, ...(typeof params !== "undefined" ? { params } : {}), ...(sessionId ? { sessionId } : {}) };
    for (const listener of this.eventListeners) {
      listener(event);
    }
    if (!this.callbacks) return;
    const payload: RelayEvent["params"] = { method, ...(typeof params !== "undefined" ? { params } : {}) };
    if (sessionId) {
      payload.sessionId = sessionId;
    }
    this.callbacks.onEvent({ method: "forwardCDPEvent", params: payload });
  }
}

const isTargetInfo = (value: unknown): value is TargetInfo => {
  return isRecord(value) && typeof value.targetId === "string" && typeof value.type === "string";
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const readRootFrame = (value: unknown): { id: string; url?: string } | null => {
  if (!isRecord(value)) {
    return null;
  }
  const frameTree = value.frameTree;
  if (!isRecord(frameTree)) {
    return null;
  }
  const frame = frameTree.frame;
  if (!isRecord(frame) || typeof frame.id !== "string") {
    return null;
  }
  return {
    id: frame.id,
    ...(typeof frame.url === "string" ? { url: frame.url } : {})
  };
};
