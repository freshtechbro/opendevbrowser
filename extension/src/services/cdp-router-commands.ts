import type { RelayCommand, RelayResponse } from "../types.js";
import type { TargetInfo, DebuggerSession, SessionRecord, TargetSessionMap } from "./TargetSessionMap.js";
import type { TabManager } from "./TabManager.js";

export type AutoAttachOptions = {
  autoAttach: boolean;
  waitForDebuggerOnStart: boolean;
  flatten: boolean;
  filter?: unknown;
};

export type RouterCommandContext = {
  debuggees: Map<number, chrome.debugger.Debuggee>;
  sessions: TargetSessionMap;
  tabManager: TabManager;
  autoAttachOptions: AutoAttachOptions;
  discoverTargets: boolean;
  flatSessionError: string;
  setAutoAttachOptions: (next: AutoAttachOptions) => void;
  setDiscoverTargets: (value: boolean) => void;
  respond: (id: RelayResponse["id"], result: unknown, sessionId?: string) => void;
  respondError: (id: RelayResponse["id"], message: string, sessionId?: string) => void;
  emitEvent: (method: string, params: unknown, sessionId?: string) => void;
  emitTargetCreated: (targetInfo: TargetInfo) => void;
  emitRootAttached: (targetInfo: TargetInfo) => void;
  emitRootDetached: () => void;
  resetRootAttached: () => void;
  updatePrimaryTab: (tabId: number | null) => void;
  detachTabState: (tabId: number) => void;
  safeDetach: (debuggee: chrome.debugger.Debuggee) => Promise<void>;
  attach: (tabId: number) => Promise<void>;
  registerRootTab: (tabId: number) => Promise<TargetInfo>;
  refreshRootTargetInfo: (tabId: number) => Promise<TargetInfo>;
  applyAutoAttach: (debuggee: chrome.debugger.Debuggee) => Promise<void>;
  sendCommand: (debuggee: DebuggerSession, method: string, params: Record<string, unknown>) => Promise<unknown>;
  getPrimaryDebuggee: () => DebuggerSession | null;
  resolveCommandDebuggee: (sessionId?: string) => Promise<DebuggerSession | null>;
};

export async function handleSetDiscoverTargets(
  ctx: RouterCommandContext,
  commandId: RelayCommand["id"],
  params: Record<string, unknown>
): Promise<void> {
  const discover = params.discover === true;
  const shouldEmit = discover && !ctx.discoverTargets;
  ctx.setDiscoverTargets(discover);
  if (shouldEmit) {
    for (const targetInfo of ctx.sessions.listTargetInfos()) {
      ctx.emitTargetCreated(targetInfo);
    }
  }
  ctx.respond(commandId, {});
}

export async function handleSetAutoAttach(
  ctx: RouterCommandContext,
  commandId: RelayCommand["id"],
  params: Record<string, unknown>,
  sessionId?: string
): Promise<void> {
  if (params.flatten === false) {
    ctx.respondError(commandId, ctx.flatSessionError, sessionId);
    return;
  }

  const autoAttach = params.autoAttach === true;
  const waitForDebuggerOnStart = params.waitForDebuggerOnStart === true;
  ctx.setAutoAttachOptions({ autoAttach, waitForDebuggerOnStart, flatten: true, filter: params.filter });
  if (autoAttach && !sessionId) {
    ctx.resetRootAttached();
  }

  try {
    if (sessionId) {
      const session = ctx.sessions.getBySessionId(sessionId);
      if (!session) {
        ctx.respondError(commandId, `Unknown sessionId: ${sessionId}`, sessionId);
        return;
      }
      await ctx.sendCommand(session.debuggerSession, "Target.setAutoAttach", {
        autoAttach,
        waitForDebuggerOnStart,
        flatten: true,
        ...(typeof params.filter !== "undefined" ? { filter: params.filter } : {})
      });
    } else {
      for (const debuggee of ctx.debuggees.values()) {
        await ctx.applyAutoAttach(debuggee);
      }
    }
  } catch (error) {
    ctx.respondError(commandId, getErrorMessage(error));
    return;
  }

  if (sessionId) {
    ctx.respond(commandId, {}, sessionId);
    return;
  }

  if (!autoAttach) {
    ctx.emitRootDetached();
  } else {
    for (const tabId of ctx.sessions.listTabIds()) {
      await ctx.refreshRootTargetInfo(tabId);
    }
    for (const targetInfo of ctx.sessions.listTargetInfos()) {
      ctx.emitRootAttached(targetInfo);
    }
  }

  ctx.respond(commandId, {});
}

