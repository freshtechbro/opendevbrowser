export type OpsTargetInfo = {
  targetId: string;
  tabId: number;
  title?: string;
  url?: string;
};

export type OpsConsoleEvent = {
  seq: number;
  level: string;
  text: string;
  ts: number;
};

export type OpsNetworkEvent = {
  seq: number;
  method: string;
  url: string;
  status?: number;
  resourceType?: string;
  ts: number;
};

export type OpsSession = {
  id: string;
  ownerClientId: string;
  leaseId: string;
  state: "active" | "closing";
  expiresAt?: number;
  closingReason?: string;
  tabId: number;
  targetId: string;
  activeTargetId: string;
  createdAt: number;
  lastUsedAt: number;
  targets: Map<string, OpsTargetInfo>;
  nameToTarget: Map<string, string>;
  targetToName: Map<string, string>;
  refStore: OpsRefStore;
  consoleEvents: OpsConsoleEvent[];
  networkEvents: OpsNetworkEvent[];
  networkRequests: Map<string, { method: string; url: string; resourceType?: string }>;
  consoleSeq: number;
  networkSeq: number;
  queue: Promise<unknown>;
};

export class OpsRefStore {
  private refsByTarget = new Map<string, Map<string, { ref: string; selector: string; backendNodeId: number; frameId?: string; role?: string; name?: string }>>();
  private snapshotByTarget = new Map<string, string>();

  setSnapshot(targetId: string, entries: Array<{ ref: string; selector: string; backendNodeId: number; frameId?: string; role?: string; name?: string }>): { snapshotId: string; targetId: string; count: number } {
    const map = new Map<string, { ref: string; selector: string; backendNodeId: number; frameId?: string; role?: string; name?: string }>();
    for (const entry of entries) {
      map.set(entry.ref, entry);
    }
    const snapshotId = createId();
    this.refsByTarget.set(targetId, map);
    this.snapshotByTarget.set(targetId, snapshotId);
    return { snapshotId, targetId, count: entries.length };
  }

  resolve(targetId: string, ref: string): { ref: string; selector: string; backendNodeId: number; frameId?: string; role?: string; name?: string } | null {
    const map = this.refsByTarget.get(targetId);
    if (!map) return null;
    return map.get(ref) ?? null;
  }

  getSnapshotId(targetId: string): string | null {
    return this.snapshotByTarget.get(targetId) ?? null;
  }

  getRefCount(targetId: string): number {
    const map = this.refsByTarget.get(targetId);
    return map ? map.size : 0;
  }

  clearTarget(targetId: string): void {
    this.refsByTarget.delete(targetId);
    this.snapshotByTarget.delete(targetId);
  }
}

export class OpsSessionStore {
  private sessions = new Map<string, OpsSession>();
  private tabToSession = new Map<number, string>();

  createSession(ownerClientId: string, tabId: number, leaseId: string, info?: { url?: string; title?: string }): OpsSession {
    const id = createId();
    const targetId = `tab-${tabId}`;
    const target: OpsTargetInfo = {
      targetId,
      tabId,
      url: info?.url,
      title: info?.title
    };
    const session: OpsSession = {
      id,
      ownerClientId,
      leaseId,
      state: "active",
      tabId,
      targetId,
      activeTargetId: targetId,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      targets: new Map([[targetId, target]]),
      nameToTarget: new Map(),
      targetToName: new Map(),
      refStore: new OpsRefStore(),
      consoleEvents: [],
      networkEvents: [],
      networkRequests: new Map(),
      consoleSeq: 0,
      networkSeq: 0,
      queue: Promise.resolve()
    };
    this.sessions.set(id, session);
    this.tabToSession.set(tabId, id);
    return session;
  }

  get(sessionId: string): OpsSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  getByTabId(tabId: number): OpsSession | null {
    const id = this.tabToSession.get(tabId);
    if (!id) return null;
    return this.sessions.get(id) ?? null;
  }

  listOwnedBy(clientId: string): OpsSession[] {
    return Array.from(this.sessions.values()).filter((session) => session.ownerClientId === clientId);
  }

  delete(sessionId: string): OpsSession | null {
    const session = this.sessions.get(sessionId) ?? null;
    if (!session) return null;
    this.sessions.delete(sessionId);
    for (const target of session.targets.values()) {
      this.tabToSession.delete(target.tabId);
    }
    return session;
  }

  addTarget(sessionId: string, tabId: number, info?: { url?: string; title?: string }): OpsTargetInfo {
    const session = this.requireSession(sessionId);
    const targetId = `tab-${tabId}`;
    const target: OpsTargetInfo = {
      targetId,
      tabId,
      url: info?.url,
      title: info?.title
    };
    session.targets.set(targetId, target);
    this.tabToSession.set(tabId, sessionId);
    if (!session.activeTargetId) {
      session.activeTargetId = targetId;
    }
    return target;
  }

  removeTarget(sessionId: string, targetId: string): OpsTargetInfo | null {
    const session = this.requireSession(sessionId);
    const target = session.targets.get(targetId) ?? null;
    if (!target) return null;
    session.targets.delete(targetId);
    this.tabToSession.delete(target.tabId);
    const name = session.targetToName.get(targetId);
    if (name) {
      session.targetToName.delete(targetId);
      session.nameToTarget.delete(name);
    }
    if (session.activeTargetId === targetId) {
      const [first] = session.targets.keys();
      session.activeTargetId = first ?? "";
    }
    session.refStore.clearTarget(targetId);
    return target;
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

  requireSession(sessionId: string): OpsSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown sessionId: ${sessionId}`);
    }
    return session;
  }
}

const createId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};
