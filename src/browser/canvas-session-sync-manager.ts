import { randomUUID } from "crypto";
import type { CanvasAttachedClient } from "../canvas/types";
import type { CodeSyncAttachMode, CodeSyncLeaseRole } from "../canvas/code-sync/types";

type SessionState = {
  leaseId: string;
  leaseHolderClientId: string;
  attachedClients: Map<string, CanvasAttachedClient>;
};

export type CanvasSessionAttachResult = {
  clientId: string;
  leaseId: string;
  leaseHolderClientId: string;
  attachedClients: CanvasAttachedClient[];
  role: CodeSyncLeaseRole;
  attachMode: CodeSyncAttachMode;
};

export class CanvasSessionSyncManager {
  private readonly sessions = new Map<string, SessionState>();

  initializeSession(canvasSessionId: string, leaseId: string, clientId?: string | null): CanvasSessionAttachResult {
    const initialClientId = normalizeClientId(clientId) ?? `canvas_owner_${randomUUID().slice(0, 8)}`;
    const attachedAt = new Date().toISOString();
    const attachedClients = new Map<string, CanvasAttachedClient>();
    attachedClients.set(initialClientId, {
      clientId: initialClientId,
      role: "lease_holder",
      attachedAt,
      lastSeenAt: attachedAt
    });
    this.sessions.set(canvasSessionId, {
      leaseId,
      leaseHolderClientId: initialClientId,
      attachedClients
    });
    return {
      clientId: initialClientId,
      leaseId,
      leaseHolderClientId: initialClientId,
      attachedClients: [...attachedClients.values()],
      role: "lease_holder",
      attachMode: "lease_reclaim"
    };
  }

  attach(canvasSessionId: string, leaseId: string, clientId?: string | null, attachMode: CodeSyncAttachMode = "observer"): CanvasSessionAttachResult {
    const state = this.sessions.get(canvasSessionId);
    if (!state) {
      throw new Error(`Unknown canvas session for attach: ${canvasSessionId}`);
    }
    const resolvedClientId = normalizeClientId(clientId) ?? `canvas_client_${randomUUID().slice(0, 8)}`;
    const previous = state.attachedClients.get(resolvedClientId);
    const attachedAt = previous?.attachedAt ?? new Date().toISOString();
    let role: CodeSyncLeaseRole = "observer";
    if (attachMode === "lease_reclaim") {
      state.leaseId = leaseId;
      state.leaseHolderClientId = resolvedClientId;
      role = "lease_holder";
    }
    state.attachedClients.set(resolvedClientId, {
      clientId: resolvedClientId,
      role,
      attachedAt,
      lastSeenAt: new Date().toISOString()
    });
    if (attachMode === "lease_reclaim") {
      for (const [entryClientId, entry] of state.attachedClients.entries()) {
        if (entryClientId === resolvedClientId) {
          continue;
        }
        state.attachedClients.set(entryClientId, {
          ...entry,
          role: "observer",
          lastSeenAt: new Date().toISOString()
        });
      }
    }
    return {
      clientId: resolvedClientId,
      leaseId: state.leaseId,
      leaseHolderClientId: state.leaseHolderClientId,
      attachedClients: this.listAttachedClients(canvasSessionId),
      role,
      attachMode
    };
  }

  touch(canvasSessionId: string, clientId?: string | null): void {
    const state = this.sessions.get(canvasSessionId);
    const resolvedClientId = normalizeClientId(clientId);
    if (!state || !resolvedClientId) {
      return;
    }
    const existing = state.attachedClients.get(resolvedClientId);
    if (!existing) {
      return;
    }
    state.attachedClients.set(resolvedClientId, {
      ...existing,
      lastSeenAt: new Date().toISOString()
    });
  }

  updateLease(canvasSessionId: string, leaseId: string): void {
    const state = this.sessions.get(canvasSessionId);
    if (!state) {
      return;
    }
    state.leaseId = leaseId;
    const holder = state.attachedClients.get(state.leaseHolderClientId);
    if (holder) {
      state.attachedClients.set(state.leaseHolderClientId, {
        ...holder,
        role: "lease_holder",
        lastSeenAt: new Date().toISOString()
      });
    }
  }

  listAttachedClients(canvasSessionId: string): CanvasAttachedClient[] {
    const state = this.sessions.get(canvasSessionId);
    if (!state) {
      return [];
    }
    return [...state.attachedClients.values()].sort((left, right) => left.attachedAt.localeCompare(right.attachedAt));
  }

  getLeaseHolderClientId(canvasSessionId: string): string | null {
    return this.sessions.get(canvasSessionId)?.leaseHolderClientId ?? null;
  }

  removeSession(canvasSessionId: string): void {
    this.sessions.delete(canvasSessionId);
  }
}

function normalizeClientId(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
