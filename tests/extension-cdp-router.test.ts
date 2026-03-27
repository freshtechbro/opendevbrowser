import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CDPRouter } from "../extension/src/services/CDPRouter";
import { createChromeMock } from "./extension-chrome-mock";

describe("CDPRouter", () => {
  const originalChrome = globalThis.chrome;

  beforeEach(() => {
    const { chrome } = createChromeMock();
    globalThis.chrome = chrome;
  });

  afterEach(() => {
    globalThis.chrome = originalChrome;
  });

  it("attaches and detaches from debugger", async () => {
    const router = new CDPRouter();
    await router.attach(42);
    expect(chrome.debugger.attach).toHaveBeenCalled();

    await router.detachAll();
    expect(chrome.debugger.detach).toHaveBeenCalled();
  });

  it("keeps only the latest root tab attached", async () => {
    const mock = createChromeMock({
      tabs: [
        { id: 1, url: "https://example.com/one", title: "One", groupId: 1, status: "complete", active: true },
        { id: 2, url: "https://example.com/two", title: "Two", groupId: 1, status: "complete", active: false }
      ]
    });
    globalThis.chrome = mock.chrome;

    const router = new CDPRouter();
    const onEvent = vi.fn();
    const onResponse = vi.fn();
    const onDetach = vi.fn();

    router.setCallbacks({ onEvent, onResponse, onDetach });
    await router.attach(1);
    await router.attach(2);

    expect(router.getPrimaryTabId()).toBe(2);
    expect(router.getAttachedTabIds()).toEqual([2]);
    expect(chrome.debugger.detach).toHaveBeenCalledWith({ targetId: "target-1" }, expect.any(Function));

    await router.handleCommand({
      id: 901,
      method: "forwardCDPCommand",
      params: { method: "Target.getTargets", params: {} }
    });

    expect(onResponse).toHaveBeenCalledWith({
      id: 901,
      result: { targetInfos: [expect.objectContaining({ targetId: "tab-2", url: "https://example.com/two" })] }
    });
  });

  it("retries attach when the tab id is stale", async () => {
    const mock = createChromeMock();
    globalThis.chrome = mock.chrome;

    const router = new CDPRouter();

    mock.setActiveTab({ id: 100, url: "https://example.com", title: "Example", groupId: 1 });
    vi.mocked(chrome.debugger.attach)
      .mockImplementationOnce((_debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
        mock.setRuntimeError("No tab with given id 99");
        callback();
      })
      .mockImplementationOnce((_debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
        mock.setRuntimeError(null);
        callback();
      });

    await router.attach(99);

    expect(chrome.debugger.attach).toHaveBeenCalledTimes(2);
  });

  it("creates a fallback tab when stale attach has no active/http candidates", async () => {
    const mock = createChromeMock();
    globalThis.chrome = mock.chrome;
    mock.setActiveTab(null);

    const router = new CDPRouter();

    vi.mocked(chrome.debugger.attach)
      .mockImplementationOnce((_debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
        mock.setRuntimeError("No tab with given id 99");
        callback();
        mock.setRuntimeError(null);
      })
      .mockImplementationOnce((_debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
        mock.setRuntimeError(null);
        callback();
      });

    await router.attach(99);

    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: "about:blank", active: true }, expect.any(Function));
    expect(chrome.debugger.attach).toHaveBeenCalledTimes(2);
  });

  it("falls through to fresh-tab retry when active-tab stale retry also fails", async () => {
    const mock = createChromeMock();
    globalThis.chrome = mock.chrome;
    mock.setActiveTab({ id: 100, url: "https://example.com", title: "Example", groupId: 1 });

    const router = new CDPRouter();

    vi.mocked(chrome.debugger.attach)
      .mockImplementationOnce((_debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
        mock.setRuntimeError("No tab with given id 99");
        callback();
        mock.setRuntimeError(null);
      })
      .mockImplementationOnce((_debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
        mock.setRuntimeError("No tab with given id 100");
        callback();
        mock.setRuntimeError(null);
      })
      .mockImplementationOnce((_debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
        mock.setRuntimeError(null);
        callback();
      });

    await router.attach(99);

    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: "about:blank", active: true }, expect.any(Function));
    expect(chrome.debugger.attach).toHaveBeenCalledTimes(3);
  });

  it("recovers routed root commands when the current tab id is stale", async () => {
    const mock = createChromeMock();
    globalThis.chrome = mock.chrome;
    mock.setActiveTab({ id: 99, url: "https://stale.example", title: "Stale", groupId: 1, status: "complete" });

    const router = new CDPRouter();
    const onEvent = vi.fn();
    const onResponse = vi.fn();
    const onDetach = vi.fn();
    router.setCallbacks({ onEvent, onResponse, onDetach });
    await router.attach(99);

    mock.setActiveTab({ id: 100, url: "https://fresh.example", title: "Fresh", groupId: 1, status: "complete" });

    vi.mocked(chrome.debugger.attach).mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      if (debuggee.targetId === "target-99" || debuggee.tabId === 99) {
        mock.setRuntimeError("No tab with given id 99");
        callback();
        mock.setRuntimeError(null);
        return;
      }
      callback();
    });

    let staleSendTriggered = false;
    vi.mocked(chrome.debugger.sendCommand).mockImplementation(
      (debuggee: chrome.debugger.Debuggee, method: string, _params: object, callback: (result?: unknown) => void) => {
        if (!staleSendTriggered && (debuggee.targetId === "target-99" || debuggee.tabId === 99) && method === "Runtime.enable") {
          staleSendTriggered = true;
          mock.setRuntimeError("No tab with given id 99");
          callback(undefined);
          mock.setRuntimeError(null);
          return;
        }
        callback({ ok: true });
      }
    );

    await router.handleCommand({
      id: 9001,
      method: "forwardCDPCommand",
      params: { method: "Runtime.enable", params: {} }
    });

    expect(onResponse).toHaveBeenCalledWith({ id: 9001, result: { ok: true } });
    expect(chrome.debugger.attach).toHaveBeenCalledWith({ targetId: "target-100" }, "1.3", expect.any(Function));
    expect(chrome.debugger.sendCommand).toHaveBeenCalledWith(
      { targetId: "target-100" },
      "Runtime.enable",
      {},
      expect.any(Function)
    );
  });

  it("reattaches a pruned root tab when direct commands report debugger detached", async () => {
    const mock = createChromeMock({
      tabs: [
        { id: 99, url: "https://example.com/first", title: "First", groupId: 1, status: "complete", active: true },
        { id: 100, url: "https://example.com/second", title: "Second", groupId: 1, status: "complete", active: false }
      ]
    });
    globalThis.chrome = mock.chrome;

    const router = new CDPRouter();
    await router.attach(99);
    await router.attach(100);

    let staleSendTriggered = false;
    vi.mocked(chrome.debugger.sendCommand).mockImplementation(
      (debuggee: chrome.debugger.Debuggee, method: string, _params: object, callback: (result?: unknown) => void) => {
        if (
          !staleSendTriggered
          && (debuggee.targetId === "target-99" || debuggee.tabId === 99)
          && method === "Runtime.enable"
        ) {
          staleSendTriggered = true;
          mock.setRuntimeError("Debugger is not attached to the tab with id: 99.");
          callback(undefined);
          mock.setRuntimeError(null);
          return;
        }
        callback({ ok: true });
      }
    );

    const result = await router.sendCommand({ tabId: 99 }, "Runtime.enable", {});

    expect(result).toEqual({ ok: true });
    expect(chrome.debugger.attach).toHaveBeenCalledWith({ targetId: "target-99" }, "1.3", expect.any(Function));
    expect(router.getPrimaryTabId()).toBe(99);
    expect(router.getAttachedTabIds()).toEqual([99]);
    expect(vi.mocked(chrome.debugger.sendCommand)).toHaveBeenLastCalledWith(
      { targetId: "target-99" },
      "Runtime.enable",
      {},
      expect.any(Function)
    );
  });

  it("routes commands and events with root session ids", async () => {
    const mock = createChromeMock();
    globalThis.chrome = mock.chrome;

    const router = new CDPRouter();
    const onEvent = vi.fn();
    const onResponse = vi.fn();
    const onDetach = vi.fn();

    router.setCallbacks({ onEvent, onResponse, onDetach });
    await router.attach(7);

    await router.handleCommand({
      id: 1,
      method: "forwardCDPCommand",
      params: { method: "Target.setAutoAttach", params: { autoAttach: true, flatten: true } }
    });

    const attachedCall = onEvent.mock.calls.find((call) => call[0]?.params?.method === "Target.attachedToTarget");
    const sessionId = attachedCall?.[0]?.params?.params?.sessionId as string;
    expect(sessionId).toEqual(expect.any(String));

    await router.handleCommand({
      id: 2,
      method: "forwardCDPCommand",
      params: { method: "Runtime.enable", params: {}, sessionId }
    });
    expect(onResponse).toHaveBeenCalledWith({ id: 2, result: {}, sessionId });
    const executionContextCall = onEvent.mock.calls.find((call) => call[0]?.params?.method === "Runtime.executionContextCreated");
    expect(executionContextCall?.[0]).toEqual({
      method: "forwardCDPEvent",
      params: {
        method: "Runtime.executionContextCreated",
        params: {
          context: expect.objectContaining({
            id: 1,
            origin: "",
            auxData: expect.objectContaining({
              frameId: "tab-7",
              isDefault: true,
              type: "default"
            })
          })
        },
        sessionId
      }
    });

    mock.emitDebuggerEvent({ tabId: 7 }, "Runtime.consoleAPICalled", { type: "log" });
    const forwardedCall = onEvent.mock.calls.find((call) => call[0]?.params?.method === "Runtime.consoleAPICalled");
    expect(forwardedCall?.[0]).toEqual({
      method: "forwardCDPEvent",
      params: { method: "Runtime.consoleAPICalled", params: { type: "log" }, sessionId }
    });

    mock.emitDebuggerDetach({ tabId: 7 });
    expect(onDetach).toHaveBeenCalledTimes(1);
  });

  it("keeps synthetic root bootstrap commands local even when a real debugger target id exists", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 31,
        url: "https://example.com/root",
        title: "Root",
        groupId: 1
      }
    });
    globalThis.chrome = mock.chrome;

    vi.mocked(chrome.debugger.getTargets).mockImplementation((callback: (targets: chrome.debugger.TargetInfo[]) => void) => {
      callback([
        {
          id: "actual-root-target",
          tabId: 31,
          type: "page",
          title: "Root",
          url: "https://example.com/root",
          attached: false
        }
      ]);
    });
    vi.mocked(chrome.debugger.sendCommand).mockImplementation(
      (debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
        void params;
        callback({ ok: true });
      }
    );

    const router = new CDPRouter();
    const onEvent = vi.fn();
    const onResponse = vi.fn();
    const onDetach = vi.fn();

    router.setCallbacks({ onEvent, onResponse, onDetach });
    await router.attach(31);

    await router.handleCommand({
      id: 920,
      method: "forwardCDPCommand",
      params: { method: "Target.setAutoAttach", params: { autoAttach: true, flatten: true } }
    });

    const attachedCall = onEvent.mock.calls.find((call) => call[0]?.params?.method === "Target.attachedToTarget");
    const syntheticSessionId = attachedCall?.[0]?.params?.params?.sessionId as string;
    expect(syntheticSessionId).toEqual(expect.any(String));

    await router.handleCommand({
      id: 921,
      method: "forwardCDPCommand",
      params: { method: "Runtime.enable", params: {}, sessionId: syntheticSessionId }
    });

    expect(chrome.debugger.sendCommand).not.toHaveBeenCalledWith(
      expect.anything(),
      "Runtime.enable",
      expect.anything(),
      expect.anything()
    );
    expect(onResponse).toHaveBeenCalledWith({ id: 921, result: {}, sessionId: syntheticSessionId });
    expect(onEvent).toHaveBeenCalledWith({
      method: "forwardCDPEvent",
      params: {
        method: "Runtime.executionContextCreated",
        params: {
          context: expect.objectContaining({
            id: 1,
            origin: "https://example.com",
            auxData: expect.objectContaining({
              frameId: "tab-31",
              isDefault: true,
              type: "default"
            })
          })
        },
        sessionId: syntheticSessionId
      }
    });
  });

  it("applies session-scoped auto-attach for synthetic browser sessions against the real debugger target id", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 41,
        url: "https://example.com/root",
        title: "Root",
        groupId: 1
      }
    });
    globalThis.chrome = mock.chrome;

    vi.mocked(chrome.debugger.getTargets).mockImplementation((callback: (targets: chrome.debugger.TargetInfo[]) => void) => {
      callback([
        {
          id: "actual-root-target",
          tabId: 41,
          type: "page",
          title: "Root",
          url: "https://example.com/root",
          attached: false
        }
      ]);
    });
    vi.mocked(chrome.debugger.sendCommand).mockImplementation(
      (debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
        if (method === "Target.setAutoAttach") {
          callback({ ok: true });
          return;
        }
        if (method === "Runtime.enable") {
          expect(debuggee).toEqual({ tabId: 41 });
          callback({ ok: true });
          return;
        }
        void params;
        callback({ ok: true });
      }
    );

    const router = new CDPRouter();
    const onEvent = vi.fn();
    const onResponse = vi.fn();
    const onDetach = vi.fn();

    router.setCallbacks({ onEvent, onResponse, onDetach });
    await router.attach(41);

    await router.handleCommand({
      id: 922,
      method: "forwardCDPCommand",
      params: { method: "Target.attachToBrowserTarget", params: {} }
    });

    const browserAttachResponse = onResponse.mock.calls.find((call) => call[0]?.id === 922);
    const syntheticSessionId = browserAttachResponse?.[0]?.result?.sessionId as string;
    expect(syntheticSessionId).toEqual(expect.any(String));

    await router.handleCommand({
      id: 923,
      method: "forwardCDPCommand",
      params: {
        method: "Target.setAutoAttach",
        params: { autoAttach: true, flatten: true },
        sessionId: syntheticSessionId
      }
    });

    expect(chrome.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 41 },
      "Target.setAutoAttach",
      { autoAttach: true, waitForDebuggerOnStart: false, flatten: true },
      expect.any(Function)
    );
    expect(onResponse).toHaveBeenCalledWith({ id: 923, result: {}, sessionId: syntheticSessionId });

    onEvent.mockClear();

    await router.handleCommand({
      id: 924,
      method: "forwardCDPCommand",
      params: { method: "Runtime.enable", params: {}, sessionId: syntheticSessionId }
    });

    expect(chrome.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 41 },
      "Runtime.enable",
      {},
      expect.any(Function)
    );
    expect(onResponse).toHaveBeenCalledWith({ id: 924, result: { ok: true }, sessionId: syntheticSessionId });
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("responds to Browser.getVersion without debugger call", async () => {
    const mock = createChromeMock();
    globalThis.chrome = mock.chrome;

    const router = new CDPRouter();
    const onEvent = vi.fn();
    const onResponse = vi.fn();
    const onDetach = vi.fn();

    router.setCallbacks({ onEvent, onResponse, onDetach });
    await router.attach(9);

    await router.handleCommand({
      id: 2,
      method: "forwardCDPCommand",
      params: { method: "Browser.getVersion", params: {} }
    });

    expect(onResponse).toHaveBeenCalledWith({
      id: 2,
      result: expect.objectContaining({
        protocolVersion: expect.any(String),
        product: expect.any(String),
        userAgent: expect.any(String)
      })
    });
    expect(chrome.debugger.sendCommand).not.toHaveBeenCalledWith(
      expect.anything(),
      "Browser.getVersion",
      expect.anything(),
      expect.anything()
    );
  });

  it("responds to Target.getBrowserContexts with default context", async () => {
    const mock = createChromeMock();
    globalThis.chrome = mock.chrome;

    const router = new CDPRouter();
    const onEvent = vi.fn();
    const onResponse = vi.fn();
    const onDetach = vi.fn();

    router.setCallbacks({ onEvent, onResponse, onDetach });
    await router.attach(13);

    await router.handleCommand({
      id: 10,
      method: "forwardCDPCommand",
      params: { method: "Target.getBrowserContexts", params: {} }
    });

    expect(onResponse).toHaveBeenCalledWith({
      id: 10,
      result: { browserContextIds: ["default"] }
    });
  });

  it("responds to Target.attachToBrowserTarget with a distinct browser session id", async () => {
    const mock = createChromeMock();
    globalThis.chrome = mock.chrome;

    const router = new CDPRouter();
    const onEvent = vi.fn();
    const onResponse = vi.fn();
    const onDetach = vi.fn();

    router.setCallbacks({ onEvent, onResponse, onDetach });
    await router.attach(15);

    await router.handleCommand({
      id: 11,
      method: "forwardCDPCommand",
      params: { method: "Target.attachToBrowserTarget", params: {} }
    });

    expect(onResponse).toHaveBeenCalledWith({
      id: 11,
      result: { sessionId: expect.stringMatching(/^pw-browser-/) }
    });
  });

  it("keeps browser-session and root-page session ids distinct during Playwright attach flow", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 16,
        url: "https://example.com/attach-flow",
        title: "Attach Flow",
        groupId: 1
      }
    });
    globalThis.chrome = mock.chrome;

    const router = new CDPRouter();
    const onEvent = vi.fn();
    const onResponse = vi.fn();
    const onDetach = vi.fn();

    router.setCallbacks({ onEvent, onResponse, onDetach });
    await router.attach(16);

    await router.handleCommand({
      id: 1601,
      method: "forwardCDPCommand",
      params: { method: "Target.setAutoAttach", params: { autoAttach: true, flatten: true } }
    });

    const rootAttachedCall = onEvent.mock.calls.find((call) => call[0]?.params?.method === "Target.attachedToTarget");
    const rootSessionId = rootAttachedCall?.[0]?.params?.params?.sessionId as string;
    expect(rootSessionId).toEqual(expect.stringMatching(/^pw-tab-/));

    onResponse.mockClear();

    await router.handleCommand({
      id: 1602,
      method: "forwardCDPCommand",
      params: { method: "Target.attachToBrowserTarget", params: {} }
    });

    const browserAttach = onResponse.mock.calls.find((call) => call[0]?.id === 1602)?.[0];
    const browserSessionId = browserAttach?.result?.sessionId as string;
    expect(browserSessionId).toEqual(expect.stringMatching(/^pw-browser-/));
    expect(browserSessionId).not.toBe(rootSessionId);

    await router.handleCommand({
      id: 1603,
      method: "forwardCDPCommand",
      params: {
        method: "Target.attachToTarget",
        params: { targetId: "tab-16", flatten: true },
        sessionId: browserSessionId
      }
    });

    expect(onResponse).toHaveBeenCalledWith({
      id: 1603,
      result: { sessionId: rootSessionId },
      sessionId: browserSessionId
    });
  });

  it("attaches to root targets without debugger roundtrip", async () => {
    const mock = createChromeMock();
    globalThis.chrome = mock.chrome;

    const router = new CDPRouter();
    const onEvent = vi.fn();
    const onResponse = vi.fn();
    const onDetach = vi.fn();

    router.setCallbacks({ onEvent, onResponse, onDetach });
    await router.attach(21);

    await router.handleCommand({
      id: 12,
      method: "forwardCDPCommand",
      params: { method: "Target.attachToTarget", params: { targetId: "tab-21", flatten: true } }
    });

    expect(onResponse).toHaveBeenCalledWith({
      id: 12,
      result: { sessionId: expect.stringMatching(/^pw-tab-/) }
    });
    expect(chrome.debugger.sendCommand).not.toHaveBeenCalledWith(
      expect.anything(),
      "Target.attachToTarget",
      expect.anything(),
      expect.anything()
    );
  });

  it("uses the root frame id for page target identity when Page.getFrameTree is available", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 21,
        url: "https://example.com/outer",
        title: "Example",
        groupId: 1
      }
    });
    globalThis.chrome = mock.chrome;

    vi.mocked(chrome.debugger.sendCommand).mockImplementation(
      (debuggee: chrome.debugger.Debuggee, method: string, _params: object, callback: (result?: unknown) => void) => {
        void debuggee;
        if (method === "Page.getFrameTree") {
          callback({
            frameTree: {
              frame: {
                id: "frame-21",
                url: "https://example.com/frame"
              }
            }
          });
          return;
        }
        if (method === "Target.attachToTarget") {
          callback({ sessionId: "child-session-21" });
          return;
        }
        callback({ ok: true });
      }
    );

    const router = new CDPRouter();
    const onEvent = vi.fn();
    const onResponse = vi.fn();
    const onDetach = vi.fn();

    router.setCallbacks({ onEvent, onResponse, onDetach });
    await router.attach(21);

    expect(chrome.debugger.sendCommand).not.toHaveBeenCalledWith(
      expect.anything(),
      "Page.getFrameTree",
      expect.anything(),
      expect.anything()
    );

    await router.handleCommand({
      id: 120,
      method: "forwardCDPCommand",
      params: { method: "Target.setAutoAttach", params: { autoAttach: true, flatten: true } }
    });

    const attachedCall = onEvent.mock.calls.find((call) => call[0]?.params?.method === "Target.attachedToTarget");
    expect(attachedCall?.[0]).toEqual({
      method: "forwardCDPEvent",
      params: {
        method: "Target.attachedToTarget",
        params: {
          sessionId: expect.any(String),
          targetInfo: expect.objectContaining({
            targetId: "frame-21",
            type: "page",
            title: "Example",
            url: "https://example.com/frame"
          }),
          waitingForDebugger: false
        }
      }
    });

    await router.handleCommand({
      id: 121,
      method: "forwardCDPCommand",
      params: { method: "Target.getTargets", params: {} }
    });
    expect(onResponse).toHaveBeenCalledWith({
      id: 121,
      result: { targetInfos: [expect.objectContaining({ targetId: "frame-21", url: "https://example.com/frame" })] }
    });

    await router.handleCommand({
      id: 122,
      method: "forwardCDPCommand",
      params: { method: "Target.getTargetInfo", params: { targetId: "frame-21" } }
    });
    expect(onResponse).toHaveBeenCalledWith({
      id: 122,
      result: { targetInfo: expect.objectContaining({ targetId: "frame-21", browserContextId: expect.any(String) }) }
    });

    await router.handleCommand({
      id: 123,
      method: "forwardCDPCommand",
      params: { method: "Target.attachToTarget", params: { targetId: "frame-21", flatten: true } }
    });

    expect(onResponse).toHaveBeenCalledWith({
      id: 123,
      result: { sessionId: expect.stringMatching(/^pw-tab-/) }
    });
    expect(chrome.debugger.sendCommand).not.toHaveBeenCalledWith(
      expect.anything(),
      "Target.attachToTarget",
      expect.anything(),
      expect.anything()
    );
  });

  it("stubs Browser.setDownloadBehavior without debugger call", async () => {
    const mock = createChromeMock();
    globalThis.chrome = mock.chrome;

    const router = new CDPRouter();
    const onEvent = vi.fn();
    const onResponse = vi.fn();
    const onDetach = vi.fn();

    router.setCallbacks({ onEvent, onResponse, onDetach });
    await router.attach(11);

    await router.handleCommand({
      id: 3,
      method: "forwardCDPCommand",
      params: {
        method: "Browser.setDownloadBehavior",
        params: { behavior: "allow", downloadPath: "/tmp" }
      }
    });

    expect(onResponse).toHaveBeenCalledWith({ id: 3, result: {} });
    expect(chrome.debugger.sendCommand).not.toHaveBeenCalledWith(
      expect.anything(),
      "Browser.setDownloadBehavior",
      expect.anything(),
      expect.anything()
    );
  });

  it("creates a root session for Target.setAutoAttach and routes session commands", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 7,
        url: "https://example.com",
        title: "Example",
        groupId: 1
      }
    });
    globalThis.chrome = mock.chrome;

    const router = new CDPRouter();
    const onEvent = vi.fn();
    const onResponse = vi.fn();
    const onDetach = vi.fn();

    router.setCallbacks({ onEvent, onResponse, onDetach });
    await router.attach(7);

    await router.handleCommand({
      id: 4,
      method: "forwardCDPCommand",
      params: {
        method: "Target.setAutoAttach",
        params: { autoAttach: true, flatten: true }
      }
    });

    const attachedCalls = onEvent.mock.calls.filter((call) => call[0]?.params?.method === "Target.attachedToTarget");
    const attachedCall = attachedCalls[0];
    expect(attachedCall).toBeTruthy();
    const attachedEvent = attachedCall?.[0];
    const sessionId = attachedEvent?.params?.params?.sessionId as string;
    expect(sessionId).toEqual(expect.any(String));
    expect(attachedEvent).toEqual({
      method: "forwardCDPEvent",
      params: {
        method: "Target.attachedToTarget",
        params: {
          sessionId: expect.any(String),
          targetInfo: expect.objectContaining({
            targetId: "tab-7",
            type: "page",
            browserContextId: expect.any(String),
            url: "https://example.com",
            title: "Example"
          }),
          waitingForDebugger: false
        }
      }
    });

    await router.handleCommand({
      id: 41,
      method: "forwardCDPCommand",
      params: {
        method: "Target.setAutoAttach",
        params: { autoAttach: true, flatten: true },
        sessionId
      }
    });

    expect(onResponse).toHaveBeenCalledWith({ id: 41, result: {}, sessionId });
    const attachedCallsAfter = onEvent.mock.calls.filter((call) => call[0]?.params?.method === "Target.attachedToTarget");
    expect(attachedCallsAfter.length).toBe(attachedCalls.length);

    await router.handleCommand({
      id: 5,
      method: "forwardCDPCommand",
      params: {
        method: "Runtime.enable",
        params: {},
        sessionId
      }
    });

    expect(chrome.debugger.sendCommand).not.toHaveBeenCalledWith(
      expect.anything(),
      "Runtime.enable",
      expect.anything(),
      expect.anything()
    );
    expect(chrome.debugger.sendCommand).not.toHaveBeenCalledWith(
      expect.anything(),
      "Target.sendMessageToTarget",
      expect.anything(),
      expect.anything()
    );
    expect(onResponse).toHaveBeenCalledWith({ id: 5, result: {}, sessionId });
    expect(onEvent).toHaveBeenCalledWith({
      method: "forwardCDPEvent",
      params: {
        method: "Runtime.executionContextCreated",
        params: {
          context: expect.objectContaining({
            id: 1,
            origin: "https://example.com",
            auxData: expect.objectContaining({
              frameId: "tab-7",
              isDefault: true,
              type: "default"
            })
          })
        },
        sessionId
      }
    });

    await router.handleCommand({
      id: 6,
      method: "forwardCDPCommand",
      params: { method: "Target.getTargets", params: {} }
    });
    expect(onResponse).toHaveBeenCalledWith({
      id: 6,
      result: { targetInfos: [expect.objectContaining({ targetId: "tab-7" })] }
    });

    await router.handleCommand({
      id: 7,
      method: "forwardCDPCommand",
      params: { method: "Target.getTargetInfo", params: { targetId: "tab-7" } }
    });
    expect(onResponse).toHaveBeenCalledWith({
      id: 7,
      result: { targetInfo: expect.objectContaining({ targetId: "tab-7", browserContextId: expect.any(String) }) }
    });

    await router.handleCommand({
      id: 701,
      method: "forwardCDPCommand",
      params: { method: "Target.getTargetInfo", params: {} }
    });
    expect(onResponse).toHaveBeenCalledWith({
      id: 701,
      result: {
        targetInfo: expect.objectContaining({
          targetId: "browser",
          type: "browser",
          title: "OpenDevBrowser Relay"
        })
      }
    });

    await router.handleCommand({
      id: 8,
      method: "forwardCDPCommand",
      params: { method: "Target.setAutoAttach", params: { autoAttach: false } }
    });
    const detachedCall = onEvent.mock.calls.find((call) => call[0]?.params?.method === "Target.detachedFromTarget");
    expect(detachedCall).toBeTruthy();
  });

  it("responds to the Playwright bootstrap sequence on synthetic root sessions", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 51,
        url: "https://example.com/bootstrap",
        title: "Bootstrap",
        groupId: 1
      }
    });
    globalThis.chrome = mock.chrome;

    vi.mocked(chrome.debugger.sendCommand).mockImplementation(
      (debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
        void debuggee;
        void params;
        if (
          method === "Page.enable"
          || method === "Log.enable"
          || method === "Page.setLifecycleEventsEnabled"
          || method === "Network.enable"
        ) {
          callback({});
          return;
        }
        callback({ ok: true });
      }
    );

    const router = new CDPRouter();
    const onEvent = vi.fn();
    const onResponse = vi.fn();
    const onDetach = vi.fn();

    router.setCallbacks({ onEvent, onResponse, onDetach });
    await router.attach(51);

    await router.handleCommand({
      id: 900,
      method: "forwardCDPCommand",
      params: { method: "Target.setAutoAttach", params: { autoAttach: true, waitForDebuggerOnStart: true, flatten: true } }
    });

    const attachedCall = onEvent.mock.calls.find((call) => call[0]?.params?.method === "Target.attachedToTarget");
    const sessionId = attachedCall?.[0]?.params?.params?.sessionId as string;
    expect(sessionId).toEqual(expect.any(String));

    onResponse.mockClear();
    onEvent.mockClear();

    const commands = [
      { id: 901, method: "Page.enable", params: {} },
      { id: 902, method: "Page.getFrameTree", params: {} },
      { id: 903, method: "Log.enable", params: {} },
      { id: 904, method: "Page.setLifecycleEventsEnabled", params: { enabled: true } },
      { id: 905, method: "Runtime.enable", params: {} },
      {
        id: 906,
        method: "Page.addScriptToEvaluateOnNewDocument",
        params: { source: "", worldName: "__playwright_utility_world_page@test" }
      },
      { id: 907, method: "Network.enable", params: {} },
      { id: 908, method: "Emulation.setFocusEmulationEnabled", params: { enabled: true } },
      { id: 909, method: "Emulation.setEmulatedMedia", params: { media: "", features: [] } },
      { id: 910, method: "Runtime.runIfWaitingForDebugger", params: {} }
    ] as const;

    for (const command of commands) {
      await router.handleCommand({
        id: command.id,
        method: "forwardCDPCommand",
        params: { method: command.method, params: command.params, sessionId }
      });
    }

    expect(onResponse).toHaveBeenCalledWith({ id: 901, result: {}, sessionId });
    expect(onResponse).toHaveBeenCalledWith({
      id: 902,
      result: {
        frameTree: {
          frame: expect.objectContaining({
            id: "tab-51",
            loaderId: "tab-51",
            url: "https://example.com/bootstrap",
            mimeType: "text/html"
          })
        }
      },
      sessionId
    });
    expect(onResponse).toHaveBeenCalledWith({ id: 903, result: {}, sessionId });
    expect(onResponse).toHaveBeenCalledWith({ id: 904, result: {}, sessionId });
    expect(onResponse).toHaveBeenCalledWith({ id: 905, result: {}, sessionId });
    expect(onResponse).toHaveBeenCalledWith({
      id: 906,
      result: { identifier: "odb-root-script-906" },
      sessionId
    });
    expect(onResponse).toHaveBeenCalledWith({ id: 907, result: {}, sessionId });
    expect(onResponse).toHaveBeenCalledWith({ id: 908, result: {}, sessionId });
    expect(onResponse).toHaveBeenCalledWith({ id: 909, result: {}, sessionId });
    expect(onResponse).toHaveBeenCalledWith({ id: 910, result: {}, sessionId });
    expect(chrome.debugger.sendCommand).toHaveBeenCalledWith(
      { targetId: "target-51" },
      "Page.enable",
      {},
      expect.any(Function)
    );
    expect(chrome.debugger.sendCommand).toHaveBeenCalledWith(
      { targetId: "target-51" },
      "Log.enable",
      {},
      expect.any(Function)
    );
    expect(chrome.debugger.sendCommand).toHaveBeenCalledWith(
      { targetId: "target-51" },
      "Page.setLifecycleEventsEnabled",
      { enabled: true },
      expect.any(Function)
    );
    expect(chrome.debugger.sendCommand).toHaveBeenCalledWith(
      { targetId: "target-51" },
      "Network.enable",
      {},
      expect.any(Function)
    );
    expect(onEvent).toHaveBeenCalledWith({
      method: "forwardCDPEvent",
      params: {
        method: "Runtime.executionContextCreated",
        params: {
          context: expect.objectContaining({
            id: 1,
            origin: "https://example.com",
            auxData: expect.objectContaining({
              frameId: "tab-51",
              isDefault: true,
              type: "default"
            })
          })
        },
        sessionId
      }
    });
  });

  it("keeps synthetic compat replies working if a pw-tab session is reclassified at runtime", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 52,
        url: "https://example.com/reclassified",
        title: "Reclassified",
        groupId: 1
      }
    });
    globalThis.chrome = mock.chrome;

    const router = new CDPRouter();
    const onEvent = vi.fn();
    const onResponse = vi.fn();
    const onDetach = vi.fn();

    router.setCallbacks({ onEvent, onResponse, onDetach });
    await router.attach(52);
    await router.handleCommand({
      id: 920,
      method: "forwardCDPCommand",
      params: { method: "Target.setAutoAttach", params: { autoAttach: true, flatten: true } }
    });

    const attachedCall = onEvent.mock.calls.find((call) => call[0]?.params?.method === "Target.attachedToTarget");
    const sessionId = attachedCall?.[0]?.params?.params?.sessionId as string;
    expect(sessionId).toEqual(expect.any(String));

    const internals = router as unknown as {
      sessions: {
        registerAttachedRootSession: (tabId: number, sessionId: string) => void;
      };
    };
    internals.sessions.registerAttachedRootSession(52, sessionId);

    onResponse.mockClear();
    onEvent.mockClear();

    await router.handleCommand({
      id: 921,
      method: "forwardCDPCommand",
      params: { method: "Runtime.enable", params: {}, sessionId }
    });

    expect(onResponse).toHaveBeenCalledWith({ id: 921, result: {}, sessionId });
    expect(onEvent).toHaveBeenCalledWith({
      method: "forwardCDPEvent",
      params: {
        method: "Runtime.executionContextCreated",
        params: {
          context: expect.objectContaining({
            id: 1,
            origin: "https://example.com",
            auxData: expect.objectContaining({
              frameId: "tab-52",
              isDefault: true,
              type: "default"
            })
          })
        },
        sessionId
      }
    });
  });

  it("rebuilds synthetic compat replies from the primary tab when the pw-tab session record is missing", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 53,
        url: "https://example.com/missing-session",
        title: "Missing Session",
        groupId: 1
      }
    });
    globalThis.chrome = mock.chrome;

    const router = new CDPRouter();
    const onEvent = vi.fn();
    const onResponse = vi.fn();
    const onDetach = vi.fn();

    router.setCallbacks({ onEvent, onResponse, onDetach });
    await router.attach(53);
    await router.handleCommand({
      id: 930,
      method: "forwardCDPCommand",
      params: { method: "Target.setAutoAttach", params: { autoAttach: true, flatten: true } }
    });

    const attachedCall = onEvent.mock.calls.find((call) => call[0]?.params?.method === "Target.attachedToTarget");
    const sessionId = attachedCall?.[0]?.params?.params?.sessionId as string;
    expect(sessionId).toEqual(expect.any(String));

    const internals = router as unknown as {
      sessions: {
        sessionsById: Map<string, unknown>;
      };
    };
    internals.sessions.sessionsById.delete(sessionId);

    onResponse.mockClear();
    onEvent.mockClear();

    await router.handleCommand({
      id: 931,
      method: "forwardCDPCommand",
      params: { method: "Runtime.enable", params: {}, sessionId }
    });

    expect(onResponse).toHaveBeenCalledWith({ id: 931, result: {}, sessionId });
    expect(onEvent).toHaveBeenCalledWith({
      method: "forwardCDPEvent",
      params: {
        method: "Runtime.executionContextCreated",
        params: {
          context: expect.objectContaining({
            id: 1,
            origin: "https://example.com",
            auxData: expect.objectContaining({
              frameId: "tab-53",
              isDefault: true,
              type: "default"
            })
          })
        },
        sessionId
      }
    });
  });

  it("resets stale legacy state before the next client command", async () => {
    const mock = createChromeMock({
      tabs: [
        { id: 1, url: "https://stale.example/one", title: "One", groupId: 1, status: "complete", active: false },
        { id: 2, url: "https://fresh.example/two", title: "Two", groupId: 1, status: "complete", active: true }
      ],
      activeTab: { id: 2, url: "https://fresh.example/two", title: "Two", groupId: 1, status: "complete", active: true }
    });
    globalThis.chrome = mock.chrome;

    const router = new CDPRouter();
    const onEvent = vi.fn();
    const onResponse = vi.fn();
    const onDetach = vi.fn();

    router.setCallbacks({ onEvent, onResponse, onDetach });
    await router.attach(1);
    await router.attach(2);
    await router.handleCommand({
      id: 801,
      method: "forwardCDPCommand",
      params: { method: "Target.setAutoAttach", params: { autoAttach: true, flatten: true } }
    });

    router.markClientClosed();
    onEvent.mockClear();
    onResponse.mockClear();

    await router.handleCommand({
      id: 802,
      method: "forwardCDPCommand",
      params: { method: "Browser.getVersion", params: {} }
    });
    await router.handleCommand({
      id: 803,
      method: "forwardCDPCommand",
      params: { method: "Target.setAutoAttach", params: { autoAttach: true, flatten: true } }
    });

    expect(router.getAttachedTabIds()).toEqual([2]);
    expect(chrome.debugger.detach).toHaveBeenCalledWith({ targetId: "target-1" }, expect.any(Function));
    expect(onResponse).toHaveBeenCalledWith({
      id: 802,
      result: expect.objectContaining({ product: expect.any(String) })
    });
    expect(onResponse).toHaveBeenCalledWith({ id: 803, result: {} });
    const attachedCalls = onEvent.mock.calls.filter((call) => call[0]?.params?.method === "Target.attachedToTarget");
    expect(attachedCalls).toHaveLength(1);
    expect(attachedCalls[0]?.[0]).toEqual({
      method: "forwardCDPEvent",
      params: {
        method: "Target.attachedToTarget",
        params: {
          sessionId: expect.any(String),
          targetInfo: expect.objectContaining({
            targetId: "tab-2",
            url: "https://fresh.example/two",
            title: "Two"
          }),
          waitingForDebugger: false
        }
      }
    });
  });

  it("refreshes the retained root debuggee before reapplying auto-attach for the next client", async () => {
    const mock = createChromeMock({
      tabs: [
        { id: 2, url: "https://fresh.example/two", title: "Two", groupId: 1, status: "complete", active: true }
      ],
      activeTab: { id: 2, url: "https://fresh.example/two", title: "Two", groupId: 1, status: "complete", active: true }
    });
    globalThis.chrome = mock.chrome;

    const router = new CDPRouter();
    const onEvent = vi.fn();
    const onResponse = vi.fn();
    const onDetach = vi.fn();

    router.setCallbacks({ onEvent, onResponse, onDetach });
    await router.attach(2);

    const originalGetTargets = vi.mocked(chrome.debugger.getTargets).getMockImplementation();
    const originalSendCommand = vi.mocked(chrome.debugger.sendCommand).getMockImplementation();
    let refreshTargetIds = false;

    vi.mocked(chrome.debugger.getTargets).mockImplementation((callback) => {
      if (refreshTargetIds) {
        callback([
          {
            id: "refreshed-target-2",
            tabId: 2,
            type: "page",
            title: "Two",
            url: "https://fresh.example/two",
            attached: false
          } as chrome.debugger.TargetInfo
        ]);
        return;
      }
      originalGetTargets?.(callback);
    });

    chrome.debugger.sendCommand = vi.fn((debuggee, method, params, callback) => {
      if (refreshTargetIds && method === "Target.setAutoAttach" && debuggee.targetId === "target-2") {
        mock.setRuntimeError("No target with given id target-2");
        callback();
        mock.setRuntimeError(null);
        return;
      }
      originalSendCommand?.(debuggee, method, params, callback);
    }) as typeof chrome.debugger.sendCommand;

    router.markClientClosed();
    refreshTargetIds = true;

    await router.handleCommand({
      id: 804,
      method: "forwardCDPCommand",
      params: { method: "Browser.getVersion", params: {} }
    });
    await router.handleCommand({
      id: 805,
      method: "forwardCDPCommand",
      params: { method: "Target.setAutoAttach", params: { autoAttach: true, flatten: true } }
    });

    expect(onResponse).toHaveBeenCalledWith({
      id: 804,
      result: expect.objectContaining({ product: expect.any(String) })
    });
    expect(onResponse).toHaveBeenCalledWith({ id: 805, result: {} });
    expect(chrome.debugger.sendCommand).toHaveBeenCalledWith(
      { targetId: "refreshed-target-2" },
      "Target.setAutoAttach",
      expect.objectContaining({ autoAttach: true, flatten: true }),
      expect.any(Function)
    );
  });

  it("prefers a normal web tab over a restricted canvas tab when resetting stale legacy state", async () => {
    const mock = createChromeMock({
      tabs: [
        { id: 1, url: "https://example.com/workspace", title: "Workspace", groupId: 1, status: "complete", active: false },
        { id: 2, url: "chrome-extension://test/canvas.html", title: "Canvas", groupId: 1, status: "complete", active: true }
      ],
      activeTab: { id: 2, url: "chrome-extension://test/canvas.html", title: "Canvas", groupId: 1, status: "complete", active: true }
    });
    globalThis.chrome = mock.chrome;

    const router = new CDPRouter();
    const onEvent = vi.fn();
    const onResponse = vi.fn();
    const onDetach = vi.fn();

    router.setCallbacks({ onEvent, onResponse, onDetach });
    await router.attach(2);

    router.markClientClosed();

    await router.handleCommand({
      id: 806,
      method: "forwardCDPCommand",
      params: { method: "Browser.getVersion", params: {} }
    });

    expect(router.getPrimaryTabId()).toBe(1);
    expect(router.getAttachedTabIds()).toEqual([1]);
    expect(chrome.debugger.attach).toHaveBeenCalledWith({ targetId: "target-1" }, "1.3", expect.any(Function));
    expect(onResponse).toHaveBeenCalledWith({
      id: 806,
      result: expect.objectContaining({ product: expect.any(String) })
    });
  });

  it("tags forwarded events with the root session id", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 3,
        url: "https://example.com/relay",
        title: "Relay",
        groupId: 1
      }
    });
    globalThis.chrome = mock.chrome;

    const router = new CDPRouter();
    const onEvent = vi.fn();
    const onResponse = vi.fn();
    const onDetach = vi.fn();

    router.setCallbacks({ onEvent, onResponse, onDetach });
    await router.attach(3);

    await router.handleCommand({
      id: 9,
      method: "forwardCDPCommand",
      params: {
        method: "Target.setAutoAttach",
        params: { autoAttach: true, flatten: true }
      }
    });

    const attachedCall = onEvent.mock.calls.find((call) => call[0]?.params?.method === "Target.attachedToTarget");
    const sessionId = attachedCall?.[0]?.params?.params?.sessionId as string;

    mock.emitDebuggerEvent({ tabId: 3 }, "Runtime.consoleAPICalled", { type: "log" });

    const forwardedCall = onEvent.mock.calls.find((call) => call[0]?.params?.method === "Runtime.consoleAPICalled");
    expect(forwardedCall?.[0]).toEqual({
      method: "forwardCDPEvent",
      params: {
        method: "Runtime.consoleAPICalled",
        params: { type: "log" },
        sessionId
      }
    });
  });

  it("tags targetId-scoped root events with the root session id", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 55,
        url: "https://example.com/target-source",
        title: "Target Source",
        groupId: 1
      }
    });
    globalThis.chrome = mock.chrome;

    const router = new CDPRouter();
    const onEvent = vi.fn();
    const onResponse = vi.fn();
    const onDetach = vi.fn();

    router.setCallbacks({ onEvent, onResponse, onDetach });
    await router.attach(55);

    await router.handleCommand({
      id: 913,
      method: "forwardCDPCommand",
      params: {
        method: "Target.setAutoAttach",
        params: { autoAttach: true, flatten: true }
      }
    });

    const attachedCall = onEvent.mock.calls.find((call) => call[0]?.params?.method === "Target.attachedToTarget");
    const rootSessionId = attachedCall?.[0]?.params?.params?.sessionId as string;
    expect(rootSessionId).toEqual(expect.any(String));

    onEvent.mockClear();
    mock.emitDebuggerEvent({ targetId: "target-55" }, "Page.lifecycleEvent", {
      frameId: "tab-55",
      loaderId: "loader-55",
      name: "load",
      timestamp: 1
    });

    expect(onEvent).toHaveBeenCalledWith({
      method: "forwardCDPEvent",
      params: {
        method: "Page.lifecycleEvent",
        params: {
          frameId: "tab-55",
          loaderId: "loader-55",
          name: "load",
          timestamp: 1
        },
        sessionId: rootSessionId
      }
    });
  });

  it("routes root lifecycle events through the attached browser session when available", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 54,
        url: "https://example.com/attached-root",
        title: "Attached Root",
        groupId: 1
      }
    });
    globalThis.chrome = mock.chrome;

    const router = new CDPRouter();
    const onEvent = vi.fn();
    const onResponse = vi.fn();
    const onDetach = vi.fn();

    router.setCallbacks({ onEvent, onResponse, onDetach });
    await router.attach(54);

    await router.handleCommand({
      id: 911,
      method: "forwardCDPCommand",
      params: {
        method: "Target.setAutoAttach",
        params: { autoAttach: true, flatten: true }
      }
    });

    const rootAttachedCall = onEvent.mock.calls.find((call) => call[0]?.params?.method === "Target.attachedToTarget");
    const rootSessionId = rootAttachedCall?.[0]?.params?.params?.sessionId as string;
    expect(rootSessionId).toEqual(expect.any(String));

    await router.handleCommand({
      id: 912,
      method: "forwardCDPCommand",
      params: { method: "Target.attachToBrowserTarget", params: {} }
    });

    const browserAttachResponse = onResponse.mock.calls.find((call) => call[0]?.id === 912);
    const browserSessionId = browserAttachResponse?.[0]?.result?.sessionId as string;
    expect(browserSessionId).toEqual(expect.any(String));
    expect(browserSessionId).not.toBe(rootSessionId);

    onEvent.mockClear();
    mock.emitDebuggerEvent({ tabId: 54 }, "Page.lifecycleEvent", {
      frameId: "tab-54",
      loaderId: "loader-54",
      name: "load",
      timestamp: 1
    });

    expect(onEvent).toHaveBeenCalledWith({
      method: "forwardCDPEvent",
      params: {
        method: "Page.lifecycleEvent",
        params: {
          frameId: "tab-54",
          loaderId: "loader-54",
          name: "load",
          timestamp: 1
        },
        sessionId: browserSessionId
      }
    });
  });

  it("routes child session commands via DebuggerSession sessionId", async () => {
    const mock = createChromeMock();
    globalThis.chrome = mock.chrome;

    const router = new CDPRouter();
    const onEvent = vi.fn();
    const onResponse = vi.fn();
    const onDetach = vi.fn();

    router.setCallbacks({ onEvent, onResponse, onDetach });
    await router.attach(1);

    await router.handleCommand({
      id: 10,
      method: "forwardCDPCommand",
      params: { method: "Target.attachToTarget", params: { targetId: "child-1", flatten: true } }
    });

    const responseCall = onResponse.mock.calls.find((call) => call[0]?.id === 10);
    const childSessionId = responseCall?.[0]?.result?.sessionId as string;
    expect(childSessionId).toEqual(expect.any(String));

    await router.handleCommand({
      id: 11,
      method: "forwardCDPCommand",
      params: { method: "Runtime.enable", params: {}, sessionId: childSessionId }
    });

    expect(chrome.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 1, sessionId: childSessionId },
      "Runtime.enable",
      {},
      expect.any(Function)
    );
  });

  it("creates and closes targets via tab manager", async () => {
    const mock = createChromeMock();
    globalThis.chrome = mock.chrome;

    const router = new CDPRouter();
    const onEvent = vi.fn();
    const onResponse = vi.fn();
    const onDetach = vi.fn();

    router.setCallbacks({ onEvent, onResponse, onDetach });
    await router.attach(1);

    await router.handleCommand({
      id: 19,
      method: "forwardCDPCommand",
      params: { method: "Target.setDiscoverTargets", params: { discover: true } }
    });

    expect(chrome.debugger.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ targetId: expect.any(String) }),
      "Target.setDiscoverTargets",
      { discover: true },
      expect.any(Function)
    );

    await router.handleCommand({
      id: 20,
      method: "forwardCDPCommand",
      params: { method: "Target.createTarget", params: { url: "https://example.com/new" } }
    });

    const createResponse = onResponse.mock.calls.find((call) => call[0]?.id === 20);
    const targetId = createResponse?.[0]?.result?.targetId as string;
    expect(targetId).toMatch(/^tab-/);
    expect(chrome.tabs.create).toHaveBeenCalled();

    const createdEvent = onEvent.mock.calls.find((call) => call[0]?.params?.method === "Target.targetCreated");
    expect(createdEvent).toBeTruthy();

    await router.handleCommand({
      id: 21,
      method: "forwardCDPCommand",
      params: { method: "Target.closeTarget", params: { targetId } }
    });

    expect(chrome.tabs.remove).toHaveBeenCalled();
    const closeResponse = onResponse.mock.calls.find((call) => call[0]?.id === 21);
    expect(closeResponse?.[0]?.result).toEqual({ success: true });
  });

  it("applies discover-target state through the direct helper and on later root attaches", async () => {
    const mock = createChromeMock();
    globalThis.chrome = mock.chrome;

    const router = new CDPRouter();
    router.setCallbacks({ onEvent: vi.fn(), onResponse: vi.fn(), onDetach: vi.fn() });
    await router.attach(1);

    chrome.debugger.sendCommand.mockClear();
    await router.setDiscoverTargetsEnabled(true);

    expect(chrome.debugger.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ targetId: expect.any(String) }),
      "Target.setDiscoverTargets",
      { discover: true },
      expect.any(Function)
    );

    chrome.debugger.sendCommand.mockClear();
    await router.attach(2);

    expect(chrome.debugger.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 2 }),
      "Target.setDiscoverTargets",
      { discover: true },
      expect.any(Function)
    );
  });

  it("reissues auto-attach for child sessions", async () => {
    const mock = createChromeMock();
    globalThis.chrome = mock.chrome;

    const router = new CDPRouter();
    const onEvent = vi.fn();
    const onResponse = vi.fn();
    const onDetach = vi.fn();

    router.setCallbacks({ onEvent, onResponse, onDetach });
    await router.attach(1);

    await router.handleCommand({
      id: 12,
      method: "forwardCDPCommand",
      params: { method: "Target.setAutoAttach", params: { autoAttach: true, flatten: true } }
    });

    mock.emitDebuggerEvent(
      { tabId: 1, sessionId: "child-session-1" },
      "Target.attachedToTarget",
      { sessionId: "child-session-1", targetInfo: { targetId: "child-1", type: "page" } }
    );

    expect(chrome.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 1, sessionId: "child-session-1" },
      "Target.setAutoAttach",
      expect.objectContaining({ autoAttach: true, flatten: true }),
      expect.any(Function)
    );
  });

  it("fails fast when flat sessions are unsupported", async () => {
    const mock = createChromeMock();
    globalThis.chrome = mock.chrome;
    mock.setRuntimeError(null);
    const originalSendCommand = chrome.debugger.sendCommand;
    chrome.debugger.sendCommand = ((debuggee, method, params, callback) => {
      if (method === "Target.setAutoAttach") {
        mock.setRuntimeError("Unsupported");
      }
      return originalSendCommand(debuggee, method, params, callback);
    }) as typeof chrome.debugger.sendCommand;

    const router = new CDPRouter();
    await expect(router.attach(99)).rejects.toThrow("Chrome 125+ required");
  });
});
