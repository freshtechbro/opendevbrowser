import type { RelayCommand, RelayEvent, RelayResponse } from "../types.js";
import { TabManager } from "./TabManager.js";
import { TargetSessionMap, type TargetInfo, type DebuggerSession } from "./TargetSessionMap.js";
import { logError } from "../logging.js";
import { getRestrictionMessage } from "./url-restrictions.js";
import { isAttachBlockedError } from "./attach-errors.js";
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

type DebuggerTargetInfo = chrome.debugger.TargetInfo & { openerId?: string };

export type CDPRouterEvent = {
  tabId: number;
  method: string;
  params?: unknown;
  sessionId?: string;
};

export type ChildTargetAttachDiagnosticStage =
  | "raw_attach_failed"
  | "attached_root_unavailable"
  | "attached_root_attach_null"
  | "attached_root_attach_failed";

export type ChildTargetAttachInitialStage =
  | "raw_attach_null"
  | "raw_attach_blocked";

type ChildTargetRootTargetRetryStage =
  | "attached"
  | "missing_root_target_id"
  | "attach_null"
  | "attach_blocked";

type ChildTargetAttachedRootRecoveryStage =
  | "attached"
  | "record_missing"
  | "session_missing"
  | "attach_null"
  | "attach_failed";

type ChildTargetAttachedRootRecoverySource =
  | "record"
  | "debuggee"
  | "debugger"
  | "targets";

type ChildTargetUnavailableTerminalBranch =
  | "initial_attached_root_recovery"
  | "post_register_root_recovery"
  | "tab_scoped_root_reattach"
  | "root_debuggee_reattach";

type ChildTargetReattachRecoveryStage =
  | "tab_scoped_root_reattach_failed"
  | "tab_scoped_attach_failed"
  | "root_debuggee_reattach_failed"
  | "root_debuggee_attach_null"
  | "root_debuggee_attach_blocked"
  | "root_debuggee_attach_failed";

export type ChildTargetAttachDiagnostic = {
  tabId: number;
  targetId: string;
  stage: ChildTargetAttachDiagnosticStage;
  initialStage?: ChildTargetAttachInitialStage;
  rootTargetRetryStage?: Exclude<ChildTargetRootTargetRetryStage, "attached">;
  attachedRootRecoveryStage?: Exclude<ChildTargetAttachedRootRecoveryStage, "attached">;
  attachedRootRecoverySource?: ChildTargetAttachedRootRecoverySource;
  attachedRootRecoveryAttachTargetId?: string;
  attachedRootRecoveryRetriedAfterRegisterRoot?: boolean;
  attachedRootRecoveryRegisterRootChanged?: boolean;
  attachedRootRecoveryRegisterRootAttachTargetChanged?: boolean;
  attachedRootRecoveryRegisterAttachedRootSessionCalled?: boolean;
  attachedRootUnavailableTerminalBranch?: ChildTargetUnavailableTerminalBranch;
  reattachRecoveryStage?: ChildTargetReattachRecoveryStage;
  reattachRecoveryReason?: string;
  attachedRootRecoveryReason?: string;
  reason?: string;
  at: number;
};

type RootRefreshPath =
  | "attach_internal"
  | "reattach_root_debuggee";

type RootRefreshProbeStage =
  | "skipped"
  | "missing_debuggee"
  | "succeeded"
  | "failed";

export type RootRefreshDiagnostic = {
  tabId: number;
  path: RootRefreshPath;
  refreshCompleted: boolean;
  debuggeePresentAfterRefresh: boolean;
  rootSessionPresentAfterRefresh: boolean;
  rootTargetIdAfterRefresh?: string;
  probeMethod: "Target.getTargets";
  probeStage: RootRefreshProbeStage;
  probeReason?: string;
  reason?: string;
  at: number;
};

export type RootAttachDiagnosticOrigin =
  | "root_attach"
  | "flat_session_bootstrap";

export type RootAttachDiagnosticStage =
  | "root_debugger_attach_failed"
  | "flat_session_probe_failed"
  | "fallback_root_debugger_attach_failed"
  | "fallback_flat_session_probe_failed";

export type RootAttachDiagnostic = {
  tabId: number;
  origin: RootAttachDiagnosticOrigin;
  stage: RootAttachDiagnosticStage;
  attachBy: NonNullable<DebuggerSession["attachBy"]>;
  probeMethod?: "Target.setAutoAttach";
  reason?: string;
  at: number;
};

type ChildTargetRootTargetRetryResult = {
  sessionId: string | null;
  stage: ChildTargetRootTargetRetryStage;
  reason?: string;
};

type AttachedRootRecoveryResult = {
  debuggerSession: DebuggerSession | null;
  stage: ChildTargetAttachedRootRecoveryStage;
  attachTargetSource?: ChildTargetAttachedRootRecoverySource;
  attachTargetId?: string;
  registerAttachedRootSessionCalled?: boolean;
  reason?: string;
};

type ReattachChildTargetResult = {
  sessionId: string | null;
  terminalBranch?: ChildTargetUnavailableTerminalBranch;
  stage?: ChildTargetReattachRecoveryStage;
  reason?: string;
};

type SendCommandOptions = {
  preserveTab?: boolean;
  refreshPreparedDebuggee?: boolean;
};

const FLAT_SESSION_ERROR = "Chrome 125+ required for extension relay (flat sessions).";
const DEPRECATED_SEND_MESSAGE = "Target.sendMessageToTarget is deprecated in flat session mode. Use sessionId routing.";
const DEFAULT_BROWSER_CONTEXT_ID = "default";
const DEFAULT_BROWSER_TARGET_ID = "browser";
const STALE_TAB_ERROR_MARKERS = [
  "No tab with given id",
  "Debugger is not attached",
  "Detached while handling command"
];

