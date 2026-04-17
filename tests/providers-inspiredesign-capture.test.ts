import { afterEach, describe, expect, it, vi } from "vitest";

describe("inspiredesign capture helper", () => {
  afterEach(() => {
    vi.doUnmock("../src/core/logging");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("clamps invalid timeouts, tolerates missing DOM helpers, and normalizes empty warnings", async () => {
    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-1" }),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockRejectedValue(new Error("slow network")),
      snapshot: vi.fn().mockResolvedValue({
        content: "",
        refCount: 3,
        warnings: undefined
      }),
      clonePage: vi.fn().mockResolvedValue({
        component: "",
        css: "",
        warnings: undefined
      }),
      disconnect: vi.fn().mockRejectedValue(new Error("disconnect failed"))
    };

    const { captureInspiredesignReferenceFromManager } = await import("../src/providers/inspiredesign-capture");
    const result = await captureInspiredesignReferenceFromManager(
      manager as never,
      "https://example.com/reference",
      { timeoutMs: Number.POSITIVE_INFINITY }
    );

    expect(manager.goto).toHaveBeenCalledWith(
      "session-1",
      "https://example.com/reference",
      "load",
      expect.any(Number)
    );
    expect(manager.goto.mock.calls[0]?.[3]).toBeGreaterThan(0);
    expect(manager.goto.mock.calls[0]?.[3]).toBeLessThanOrEqual(30000);
    expect(result).toEqual({
      snapshot: {
        content: "",
        refCount: 3,
        warnings: []
      },
      clone: {
        componentPreview: "",
        cssPreview: "",
        warnings: []
      }
    });
    expect(manager.disconnect).toHaveBeenCalledWith("session-1", true);
  });

  it("clamps low timeouts to one millisecond and ignores rejected DOM captures", async () => {
    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-2" }),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn().mockResolvedValue({
        content: "Primary hero content",
        refCount: 8,
        warnings: ["timed out waiting for idle"]
      }),
      clonePage: vi.fn().mockResolvedValue({
        component: "<section>Hero</section>",
        css: ".hero { color: red; }",
        warnings: ["css warning"]
      }),
      clonePageHtmlWithOptions: vi.fn().mockRejectedValue(new Error("dom capture unavailable")),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    const { captureInspiredesignReferenceFromManager } = await import("../src/providers/inspiredesign-capture");
    const result = await captureInspiredesignReferenceFromManager(
      manager as never,
      "https://example.com/hero",
      { timeoutMs: -10 }
    );

    expect(manager.goto).toHaveBeenCalledWith("session-2", "https://example.com/hero", "load", 1);
    expect(result.dom).toBeUndefined();
    expect(result.snapshot.warnings).toEqual(["timed out waiting for idle"]);
    expect(result.clone.warnings).toEqual(["css warning"]);
  });

  it("falls back to the original text when redaction does not return a string", async () => {
    vi.doMock("../src/core/logging", () => ({
      redactSensitive: () => ({ masked: true })
    }));

    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-3" }),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn().mockResolvedValue({
        content: "snapshot secret",
        refCount: 2,
        warnings: []
      }),
      clonePage: vi.fn().mockResolvedValue({
        component: "<section>secret</section>",
        css: ".secret { display: block; }",
        warnings: []
      }),
      clonePageHtmlWithOptions: vi.fn().mockResolvedValue({
        html: "<main>secret</main>"
      }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    const { captureInspiredesignReferenceFromManager } = await import("../src/providers/inspiredesign-capture");
    const result = await captureInspiredesignReferenceFromManager(
      manager as never,
      "https://example.com/dom",
      {}
    );

    expect(result).toEqual({
      snapshot: {
        content: "snapshot secret",
        refCount: 2,
        warnings: []
      },
      dom: {
        outerHTML: "<main>secret</main>",
        truncated: false
      },
      clone: {
        componentPreview: "<section>secret</section>",
        cssPreview: ".secret { display: block; }",
        warnings: []
      }
    });
  });

  it("omits DOM evidence when HTML capture resolves to an empty string", async () => {
    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-4" }),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn().mockResolvedValue({
        content: "hero snapshot",
        refCount: 4,
        warnings: []
      }),
      clonePage: vi.fn().mockResolvedValue({
        component: "<section>Hero</section>",
        css: ".hero { display: grid; }",
        warnings: []
      }),
      clonePageHtmlWithOptions: vi.fn().mockResolvedValue({
        html: ""
      }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    const { captureInspiredesignReferenceFromManager } = await import("../src/providers/inspiredesign-capture");
    const result = await captureInspiredesignReferenceFromManager(
      manager as never,
      "https://example.com/empty-html",
      {}
    );

    expect(manager.clonePageHtmlWithOptions).toHaveBeenCalledWith("session-4");
    expect(result.dom).toBeUndefined();
    expect(result.snapshot).toMatchObject({
      content: "hero snapshot",
      refCount: 4
    });
    expect(result.clone).toMatchObject({
      componentPreview: "<section>Hero</section>",
      cssPreview: ".hero { display: grid; }"
    });
  });

  it("skips provider cookie import when deep capture runs with cookies disabled", async () => {
    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-off" }),
      cookieImport: vi.fn(),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn().mockResolvedValue({
        content: "cookie-free snapshot",
        refCount: 2,
        warnings: []
      }),
      clonePage: vi.fn().mockResolvedValue({
        component: "<section>Cookie-free</section>",
        css: ".cookie-free {}",
        warnings: []
      }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    const { captureInspiredesignReferenceFromManager } = await import("../src/providers/inspiredesign-capture");

    await expect(captureInspiredesignReferenceFromManager(
      manager as never,
      "https://example.com/no-cookies",
      { useCookies: false }
    )).resolves.toMatchObject({
      snapshot: {
        content: "cookie-free snapshot",
        refCount: 2
      },
      clone: {
        componentPreview: "<section>Cookie-free</section>",
        cssPreview: ".cookie-free {}"
      }
    });
    expect(manager.cookieImport).not.toHaveBeenCalled();
    expect(manager.goto).toHaveBeenCalledWith(
      "session-off",
      "https://example.com/no-cookies",
      "load",
      expect.any(Number)
    );
  });

  it("threads challengeAutomationMode onto the capture session before navigation", async () => {
    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-5" }),
      setSessionChallengeAutomationMode: vi.fn(),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn().mockResolvedValue({
        content: "capture content",
        refCount: 1,
        warnings: []
      }),
      clonePage: vi.fn().mockResolvedValue({
        component: "<section>Capture</section>",
        css: ".capture { display: block; }",
        warnings: []
      }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    const { captureInspiredesignReferenceFromManager } = await import("../src/providers/inspiredesign-capture");
    await captureInspiredesignReferenceFromManager(
      manager as never,
      "https://example.com/challenge",
      { challengeAutomationMode: "browser" }
    );

    expect(manager.setSessionChallengeAutomationMode).toHaveBeenCalledWith("session-5", "browser");
    expect(manager.goto).toHaveBeenCalledWith(
      "session-5",
      "https://example.com/challenge",
      "load",
      expect.any(Number)
    );
    expect(manager.goto.mock.calls[0]?.[3]).toBeGreaterThan(0);
    expect(manager.goto.mock.calls[0]?.[3]).toBeLessThanOrEqual(30000);
  });

  it("rejects required-cookie capture requests when the launched session has no observable cookies", async () => {
    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-6" }),
      cookieList: vi.fn().mockResolvedValue({ count: 0, cookies: [] }),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn().mockResolvedValue({
        content: "capture content",
        refCount: 1,
        warnings: []
      }),
      clonePage: vi.fn().mockResolvedValue({
        component: "<section />",
        css: ".x{}",
        warnings: []
      }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    const { captureInspiredesignReferenceFromManager } = await import("../src/providers/inspiredesign-capture");

    await expect(captureInspiredesignReferenceFromManager(
      manager as never,
      "https://example.com/required-cookies",
      { cookiePolicyOverride: "required" }
    )).rejects.toThrow("Deep capture only honors configured provider cookie sources; active session cookies are not reused.");

    expect(manager.cookieList).toHaveBeenCalledWith("session-6", ["https://example.com/required-cookies"]);
    expect(manager.goto).not.toHaveBeenCalled();
    expect(manager.disconnect).toHaveBeenCalledWith("session-6", true);
  });

  it("imports configured cookie sources into the capture session before cookie verification", async () => {
    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-8" }),
      cookieImport: vi.fn().mockResolvedValue({ imported: 1, rejected: [] }),
      cookieList: vi.fn().mockResolvedValue({ count: 1, cookies: [{ name: "sid" }] }),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn().mockResolvedValue({
        content: "capture content",
        refCount: 1,
        warnings: []
      }),
      clonePage: vi.fn().mockResolvedValue({
        component: "<section />",
        css: ".x{}",
        warnings: []
      }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    const cookieSource = {
      type: "inline" as const,
      value: [{ name: "sid", value: "abc", url: "https://example.com/imported" }]
    };
    const { captureInspiredesignReferenceFromManager } = await import("../src/providers/inspiredesign-capture");

    await captureInspiredesignReferenceFromManager(
      manager as never,
      "https://example.com/imported",
      {
        cookiePolicyOverride: "required",
        cookieSource
      }
    );

    expect(manager.cookieImport).toHaveBeenCalledWith("session-8", cookieSource.value, false);
    expect(manager.cookieList).toHaveBeenCalledWith("session-8", ["https://example.com/imported"]);
    expect(manager.goto).toHaveBeenCalledWith(
      "session-8",
      "https://example.com/imported",
      "load",
      expect.any(Number)
    );
    expect(manager.goto.mock.calls[0]?.[3]).toBeGreaterThan(0);
    expect(manager.goto.mock.calls[0]?.[3]).toBeLessThanOrEqual(30000);
  });

  it("surfaces the configured cookie-source detail when required cookies remain unavailable", async () => {
    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-8b" }),
      cookieImport: vi.fn(),
      cookieList: vi.fn().mockResolvedValue({ count: 0, cookies: [] }),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn().mockResolvedValue({
        content: "capture content",
        refCount: 1,
        warnings: []
      }),
      clonePage: vi.fn().mockResolvedValue({
        component: "<section />",
        css: ".x{}",
        warnings: []
      }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    const { captureInspiredesignReferenceFromManager } = await import("../src/providers/inspiredesign-capture");

    await expect(captureInspiredesignReferenceFromManager(
      manager as never,
      "https://example.com/empty-configured-cookies",
      {
        cookiePolicyOverride: "required",
        cookieSource: {
          type: "inline",
          value: []
        }
      }
    )).rejects.toThrow(
      "Deep capture requires observable cookies from the configured provider cookie source for the requested URL. Inline cookie source is empty."
    );

    expect(manager.cookieImport).not.toHaveBeenCalled();
    expect(manager.cookieList).toHaveBeenCalledWith("session-8b", ["https://example.com/empty-configured-cookies"]);
    expect(manager.goto).not.toHaveBeenCalled();
    expect(manager.disconnect).toHaveBeenCalledWith("session-8b", true);
  });

  it("uses the configured cookie-source error without extra detail when verification still sees zero cookies", async () => {
    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-8c" }),
      cookieImport: vi.fn().mockResolvedValue({ imported: 1, rejected: [] }),
      cookieList: vi.fn().mockResolvedValue({ count: 0, cookies: [] }),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn().mockResolvedValue({
        content: "capture content",
        refCount: 1,
        warnings: []
      }),
      clonePage: vi.fn().mockResolvedValue({
        component: "<section />",
        css: ".x{}",
        warnings: []
      }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    const { captureInspiredesignReferenceFromManager } = await import("../src/providers/inspiredesign-capture");

    await expect(captureInspiredesignReferenceFromManager(
      manager as never,
      "https://example.com/missing-imported-cookies",
      {
        cookiePolicyOverride: "required",
        cookieSource: {
          type: "inline",
          value: [{ name: "sid", value: "abc", url: "https://example.com/missing-imported-cookies" }]
        }
      }
    )).rejects.toThrow(
      "Deep capture requires observable cookies from the configured provider cookie source for the requested URL."
    );

    expect(manager.cookieImport).toHaveBeenCalledWith(
      "session-8c",
      [{ name: "sid", value: "abc", url: "https://example.com/missing-imported-cookies" }],
      false
    );
    expect(manager.cookieList).toHaveBeenCalledWith("session-8c", ["https://example.com/missing-imported-cookies"]);
    expect(manager.goto).not.toHaveBeenCalled();
    expect(manager.disconnect).toHaveBeenCalledWith("session-8c", true);
  });

  it("fails when clone capture exceeds the remaining timeout budget", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-17T10:00:00.000Z"));

    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-9" }),
      goto: vi.fn(async () => {
        vi.setSystemTime(new Date("2026-04-17T10:00:03.000Z"));
      }),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn().mockResolvedValue({
        content: "capture content",
        refCount: 1,
        warnings: []
      }),
      clonePage: vi.fn(() => new Promise((resolve) => {
        setTimeout(() => resolve({
          component: "<section />",
          css: ".x{}",
          warnings: []
        }), 2001);
      })),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    try {
      const { captureInspiredesignReferenceFromManager } = await import("../src/providers/inspiredesign-capture");
      const capturePromise = captureInspiredesignReferenceFromManager(
        manager as never,
        "https://example.com/timeout-clone",
        { timeoutMs: 5000 }
      );
      const failure = expect(capturePromise).rejects.toThrow("Deep capture clone capture exceeded timeout budget.");

      await vi.advanceTimersByTimeAsync(2000);

      await failure;
      expect(manager.disconnect).toHaveBeenCalledWith("session-9", true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops optional DOM capture when it exceeds the remaining timeout budget", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-17T10:00:00.000Z"));

    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-10" }),
      goto: vi.fn(async () => {
        vi.setSystemTime(new Date("2026-04-17T10:00:03.000Z"));
      }),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn().mockResolvedValue({
        content: "capture content",
        refCount: 1,
        warnings: []
      }),
      clonePage: vi.fn().mockResolvedValue({
        component: "<section />",
        css: ".x{}",
        warnings: []
      }),
      clonePageHtmlWithOptions: vi.fn(() => new Promise((resolve) => {
        setTimeout(() => resolve({ html: "<main>late</main>" }), 2001);
      })),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    try {
      const { captureInspiredesignReferenceFromManager } = await import("../src/providers/inspiredesign-capture");
      const capturePromise = captureInspiredesignReferenceFromManager(
        manager as never,
        "https://example.com/timeout-dom",
        { timeoutMs: 5000 }
      );

      await vi.advanceTimersByTimeAsync(2000);

      await expect(capturePromise).resolves.toMatchObject({
        snapshot: {
          content: "capture content",
          refCount: 1
        },
        clone: {
          componentPreview: "<section />",
          cssPreview: ".x{}"
        }
      });
      const capture = await capturePromise;
      expect(capture.dom).toBeUndefined();
      expect(manager.clonePageHtmlWithOptions).toHaveBeenCalledWith("session-10");
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the remaining timeout budget for waitForLoad after navigation work", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-17T10:00:00.000Z"));

    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-7" }),
      goto: vi.fn(async () => {
        vi.setSystemTime(new Date("2026-04-17T10:00:03.000Z"));
      }),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn().mockResolvedValue({
        content: "capture content",
        refCount: 1,
        warnings: []
      }),
      clonePage: vi.fn().mockResolvedValue({
        component: "<section />",
        css: ".x{}",
        warnings: []
      }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    try {
      const { captureInspiredesignReferenceFromManager } = await import("../src/providers/inspiredesign-capture");

      await captureInspiredesignReferenceFromManager(
        manager as never,
        "https://example.com/budgeted",
        { timeoutMs: 5000 }
      );

      expect(manager.goto).toHaveBeenCalledWith("session-7", "https://example.com/budgeted", "load", 5000);
      expect(manager.waitForLoad).toHaveBeenCalledWith("session-7", "networkidle", 2000);
      expect(manager.snapshot).toHaveBeenCalledWith("session-7", "actionables", 12000);
    } finally {
      vi.useRealTimers();
    }
  });
});
