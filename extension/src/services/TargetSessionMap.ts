export type TargetInfo = {
  targetId: string;
  type: string;
  browserContextId?: string;
  title?: string;
  url?: string;
};

export type DebuggerSession = chrome.debugger.Debuggee & { sessionId?: string };

export type TargetRecord = {
  tabId: number;
  targetInfo: TargetInfo;
  rootSessionId: string;
};

export type SessionRecord = {
  kind: "root" | "child";
  sessionId: string;
  tabId: number;
  targetId: string;
  debuggerSession: DebuggerSession;
  targetInfo?: TargetInfo;
};

export class TargetSessionMap {
  private readonly tabTargets = new Map<number, TargetRecord>();
  private readonly sessionsById = new Map<string, SessionRecord>();
  private readonly sessionByTarget = new Map<string, string>();
  private readonly rootWaiters = new Map<number, Array<{ resolve: (session: SessionRecord) => void; reject: (error: Error) => void; timeoutId: number }>>();

  registerRootTab(tabId: number, targetInfo: TargetInfo, sessionId: string): SessionRecord {
    const record: TargetRecord = { tabId, targetInfo, rootSessionId: sessionId };
    this.tabTargets.set(tabId, record);
    const session: SessionRecord = {
      kind: "root",
      sessionId,
      tabId,
      targetId: targetInfo.targetId,
      debuggerSession: { tabId },
      targetInfo
    };
    this.sessionsById.set(sessionId, session);
    this.sessionByTarget.set(targetInfo.targetId, sessionId);
    this.resolveRootWaiters(tabId, session);
    return session;
  }

  registerChildSession(tabId: number, targetInfo: TargetInfo, sessionId: string): SessionRecord {
    const session: SessionRecord = {
      kind: "child",
      sessionId,
      tabId,
      targetId: targetInfo.targetId,
      debuggerSession: { tabId, sessionId },
      targetInfo
    };
    this.sessionsById.set(sessionId, session);
    this.sessionByTarget.set(targetInfo.targetId, sessionId);
    return session;
  }

  getBySessionId(sessionId: string): SessionRecord | null {
    return this.sessionsById.get(sessionId) ?? null;
  }

  hasSession(sessionId: string): boolean {
    return this.sessionsById.has(sessionId);
  }

  getByTargetId(targetId: string): SessionRecord | null {
    const sessionId = this.sessionByTarget.get(targetId);
    if (!sessionId) {
      return null;
    }
    return this.sessionsById.get(sessionId) ?? null;
  }

  getByTabId(tabId: number): TargetRecord | null {
    return this.tabTargets.get(tabId) ?? null;
  }

  async waitForRootSession(tabId: number, timeoutMs: number = 2000): Promise<SessionRecord> {
    const existing = this.getByTabId(tabId);
    if (existing) {
      const session = this.sessionsById.get(existing.rootSessionId);
      if (session) {
        return session;
      }
    }
    return await new Promise<SessionRecord>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.rejectRootWaiter(tabId, timeoutId);
        reject(new Error("Target attach timeout"));
      }, timeoutMs);
      const entry = { resolve, reject, timeoutId };
      const waiters = this.rootWaiters.get(tabId) ?? [];
      waiters.push(entry);
      this.rootWaiters.set(tabId, waiters);
    });
  }

  listTargetInfos(): TargetInfo[] {
    const rootTargets = Array.from(this.tabTargets.values()).map((record) => record.targetInfo);
    const childTargets = Array.from(this.sessionsById.values())
      .filter((session) => session.kind === "child" && session.targetInfo)
      .map((session) => session.targetInfo as TargetInfo);
    return [...rootTargets, ...childTargets];
  }

  listTabIds(): number[] {
    return Array.from(this.tabTargets.keys());
  }

  listSessionIds(): string[] {
    return Array.from(this.sessionsById.keys());
  }

  removeByTabId(tabId: number): TargetRecord | null {
    const record = this.tabTargets.get(tabId) ?? null;
    if (!record) {
      return null;
    }
    for (const [sessionId, session] of this.sessionsById.entries()) {
      if (session.tabId === tabId) {
        this.sessionsById.delete(sessionId);
      }
    }
    for (const [targetId, sessionId] of this.sessionByTarget.entries()) {
      const session = this.sessionsById.get(sessionId);
      if (!session || session.tabId === tabId) {
        this.sessionByTarget.delete(targetId);
      }
    }
    this.tabTargets.delete(tabId);
    return record;
  }

  removeBySessionId(sessionId: string): SessionRecord | null {
    const session = this.sessionsById.get(sessionId) ?? null;
    if (!session) {
      return null;
    }
    if (session.kind === "root") {
      this.removeByTabId(session.tabId);
      return session;
    }
    this.sessionsById.delete(sessionId);
    this.sessionByTarget.delete(session.targetId);
    return session;
  }

  removeByTargetId(targetId: string): SessionRecord | null {
    const sessionId = this.sessionByTarget.get(targetId);
    if (!sessionId) {
      return null;
    }
    return this.removeBySessionId(sessionId);
  }

  private resolveRootWaiters(tabId: number, session: SessionRecord): void {
    const waiters = this.rootWaiters.get(tabId);
    if (!waiters || waiters.length === 0) {
      return;
    }
    this.rootWaiters.delete(tabId);
    for (const waiter of waiters) {
      clearTimeout(waiter.timeoutId);
      waiter.resolve(session);
    }
  }

  private rejectRootWaiter(tabId: number, timeoutId: number): void {
    const waiters = this.rootWaiters.get(tabId);
    if (!waiters || waiters.length === 0) {
      return;
    }
    const remaining = waiters.filter((waiter) => waiter.timeoutId !== timeoutId);
    if (remaining.length === 0) {
      this.rootWaiters.delete(tabId);
    } else {
      this.rootWaiters.set(tabId, remaining);
    }
  }
}
