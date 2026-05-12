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

  it("does not log expected already-detached cleanup failures as extension errors", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 43,
        url: "https://example.com/already-detached",
        title: "Already Detached",
        groupId: 1,
        status: "complete",
        active: true
      }
    });
    globalThis.chrome = mock.chrome;
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const detachMock = globalThis.chrome.debugger.detach as unknown as ReturnType<typeof vi.fn>;
    detachMock.mockImplementation((_debuggee: chrome.debugger.Debuggee, callback: () => void) => {
      mock.setRuntimeError("Debugger is not attached to the tab with id: 43.");
      callback();
      mock.setRuntimeError(null);
    });

    const router = new CDPRouter();
    await router.attach(43);
    await router.detachAll();

    expect(consoleErrorSpy).not.toHaveBeenCalledWith(
      "[opendevbrowser]",
      expect.stringContaining("\"context\":\"cdp.safe_detach\"")
    );
    consoleErrorSpy.mockRestore();
  });

  it("records root attach diagnostics when chrome.debugger.attach fails at tab attach", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 90,
        url: "https://example.com/root-attach",
        title: "Root Attach",
        groupId: 1,
        status: "complete",
        active: true
      }
    });
    globalThis.chrome = mock.chrome;

    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    attachMock.mockImplementation((_debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      mock.setRuntimeError("Not allowed");
      callback();
      mock.setRuntimeError(null);
    });

    const router = new CDPRouter();

    await expect(router.attach(90)).rejects.toThrow("Not allowed");
    expect(router.getLastRootAttachDiagnostic(90)).toEqual(expect.objectContaining({
      tabId: 90,
      origin: "root_attach",
      stage: "root_debugger_attach_failed",
      attachBy: "tabId",
      reason: "Not allowed"
    }));
  });

  it("records flat-session bootstrap diagnostics when Target.setAutoAttach fails after root attach", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 91,
        url: "https://example.com/flat-session-probe",
        title: "Flat Session Probe",
        groupId: 1,
        status: "complete",
        active: true
      }
    });
    globalThis.chrome = mock.chrome;

    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    sendCommandMock.mockImplementation(
      (debuggee: chrome.debugger.Debuggee, method: string, _params: object, callback: (result?: unknown) => void) => {
        const debuggeeTargetId = (debuggee as { targetId?: string }).targetId;
        if (
          method === "Target.setAutoAttach"
          && ((debuggee as { tabId?: number }).tabId === 91 || debuggeeTargetId === "target-91")
        ) {
          mock.setRuntimeError("Not allowed");
          callback(undefined);
          mock.setRuntimeError(null);
          return;
        }
        callback({ ok: true });
      }
    );

    const router = new CDPRouter();

    await expect(router.attach(91)).rejects.toThrow(
      "Chrome 125+ required for extension relay (flat sessions). (Not allowed)"
    );
    expect(router.getLastRootAttachDiagnostic(91)).toEqual(expect.objectContaining({
      tabId: 91,
      origin: "flat_session_bootstrap",
      stage: "fallback_flat_session_probe_failed",
      attachBy: "targetId",
      probeMethod: "Target.setAutoAttach",
      reason: "Chrome 125+ required for extension relay (flat sessions). (Not allowed)"
    }));
  });

  it("clears stale root attach diagnostics after a later successful attach", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 92,
        url: "https://example.com/root-attach-retry",
        title: "Root Attach Retry",
        groupId: 1,
        status: "complete",
        active: true
      }
    });
    globalThis.chrome = mock.chrome;

    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    attachMock
      .mockImplementationOnce((_debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
        mock.setRuntimeError("Not allowed");
        callback();
        mock.setRuntimeError(null);
      })
      .mockImplementation((_debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
        callback();
      });

    const router = new CDPRouter();

    await expect(router.attach(92)).rejects.toThrow("Not allowed");
    expect(router.getLastRootAttachDiagnostic(92)).toEqual(expect.objectContaining({
      origin: "root_attach",
      stage: "root_debugger_attach_failed"
    }));

    await expect(router.attach(92)).resolves.toBeUndefined();
    expect(router.getLastRootAttachDiagnostic(92)).toBeNull();
  });

  it("reports whether a root tab is currently attached", async () => {
    const router = new CDPRouter();

    expect(router.isTabAttached(42)).toBe(false);

    await router.attach(42);
    expect(router.isTabAttached(42)).toBe(true);

    await router.detachTab(42);
    expect(router.isTabAttached(42)).toBe(false);
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
    expect(chrome.debugger.detach).toHaveBeenCalledWith({ tabId: 1 }, expect.any(Function));

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

  it("forwards dialog events when Chrome reports an unknown source session but preserves the attached tab id", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 84,
        url: "https://example.com/dialog",
        title: "Dialog",
        groupId: 1,
        status: "complete",
        active: true
      }
    });
    globalThis.chrome = mock.chrome;

    const router = new CDPRouter();
    const events: Array<{ tabId: number; method: string; params?: unknown; sessionId?: string }> = [];
    router.setCallbacks({ onEvent: vi.fn(), onResponse: vi.fn(), onDetach: vi.fn() });
    router.addEventListener((event) => {
      events.push(event);
    });

    await router.attach(84);
    events.length = 0;

    mock.emitDebuggerEvent(
      { tabId: 84, sessionId: "unknown-root-session" },
      "Page.javascriptDialogOpening",
      {
        type: "alert",
        message: "I am a JS Alert",
        url: "https://example.com/dialog"
      }
    );

    await vi.waitFor(() => {
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            tabId: 84,
            method: "Page.javascriptDialogOpening",
            params: expect.objectContaining({
              type: "alert",
              message: "I am a JS Alert",
              url: "https://example.com/dialog"
            })
          })
        ])
      );
    });
  });

  it("forwards dialog events when Chrome reports only an unknown source session and a single attached tab is available", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 85,
        url: "https://example.com/dialog-single-session",
        title: "Dialog Single Session",
        groupId: 1,
        status: "complete",
        active: true
      }
    });
    globalThis.chrome = mock.chrome;

    const router = new CDPRouter();
    const events: Array<{ tabId: number; method: string; params?: unknown; sessionId?: string }> = [];
    router.setCallbacks({ onEvent: vi.fn(), onResponse: vi.fn(), onDetach: vi.fn() });
    router.addEventListener((event) => {
      events.push(event);
    });

    await router.attach(85);
    events.length = 0;

    mock.emitDebuggerEvent(
      { sessionId: "unknown-root-session" },
      "Page.javascriptDialogOpening",
      {
        type: "alert",
        message: "I am a JS Alert",
        url: "https://example.com/dialog-single-session"
      }
    );

    await vi.waitFor(() => {
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            tabId: 85,
            method: "Page.javascriptDialogOpening",
            params: expect.objectContaining({
              type: "alert",
              message: "I am a JS Alert",
              url: "https://example.com/dialog-single-session"
            })
          })
        ])
      );
    });
  });

  it("detaches an already attached root tab before attaching a different root tab", async () => {
    const mock = createChromeMock({
      tabs: [
        { id: 1, url: "https://example.com/one", title: "One", groupId: 1, status: "complete", active: true },
        { id: 2, url: "https://example.com/two", title: "Two", groupId: 1, status: "complete", active: false }
      ]
    });
    globalThis.chrome = mock.chrome;

    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const detachMock = globalThis.chrome.debugger.detach as unknown as ReturnType<typeof vi.fn>;
    let attachedTabId: number | null = null;
    const resolveDebuggeeTabId = (debuggee: chrome.debugger.Debuggee): number | null => {
      if (typeof debuggee.tabId === "number") {
        return debuggee.tabId;
      }
      if (typeof debuggee.targetId === "string" && debuggee.targetId.startsWith("target-")) {
        const parsed = Number.parseInt(debuggee.targetId.slice("target-".length), 10);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };

    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (typeof tabId === "number" && attachedTabId !== null && attachedTabId !== tabId) {
        mock.setRuntimeError("Not allowed");
        callback();
        mock.setRuntimeError(null);
        return;
      }
      attachedTabId = typeof tabId === "number" ? tabId : attachedTabId;
      callback();
    });

    detachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, callback: () => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (typeof tabId === "number" && attachedTabId === tabId) {
        attachedTabId = null;
      }
      callback();
    });

    const router = new CDPRouter();
    await router.attach(1);

    attachMock.mockClear();
    detachMock.mockClear();

    await router.attach(2);

    expect(detachMock).toHaveBeenCalledWith({ tabId: 1 }, expect.any(Function));
    expect(attachMock).toHaveBeenCalledWith({ tabId: 2 }, "1.3", expect.any(Function));
    expect(detachMock.mock.invocationCallOrder[0]).toBeLessThan(attachMock.mock.invocationCallOrder[0]);
    expect(router.getPrimaryTabId()).toBe(2);
    expect(router.getAttachedTabIds()).toEqual([2]);
  });

  it("restores the previous root tab when a replacement attach reports another attached debugger", async () => {
    const mock = createChromeMock({
      tabs: [
        { id: 1, url: "https://example.com/one", title: "One", groupId: 1, status: "complete", active: true },
        { id: 2, url: "https://example.com/two", title: "Two", groupId: 1, status: "complete", active: false }
      ]
    });
    globalThis.chrome = mock.chrome;

    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const detachMock = globalThis.chrome.debugger.detach as unknown as ReturnType<typeof vi.fn>;
    let attachedTabId: number | null = null;
    const resolveDebuggeeTabId = (debuggee: chrome.debugger.Debuggee): number | null => {
      if (typeof debuggee.tabId === "number") {
        return debuggee.tabId;
      }
      if (typeof debuggee.targetId === "string" && debuggee.targetId.startsWith("target-")) {
        const parsed = Number.parseInt(debuggee.targetId.slice("target-".length), 10);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };

    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (tabId === 2) {
        mock.setRuntimeError("Another debugger is already attached to the tab with id: 2.");
        callback();
        mock.setRuntimeError(null);
        return;
      }
      if (typeof tabId === "number" && attachedTabId !== null && attachedTabId !== tabId) {
        mock.setRuntimeError(`Another debugger is already attached to the tab with id: ${tabId}.`);
        callback();
        mock.setRuntimeError(null);
        return;
      }
      attachedTabId = typeof tabId === "number" ? tabId : attachedTabId;
      callback();
    });

    detachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, callback: () => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (typeof tabId === "number" && attachedTabId === tabId) {
        attachedTabId = null;
      }
      callback();
    });

    const router = new CDPRouter();
    await router.attach(1);

    attachMock.mockClear();
    detachMock.mockClear();

    await expect(router.attach(2)).rejects.toThrow("Another debugger is already attached");

    expect(detachMock).toHaveBeenCalledWith({ tabId: 1 }, expect.any(Function));
    expect(attachMock).toHaveBeenNthCalledWith(1, { tabId: 2 }, "1.3", expect.any(Function));
    expect(attachMock).toHaveBeenNthCalledWith(2, { tabId: 1 }, "1.3", expect.any(Function));
    expect(router.getPrimaryTabId()).toBe(1);
    expect(router.getAttachedTabIds()).toEqual([1]);
  });

  it("rehydrates a replacement root when Chrome already reports the new tab as attached", async () => {
    const mock = createChromeMock({
      tabs: [
        { id: 1, url: "https://example.com/one", title: "One", groupId: 1, status: "complete", active: true },
        { id: 2, url: "https://example.com/two", title: "Two", groupId: 1, status: "complete", active: false }
      ]
    });
    globalThis.chrome = mock.chrome;

    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const detachMock = globalThis.chrome.debugger.detach as unknown as ReturnType<typeof vi.fn>;
    const getTargetsMock = globalThis.chrome.debugger.getTargets as unknown as ReturnType<typeof vi.fn>;
    let attachedTabId: number | null = null;
    const resolveDebuggeeTabId = (debuggee: chrome.debugger.Debuggee): number | null => {
      if (typeof debuggee.tabId === "number") {
        return debuggee.tabId;
      }
      if (typeof debuggee.targetId === "string" && debuggee.targetId.startsWith("target-")) {
        const parsed = Number.parseInt(debuggee.targetId.slice("target-".length), 10);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };

    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (tabId === 2) {
        attachedTabId = 2;
        mock.setRuntimeError("Another debugger is already attached to the tab with id: 2.");
        callback();
        mock.setRuntimeError(null);
        return;
      }
      attachedTabId = typeof tabId === "number" ? tabId : attachedTabId;
      callback();
    });

    detachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, callback: () => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (typeof tabId === "number" && attachedTabId === tabId) {
        attachedTabId = null;
      }
      callback();
    });

    getTargetsMock.mockImplementation((callback: (result: chrome.debugger.TargetInfo[]) => void) => {
      callback([
        {
          id: "target-1",
          tabId: 1,
          type: "page",
          title: "One",
          url: "https://example.com/one",
          attached: attachedTabId === 1
        },
        {
          id: "target-2",
          tabId: 2,
          type: "page",
          title: "Two",
          url: "https://example.com/two",
          attached: attachedTabId === 2
        }
      ] as chrome.debugger.TargetInfo[]);
    });

    const router = new CDPRouter();
    await router.attach(1);

    attachMock.mockClear();
    detachMock.mockClear();

    await expect(router.attach(2)).resolves.toBeUndefined();

    expect(detachMock).toHaveBeenCalledWith({ tabId: 1 }, expect.any(Function));
    expect(attachMock).toHaveBeenCalledTimes(1);
    expect(attachMock).toHaveBeenCalledWith({ tabId: 2 }, "1.3", expect.any(Function));
    expect(router.getPrimaryTabId()).toBe(2);
    expect(router.getAttachedTabIds()).toEqual([2]);
    expect(router.getTabDebuggee(2)).toEqual(
      expect.objectContaining({
        tabId: 2,
        targetId: "target-2"
      })
    );
  });

  it("prefers an attached page target when Chrome reports multiple page targets for the same tab during blocked root attach recovery", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 83,
        url: "https://current.example/eighty-three",
        title: "Current Eighty Three",
        groupId: 1,
        status: "complete",
        active: true
      }
    });
    globalThis.chrome = mock.chrome;

    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const getTargetsMock = globalThis.chrome.debugger.getTargets as unknown as ReturnType<typeof vi.fn>;
    const resolveDebuggeeTabId = (debuggee: chrome.debugger.Debuggee): number | null => {
      if (typeof debuggee.tabId === "number") {
        return debuggee.tabId;
      }
      if (typeof debuggee.targetId === "string" && debuggee.targetId.includes("83")) {
        return 83;
      }
      return null;
    };

    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      if (resolveDebuggeeTabId(debuggee) === 83) {
        mock.setRuntimeError("Not allowed");
        callback();
        mock.setRuntimeError(null);
        return;
      }
      callback();
    });

    getTargetsMock.mockImplementation((callback: (result: chrome.debugger.TargetInfo[]) => void) => {
      callback([
        {
          id: "target-83-stale",
          tabId: 83,
          type: "page",
          title: "Current Eighty Three",
          url: "https://current.example/eighty-three",
          attached: false
        },
        {
          id: "target-83-live",
          tabId: 83,
          type: "page",
          title: "Previous Eighty Three",
          url: "https://previous.example/eighty-three",
          attached: true
        }
      ] as chrome.debugger.TargetInfo[]);
    });

    const router = new CDPRouter();

    await expect(router.attach(83)).resolves.toBeUndefined();
    expect(router.getPrimaryTabId()).toBe(83);
    expect(router.getAttachedTabIds()).toEqual([83]);
    expect(router.getTabDebuggee(83)).toEqual(
      expect.objectContaining({
        tabId: 83,
        targetId: "target-83-live"
      })
    );
    expect(router.getLastRootAttachDiagnostic(83)).toBeNull();
  });

  it("keeps the restored root usable after a blocked replacement attach following client reset", async () => {
    const mock = createChromeMock({
      tabs: [
        { id: 1, url: "https://example.com/one", title: "One", groupId: 1, status: "complete", active: true },
        { id: 2, url: "https://example.com/two", title: "Two", groupId: 1, status: "complete", active: false }
      ],
      activeTab: { id: 1, url: "https://example.com/one", title: "One", groupId: 1, status: "complete", active: true }
    });
    globalThis.chrome = mock.chrome;

    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const detachMock = globalThis.chrome.debugger.detach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    const onResponse = vi.fn();
    let attachedTabId: number | null = null;
    const resolveDebuggeeTabId = (debuggee: chrome.debugger.Debuggee): number | null => {
      if (typeof debuggee.tabId === "number") {
        return debuggee.tabId;
      }
      if (typeof debuggee.targetId === "string" && debuggee.targetId.startsWith("target-")) {
        const parsed = Number.parseInt(debuggee.targetId.slice("target-".length), 10);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };

    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (tabId === 2) {
        mock.setRuntimeError("Not allowed");
        callback();
        mock.setRuntimeError(null);
        return;
      }
      if (typeof tabId === "number" && attachedTabId !== null && attachedTabId !== tabId) {
        mock.setRuntimeError("Not allowed");
        callback();
        mock.setRuntimeError(null);
        return;
      }
      attachedTabId = typeof tabId === "number" ? tabId : attachedTabId;
      callback();
    });

    detachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, callback: () => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (typeof tabId === "number" && attachedTabId === tabId) {
        attachedTabId = null;
      }
      callback();
    });

    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (typeof tabId === "number" && attachedTabId !== tabId) {
        mock.setRuntimeError(`Debugger is not attached to the tab with id: ${tabId}.`);
        callback(undefined);
        mock.setRuntimeError(null);
        return;
      }
      callback(
        method === "Browser.getVersion"
          ? { product: "Chrome/125.0.0.0", protocolVersion: "1.3", userAgent: "Chrome", jsVersion: "1.0" }
          : {}
      );
    });

    const router = new CDPRouter();
    router.setCallbacks({ onEvent: vi.fn(), onResponse, onDetach: vi.fn() });
    await router.attach(1);

    router.markClientClosed();
    await router.handleCommand({
      id: 920,
      method: "forwardCDPCommand",
      params: { method: "Runtime.enable", params: {} }
    });

    attachMock.mockClear();
    detachMock.mockClear();
    sendCommandMock.mockClear();
    onResponse.mockClear();

    await expect(router.attach(2)).rejects.toThrow("Not allowed");

    await router.handleCommand({
      id: 921,
      method: "forwardCDPCommand",
      params: { method: "Runtime.enable", params: {} }
    });

    expect(attachMock).toHaveBeenNthCalledWith(1, { tabId: 2 }, "1.3", expect.any(Function));
    expect(attachMock).toHaveBeenNthCalledWith(2, { tabId: 1 }, "1.3", expect.any(Function));
    expect(router.getPrimaryTabId()).toBe(1);
    expect(router.getAttachedTabIds()).toEqual([1]);
    expect(sendCommandMock).toHaveBeenCalledWith({ tabId: 1 }, "Runtime.enable", {}, expect.any(Function));
    expect(onResponse).toHaveBeenCalledWith({ id: 921, result: {} });
  });

  it("retries stale root commands through the retained root target id before forcing a root reattach", async () => {
    const mock = createChromeMock({
      tabs: [
        { id: 66, url: "https://example.com/sixty-six", title: "Sixty Six", groupId: 1, status: "complete", active: true }
      ],
      activeTab: { id: 66, url: "https://example.com/sixty-six", title: "Sixty Six", groupId: 1, status: "complete", active: true }
    });
    globalThis.chrome = mock.chrome;

    const router = new CDPRouter();
    const onResponse = vi.fn();
    router.setCallbacks({ onEvent: vi.fn(), onResponse, onDetach: vi.fn() });
    await router.attach(66);

    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    const resolveDebuggeeTabId = (debuggee: chrome.debugger.Debuggee): number | null => {
      if (typeof debuggee.tabId === "number") {
        return debuggee.tabId;
      }
      if (typeof debuggee.targetId === "string" && debuggee.targetId.startsWith("target-")) {
        const parsed = Number.parseInt(debuggee.targetId.slice("target-".length), 10);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };

    attachMock.mockClear();
    sendCommandMock.mockClear();
    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, _params: object, callback: (result?: unknown) => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      const debuggeeTargetId = (debuggee as { targetId?: string }).targetId;
      if (tabId === 66 && method === "Runtime.enable" && debuggeeTargetId !== "target-66") {
        mock.setRuntimeError("Debugger is not attached to the tab with id: 66.");
        callback(undefined);
        mock.setRuntimeError(null);
        return;
      }
      callback({});
    });

    await router.handleCommand({
      id: 922,
      method: "forwardCDPCommand",
      params: { method: "Runtime.enable", params: {} }
    });

    expect(attachMock).not.toHaveBeenCalled();
    expect(sendCommandMock).toHaveBeenNthCalledWith(1, { tabId: 66 }, "Runtime.enable", {}, expect.any(Function));
    expect(sendCommandMock).toHaveBeenNthCalledWith(2, { targetId: "target-66" }, "Runtime.enable", {}, expect.any(Function));
    expect(onResponse).toHaveBeenCalledWith({ id: 922, result: {} });
  });

  it("retries stale popup attach through the retained root target id before forcing a root reattach", async () => {
    const mock = createChromeMock({
      tabs: [
        { id: 67, url: "https://example.com/sixty-seven", title: "Sixty Seven", groupId: 1, status: "complete", active: true }
      ],
      activeTab: { id: 67, url: "https://example.com/sixty-seven", title: "Sixty Seven", groupId: 1, status: "complete", active: true }
    });
    globalThis.chrome = mock.chrome;

    const router = new CDPRouter();
    await router.attach(67);

    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    const resolveDebuggeeTabId = (debuggee: chrome.debugger.Debuggee): number | null => {
      if (typeof debuggee.tabId === "number") {
        return debuggee.tabId;
      }
      if (typeof debuggee.targetId === "string" && debuggee.targetId.startsWith("target-")) {
        const parsed = Number.parseInt(debuggee.targetId.slice("target-".length), 10);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };

    attachMock.mockClear();
    sendCommandMock.mockClear();
    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      const debuggeeTargetId = (debuggee as { targetId?: string }).targetId;
      const targetId = (params as { targetId?: string }).targetId;
      if (method === "Target.attachToTarget" && tabId === 67 && targetId === "popup-67" && debuggeeTargetId !== "target-67") {
        mock.setRuntimeError("Debugger is not attached to the tab with id: 67.");
        callback(undefined);
        mock.setRuntimeError(null);
        return;
      }
      if (method === "Target.attachToTarget" && debuggeeTargetId === "target-67" && targetId === "popup-67") {
        callback({ sessionId: "popup-session-67" });
        return;
      }
      callback({ ok: true });
    });

    await expect(router.attachChildTarget(67, "popup-67")).resolves.toBe("popup-session-67");

    expect(attachMock).not.toHaveBeenCalled();
    expect(sendCommandMock).toHaveBeenNthCalledWith(
      1,
      { tabId: 67 },
      "Target.attachToTarget",
      { targetId: "popup-67", flatten: true },
      expect.any(Function)
    );
    expect(sendCommandMock).toHaveBeenNthCalledWith(
      2,
      { targetId: "target-67" },
      "Target.attachToTarget",
      { targetId: "popup-67", flatten: true },
      expect.any(Function)
    );
    expect(router.getLastChildAttachDiagnostic(67, "popup-67")).toBeNull();
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
    expect(chrome.debugger.attach).not.toHaveBeenCalledWith({ tabId: 100 }, "1.3", expect.any(Function));
    expect(chrome.debugger.sendCommand).toHaveBeenCalledWith(
      { targetId: "target-99" },
      "Runtime.enable",
      {},
      expect.any(Function)
    );
  });

  it("keeps preserveTab command recovery pinned to the requested tab", async () => {
    const mock = createChromeMock();
    globalThis.chrome = mock.chrome;
    mock.setActiveTab({ id: 99, url: "https://stale.example", title: "Stale", groupId: 1, status: "complete" });

    const router = new CDPRouter();
    await router.attach(99);

    mock.setActiveTab({ id: 100, url: "https://fresh.example", title: "Fresh", groupId: 1, status: "complete" });

    vi.mocked(chrome.debugger.attach).mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      if (debuggee.tabId === 99) {
        mock.setRuntimeError("No tab with given id 99");
        callback();
        mock.setRuntimeError(null);
        return;
      }
      callback();
    });

    vi.mocked(chrome.debugger.sendCommand).mockImplementation(
      (debuggee: chrome.debugger.Debuggee, method: string, _params: object, callback: (result?: unknown) => void) => {
        if ((debuggee.targetId === "target-99" || debuggee.tabId === 99) && method === "Runtime.enable") {
          mock.setRuntimeError("No tab with given id 99");
          callback(undefined);
          mock.setRuntimeError(null);
          return;
        }
        callback({ ok: true });
      }
    );

    await expect(router.sendCommand({ tabId: 99 }, "Runtime.enable", {}, { preserveTab: true })).rejects.toThrow("No tab with given id 99");
    expect(chrome.debugger.attach).not.toHaveBeenCalledWith({ tabId: 100 }, "1.3", expect.any(Function));
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
    expect(chrome.debugger.attach).toHaveBeenCalledWith({ tabId: 99 }, "1.3", expect.any(Function));
    expect(router.getPrimaryTabId()).toBe(99);
    expect(router.getAttachedTabIds()).toEqual([99]);
    expect(vi.mocked(chrome.debugger.sendCommand)).toHaveBeenLastCalledWith(
      { tabId: 99 },
      "Runtime.enable",
      {},
      expect.any(Function)
    );
  });

  it("reattaches a root tab when direct commands fail with detached while handling command", async () => {
    const mock = createChromeMock({
      tabs: [
        { id: 98, url: "https://example.com/detached", title: "Detached", groupId: 1, status: "complete", active: true }
      ],
      activeTab: { id: 98, url: "https://example.com/detached", title: "Detached", groupId: 1, status: "complete", active: true }
    });
    globalThis.chrome = mock.chrome;

    const router = new CDPRouter();
    await router.attach(98);

    let detachedSendTriggered = false;
    vi.mocked(chrome.debugger.sendCommand).mockImplementation(
      (debuggee: chrome.debugger.Debuggee, method: string, _params: object, callback: (result?: unknown) => void) => {
        if (!detachedSendTriggered && (debuggee.tabId === 98 || debuggee.targetId === "target-98") && method === "Runtime.enable") {
          detachedSendTriggered = true;
          mock.setRuntimeError("Detached while handling command.");
          callback(undefined);
          mock.setRuntimeError(null);
          return;
        }
        callback({ ok: true });
      }
    );

    const result = await router.sendCommand({ tabId: 98 }, "Runtime.enable", {});

    expect(result).toEqual({ ok: true });
    expect(chrome.debugger.attach).toHaveBeenCalledWith({ tabId: 98 }, "1.3", expect.any(Function));
    expect(router.getPrimaryTabId()).toBe(98);
    expect(router.getAttachedTabIds()).toEqual([98]);
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
      { tabId: 51 },
      "Page.enable",
      {},
      expect.any(Function)
    );
    expect(chrome.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 51 },
      "Log.enable",
      {},
      expect.any(Function)
    );
    expect(chrome.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 51 },
      "Page.setLifecycleEventsEnabled",
      { enabled: true },
      expect.any(Function)
    );
    expect(chrome.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 51 },
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
        getBySessionId: (sessionId: string) => { debuggerSession?: { targetId?: string } } | null;
      };
    };
    internals.sessions.registerAttachedRootSession(52, sessionId);
    expect(internals.sessions.getBySessionId(sessionId)?.debuggerSession?.targetId).toBe("target-52");

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
    expect(chrome.debugger.detach).toHaveBeenCalledWith({ tabId: 1 }, expect.any(Function));
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
      { tabId: 2 },
      "Target.setAutoAttach",
      expect.objectContaining({ autoAttach: true, flatten: true }),
      expect.any(Function)
    );
  });

  it("refreshes the retained root debuggee before direct auto-attach reconfiguration after client reset", async () => {
    const mock = createChromeMock({
      tabs: [
        { id: 2, url: "https://fresh.example/two", title: "Two", groupId: 1, status: "complete", active: true }
      ],
      activeTab: { id: 2, url: "https://fresh.example/two", title: "Two", groupId: 1, status: "complete", active: true }
    });
    globalThis.chrome = mock.chrome;

    const router = new CDPRouter();
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

    await expect(router.configureAutoAttach({ autoAttach: true, waitForDebuggerOnStart: false, flatten: true })).resolves.toBeUndefined();

    const autoAttachCall = vi.mocked(chrome.debugger.sendCommand).mock.calls.find((call) => call[1] === "Target.setAutoAttach");
    expect(autoAttachCall?.[0]).not.toMatchObject({ targetId: "target-2" });
    expect(router.getPrimaryTabId()).toBe(2);
    expect(router.getAttachedTabIds()).toEqual([2]);
  });

  it("resyncs the kept primary root target id before reusing it for attach after client reset", async () => {
    const mock = createChromeMock({
      tabs: [
        { id: 62, url: "https://fresh.example/sixty-two", title: "Sixty Two", groupId: 1, status: "complete", active: true }
      ],
      activeTab: { id: 62, url: "https://fresh.example/sixty-two", title: "Sixty Two", groupId: 1, status: "complete", active: true }
    });
    globalThis.chrome = mock.chrome;

    const router = new CDPRouter();
    await router.attach(62);

    const originalGetTargets = vi.mocked(chrome.debugger.getTargets).getMockImplementation();
    let refreshTargetIds = false;

    vi.mocked(chrome.debugger.getTargets).mockImplementation((callback) => {
      if (refreshTargetIds) {
        callback([
          {
            id: "refreshed-target-62",
            tabId: 62,
            type: "page",
            title: "Sixty Two",
            url: "https://fresh.example/sixty-two",
            attached: false
          } as chrome.debugger.TargetInfo
        ]);
        return;
      }
      originalGetTargets?.(callback);
    });

    router.markClientClosed();
    refreshTargetIds = true;

    await expect(router.attach(62)).resolves.toBeUndefined();

    expect(router.getTabDebuggee(62)).toEqual(
      expect.objectContaining({
        tabId: 62,
        targetId: "refreshed-target-62"
      })
    );
    expect(router.getPrimaryTabId()).toBe(62);
    expect(router.getAttachedTabIds()).toEqual([62]);
  });

  it("preserves the retained root target id after client reset and reuses it for attached-root recovery", async () => {
    const mock = createChromeMock({
      tabs: [
        { id: 63, url: "https://fresh.example/sixty-three", title: "Sixty Three", groupId: 1, status: "complete", active: true }
      ],
      activeTab: { id: 63, url: "https://fresh.example/sixty-three", title: "Sixty Three", groupId: 1, status: "complete", active: true }
    });
    globalThis.chrome = mock.chrome;

    const router = new CDPRouter();
    await router.attach(63);

    const originalGetTargets = vi.mocked(chrome.debugger.getTargets).getMockImplementation();
    let suppressDebuggerTargets = false;

    vi.mocked(chrome.debugger.getTargets).mockImplementation((callback) => {
      if (suppressDebuggerTargets) {
        callback([]);
        return;
      }
      originalGetTargets?.(callback);
    });

    vi.mocked(chrome.debugger.sendCommand).mockImplementation(
      (debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
        if (method === "Target.attachToTarget") {
          const sessionId = (debuggee as { sessionId?: string }).sessionId;
          const debuggeeTargetId = (debuggee as { targetId?: string }).targetId;
          const targetId = (params as { targetId?: string }).targetId;
          if ((debuggee as { tabId?: number }).tabId === 63 && !sessionId && targetId === "popup-63") {
            mock.setRuntimeError("Not allowed");
            callback(undefined);
            mock.setRuntimeError(null);
            return;
          }
          if (((debuggee as { tabId?: number }).tabId === 63 || debuggeeTargetId === "target-63") && !sessionId && targetId === "target-63") {
            callback({ sessionId: "attached-root-session-63" });
            return;
          }
          if (sessionId === "attached-root-session-63" && targetId === "popup-63") {
            callback({ sessionId: "popup-session-63" });
            return;
          }
        }
        callback({ ok: true });
      }
    );

    router.markClientClosed();
    suppressDebuggerTargets = true;

    await expect(router.attachChildTarget(63, "popup-63")).resolves.toBe("popup-session-63");
    expect(router.getLastChildAttachDiagnostic(63, "popup-63")).toBeNull();
  });

  it("primes an attached-root session through the retained root target id after client reset when debugger target info disappears", async () => {
    const mock = createChromeMock({
      tabs: [
        { id: 73, url: "https://fresh.example/seventy-three", title: "Seventy Three", groupId: 1, status: "complete", active: true }
      ],
      activeTab: { id: 73, url: "https://fresh.example/seventy-three", title: "Seventy Three", groupId: 1, status: "complete", active: true }
    });
    globalThis.chrome = mock.chrome;

    const router = new CDPRouter();
    await router.attach(73);

    const originalGetTargets = vi.mocked(chrome.debugger.getTargets).getMockImplementation();
    let suppressDebuggerTargets = false;

    vi.mocked(chrome.debugger.getTargets).mockImplementation((callback) => {
      if (suppressDebuggerTargets) {
        callback([]);
        return;
      }
      originalGetTargets?.(callback);
    });

    vi.mocked(chrome.debugger.sendCommand).mockImplementation(
      (debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
        if (method === "Target.attachToTarget") {
          const sessionId = (debuggee as { sessionId?: string }).sessionId;
          const debuggeeTargetId = (debuggee as { targetId?: string }).targetId;
          const targetId = (params as { targetId?: string }).targetId;
          if ((debuggee as { tabId?: number }).tabId === 73 && !sessionId && targetId === "target-73") {
            callback({});
            return;
          }
          if (debuggeeTargetId === "target-73" && !sessionId && targetId === "target-73") {
            callback({ sessionId: "attached-root-session-73" });
            return;
          }
        }
        callback({ ok: true });
      }
    );

    router.markClientClosed();
    suppressDebuggerTargets = true;

    await expect(router.primeAttachedRootSession(73)).resolves.toBeUndefined();
    expect(router.getTabDebuggee(73)).toEqual(
      expect.objectContaining({
        tabId: 73,
        sessionId: "attached-root-session-73",
        targetId: "target-73"
      })
    );
  });

  it("retries attached-root priming through the root target id when the tab-scoped root attach is rejected", async () => {
    const mock = createChromeMock({
      tabs: [
        { id: 74, url: "https://fresh.example/seventy-four", title: "Seventy Four", groupId: 1, status: "complete", active: true }
      ],
      activeTab: { id: 74, url: "https://fresh.example/seventy-four", title: "Seventy Four", groupId: 1, status: "complete", active: true }
    });
    globalThis.chrome = mock.chrome;

    vi.mocked(chrome.debugger.sendCommand).mockImplementation(
      (debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
        if (method === "Target.attachToTarget") {
          const sessionId = (debuggee as { sessionId?: string }).sessionId;
          const debuggeeTargetId = (debuggee as { targetId?: string }).targetId;
          const targetId = (params as { targetId?: string }).targetId;
          if ((debuggee as { tabId?: number }).tabId === 74 && !sessionId && targetId === "target-74") {
            mock.setRuntimeError("Not allowed");
            callback(undefined);
            mock.setRuntimeError(null);
            return;
          }
          if (debuggeeTargetId === "target-74" && !sessionId && targetId === "target-74") {
            callback({ sessionId: "attached-root-session-74" });
            return;
          }
        }
        callback({ ok: true });
      }
    );

    const router = new CDPRouter();
    await router.attach(74);

    await expect(router.primeAttachedRootSession(74)).resolves.toBeUndefined();
    expect(router.getTabDebuggee(74)).toEqual(
      expect.objectContaining({
        tabId: 74,
        sessionId: "attached-root-session-74",
        targetId: "target-74"
      })
    );
    expect(vi.mocked(chrome.debugger.sendCommand)).toHaveBeenCalledWith(
      { tabId: 74 },
      "Target.attachToTarget",
      { targetId: "target-74", flatten: true },
      expect.any(Function)
    );
    expect(vi.mocked(chrome.debugger.sendCommand)).toHaveBeenCalledWith(
      { targetId: "target-74" },
      "Target.attachToTarget",
      { targetId: "target-74", flatten: true },
      expect.any(Function)
    );
  });

  it("retries direct popup attach through the retained root target id before attached-root recovery after client reset", async () => {
    const mock = createChromeMock({
      tabs: [
        { id: 64, url: "https://fresh.example/sixty-four", title: "Sixty Four", groupId: 1, status: "complete", active: true }
      ],
      activeTab: { id: 64, url: "https://fresh.example/sixty-four", title: "Sixty Four", groupId: 1, status: "complete", active: true }
    });
    globalThis.chrome = mock.chrome;

    const router = new CDPRouter();
    await router.attach(64);

    vi.mocked(chrome.debugger.sendCommand).mockImplementation(
      (debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
        if (method === "Target.attachToTarget") {
          const sessionId = (debuggee as { sessionId?: string }).sessionId;
          const debuggeeTargetId = (debuggee as { targetId?: string }).targetId;
          const targetId = (params as { targetId?: string }).targetId;
          if ((debuggee as { tabId?: number }).tabId === 64 && !sessionId && targetId === "popup-64") {
            mock.setRuntimeError("Not allowed");
            callback(undefined);
            mock.setRuntimeError(null);
            return;
          }
          if (debuggeeTargetId === "target-64" && !sessionId && targetId === "popup-64") {
            callback({ sessionId: "popup-session-64" });
            return;
          }
        }
        callback({ ok: true });
      }
    );

    router.markClientClosed();

    await expect(router.attachChildTarget(64, "popup-64")).resolves.toBe("popup-session-64");
    expect(chrome.debugger.sendCommand).toHaveBeenCalledWith(
      { targetId: "target-64" },
      "Target.attachToTarget",
      { targetId: "popup-64", flatten: true },
      expect.any(Function)
    );
    expect(router.getLastChildAttachDiagnostic(64, "popup-64")).toBeNull();
  });

  it("reattaches the root tab and retries popup attach when same-tab root recovery is blocked after client reset", async () => {
    const mock = createChromeMock({
      tabs: [
        { id: 65, url: "https://fresh.example/sixty-five", title: "Sixty Five", groupId: 1, status: "complete", active: true }
      ],
      activeTab: { id: 65, url: "https://fresh.example/sixty-five", title: "Sixty Five", groupId: 1, status: "complete", active: true }
    });
    globalThis.chrome = mock.chrome;

    let attachCount = 0;
    vi.mocked(chrome.debugger.attach).mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      if ((debuggee as { tabId?: number }).tabId === 65) {
        attachCount += 1;
      }
      callback();
    });

    const router = new CDPRouter();
    await router.attach(65);

    vi.mocked(chrome.debugger.sendCommand).mockImplementation(
      (debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
        if (method === "Target.attachToTarget") {
          const sessionId = (debuggee as { sessionId?: string }).sessionId;
          const debuggeeTargetId = (debuggee as { targetId?: string }).targetId;
          const targetId = (params as { targetId?: string }).targetId;
          if ((debuggee as { tabId?: number }).tabId === 65 && !sessionId && targetId === "popup-65") {
            if (attachCount >= 2) {
              callback({ sessionId: "popup-session-65" });
              return;
            }
            mock.setRuntimeError("Not allowed");
            callback(undefined);
            mock.setRuntimeError(null);
            return;
          }
          if (debuggeeTargetId === "target-65" && !sessionId && targetId === "popup-65") {
            mock.setRuntimeError("Not allowed");
            callback(undefined);
            mock.setRuntimeError(null);
            return;
          }
          if ((debuggee as { tabId?: number }).tabId === 65 && !sessionId && targetId === "target-65") {
            mock.setRuntimeError("Not allowed");
            callback(undefined);
            mock.setRuntimeError(null);
            return;
          }
        }
        callback({ ok: true });
      }
    );

    router.markClientClosed();

    await expect(router.attachChildTarget(65, "popup-65")).resolves.toBe("popup-session-65");
    expect(attachCount).toBeGreaterThanOrEqual(2);
    expect(chrome.debugger.detach).toHaveBeenCalledWith({ tabId: 65 }, expect.any(Function));
    expect(router.getLastChildAttachDiagnostic(65, "popup-65")).toBeNull();
  });

  it("recovers stale popup attach through an attached-root session when same-tab root attach succeeds", async () => {
    const mock = createChromeMock({
      tabs: [
        { id: 66, url: "https://fresh.example/sixty-six", title: "Sixty Six", groupId: 1, status: "complete", active: true }
      ],
      activeTab: { id: 66, url: "https://fresh.example/sixty-six", title: "Sixty Six", groupId: 1, status: "complete", active: true }
    });
    globalThis.chrome = mock.chrome;

    vi.mocked(chrome.debugger.sendCommand).mockImplementation(
      (debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
        if (method === "Target.attachToTarget") {
          const sessionId = (debuggee as { sessionId?: string }).sessionId;
          const debuggeeTargetId = (debuggee as { targetId?: string }).targetId;
          const targetId = (params as { targetId?: string }).targetId;
          if ((debuggee as { tabId?: number }).tabId === 66 && !sessionId && targetId === "popup-66") {
            mock.setRuntimeError("Debugger is not attached to the tab with id: 66.");
            callback(undefined);
            mock.setRuntimeError(null);
            return;
          }
          if (debuggeeTargetId === "target-66" && !sessionId && targetId === "popup-66") {
            mock.setRuntimeError("Debugger is not attached to the target with id: target-66.");
            callback(undefined);
            mock.setRuntimeError(null);
            return;
          }
          if ((debuggee as { tabId?: number }).tabId === 66 && !sessionId && targetId === "target-66") {
            callback({ sessionId: "attached-root-session-66" });
            return;
          }
          if (sessionId === "attached-root-session-66" && targetId === "popup-66") {
            callback({ sessionId: "popup-session-66" });
            return;
          }
        }
        callback({ ok: true });
      }
    );

    const router = new CDPRouter();
    await router.attach(66);

    await expect(router.attachChildTarget(66, "popup-66")).resolves.toBe("popup-session-66");
    expect(router.getLastChildAttachDiagnostic(66, "popup-66")).toBeNull();
  });

  it("primes an attached-root session when same-tab root attach succeeds", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 68,
        url: "https://fresh.example/sixty-eight",
        title: "Sixty Eight",
        groupId: 1
      }
    });
    globalThis.chrome = mock.chrome;

    const router = new CDPRouter();
    await router.attach(68);
    await router.primeAttachedRootSession(68);

    const internals = router as unknown as {
      sessions: {
        getAttachedRootSession: (tabId: number) => { debuggerSession?: { tabId?: number; sessionId?: string; targetId?: string } } | null;
      };
    };
    expect(internals.sessions.getAttachedRootSession(68)).toEqual(
      expect.objectContaining({
        debuggerSession: expect.objectContaining({
          tabId: 68,
          sessionId: expect.any(String),
          targetId: "target-68"
        })
      })
    );
    expect(router.getTabDebuggee(68)).toEqual(
      expect.objectContaining({
        tabId: 68,
        sessionId: expect.any(String),
        targetId: "target-68"
      })
    );
  });

  it("keeps root tracking commands on the root debuggee after priming an attached-root session", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 69,
        url: "https://fresh.example/sixty-nine",
        title: "Sixty Nine",
        groupId: 1
      }
    });
    globalThis.chrome = mock.chrome;

    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;

    const router = new CDPRouter();
    await router.attach(69);
    await router.primeAttachedRootSession(69);
    sendCommandMock.mockClear();

    await router.setDiscoverTargetsEnabled(true);
    await router.configureAutoAttach({
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true
    });

    const rootTrackingCalls = sendCommandMock.mock.calls.filter((call) => {
      const method = call[1];
      return method === "Target.setDiscoverTargets" || method === "Target.setAutoAttach";
    });

    expect(rootTrackingCalls).toEqual(
      expect.arrayContaining([
        [
          expect.objectContaining({ tabId: 69 }),
          "Target.setDiscoverTargets",
          { discover: true },
          expect.any(Function)
        ],
        [
          expect.objectContaining({ tabId: 69 }),
          "Target.setAutoAttach",
          expect.objectContaining({ autoAttach: true, flatten: true, waitForDebuggerOnStart: false }),
          expect.any(Function)
        ]
      ])
    );
    expect(rootTrackingCalls.some((call) => typeof (call[0] as { sessionId?: unknown }).sessionId === "string")).toBe(false);
  });

  it("keeps root tracking commands on the targetId-backed root after fallback targetId attach", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 74,
        url: "https://fresh.example/seventy-four",
        title: "Seventy Four",
        groupId: 1
      }
    });
    globalThis.chrome = mock.chrome;

    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    let forceFallbackRootAttach = true;
    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, _params: object, callback: (result?: unknown) => void) => {
      if (
        forceFallbackRootAttach
        && method === "Target.setAutoAttach"
        && (debuggee as { tabId?: number }).tabId === 74
      ) {
        mock.setRuntimeError("Not allowed");
        callback(undefined);
        mock.setRuntimeError(null);
        return;
      }
      callback({ ok: true });
    });

    const router = new CDPRouter();
    await router.attach(74);
    expect(router.getTabDebuggee(74)).toEqual(expect.objectContaining({
      tabId: 74,
      targetId: "target-74",
      attachBy: "targetId"
    }));

    forceFallbackRootAttach = false;
    sendCommandMock.mockClear();

    await router.setDiscoverTargetsEnabled(true);
    await router.configureAutoAttach({
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true
    });

    const rootTrackingCalls = sendCommandMock.mock.calls.filter((call) => {
      const method = call[1];
      return method === "Target.setDiscoverTargets" || method === "Target.setAutoAttach";
    });

    expect(rootTrackingCalls).toEqual(
      expect.arrayContaining([
        [
          expect.objectContaining({ targetId: "target-74" }),
          "Target.setDiscoverTargets",
          { discover: true },
          expect.any(Function)
        ],
        [
          expect.objectContaining({ targetId: "target-74" }),
          "Target.setAutoAttach",
          expect.objectContaining({ autoAttach: true, flatten: true, waitForDebuggerOnStart: false }),
          expect.any(Function)
        ]
      ])
    );
    expect(rootTrackingCalls.some((call) => (call[0] as { targetId?: unknown }).targetId !== "target-74")).toBe(false);
  });

  it("reattaches the root tab when stale popup attach has no real attached-root session to reuse", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 69,
        url: "https://fresh.example/sixty-nine",
        title: "Sixty Nine",
        groupId: 1
      }
    });
    globalThis.chrome = mock.chrome;

    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const detachMock = globalThis.chrome.debugger.detach as unknown as ReturnType<typeof vi.fn>;

    vi.mocked(chrome.debugger.sendCommand).mockImplementation(
      (debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
        if (method === "Target.attachToTarget") {
          const sessionId = (debuggee as { sessionId?: string }).sessionId;
          const debuggeeTargetId = (debuggee as { targetId?: string }).targetId;
          const targetId = (params as { targetId?: string }).targetId;
          if ((debuggee as { tabId?: number }).tabId === 69 && !sessionId && targetId === "popup-69") {
            mock.setRuntimeError("Debugger is not attached to the tab with id: 69.");
            callback(undefined);
            mock.setRuntimeError(null);
            return;
          }
          if (debuggeeTargetId === "target-69" && !sessionId && targetId === "popup-69") {
            mock.setRuntimeError("Debugger is not attached to the target with id: target-69.");
            callback(undefined);
            mock.setRuntimeError(null);
            return;
          }
          if ((debuggee as { tabId?: number }).tabId === 69 && !sessionId && targetId === "target-69") {
            mock.setRuntimeError("Not allowed");
            callback(undefined);
            mock.setRuntimeError(null);
            return;
          }
        }
        callback({ ok: true });
      }
    );

    const router = new CDPRouter();
    await router.attach(69);
    attachMock.mockClear();
    detachMock.mockClear();

    await expect(router.attachChildTarget(69, "popup-69")).rejects.toThrow(
      "Debugger is not attached to the tab with id: 69."
    );
    expect(router.getLastChildAttachDiagnostic(69, "popup-69")).toEqual(
      expect.objectContaining({
        stage: "attached_root_unavailable",
        rootTargetRetryStage: "attach_blocked",
        attachedRootRecoveryStage: "attach_failed",
        attachedRootRecoverySource: "record",
        attachedRootRecoveryReason: "Not allowed",
        reason: "Debugger is not attached to the tab with id: 69."
      })
    );
    expect(attachMock).toHaveBeenCalledWith({ tabId: 69 }, "1.3", expect.any(Function));
    expect(detachMock).toHaveBeenCalledWith({ tabId: 69 }, expect.any(Function));
  });

  it("restores the root debuggee after a blocked popup attach still ends as attached_root_unavailable", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 82,
        url: "https://fresh.example/eighty-two",
        title: "Eighty Two",
        groupId: 1,
        status: "complete",
        active: true
      }
    });
    globalThis.chrome = mock.chrome;

    const onResponse = vi.fn();

    vi.mocked(chrome.debugger.sendCommand).mockImplementation(
      (debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
        if (method === "Target.attachToTarget") {
          const sessionId = (debuggee as { sessionId?: string }).sessionId;
          const debuggeeTargetId = (debuggee as { targetId?: string }).targetId;
          const targetId = (params as { targetId?: string }).targetId;
          if ((debuggee as { tabId?: number }).tabId === 82 && !sessionId && targetId === "popup-82") {
            mock.setRuntimeError("Debugger is not attached to the tab with id: 82.");
            callback(undefined);
            mock.setRuntimeError(null);
            return;
          }
          if (debuggeeTargetId === "target-82" && !sessionId && targetId === "popup-82") {
            mock.setRuntimeError("Debugger is not attached to the target with id: target-82.");
            callback(undefined);
            mock.setRuntimeError(null);
            return;
          }
          if ((debuggee as { tabId?: number }).tabId === 82 && !sessionId && targetId === "target-82") {
            mock.setRuntimeError("Not allowed");
            callback(undefined);
            mock.setRuntimeError(null);
            return;
          }
        }
        callback({ ok: true });
      }
    );

    const router = new CDPRouter();
    router.setCallbacks({ onEvent: vi.fn(), onResponse, onDetach: vi.fn() });
    await router.attach(82);

    await expect(router.attachChildTarget(82, "popup-82")).rejects.toThrow(
      "Debugger is not attached to the tab with id: 82."
    );

    await router.handleCommand({
      id: 982,
      method: "forwardCDPCommand",
      params: { method: "Network.enable", params: {} }
    });

    expect(onResponse).toHaveBeenCalledWith({ id: 982, result: { ok: true } });
  });

  it("routes direct public helpers through reset preflight after client close", async () => {
    const mock = createChromeMock({
      tabs: [
        { id: 2, url: "https://fresh.example/two", title: "Two", groupId: 1, status: "complete", active: true }
      ],
      activeTab: { id: 2, url: "https://fresh.example/two", title: "Two", groupId: 1, status: "complete", active: true }
    });
    globalThis.chrome = mock.chrome;

    const router = new CDPRouter();
    router.setCallbacks({ onEvent: vi.fn(), onResponse: vi.fn(), onDetach: vi.fn() });
    await router.attach(2);

    type RouterWithPrepare = CDPRouter & {
      prepareForNextClientIfNeeded: (preferredTabId?: number | null) => Promise<void>;
    };

    const routerWithPrepare = router as unknown as RouterWithPrepare;
    const originalPrepare = routerWithPrepare.prepareForNextClientIfNeeded.bind(router);
    const prepareForNextClientIfNeeded = vi.fn(async (preferredTabId?: number | null) => {
      await originalPrepare(preferredTabId);
    });
    routerWithPrepare.prepareForNextClientIfNeeded = prepareForNextClientIfNeeded;

    const directCalls: Array<{
      label: string;
      invoke: () => Promise<unknown>;
      assertResult?: (result: unknown) => void;
      expectedPrepareArgs?: Array<number | null | undefined>;
    }> = [
      {
        label: "attach",
        invoke: async () => {
          await router.attach(2);
          return null;
        },
        expectedPrepareArgs: [2]
      },
      {
        label: "refreshTabAttachment",
        invoke: async () => {
          await router.refreshTabAttachment(2);
          return null;
        },
        expectedPrepareArgs: [2]
      },
      {
        label: "setDiscoverTargetsEnabled",
        invoke: async () => {
          await router.setDiscoverTargetsEnabled(true);
          return null;
        }
      },
      {
        label: "configureAutoAttach",
        invoke: async () => {
          await router.configureAutoAttach({ autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
          return null;
        }
      },
      {
        label: "resolveTabTargetId",
        invoke: async () => await router.resolveTabTargetId(2),
        assertResult: (result) => {
          expect(result).toBe("target-2");
        },
        expectedPrepareArgs: [2]
      },
      {
        label: "resolveTabOpenerTargetId",
        invoke: async () => await router.resolveTabOpenerTargetId(2),
        assertResult: (result) => {
          expect(result).toBeNull();
        },
        expectedPrepareArgs: []
      },
      {
        label: "attachChildTarget",
        invoke: async () => await router.attachChildTarget(2, "popup-2"),
        assertResult: (result) => {
          expect(result).toEqual(expect.any(String));
        },
        expectedPrepareArgs: [2]
      },
      {
        label: "sendCommand",
        invoke: async () => await router.sendCommand({ tabId: 2 }, "Runtime.enable", {}),
        assertResult: (result) => {
          expect(result).toEqual({ ok: true });
        },
        expectedPrepareArgs: [2]
      }
    ];

    for (const directCall of directCalls) {
      prepareForNextClientIfNeeded.mockClear();
      router.markClientClosed();

      const result = await directCall.invoke();

      expect(prepareForNextClientIfNeeded.mock.calls.length, directCall.label).toBeGreaterThan(0);
      if (directCall.expectedPrepareArgs) {
        expect(prepareForNextClientIfNeeded.mock.calls.at(-1), directCall.label).toEqual(directCall.expectedPrepareArgs);
      }
      directCall.assertResult?.(result);
      expect(router.getPrimaryTabId()).toBe(2);
      expect(router.getAttachedTabIds()).toEqual([2]);
    }
  });

  it("reattaches the preserved same-tab root after client reset before reusing it", async () => {
    const mock = createChromeMock({
      tabs: [
        { id: 72, url: "https://fresh.example/seventy-two", title: "Seventy Two", groupId: 1, status: "complete", active: true }
      ],
      activeTab: { id: 72, url: "https://fresh.example/seventy-two", title: "Seventy Two", groupId: 1, status: "complete", active: true }
    });
    globalThis.chrome = mock.chrome;

    const router = new CDPRouter();
    await router.attach(72);

    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const detachMock = globalThis.chrome.debugger.detach as unknown as ReturnType<typeof vi.fn>;
    attachMock.mockClear();
    detachMock.mockClear();

    router.markClientClosed();
    await router.attach(72);

    expect(detachMock).toHaveBeenCalledTimes(1);
    expect(detachMock).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 72 }),
      expect.any(Function)
    );
    expect(attachMock).toHaveBeenCalledTimes(1);
    expect(attachMock).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 72 }),
      "1.3",
      expect.any(Function)
    );
    expect(router.getPrimaryTabId()).toBe(72);
    expect(router.getAttachedTabIds()).toEqual([72]);
  });

  it("reuses the reset-prepared same-tab root during refresh without a second attach", async () => {
    const mock = createChromeMock({
      tabs: [
        { id: 73, url: "https://fresh.example/seventy-three", title: "Seventy Three", groupId: 1, status: "complete", active: true }
      ],
      activeTab: { id: 73, url: "https://fresh.example/seventy-three", title: "Seventy Three", groupId: 1, status: "complete", active: true }
    });
    globalThis.chrome = mock.chrome;

    const router = new CDPRouter();
    await router.attach(73);

    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const detachMock = globalThis.chrome.debugger.detach as unknown as ReturnType<typeof vi.fn>;
    attachMock.mockClear();
    detachMock.mockClear();

    let postResetAttachCount = 0;
    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      if ((debuggee as { tabId?: number }).tabId === 73) {
        postResetAttachCount += 1;
        if (postResetAttachCount > 1) {
          mock.setRuntimeError("Not allowed");
          callback();
          mock.setRuntimeError(null);
          return;
        }
      }
      callback();
    });

    router.markClientClosed();
    await expect(router.refreshTabAttachment(73)).resolves.toBeUndefined();

    expect(postResetAttachCount).toBe(1);
    expect(detachMock).toHaveBeenCalledTimes(1);
    expect(attachMock).toHaveBeenCalledTimes(1);
    expect(router.getPrimaryTabId()).toBe(73);
    expect(router.getAttachedTabIds()).toEqual([73]);
  });

  it("refreshes a stale attached-root command debuggee after client reset before dispatch", async () => {
    const mock = createChromeMock({
      tabs: [
        { id: 2, url: "https://fresh.example/two", title: "Two", groupId: 1, status: "complete", active: false },
        { id: 3, url: "https://chatgpt.com/", title: "ChatGPT", groupId: 1, status: "complete", active: true }
      ],
      activeTab: { id: 3, url: "https://chatgpt.com/", title: "ChatGPT", groupId: 1, status: "complete", active: true }
    });
    globalThis.chrome = mock.chrome;

    const router = new CDPRouter();
    await router.attach(2);
    await router.primeAttachedRootSession(2);

    const attachedRootDebuggee = router.getTabDebuggee(2);
    expect(attachedRootDebuggee).toEqual(expect.objectContaining({
      tabId: 2,
      sessionId: expect.any(String),
      targetId: "target-2"
    }));

    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    sendCommandMock.mockImplementation(
      (debuggee: chrome.debugger.Debuggee, method: string, _params: object, callback: (result?: unknown) => void) => {
        if (
          method === "Runtime.enable"
          && (debuggee as { sessionId?: string }).sessionId === (attachedRootDebuggee as { sessionId?: string }).sessionId
        ) {
          mock.setRuntimeError("Debugger is not attached to the target with id: target-2.");
          callback(undefined);
          mock.setRuntimeError(null);
          return;
        }
        callback({ ok: true });
      }
    );

    router.markClientClosed();

    await expect(router.sendCommand(attachedRootDebuggee as chrome.debugger.Debuggee, "Runtime.enable", {}))
      .resolves
      .toEqual({ ok: true });
    expect(router.getPrimaryTabId()).toBe(2);
    expect(router.getAttachedTabIds()).toEqual([2]);
    expect(sendCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 2 }),
      "Runtime.enable",
      {},
      expect.any(Function)
    );
  });

  it("keeps the refreshed root attached when the old root detach arrives late", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 66,
        url: "https://example.com/refresh-race",
        title: "Refresh Race",
        groupId: 1,
        status: "complete",
        active: true
      }
    });
    globalThis.chrome = mock.chrome;

    const onDetach = vi.fn();
    const router = new CDPRouter();
    router.setCallbacks({ onEvent: vi.fn(), onResponse: vi.fn(), onDetach });
    await router.attach(66);

    await router.refreshTabAttachment(66);
    mock.emitDebuggerDetach({ tabId: 66 }, "target_closed");

    expect(router.isTabAttached(66)).toBe(true);
    expect(router.getAttachedTabIds()).toEqual([66]);
    expect(onDetach).not.toHaveBeenCalled();
    await expect(router.attachChildTarget(66, "popup-66")).resolves.toEqual(expect.any(String));
  });

  it("keeps the restored root attached when a failed root switch delivers the old detach late", async () => {
    const mock = createChromeMock({
      tabs: [
        {
          id: 70,
          url: "https://example.com/root-restore",
          title: "Root Restore",
          groupId: 1,
          status: "complete",
          active: true
        },
        {
          id: 71,
          url: "https://example.com/popup-restore",
          title: "Popup Restore",
          groupId: 1,
          status: "complete",
          active: false
        }
      ],
      activeTab: {
        id: 70,
        url: "https://example.com/root-restore",
        title: "Root Restore",
        groupId: 1,
        status: "complete",
        active: true
      }
    });
    globalThis.chrome = mock.chrome;

    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      if ((debuggee as { tabId?: number }).tabId === 71) {
        mock.setRuntimeError("Not allowed");
        callback();
        mock.setRuntimeError(null);
        return;
      }
      callback();
    });

    const router = new CDPRouter();
    await router.attach(70);

    await expect(router.attach(71)).rejects.toThrow("Not allowed");
    expect(router.getAttachedTabIds()).toEqual([70]);

    mock.emitDebuggerDetach({ tabId: 70 }, "target_closed");

    expect(router.isTabAttached(70)).toBe(true);
    expect(router.getAttachedTabIds()).toEqual([70]);
  });

  it("retries root attach by targetId when the flat-session probe is blocked after tab attach", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 72,
        url: "https://example.com/target-attach",
        title: "Target Attach",
        groupId: 1,
        status: "complete",
        active: true
      }
    });
    globalThis.chrome = mock.chrome;

    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;

    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, _params: object, callback: (result?: unknown) => void) => {
      if (method === "Target.setAutoAttach" && (debuggee as { tabId?: number }).tabId === 72) {
        mock.setRuntimeError("Not allowed");
        callback(undefined);
        mock.setRuntimeError(null);
        return;
      }
      callback({ ok: true });
    });

    const router = new CDPRouter();
    await router.attach(72);

    expect(attachMock).toHaveBeenNthCalledWith(1, { tabId: 72 }, "1.3", expect.any(Function));
    expect(attachMock).toHaveBeenNthCalledWith(2, { targetId: "target-72" }, "1.3", expect.any(Function));
    expect(router.isTabAttached(72)).toBe(true);
    expect(router.getAttachedTabIds()).toEqual([72]);
  });

  it("keeps a restored targetId-attached root when a failed switch delivers the old detach late", async () => {
    const mock = createChromeMock({
      tabs: [
        {
          id: 80,
          url: "https://example.com/target-root",
          title: "Target Root",
          groupId: 1,
          status: "complete",
          active: true
        },
        {
          id: 81,
          url: "https://example.com/blocked-root",
          title: "Blocked Root",
          groupId: 1,
          status: "complete",
          active: false
        }
      ],
      activeTab: {
        id: 80,
        url: "https://example.com/target-root",
        title: "Target Root",
        groupId: 1,
        status: "complete",
        active: true
      }
    });
    globalThis.chrome = mock.chrome;

    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;

    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      const targetId = (debuggee as { targetId?: string }).targetId;
      if ((debuggee as { tabId?: number }).tabId === 81 || targetId === "target-81") {
        mock.setRuntimeError("Not allowed");
        callback();
        mock.setRuntimeError(null);
        return;
      }
      callback();
    });

    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, _params: object, callback: (result?: unknown) => void) => {
      if (method === "Target.setAutoAttach" && (debuggee as { tabId?: number }).tabId === 80) {
        mock.setRuntimeError("Not allowed");
        callback(undefined);
        mock.setRuntimeError(null);
        return;
      }
      callback({ ok: true });
    });

    const router = new CDPRouter();
    await router.attach(80);

    await expect(router.attach(81)).rejects.toThrow("Not allowed");
    expect(router.getAttachedTabIds()).toEqual([80]);

    mock.emitDebuggerDetach({ targetId: "target-80" }, "target_closed");

    expect(router.isTabAttached(80)).toBe(true);
    expect(router.getAttachedTabIds()).toEqual([80]);
  });

  it("tries a tab-scoped root reattach for popup recovery before falling back to targetId attach", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 83,
        url: "https://example.com/popup-recover",
        title: "Popup Recover",
        groupId: 1,
        status: "complete",
        active: true
      }
    });
    globalThis.chrome = mock.chrome;

    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;

    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
      const sessionId = (debuggee as { sessionId?: string }).sessionId;
      const debuggeeTargetId = (debuggee as { targetId?: string }).targetId;
      const targetId = (params as { targetId?: string }).targetId;
      if (method === "Target.setAutoAttach" && (debuggee as { tabId?: number }).tabId === 83) {
        mock.setRuntimeError("Not allowed");
        callback(undefined);
        mock.setRuntimeError(null);
        return;
      }
      if (method === "Target.attachToTarget") {
        if (debuggeeTargetId === "target-83" && !sessionId && targetId === "popup-83") {
          mock.setRuntimeError("Not allowed");
          callback(undefined);
          mock.setRuntimeError(null);
          return;
        }
        if ((debuggee as { tabId?: number }).tabId === 83 && !sessionId && targetId === "popup-83") {
          callback({ sessionId: "popup-session-83" });
          return;
        }
      }
      callback({ ok: true });
    });

    const router = new CDPRouter();
    await router.attach(83);
    attachMock.mockClear();

    await expect(router.attachChildTarget(83, "popup-83")).resolves.toBe("popup-session-83");

    expect(attachMock).toHaveBeenCalledWith({ tabId: 83 }, "1.3", expect.any(Function));
    expect(sendCommandMock).toHaveBeenCalledWith(
      { targetId: "target-83" },
      "Target.attachToTarget",
      { targetId: "popup-83", flatten: true },
      expect.any(Function)
    );
    expect(sendCommandMock).toHaveBeenCalledWith(
      { tabId: 83 },
      "Target.attachToTarget",
      { targetId: "popup-83", flatten: true },
      expect.any(Function)
    );
  });

  it("records the raw post-refresh probe result when a refreshed root still rejects Target.getTargets", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 67,
        url: "https://example.com/refresh-probe",
        title: "Refresh Probe",
        groupId: 1,
        status: "complete",
        active: true
      }
    });
    globalThis.chrome = mock.chrome;

    const router = new CDPRouter();
    await router.attach(67);

    vi.mocked(chrome.debugger.sendCommand).mockImplementation(
      (debuggee: chrome.debugger.Debuggee, method: string, _params: object, callback: (result?: unknown) => void) => {
        if (method === "Target.getTargets" && (debuggee as { tabId?: number }).tabId === 67) {
          mock.setRuntimeError("Debugger is not attached to the tab with id: 67.");
          callback(undefined);
          mock.setRuntimeError(null);
          return;
        }
        callback({ ok: true });
      }
    );

    await router.refreshTabAttachment(67);

    expect(router.getLastRootRefreshDiagnostic(67)).toEqual(expect.objectContaining({
      tabId: 67,
      path: "reattach_root_debuggee",
      refreshCompleted: true,
      debuggeePresentAfterRefresh: true,
      rootSessionPresentAfterRefresh: true,
      rootTargetIdAfterRefresh: "target-67",
      probeMethod: "Target.getTargets",
      probeStage: "failed",
      probeReason: "Debugger is not attached to the tab with id: 67."
    }));
  });

  it("records attached_root_unavailable when blocked popup attach cannot recover through an attached root session", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 61,
        url: "https://example.com/router-stage-unavailable",
        title: "Router Stage Unavailable",
        groupId: 1
      }
    });
    globalThis.chrome = mock.chrome;

    vi.mocked(chrome.debugger.sendCommand).mockImplementation(
      (debuggee: chrome.debugger.Debuggee, method: string, _params: object, callback: (result?: unknown) => void) => {
        if (method === "Page.getFrameTree") {
          callback({
            frameTree: {
              frame: {
                id: "frame-61",
                url: "https://example.com/router-stage-unavailable"
              }
            }
          });
          return;
        }
        if (method === "Target.attachToTarget" && (debuggee as { tabId?: number }).tabId === 61) {
          mock.setRuntimeError("Not allowed");
          callback(undefined);
          mock.setRuntimeError(null);
          return;
        }
        callback({ ok: true });
      }
    );

    const router = new CDPRouter();
    await router.attach(61);

    await expect(router.attachChildTarget(61, "popup-61")).rejects.toThrow("Not allowed");
    expect(router.getLastChildAttachDiagnostic(61, "popup-61")).toEqual(expect.objectContaining({
      stage: "attached_root_unavailable",
      initialStage: "raw_attach_blocked",
      rootTargetRetryStage: "attach_null",
      attachedRootRecoveryStage: "attach_failed",
      attachedRootRecoverySource: "record",
      attachedRootRecoveryAttachTargetId: "target-61",
      attachedRootRecoveryRetriedAfterRegisterRoot: true,
      attachedRootRecoveryRegisterRootChanged: false,
      attachedRootRecoveryRegisterRootAttachTargetChanged: false,
      attachedRootRecoveryRegisterAttachedRootSessionCalled: false,
      attachedRootUnavailableTerminalBranch: "root_debuggee_reattach",
      reattachRecoveryStage: "root_debuggee_attach_blocked",
      reattachRecoveryReason: "Not allowed",
      attachedRootRecoveryReason: "Not allowed",
      reason: "Not allowed"
    }));
  });

  it("records attached_root_unavailable when the raw attach returns no child session id and no real attached-root session exists", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 62,
        url: "https://example.com/router-stage-null",
        title: "Router Stage Null",
        groupId: 1
      }
    });
    globalThis.chrome = mock.chrome;

    vi.mocked(chrome.debugger.sendCommand).mockImplementation(
      (debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
        if (method === "Page.getFrameTree") {
          callback({
            frameTree: {
              frame: {
                id: "frame-62",
                url: "https://example.com/router-stage-null"
              }
            }
          });
          return;
        }
        if (method === "Target.attachToTarget") {
          const sessionId = (debuggee as { sessionId?: string }).sessionId;
          const debuggeeTargetId = (debuggee as { targetId?: string }).targetId;
          const targetId = (params as { targetId?: string }).targetId;
          if (debuggeeTargetId === "target-62" && !sessionId && targetId === "popup-62") {
            callback({});
            return;
          }
        }
        callback({ ok: true });
      }
    );

    const router = new CDPRouter();
    await router.attach(62);

    await expect(router.attachChildTarget(62, "popup-62")).resolves.toBeNull();
    expect(router.getLastChildAttachDiagnostic(62, "popup-62")).toEqual(expect.objectContaining({
      stage: "attached_root_unavailable",
      initialStage: "raw_attach_null",
      rootTargetRetryStage: "attach_null",
      attachedRootRecoveryStage: "attach_null",
      attachedRootRecoverySource: "record",
      attachedRootRecoveryAttachTargetId: "target-62",
      attachedRootRecoveryRetriedAfterRegisterRoot: true,
      attachedRootRecoveryRegisterRootChanged: false,
      attachedRootRecoveryRegisterRootAttachTargetChanged: false,
      attachedRootRecoveryRegisterAttachedRootSessionCalled: false,
      attachedRootUnavailableTerminalBranch: "root_debuggee_reattach",
      reattachRecoveryStage: "root_debuggee_attach_null"
    }));
  });

  it("resolves popup opener ids from raw debugger targets after client reset", async () => {
    const mock = createChromeMock({
      tabs: [
        { id: 59, url: "https://example.com/root-alias", title: "Root Alias", groupId: 1, status: "complete", active: true },
        { id: 60, url: "https://popup.example.com/final", title: "Popup Final", groupId: 1, status: "complete", active: false }
      ],
      activeTab: { id: 59, url: "https://example.com/root-alias", title: "Root Alias", groupId: 1, status: "complete", active: true }
    });
    globalThis.chrome = mock.chrome;

    vi.mocked(chrome.debugger.getTargets).mockImplementation((callback) => {
      callback([
        {
          id: "root-target-59",
          tabId: 59,
          type: "page",
          title: "Root Alias",
          url: "https://example.com/root-alias",
          attached: false
        } as chrome.debugger.TargetInfo,
        {
          id: "popup-target-60",
          tabId: 60,
          type: "page",
          title: "Popup Final",
          url: "https://popup.example.com/final",
          attached: false
        } as chrome.debugger.TargetInfo,
        {
          id: "popup-target-60-initial",
          tabId: 60,
          type: "page",
          title: "about:blank",
          url: "about:blank",
          openerId: "tab-59",
          attached: false
        } as chrome.debugger.TargetInfo
      ]);
    });

    const router = new CDPRouter();
    router.setCallbacks({ onEvent: vi.fn(), onResponse: vi.fn(), onDetach: vi.fn() });
    await router.attach(59);

    router.markClientClosed();

    await expect(router.resolveTabOpenerTargetId(60)).resolves.toBe("tab-59");
    expect(router.getPrimaryTabId()).toBe(59);
    expect(router.getAttachedTabIds()).toEqual([59]);
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
    expect(chrome.debugger.attach).toHaveBeenCalledWith({ tabId: 1 }, "1.3", expect.any(Function));
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

  it("forwards popup target creation when the debugger source carries only the root session id", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 56,
        url: "https://example.com/popup-root",
        title: "Popup Root",
        groupId: 1
      }
    });
    globalThis.chrome = mock.chrome;

    const router = new CDPRouter();
    const routedEvents: Array<{ tabId: number; method: string; params?: unknown; sessionId?: string }> = [];
    router.setCallbacks({ onEvent: vi.fn(), onResponse: vi.fn(), onDetach: vi.fn() });
    router.addEventListener((event) => {
      routedEvents.push(event);
    });
    await router.attach(56);

    await router.handleCommand({
      id: 914,
      method: "forwardCDPCommand",
      params: {
        method: "Target.setAutoAttach",
        params: { autoAttach: true, flatten: true }
      }
    });

    const rootAttachedEvent = routedEvents.find((event) => event.method === "Target.attachedToTarget");
    const rootSessionId = (rootAttachedEvent?.params as { sessionId?: string } | undefined)?.sessionId;
    expect(rootSessionId).toEqual(expect.any(String));

    routedEvents.length = 0;
    mock.emitDebuggerEvent({ sessionId: rootSessionId }, "Target.targetCreated", {
      targetInfo: {
        targetId: "popup-56",
        type: "page",
        url: "https://popup.example.com/flow",
        title: "Popup Flow",
        openerId: "tab-56"
      }
    });

    expect(routedEvents).toEqual([
      expect.objectContaining({
        tabId: 56,
        method: "Target.targetCreated",
        params: expect.objectContaining({
          targetInfo: expect.objectContaining({
            targetId: "popup-56",
            url: "https://popup.example.com/flow"
          })
        })
      })
    ]);
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

  it("routes popup creation and attach when the debugger source carries only the child target id", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 58,
        url: "https://example.com/popup-child-source",
        title: "Popup Child Source",
        groupId: 1
      }
    });
    globalThis.chrome = mock.chrome;

    const router = new CDPRouter();
    const routedEvents: Array<{ tabId: number; method: string; params?: unknown; sessionId?: string }> = [];
    router.setCallbacks({ onEvent: vi.fn(), onResponse: vi.fn(), onDetach: vi.fn() });
    router.addEventListener((event) => {
      routedEvents.push(event);
    });
    await router.attach(58);

    await router.handleCommand({
      id: 9141,
      method: "forwardCDPCommand",
      params: {
        method: "Target.setAutoAttach",
        params: { autoAttach: true, flatten: true }
      }
    });

    routedEvents.length = 0;
    mock.emitDebuggerEvent({ targetId: "popup-58" }, "Target.targetCreated", {
      targetInfo: {
        targetId: "popup-58",
        type: "page",
        url: "https://popup.example.com/child-source",
        title: "Popup Child Source",
        openerId: "tab-58"
      }
    });
    mock.emitDebuggerEvent({ targetId: "popup-58" }, "Target.attachedToTarget", {
      sessionId: "popup-session-58",
      targetInfo: {
        targetId: "popup-58",
        type: "page",
        url: "https://popup.example.com/child-source",
        title: "Popup Child Source",
        openerId: "tab-58"
      },
      waitingForDebugger: false
    });

    expect(routedEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        tabId: 58,
        method: "Target.targetCreated",
        params: expect.objectContaining({
          targetInfo: expect.objectContaining({
            targetId: "popup-58",
            openerId: "tab-58"
          })
        })
      }),
      expect.objectContaining({
        tabId: 58,
        method: "Target.attachedToTarget",
        params: expect.objectContaining({
          sessionId: "popup-session-58",
          targetInfo: expect.objectContaining({
            targetId: "popup-58",
            openerId: "tab-58"
          })
        })
      })
    ]));
  });

  it("resolves source tab ids from attached root session ids and popup target ids", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 58,
        url: "https://example.com/popup-child-source",
        title: "Popup Child Source",
        groupId: 1
      }
    });
    globalThis.chrome = mock.chrome;

    const router = new CDPRouter();
    const routedEvents: Array<{ tabId: number; method: string; params?: unknown; sessionId?: string }> = [];
    router.setCallbacks({ onEvent: vi.fn(), onResponse: vi.fn(), onDetach: vi.fn() });
    router.addEventListener((event) => {
      routedEvents.push(event);
    });
    await router.attach(58);

    await router.handleCommand({
      id: 91415,
      method: "forwardCDPCommand",
      params: {
        method: "Target.setAutoAttach",
        params: { autoAttach: true, flatten: true }
      }
    });

    const rootAttachedEvent = routedEvents.find((event) => event.method === "Target.attachedToTarget");
    const rootSessionId = (rootAttachedEvent?.params as { sessionId?: string } | undefined)?.sessionId;
    expect(rootSessionId).toEqual(expect.any(String));
    expect(router.resolveSourceTabId({ sessionId: rootSessionId! })).toBe(58);

    mock.emitDebuggerEvent({ targetId: "popup-58" }, "Target.targetCreated", {
      targetInfo: {
        targetId: "popup-58",
        type: "page",
        url: "https://popup.example.com/child-source",
        title: "Popup Child Source",
        openerId: "tab-58"
      }
    });
    mock.emitDebuggerEvent({ targetId: "popup-58" }, "Target.attachedToTarget", {
      sessionId: "popup-session-58",
      targetInfo: {
        targetId: "popup-58",
        type: "page",
        url: "https://popup.example.com/child-source",
        title: "Popup Child Source",
        openerId: "tab-58"
      },
      waitingForDebugger: false
    });

    expect(router.resolveSourceTabId({ targetId: "popup-58" })).toBe(58);
  });

  it("routes popup creation and attach when openerId uses the stale root target alias", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 59,
        url: "https://example.com/root-alias",
        title: "Root Alias",
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
                id: "frame-59",
                url: "https://example.com/root-alias"
              }
            }
          });
          return;
        }
        if (method === "Target.attachToTarget") {
          callback({ sessionId: "root-session-59" });
          return;
        }
        callback({ ok: true });
      }
    );

    const router = new CDPRouter();
    const routedEvents: Array<{ tabId: number; method: string; params?: unknown; sessionId?: string }> = [];
    router.setCallbacks({ onEvent: vi.fn(), onResponse: vi.fn(), onDetach: vi.fn() });
    router.addEventListener((event) => {
      routedEvents.push(event);
    });
    await router.attach(59);

    await router.handleCommand({
      id: 9142,
      method: "forwardCDPCommand",
      params: {
        method: "Target.setAutoAttach",
        params: { autoAttach: true, flatten: true }
      }
    });

    routedEvents.length = 0;
    mock.emitDebuggerEvent({ targetId: "popup-59" }, "Target.targetCreated", {
      targetInfo: {
        targetId: "popup-59",
        type: "page",
        url: "https://popup.example.com/stale-alias",
        title: "Popup Stale Alias",
        openerId: "tab-59"
      }
    });
    mock.emitDebuggerEvent({ targetId: "popup-59" }, "Target.attachedToTarget", {
      sessionId: "popup-session-59",
      targetInfo: {
        targetId: "popup-59",
        type: "page",
        url: "https://popup.example.com/stale-alias",
        title: "Popup Stale Alias",
        openerId: "tab-59"
      },
      waitingForDebugger: false
    });

    expect(routedEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        tabId: 59,
        method: "Target.targetCreated",
        params: expect.objectContaining({
          targetInfo: expect.objectContaining({
            targetId: "popup-59",
            openerId: "tab-59"
          })
        })
      }),
      expect.objectContaining({
        tabId: 59,
        method: "Target.attachedToTarget",
        params: expect.objectContaining({
          sessionId: "popup-session-59",
          targetInfo: expect.objectContaining({
            targetId: "popup-59",
            openerId: "tab-59"
          })
        })
      })
    ]));
  });

  it("forwards popup teardown when the debugger source carries only the child target id", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 57,
        url: "https://example.com/popup-child",
        title: "Popup Child",
        groupId: 1
      }
    });
    globalThis.chrome = mock.chrome;

    const router = new CDPRouter();
    const routedEvents: Array<{ tabId: number; method: string; params?: unknown; sessionId?: string }> = [];
    router.setCallbacks({ onEvent: vi.fn(), onResponse: vi.fn(), onDetach: vi.fn() });
    router.addEventListener((event) => {
      routedEvents.push(event);
    });
    await router.attach(57);

    await router.handleCommand({
      id: 915,
      method: "forwardCDPCommand",
      params: {
        method: "Target.setAutoAttach",
        params: { autoAttach: true, flatten: true }
      }
    });

    const rootAttachedEvent = routedEvents.find((event) => event.method === "Target.attachedToTarget");
    const rootSessionId = (rootAttachedEvent?.params as { sessionId?: string } | undefined)?.sessionId;
    expect(rootSessionId).toEqual(expect.any(String));

    mock.emitDebuggerEvent({ sessionId: rootSessionId }, "Target.attachedToTarget", {
      sessionId: "popup-session-57",
      targetInfo: {
        targetId: "popup-57",
        type: "page",
        url: "https://popup.example.com/child",
        title: "Popup Child Session",
        openerId: "tab-57"
      },
      waitingForDebugger: false
    });

    routedEvents.length = 0;
    mock.emitDebuggerEvent({ targetId: "popup-57" }, "Target.targetDestroyed", {
      targetId: "popup-57"
    });

    expect(routedEvents).toEqual([
      expect.objectContaining({
        tabId: 57,
        method: "Target.targetDestroyed",
        params: expect.objectContaining({
          targetId: "popup-57"
        })
      })
    ]);
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
      expect.objectContaining({ tabId: 1 }),
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
      expect.objectContaining({ tabId: 1 }),
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

    await vi.waitFor(() => {
      expect(chrome.debugger.sendCommand).toHaveBeenCalledWith(
        { tabId: 1, sessionId: "child-session-1" },
        "Target.setAutoAttach",
        expect.objectContaining({ autoAttach: true, flatten: true }),
        expect.any(Function)
      );
    });
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