export async function handleCreateTarget(
  ctx: RouterCommandContext,
  commandId: RelayCommand["id"],
  params: Record<string, unknown>
): Promise<void> {
  const url = typeof params.url === "string" ? params.url : undefined;
  const background = params.background === true;
  let createdTabId: number | null = null;

  try {
    const tab = await ctx.tabManager.createTab(url, !background);
    if (typeof tab.id !== "number") {
      throw new Error("Target.createTarget did not yield a tab id");
    }
    createdTabId = tab.id;
    await ctx.tabManager.waitForTabComplete(tab.id);
    await ctx.attach(tab.id);
    await ctx.sessions.waitForRootSession(tab.id);
    await ctx.sendCommand({ tabId: tab.id }, "Target.getTargets", {});

    await ctx.registerRootTab(tab.id);
    const targetInfo = await ctx.refreshRootTargetInfo(tab.id);
    if (ctx.discoverTargets) {
      ctx.emitTargetCreated(targetInfo);
    }
    if (ctx.autoAttachOptions.autoAttach) {
      ctx.emitRootAttached(targetInfo);
    }
    if (!background) {
      ctx.updatePrimaryTab(tab.id);
    }

    ctx.respond(commandId, { targetId: targetInfo.targetId });
  } catch (error) {
    if (createdTabId !== null) {
      const debuggee = ctx.debuggees.get(createdTabId) ?? null;
      ctx.detachTabState(createdTabId);
      if (debuggee) {
        await ctx.safeDetach(debuggee);
      }
      try {
        await ctx.tabManager.closeTab(createdTabId);
      } catch {
        // Best-effort cleanup for partially created targets.
      }
    }
    ctx.respondError(commandId, getErrorMessage(error));
  }
}

export async function handleCloseTarget(
  ctx: RouterCommandContext,
  commandId: RelayCommand["id"],
  params: Record<string, unknown>
): Promise<void> {
  const targetId = typeof params.targetId === "string" ? params.targetId : null;
  if (!targetId) {
    ctx.respondError(commandId, "Missing targetId");
    return;
  }
  const session = ctx.sessions.getByTargetId(targetId);
  if (!session || session.kind !== "root") {
    ctx.respondError(commandId, "Target not found");
    return;
  }

  try {
    const debuggee = ctx.debuggees.get(session.tabId) ?? null;
    ctx.detachTabState(session.tabId);
    if (debuggee) {
      await ctx.safeDetach(debuggee);
    }
    await ctx.tabManager.closeTab(session.tabId);
    ctx.respond(commandId, { success: true });
  } catch (error) {
    ctx.respondError(commandId, getErrorMessage(error));
  }
}

export async function handleActivateTarget(
  ctx: RouterCommandContext,
  commandId: RelayCommand["id"],
  params: Record<string, unknown>
): Promise<void> {
  const targetId = typeof params.targetId === "string" ? params.targetId : null;
  if (!targetId) {
    ctx.respondError(commandId, "Missing targetId");
    return;
  }
  const session = ctx.sessions.getByTargetId(targetId);
  if (!session || session.kind !== "root") {
    ctx.respondError(commandId, "Target not found");
    return;
  }

  try {
    await ctx.tabManager.activateTab(session.tabId);
    ctx.updatePrimaryTab(session.tabId);
    ctx.respond(commandId, {});
  } catch (error) {
    ctx.respondError(commandId, getErrorMessage(error));
  }
}

export async function handleAttachToTarget(
  ctx: RouterCommandContext,
  commandId: RelayCommand["id"],
  params: Record<string, unknown>,
  sessionId?: string
): Promise<void> {
  const targetId = typeof params.targetId === "string" ? params.targetId : null;
  if (!targetId) {
    ctx.respondError(commandId, "Missing targetId", sessionId);
    return;
  }
  if (params.flatten === false) {
    ctx.respondError(commandId, ctx.flatSessionError, sessionId);
    return;
  }

  const targetSession = ctx.sessions.getByTargetId(targetId);
  if (targetSession && targetSession.kind === "root") {
    ctx.respond(commandId, { sessionId: targetSession.sessionId }, sessionId);
    return;
  }

  const session = sessionId ? ctx.sessions.getBySessionId(sessionId) : null;
  if (sessionId && !session) {
    ctx.respondError(commandId, `Unknown sessionId: ${sessionId}`, sessionId);
    return;
  }

  const debuggee = session?.debuggerSession ?? ctx.getPrimaryDebuggee();
  if (!debuggee) {
    ctx.respondError(commandId, "No tab attached", sessionId);
    return;
  }

  try {
    const result = await ctx.sendCommand(debuggee, "Target.attachToTarget", { targetId, flatten: true });
    const record = isRecord(result) ? result : {};
    const childSessionId = typeof record.sessionId === "string" ? record.sessionId : null;
    if (childSessionId) {
      const targetInfo: TargetInfo = {
        targetId,
        type: "page",
        browserContextId: "default"
      };
      ctx.sessions.registerChildSession(debuggee.tabId as number, targetInfo, childSessionId);
    }
    ctx.respond(commandId, result);
  } catch (error) {
    ctx.respondError(commandId, getErrorMessage(error), sessionId);
  }
}

