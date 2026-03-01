import type { RelayCommand, RelayEvent, RelayResponse } from "../types.js";
import { TabManager } from "./TabManager.js";
import { TargetSessionMap, type TargetInfo, type DebuggerSession } from "./TargetSessionMap.js";
import { logError } from "../logging.js";
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

const FLAT_SESSION_ERROR = "Chrome 125+ required for extension relay (flat sessions).";
const DEPRECATED_SEND_MESSAGE = "Target.sendMessageToTarget is deprecated in flat session mode. Use sessionId routing.";
const DEFAULT_BROWSER_CONTEXT_ID = "default";

export class CDPRouter {
  private readonly debuggees = new Map<number, chrome.debugger.Debuggee>();
  private readonly sessions = new TargetSessionMap();
  private readonly tabManager = new TabManager();
  private readonly rootAttachedSessions = new Set<string>();
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
  private handleEventBound = (source: chrome.debugger.Debuggee, method: string, params?: object) => {
    this.handleEvent(source, method, params);
  };
  private handleDetachBound = (source: chrome.debugger.Debuggee, reason?: string) => {
    this.handleDetach(source, reason);
  };

  setCallbacks(callbacks: RelayCallbacks): void {
    this.callbacks = callbacks;
  }

  async attach(tabId: number): Promise<void> {
    await this.attachInternal(tabId, true);
  }

  private async attachInternal(tabId: number, allowRetry: boolean): Promise<void> {
    if (this.debuggees.has(tabId)) {
      this.updatePrimaryTab(tabId);
      return;
    }

    const debuggee = { tabId };
    this.debuggees.set(tabId, debuggee);
    this.ensureListeners();

    try {
      await this.runDebuggerAction((done) => {
        chrome.debugger.attach(debuggee as chrome.debugger.Debuggee, "1.3", done);
      });
      await this.ensureFlatSessionSupport(debuggee);
      const targetInfo = await this.registerRootTab(tabId);

      if (this.discoverTargets) {
        this.emitTargetCreated(targetInfo);
      }

      if (this.autoAttachOptions.autoAttach) {
        await this.applyAutoAttach(debuggee);
        this.emitRootAttached(targetInfo);
      }

      this.updatePrimaryTab(tabId);
    } catch (error) {
      this.debuggees.delete(tabId);
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
        this.respond(command.id, { sessionId: rootSession.sessionId });
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
        const record = targetId ? this.sessions.getByTargetId(targetId) : null;
        const targetInfo = record?.targetInfo
          ?? (record?.kind === "root" ? this.sessions.getByTabId(record.tabId)?.targetInfo ?? null : null);
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
      respond: this.respond.bind(this),
      respondError: this.respondError.bind(this),
      emitTargetCreated: this.emitTargetCreated.bind(this),
      emitRootAttached: this.emitRootAttached.bind(this),
      emitRootDetached: this.emitRootDetached.bind(this),
      resetRootAttached: this.resetRootAttached.bind(this),
      updatePrimaryTab: this.updatePrimaryTab.bind(this),
      detachTabState: this.detachTabState.bind(this),
      safeDetach: this.safeDetach.bind(this),
      attach: this.attach.bind(this),
      registerRootTab: this.registerRootTab.bind(this),
      applyAutoAttach: this.applyAutoAttach.bind(this),
      sendCommand: this.sendCommand.bind(this),
      getPrimaryDebuggee: this.getPrimaryDebuggee.bind(this)
    };
  }

  private async registerRootTab(tabId: number): Promise<TargetInfo> {
    const existing = this.sessions.getByTabId(tabId);
    const sessionId = existing?.rootSessionId ?? this.createRootSessionId();
    const targetInfo = await this.buildTargetInfo(tabId);
    this.sessions.registerRootTab(tabId, targetInfo, sessionId);
    return targetInfo;
  }

  private updatePrimaryTab(tabId: number | null): void {
    if (tabId === this.primaryTabId) return;
    this.primaryTabId = tabId;
    if (tabId !== null) {
      this.lastActiveTabId = tabId;
    }
    this.callbacks?.onPrimaryTabChange?.(tabId);
  }

