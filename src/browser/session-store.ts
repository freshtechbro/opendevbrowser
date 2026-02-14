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

export type SessionBlockerState = {
  state: SessionBlockerStateValue;
  blocker?: BlockerSignalV1;
  targetKey?: string;
  activatedAtMs?: number;
  lastDetectedAtMs?: number;
  updatedAtMs?: number;
};

export type SessionBlockerSummary = {
  state: SessionBlockerStateValue;
  blocker?: BlockerSignalV1;
  targetKey?: string;
  updatedAt?: string;
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
      ...(typeof state.updatedAtMs === "number" ? { updatedAt: new Date(state.updatedAtMs).toISOString() } : {})
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
      updatedAtMs: nowMs
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
        updatedAtMs: nowMs
      };
      this.blockerStates.set(sessionId, next);
      return next;
    }

    if (current.state === "clear") {
      return current;
    }

    const lastDetectedAtMs = current.lastDetectedAtMs ?? current.updatedAtMs ?? nowMs;
    const timedOut = nowMs - lastDetectedAtMs >= timeoutMs;
    const shouldClear = timedOut || options.verifier === true || current.state === "resolving";

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
      updatedAtMs: nowMs
    };
    this.blockerStates.set(sessionId, cleared);
    return cleared;
  }

  clearBlocker(sessionId: string, nowMs = Date.now()): SessionBlockerState {
    this.ensureSession(sessionId);
    const cleared: SessionBlockerState = {
      state: "clear",
      updatedAtMs: nowMs
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
