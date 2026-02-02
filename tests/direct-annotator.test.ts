import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resolveDirectAnnotateAssets, runDirectAnnotate } from "../src/annotate/direct-annotator";
import type { BrowserManagerLike } from "../src/browser/manager-types";

type MockPage = {
  window: Record<string, unknown>;
  cancelled: boolean;
  exposeBinding: ReturnType<typeof vi.fn>;
  addInitScript: ReturnType<typeof vi.fn>;
  evaluate: ReturnType<typeof vi.fn>;
  addStyleTag: ReturnType<typeof vi.fn>;
  addScriptTag: ReturnType<typeof vi.fn>;
  screenshot: ReturnType<typeof vi.fn>;
  goto: ReturnType<typeof vi.fn>;
};

const createMockPage = (options: {
  completionType?: "ok" | "cancelled" | "error" | "none";
  skipShim?: boolean;
  bindingExists?: boolean;
  skipPingResponse?: boolean;
  screenshotError?: boolean;
  missingCaptureBinding?: boolean;
  errorWithoutDetails?: boolean;
  captureBindingError?: boolean;
  completeBindingError?: boolean;
} = {}): MockPage => {
  let bindingAttempt = 0;
  const page: MockPage = {
    window: {},
    cancelled: false,
    exposeBinding: vi.fn(async (name: string, fn: (...args: unknown[]) => unknown) => {
      if (options.captureBindingError && name === "__odbDirectCapture") {
        throw new Error("boom");
      }
      if (options.missingCaptureBinding && name === "__odbDirectCapture") {
        throw new Error("already registered");
      }
      if (options.completeBindingError && name === "__odbDirectComplete") {
        throw new Error("boom");
      }
      if (options.bindingExists && bindingAttempt === 0) {
        bindingAttempt += 1;
        page.window[name] = (...args: unknown[]) => fn({ page }, ...args);
        throw new Error("already registered");
      }
      bindingAttempt += 1;
      page.window[name] = (...args: unknown[]) => fn({ page }, ...args);
    }),
    addInitScript: vi.fn(async () => {}),
    evaluate: vi.fn(async (fn: (...args: unknown[]) => unknown, arg?: unknown) => {
      if (options.skipShim && typeof fn === "function" && fn.name === "installShim") {
        return null;
      }
      const previous = (globalThis as unknown as { window?: unknown }).window;
      (globalThis as unknown as { window?: unknown }).window = page.window;
      try {
        if (typeof fn === "function") {
          return fn(arg);
        }
        return null;
      } finally {
        (globalThis as unknown as { window?: unknown }).window = previous;
      }
    }),
    addStyleTag: vi.fn(async () => {}),
    addScriptTag: vi.fn(async () => {
      const runtime = (page.window as { chrome?: { runtime?: { onMessage?: { addListener?: (listener: (...args: unknown[]) => unknown) => void } } } }).chrome?.runtime;
      runtime?.onMessage?.addListener?.((message: { type?: string; requestId?: string; options?: { screenshotMode?: string } }, _sender, sendResponse) => {
        if (message.type === "annotation:ping") {
          if (!options.skipPingResponse) {
            sendResponse?.({ ok: true });
          }
          return true;
        }
        if (message.type === "annotation:start") {
          sendResponse?.({ ok: true });
          const completionType = options.completionType ?? "ok";
          if (completionType === "none") {
            return true;
          }
          const runtimeSend = runtime?.sendMessage as unknown as ((msg: Record<string, unknown>, cb?: (response: Record<string, unknown>) => void) => void);
          if (completionType === "cancelled") {
            runtimeSend?.({ type: "annotation:cancelled", requestId: message.requestId });
            return true;
          }
          if (completionType === "error") {
            runtimeSend?.({
              type: "annotation:error",
              requestId: message.requestId,
              error: options.errorWithoutDetails ? undefined : { code: "capture_failed", message: "Capture failed" }
            });
            return true;
          }
          runtimeSend?.({ type: "annotation:capture", mode: "visible", requestId: message.requestId }, () => {
            runtimeSend?.({
              type: "annotation:complete",
              requestId: message.requestId,
              payload: {
                url: "https://example.com",
                timestamp: "2026-01-31T00:00:00Z",
                screenshotMode: message.options?.screenshotMode ?? "visible",
                annotations: []
              }
            });
          });
          return true;
        }
        if (message.type === "annotation:cancel") {
          page.cancelled = true;
          sendResponse?.({ ok: true });
          return true;
        }
        return false;
      });
    }),
    screenshot: vi.fn(async () => {
      if (options.screenshotError) {
        throw new Error("Screenshot failed");
      }
      return Buffer.from("image");
    }),
    goto: vi.fn(async () => {})
  };

  return page;
};