export async function handleRoutedCommand(
  ctx: RouterCommandContext,
  commandId: RelayCommand["id"],
  method: string,
  params: Record<string, unknown>,
  sessionId?: string
): Promise<void> {
  const session = sessionId ? ctx.sessions.getBySessionId(sessionId) : null;
  const compatSession = resolveSyntheticCompatSession(ctx, session, sessionId);
  if (compatSession) {
    const compatResult = buildSyntheticRootCompatResult(compatSession, method, commandId);
    if (compatResult) {
      ctx.respond(commandId, compatResult.result, sessionId);
      if (compatResult.emitExecutionContext) {
        ctx.emitEvent("Runtime.executionContextCreated", compatResult.emitExecutionContext, sessionId);
      }
      return;
    }
  }
  if (sessionId && !session) {
    ctx.respondError(commandId, `Unknown sessionId: ${sessionId}`, sessionId);
    return;
  }

  const debuggee = await ctx.resolveCommandDebuggee(sessionId);
  if (!debuggee) {
    ctx.respondError(commandId, "No tab attached", sessionId);
    return;
  }

  try {
    const result = await ctx.sendCommand(debuggee, method, params);
    ctx.respond(commandId, result, sessionId);
  } catch (error) {
    ctx.respondError(commandId, getErrorMessage(error), sessionId);
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
};

const SYNTHETIC_ROOT_NOOP_METHODS = new Set<string>([
  "Runtime.runIfWaitingForDebugger",
  "Emulation.setFocusEmulationEnabled",
  "Emulation.setEmulatedMedia"
]);

const resolveSyntheticCompatSession = (
  ctx: RouterCommandContext,
  session: SessionRecord | null,
  sessionId?: string
): SessionRecord | null => {
  if (session && isSyntheticSessionId(session.sessionId)) {
    return session;
  }
  if (!isSyntheticSessionId(sessionId)) {
    return null;
  }
  const primary = ctx.getPrimaryDebuggee();
  if (typeof primary?.tabId !== "number") {
    return null;
  }
  const record = ctx.sessions.getByTabId(primary.tabId);
  if (!record) {
    return null;
  }
  const rootSession = ctx.sessions.getBySessionId(record.rootSessionId);
  if (rootSession) {
    return rootSession;
  }
  return {
    kind: "root",
    sessionId,
    tabId: record.tabId,
    targetId: record.targetInfo.targetId,
    debuggerSession: primary,
    targetInfo: record.targetInfo
  };
};

type SyntheticRootFrame = {
  id: string;
  loaderId: string;
  url: string;
  securityOrigin: string;
  mimeType: string;
};

const buildSyntheticRootCompatResult = (
  session: SessionRecord,
  method: string,
  commandId: RelayCommand["id"]
): { result: unknown; emitExecutionContext?: Record<string, unknown> } | null => {
  if (SYNTHETIC_ROOT_NOOP_METHODS.has(method)) {
    return { result: {} };
  }
  const frame = buildSyntheticRootFrame(session);
  if (method === "Page.getFrameTree") {
    return { result: { frameTree: { frame } } };
  }
  if (method === "Page.addScriptToEvaluateOnNewDocument") {
    return { result: { identifier: `odb-root-script-${String(commandId)}` } };
  }
  if (method === "Runtime.enable") {
    return {
      result: {},
      emitExecutionContext: {
        context: {
          id: 1,
          origin: deriveSecurityOrigin(frame.url),
          name: "",
          auxData: {
            frameId: frame.id,
            isDefault: true,
            type: "default"
          }
        }
      }
    };
  }
  return null;
};

const buildSyntheticRootFrame = (session: SessionRecord): SyntheticRootFrame => {
  const targetInfo = session.targetInfo;
  const url = typeof targetInfo?.url === "string" ? targetInfo.url : "";
  return {
    id: session.targetId,
    loaderId: session.targetId,
    url,
    securityOrigin: deriveSecurityOrigin(url),
    mimeType: "text/html"
  };
};

const deriveSecurityOrigin = (url: string): string => {
  if (!url) {
    return "";
  }
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
};

const isSyntheticSessionId = (value?: string): value is string => {
  return typeof value === "string" && value.startsWith("pw-tab-");
};
