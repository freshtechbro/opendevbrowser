import { afterEach, describe, expect, it, vi } from "vitest";

describe("inspiredesign capture helper", () => {
  afterEach(() => {
    vi.doUnmock("../src/core/logging");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("treats empty snapshot and clone payloads as failed deep capture attempts", async () => {
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

    expect(manager.launch).toHaveBeenCalledWith({
      headless: true,
      startUrl: "about:blank",
      persistProfile: false,
      noExtension: true
    }, expect.any(Number));
    expect(manager.goto).toHaveBeenCalledWith(
      "session-1",
      "https://example.com/reference",
      "load",
      expect.any(Number)
    );
    expect(manager.goto.mock.calls[0]?.[3]).toBeGreaterThan(0);
    expect(manager.goto.mock.calls[0]?.[3]).toBeLessThanOrEqual(30000);
    expect(result).toEqual({
      attempts: {
        snapshot: {
          status: "failed",
          detail: "Snapshot capture returned empty content."
        },
        clone: {
          status: "failed",
          detail: "Clone capture returned empty component and CSS previews."
        },
        dom: {
          status: "skipped",
          detail: "DOM capture helper unavailable in this execution lane."
        }
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
    expect(result.attempts).toEqual({
      snapshot: { status: "captured" },
      clone: { status: "captured" },
      dom: {
        status: "failed",
        detail: "dom capture unavailable"
      }
    });
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
      },
      attempts: {
        snapshot: { status: "captured" },
        clone: { status: "captured" },
        dom: { status: "captured" }
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

    expect(manager.clonePageHtmlWithOptions).toHaveBeenCalledWith(
      "session-4",
      undefined,
      undefined,
      expect.any(Number)
    );
    expect(result.dom).toBeUndefined();
    expect(result.snapshot).toMatchObject({
      content: "hero snapshot",
      refCount: 4
    });
    expect(result.clone).toMatchObject({
      componentPreview: "<section>Hero</section>",
      cssPreview: ".hero { display: grid; }"
    });
    expect(result.attempts.dom).toEqual({
      status: "failed",
      detail: "DOM capture returned empty HTML."
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

    expect(manager.cookieList).toHaveBeenCalledWith(
      "session-6",
      ["https://example.com/required-cookies"],
      undefined,
      expect.any(Number)
    );
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

    expect(manager.cookieImport).toHaveBeenCalledWith(
      "session-8",
      cookieSource.value,
      false,
      undefined,
      expect.any(Number)
    );
    expect(manager.cookieList).toHaveBeenCalledWith(
      "session-8",
      ["https://example.com/imported"],
      undefined,
      expect.any(Number)
    );
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
    expect(manager.cookieList).toHaveBeenCalledWith(
      "session-8b",
      ["https://example.com/empty-configured-cookies"],
      undefined,
      expect.any(Number)
    );
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
      false,
      undefined,
      expect.any(Number)
    );
    expect(manager.cookieList).toHaveBeenCalledWith(
      "session-8c",
      ["https://example.com/missing-imported-cookies"],
      undefined,
      expect.any(Number)
    );
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
      await vi.advanceTimersByTimeAsync(2000);
      await expect(capturePromise).resolves.toMatchObject({
        snapshot: {
          content: "capture content",
          refCount: 1
        },
        attempts: {
          snapshot: { status: "captured" },
          clone: {
            status: "failed",
            detail: "Deep capture clone capture exceeded timeout budget."
          },
          dom: {
            status: "skipped",
            detail: "DOM capture helper unavailable in this execution lane."
          }
        }
      });
      expect(manager.disconnect).toHaveBeenCalledWith("session-9", true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails when session launch exceeds the overall capture timeout budget", async () => {
    vi.useFakeTimers();

    const manager = {
      launch: vi.fn(() => new Promise(() => undefined)),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    try {
      const { captureInspiredesignReferenceFromManager } = await import("../src/providers/inspiredesign-capture");
      const capturePromise = captureInspiredesignReferenceFromManager(
        manager as never,
        "https://example.com/timeout-launch",
        { timeoutMs: 5 }
      );
      const assertion = expect(capturePromise).rejects.toThrow("Deep capture session launch exceeded timeout budget.");
      await vi.advanceTimersByTimeAsync(5);
      await assertion;
      expect(manager.disconnect).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips remaining deep capture lanes after a snapshot transport timeout", async () => {
    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-9b" }),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn().mockRejectedValue(new Error("Request timed out after 1200ms")),
      clonePage: vi.fn().mockResolvedValue({
        component: "<section />",
        css: ".x{}",
        warnings: []
      }),
      clonePageHtmlWithOptions: vi.fn().mockResolvedValue({ html: "<main>late</main>" }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    const { captureInspiredesignReferenceFromManager } = await import("../src/providers/inspiredesign-capture");
    await expect(captureInspiredesignReferenceFromManager(
      manager as never,
      "https://example.com/transport-timeout-snapshot",
      { timeoutMs: 5000 }
    )).resolves.toMatchObject({
      attempts: {
        snapshot: {
          status: "failed",
          detail: "Request timed out after 1200ms"
        },
        clone: {
          status: "skipped",
          detail: "Skipped after snapshot capture transport timeout."
        },
        dom: {
          status: "skipped",
          detail: "Skipped after snapshot capture transport timeout."
        }
      }
    });
    expect(manager.clonePage).not.toHaveBeenCalled();
    expect(manager.clonePageHtmlWithOptions).not.toHaveBeenCalled();
    expect(manager.disconnect).toHaveBeenCalledWith("session-9b", true);
  });

  it("skips DOM capture after a clone transport timeout", async () => {
    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-9c" }),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn().mockResolvedValue({
        content: "capture content",
        refCount: 1,
        warnings: []
      }),
      clonePage: vi.fn().mockRejectedValue(new Error("Request timed out after 1500ms")),
      clonePageHtmlWithOptions: vi.fn().mockResolvedValue({ html: "<main>late</main>" }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    const { captureInspiredesignReferenceFromManager } = await import("../src/providers/inspiredesign-capture");
    await expect(captureInspiredesignReferenceFromManager(
      manager as never,
      "https://example.com/transport-timeout-clone",
      { timeoutMs: 5000 }
    )).resolves.toMatchObject({
      snapshot: {
        content: "capture content",
        refCount: 1
      },
      attempts: {
        snapshot: { status: "captured" },
        clone: {
          status: "failed",
          detail: "Request timed out after 1500ms"
        },
        dom: {
          status: "skipped",
          detail: "Skipped after clone capture transport timeout."
        }
      }
    });
    expect(manager.clonePageHtmlWithOptions).not.toHaveBeenCalled();
    expect(manager.disconnect).toHaveBeenCalledWith("session-9c", true);
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
      expect(manager.clonePageHtmlWithOptions).toHaveBeenCalledWith(
        "session-10",
        undefined,
        undefined,
        2000
      );
      expect(capture.attempts.dom).toEqual({
        status: "failed",
        detail: "Deep capture DOM capture exceeded timeout budget."
      });
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
      expect(manager.snapshot).toHaveBeenCalledWith(
        "session-7",
        "actionables",
        12000,
        undefined,
        undefined,
        expect.any(Number)
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails when required-cookie verification exceeds the remaining timeout budget", async () => {
    vi.useFakeTimers();

    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-cookie-timeout" }),
      cookieList: vi.fn(() => new Promise(() => undefined)),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    try {
      const { captureInspiredesignReferenceFromManager } = await import("../src/providers/inspiredesign-capture");
      const capturePromise = captureInspiredesignReferenceFromManager(
        manager as never,
        "https://example.com/timeout-cookie-check",
        { timeoutMs: 5, cookiePolicyOverride: "required" }
      );
      const assertion = expect(capturePromise).rejects.toThrow("Deep capture cookie verification exceeded timeout budget.");
      await vi.advanceTimersByTimeAsync(5);
      await assertion;
      expect(manager.disconnect).toHaveBeenCalledWith("session-cookie-timeout", true);
    } finally {
      vi.useRealTimers();
    }
  });
});