describe("resolveDirectAnnotateAssets", () => {
  it("returns error when extension path missing", () => {
    const result = resolveDirectAnnotateAssets(() => null);
    expect(result.assets).toBeUndefined();
    expect(result.error).toMatch(/Extension assets unavailable/);
  });

  it("returns error when assets are missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "odb-annotate-"));
    try {
      const result = resolveDirectAnnotateAssets(() => dir);
      expect(result.assets).toBeUndefined();
      expect(result.error).toMatch(/Direct annotate assets missing/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns assets when files exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "odb-annotate-"));
    try {
      const dist = join(dir, "dist");
      mkdirSync(dist, { recursive: true });
      writeFileSync(join(dist, "annotate-content.js"), "// test");
      writeFileSync(join(dist, "annotate-content.css"), "/* test */");
      const result = resolveDirectAnnotateAssets(() => dir);
      expect(result.assets?.scriptPath).toContain("annotate-content.js");
      expect(result.assets?.stylePath).toContain("annotate-content.css");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("runDirectAnnotate", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs direct annotate and returns payload", async () => {
    const page = createMockPage();
    const manager = {
      withPage: vi.fn(async (_sessionId, _targetId, fn) => fn(page as never))
    } as unknown as BrowserManagerLike;

    const result = await runDirectAnnotate(manager, {
      scriptPath: "/tmp/annotate-content.js",
      stylePath: "/tmp/annotate-content.css"
    }, {
      sessionId: "s1",
      url: "https://example.com",
      screenshotMode: "visible"
    });

    expect(result.status).toBe("ok");
    expect(result.payload?.url).toBe("https://example.com");
    expect(page.goto).toHaveBeenCalledWith("https://example.com", { waitUntil: "load" });
    expect(page.screenshot).toHaveBeenCalled();
  });

  it("times out and cancels the session", async () => {
    vi.useFakeTimers();
    const page = createMockPage({ completionType: "none" });
    const manager = {
      withPage: vi.fn(async (_sessionId, _targetId, fn) => fn(page as never))
    } as unknown as BrowserManagerLike;

    const promise = runDirectAnnotate(manager, {
      scriptPath: "/tmp/annotate-content.js",
      stylePath: "/tmp/annotate-content.css"
    }, {
      sessionId: "s1",
      timeoutMs: 5
    });

    await vi.advanceTimersByTimeAsync(10);
    const result = await promise;

    expect(result.status).toBe("error");
    expect(result.error?.code).toBe("timeout");
    expect(page.cancelled).toBe(true);
  });

  it("returns cancelled when the abort signal fires", async () => {
    const page = createMockPage({ completionType: "none" });
    const manager = {
      withPage: vi.fn(async (_sessionId, _targetId, fn) => fn(page as never))
    } as unknown as BrowserManagerLike;

    const controller = new AbortController();
    controller.abort();

    const result = await runDirectAnnotate(manager, {
      scriptPath: "/tmp/annotate-content.js",
      stylePath: "/tmp/annotate-content.css"
    }, {
      sessionId: "s1",
      signal: controller.signal
    });

    expect(result.status).toBe("cancelled");
    expect(result.error?.code).toBe("cancelled");
    expect(page.cancelled).toBe(true);
  });

  it("returns cancelled when abort fires after start", async () => {
    const page = createMockPage({ completionType: "none" });
    const manager = {
      withPage: vi.fn(async (_sessionId, _targetId, fn) => fn(page as never))
    } as unknown as BrowserManagerLike;

    let startResolver: () => void = () => {};
    const startPromise = new Promise<void>((resolve) => {
      startResolver = resolve;
    });
    const originalEvaluate = page.evaluate;
    page.evaluate = vi.fn(async (fn: (...args: unknown[]) => unknown, arg?: unknown) => {
      if (arg && typeof arg === "object" && (arg as { type?: string }).type === "annotation:start") {
        startResolver();
      }
      return await originalEvaluate(fn, arg);
    });

    const controller = new AbortController();
    const promise = runDirectAnnotate(manager, {
      scriptPath: "/tmp/annotate-content.js",
      stylePath: "/tmp/annotate-content.css"
    }, {
      sessionId: "s1",
      signal: controller.signal
    });

    await startPromise;
    controller.abort();
    const result = await promise;

    expect(result.status).toBe("cancelled");
    expect(result.error?.code).toBe("cancelled");
    expect(page.cancelled).toBe(true);
  });

  it("returns cancelled when the abort signal fires after start", async () => {
    const page = createMockPage({ completionType: "none" });
    const manager = {
      withPage: vi.fn(async (_sessionId, _targetId, fn) => fn(page as never))
    } as unknown as BrowserManagerLike;

    const controller = new AbortController();
    const promise = runDirectAnnotate(manager, {
      scriptPath: "/tmp/annotate-content.js",
      stylePath: "/tmp/annotate-content.css"
    }, {
      sessionId: "s1",
      signal: controller.signal
    });

    controller.abort();
    const result = await promise;

    expect(result.status).toBe("cancelled");
    expect(result.error?.code).toBe("cancelled");
    expect(page.cancelled).toBe(true);
  });

  it("returns cancelled when content script reports cancelled", async () => {
    const page = createMockPage({ completionType: "cancelled" });
    const manager = {
      withPage: vi.fn(async (_sessionId, _targetId, fn) => fn(page as never))
    } as unknown as BrowserManagerLike;

    const result = await runDirectAnnotate(manager, {
      scriptPath: "/tmp/annotate-content.js",
      stylePath: "/tmp/annotate-content.css"
    }, {
      sessionId: "s1"
    });

    expect(result.status).toBe("cancelled");
    expect(result.error?.code).toBe("cancelled");
  });

  it("returns error when content script reports error", async () => {
    const page = createMockPage({ completionType: "error" });
    const manager = {
      withPage: vi.fn(async (_sessionId, _targetId, fn) => fn(page as never))
    } as unknown as BrowserManagerLike;

    const result = await runDirectAnnotate(manager, {
      scriptPath: "/tmp/annotate-content.js",
      stylePath: "/tmp/annotate-content.css"
    }, {
      sessionId: "s1"
    });

    expect(result.status).toBe("error");
    expect(result.error?.code).toBe("capture_failed");
  });

  it("throws when the shim runtime is missing", async () => {
    const page = createMockPage({ completionType: "ok", skipShim: true });
    const manager = {
      withPage: vi.fn(async (_sessionId, _targetId, fn) => fn(page as never))
    } as unknown as BrowserManagerLike;

    await expect(runDirectAnnotate(manager, {
      scriptPath: "/tmp/annotate-content.js",
      stylePath: "/tmp/annotate-content.css"
    }, {
      sessionId: "s1"
    })).rejects.toThrow("Direct annotation runtime missing");
  });

  it("throws when annotation ping responses are missing", async () => {
    const page = createMockPage({ skipPingResponse: true });
    const manager = {
      withPage: vi.fn(async (_sessionId, _targetId, fn) => fn(page as never))
    } as unknown as BrowserManagerLike;

    await expect(runDirectAnnotate(manager, {
      scriptPath: "/tmp/annotate-content.js",
      stylePath: "/tmp/annotate-content.css"
    }, {
      sessionId: "s1"
    })).rejects.toThrow("Annotation content script unavailable");
  });

  it("throws when the completion binding cannot be registered", async () => {
    const page = createMockPage({ completeBindingError: true });
    const manager = {
      withPage: vi.fn(async (_sessionId, _targetId, fn) => fn(page as never))
    } as unknown as BrowserManagerLike;

    await expect(runDirectAnnotate(manager, {
      scriptPath: "/tmp/annotate-content.js",
      stylePath: "/tmp/annotate-content.css"
    }, {
      sessionId: "s1"
    })).rejects.toThrow("boom");
  });

  it("throws when the capture binding cannot be registered", async () => {
    const page = createMockPage({ captureBindingError: true });
    const manager = {
      withPage: vi.fn(async (_sessionId, _targetId, fn) => fn(page as never))
    } as unknown as BrowserManagerLike;

    await expect(runDirectAnnotate(manager, {
      scriptPath: "/tmp/annotate-content.js",
      stylePath: "/tmp/annotate-content.css"
    }, {
      sessionId: "s1"
    })).rejects.toThrow("boom");
  });

  it("ignores binding-exists errors when bindings are already set", async () => {
    const page = createMockPage({ completionType: "ok", bindingExists: true });
    const manager = {
      withPage: vi.fn(async (_sessionId, _targetId, fn) => fn(page as never))
    } as unknown as BrowserManagerLike;

    const result = await runDirectAnnotate(manager, {
      scriptPath: "/tmp/annotate-content.js",
      stylePath: "/tmp/annotate-content.css"
    }, {
      sessionId: "s1"
    });

    expect(result.status).toBe("ok");
  });

  it("ignores binding-exists errors when thrown as strings", async () => {
    const page = createMockPage({ completionType: "ok" });
    page.exposeBinding = vi.fn(async (name: string, fn: (...args: unknown[]) => unknown) => {
      page.window[name] = (...args: unknown[]) => fn({ page }, ...args);
      throw "already registered";
    });
    const manager = {
      withPage: vi.fn(async (_sessionId, _targetId, fn) => fn(page as never))
    } as unknown as BrowserManagerLike;

    const result = await runDirectAnnotate(manager, {
      scriptPath: "/tmp/annotate-content.js",
      stylePath: "/tmp/annotate-content.css"
    }, {
      sessionId: "s1"
    });

    expect(result.status).toBe("ok");
  });
  it("returns ok when capture binding is missing but completion arrives", async () => {
    const page = createMockPage({ completionType: "ok", missingCaptureBinding: true });
    const manager = {
      withPage: vi.fn(async (_sessionId, _targetId, fn) => fn(page as never))
    } as unknown as BrowserManagerLike;

    const result = await runDirectAnnotate(manager, {
      scriptPath: "/tmp/annotate-content.js",
      stylePath: "/tmp/annotate-content.css"
    }, {
      sessionId: "s1"
    });

    expect(result.status).toBe("ok");
    expect(page.screenshot).not.toHaveBeenCalled();
  });

  it("surfaces capture failures from the binding", async () => {
    const page = createMockPage({ completionType: "ok", screenshotError: true });
    const manager = {
      withPage: vi.fn(async (_sessionId, _targetId, fn) => fn(page as never))
    } as unknown as BrowserManagerLike;

    const result = await runDirectAnnotate(manager, {
      scriptPath: "/tmp/annotate-content.js",
      stylePath: "/tmp/annotate-content.css"
    }, {
      sessionId: "s1"
    });

    expect(result.status).toBe("ok");
    expect(page.screenshot).toHaveBeenCalled();
  });

  it("defaults to unknown errors when content script omits error details", async () => {
    const page = createMockPage({ completionType: "error", errorWithoutDetails: true });
    const manager = {
      withPage: vi.fn(async (_sessionId, _targetId, fn) => fn(page as never))
    } as unknown as BrowserManagerLike;

    const result = await runDirectAnnotate(manager, {
      scriptPath: "/tmp/annotate-content.js",
      stylePath: "/tmp/annotate-content.css"
    }, {
      sessionId: "s1"
    });

    expect(result.status).toBe("error");
    expect(result.error?.code).toBe("unknown");
    expect(result.error?.message).toBe("Annotation failed.");
  });

  it("returns ok when no listener responds to runtime messages", async () => {
    const page = createMockPage();
    const manager = {
      withPage: vi.fn(async (_sessionId, _targetId, fn) => fn(page as never))
    } as unknown as BrowserManagerLike;

    await runDirectAnnotate(manager, {
      scriptPath: "/tmp/annotate-content.js",
      stylePath: "/tmp/annotate-content.css"
    }, {
      sessionId: "s1"
    });

    const response = await page.evaluate(() => new Promise((resolve) => {
      const runtime = (window as { chrome?: { runtime?: { sendMessage?: (message: Record<string, unknown>, cb?: (response: Record<string, unknown>) => void) => void } } }).chrome?.runtime;
      runtime?.sendMessage?.({ type: "annotation:noop" }, (result) => resolve(result ?? { ok: false }));
    }));

    expect(response).toEqual({ ok: true });
  });

  it("uses listener responses for unknown runtime messages", async () => {
    const page = createMockPage();
    const manager = {
      withPage: vi.fn(async (_sessionId, _targetId, fn) => fn(page as never))
    } as unknown as BrowserManagerLike;

    await runDirectAnnotate(manager, {
      scriptPath: "/tmp/annotate-content.js",
      stylePath: "/tmp/annotate-content.css"
    }, {
      sessionId: "s1"
    });

    await page.evaluate(() => {
      const runtime = (window as { chrome?: { runtime?: { onMessage?: { addListener?: (listener: (...args: unknown[]) => unknown) => void } } } }).chrome?.runtime;
      runtime?.onMessage?.addListener?.((message, _sender, sendResponse) => {
        if ((message as { type?: string }).type === "annotation:noop") {
          sendResponse?.({ ok: "listener" });
        }
      });
    });

    const response = await page.evaluate(() => new Promise((resolve) => {
      const runtime = (window as { chrome?: { runtime?: { sendMessage?: (message: Record<string, unknown>, cb?: (response: Record<string, unknown>) => void) => void } } }).chrome?.runtime;
      runtime?.sendMessage?.({ type: "annotation:noop" }, (result) => resolve(result ?? { ok: false }));
    }));

    expect(response).toEqual({ ok: "listener" });
  });

  it("uses the first listener response when multiple responses arrive", async () => {
    const page = createMockPage();
    const manager = {
      withPage: vi.fn(async (_sessionId, _targetId, fn) => fn(page as never))
    } as unknown as BrowserManagerLike;

    await runDirectAnnotate(manager, {
      scriptPath: "/tmp/annotate-content.js",
      stylePath: "/tmp/annotate-content.css"
    }, {
      sessionId: "s1"
    });

    const response = await page.evaluate(() => new Promise((resolve) => {
      const runtime = (window as { chrome?: { runtime?: { onMessage?: { addListener?: (listener: (...args: unknown[]) => unknown) => void } } } }).chrome?.runtime;
      runtime?.onMessage?.addListener?.((message, _sender, sendResponse) => {
        if ((message as { type?: string }).type === "annotation:noop") {
          sendResponse?.({ ok: "first" });
          sendResponse?.({ ok: "ignored" });
        }
      });
      runtime?.onMessage?.addListener?.((message, _sender, sendResponse) => {
        if ((message as { type?: string }).type === "annotation:noop") {
          sendResponse?.({ ok: "second" });
        }
      });
      runtime?.sendMessage?.({ type: "annotation:noop" }, (result) => resolve(result ?? { ok: false }));
    }));

    expect(response).toEqual({ ok: "first" });
  });

  it("reuses the shim on repeated runs", async () => {
    const page = createMockPage({ completionType: "ok" });
    const manager = {
      withPage: vi.fn(async (_sessionId, _targetId, fn) => fn(page as never))
    } as unknown as BrowserManagerLike;

    const assets = {
      scriptPath: "/tmp/annotate-content.js",
      stylePath: "/tmp/annotate-content.css"
    };

    const first = await runDirectAnnotate(manager, assets, { sessionId: "s1" });
    const second = await runDirectAnnotate(manager, assets, { sessionId: "s1" });

    expect(first.status).toBe("ok");
    expect(second.status).toBe("ok");
  });

  it("returns capture data from runtime messages", async () => {
    const page = createMockPage({ completionType: "ok" });
    const manager = {
      withPage: vi.fn(async (_sessionId, _targetId, fn) => fn(page as never))
    } as unknown as BrowserManagerLike;

    await runDirectAnnotate(manager, {
      scriptPath: "/tmp/annotate-content.js",
      stylePath: "/tmp/annotate-content.css"
    }, {
      sessionId: "s1"
    });

    const response = await page.evaluate(() => new Promise((resolve) => {
      const runtime = (window as { chrome?: { runtime?: { sendMessage?: (message: Record<string, unknown>, cb?: (response: Record<string, unknown>) => void) => void } } }).chrome?.runtime;
      runtime?.sendMessage?.({ type: "annotation:capture", mode: "visible" }, (result) => resolve(result ?? { ok: false }));
    }));

    const result = response as { ok?: boolean; dataUrl?: string };
    expect(result.ok).toBe(true);
    expect(result.dataUrl).toMatch(/^data:image\/png;base64/);
  });

  it("returns capture errors from runtime messages", async () => {
    const page = createMockPage({ completionType: "ok" });
    const manager = {
      withPage: vi.fn(async (_sessionId, _targetId, fn) => fn(page as never))
    } as unknown as BrowserManagerLike;

    await runDirectAnnotate(manager, {
      scriptPath: "/tmp/annotate-content.js",
      stylePath: "/tmp/annotate-content.css"
    }, {
      sessionId: "s1"
    });

    const response = await page.evaluate(() => new Promise((resolve) => {
      (window as { __odbDirectCapture?: () => Promise<string> }).__odbDirectCapture = async () => {
        throw new Error("capture-boom");
      };
      const runtime = (window as { chrome?: { runtime?: { sendMessage?: (message: Record<string, unknown>, cb?: (response: Record<string, unknown>) => void) => void } } }).chrome?.runtime;
      runtime?.sendMessage?.({ type: "annotation:capture", mode: "visible" }, (result) => resolve(result ?? { ok: false }));
    }));

    const result = response as { ok?: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error).toBe("capture-boom");
  });

  it("normalizes non-error capture failures", async () => {
    const page = createMockPage({ completionType: "ok" });
    const manager = {
      withPage: vi.fn(async (_sessionId, _targetId, fn) => fn(page as never))
    } as unknown as BrowserManagerLike;

    await runDirectAnnotate(manager, {
      scriptPath: "/tmp/annotate-content.js",
      stylePath: "/tmp/annotate-content.css"
    }, {
      sessionId: "s1"
    });

    const response = await page.evaluate(() => new Promise((resolve) => {
      (window as { __odbDirectCapture?: () => Promise<string> }).__odbDirectCapture = async () => {
        throw "capture-failed";
      };
      const runtime = (window as { chrome?: { runtime?: { sendMessage?: (message: Record<string, unknown>, cb?: (response: Record<string, unknown>) => void) => void } } }).chrome?.runtime;
      runtime?.sendMessage?.({ type: "annotation:capture", mode: "visible" }, (result) => resolve(result ?? { ok: false }));
    }));

    expect(response).toEqual({ ok: false, error: "Capture failed" });
  });

  it("reports missing capture bindings in runtime messages", async () => {
    const page = createMockPage({ completionType: "ok" });
    const manager = {
      withPage: vi.fn(async (_sessionId, _targetId, fn) => fn(page as never))
    } as unknown as BrowserManagerLike;

    await runDirectAnnotate(manager, {
      scriptPath: "/tmp/annotate-content.js",
      stylePath: "/tmp/annotate-content.css"
    }, {
      sessionId: "s1"
    });

    const response = await page.evaluate(() => new Promise((resolve) => {
      const w = window as { __odbDirectCapture?: () => Promise<string> };
      delete w.__odbDirectCapture;
      const runtime = (window as { chrome?: { runtime?: { sendMessage?: (message: Record<string, unknown>, cb?: (response: Record<string, unknown>) => void) => void } } }).chrome?.runtime;
      runtime?.sendMessage?.({ type: "annotation:capture", mode: "visible" }, (result) => resolve(result ?? { ok: false }));
    }));

    expect(response).toEqual({ ok: false, error: "Capture binding unavailable" });
  });

  it("defaults capture mode when omitted", async () => {
    const page = createMockPage({ completionType: "ok" });
    const manager = {
      withPage: vi.fn(async (_sessionId, _targetId, fn) => fn(page as never))
    } as unknown as BrowserManagerLike;

    await runDirectAnnotate(manager, {
      scriptPath: "/tmp/annotate-content.js",
      stylePath: "/tmp/annotate-content.css"
    }, {
      sessionId: "s1"
    });

    const response = await page.evaluate(() => new Promise((resolve) => {
      const runtime = (window as { chrome?: { runtime?: { sendMessage?: (message: Record<string, unknown>, cb?: (response: Record<string, unknown>) => void) => void } } }).chrome?.runtime;
      runtime?.sendMessage?.({ type: "annotation:capture" }, (result) => resolve(result ?? { ok: false }));
    }));

    const result = response as { ok?: boolean; dataUrl?: string };
    expect(result.ok).toBe(true);
    expect(result.dataUrl).toMatch(/^data:image\/png;base64/);
  });

  it("defaults runtime message types when payloads are missing", async () => {
    const page = createMockPage({ completionType: "ok" });
    const manager = {
      withPage: vi.fn(async (_sessionId, _targetId, fn) => fn(page as never))
    } as unknown as BrowserManagerLike;

    await runDirectAnnotate(manager, {
      scriptPath: "/tmp/annotate-content.js",
      stylePath: "/tmp/annotate-content.css"
    }, {
      sessionId: "s1"
    });

    const response = await page.evaluate(() => new Promise((resolve) => {
      const runtime = (window as { chrome?: { runtime?: { sendMessage?: (message: unknown, cb?: (response: Record<string, unknown>) => void) => void } } }).chrome?.runtime;
      runtime?.sendMessage?.(null, (result) => resolve(result ?? { ok: false }));
    }));

    expect(response).toEqual({ ok: true });
  });

  it("ignores completion messages missing request ids", async () => {
    const page = createMockPage({ completionType: "ok" });
    const manager = {
      withPage: vi.fn(async (_sessionId, _targetId, fn) => fn(page as never))
    } as unknown as BrowserManagerLike;

    await runDirectAnnotate(manager, {
      scriptPath: "/tmp/annotate-content.js",
      stylePath: "/tmp/annotate-content.css"
    }, {
      sessionId: "s1"
    });

    await page.evaluate(() => {
      const complete = (window as { __odbDirectComplete?: (message: Record<string, unknown>) => void }).__odbDirectComplete;
      complete?.({ type: "annotation:complete" });
    });
  });

  it("ignores completion messages that are not objects", async () => {
    const page = createMockPage({ completionType: "ok" });
    const manager = {
      withPage: vi.fn(async (_sessionId, _targetId, fn) => fn(page as never))
    } as unknown as BrowserManagerLike;

    await runDirectAnnotate(manager, {
      scriptPath: "/tmp/annotate-content.js",
      stylePath: "/tmp/annotate-content.css"
    }, {
      sessionId: "s1"
    });

    await page.evaluate(() => {
      const complete = (window as { __odbDirectComplete?: (message: unknown) => void }).__odbDirectComplete;
      complete?.("not-an-object");
    });
  });
});
