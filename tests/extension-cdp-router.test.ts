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

    await router.detach();
    expect(chrome.debugger.detach).toHaveBeenCalled();
  });

  it("routes commands and events", async () => {
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
      params: { method: "Runtime.enable", params: {} }
    });
    expect(onResponse).toHaveBeenCalledWith({ id: 1, result: { ok: true } });

    mock.emitDebuggerEvent({ tabId: 7 }, "Runtime.consoleAPICalled", { type: "log" });
    expect(onEvent).toHaveBeenCalledWith({
      method: "forwardCDPEvent",
      params: { method: "Runtime.consoleAPICalled", params: { type: "log" } }
    });

    mock.emitDebuggerDetach({ tabId: 7 });
    expect(onDetach).toHaveBeenCalledTimes(1);
  });
});
