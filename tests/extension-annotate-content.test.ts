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

  it("copies via the shared background sanitizer instead of the local compact builder", async () => {
    const runtimeListeners = new Set<RuntimeMessageListener>();
    const clipboardWrite = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboardWrite }
    });
    window.history.replaceState(null, "", "/account?token=sk-test-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890");
    document.title = "Secret sk-test-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";
    document.body.innerHTML = `<button id="target" data-token="sk-test-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890">Token sk-test-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890</button>`;
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
          if ((message as { type?: string }).type === "annotation:sanitizePayload") {
            callback?.({
              type: "annotation:sanitizePayloadResult",
              ok: true,
              payload: {
                schemaVersion: 2,
                url: "[redacted]",
                timestamp: "2026-03-12T00:00:00.000Z",
                screenshotMode: "none",
                annotations: [],
                compact: {
                  schemaVersion: 2,
                  url: "[redacted]",
                  timestamp: "2026-03-12T00:00:00.000Z",
                  screenshotMode: "none",
                  byteBudget: 24 * 1024,
                  redaction: {
                    removedFields: ["url"],
                    truncatedFields: ["title.redacted"],
                    screenshotBytesRemoved: false,
                    originalByteLength: 4096,
                    compactByteLength: 512
                  },
                  items: []
                }
              }
            });
            return;
          }
          for (const listener of runtimeListeners) {
            listener(message, {}, (response) => callback?.(response));
          }
        })
      }
    } as unknown as typeof chrome;

    await import("../extension/src/annotate-content");
    (window as Window & { __odbAnnotate?: { start: (requestId: string | null) => void } }).__odbAnnotate?.start(null);
    document.getElementById("target")?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    document.querySelector<HTMLButtonElement>("button[data-action='copy']")?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "annotation:sanitizePayload" }),
      expect.any(Function)
    );
    const copied = String(clipboardWrite.mock.calls[0]?.[0] ?? "");
    expect(copied).toContain("[redacted]");
    expect(copied).not.toContain("sk-test-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890");
  });

  it("sends raw in-page captures to background so shared send sanitization enforces the budget", async () => {
    const runtimeListeners = new Set<RuntimeMessageListener>();
    const sentMessages: unknown[] = [];
    window.history.replaceState(null, "", "/send?token=sk-test-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890");
    document.title = "Send Secret";
    document.body.innerHTML = `<button id="target" data-token="sk-test-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890">Send sk-test-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890</button>`;
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
          sentMessages.push(message);
          if ((message as { type?: string }).type === "annotation:sendPayload") {
            callback?.({
              type: "annotation:sendPayloadResult",
              ok: true,
              meta: null,
              receipt: {
                receiptId: "receipt-1",
                deliveryState: "stored_only",
                storedFallback: true,
                createdAt: "2026-03-12T00:00:00.000Z",
                itemCount: 1,
                byteLength: 512,
                source: "annotate_all",
                label: "Annotation payload"
              }
            });
            return;
          }
          for (const listener of runtimeListeners) {
            listener(message, {}, (response) => callback?.(response));
          }
        })
      }
    } as unknown as typeof chrome;

    await import("../extension/src/annotate-content");
    (window as Window & { __odbAnnotate?: { start: (requestId: string | null) => void } }).__odbAnnotate?.start(null);
    document.getElementById("target")?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    document.querySelector<HTMLButtonElement>("button[data-action='send']")?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    const sendMessage = sentMessages.find((message) => (message as { type?: string }).type === "annotation:sendPayload") as {
      payload?: { url?: string; compact?: { byteBudget?: number; redaction?: { compactByteLength?: number } } };
    } | undefined;
    expect(sendMessage?.payload?.url).toContain("sk-test-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890");
    expect(sendMessage?.payload?.compact?.byteBudget).toBe(24 * 1024);
  });

});
