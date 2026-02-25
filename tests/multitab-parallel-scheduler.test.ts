import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserManager } from "../src/browser/browser-manager";
import { resolveConfig } from "../src/config";
import { OpsRuntime } from "../extension/src/ops/ops-runtime";
import { OpsSessionStore } from "../extension/src/ops/ops-session-store";

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const waitFor = async (predicate: () => boolean, timeoutMs = 500): Promise<void> => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await flushMicrotasks();
  }
};

describe("BrowserManager target-scoped scheduler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps same-target work FIFO while cleaning queue state", async () => {
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));
    const managerAny = manager as unknown as {
      runTargetScoped: <T>(
        sessionId: string,
        targetId: string | null | undefined,
        execute: (ctx: { managed: unknown; targetId: string; page: unknown }) => Promise<T>,
        timeoutMs?: number
      ) => Promise<T>;
      getManaged: (sessionId: string) => unknown;
      resolveTargetContext: (managed: unknown, targetId: string | null | undefined) => { targetId: string; page: unknown };
      acquireParallelSlot: (sessionId: string, targetId: string, timeoutMs: number) => Promise<void>;
      releaseParallelSlot: (sessionId: string) => void;
      targetQueues: Map<string, Promise<void>>;
    };

    vi.spyOn(managerAny, "getManaged").mockReturnValue({ sessionId: "session-a" });
    vi.spyOn(managerAny, "resolveTargetContext").mockImplementation((_managed, targetId) => ({
      targetId: targetId ?? "tab-1",
      page: {}
    }));
    vi.spyOn(managerAny, "acquireParallelSlot").mockResolvedValue(undefined);
    vi.spyOn(managerAny, "releaseParallelSlot").mockImplementation(() => undefined);

    const order: string[] = [];
    let releaseFirst: () => void = () => undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = managerAny.runTargetScoped("session-a", "tab-1", async () => {
      order.push("start-1");
      await firstGate;
      order.push("end-1");
      return "first";
    });
    await flushMicrotasks();

    const second = managerAny.runTargetScoped("session-a", "tab-1", async () => {
      order.push("start-2");
      order.push("end-2");
      return "second";
    });

    await flushMicrotasks();
    expect(order).toEqual(["start-1"]);

    releaseFirst();
    await Promise.all([first, second]);

    expect(order).toEqual(["start-1", "end-1", "start-2", "end-2"]);
    expect(managerAny.targetQueues.has("session-a:tab-1")).toBe(false);
  });

  it("runs different-target work in parallel when slots are available", async () => {
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));
    const managerAny = manager as unknown as {
      runTargetScoped: <T>(
        sessionId: string,
        targetId: string | null | undefined,
        execute: (ctx: { managed: unknown; targetId: string; page: unknown }) => Promise<T>,
        timeoutMs?: number
      ) => Promise<T>;
      getManaged: (sessionId: string) => unknown;
      resolveTargetContext: (managed: unknown, targetId: string | null | undefined) => { targetId: string; page: unknown };
      acquireParallelSlot: (sessionId: string, targetId: string, timeoutMs: number) => Promise<void>;
      releaseParallelSlot: (sessionId: string) => void;
      targetQueues: Map<string, Promise<void>>;
    };

    vi.spyOn(managerAny, "getManaged").mockReturnValue({ sessionId: "session-b" });
    vi.spyOn(managerAny, "resolveTargetContext").mockImplementation((_managed, targetId) => ({
      targetId: targetId ?? "tab-1",
      page: {}
    }));
    vi.spyOn(managerAny, "acquireParallelSlot").mockResolvedValue(undefined);
    vi.spyOn(managerAny, "releaseParallelSlot").mockImplementation(() => undefined);

    const started = new Set<string>();
    let releaseA: () => void = () => undefined;
    let releaseB: () => void = () => undefined;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    const gateB = new Promise<void>((resolve) => {
      releaseB = resolve;
    });

    const first = managerAny.runTargetScoped("session-b", "tab-a", async () => {
      started.add("tab-a");
      await gateA;
      return "a";
    });
    const second = managerAny.runTargetScoped("session-b", "tab-b", async () => {
      started.add("tab-b");
      await gateB;
      return "b";
    });

    await waitFor(() => started.size === 2);
    expect(started).toEqual(new Set(["tab-a", "tab-b"]));

    releaseA();
    releaseB();
    await Promise.all([first, second]);

    expect(managerAny.targetQueues.has("session-b:tab-a")).toBe(false);
    expect(managerAny.targetQueues.has("session-b:tab-b")).toBe(false);
  });
});

