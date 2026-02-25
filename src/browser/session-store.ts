import type { Browser, BrowserContext } from "playwright-core";
import type { BlockerSignalV1 } from "../providers/types";

export type BrowserMode = "managed" | "cdpConnect" | "extension";
export type SessionBlockerStateValue = "clear" | "active" | "resolving";

export type BrowserSession = {
  id: string;
  mode: BrowserMode;
  browser: Browser;
  context: BrowserContext;
};

export type SessionBlockerResolutionStatus = "resolved" | "unresolved" | "deferred";
export type SessionBlockerResolutionReason =
  | "verifier_passed"
  | "verification_timeout"
  | "verifier_failed"
  | "env_limited"
  | "manual_clear";

export type SessionBlockerResolution = {
  status: SessionBlockerResolutionStatus;
  reason: SessionBlockerResolutionReason;
  updatedAtMs: number;
};

export type SessionBlockerState = {
  state: SessionBlockerStateValue;
  blocker?: BlockerSignalV1;
  targetKey?: string;
  activatedAtMs?: number;
  lastDetectedAtMs?: number;
  updatedAtMs?: number;
  resolution?: SessionBlockerResolution;
};

export type SessionBlockerSummary = {
  state: SessionBlockerStateValue;
  blocker?: BlockerSignalV1;
  targetKey?: string;
  updatedAt?: string;
  resolution?: {
    status: SessionBlockerResolutionStatus;
    reason: SessionBlockerResolutionReason;
    updatedAt: string;
  };
};

const CLEAR_STATE: SessionBlockerState = { state: "clear" };

export class SessionStore {
  private sessions = new Map<string, BrowserSession>();
  private blockerStates = new Map<string, SessionBlockerState>();

  add(session: BrowserSession): void {
    this.sessions.set(session.id, session);
    this.blockerStates.set(session.id, { ...CLEAR_STATE });
  }

  get(sessionId: string): BrowserSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown sessionId: ${sessionId}`);
    }
    return session;
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.blockerStates.delete(sessionId);
  }

  list(): BrowserSession[] {
    return Array.from(this.sessions.values());
  }

  getBlockerState(sessionId: string): SessionBlockerState {
    this.ensureSession(sessionId);
    return this.blockerStates.get(sessionId) ?? { ...CLEAR_STATE };
  }

  getBlockerSummary(sessionId: string): SessionBlockerSummary {
    const state = this.getBlockerState(sessionId);
    return {
      state: state.state,
      ...(state.blocker ? { blocker: state.blocker } : {}),
      ...(state.targetKey ? { targetKey: state.targetKey } : {}),
      ...(typeof state.updatedAtMs === "number" ? { updatedAt: new Date(state.updatedAtMs).toISOString() } : {}),
      ...(state.resolution
        ? {
          resolution: {
            status: state.resolution.status,
            reason: state.resolution.reason,
            updatedAt: new Date(state.resolution.updatedAtMs).toISOString()
          }
        }
        : {})
    };
  }

  startResolving(sessionId: string, nowMs = Date.now()): SessionBlockerState {
    const state = this.getBlockerState(sessionId);
    if (state.state !== "active") {
      return state;
    }
    const next: SessionBlockerState = {
      ...state,
      state: "resolving",
      updatedAtMs: nowMs,
      resolution: undefined
    };
    this.blockerStates.set(sessionId, next);
    return next;
  }

  reconcileBlocker(
    sessionId: string,
    blocker: BlockerSignalV1 | null,
    options: {
      timeoutMs: number;
      verifier?: boolean;
      targetKey?: string;
      nowMs?: number;
    }
  ): SessionBlockerState {
    const nowMs = options.nowMs ?? Date.now();
    const timeoutMs = Math.max(1, options.timeoutMs);
    const current = this.getBlockerState(sessionId);

    if (blocker) {
      const next: SessionBlockerState = {
        state: "active",
        blocker,
        targetKey: options.targetKey ?? current.targetKey,
        activatedAtMs: current.activatedAtMs ?? nowMs,
        lastDetectedAtMs: nowMs,
        updatedAtMs: nowMs,
        resolution: undefined
      };
      this.blockerStates.set(sessionId, next);
      return next;
    }

    if (current.state === "clear") {
      return current;
    }

    const lastDetectedAtMs = current.lastDetectedAtMs ?? current.updatedAtMs ?? nowMs;
    const timedOut = nowMs - lastDetectedAtMs >= timeoutMs;
    if (timedOut) {
      const unresolved: SessionBlockerState = {
        ...current,
        state: "active",
        updatedAtMs: nowMs,
        resolution: {
          status: "unresolved",
          reason: "verification_timeout",
          updatedAtMs: nowMs
        }
      };
      this.blockerStates.set(sessionId, unresolved);
      return unresolved;
    }

    const shouldClear = options.verifier === true || current.state === "resolving";

    if (!shouldClear) {
      const next = {
        ...current,
        updatedAtMs: nowMs
      };
      this.blockerStates.set(sessionId, next);
      return next;
    }

    const cleared: SessionBlockerState = {
      state: "clear",
      targetKey: current.targetKey,
      updatedAtMs: nowMs,
      resolution: {
        status: "resolved",
        reason: "verifier_passed",
        updatedAtMs: nowMs
      }
    };
    this.blockerStates.set(sessionId, cleared);
    return cleared;
  }

  markVerificationFailure(
    sessionId: string,
    options: {
      envLimited?: boolean;
      timedOut?: boolean;
      nowMs?: number;
    } = {}
  ): SessionBlockerState {
    const nowMs = options.nowMs ?? Date.now();
    const current = this.getBlockerState(sessionId);
    if (current.state === "clear") {
      return current;
    }

    const next: SessionBlockerState = {
      ...current,
      state: "active",
      updatedAtMs: nowMs,
      resolution: {
        status: options.envLimited ? "deferred" : "unresolved",
        reason: options.envLimited
          ? "env_limited"
          : options.timedOut
            ? "verification_timeout"
            : "verifier_failed",
        updatedAtMs: nowMs
      }
    };
    this.blockerStates.set(sessionId, next);
    return next;
  }

  clearBlocker(sessionId: string, nowMs = Date.now()): SessionBlockerState {
    this.ensureSession(sessionId);
    const cleared: SessionBlockerState = {
      state: "clear",
      updatedAtMs: nowMs,
      resolution: {
        status: "resolved",
        reason: "manual_clear",
        updatedAtMs: nowMs
      }
    };
    this.blockerStates.set(sessionId, cleared);
    return cleared;
  }

  private ensureSession(sessionId: string): void {
    if (!this.sessions.has(sessionId)) {
      throw new Error(`Unknown sessionId: ${sessionId}`);
    }
  }
}
