import { describe, expect, it } from "vitest";
import { SessionStore } from "../src/browser/session-store";
import type { BlockerSignalV1 } from "../src/providers/types";

const makeBlocker = (type: BlockerSignalV1["type"]): BlockerSignalV1 => ({
  schemaVersion: "1.0",
  type,
  source: "navigation",
  confidence: 0.9,
  retryable: false,
  detectedAt: "2026-02-14T00:00:00.000Z",
  evidence: {
    matchedPatterns: ["p"],
    networkHosts: []
  },
  actionHints: [{ id: "collect_debug_trace", reason: "trace", priority: 1 }]
});

describe("SessionStore blocker FSM", () => {
  it("starts in clear state and activates on blocker detection", () => {
    const store = new SessionStore();
    store.add({
      id: "s1",
      mode: "managed",
      browser: {} as never,
      context: {} as never
    });

    expect(store.getBlockerSummary("s1")).toEqual({ state: "clear" });

    const state = store.reconcileBlocker("s1", makeBlocker("auth_required"), {
      timeoutMs: 600000,
      verifier: true,
      nowMs: 1
    });
    expect(state.state).toBe("active");
    expect(store.getBlockerSummary("s1").blocker?.type).toBe("auth_required");
  });

  it("transitions active -> resolving -> clear when verifier no longer sees blocker", () => {
    const store = new SessionStore();
    store.add({
      id: "s1",
      mode: "managed",
      browser: {} as never,
      context: {} as never
    });

    store.reconcileBlocker("s1", makeBlocker("anti_bot_challenge"), {
      timeoutMs: 600000,
      verifier: true,
      nowMs: 10
    });
    const resolving = store.startResolving("s1", 20);
    expect(resolving.state).toBe("resolving");

    const cleared = store.reconcileBlocker("s1", null, {
      timeoutMs: 600000,
      verifier: true,
      nowMs: 30
    });
    expect(cleared.state).toBe("clear");
    expect(store.getBlockerSummary("s1").blocker).toBeUndefined();
  });

  it("clears active blockers on timeout when no fresh blocker is observed", () => {
    const store = new SessionStore();
    store.add({
      id: "s1",
      mode: "managed",
      browser: {} as never,
      context: {} as never
    });

    store.reconcileBlocker("s1", makeBlocker("upstream_block"), {
      timeoutMs: 50,
      verifier: false,
      nowMs: 100
    });

    const stillActive = store.reconcileBlocker("s1", null, {
      timeoutMs: 50,
      verifier: false,
      nowMs: 120
    });
    expect(stillActive.state).toBe("active");

    const cleared = store.reconcileBlocker("s1", null, {
      timeoutMs: 50,
      verifier: false,
      nowMs: 170
    });
    expect(cleared.state).toBe("clear");
  });

  it("keeps blocker active on verifier-fail branch before timeout and preserves target context", () => {
    const store = new SessionStore();
    store.add({
      id: "s1",
      mode: "managed",
      browser: {} as never,
      context: {} as never
    });

    store.reconcileBlocker("s1", makeBlocker("auth_required"), {
      timeoutMs: 600000,
      verifier: false,
      targetKey: "target-1:x.com",
      nowMs: 100
    });

    const stillActive = store.reconcileBlocker("s1", null, {
      timeoutMs: 600000,
      verifier: false,
      targetKey: "target-1:x.com",
      nowMs: 150
    });

    expect(stillActive.state).toBe("active");
    expect(stillActive.targetKey).toBe("target-1:x.com");
    expect(store.getBlockerSummary("s1")).toMatchObject({
      state: "active",
      targetKey: "target-1:x.com"
    });
  });

  it("tracks session lifecycle helpers and validates unknown sessions", () => {
    const store = new SessionStore();
    expect(() => store.get("missing")).toThrow("Unknown sessionId: missing");
    store.add({
      id: "s1",
      mode: "managed",
      browser: {} as never,
      context: {} as never
    });

    expect(store.has("s1")).toBe(true);
    expect(store.list()).toHaveLength(1);

    const noopResolving = store.startResolving("s1", 11);
    expect(noopResolving.state).toBe("clear");

    const cleared = store.clearBlocker("s1", 22);
    expect(cleared).toMatchObject({ state: "clear", updatedAtMs: 22 });
    expect(store.getBlockerSummary("s1").updatedAt).toBe("1970-01-01T00:00:00.022Z");

    store.delete("s1");
    expect(store.has("s1")).toBe(false);
    expect(store.list()).toHaveLength(0);
    expect(() => store.get("s1")).toThrow("Unknown sessionId: s1");
    expect(() => store.clearBlocker("s1")).toThrow("Unknown sessionId: s1");
  });

  it("covers internal fallback branches for missing blocker state and implicit timing", () => {
    const store = new SessionStore();
    store.add({
      id: "s1",
      mode: "managed",
      browser: {} as never,
      context: {} as never
    });

    const internals = store as unknown as { blockerStates: Map<string, unknown> };
    internals.blockerStates.delete("s1");
    expect(store.getBlockerState("s1")).toEqual({ state: "clear" });

    const active = store.reconcileBlocker("s1", makeBlocker("auth_required"), {
      timeoutMs: 5_000
    });
    expect(active.state).toBe("active");
    expect(typeof active.lastDetectedAtMs).toBe("number");

    internals.blockerStates.set("s1", { state: "active" });
    const next = store.reconcileBlocker("s1", null, {
      timeoutMs: 5_000
    });
    expect(next.state).toBe("active");
    expect(typeof next.updatedAtMs).toBe("number");
  });
});