  private selectFallbackPrimary(): number | null {
    if (this.lastActiveTabId && this.debuggees.has(this.lastActiveTabId)) {
      return this.lastActiveTabId;
    }
    const [first] = this.debuggees.keys();
    return first ?? null;
  }

  private getPrimaryDebuggee(): DebuggerSession | null {
    if (this.primaryTabId !== null && this.debuggees.has(this.primaryTabId)) {
      return { tabId: this.primaryTabId };
    }
    const [first] = this.debuggees.keys();
    return typeof first === "number" ? { tabId: first } : null;
  }

  private async ensureRootSessionForPrimary(): Promise<{ sessionId: string; targetInfo: TargetInfo } | null> {
    const debuggee = this.getPrimaryDebuggee();
    if (!debuggee || typeof debuggee.tabId !== "number") {
      return null;
    }
    const existing = this.sessions.getByTabId(debuggee.tabId);
    if (existing) {
      return { sessionId: existing.rootSessionId, targetInfo: existing.targetInfo };
    }
    const targetInfo = await this.registerRootTab(debuggee.tabId);
    const refreshed = this.sessions.getByTabId(debuggee.tabId);
    if (!refreshed) {
      return null;
    }
    return { sessionId: refreshed.rootSessionId, targetInfo: targetInfo ?? refreshed.targetInfo };
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
    const tabId = typeof source.tabId === "number" ? source.tabId : null;
    if (tabId === null || !this.debuggees.has(tabId)) return;
    if (method === "Target.receivedMessageFromTarget") return;

    if (method === "Target.attachedToTarget" && params && isRecord(params)) {
      const sessionId = typeof params.sessionId === "string" ? params.sessionId : null;
      const targetInfo = isTargetInfo(params.targetInfo) ? params.targetInfo : null;
      if (sessionId && targetInfo) {
        this.sessions.registerChildSession(tabId, targetInfo, sessionId);
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
    this.emitEvent(method, params, forwardSessionId);
  }

  private handleDetach(source: chrome.debugger.Debuggee, reason?: string): void {
    const tabId = typeof source.tabId === "number" ? source.tabId : null;
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
      this.rootAttachedSessions.delete(record.rootSessionId);
      if (this.autoAttachOptions.autoAttach) {
        this.emitTargetDetached(record.rootSessionId, record.targetInfo.targetId);
      }
      if (this.discoverTargets) {
        this.emitTargetDestroyed(record.targetInfo.targetId);
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
    const tabId = typeof source.tabId === "number" ? source.tabId : null;
    if (tabId === null) return undefined;
    const record = this.sessions.getByTabId(tabId);
    if (!record) return undefined;
    return this.rootAttachedSessions.has(record.rootSessionId) ? record.rootSessionId : undefined;
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

  private emitTargetCreated(targetInfo: TargetInfo): void {
    this.emitEvent("Target.targetCreated", { targetInfo });
  }

  private emitTargetDestroyed(targetId: string): void {
    this.emitEvent("Target.targetDestroyed", { targetId });
  }

  private emitTargetDetached(sessionId: string, targetId: string): void {
    this.emitEvent("Target.detachedFromTarget", { sessionId, targetId });
  }

  private emitRootAttached(targetInfo: TargetInfo): void {
    const record = this.sessions.getByTargetId(targetInfo.targetId);
    if (!record || record.kind !== "root") return;
    if (this.rootAttachedSessions.has(record.sessionId)) return;
    this.rootAttachedSessions.add(record.sessionId);
    this.emitEvent("Target.attachedToTarget", {
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
      this.emitTargetDetached(record.sessionId, targetInfo.targetId);
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
    return await new Promise((resolve, reject) => {
      chrome.debugger.sendCommand(debuggee as chrome.debugger.Debuggee, method, params, (result) => {
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
    const staleTabId = typeof debuggee.tabId === "number" ? debuggee.tabId : null;
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
    return message.includes("No tab with given id");
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

  private async safeDetach(debuggee: chrome.debugger.Debuggee): Promise<void> {
    try {
      await this.runDebuggerAction((done) => {
        chrome.debugger.detach(debuggee, done);
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

  private emitEvent(method: string, params?: unknown, sessionId?: string): void {
    if (!this.callbacks) return;
    const payload: RelayEvent["params"] = { method, params };
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
