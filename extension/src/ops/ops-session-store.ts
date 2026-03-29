import {
  DEFAULT_OPS_PARALLELISM_POLICY,
  createOpsGovernorState,
  type OpsParallelismGovernorPolicy,
  type OpsParallelismGovernorState
} from "./parallelism-governor.js";
import {
  createCoordinatorId,
  TargetSessionCoordinator,
  type TargetSessionInfo,
  type TargetSessionRecord
} from "./target-session-coordinator.js";

export type OpsTargetInfo = TargetSessionInfo;

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

export type OpsSyntheticTargetRecord = {
  targetId: string;
  tabId: number;
  type: string;
  url?: string;
  title?: string;
  sessionId?: string;
  openerTargetId?: string;
  attachedAt: number;
};

type OpsSessionExtra = {
  refStore: OpsRefStore;
  syntheticTargets: Map<string, OpsSyntheticTargetRecord>;
  consoleEvents: OpsConsoleEvent[];
  networkEvents: OpsNetworkEvent[];
  networkRequests: Map<string, { method: string; url: string; resourceType?: string }>;
  consoleSeq: number;
  networkSeq: number;
  queue: Promise<unknown>;
  targetQueues: Map<string, Promise<void>>;
  targetQueueDepth: Map<string, number>;
  targetQueueOldestAt: Map<string, number>;
  parallelInFlight: number;
  pendingParallel: number;
  discardedSignals: number;
  frozenSignals: number;
  parallelismPolicy: OpsParallelismGovernorPolicy;
  parallelismState: OpsParallelismGovernorState;
};

export type OpsSession = TargetSessionRecord<OpsSessionExtra>;

export class OpsRefStore {
  private refsByTarget = new Map<string, Map<string, { ref: string; selector: string; backendNodeId: number; snapshotId: string; frameId?: string; role?: string; name?: string }>>();
  private snapshotByTarget = new Map<string, string>();
  private refCounterByTarget = new Map<string, number>();

  nextRef(targetId: string): string {
    const next = (this.refCounterByTarget.get(targetId) ?? 0) + 1;
    this.refCounterByTarget.set(targetId, next);
    return `r${next}`;
  }

  setSnapshot(targetId: string, entries: Array<{ ref: string; selector: string; backendNodeId: number; frameId?: string; role?: string; name?: string }>): { snapshotId: string; targetId: string; count: number } {
    const map = new Map<string, { ref: string; selector: string; backendNodeId: number; snapshotId: string; frameId?: string; role?: string; name?: string }>();
    const snapshotId = createCoordinatorId();
    for (const entry of entries) {
      map.set(entry.ref, {
        ...entry,
        snapshotId
      });
    }
    this.refsByTarget.set(targetId, map);
    this.snapshotByTarget.set(targetId, snapshotId);
    return { snapshotId, targetId, count: entries.length };
  }

