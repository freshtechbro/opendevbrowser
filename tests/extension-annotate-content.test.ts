// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type RuntimeMessageListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void
) => boolean;

const sendRuntimeMessage = async (message: unknown): Promise<unknown> => {
  return await new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => resolve(response));
  });
};

describe("annotate content bootstrap", () => {
  const originalChrome = globalThis.chrome;
  const originalBridge = (window as Window & { __odbAnnotate?: unknown }).__odbAnnotate;
  const originalListener = (window as Window & { __odbAnnotateMessageListener?: unknown }).__odbAnnotateMessageListener;

  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = "";
    document.documentElement.innerHTML = "<head></head><body></body>";
  });

  afterEach(() => {
    globalThis.chrome = originalChrome;
    if (originalBridge === undefined) {
      delete (window as Window & { __odbAnnotate?: unknown }).__odbAnnotate;
    } else {
      (window as Window & { __odbAnnotate?: unknown }).__odbAnnotate = originalBridge;
    }
    if (originalListener === undefined) {
      delete (window as Window & { __odbAnnotateMessageListener?: unknown }).__odbAnnotateMessageListener;
    } else {
      (window as Window & { __odbAnnotateMessageListener?: unknown }).__odbAnnotateMessageListener = originalListener;
    }
    vi.restoreAllMocks();
  });

  it("refreshes a stale annotation bridge so the tab can respond without reloading", async () => {
    const runtimeListeners = new Set<RuntimeMessageListener>();
    globalThis.chrome = {
      runtime: {
        lastError: null,
        onMessage: {
          addListener: vi.fn((listener: RuntimeMessageListener) => {
            runtimeListeners.add(listener);
          }),
          removeListener: vi.fn((listener: RuntimeMessageListener) => {
            runtimeListeners.delete(listener);
          })
        },
        sendMessage: vi.fn((message: unknown, callback?: (response: unknown) => void) => {
          let responded = false;
          for (const listener of runtimeListeners) {
            listener(message, {}, (response) => {
              responded = true;
              callback?.(response);
            });
          }
          if (!responded) {
            callback?.(undefined);
          }
        })
      }
    } as unknown as typeof chrome;

    const staleBridge = {
      active: false,
      toggle: vi.fn(),
      start: vi.fn(),
      cancel: vi.fn()
    };
    (window as Window & { __odbAnnotate?: unknown }).__odbAnnotate = staleBridge;

    await import("../extension/src/annotate-content");

    expect((window as Window & { __odbAnnotate?: unknown }).__odbAnnotate).not.toBe(staleBridge);
    const ping = await sendRuntimeMessage({ type: "annotation:ping" });
    expect(ping).toMatchObject({ ok: true, bootId: expect.any(String), active: false });

    const toggled = await sendRuntimeMessage({ type: "annotation:toggle" });
    expect(toggled).toMatchObject({ ok: true, bootId: (ping as { bootId: string }).bootId, active: true });
    expect(document.getElementById("odb-annotate-root")).not.toBeNull();
  });
});
