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
    expect(onResponse).toHaveBeenCalledWith({ id: 2, result: { ok: true }, sessionId });

    mock.emitDebuggerEvent({ tabId: 7 }, "Runtime.consoleAPICalled", { type: "log" });
    const forwardedCall = onEvent.mock.calls.find((call) => call[0]?.params?.method === "Runtime.consoleAPICalled");
    expect(forwardedCall?.[0]).toEqual({
      method: "forwardCDPEvent",
      params: { method: "Runtime.consoleAPICalled", params: { type: "log" }, sessionId }
    });

    mock.emitDebuggerDetach({ tabId: 7 });
    expect(onDetach).toHaveBeenCalledTimes(1);
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

  it("responds to Target.attachToBrowserTarget with root session id", async () => {
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
      result: { sessionId: expect.stringMatching(/^pw-tab-/) }
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

    expect(chrome.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 7 },
      "Runtime.enable",
      {},
      expect.any(Function)
    );
    expect(chrome.debugger.sendCommand).not.toHaveBeenCalledWith(
      expect.anything(),
      "Target.sendMessageToTarget",
      expect.anything(),
      expect.anything()
    );
    expect(onResponse).toHaveBeenCalledWith({ id: 5, result: { ok: true }, sessionId });

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
      id: 8,
      method: "forwardCDPCommand",
      params: { method: "Target.setAutoAttach", params: { autoAttach: false } }
    });
    const detachedCall = onEvent.mock.calls.find((call) => call[0]?.params?.method === "Target.detachedFromTarget");
    expect(detachedCall).toBeTruthy();
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
