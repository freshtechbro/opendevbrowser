import type { RelayCommand, RelayResponse } from "../types.js";
import type { TargetInfo, DebuggerSession, TargetSessionMap } from "./TargetSessionMap.js";
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
  emitTargetCreated: (targetInfo: TargetInfo) => void;
  emitRootAttached: (targetInfo: TargetInfo) => void;
  emitRootDetached: () => void;
  resetRootAttached: () => void;
  updatePrimaryTab: (tabId: number | null) => void;
  detachTabState: (tabId: number) => void;
  safeDetach: (debuggee: chrome.debugger.Debuggee) => Promise<void>;
  attach: (tabId: number) => Promise<void>;
  registerRootTab: (tabId: number) => Promise<TargetInfo>;
  applyAutoAttach: (debuggee: chrome.debugger.Debuggee) => Promise<void>;
  sendCommand: (debuggee: DebuggerSession, method: string, params: object) => Promise<unknown>;
  getPrimaryDebuggee: () => DebuggerSession | null;
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

  if (sessionId) {
    ctx.respond(commandId, {}, sessionId);
    return;
  }

  const autoAttach = params.autoAttach === true;
  const waitForDebuggerOnStart = params.waitForDebuggerOnStart === true;
  ctx.setAutoAttachOptions({ autoAttach, waitForDebuggerOnStart, flatten: true, filter: params.filter });
  if (autoAttach && !sessionId) {
    ctx.resetRootAttached();
  }

  try {
    for (const debuggee of ctx.debuggees.values()) {
      await ctx.applyAutoAttach(debuggee);
    }
  } catch (error) {
    ctx.respondError(commandId, getErrorMessage(error));
    return;
  }

  if (!autoAttach) {
    ctx.emitRootDetached();
  } else {
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

  try {
    const tab = await ctx.tabManager.createTab(url, !background);
    if (typeof tab.id !== "number") {
      throw new Error("Target.createTarget did not yield a tab id");
    }
    await ctx.attach(tab.id);

    const targetInfo = await ctx.registerRootTab(tab.id);
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

  const debuggee = ctx.debuggees.get(session.tabId) ?? null;
  ctx.detachTabState(session.tabId);
  if (debuggee) {
    await ctx.safeDetach(debuggee);
  }
  await ctx.tabManager.closeTab(session.tabId);
  ctx.respond(commandId, { success: true });
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

  await ctx.tabManager.activateTab(session.tabId);
  ctx.updatePrimaryTab(session.tabId);
  ctx.respond(commandId, {});
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