export class CDPRouter {
  private readonly debuggees = new Map<number, chrome.debugger.Debuggee>();
  private readonly rootTargetTabIds = new Map<string, number>();
  private readonly sessions = new TargetSessionMap();
  private readonly tabManager = new TabManager();
  private readonly rootAttachedSessions = new Set<string>();
  private readonly pendingTargetTabIds = new Map<string, number>();
  private readonly childAttachDiagnostics = new Map<string, ChildTargetAttachDiagnostic>();
  private readonly rootAttachDiagnostics = new Map<number, RootAttachDiagnostic>();
  private readonly rootRefreshDiagnostics = new Map<number, RootRefreshDiagnostic>();
  private readonly expectedRootDetachDeadlines = new Map<number, number>();
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
    await this.prepareForNextClientIfNeeded();
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
    await this.prepareForNextClientIfNeeded();
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
    await this.prepareForNextClientIfNeeded(tabId);
    await this.attachInternal(tabId, true);
  }

  async refreshTabAttachment(tabId: number): Promise<void> {
    const preparedTabId = await this.prepareForNextClientIfNeeded(tabId);
    const resetPreparedSameTabRoot = preparedTabId === tabId && this.debuggees.has(tabId);
    const path: RootRefreshPath = this.debuggees.has(tabId)
      ? "reattach_root_debuggee"
      : "attach_internal";
    try {
      if (resetPreparedSameTabRoot) {
        // Reset preflight already rebuilt this root; probing it is enough.
      } else if (path === "reattach_root_debuggee") {
        await this.reattachRootDebuggee(tabId);
      } else {
        await this.attachInternal(tabId, false);
      }
    } catch (error) {
      await this.captureRootRefreshDiagnostic(tabId, path, false, error);
      throw error;
    }
    await this.captureRootRefreshDiagnostic(tabId, path, true);
  }

  async primeAttachedRootSession(tabId: number): Promise<void> {
    await this.prepareForNextClientIfNeeded(tabId);
    if (this.sessions.getAttachedRootSession(tabId)) {
      return;
    }
    await this.ensureAttachedRootSession(tabId);
  }

  async resolveTabTargetId(tabId: number): Promise<string | null> {
    await this.prepareForNextClientIfNeeded(tabId);
    return (await this.readDebuggerTargetInfo(tabId))?.id ?? null;
  }

  async resolveTabOpenerTargetId(tabId: number): Promise<string | null> {
    await this.prepareForNextClientIfNeeded();
    const { tab, pageTargets } = await this.readDebuggerPageTargets(tabId);
    if (pageTargets.length === 0) {
      return null;
    }
    const preferredTarget = this.selectPreferredDebuggerTargetInfo(tab, pageTargets);
    const candidates = preferredTarget
      ? [preferredTarget, ...pageTargets.filter((target) => target !== preferredTarget)]
      : pageTargets;
    for (const candidate of candidates) {
      const targetInfo = this.resolveTargetInfo(candidate.id);
      const openerTabId = this.pendingTargetTabIds.get(candidate.id)
        ?? this.resolveLinkedTargetTabId(candidate.openerId)
        ?? this.resolveLinkedTargetTabId(targetInfo?.openerId)
        ?? null;
      if (openerTabId !== null) {
        return `tab-${openerTabId}`;
      }
    }
    return null;
  }

  async attachChildTarget(tabId: number, targetId: string): Promise<string | null> {
    await this.prepareForNextClientIfNeeded(tabId);
    let rootDebuggee: DebuggerSession;
    try {
      rootDebuggee = await this.resolveRootSessionDebuggee(tabId);
    } catch (error) {
      this.recordChildAttachDiagnostic(tabId, targetId, {
        stage: "raw_attach_failed",
        reason: getErrorMessage(error)
      });
      throw error;
    }

    let initialStage: ChildTargetAttachInitialStage | undefined;
    let directError: unknown = null;
    let rootTargetRetryStage: Exclude<ChildTargetRootTargetRetryStage, "attached"> | undefined;
    const captureRootRecordState = (): {
      present: boolean;
      rootSessionId: string | null;
      targetId: string | null;
      attachTargetId: string | null;
    } => {
      const record = this.sessions.getByTabId(tabId);
      return {
        present: Boolean(record),
        rootSessionId: record?.rootSessionId ?? null,
        targetId: record?.targetInfo.targetId ?? null,
        attachTargetId: record?.attachTargetId ?? null
      };
    };
    try {
      const directSessionId = await this.attachChildTargetWithDebuggee(rootDebuggee, targetId);
      if (directSessionId) {
        this.clearChildAttachDiagnostic(tabId, targetId);
        return directSessionId;
      }
      const directTargetRetry = await this.attachChildTargetWithRootTargetId(rootDebuggee, targetId);
      if (directTargetRetry.sessionId) {
        this.clearChildAttachDiagnostic(tabId, targetId);
        return directTargetRetry.sessionId;
      }
      if (directTargetRetry.stage !== "attached") {
        rootTargetRetryStage = directTargetRetry.stage;
      }
      initialStage = "raw_attach_null";
    } catch (error) {
      const attachBlocked = isAttachBlockedError(error);
      const staleRootDebuggee = this.isStaleTabError(error);
      if (!attachBlocked && !staleRootDebuggee) {
        this.recordChildAttachDiagnostic(tabId, targetId, {
          stage: "raw_attach_failed",
          reason: getErrorMessage(error)
        });
        throw error;
      }
      if (staleRootDebuggee) {
        directError = error;
      }
      if (attachBlocked || staleRootDebuggee) {
        let directTargetRetry: ChildTargetRootTargetRetryResult;
        try {
          directTargetRetry = await this.attachChildTargetWithRootTargetId(rootDebuggee, targetId, error);
        } catch (fallbackError) {
          this.recordChildAttachDiagnostic(tabId, targetId, {
            stage: "raw_attach_failed",
            reason: getErrorMessage(fallbackError)
          });
          throw fallbackError;
        }
        if (directTargetRetry.sessionId) {
          this.clearChildAttachDiagnostic(tabId, targetId);
          return directTargetRetry.sessionId;
        }
        if (directTargetRetry.stage !== "attached") {
          rootTargetRetryStage = directTargetRetry.stage;
        }
        if (attachBlocked) {
          initialStage = "raw_attach_blocked";
          directError = error;
        }
      }
    }
    let attachedRootRecovery = await this.ensureAttachedRootSessionWithDiagnostic(tabId);
    let attachedRootRecoveryRetriedAfterRegisterRoot = false;
    let attachedRootRecoveryRegisterRootChanged: boolean | undefined;
    let attachedRootRecoveryRegisterRootAttachTargetChanged: boolean | undefined;
    if (!attachedRootRecovery.debuggerSession) {
      const beforeRegisterRoot = captureRootRecordState();
      await this.registerRootTab(tabId);
      const afterRegisterRoot = captureRootRecordState();
      attachedRootRecoveryRetriedAfterRegisterRoot = true;
      attachedRootRecoveryRegisterRootChanged = beforeRegisterRoot.present !== afterRegisterRoot.present
        || beforeRegisterRoot.rootSessionId !== afterRegisterRoot.rootSessionId
        || beforeRegisterRoot.targetId !== afterRegisterRoot.targetId
        || beforeRegisterRoot.attachTargetId !== afterRegisterRoot.attachTargetId;
      attachedRootRecoveryRegisterRootAttachTargetChanged = beforeRegisterRoot.attachTargetId !== afterRegisterRoot.attachTargetId;
      attachedRootRecovery = await this.ensureAttachedRootSessionWithDiagnostic(tabId);
    }
    if (!attachedRootRecovery.debuggerSession) {
      const reattachedChild = await this.reattachRootAndAttachChildTarget(tabId, targetId);
      if (reattachedChild.sessionId) {
        this.clearChildAttachDiagnostic(tabId, targetId);
        return reattachedChild.sessionId;
      }
      const terminalBranch = reattachedChild.terminalBranch
        ?? (attachedRootRecoveryRetriedAfterRegisterRoot
          ? "post_register_root_recovery"
          : "initial_attached_root_recovery");
      this.recordChildAttachDiagnostic(tabId, targetId, {
        stage: "attached_root_unavailable",
        ...(initialStage ? { initialStage } : {}),
        ...(rootTargetRetryStage ? { rootTargetRetryStage } : {}),
        ...(attachedRootRecovery.stage !== "attached"
          ? { attachedRootRecoveryStage: attachedRootRecovery.stage }
          : {}),
        ...(attachedRootRecovery.attachTargetSource
          ? { attachedRootRecoverySource: attachedRootRecovery.attachTargetSource }
          : {}),
        ...(attachedRootRecovery.attachTargetId
          ? { attachedRootRecoveryAttachTargetId: attachedRootRecovery.attachTargetId }
          : {}),
        ...(attachedRootRecoveryRetriedAfterRegisterRoot
          ? { attachedRootRecoveryRetriedAfterRegisterRoot: true }
          : {}),
        ...(typeof attachedRootRecoveryRegisterRootChanged === "boolean"
          ? { attachedRootRecoveryRegisterRootChanged }
          : {}),
        ...(typeof attachedRootRecoveryRegisterRootAttachTargetChanged === "boolean"
          ? { attachedRootRecoveryRegisterRootAttachTargetChanged }
          : {}),
        ...(typeof attachedRootRecovery.registerAttachedRootSessionCalled === "boolean"
          ? { attachedRootRecoveryRegisterAttachedRootSessionCalled: attachedRootRecovery.registerAttachedRootSessionCalled }
          : {}),
        attachedRootUnavailableTerminalBranch: terminalBranch,
        ...(reattachedChild.stage ? { reattachRecoveryStage: reattachedChild.stage } : {}),
        ...(reattachedChild.reason ? { reattachRecoveryReason: reattachedChild.reason } : {}),
        ...(attachedRootRecovery.reason
          ? { attachedRootRecoveryReason: attachedRootRecovery.reason }
          : {}),
        ...((directError || attachedRootRecovery.reason || reattachedChild.reason)
          ? {
            reason: directError
              ? getErrorMessage(directError)
              : (attachedRootRecovery.reason ?? reattachedChild.reason)
          }
          : {})
      });
      if (directError) {
        throw directError;
      }
      return null;
    }
    try {
      const attachedRootSessionId = await this.attachChildTargetWithDebuggee(
        attachedRootRecovery.debuggerSession,
        targetId
      );
      if (attachedRootSessionId) {
        this.clearChildAttachDiagnostic(tabId, targetId);
        return attachedRootSessionId;
      }
      await this.restoreRootAfterChildAttachFailure(tabId);
      this.recordChildAttachDiagnostic(tabId, targetId, {
        stage: "attached_root_attach_null",
        ...(initialStage ? { initialStage } : {}),
        ...(rootTargetRetryStage ? { rootTargetRetryStage } : {}),
        ...(attachedRootRecovery.attachTargetSource
          ? { attachedRootRecoverySource: attachedRootRecovery.attachTargetSource }
          : {}),
        ...(attachedRootRecovery.attachTargetId
          ? { attachedRootRecoveryAttachTargetId: attachedRootRecovery.attachTargetId }
          : {}),
        ...(typeof attachedRootRecovery.registerAttachedRootSessionCalled === "boolean"
          ? { attachedRootRecoveryRegisterAttachedRootSessionCalled: attachedRootRecovery.registerAttachedRootSessionCalled }
          : {})
      });
      return null;
    } catch (error) {
      await this.restoreRootAfterChildAttachFailure(tabId);
      this.recordChildAttachDiagnostic(tabId, targetId, {
        stage: "attached_root_attach_failed",
        ...(initialStage ? { initialStage } : {}),
        ...(rootTargetRetryStage ? { rootTargetRetryStage } : {}),
        ...(attachedRootRecovery.attachTargetSource
          ? { attachedRootRecoverySource: attachedRootRecovery.attachTargetSource }
          : {}),
        ...(attachedRootRecovery.attachTargetId
          ? { attachedRootRecoveryAttachTargetId: attachedRootRecovery.attachTargetId }
          : {}),
        ...(typeof attachedRootRecovery.registerAttachedRootSessionCalled === "boolean"
          ? { attachedRootRecoveryRegisterAttachedRootSessionCalled: attachedRootRecovery.registerAttachedRootSessionCalled }
          : {}),
        reason: getErrorMessage(error)
      });
      throw error;
    }
  }

  getLastChildAttachDiagnostic(tabId: number, targetId: string): ChildTargetAttachDiagnostic | null {
    return this.childAttachDiagnostics.get(this.childAttachDiagnosticKey(tabId, targetId)) ?? null;
  }

  getLastRootRefreshDiagnostic(tabId: number): RootRefreshDiagnostic | null {
    return this.rootRefreshDiagnostics.get(tabId) ?? null;
  }

  getLastRootAttachDiagnostic(tabId: number): RootAttachDiagnostic | null {
    return this.rootAttachDiagnostics.get(tabId) ?? null;
  }

  hasDebuggerSession(sessionId: string): boolean {
    return this.sessions.hasSession(sessionId);
  }

  registerChildSession(tabId: number, targetInfo: TargetInfo, sessionId: string): void {
    this.sessions.registerChildSession(tabId, targetInfo, sessionId);
  }

  private async attachInternal(tabId: number, allowRetry: boolean): Promise<void> {
    if (this.debuggees.has(tabId)) {
      this.clearRootAttachDiagnostic(tabId);
      this.updatePrimaryTab(tabId);
      await this.pruneRootDebuggees(tabId);
      return;
    }

    const debuggee = await this.resolveRootDebuggee(tabId);
    let attachedDebuggee = debuggee;
    const displacedRoots = await this.detachConflictingRootDebuggees(tabId);
    this.debuggees.set(tabId, debuggee);
    this.ensureListeners();

    try {
      attachedDebuggee = await this.attachRootDebuggeeWithFallback(tabId, debuggee);
      const targetInfo = await this.registerRootTab(tabId);

      if (this.discoverTargets) {
        await this.applyDiscoverTargets(attachedDebuggee, true);
        this.emitTargetCreated(tabId, targetInfo);
      }

      if (this.autoAttachOptions.autoAttach) {
        await this.applyAutoAttach(attachedDebuggee);
        this.emitRootAttached(targetInfo);
      }

      this.updatePrimaryTab(tabId);
      this.commitDetachedRootDebuggees(displacedRoots);
      await this.pruneRootDebuggees(tabId);
      this.clearRootAttachDiagnostic(tabId);
    } catch (error) {
      if (isAttachBlockedError(error) && await this.reuseAlreadyAttachedRootDebuggee(tabId)) {
        this.commitDetachedRootDebuggees(displacedRoots);
        await this.pruneRootDebuggees(tabId);
        this.clearRootAttachDiagnostic(tabId);
        return;
      }
      this.debuggees.delete(tabId);
      if (typeof attachedDebuggee.targetId === "string") {
        this.rootTargetTabIds.delete(attachedDebuggee.targetId);
      }
      if (this.debuggees.size === 0) {
        this.removeListeners();
      }
      await this.safeDetach(attachedDebuggee);
      if (allowRetry && this.isStaleTabError(error)) {
        const attemptedTabIds = new Set<number>([tabId]);
        let lastStaleError: unknown = error;
        const activeTabId = await this.tabManager.getActiveTabId();
        if (activeTabId && !attemptedTabIds.has(activeTabId)) {
          attemptedTabIds.add(activeTabId);
          try {
            await this.attachInternal(activeTabId, false);
            this.commitDetachedRootDebuggees(displacedRoots);
            return;
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
            await this.attachInternal(fallbackTabId, false);
            this.commitDetachedRootDebuggees(displacedRoots);
            return;
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
            await this.attachInternal(createdTab.id, false);
            this.commitDetachedRootDebuggees(displacedRoots);
            return;
          }
        } catch (candidateError) {
          if (!this.isStaleTabError(candidateError)) {
            throw candidateError;
          }
          lastStaleError = candidateError;
        }
        await this.restoreDetachedRootDebuggees(displacedRoots);
        throw lastStaleError;
      }
      await this.restoreDetachedRootDebuggees(displacedRoots);
      throw error;
    }
  }

  private async reuseAlreadyAttachedRootDebuggee(tabId: number): Promise<boolean> {
    const targetInfo = await this.readDebuggerTargetInfo(tabId);
    if (!targetInfo?.attached) {
      return false;
    }

    const reusedDebuggee: DebuggerSession = {
      tabId,
      targetId: targetInfo.id,
      attachBy: "targetId"
    };
    this.debuggees.set(tabId, reusedDebuggee);
    this.ensureListeners();

    try {
      await this.ensureFlatSessionSupport(reusedDebuggee);
      const registeredTarget = await this.registerRootTab(tabId);
      if (this.discoverTargets) {
        await this.applyDiscoverTargets(reusedDebuggee, true);
        this.emitTargetCreated(tabId, registeredTarget);
      }
      if (this.autoAttachOptions.autoAttach) {
        await this.applyAutoAttach(reusedDebuggee);
        this.emitRootAttached(registeredTarget);
      }
      this.updatePrimaryTab(tabId);
      return true;
    } catch {
      this.debuggees.delete(tabId);
      this.rootTargetTabIds.delete(targetInfo.id);
      if (this.debuggees.size === 0) {
        this.removeListeners();
      }
      return false;
    }
  }

  private async attachRootDebuggeeWithFallback(
    tabId: number,
    debuggee: DebuggerSession
  ): Promise<DebuggerSession> {
    await this.attachRootDebuggee(debuggee);
    try {
      await this.ensureFlatSessionSupport(debuggee);
      return debuggee;
    } catch (error) {
      this.recordRootAttachDiagnostic(tabId, {
        origin: "flat_session_bootstrap",
        stage: "flat_session_probe_failed",
        attachBy: this.resolveRootAttachBy(debuggee),
        probeMethod: "Target.setAutoAttach",
        reason: getErrorMessage(error)
      });
      const targetAttachDebuggee = this.createTargetAttachRootDebuggee(tabId, debuggee, error);
      if (!targetAttachDebuggee) {
        throw error;
      }
      this.markExpectedRootDetach(tabId);
      await this.safeDetach(debuggee);
      this.debuggees.set(tabId, targetAttachDebuggee);
      await this.attachRootDebuggee(targetAttachDebuggee);
      try {
        await this.ensureFlatSessionSupport(targetAttachDebuggee);
      } catch (fallbackError) {
        this.recordRootAttachDiagnostic(tabId, {
          origin: "flat_session_bootstrap",
          stage: "fallback_flat_session_probe_failed",
          attachBy: this.resolveRootAttachBy(targetAttachDebuggee),
          probeMethod: "Target.setAutoAttach",
          reason: getErrorMessage(fallbackError)
        });
        throw fallbackError;
      }
      return targetAttachDebuggee;
    }
  }

  private async attachRootDebuggee(debuggee: DebuggerSession): Promise<void> {
    try {
      await this.runDebuggerAction((done) => {
        chrome.debugger.attach(this.toChromeDebuggee(debuggee), "1.3", done);
      });
    } catch (error) {
      if (typeof debuggee.tabId === "number") {
        this.recordRootAttachDiagnostic(debuggee.tabId, {
          origin: "root_attach",
          stage: debuggee.attachBy === "targetId"
            ? "fallback_root_debugger_attach_failed"
            : "root_debugger_attach_failed",
          attachBy: this.resolveRootAttachBy(debuggee),
          reason: getErrorMessage(error)
        });
      }
      throw error;
    }
  }

  private createTargetAttachRootDebuggee(
    tabId: number,
    debuggee: DebuggerSession,
    error: unknown
  ): DebuggerSession | null {
    if (!isAttachBlockedError(error)) {
      return null;
    }
    const targetId = typeof debuggee.targetId === "string" && debuggee.targetId.length > 0
      ? debuggee.targetId
      : null;
    if (!targetId || debuggee.attachBy === "targetId") {
      return null;
    }
    return {
      tabId,
      targetId,
      attachBy: "targetId"
    };
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

  isTabAttached(tabId: number): boolean {
    return this.debuggees.has(tabId);
  }

  getTabDebuggee(tabId: number): DebuggerSession | null {
    return this.sessions.getAttachedRootSession(tabId)?.debuggerSession
      ?? this.debuggees.get(tabId)
      ?? (() => {
        const rootRecord = this.sessions.getByTabId(tabId);
        if (!rootRecord) {
          return null;
        }
        return this.sessions.getBySessionId(rootRecord.rootSessionId)?.debuggerSession ?? null;
      })();
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

  private async prepareForNextClientIfNeeded(preferredTabIdHint?: number | null): Promise<number | null> {
    if (!this.clientResetPending) {
      return null;
    }

    const preferredTabId = await this.resolvePreferredResetTabId(preferredTabIdHint);
    const retainedPreferredRootTargetId = preferredTabId !== null
      ? this.resolveRetainedRootTargetId(preferredTabId)
      : null;
    this.clientResetPending = false;
    this.autoAttachOptions = { autoAttach: false, waitForDebuggerOnStart: false, flatten: true };
    this.discoverTargets = false;
    this.rootAttachedSessions.clear();
    this.pendingTargetTabIds.clear();
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
      return null;
    }

    const attachedPrimary = this.debuggees.get(preferredTabId);
    if (attachedPrimary) {
      this.updatePrimaryTab(preferredTabId);
      // After a client reset, a preserved root tab is only a candidate anchor.
      // Rebuild the real root attachment before any same-tab reuse is considered healthy.
      await this.reattachRootDebuggee(preferredTabId, true);
      const refreshedRoot = this.sessions.getByTabId(preferredTabId);
      if (retainedPreferredRootTargetId && !refreshedRoot?.attachTargetId) {
        this.sessions.setRootAttachTargetId(preferredTabId, retainedPreferredRootTargetId);
        const refreshedDebuggee = this.debuggees.get(preferredTabId);
        if (refreshedDebuggee && !refreshedDebuggee.targetId) {
          refreshedDebuggee.targetId = retainedPreferredRootTargetId;
        }
        const refreshedRootSession = refreshedRoot
          ? this.sessions.getBySessionId(refreshedRoot.rootSessionId)
          : null;
        if (refreshedRootSession?.debuggerSession && !refreshedRootSession.debuggerSession.targetId) {
          refreshedRootSession.debuggerSession.targetId = retainedPreferredRootTargetId;
        }
      }
      return preferredTabId;
    }

    await this.attachInternal(preferredTabId, true);
    return preferredTabId;
  }

  private async resolvePreferredResetTabId(preferredTabIdHint?: number | null): Promise<number | null> {
    const candidateTabIds: number[] = [];
    const pushCandidate = (tabId: number | null) => {
      if (typeof tabId === "number" && !candidateTabIds.includes(tabId)) {
        candidateTabIds.push(tabId);
      }
    };

    pushCandidate(preferredTabIdHint ?? null);
    pushCandidate(await this.tabManager.getActiveTabId());
    pushCandidate(this.lastActiveTabId);
    pushCandidate(this.primaryTabId);

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
    const displacedRoots = await this.detachConflictingRootDebuggees(primaryTabId);
    this.commitDetachedRootDebuggees(displacedRoots);
  }

  private async detachConflictingRootDebuggees(nextTabId: number): Promise<Array<{ tabId: number }>> {
    const staleTabIds = Array.from(this.debuggees.keys()).filter((tabId) => tabId !== nextTabId);
    const displacedRoots: Array<{ tabId: number }> = [];
    for (const staleTabId of staleTabIds) {
      const debuggee = this.debuggees.get(staleTabId);
      if (!debuggee) {
        continue;
      }
      this.debuggees.delete(staleTabId);
      this.markExpectedRootDetach(staleTabId);
      await this.safeDetach(debuggee);
      displacedRoots.push({ tabId: staleTabId });
    }
    return displacedRoots;
  }

  private commitDetachedRootDebuggees(detachedRoots: Array<{ tabId: number }>): void {
    for (const { tabId } of detachedRoots) {
      if (this.debuggees.has(tabId)) {
        continue;
      }
      this.detachTabState(tabId);
    }
  }

  private async restoreDetachedRootDebuggees(detachedRoots: Array<{ tabId: number }>): Promise<void> {
    for (const { tabId } of detachedRoots) {
      if (this.debuggees.has(tabId)) {
        return;
      }
      try {
        await this.attachInternal(tabId, false);
        return;
      } catch (error) {
        if (this.isExpectedDebuggerCleanupError(error)) {
          continue;
        }
        logError("cdp.restore_root_attach", error, {
          code: "restore_root_attach_failed",
          extra: { tabId }
        });
      }
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
    return (await this.ensureAttachedRootSessionWithDiagnostic(tabId)).debuggerSession;
  }

  private async ensureAttachedRootSessionWithDiagnostic(tabId: number): Promise<AttachedRootRecoveryResult> {
    const existing = this.sessions.getAttachedRootSession(tabId);
    if (existing) {
      return {
        debuggerSession: existing.debuggerSession,
        stage: "attached",
        registerAttachedRootSessionCalled: false
      };
    }

    const record = this.sessions.getByTabId(tabId);
    if (!record) {
      return {
        debuggerSession: null,
        stage: "record_missing",
        registerAttachedRootSessionCalled: false
      };
    }

    const recordAttachTargetId = typeof record.attachTargetId === "string" && record.attachTargetId.length > 0
      ? record.attachTargetId
      : null;
    const retainedAttachTargetId = recordAttachTargetId ?? this.resolveRetainedRootTargetId(tabId);
    const liveAttachTargetId = await this.readDebuggerTargetId(tabId);
    const attachTargetId = recordAttachTargetId ?? liveAttachTargetId ?? retainedAttachTargetId;
    const attachTargetSource: ChildTargetAttachedRootRecoverySource | undefined = recordAttachTargetId
      ? "record"
      : liveAttachTargetId
          ? "debugger"
          : retainedAttachTargetId
            ? "debuggee"
            : undefined;
    if (!attachTargetId) {
      return {
        debuggerSession: null,
        stage: "session_missing",
        registerAttachedRootSessionCalled: false,
        reason: "attach_target_id_unavailable"
      };
    }
    if (recordAttachTargetId !== attachTargetId) {
      this.sessions.setRootAttachTargetId(tabId, attachTargetId);
    }

    const attachRootSession = async (debuggee: DebuggerSession): Promise<{ sessionId: string | null; error?: unknown }> => {
      try {
        const attached = await this.sendCommandOnce(
          debuggee,
          "Target.attachToTarget",
          {
            targetId: attachTargetId,
            flatten: true
          }
        );
        const sessionRecord = isRecord(attached) ? attached : {};
        return {
          sessionId: typeof sessionRecord.sessionId === "string" ? sessionRecord.sessionId : null
        };
      } catch (error) {
        return {
          sessionId: null,
          error
        };
      }
    };

    const initialAttachDebuggee: DebuggerSession = liveAttachTargetId
      ? { tabId }
      : { targetId: attachTargetId, attachBy: "targetId" };
    let attachAttempt = await attachRootSession(initialAttachDebuggee);
    if (
      typeof initialAttachDebuggee.tabId === "number"
      && !attachAttempt.sessionId
      && (
        !attachAttempt.error
        || isAttachBlockedError(attachAttempt.error)
        || this.isStaleTabError(attachAttempt.error)
      )
    ) {
      const initialFailure = attachAttempt;
      const retriedAttachAttempt = await attachRootSession({ targetId: attachTargetId, attachBy: "targetId" });
      attachAttempt = retriedAttachAttempt.sessionId
        || retriedAttachAttempt.error
        || !initialFailure.error
        ? retriedAttachAttempt
        : initialFailure;
    }

    try {
      const attachedSessionId = attachAttempt.sessionId;
      if (!attachedSessionId) {
        if (attachAttempt.error) {
          throw attachAttempt.error;
        }
        return {
          debuggerSession: null,
          stage: "attach_null",
          ...(attachTargetSource ? { attachTargetSource } : {}),
          attachTargetId,
          registerAttachedRootSessionCalled: false
        };
      }

      const attachedRecord = this.sessions.registerAttachedRootSession(tabId, attachedSessionId);
      if (attachedRecord?.debuggerSession) {
        attachedRecord.debuggerSession.targetId = attachTargetId;
      }
      return {
        debuggerSession: attachedRecord?.debuggerSession ?? {
          tabId,
          sessionId: attachedSessionId,
          targetId: attachTargetId
        },
        stage: "attached",
        ...(attachTargetSource ? { attachTargetSource } : {}),
        attachTargetId,
        registerAttachedRootSessionCalled: true
      };
    } catch (error) {
      return {
        debuggerSession: null,
        stage: "attach_failed",
        ...(attachTargetSource ? { attachTargetSource } : {}),
        attachTargetId,
        registerAttachedRootSessionCalled: false,
        reason: getErrorMessage(error)
      };
    }
  }

  private async resolveRootSessionDebuggee(tabId: number): Promise<DebuggerSession> {
    await this.syncLiveRootTargetId(tabId);
    const attachedDebuggee = this.debuggees.get(tabId);
    if (attachedDebuggee?.targetId) {
      return attachedDebuggee;
    }
    const attachedRootSession = this.sessions.getAttachedRootSession(tabId);
    if (attachedRootSession?.debuggerSession) {
      return attachedRootSession.debuggerSession;
    }
    const existing = this.sessions.getByTabId(tabId);
    const existingSession = existing ? this.sessions.getBySessionId(existing.rootSessionId) : null;
    if (existingSession?.debuggerSession?.targetId) {
      return existingSession.debuggerSession;
    }
    return await this.resolveRootDebuggee(tabId);
  }

  private async syncLiveRootTargetId(tabId: number): Promise<void> {
    const liveTargetId = await this.readDebuggerTargetId(tabId);
    if (!liveTargetId) {
      return;
    }
    const staleTargetIds = new Set<string>();
    const attachedDebuggee = this.debuggees.get(tabId);
    if (typeof attachedDebuggee?.targetId === "string" && attachedDebuggee.targetId.length > 0) {
      staleTargetIds.add(attachedDebuggee.targetId);
    }
    const rootRecord = this.sessions.getByTabId(tabId);
    if (typeof rootRecord?.targetInfo.targetId === "string" && rootRecord.targetInfo.targetId.length > 0) {
      staleTargetIds.add(rootRecord.targetInfo.targetId);
    }
    if (typeof rootRecord?.attachTargetId === "string" && rootRecord.attachTargetId.length > 0) {
      staleTargetIds.add(rootRecord.attachTargetId);
    }
    for (const targetId of staleTargetIds) {
      if (targetId !== liveTargetId && this.rootTargetTabIds.get(targetId) === tabId) {
        this.rootTargetTabIds.delete(targetId);
      }
    }
    this.rootTargetTabIds.set(liveTargetId, tabId);
    this.sessions.setRootAttachTargetId(tabId, liveTargetId);

    if (attachedDebuggee) {
      attachedDebuggee.targetId = liveTargetId;
    }

    const rootSession = rootRecord
      ? this.sessions.getBySessionId(rootRecord.rootSessionId)
      : null;
    if (rootSession?.debuggerSession) {
      rootSession.debuggerSession.targetId = liveTargetId;
    }

    const attachedRootSession = this.sessions.getAttachedRootSession(tabId);
    if (attachedRootSession?.debuggerSession) {
      attachedRootSession.debuggerSession.targetId = liveTargetId;
    }
  }

  private async resolveRootDebuggee(tabId: number): Promise<DebuggerSession> {
    const attachTargetId = await this.readDebuggerTargetId(tabId);
    if (attachTargetId) {
      this.rootTargetTabIds.set(attachTargetId, tabId);
      return { tabId, targetId: attachTargetId };
    }
    return { tabId };
  }

  private async attachChildTargetWithDebuggee(debuggee: DebuggerSession, targetId: string): Promise<string | null> {
    const result = await this.sendCommandOnce(
      debuggee,
      "Target.attachToTarget",
      { targetId, flatten: true }
    );
    const record = isRecord(result) ? result : {};
    const childSessionId = typeof record.sessionId === "string" ? record.sessionId : null;
    if (!childSessionId || typeof debuggee.tabId !== "number") {
      return childSessionId;
    }
    const targetInfo = this.resolveTargetInfo(targetId) ?? {
      targetId,
      type: "page",
      browserContextId: DEFAULT_BROWSER_CONTEXT_ID
    };
    this.sessions.registerChildSession(debuggee.tabId, targetInfo, childSessionId);
    return childSessionId;
  }

  private async attachChildTargetWithRootTargetId(
    debuggee: DebuggerSession,
    targetId: string,
    priorError?: unknown
  ): Promise<ChildTargetRootTargetRetryResult> {
    if (typeof debuggee.sessionId === "string" || typeof debuggee.tabId !== "number") {
      return {
        sessionId: null,
        stage: "missing_root_target_id"
      };
    }
    const rootTargetId = typeof debuggee.targetId === "string" && debuggee.targetId.length > 0
      ? debuggee.targetId
      : null;
    if (!rootTargetId) {
      return {
        sessionId: null,
        stage: "missing_root_target_id"
      };
    }
    try {
      const result = await this.sendCommandOnce(
        { targetId: rootTargetId },
        "Target.attachToTarget",
        {
          targetId,
          flatten: true
        }
      );
      const record = isRecord(result) ? result : {};
      const childSessionId = typeof record.sessionId === "string" ? record.sessionId : null;
      if (!childSessionId) {
        return {
          sessionId: null,
          stage: "attach_null"
        };
      }
      const targetInfo = this.resolveTargetInfo(targetId) ?? {
        targetId,
        type: "page",
        browserContextId: DEFAULT_BROWSER_CONTEXT_ID
      };
      this.sessions.registerChildSession(debuggee.tabId, targetInfo, childSessionId);
      return {
        sessionId: childSessionId,
        stage: "attached"
      };
    } catch (error) {
      if (priorError && isAttachBlockedError(priorError) && isAttachBlockedError(error)) {
        return {
          sessionId: null,
          stage: "attach_blocked",
          reason: getErrorMessage(error)
        };
      }
      if (priorError && this.isStaleTabError(priorError) && this.isStaleTabError(error)) {
        return {
          sessionId: null,
          stage: "attach_blocked",
          reason: getErrorMessage(error)
        };
      }
      throw error;
    }
  }

  private async reattachRootAndAttachChildTarget(tabId: number, targetId: string): Promise<ReattachChildTargetResult> {
    let result: ReattachChildTargetResult = { sessionId: null };
    try {
      let tabScopedRootDebuggee: DebuggerSession;
      try {
        tabScopedRootDebuggee = await this.reattachTabScopedRootDebuggeeForPopup(tabId);
      } catch (error) {
        result = {
          sessionId: null,
          terminalBranch: "tab_scoped_root_reattach",
          stage: "tab_scoped_root_reattach_failed",
          reason: getErrorMessage(error)
        };
        return result;
      }
      try {
        const tabScopedSessionId = await this.attachChildTargetWithDebuggee(tabScopedRootDebuggee, targetId);
        if (tabScopedSessionId) {
          result = { sessionId: tabScopedSessionId };
          return result;
        }
      } catch (tabScopedError) {
        if (!isAttachBlockedError(tabScopedError) && !this.isStaleTabError(tabScopedError)) {
          result = {
            sessionId: null,
            terminalBranch: "tab_scoped_root_reattach",
            stage: "tab_scoped_attach_failed",
            reason: getErrorMessage(tabScopedError)
          };
          return result;
        }
      }

      try {
        await this.reattachRootDebuggee(tabId);
        const rootDebuggee = await this.resolveRootSessionDebuggee(tabId);
        const rootSessionId = await this.attachChildTargetWithDebuggee(rootDebuggee, targetId);
        result = rootSessionId
          ? { sessionId: rootSessionId }
          : {
            sessionId: null,
            terminalBranch: "root_debuggee_reattach",
            stage: "root_debuggee_attach_null"
          };
      } catch (error) {
        const blocked = isAttachBlockedError(error) || this.isStaleTabError(error);
        result = {
          sessionId: null,
          terminalBranch: "root_debuggee_reattach",
          stage: blocked ? "root_debuggee_attach_blocked" : "root_debuggee_attach_failed",
          reason: getErrorMessage(error)
        };
      }
      return result;
    } catch (error) {
      result = {
        sessionId: null,
        terminalBranch: "root_debuggee_reattach",
        stage: "root_debuggee_reattach_failed",
        reason: getErrorMessage(error)
      };
      return result;
    } finally {
      if (!result.sessionId) {
        await this.restoreRootAfterChildAttachFailure(tabId);
      }
    }
  }

  private async reattachTabScopedRootDebuggeeForPopup(tabId: number): Promise<DebuggerSession> {
    const existing = this.debuggees.get(tabId);
    this.debuggees.delete(tabId);
    this.detachTabState(tabId);
    if (existing) {
      this.markExpectedRootDetach(tabId);
      await this.safeDetach(existing);
    }
    this.ensureListeners();

    const resolvedRootDebuggee = await this.resolveRootDebuggee(tabId);
    const tabScopedDebuggee: DebuggerSession = typeof resolvedRootDebuggee.targetId === "string" && resolvedRootDebuggee.targetId.length > 0
      ? { tabId, targetId: resolvedRootDebuggee.targetId }
      : { tabId };
    await this.attachRootDebuggee(tabScopedDebuggee);
    this.debuggees.set(tabId, tabScopedDebuggee);
    await this.registerRootTab(tabId);
    this.updatePrimaryTab(tabId);
    return await this.resolveRootSessionDebuggee(tabId);
  }

  private async restoreRootAfterChildAttachFailure(tabId: number): Promise<void> {
    try {
      await this.refreshTabAttachment(tabId);
    } catch {
      // Best-effort root restoration only. The original popup attach error remains authoritative.
    }
  }

  private async reattachRootDebuggee(tabId: number, allowRetry: boolean = false): Promise<void> {
    const existing = this.debuggees.get(tabId);
    this.debuggees.delete(tabId);
    this.detachTabState(tabId);
    if (existing) {
      this.markExpectedRootDetach(tabId);
      await this.safeDetach(existing);
    }
    await this.attachInternal(tabId, allowRetry);
  }

  private async readDebuggerPageTargets(tabId: number): Promise<{ tab: chrome.tabs.Tab | null; pageTargets: DebuggerTargetInfo[] }> {
    const tab = await this.tabManager.getTab(tabId);
    const targets = await new Promise<DebuggerTargetInfo[]>((resolve) => {
      chrome.debugger.getTargets((records) => {
        const lastError = chrome.runtime.lastError;
        if (lastError || !Array.isArray(records)) {
          resolve([]);
          return;
        }
        resolve(records as DebuggerTargetInfo[]);
      });
    });
    const pageTargets = targets.filter((target) => target.tabId === tabId && target.type === "page");
    return { tab: tab ?? null, pageTargets };
  }

  private selectPreferredDebuggerTargetInfo(
    tab: chrome.tabs.Tab | null,
    pageTargets: DebuggerTargetInfo[]
  ): DebuggerTargetInfo | null {
    if (pageTargets.length === 0) {
      return null;
    }
    const liveTargets = pageTargets.some((target) => target.attached)
      ? pageTargets.filter((target) => target.attached)
      : pageTargets;
    const preferredByUrl = typeof tab?.url === "string"
      ? liveTargets.find((target) => target.url === tab.url)
      : null;
    const preferredByTitle = typeof tab?.title === "string"
      ? liveTargets.find((target) => target.title === tab.title)
      : null;
    return preferredByUrl ?? preferredByTitle ?? liveTargets[0] ?? null;
  }

  private async readDebuggerTargetInfo(tabId: number): Promise<DebuggerTargetInfo | null> {
    const { tab, pageTargets } = await this.readDebuggerPageTargets(tabId);
    return this.selectPreferredDebuggerTargetInfo(tab, pageTargets);
  }

  private async readDebuggerTargetId(tabId: number): Promise<string | null> {
    return (await this.readDebuggerTargetInfo(tabId))?.id ?? null;
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
      await this.sendCommand(
        debuggee,
        "Target.setAutoAttach",
        {
          autoAttach: false,
          waitForDebuggerOnStart: false,
          flatten: true
        },
        { preserveTab: true, refreshPreparedDebuggee: false }
      );
      this.flatSessionValidated = true;
    } catch (error) {
      const detail = getErrorMessage(error);
      console.warn(`[opendevbrowser] Target.setAutoAttach(flatten) failed: ${detail}`);
      throw new Error(`${FLAT_SESSION_ERROR} (${detail})`);
    }
  }

  private async applyDiscoverTargets(debuggee: DebuggerSession, discover: boolean): Promise<void> {
    const rootTrackingDebuggee = this.resolveRootTrackingDebuggee(debuggee);
    await this.sendCommand(
      rootTrackingDebuggee,
      "Target.setDiscoverTargets",
      { discover },
      { preserveTab: true, refreshPreparedDebuggee: false }
    );
  }

  private async applyAutoAttach(debuggee: DebuggerSession): Promise<void> {
    const rootTrackingDebuggee = this.resolveRootTrackingDebuggee(debuggee);
    const params: Record<string, unknown> = {
      autoAttach: this.autoAttachOptions.autoAttach,
      waitForDebuggerOnStart: this.autoAttachOptions.waitForDebuggerOnStart,
      flatten: true
    };
    if (typeof this.autoAttachOptions.filter !== "undefined") {
      params.filter = this.autoAttachOptions.filter;
    }
    try {
      await this.sendCommand(rootTrackingDebuggee, "Target.setAutoAttach", params, { preserveTab: true, refreshPreparedDebuggee: false });
    } catch (error) {
      const detail = getErrorMessage(error);
      console.warn(`[opendevbrowser] Target.setAutoAttach failed: ${detail}`);
      throw new Error(`${FLAT_SESSION_ERROR} (${detail})`);
    }
  }

  private resolveRootTrackingDebuggee(debuggee: DebuggerSession): DebuggerSession {
    const rootDebuggee = typeof debuggee.tabId === "number"
      ? (this.debuggees.get(debuggee.tabId) as DebuggerSession | undefined) ?? debuggee
      : debuggee;
    if (
      rootDebuggee.attachBy === "targetId"
      && typeof rootDebuggee.targetId === "string"
      && rootDebuggee.targetId.length > 0
    ) {
      return {
        ...(typeof rootDebuggee.tabId === "number" ? { tabId: rootDebuggee.tabId } : {}),
        targetId: rootDebuggee.targetId,
        attachBy: "targetId"
      };
    }
    if (typeof rootDebuggee.sessionId === "string" && typeof rootDebuggee.tabId === "number") {
      return { tabId: rootDebuggee.tabId };
    }
    return rootDebuggee;
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
    const tabId = this.resolveEventTabId(source, params);
    if (tabId === null || !this.debuggees.has(tabId)) return;
    if (method === "Target.receivedMessageFromTarget") return;

    if (method === "Target.targetCreated" && params && isRecord(params)) {
      const targetInfo = isTargetInfo(params.targetInfo) ? params.targetInfo : null;
      if (targetInfo) {
        this.pendingTargetTabIds.set(targetInfo.targetId, tabId);
      }
    }

    if (method === "Target.attachedToTarget" && params && isRecord(params)) {
      const sessionId = typeof params.sessionId === "string" ? params.sessionId : null;
      const targetInfo = isTargetInfo(params.targetInfo) ? params.targetInfo : null;
      if (sessionId && targetInfo) {
        this.pendingTargetTabIds.delete(targetInfo.targetId);
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
      const detachedTargetId = typeof params.targetId === "string" ? params.targetId : null;
      if (detachedTargetId) {
        this.pendingTargetTabIds.delete(detachedTargetId);
      }
      if (detachedSessionId) {
        const removed = this.sessions.removeBySessionId(detachedSessionId);
        if (!removed) {
          this.recordSessionChurn(tabId, detachedSessionId, "detach_unknown");
          this.quarantineUnknownSession(tabId, detachedSessionId, method);
          return;
        }
      }
    }

    if (method === "Target.targetDestroyed" && params && isRecord(params)) {
      const targetId = typeof params.targetId === "string" ? params.targetId : null;
      if (targetId) {
        this.pendingTargetTabIds.delete(targetId);
      }
    }

    const sourceSessionId = (source as { sessionId?: string }).sessionId;
    if (
      typeof sourceSessionId === "string"
      && !this.sessions.hasSession(sourceSessionId)
      && !this.shouldAllowUnknownSourceSession(method, source, tabId)
    ) {
      this.quarantineUnknownSession(tabId, sourceSessionId, method);
      return;
    }

    const forwardSessionId = this.resolveForwardSessionId(method, source);
    this.emitEvent(tabId, method, params, forwardSessionId);
  }

  private handleDetach(source: chrome.debugger.Debuggee, reason?: string): void {
    if (this.consumeExpectedRootDetach(source)) return;
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
    this.expectedRootDetachDeadlines.delete(tabId);
    this.clearRootAttachDiagnostic(tabId);
    const record = this.sessions.removeByTabId(tabId);
    for (const [key, diagnostic] of this.childAttachDiagnostics.entries()) {
      if (diagnostic.tabId === tabId) {
        this.childAttachDiagnostics.delete(key);
      }
    }
    for (const [targetId, mappedTabId] of this.pendingTargetTabIds.entries()) {
      if (mappedTabId === tabId) {
        this.pendingTargetTabIds.delete(targetId);
      }
    }
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

  private resolveEventTabId(source: chrome.debugger.Debuggee, params?: object): number | null {
    const sourceTabId = this.resolveSourceTabId(source);
    if (sourceTabId !== null) {
      return sourceTabId;
    }
    if (!params || !isRecord(params)) {
      return null;
    }
    const targetInfo = isTargetInfo(params.targetInfo) ? params.targetInfo : null;
    const openerTabId = this.resolveLinkedTargetTabId(targetInfo?.openerId);
    if (openerTabId !== null) {
      if (targetInfo) {
        this.pendingTargetTabIds.set(targetInfo.targetId, openerTabId);
      }
      return openerTabId;
    }
    if (targetInfo) {
      const targetTabId = this.resolveLinkedTargetTabId(targetInfo.targetId);
      if (targetTabId !== null) {
        return targetTabId;
      }
    }
    const targetId = typeof params.targetId === "string" ? params.targetId : null;
    if (targetId) {
      return this.resolveLinkedTargetTabId(targetId);
    }
    const sessionId = typeof params.sessionId === "string" ? params.sessionId : null;
    if (sessionId) {
      return this.sessions.getBySessionId(sessionId)?.tabId ?? null;
    }
    return null;
  }

  resolveSourceTabId(source: chrome.debugger.Debuggee): number | null {
    if (typeof source.tabId === "number") {
      return source.tabId;
    }
    const sourceSessionId = (source as { sessionId?: string }).sessionId;
    if (typeof sourceSessionId === "string") {
      const knownTabId = this.sessions.getBySessionId(sourceSessionId)?.tabId
        ?? this.quarantinedSessions.get(sourceSessionId)?.tabId
        ?? null;
      if (typeof knownTabId === "number") {
        return knownTabId;
      }
      if (this.debuggees.size === 1) {
        const nextAttachedTab = this.debuggees.keys().next();
        return nextAttachedTab.done ? null : nextAttachedTab.value;
      }
      return null;
    }
    if (typeof source.targetId === "string") {
      return this.resolveLinkedTargetTabId(source.targetId);
    }
    return null;
  }

  private shouldAllowUnknownSourceSession(method: string, source: chrome.debugger.Debuggee, tabId: number): boolean {
    if (
      method !== "Page.javascriptDialogOpening"
      && method !== "Page.javascriptDialogClosed"
      && method !== "Page.fileChooserOpened"
    ) {
      return false;
    }
    if (typeof source.tabId === "number") {
      return source.tabId === tabId;
    }
    if (typeof source.targetId === "string") {
      return this.resolveLinkedTargetTabId(source.targetId) === tabId;
    }
    if (typeof (source as { sessionId?: string }).sessionId === "string") {
      return this.resolveSourceTabId(source) === tabId;
    }
    return false;
  }

  private resolveLinkedTargetTabId(targetId?: string): number | null {
    if (typeof targetId !== "string" || targetId.length === 0) {
      return null;
    }
    return parseTabTargetAlias(targetId)
      ?? this.rootTargetTabIds.get(targetId)
      ?? this.sessions.getByTargetId(targetId)?.tabId
      ?? this.sessions.getTabIdByTargetAlias(targetId)
      ?? this.pendingTargetTabIds.get(targetId)
      ?? null;
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

  private childAttachDiagnosticKey(tabId: number, targetId: string): string {
    return `${tabId}:${targetId}`;
  }

  private resolveRootAttachBy(debuggee: DebuggerSession): NonNullable<DebuggerSession["attachBy"]> {
    return debuggee.attachBy === "targetId" ? "targetId" : "tabId";
  }

  private clearRootAttachDiagnostic(tabId: number): void {
    this.rootAttachDiagnostics.delete(tabId);
  }

  private recordRootAttachDiagnostic(
    tabId: number,
    diagnostic: Omit<RootAttachDiagnostic, "tabId" | "at">
  ): void {
    this.rootAttachDiagnostics.set(tabId, {
      tabId,
      at: Date.now(),
      ...diagnostic
    });
  }

  private clearChildAttachDiagnostic(tabId: number, targetId: string): void {
    this.childAttachDiagnostics.delete(this.childAttachDiagnosticKey(tabId, targetId));
  }

  private recordChildAttachDiagnostic(
    tabId: number,
    targetId: string,
    diagnostic: Omit<ChildTargetAttachDiagnostic, "tabId" | "targetId" | "at">
  ): void {
    this.childAttachDiagnostics.set(this.childAttachDiagnosticKey(tabId, targetId), {
      tabId,
      targetId,
      at: Date.now(),
      ...diagnostic
    });
  }

  private async captureRootRefreshDiagnostic(
    tabId: number,
    path: RootRefreshPath,
    refreshCompleted: boolean,
    error?: unknown
  ): Promise<void> {
    const attachedDebuggee = this.debuggees.get(tabId) ?? null;
    const rootRecord = this.sessions.getByTabId(tabId);
    const rootSession = rootRecord
      ? this.sessions.getBySessionId(rootRecord.rootSessionId)
      : null;
    const debuggee = attachedDebuggee ?? rootSession?.debuggerSession ?? null;
    const rootTargetIdAfterRefresh = typeof debuggee?.targetId === "string" && debuggee.targetId.length > 0
      ? debuggee.targetId
      : undefined;

    let probeStage: RootRefreshProbeStage = refreshCompleted ? "missing_debuggee" : "skipped";
    let probeReason: string | undefined;
    if (refreshCompleted && debuggee) {
      try {
        await this.sendCommandOnce(debuggee, "Target.getTargets", {});
        probeStage = "succeeded";
      } catch (probeError) {
        probeStage = "failed";
        probeReason = getErrorMessage(probeError);
      }
    }

    this.rootRefreshDiagnostics.set(tabId, {
      tabId,
      path,
      refreshCompleted,
      debuggeePresentAfterRefresh: attachedDebuggee !== null,
      rootSessionPresentAfterRefresh: rootSession !== null,
      ...(rootTargetIdAfterRefresh ? { rootTargetIdAfterRefresh } : {}),
      probeMethod: "Target.getTargets",
      probeStage,
      ...(probeReason ? { probeReason } : {}),
      ...(error ? { reason: getErrorMessage(error) } : {}),
      at: Date.now()
    });
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
        this.sendCommand({ tabId }, "Page.getFrameTree", {}, { preserveTab: true }),
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

  async sendCommand(
    debuggee: DebuggerSession,
    method: string,
    params: Record<string, unknown>,
    options: SendCommandOptions = {}
  ): Promise<unknown> {
    const preferredTabId = this.resolveSourceTabId(debuggee);
    const refreshCommandDebuggee = options.refreshPreparedDebuggee !== false
      && this.shouldRefreshPreparedCommandDebuggee(debuggee, preferredTabId);
    await this.prepareForNextClientIfNeeded(preferredTabId);
    const commandDebuggee = refreshCommandDebuggee && preferredTabId !== null
      ? (this.getTabDebuggee(preferredTabId) ?? debuggee)
      : debuggee;
    try {
      return await this.sendCommandOnce(commandDebuggee, method, params);
    } catch (error) {
      const hasChildSession = typeof (commandDebuggee as { sessionId?: unknown }).sessionId === "string";
      if (!this.isStaleTabError(error) || hasChildSession) {
        throw error;
      }

      const retainedRootDebuggee = this.resolveRetainedRootTargetDebuggee(commandDebuggee);
      if (retainedRootDebuggee) {
        try {
          return await this.sendCommandOnce(retainedRootDebuggee, method, params);
        } catch (retainedError) {
          if (!this.isStaleTabError(retainedError)) {
            throw retainedError;
          }
          error = retainedError;
        }
      }

      const recovered = await this.recoverFromStaleTab(commandDebuggee, options.preserveTab === true);
      if (!recovered) {
        throw error;
      }
      return await this.sendCommandOnce(recovered, method, params);
    }
  }

  private shouldRefreshPreparedCommandDebuggee(debuggee: DebuggerSession, preferredTabId: number | null): boolean {
    if (preferredTabId === null) {
      return false;
    }
    if (typeof debuggee.sessionId !== "string") {
      return true;
    }
    const sessionRecord = this.sessions.getBySessionId(debuggee.sessionId);
    const rootRecord = this.sessions.getByTabId(preferredTabId);
    return Boolean(
      sessionRecord
      && rootRecord
      && sessionRecord.tabId === preferredTabId
      && sessionRecord.targetId === rootRecord.targetInfo.targetId
    );
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

  private resolveRetainedRootTargetDebuggee(debuggee: DebuggerSession): DebuggerSession | null {
    if (typeof debuggee.sessionId === "string") {
      return null;
    }
    const staleTabId = typeof debuggee.tabId === "number"
      ? debuggee.tabId
      : (typeof debuggee.targetId === "string" ? this.rootTargetTabIds.get(debuggee.targetId) ?? null : null);
    if (staleTabId === null) {
      return null;
    }

    const targetId = this.resolveRetainedRootTargetId(staleTabId);
    if (!targetId) {
      return null;
    }
    if (typeof debuggee.targetId === "string" && debuggee.targetId === targetId && typeof debuggee.tabId !== "number") {
      return null;
    }
    return { targetId };
  }

  private resolveRetainedRootTargetId(tabId: number): string | null {
    const attachedDebuggee = this.debuggees.get(tabId);
    if (typeof attachedDebuggee?.targetId === "string" && attachedDebuggee.targetId.length > 0) {
      return attachedDebuggee.targetId;
    }

    const rootRecord = this.sessions.getByTabId(tabId);
    const rootSession = rootRecord
      ? this.sessions.getBySessionId(rootRecord.rootSessionId)
      : null;
    if (typeof rootSession?.debuggerSession?.targetId === "string" && rootSession.debuggerSession.targetId.length > 0) {
      return rootSession.debuggerSession.targetId;
    }
    if (typeof rootRecord?.attachTargetId === "string" && rootRecord.attachTargetId.length > 0) {
      return rootRecord.attachTargetId;
    }
    return null;
  }

  private async recoverFromStaleTab(debuggee: DebuggerSession, preserveTab: boolean): Promise<DebuggerSession | null> {
    const staleTabId = typeof debuggee.tabId === "number"
      ? debuggee.tabId
      : (typeof debuggee.targetId === "string" ? this.rootTargetTabIds.get(debuggee.targetId) ?? null : null);
    if (staleTabId === null) {
      return null;
    }

    try {
      await this.reattachRootDebuggee(staleTabId, !preserveTab);
    } catch {
      return null;
    }

    return preserveTab
      ? this.debuggees.get(staleTabId) ?? null
      : this.debuggees.get(staleTabId) ?? this.getPrimaryDebuggee();
  }

  private isStaleTabError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return STALE_TAB_ERROR_MARKERS.some((marker) => message.includes(marker));
  }

  private isExpectedDebuggerCleanupError(error: unknown): boolean {
    return this.isStaleTabError(error);
  }

  private markExpectedRootDetach(tabId: number): void {
    this.expectedRootDetachDeadlines.set(tabId, Date.now() + 1000);
  }

  private consumeExpectedRootDetach(source: chrome.debugger.Debuggee): boolean {
    const tabId = this.resolveSourceTabId(source);
    if (tabId === null) {
      return false;
    }
    const deadline = this.expectedRootDetachDeadlines.get(tabId);
    if (typeof deadline !== "number") {
      return false;
    }
    const sourceSessionId = (source as { sessionId?: string }).sessionId;
    if (typeof sourceSessionId === "string") {
      return false;
    }
    this.expectedRootDetachDeadlines.delete(tabId);
    return deadline >= Date.now();
  }

  private toChromeDebuggee(debuggee: DebuggerSession): chrome.debugger.Debuggee {
    if (typeof debuggee.sessionId === "string") {
      if (typeof debuggee.targetId === "string" && debuggee.targetId.length > 0) {
        return { targetId: debuggee.targetId, sessionId: debuggee.sessionId } as chrome.debugger.Debuggee;
      }
      return { tabId: debuggee.tabId as number, sessionId: debuggee.sessionId } as chrome.debugger.Debuggee;
    }
    if (debuggee.attachBy === "targetId" && typeof debuggee.targetId === "string" && debuggee.targetId.length > 0) {
      return { targetId: debuggee.targetId } as chrome.debugger.Debuggee;
    }
    if (typeof debuggee.tabId === "number") {
      return { tabId: debuggee.tabId } as chrome.debugger.Debuggee;
    }
    return { targetId: debuggee.targetId as string } as chrome.debugger.Debuggee;
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
      if (this.isExpectedDebuggerCleanupError(error)) {
        return;
      }
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

const parseTabTargetAlias = (targetId?: string): number | null => {
  if (typeof targetId !== "string") {
    return null;
  }
  const match = /^tab-(\d+)$/.exec(targetId);
  if (!match) {
    return null;
  }
  const parsed = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(parsed) ? parsed : null;
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
