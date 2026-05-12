export type TargetSessionInfo = {
  targetId: string;
  tabId: number;
  title?: string;
  url?: string;
  openerTargetId?: string;
};

export type TargetSessionRecord<TExtra extends object> = {
  id: string;
  ownerClientId: string;
  leaseId: string;
  state: "active" | "closing";
  expiresAt?: number;
  closingReason?: string;
  tabId: number;
  targetId: string;
  activeTargetId: string | null;
  createdAt: number;
  lastUsedAt: number;
  targets: Map<string, TargetSessionInfo>;
  nameToTarget: Map<string, string>;
  targetToName: Map<string, string>;
} & TExtra;

export class TargetSessionCoordinator<TExtra extends object> {
  private readonly sessions = new Map<string, TargetSessionRecord<TExtra>>();
  private readonly tabToSession = new Map<number, string>();

  createSession(
    ownerClientId: string,
    tabId: number,
    leaseId: string,
    info: { url?: string; title?: string } | undefined,
    extra: TExtra,
    sessionId?: string
  ): TargetSessionRecord<TExtra> {
    const id = sessionId ?? createCoordinatorId();
    const targetId = `tab-${tabId}`;
    const target: TargetSessionInfo = {
      targetId,
      tabId,
      url: info?.url,
      title: info?.title,
      openerTargetId: undefined
    };
    const createdAt = Date.now();
    const session: TargetSessionRecord<TExtra> = {
      id,
      ownerClientId,
      leaseId,
      state: "active",
      tabId,
      targetId,
      activeTargetId: targetId,
      createdAt,
      lastUsedAt: createdAt,
      targets: new Map([[targetId, target]]),
      nameToTarget: new Map(),
      targetToName: new Map(),
      ...extra
    };
    this.sessions.set(id, session);
    this.tabToSession.set(tabId, id);
    return session;
  }

  get(sessionId: string): TargetSessionRecord<TExtra> | null {
    return this.sessions.get(sessionId) ?? null;
  }

  getByTabId(tabId: number): TargetSessionRecord<TExtra> | null {
    const sessionId = this.tabToSession.get(tabId);
    if (!sessionId) {
      return null;
    }
    return this.sessions.get(sessionId) ?? null;
  }

  listOwnedBy(clientId: string): TargetSessionRecord<TExtra>[] {
    return Array.from(this.sessions.values()).filter((session) => session.ownerClientId === clientId);
  }

  list(): TargetSessionRecord<TExtra>[] {
    return Array.from(this.sessions.values());
  }

  delete(sessionId: string): TargetSessionRecord<TExtra> | null {
    const session = this.sessions.get(sessionId) ?? null;
    if (!session) {
      return null;
    }
    this.sessions.delete(sessionId);
    for (const target of session.targets.values()) {
      this.tabToSession.delete(target.tabId);
    }
    return session;
  }

  addTarget(sessionId: string, tabId: number, info?: { url?: string; title?: string; openerTargetId?: string }): TargetSessionInfo {
    const session = this.requireSession(sessionId);
    const targetId = `tab-${tabId}`;
    const target: TargetSessionInfo = {
      targetId,
      tabId,
      url: info?.url,
      title: info?.title,
      openerTargetId: info?.openerTargetId
    };
    session.targets.set(targetId, target);
    this.tabToSession.set(tabId, sessionId);
    if (!session.activeTargetId) {
      session.activeTargetId = targetId;
    }
    return target;
  }

  removeTarget(sessionId: string, targetId: string): TargetSessionInfo | null {
    const session = this.requireSession(sessionId);
    const target = session.targets.get(targetId) ?? null;
    if (!target) {
      return null;
    }
    session.targets.delete(targetId);
    this.tabToSession.delete(target.tabId);
    const name = session.targetToName.get(targetId);
    if (name) {
      session.targetToName.delete(targetId);
      session.nameToTarget.delete(name);
    }
    if (session.activeTargetId === targetId) {
      const [first] = session.targets.keys();
      session.activeTargetId = first ?? null;
    }
    return target;
  }

  getTargetIdByTabId(sessionId: string, tabId: number): string | null {
    const session = this.requireSession(sessionId);
    for (const target of session.targets.values()) {
      if (target.tabId === tabId) {
        return target.targetId;
      }
    }
    return null;
  }

  removeTargetByTabId(sessionId: string, tabId: number): TargetSessionInfo | null {
    const targetId = this.getTargetIdByTabId(sessionId, tabId);
    if (!targetId) {
      return null;
    }
    return this.removeTarget(sessionId, targetId);
  }

  setActiveTarget(sessionId: string, targetId: string): void {
    const session = this.requireSession(sessionId);
    if (!session.targets.has(targetId)) {
      throw new Error(`Unknown targetId: ${targetId}`);
    }
    session.activeTargetId = targetId;
  }

  setName(sessionId: string, targetId: string, name: string): void {
    const session = this.requireSession(sessionId);
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error("Name must be non-empty");
    }
    if (!session.targets.has(targetId)) {
      throw new Error(`Unknown targetId: ${targetId}`);
    }
    const existing = session.nameToTarget.get(trimmed);
    if (existing && existing !== targetId) {
      throw new Error(`Name already in use: ${trimmed}`);
    }
    const previousName = session.targetToName.get(targetId);
    if (previousName && previousName !== trimmed) {
      session.nameToTarget.delete(previousName);
    }
    session.nameToTarget.set(trimmed, targetId);
    session.targetToName.set(targetId, trimmed);
  }

  getTargetIdByName(sessionId: string, name: string): string | null {
    const session = this.requireSession(sessionId);
    return session.nameToTarget.get(name.trim()) ?? null;
  }

  listNamedTargets(sessionId: string): Array<{ name: string; targetId: string }> {
    const session = this.requireSession(sessionId);
    return Array.from(session.nameToTarget.entries()).map(([name, targetId]) => ({ name, targetId }));
  }

  requireSession(sessionId: string): TargetSessionRecord<TExtra> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown sessionId: ${sessionId}`);
    }
    session.lastUsedAt = Date.now();
    return session;
  }
}

export const createCoordinatorId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};
