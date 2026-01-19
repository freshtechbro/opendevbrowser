import type { RelayCommand, RelayEvent, RelayResponse } from "../types.js";
import { TabManager } from "./TabManager.js";
import { TargetSessionMap, type TargetInfo, type DebuggerSession } from "./TargetSessionMap.js";
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
  onDetach: () => void;
  onPrimaryTabChange?: (tabId: number | null) => void;
};

const FLAT_SESSION_ERROR = "Chrome 125+ required for extension relay (flat sessions).";
const DEPRECATED_SEND_MESSAGE = "Target.sendMessageToTarget is deprecated in flat session mode. Use sessionId routing.";

export class CDPRouter {
  private readonly debuggees = new Map<number, chrome.debugger.Debuggee>();
  private readonly sessions = new TargetSessionMap();
  private readonly tabManager = new TabManager();
  private readonly rootAttachedSessions = new Set<string>();
  private readonly browserContextByTab = new Map<number, string>();
  private callbacks: RelayCallbacks | null = null;
  private autoAttachOptions: AutoAttachOptions = { autoAttach: false, waitForDebuggerOnStart: false, flatten: true };
  private discoverTargets = false;
  private listenersActive = false;
  private flatSessionValidated = false;
  private primaryTabId: number | null = null;
  private lastActiveTabId: number | null = null;
  private sessionCounter = 1;
  private handleEventBound = (source: chrome.debugger.Debuggee, method: string, params?: object) => {
    this.handleEvent(source, method, params);
  };
  private handleDetachBound = (source: chrome.debugger.Debuggee) => {
    this.handleDetach(source);
  };

  setCallbacks(callbacks: RelayCallbacks): void {
    this.callbacks = callbacks;
  }

  async attach(tabId: number): Promise<void> {
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
    this.callbacks?.onDetach();
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
        const targetInfo = record?.kind === "root" ? this.sessions.getByTabId(record.tabId)?.targetInfo ?? null : null;
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
      updatePrimaryTab: this.updatePrimaryTab.bind(this),
      detachTabState: this.detachTabState.bind(this),
      safeDetach: this.safeDetach.bind(this),
      attach: this.attach.bind(this),
      registerRootTab: this.registerRootTab.bind(this),
      applyAutoAttach: this.applyAutoAttach.bind(this),
      sendCommand: this.sendCommand.bind(this),
      getPrimaryDebuggee: this.getPrimaryDebuggee.bind(this),
      getBrowserContextId: this.getBrowserContextId.bind(this)
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
    } catch {
      throw new Error(FLAT_SESSION_ERROR);
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
    } catch {
      throw new Error(FLAT_SESSION_ERROR);
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
        this.applyAutoAttachToChild(tabId, sessionId).catch(() => {});
      }
    }

    if (method === "Target.detachedFromTarget" && params && isRecord(params)) {
      const detachedSessionId = typeof params.sessionId === "string" ? params.sessionId : null;
      if (detachedSessionId) {
        this.sessions.removeBySessionId(detachedSessionId);
      }
    }

    const forwardSessionId = this.resolveForwardSessionId(method, source);
    this.emitEvent(method, params, forwardSessionId);
  }

  private handleDetach(source: chrome.debugger.Debuggee): void {
    const tabId = typeof source.tabId === "number" ? source.tabId : null;
    if (tabId === null || !this.debuggees.has(tabId)) return;
    this.debuggees.delete(tabId);
    this.detachTabState(tabId);

    if (this.debuggees.size === 0) {
      this.removeListeners();
      this.callbacks?.onDetach();
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
      return sessionId;
    }
    const tabId = typeof source.tabId === "number" ? source.tabId : null;
    if (tabId === null) return undefined;
    const record = this.sessions.getByTabId(tabId);
    return record?.rootSessionId;
  }

  private async buildTargetInfo(tabId: number): Promise<TargetInfo> {
    const tab = await this.tabManager.getTab(tabId);
    return {
      targetId: `tab-${tabId}`,
      type: "page",
      browserContextId: this.getBrowserContextId(tabId),
      title: tab?.title ?? undefined,
      url: tab?.url ?? undefined
    };
  }

  private getBrowserContextId(tabId: number): string {
    const existing = this.browserContextByTab.get(tabId);
    if (existing) return existing;
    const contextId = `pw-context-${this.sessionCounter}`;
    this.sessionCounter += 1;
    this.browserContextByTab.set(tabId, contextId);
    return contextId;
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

  private createRootSessionId(): string {
    const sessionId = `pw-tab-${this.sessionCounter}`;
    this.sessionCounter += 1;
    return sessionId;
  }

  private async sendCommand(debuggee: DebuggerSession, method: string, params: object): Promise<unknown> {
    return new Promise((resolve, reject) => {
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
    } catch {
      // Ignore detach errors during cleanup.
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

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};