  resolve(targetId: string, ref: string): { ref: string; selector: string; backendNodeId: number; snapshotId: string; frameId?: string; role?: string; name?: string } | null {
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
  private readonly coordinator = new TargetSessionCoordinator<OpsSessionExtra>();

  createSession(
    ownerClientId: string,
    tabId: number,
    leaseId: string,
    info?: { url?: string; title?: string },
    options?: {
      parallelismPolicy?: OpsParallelismGovernorPolicy;
    },
    sessionId?: string
  ): OpsSession {
    const parallelismPolicy = options?.parallelismPolicy ?? DEFAULT_OPS_PARALLELISM_POLICY;
    return this.coordinator.createSession(ownerClientId, tabId, leaseId, info, {
      refStore: new OpsRefStore(),
      syntheticTargets: new Map(),
      consoleEvents: [],
      networkEvents: [],
      networkRequests: new Map(),
      consoleSeq: 0,
      networkSeq: 0,
      queue: Promise.resolve(),
      targetQueues: new Map(),
      targetQueueDepth: new Map(),
      targetQueueOldestAt: new Map(),
      parallelInFlight: 0,
      pendingParallel: 0,
      discardedSignals: 0,
      frozenSignals: 0,
      parallelismPolicy,
      parallelismState: createOpsGovernorState(parallelismPolicy, "extensionOpsHeaded")
    }, sessionId);
  }

  get(sessionId: string): OpsSession | null {
    return this.coordinator.get(sessionId);
  }

  getByTabId(tabId: number): OpsSession | null {
    return this.coordinator.getByTabId(tabId);
  }

  listOwnedBy(clientId: string): OpsSession[] {
    return this.coordinator.listOwnedBy(clientId);
  }

  delete(sessionId: string): OpsSession | null {
    return this.coordinator.delete(sessionId);
  }

  addTarget(sessionId: string, tabId: number, info?: { url?: string; title?: string; openerTargetId?: string }): OpsTargetInfo {
    return this.coordinator.addTarget(sessionId, tabId, info);
  }

  removeTarget(sessionId: string, targetId: string): OpsTargetInfo | null {
    const target = this.coordinator.removeTarget(sessionId, targetId);
    const session = this.requireSession(sessionId);
    if (!target) return null;
    session.targetQueues.delete(targetId);
    session.targetQueueDepth.delete(targetId);
    session.targetQueueOldestAt.delete(targetId);
    session.refStore.clearTarget(targetId);
    session.syntheticTargets.delete(targetId);
    return target;
  }

  getTargetIdByTabId(sessionId: string, tabId: number): string | null {
    return this.coordinator.getTargetIdByTabId(sessionId, tabId);
  }

  removeTargetByTabId(sessionId: string, tabId: number): OpsTargetInfo | null {
    const targetId = this.coordinator.getTargetIdByTabId(sessionId, tabId);
    if (!targetId) return null;
    return this.removeTarget(sessionId, targetId);
  }

  setActiveTarget(sessionId: string, targetId: string): void {
    this.coordinator.setActiveTarget(sessionId, targetId);
  }

  setName(sessionId: string, targetId: string, name: string): void {
    this.coordinator.setName(sessionId, targetId, name);
  }

  getTargetIdByName(sessionId: string, name: string): string | null {
    return this.coordinator.getTargetIdByName(sessionId, name);
  }

  listNamedTargets(sessionId: string): Array<{ name: string; targetId: string }> {
    return this.coordinator.listNamedTargets(sessionId);
  }

  upsertSyntheticTarget(sessionId: string, target: OpsSyntheticTargetRecord): OpsSyntheticTargetRecord {
    const session = this.requireSession(sessionId);
    const existing = session.syntheticTargets.get(target.targetId);
    const nextTarget: OpsSyntheticTargetRecord = {
      ...(existing ?? {}),
      ...target,
      tabId: target.tabId,
      type: target.type,
      attachedAt: target.attachedAt
    };
    session.syntheticTargets.set(target.targetId, nextTarget);
    return nextTarget;
  }

  getSyntheticTarget(sessionId: string, targetId: string): OpsSyntheticTargetRecord | null {
    return this.requireSession(sessionId).syntheticTargets.get(targetId) ?? null;
  }

  listSyntheticTargets(sessionId: string): OpsSyntheticTargetRecord[] {
    return Array.from(this.requireSession(sessionId).syntheticTargets.values());
  }

  findSyntheticTargetBySessionId(sessionId: string, childSessionId: string): OpsSyntheticTargetRecord | null {
    const session = this.requireSession(sessionId);
    for (const target of session.syntheticTargets.values()) {
      if (target.sessionId === childSessionId) {
        return target;
      }
    }
    return null;
  }

  removeSyntheticTarget(sessionId: string, targetId: string): OpsSyntheticTargetRecord | null {
    const session = this.requireSession(sessionId);
    const existing = session.syntheticTargets.get(targetId) ?? null;
    if (!existing) {
      return null;
    }
    session.syntheticTargets.delete(targetId);
    session.refStore.clearTarget(targetId);
    return existing;
  }

  requireSession(sessionId: string): OpsSession {
    return this.coordinator.requireSession(sessionId);
  }
}

export const createOpsSessionId = (): string => createCoordinatorId();
