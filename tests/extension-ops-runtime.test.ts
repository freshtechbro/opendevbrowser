import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpsRuntime } from "../extension/src/ops/ops-runtime";
import { OpsSessionStore } from "../extension/src/ops/ops-session-store";

type TabRemovedListener = (tabId: number) => void;
type DebuggerDetachListener = (source: chrome.debugger.Debuggee) => void;
const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("OpsRuntime target teardown", () => {
  const originalChrome = globalThis.chrome;

  let tabRemovedListener: TabRemovedListener | null = null;
  let debuggerDetachListener: DebuggerDetachListener | null = null;

  beforeEach(() => {
    tabRemovedListener = null;
    debuggerDetachListener = null;

    globalThis.chrome = {
      tabs: {
        get: vi.fn(async () => null),
        onRemoved: {
          addListener: vi.fn((listener: TabRemovedListener) => {
            tabRemovedListener = listener;
          })
        }
      },
      debugger: {
        onEvent: {
          addListener: vi.fn()
        },
        onDetach: {
          addListener: vi.fn((listener: DebuggerDetachListener) => {
            debuggerDetachListener = listener;
          })
        }
      }
    } as unknown as typeof chrome;
  });

  afterEach(() => {
    globalThis.chrome = originalChrome;
    vi.restoreAllMocks();
  });

  it("does not teardown the full session when a non-root tab is removed", () => {
    const sent: unknown[] = [];
    const cdp = {
      detachTab: vi.fn(async () => undefined)
    };

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", { url: "https://root.example" });
    sessions.addTarget(session.id, 202, { url: "https://child.example" });

    tabRemovedListener?.(202);

    const updated = sessions.get(session.id);
    expect(updated).not.toBeNull();
    expect(updated?.targets.has("tab-101")).toBe(true);
    expect(updated?.targets.has("tab-202")).toBe(false);
    expect(cdp.detachTab).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it("tears down the full session when root tab is removed", () => {
    const sent: Array<{ type?: string; event?: string; opsSessionId?: string }> = [];
    const cdp = {
      detachTab: vi.fn(async () => undefined)
    };

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; event?: string; opsSessionId?: string }),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", { url: "https://root.example" });
    sessions.addTarget(session.id, 202, { url: "https://child.example" });

    tabRemovedListener?.(101);

    expect(sessions.get(session.id)).toBeNull();
    expect(cdp.detachTab).toHaveBeenCalledWith(202);
    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "ops_event", event: "ops_tab_closed", opsSessionId: session.id })
      ])
    );
  });

  it("does not teardown full session when non-root debugger detaches", async () => {
    const sent: unknown[] = [];
    const cdp = {
      detachTab: vi.fn(async () => undefined)
    };

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", { url: "https://root.example" });
    sessions.addTarget(session.id, 202, { url: "https://child.example" });

    debuggerDetachListener?.({ tabId: 202 });
    await flushMicrotasks();

    const updated = sessions.get(session.id);
    expect(updated).not.toBeNull();
    expect(updated?.targets.has("tab-101")).toBe(true);
    expect(updated?.targets.has("tab-202")).toBe(false);
    expect(cdp.detachTab).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it("ignores root debugger detach when multiple targets remain", async () => {
    const sent: unknown[] = [];
    const cdp = {
      detachTab: vi.fn(async () => undefined)
    };

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", { url: "https://root.example" });
    sessions.addTarget(session.id, 202, { url: "https://child.example" });
    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockResolvedValue({ id: 101, url: "https://root.example" } as chrome.tabs.Tab);

    debuggerDetachListener?.({ tabId: 101 });
    await flushMicrotasks();

    const updated = sessions.get(session.id);
    expect(updated).not.toBeNull();
    expect(updated?.targets.has("tab-101")).toBe(true);
    expect(updated?.targets.has("tab-202")).toBe(true);
    expect(cdp.detachTab).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });
});