describe("OpsRuntime target-scoped scheduler", () => {
  const originalChrome = globalThis.chrome;

  beforeEach(() => {
    globalThis.chrome = {
      tabs: {
        get: vi.fn(async (tabId: number) => ({
          id: tabId,
          url: "https://example.com",
          title: "Example"
        })),
        query: vi.fn(async () => [{ id: 101, url: "https://example.com", title: "Example" }]),
        create: vi.fn((_params: chrome.tabs.CreateProperties, cb: (tab?: chrome.tabs.Tab) => void) => {
          cb({ id: 202, url: "https://example.com/new", title: "New Tab" } as chrome.tabs.Tab);
        }),
        remove: vi.fn((_tabId: number, cb: () => void) => cb()),
        update: vi.fn((_tabId: number, _updateProperties: chrome.tabs.UpdateProperties, cb: (tab?: chrome.tabs.Tab) => void) => {
          cb({ id: 101, url: "https://example.com", title: "Example" } as chrome.tabs.Tab);
        }),
        onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
        onUpdated: { addListener: vi.fn(), removeListener: vi.fn() }
      },
      debugger: {
        onEvent: { addListener: vi.fn() },
        onDetach: { addListener: vi.fn() }
      },
      runtime: {
        lastError: undefined
      }
    } as unknown as typeof chrome;
  });

  afterEach(() => {
    globalThis.chrome = originalChrome;
    vi.restoreAllMocks();
  });

  it("keeps same-target ops commands FIFO and runs different targets in parallel", async () => {
    const runtime = new OpsRuntime({
      send: () => undefined,
      cdp: { detachTab: vi.fn(async () => undefined) } as never
    });
    const runtimeAny = runtime as unknown as {
      sessions: OpsSessionStore;
      withTargetQueue: (
        message: { command: string; payload?: Record<string, unknown> },
        session: ReturnType<OpsSessionStore["createSession"]>,
        handler: (session: ReturnType<OpsSessionStore["createSession"]>) => Promise<void>
      ) => Promise<void>;
      acquireParallelSlot: (
        session: ReturnType<OpsSessionStore["createSession"]>,
        targetId: string,
        timeoutMs: number
      ) => Promise<void>;
      releaseParallelSlot: (session: ReturnType<OpsSessionStore["createSession"]>) => void;
    };

    vi.spyOn(runtimeAny, "acquireParallelSlot").mockResolvedValue(undefined);
    vi.spyOn(runtimeAny, "releaseParallelSlot").mockImplementation(() => undefined);

    const session = runtimeAny.sessions.createSession("client-1", 101, "lease-1", { url: "https://root.example" });
    runtimeAny.sessions.addTarget(session.id, 202, { url: "https://child.example" });

    const order: string[] = [];
    let releaseSameTarget: () => void = () => undefined;
    const sameTargetGate = new Promise<void>((resolve) => {
      releaseSameTarget = resolve;
    });

    const firstSameTarget = runtimeAny.withTargetQueue(
      { command: "nav.goto", payload: { targetId: "tab-101" } },
      session,
      async () => {
        order.push("same-start-1");
        await sameTargetGate;
        order.push("same-end-1");
      }
    );
    await flushMicrotasks();

    const secondSameTarget = runtimeAny.withTargetQueue(
      { command: "nav.goto", payload: { targetId: "tab-101" } },
      session,
      async () => {
        order.push("same-start-2");
        order.push("same-end-2");
      }
    );

    await flushMicrotasks();
    expect(order).toEqual(["same-start-1"]);

    releaseSameTarget();
    await Promise.all([firstSameTarget, secondSameTarget]);

    expect(order).toEqual(["same-start-1", "same-end-1", "same-start-2", "same-end-2"]);

    const started = new Set<string>();
    let releaseA: () => void = () => undefined;
    let releaseB: () => void = () => undefined;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    const gateB = new Promise<void>((resolve) => {
      releaseB = resolve;
    });

    const targetA = runtimeAny.withTargetQueue(
      { command: "nav.goto", payload: { targetId: "tab-101" } },
      session,
      async () => {
        started.add("tab-101");
        await gateA;
      }
    );
    const targetB = runtimeAny.withTargetQueue(
      { command: "nav.goto", payload: { targetId: "tab-202" } },
      session,
      async () => {
        started.add("tab-202");
        await gateB;
      }
    );

    await waitFor(() => started.size === 2);
    expect(started).toEqual(new Set(["tab-101", "tab-202"]));

    releaseA();
    releaseB();
    await Promise.all([targetA, targetB]);
  });

  it("returns not_owner for lease mismatch without poisoning the session", async () => {
    const sent: Array<{ type?: string; requestId?: string; error?: { code?: string } }> = [];
    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; error?: { code?: string } }),
      cdp: { detachTab: vi.fn(async () => undefined) } as never
    });
    const runtimeAny = runtime as unknown as { sessions: OpsSessionStore };
    const session = runtimeAny.sessions.createSession("client-owner", 101, "lease-owner", { url: "https://root.example" });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-not-owner",
      clientId: "client-other",
      opsSessionId: session.id,
      leaseId: "lease-owner",
      command: "session.status",
      payload: {}
    });
    await flushMicrotasks();

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-owner-ok",
      clientId: "client-owner",
      opsSessionId: session.id,
      leaseId: "lease-owner",
      command: "session.status",
      payload: {}
    });
    await flushMicrotasks();

    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "ops_error",
          requestId: "req-not-owner",
          error: expect.objectContaining({ code: "not_owner" })
        }),
        expect.objectContaining({
          type: "ops_response",
          requestId: "req-owner-ok"
        })
      ])
    );
  });

  it("records discarded/frozen lifecycle pressure and resets counters after sampling", () => {
    let onUpdatedListener:
      | ((tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void)
      | null = null;
    const addListenerMock = globalThis.chrome.tabs.onUpdated.addListener as unknown as ReturnType<typeof vi.fn>;
    addListenerMock.mockImplementation((listener: (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void) => {
      onUpdatedListener = listener;
    });

    const runtime = new OpsRuntime({
      send: () => undefined,
      cdp: { detachTab: vi.fn(async () => undefined) } as never
    });
    const runtimeAny = runtime as unknown as {
      sessions: OpsSessionStore;
      sampleParallelism: (session: ReturnType<OpsSessionStore["createSession"]>) => { pressure: string; state: { staticCap: number; effectiveCap: number } };
    };
    const session = runtimeAny.sessions.createSession("client-1", 101, "lease-1", { url: "https://root.example" });

    onUpdatedListener?.(
      101,
      { discarded: true, frozen: true },
      { id: 101, url: "https://root.example", discarded: true, frozen: true } as chrome.tabs.Tab
    );

    expect(session.discardedSignals).toBe(1);
    expect(session.frozenSignals).toBe(1);

    const snapshot = runtimeAny.sampleParallelism(session);
    expect(snapshot.pressure).toBe("high");
    expect(snapshot.state.effectiveCap).toBeLessThan(snapshot.state.staticCap);
    expect(session.discardedSignals).toBe(0);
    expect(session.frozenSignals).toBe(0);
  });
});
