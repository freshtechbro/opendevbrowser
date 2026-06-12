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
      waitForLoad: vi.fn().mockRejectedValue(new Error("Navigation wait timed out after 5000ms")),
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

    const { captureInspiredesignReferenceFromManager } = await import("../src/inspiredesign/capture");
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

  it("rethrows non-timeout waitForLoad failures before capture begins", async () => {
    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-wait-error" }),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockRejectedValue(new Error("page crashed")),
      snapshot: vi.fn(),
      clonePage: vi.fn(),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    const { captureInspiredesignReferenceFromManager } = await import("../src/inspiredesign/capture");

    await expect(captureInspiredesignReferenceFromManager(
      manager as never,
      "https://example.com/reference",
      {}
    )).rejects.toThrow("page crashed");
    expect(manager.snapshot).not.toHaveBeenCalled();
    expect(manager.clonePage).not.toHaveBeenCalled();
    expect(manager.disconnect).toHaveBeenCalledWith("session-wait-error", true);
  });

  it("rethrows non-Error waitForLoad failures before capture begins", async () => {
    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-wait-non-error" }),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockRejectedValue("page stalled"),
      snapshot: vi.fn(),
      clonePage: vi.fn(),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    const { captureInspiredesignReferenceFromManager } = await import("../src/inspiredesign/capture");

    await expect(captureInspiredesignReferenceFromManager(
      manager as never,
      "https://example.com/reference",
      {}
    )).rejects.toBe("page stalled");
    expect(manager.snapshot).not.toHaveBeenCalled();
    expect(manager.clonePage).not.toHaveBeenCalled();
    expect(manager.disconnect).toHaveBeenCalledWith("session-wait-non-error", true);
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

    const { captureInspiredesignReferenceFromManager } = await import("../src/inspiredesign/capture");
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

  it("captures visual evidence screenshots when a screenshot path is configured", async () => {
    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-visual" }),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn().mockResolvedValue({
        url: "https://example.com/visual",
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
        html: "<main>Hero</main>"
      }),
      screenshot: vi.fn().mockResolvedValue({
        path: "/tmp/inspiredesign-visual/reference.png",
        warnings: ["cdp fallback"]
      }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    const { captureInspiredesignReferenceFromManager } = await import("../src/inspiredesign/capture");
    const result = await captureInspiredesignReferenceFromManager(
      manager as never,
      "https://example.com/visual",
      {
        visualEvidence: "required",
        visualEvidencePath: "/tmp/inspiredesign-visual/reference.png"
      }
    );

    expect(manager.screenshot).toHaveBeenCalledWith("session-visual", {
      path: "/tmp/inspiredesign-visual/reference.png",
      fullPage: false
    });
    expect(result.visual).toEqual(expect.objectContaining({
      status: "captured",
      kind: "viewport",
      fullPage: false,
      sourceUrl: "https://example.com/visual",
      tempPath: "/tmp/inspiredesign-visual/reference.png",
      warnings: ["cdp fallback"]
    }));
    expect(manager.disconnect).toHaveBeenCalledWith("session-visual", true);
  });

  it("captures visual evidence without warnings when screenshot metadata is minimal", async () => {
    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-visual-minimal" }),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn().mockResolvedValue({
        url: "https://example.com/visual-minimal",
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
        html: "<main>Hero</main>"
      }),
      screenshot: vi.fn().mockResolvedValue({
        path: "/tmp/inspiredesign-visual/minimal.png"
      }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    const { captureInspiredesignReferenceFromManager } = await import("../src/inspiredesign/capture");
    const result = await captureInspiredesignReferenceFromManager(
      manager as never,
      "https://example.com/visual-minimal",
      {
        visualEvidence: "required",
        visualEvidencePath: "/tmp/inspiredesign-visual/minimal.png"
      }
    );

    expect(result.visual).toEqual(expect.objectContaining({
      status: "captured",
      sourceUrl: "https://example.com/visual-minimal",
      tempPath: "/tmp/inspiredesign-visual/minimal.png",
      warnings: []
    }));
  });

  it("fails visual evidence when the screenshot helper writes a different path", async () => {
    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-visual-mismatch" }),
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
        html: "<main>Hero</main>"
      }),
      screenshot: vi.fn().mockResolvedValue({
        path: "/tmp/inspiredesign-visual/other.png"
      }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    const { captureInspiredesignReferenceFromManager } = await import("../src/inspiredesign/capture");
    const result = await captureInspiredesignReferenceFromManager(
      manager as never,
      "https://example.com/visual-mismatch",
      {
        visualEvidence: "required",
        visualEvidencePath: "/tmp/inspiredesign-visual/expected.png"
      }
    );

    expect(result.visual).toEqual(expect.objectContaining({
      status: "failed",
      failure: "Visual evidence screenshot path did not match the requested artifact path."
    }));
  });

  it("skips optional visual evidence when no screenshot path is configured", async () => {
    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-visual-auto-no-path" }),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn().mockResolvedValue({ content: "hero snapshot", refCount: 4 }),
      clonePage: vi.fn().mockResolvedValue({ component: "<section>Hero</section>", css: ".hero{}", warnings: undefined }),
      clonePageHtmlWithOptions: vi.fn().mockResolvedValue({ html: undefined }),
      screenshot: vi.fn(),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    const { captureInspiredesignReferenceFromManager } = await import("../src/inspiredesign/capture");
    const result = await captureInspiredesignReferenceFromManager(
      manager as never,
      "https://example.com/visual-auto-no-path",
      { visualEvidence: "auto" }
    );

    expect(manager.screenshot).not.toHaveBeenCalled();
    expect(result.snapshot?.warnings).toEqual([]);
    expect(result.clone?.warnings).toEqual([]);
    expect(result.dom).toBeUndefined();
    expect(result.attempts.dom).toEqual({
      status: "failed",
      detail: "DOM capture returned empty HTML."
    });
    expect(result.visual).toEqual(expect.objectContaining({
      status: "skipped",
      failure: "Visual evidence path was not configured for screenshot capture."
    }));
  });

  it("skips unavailable screenshot helpers in auto mode", async () => {
    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-visual-auto" }),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn().mockResolvedValue({ content: "hero snapshot", refCount: 4, warnings: [] }),
      clonePage: vi.fn().mockResolvedValue({ component: "<section>Hero</section>", css: "", warnings: [] }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    const { captureInspiredesignReferenceFromManager } = await import("../src/inspiredesign/capture");
    const result = await captureInspiredesignReferenceFromManager(
      manager as never,
      "https://example.com/visual-auto",
      {
        visualEvidence: "auto",
        visualEvidencePath: "/tmp/inspiredesign-visual/auto.png"
      }
    );

    expect(result.visual).toEqual(expect.objectContaining({
      status: "skipped",
      failure: "Visual evidence screenshot helper unavailable in this execution lane."
    }));
    expect(manager.disconnect).toHaveBeenCalledWith("session-visual-auto", true);
  });

  it("fails unavailable screenshot helpers in required mode", async () => {
    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-visual-required" }),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn().mockResolvedValue({ content: "hero snapshot", refCount: 4, warnings: [] }),
      clonePage: vi.fn().mockResolvedValue({ component: "<section>Hero</section>", css: "", warnings: [] }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    const { captureInspiredesignReferenceFromManager } = await import("../src/inspiredesign/capture");
    const result = await captureInspiredesignReferenceFromManager(
      manager as never,
      "https://example.com/visual-required",
      {
        visualEvidence: "required",
        visualEvidencePath: "/tmp/inspiredesign-visual/required.png"
      }
    );

    expect(result.visual).toEqual(expect.objectContaining({
      status: "failed",
      failure: "Visual evidence screenshot helper unavailable in this execution lane."
    }));
    expect(manager.disconnect).toHaveBeenCalledWith("session-visual-required", true);
  });

  it("fails required visual capture when the screenshot path is missing", async () => {
    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-visual-no-path" }),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn().mockResolvedValue({ content: "hero snapshot", refCount: 4, warnings: [] }),
      clonePage: vi.fn().mockResolvedValue({ component: "<section>Hero</section>", css: "", warnings: [] }),
      screenshot: vi.fn(),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    const { captureInspiredesignReferenceFromManager } = await import("../src/inspiredesign/capture");
    const result = await captureInspiredesignReferenceFromManager(
      manager as never,
      "https://example.com/visual-no-path",
      { visualEvidence: "required" }
    );

    expect(manager.screenshot).not.toHaveBeenCalled();
    expect(result.visual).toEqual(expect.objectContaining({
      status: "failed",
      failure: "Visual evidence path was not configured for screenshot capture."
    }));
    expect(manager.disconnect).toHaveBeenCalledWith("session-visual-no-path", true);
  });

  it("records empty screenshot path responses as failed visual evidence", async () => {
    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-visual-empty-path" }),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn().mockResolvedValue({ content: "hero snapshot", refCount: 4, warnings: [] }),
      clonePage: vi.fn().mockResolvedValue({ component: "<section>Hero</section>", css: "", warnings: [] }),
      screenshot: vi.fn().mockResolvedValue({ warnings: [] }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    const { captureInspiredesignReferenceFromManager } = await import("../src/inspiredesign/capture");
    const result = await captureInspiredesignReferenceFromManager(
      manager as never,
      "https://example.com/visual-empty-path",
      {
        visualEvidence: "required",
        visualEvidencePath: "/tmp/inspiredesign-visual/empty.png"
      }
    );

    expect(result.visual).toEqual(expect.objectContaining({
      status: "failed",
      failure: "Visual evidence screenshot did not return a file path."
    }));
    expect(manager.disconnect).toHaveBeenCalledWith("session-visual-empty-path", true);
  });

  it("records screenshot failures without suppressing disconnect", async () => {
    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-visual-failure" }),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn().mockResolvedValue({ content: "hero snapshot", refCount: 4, warnings: [] }),
      clonePage: vi.fn().mockResolvedValue({ component: "<section>Hero</section>", css: "", warnings: [] }),
      screenshot: vi.fn().mockRejectedValue(new Error("screenshot failed")),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    const { captureInspiredesignReferenceFromManager } = await import("../src/inspiredesign/capture");
    const result = await captureInspiredesignReferenceFromManager(
      manager as never,
      "https://example.com/visual-failure",
      {
        visualEvidence: "required",
        visualEvidencePath: "/tmp/inspiredesign-visual/failure.png"
      }
    );

    expect(result.visual).toEqual(expect.objectContaining({
      status: "failed",
      failure: "screenshot failed"
    }));
    expect(manager.disconnect).toHaveBeenCalledWith("session-visual-failure", true);
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

    const { captureInspiredesignReferenceFromManager } = await import("../src/inspiredesign/capture");
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

    const { captureInspiredesignReferenceFromManager } = await import("../src/inspiredesign/capture");
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

  it("treats undefined snapshot and clone payloads as empty capture attempts", async () => {
    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-undefined-payloads" }),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn().mockResolvedValue({
        refCount: 0,
        warnings: []
      }),
      clonePage: vi.fn().mockResolvedValue({
        warnings: []
      }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    const { captureInspiredesignReferenceFromManager } = await import("../src/inspiredesign/capture");
    const result = await captureInspiredesignReferenceFromManager(
      manager as never,
      "https://example.com/undefined-payloads",
      {}
    );

    expect(result.snapshot).toBeUndefined();
    expect(result.clone).toBeUndefined();
    expect(result.attempts.snapshot).toEqual({
      status: "failed",
      detail: "Snapshot capture returned empty content."
    });
    expect(result.attempts.clone).toEqual({
      status: "failed",
      detail: "Clone capture returned empty component and CSS previews."
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

    const { captureInspiredesignReferenceFromManager } = await import("../src/inspiredesign/capture");

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

    const { captureInspiredesignReferenceFromManager } = await import("../src/inspiredesign/capture");
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

    const { captureInspiredesignReferenceFromManager } = await import("../src/inspiredesign/capture");

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
    const { captureInspiredesignReferenceFromManager } = await import("../src/inspiredesign/capture");

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

  it("imports configured cookie sources into primary visual capture before navigation", async () => {
    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-primary-visual" }),
      cookieImport: vi.fn().mockResolvedValue({ imported: 1, rejected: [] }),
      cookieList: vi.fn().mockResolvedValue({ count: 1, cookies: [{ name: "sid" }] }),
      setSessionChallengeAutomationMode: vi.fn(),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      screenshot: vi.fn().mockResolvedValue({ path: "/tmp/primary-visual-cookie.png", warnings: [] }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };
    const cookieSource = {
      type: "inline" as const,
      value: [{ name: "sid", value: "abc", url: "https://example.com/primary-visual" }]
    };

    const { captureInspiredesignPrimaryVisualEvidenceFromManager } = await import("../src/inspiredesign/capture");
    const result = await captureInspiredesignPrimaryVisualEvidenceFromManager(
      manager as never,
      "https://example.com/primary-visual",
      {
        visualEvidencePath: "/tmp/primary-visual-cookie.png",
        cookiePolicyOverride: "required",
        challengeAutomationMode: "browser",
        cookieSource
      }
    );

    expect(manager.cookieImport).toHaveBeenCalledWith(
      "session-primary-visual",
      cookieSource.value,
      false,
      undefined,
      expect.any(Number)
    );
    expect(manager.cookieList).toHaveBeenCalledWith(
      "session-primary-visual",
      ["https://example.com/primary-visual"],
      undefined,
      expect.any(Number)
    );
    expect(manager.setSessionChallengeAutomationMode).toHaveBeenCalledWith("session-primary-visual", "browser");
    expect(manager.goto).toHaveBeenCalledWith(
      "session-primary-visual",
      "https://example.com/primary-visual",
      "load",
      expect.any(Number)
    );
    expect(result).toEqual(expect.objectContaining({
      status: "captured",
      tempPath: "/tmp/primary-visual-cookie.png"
    }));
  });

	it("captures primary Pinterest pin media through the browser primitive", async () => {
	const manager = {
		launch: vi.fn().mockResolvedValue({ sessionId: "session-primary-pin-media" }),
		setSessionChallengeAutomationMode: vi.fn(),
		goto: vi.fn().mockResolvedValue(undefined),
		waitForLoad: vi.fn().mockResolvedValue(undefined),
		snapshot: vi.fn().mockResolvedValue({
		url: "https://www.pinterest.com/pin/27654985208435505/",
		title: "Pinterest",
		content: "Editorial pin media",
		refCount: 1,
		warnings: []
		}),
		clonePageHtmlWithOptions: vi.fn().mockResolvedValue({
		html: "<img data-test-id=\"closeup-image-main-MainPinImage\" src=\"https://i.pinimg.com/originals/pin.jpg\">"
		}),
		capturePinterestPinMedia: vi.fn().mockResolvedValue({
		status: "captured",
		sourceUrl: "https://www.pinterest.com/pin/27654985208435505/",
		targetId: "target-pin",
		kind: "image",
		path: "/tmp/primary-pin-media",
		mediaUrl: "https://i.pinimg.com/originals/pin.jpg",
		contentType: "image/jpeg",
		naturalWidth: 1200,
		naturalHeight: 1600,
		candidateSelector: "[data-test-id='closeup-image-main-MainPinImage']",
		rejectedCandidates: []
		}),
		disconnect: vi.fn().mockResolvedValue(undefined)
	};

	const { captureInspiredesignPrimaryPinMediaEvidenceFromManager } = await import("../src/inspiredesign/capture");
	const result = await captureInspiredesignPrimaryPinMediaEvidenceFromManager(
		manager as never,
		"https://www.pinterest.com/pin/27654985208435505/",
		{
		referenceId: "pin-ref",
		pinMediaEvidencePath: "/tmp/primary-pin-media",
		cookiePolicyOverride: "off",
		challengeAutomationMode: "browser"
		}
	);

	expect(manager.capturePinterestPinMedia).toHaveBeenCalledWith("session-primary-pin-media", {
		path: "/tmp/primary-pin-media",
		timeoutMs: expect.any(Number)
	});
	expect(manager.setSessionChallengeAutomationMode).toHaveBeenCalledWith("session-primary-pin-media", "browser");
	expect(result).toEqual(expect.objectContaining({
		status: "captured",
		kind: "image",
		referenceId: "pin-ref",
		url: "https://www.pinterest.com/pin/27654985208435505/",
		sourceUrl: "https://www.pinterest.com/pin/27654985208435505/",
		pinterestPageQuality: "pin_media",
		mediaUrl: "https://i.pinimg.com/originals/pin.jpg",
		contentType: "image/jpeg",
		tempPath: "/tmp/primary-pin-media",
		width: 1200,
		height: 1600,
		warnings: []
	}));
	expect(manager.disconnect).toHaveBeenCalledWith("session-primary-pin-media", true);
	});

  it("opens canonical Pinterest pins in the extension before pin media capture", async () => {
    const manager = {
      launch: vi.fn()
        .mockResolvedValueOnce({ sessionId: "session-pin-extension-warmup" })
        .mockResolvedValueOnce({ sessionId: "session-pin-extension-capture" }),
      setSessionChallengeAutomationMode: vi.fn(),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn()
        .mockRejectedValueOnce(new Error("Navigation wait timed out after 5000ms"))
        .mockResolvedValueOnce(undefined),
      snapshot: vi.fn().mockResolvedValue({
        url: "https://www.pinterest.com/pin/27654985208435505/",
        title: "Pinterest",
        content: "Editorial pin media",
        refCount: 1,
        warnings: []
      }),
      clonePageHtmlWithOptions: vi.fn().mockResolvedValue({
        html: "<img data-test-id=\"closeup-image-main-MainPinImage\" src=\"https://i.pinimg.com/originals/pin.jpg\">"
      }),
      capturePinterestPinMedia: vi.fn().mockResolvedValue({
        status: "captured",
        sourceUrl: "https://www.pinterest.com/pin/27654985208435505/",
        targetId: "target-pin",
        kind: "image",
        path: "/tmp/primary-pin-media-extension",
        mediaUrl: "https://i.pinimg.com/originals/pin.jpg",
        contentType: "image/jpeg",
        naturalWidth: 1200,
        naturalHeight: 1600,
        candidateSelector: "[data-test-id='closeup-image-main-MainPinImage']",
        rejectedCandidates: []
      }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    const { captureInspiredesignPrimaryPinMediaEvidenceFromManager } = await import("../src/inspiredesign/capture");
    const result = await captureInspiredesignPrimaryPinMediaEvidenceFromManager(
      manager as never,
      "https://www.pinterest.com/pin/27654985208435505/",
      {
        referenceId: "pin-ref",
        pinMediaEvidencePath: "/tmp/primary-pin-media-extension",
        browserMode: "extension",
        cookiePolicyOverride: "off",
        challengeAutomationMode: "browser_with_helper"
      }
    );

    expect(manager.launch).toHaveBeenNthCalledWith(1, {
      headless: false,
      startUrl: "about:blank",
      persistProfile: false,
      noExtension: false
    }, expect.any(Number));
    expect(manager.goto).toHaveBeenNthCalledWith(
      1,
      "session-pin-extension-warmup",
      "https://www.pinterest.com/pin/27654985208435505/",
      "load",
      expect.any(Number)
    );
    expect(manager.waitForLoad).toHaveBeenNthCalledWith(
      1,
      "session-pin-extension-warmup",
      "networkidle",
      expect.any(Number)
    );
    expect(manager.disconnect).toHaveBeenNthCalledWith(1, "session-pin-extension-warmup", false);
    expect(manager.launch).toHaveBeenNthCalledWith(2, {
      headless: false,
      startUrl: "about:blank",
      persistProfile: false,
      noExtension: false
    }, expect.any(Number));
    expect(manager.goto).toHaveBeenNthCalledWith(
      2,
      "session-pin-extension-capture",
      "https://www.pinterest.com/pin/27654985208435505/",
      "load",
      expect.any(Number)
    );
    expect(manager.capturePinterestPinMedia).toHaveBeenCalledWith("session-pin-extension-capture", {
      path: "/tmp/primary-pin-media-extension",
      timeoutMs: expect.any(Number)
    });
    expect(manager.setSessionChallengeAutomationMode).toHaveBeenNthCalledWith(
      1,
      "session-pin-extension-warmup",
      "browser_with_helper"
    );
    expect(manager.setSessionChallengeAutomationMode).toHaveBeenNthCalledWith(
      2,
      "session-pin-extension-capture",
      "browser_with_helper"
    );
    expect(manager.disconnect).toHaveBeenNthCalledWith(2, "session-pin-extension-capture", true);
    expect(result).toEqual(expect.objectContaining({
      status: "captured",
      kind: "image",
      tempPath: "/tmp/primary-pin-media-extension",
      pinterestPageQuality: "pin_media"
    }));
	  });

  it("defaults exact canonical Pinterest pin media capture to extension warmup", async () => {
    const cases = [
      { name: "default", browserMode: undefined },
      { name: "auto", browserMode: "auto" as const }
    ];
    const { captureInspiredesignPrimaryPinMediaEvidenceFromManager } = await import("../src/inspiredesign/capture");

    for (const testCase of cases) {
      const manager = {
        launch: vi.fn()
          .mockResolvedValueOnce({ sessionId: `session-${testCase.name}-warmup` })
          .mockResolvedValueOnce({ sessionId: `session-${testCase.name}-capture` }),
        setSessionChallengeAutomationMode: vi.fn(),
        goto: vi.fn().mockResolvedValue(undefined),
        waitForLoad: vi.fn().mockResolvedValue(undefined),
        snapshot: vi.fn().mockResolvedValue({
          url: "https://www.pinterest.com/pin/27654985208435505/",
          title: "Pinterest",
          content: "Pin media",
          refCount: 1,
          warnings: []
        }),
        clonePageHtmlWithOptions: vi.fn().mockResolvedValue({
          html: "<img data-test-id=\"closeup-image-main-MainPinImage\" src=\"https://i.pinimg.com/originals/pin.jpg\">"
        }),
        capturePinterestPinMedia: vi.fn().mockResolvedValue({
          status: "captured",
          sourceUrl: "https://www.pinterest.com/pin/27654985208435505/",
          targetId: "target-pin",
          kind: "image",
          path: `/tmp/primary-pin-media-${testCase.name}`,
          mediaUrl: "https://i.pinimg.com/originals/pin.jpg",
          contentType: "image/jpeg",
          naturalWidth: 1200,
          naturalHeight: 1600,
          candidateSelector: "[data-test-id='closeup-image-main-MainPinImage']",
          rejectedCandidates: []
        }),
        disconnect: vi.fn().mockResolvedValue(undefined)
      };

      await captureInspiredesignPrimaryPinMediaEvidenceFromManager(
        manager as never,
        "https://www.pinterest.com/pin/27654985208435505/",
        {
          referenceId: "pin-ref",
          pinMediaEvidencePath: `/tmp/primary-pin-media-${testCase.name}`,
          ...(testCase.browserMode ? { browserMode: testCase.browserMode } : {}),
          cookiePolicyOverride: "off",
          challengeAutomationMode: "browser_with_helper"
        }
      );

      expect(manager.launch, testCase.name).toHaveBeenCalledTimes(2);
      expect(manager.launch, testCase.name).toHaveBeenNthCalledWith(1, {
        headless: false,
        startUrl: "about:blank",
        persistProfile: false,
        noExtension: false
      }, expect.any(Number));
      expect(manager.launch, testCase.name).toHaveBeenNthCalledWith(2, {
        headless: false,
        startUrl: "about:blank",
        persistProfile: false,
        noExtension: false
      }, expect.any(Number));
      expect(manager.goto, testCase.name).toHaveBeenNthCalledWith(
        1,
        `session-${testCase.name}-warmup`,
        "https://www.pinterest.com/pin/27654985208435505/",
        "load",
        expect.any(Number)
      );
      expect(manager.goto, testCase.name).toHaveBeenNthCalledWith(
        2,
        `session-${testCase.name}-capture`,
        "https://www.pinterest.com/pin/27654985208435505/",
        "load",
        expect.any(Number)
      );
    }
  });

  it("warms normalized canonical Pinterest pin media URLs before capture", async () => {
    const cases = [
      {
        name: "missing-trailing-slash",
        inputUrl: "https://www.pinterest.com/pin/27654985208435505",
        expectedNavigationUrl: "https://www.pinterest.com/pin/27654985208435505/"
      },
      {
        name: "locale-host",
        inputUrl: "https://uk.pinterest.com/pin/27654985208435505/",
        expectedNavigationUrl: "https://www.pinterest.com/pin/27654985208435505/"
      },
      {
        name: "query-canonical-pin",
        inputUrl: "https://www.pinterest.com/pin/27654985208435505/?utm_source=test",
        expectedNavigationUrl: "https://www.pinterest.com/pin/27654985208435505/"
      }
    ];
    const { captureInspiredesignPrimaryPinMediaEvidenceFromManager } = await import("../src/inspiredesign/capture");

    for (const testCase of cases) {
      const manager = {
        launch: vi.fn()
          .mockResolvedValueOnce({ sessionId: `session-${testCase.name}-warmup` })
          .mockResolvedValueOnce({ sessionId: `session-${testCase.name}-capture` }),
        setSessionChallengeAutomationMode: vi.fn(),
        goto: vi.fn().mockResolvedValue(undefined),
        waitForLoad: vi.fn().mockResolvedValue(undefined),
        snapshot: vi.fn().mockResolvedValue({
          url: testCase.expectedNavigationUrl,
          title: "Pinterest",
          content: "Pin media",
          refCount: 1,
          warnings: []
        }),
        clonePageHtmlWithOptions: vi.fn().mockResolvedValue({
          html: "<img data-test-id=\"closeup-image-main-MainPinImage\" src=\"https://i.pinimg.com/originals/pin.jpg\">"
        }),
        capturePinterestPinMedia: vi.fn().mockResolvedValue({
          status: "captured",
          sourceUrl: testCase.expectedNavigationUrl,
          targetId: "target-pin",
          kind: "image",
          path: `/tmp/primary-pin-media-${testCase.name}`,
          mediaUrl: "https://i.pinimg.com/originals/pin.jpg",
          contentType: "image/jpeg",
          naturalWidth: 1200,
          naturalHeight: 1600,
          candidateSelector: "[data-test-id='closeup-image-main-MainPinImage']",
          rejectedCandidates: []
        }),
        disconnect: vi.fn().mockResolvedValue(undefined)
      };

      await captureInspiredesignPrimaryPinMediaEvidenceFromManager(
        manager as never,
        testCase.inputUrl,
        {
          referenceId: "pin-ref",
          pinMediaEvidencePath: `/tmp/primary-pin-media-${testCase.name}`,
          browserMode: "extension",
          cookiePolicyOverride: "off",
          challengeAutomationMode: "browser_with_helper"
        }
      );

      expect(manager.launch, testCase.name).toHaveBeenCalledTimes(2);
      expect(manager.goto, testCase.name).toHaveBeenNthCalledWith(
        1,
        `session-${testCase.name}-warmup`,
        testCase.expectedNavigationUrl,
        "load",
        expect.any(Number)
      );
      expect(manager.goto, testCase.name).toHaveBeenNthCalledWith(
        2,
        `session-${testCase.name}-capture`,
        testCase.expectedNavigationUrl,
        "load",
        expect.any(Number)
      );
    }
  });

  it("keeps launch budget after slow canonical Pinterest pin warmup", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-12T00:00:00.000Z"));

    const launchTimeouts: number[] = [];
    const manager = {
      launch: vi.fn(async (_options: unknown, timeoutMs?: number) => {
        launchTimeouts.push(timeoutMs ?? 0);
        return { sessionId: launchTimeouts.length === 1 ? "session-warmup" : "session-capture" };
      }),
      setSessionChallengeAutomationMode: vi.fn(),
      goto: vi.fn(async (sessionId: string) => {
        if (sessionId === "session-warmup") {
          vi.setSystemTime(Date.now() + 25_000);
        }
      }),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn().mockResolvedValue({
        url: "https://uk.pinterest.com/pin/84301824269977360/",
        title: "Pin on Catalog",
        content: "Digital Product & Brand Experience Agency - Gladeye pin page",
        refCount: 1,
        warnings: []
      }),
      clonePageHtmlWithOptions: vi.fn().mockResolvedValue({
        html: "<img data-test-id=\"closeup-image-main-MainPinImage\" src=\"https://i.pinimg.com/originals/direct-pin.jpg\">"
      }),
      capturePinterestPinMedia: vi.fn().mockResolvedValue({
        status: "captured",
        sourceUrl: "https://uk.pinterest.com/pin/84301824269977360/",
        targetId: "target-pin",
        kind: "image",
        path: "/tmp/slow-warmup-primary-pin-media",
        mediaUrl: "https://i.pinimg.com/originals/direct-pin.jpg",
        contentType: "image/jpeg",
        naturalWidth: 1200,
        naturalHeight: 1600,
        candidateSelector: "[data-test-id='closeup-image-main-MainPinImage']",
        rejectedCandidates: []
      }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    try {
      const { captureInspiredesignPrimaryPinMediaEvidenceFromManager } = await import("../src/inspiredesign/capture");

      const result = await captureInspiredesignPrimaryPinMediaEvidenceFromManager(
        manager as never,
        "https://www.pinterest.com/pin/84301824269977360/",
        {
          referenceId: "pin-ref",
          pinMediaEvidencePath: "/tmp/slow-warmup-primary-pin-media",
          browserMode: "extension",
          cookiePolicyOverride: "off",
          challengeAutomationMode: "browser_with_helper",
          timeoutMs: 240_000
        }
      );

      expect(result).toEqual(expect.objectContaining({
        status: "captured",
        pinterestPageQuality: "pin_media"
      }));
      expect(launchTimeouts).toHaveLength(2);
      expect(launchTimeouts[1]).toBeGreaterThanOrEqual(60_000);
      expect(manager.capturePinterestPinMedia).toHaveBeenCalledWith(
        "session-capture",
        expect.objectContaining({
          timeoutMs: expect.any(Number)
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("charges canonical Pinterest pin warmup against the primary media capture deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-12T00:00:00.000Z"));

    const launchTimeouts: number[] = [];
    const captureTimeouts: number[] = [];
    const manager = {
      launch: vi.fn(async (_options: unknown, timeoutMs?: number) => {
        launchTimeouts.push(timeoutMs ?? 0);
        return { sessionId: launchTimeouts.length === 1 ? "session-warmup" : "session-capture" };
      }),
      setSessionChallengeAutomationMode: vi.fn(),
      goto: vi.fn(async (sessionId: string) => {
        if (sessionId === "session-warmup") {
          vi.setSystemTime(Date.now() + 5_500);
        }
      }),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn().mockResolvedValue({
        url: "https://uk.pinterest.com/pin/84301824269977360/",
        title: "Pin on Catalog",
        content: "Digital Product & Brand Experience Agency - Gladeye pin page",
        refCount: 1,
        warnings: []
      }),
      clonePageHtmlWithOptions: vi.fn().mockResolvedValue({
        html: "<img data-test-id=\"closeup-image-main-MainPinImage\" src=\"https://i.pinimg.com/originals/direct-pin.jpg\">"
      }),
      capturePinterestPinMedia: vi.fn(async (_sessionId: string, input: { timeoutMs?: number }) => {
        captureTimeouts.push(input.timeoutMs ?? 0);
        return {
          status: "captured",
          sourceUrl: "https://uk.pinterest.com/pin/84301824269977360/",
          targetId: "target-pin",
          kind: "image",
          path: "/tmp/warmup-charged-primary-pin-media",
          mediaUrl: "https://i.pinimg.com/originals/direct-pin.jpg",
          contentType: "image/jpeg",
          naturalWidth: 1200,
          naturalHeight: 1600,
          candidateSelector: "[data-test-id='closeup-image-main-MainPinImage']",
          rejectedCandidates: []
        };
      }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    try {
      const { captureInspiredesignPrimaryPinMediaEvidenceFromManager } = await import("../src/inspiredesign/capture");

      const result = await captureInspiredesignPrimaryPinMediaEvidenceFromManager(
        manager as never,
        "https://www.pinterest.com/pin/84301824269977360/",
        {
          referenceId: "pin-ref",
          pinMediaEvidencePath: "/tmp/warmup-charged-primary-pin-media",
          browserMode: "extension",
          cookiePolicyOverride: "off",
          challengeAutomationMode: "browser_with_helper",
          timeoutMs: 6_000
        }
      );

      expect(result).toEqual(expect.objectContaining({
        status: "captured",
        pinterestPageQuality: "pin_media"
      }));
      expect(launchTimeouts[0]).toBe(6_000);
      expect(launchTimeouts[1]).toBeGreaterThan(0);
      expect(launchTimeouts[1]).toBeLessThanOrEqual(500);
      expect(captureTimeouts[0]).toBeGreaterThan(0);
      expect(captureTimeouts[0]).toBeLessThanOrEqual(500);
    } finally {
      vi.useRealTimers();
    }
  });

  it("continues pin media capture after canonical Pinterest warmup timeout", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-12T00:00:00.000Z"));

    let launchCount = 0;
    const manager = {
      launch: vi.fn(async () => {
        launchCount += 1;
        return { sessionId: launchCount === 1 ? "session-warmup" : "session-capture" };
      }),
      setSessionChallengeAutomationMode: vi.fn(),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn((sessionId: string) => (
        sessionId === "session-warmup"
          ? new Promise(() => undefined)
          : Promise.resolve()
      )),
      snapshot: vi.fn().mockResolvedValue({
        url: "https://uk.pinterest.com/pin/84301824269977360/",
        title: "Pin on Catalog",
        content: "Digital Product & Brand Experience Agency - Gladeye pin page",
        refCount: 1,
        warnings: []
      }),
      clonePageHtmlWithOptions: vi.fn().mockResolvedValue({
        html: "<img data-test-id=\"closeup-image-main-MainPinImage\" src=\"https://i.pinimg.com/originals/direct-pin.jpg\">"
      }),
      capturePinterestPinMedia: vi.fn().mockResolvedValue({
        status: "captured",
        sourceUrl: "https://uk.pinterest.com/pin/84301824269977360/",
        targetId: "target-pin",
        kind: "image",
        path: "/tmp/warmup-timeout-primary-pin-media",
        mediaUrl: "https://i.pinimg.com/originals/direct-pin.jpg",
        contentType: "image/jpeg",
        naturalWidth: 1200,
        naturalHeight: 1600,
        candidateSelector: "[data-test-id='closeup-image-main-MainPinImage']",
        rejectedCandidates: []
      }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    try {
      const { captureInspiredesignPrimaryPinMediaEvidenceFromManager } = await import("../src/inspiredesign/capture");

      const capturePromise = captureInspiredesignPrimaryPinMediaEvidenceFromManager(
        manager as never,
        "https://www.pinterest.com/pin/84301824269977360/",
        {
          referenceId: "pin-ref",
          pinMediaEvidencePath: "/tmp/warmup-timeout-primary-pin-media",
          browserMode: "extension",
          cookiePolicyOverride: "off",
          challengeAutomationMode: "browser_with_helper",
          timeoutMs: 240_000
        }
      );
      await vi.advanceTimersByTimeAsync(30_000);

      await expect(capturePromise).resolves.toEqual(expect.objectContaining({
        status: "captured",
        pinterestPageQuality: "pin_media"
      }));
      expect(manager.launch).toHaveBeenCalledTimes(2);
      expect(manager.capturePinterestPinMedia).toHaveBeenCalledWith(
        "session-capture",
        expect.objectContaining({
          timeoutMs: expect.any(Number)
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs primary Pinterest pin media capture before viewport probes can consume the budget", async () => {
    const totalPinMediaCaptureBudgetMs = 120;
    const minimumPinMediaCaptureBudgetMs = 60;
    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-primary-pin-first" }),
      setSessionChallengeAutomationMode: vi.fn(),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn(() => new Promise(() => undefined)),
      clonePageHtmlWithOptions: vi.fn(() => new Promise(() => undefined)),
      capturePinterestPinMedia: vi.fn(async (_sessionId: string, input: { timeoutMs?: number }) => {
        if ((input.timeoutMs ?? 0) < minimumPinMediaCaptureBudgetMs) {
          throw new Error(`pin media budget too small: ${input.timeoutMs}`);
        }
        return {
          status: "captured",
          sourceUrl: "https://www.pinterest.com/pin/84301824269977360/",
          targetId: "target-pin",
          kind: "image",
          path: "/tmp/primary-pin-first",
          mediaUrl: "https://i.pinimg.com/originals/primary-pin-first.jpg",
          contentType: "image/jpeg",
          naturalWidth: 1200,
          naturalHeight: 1600,
          rejectedCandidates: []
        };
      }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };
    const { captureInspiredesignPrimaryPinMediaEvidenceFromManager } = await import("../src/inspiredesign/capture");

    const result = await captureInspiredesignPrimaryPinMediaEvidenceFromManager(
      manager as never,
      "https://www.pinterest.com/pin/84301824269977360/",
      {
        referenceId: "pin-ref",
        pinMediaEvidencePath: "/tmp/primary-pin-first",
        browserMode: "extension",
        cookiePolicyOverride: "off",
        timeoutMs: totalPinMediaCaptureBudgetMs
      }
    );

    expect(result).toEqual(expect.objectContaining({
      status: "captured",
      pinterestPageQuality: "pin_media",
      sourceUrl: "https://www.pinterest.com/pin/84301824269977360/"
    }));
    expect(manager.snapshot).not.toHaveBeenCalled();
    expect(manager.clonePageHtmlWithOptions).not.toHaveBeenCalled();
    expect(manager.capturePinterestPinMedia).toHaveBeenCalledWith(
      "session-primary-pin-first",
      expect.objectContaining({ timeoutMs: expect.any(Number) })
    );
    expect(manager.capturePinterestPinMedia.mock.calls[0]?.[1].timeoutMs).toBeGreaterThanOrEqual(
      minimumPinMediaCaptureBudgetMs
    );
  });

  it("caps canonical Pinterest pin network-idle waits before primary pin media capture", async () => {
    const totalCaptureBudgetMs = 45_000;
    const maxPinMediaNetworkIdleWaitMs = 5_000;
    const minimumRemainingCaptureBudgetMs = 30_000;
    const manager = {
      launch: vi.fn()
        .mockResolvedValueOnce({ sessionId: "session-pin-warmup-budget" })
        .mockResolvedValueOnce({ sessionId: "session-pin-capture-budget" }),
      setSessionChallengeAutomationMode: vi.fn(),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockRejectedValue(new Error("Navigation wait timed out after 5000ms")),
      snapshot: vi.fn(() => new Promise(() => undefined)),
      clonePageHtmlWithOptions: vi.fn(() => new Promise(() => undefined)),
      capturePinterestPinMedia: vi.fn().mockResolvedValue({
        status: "captured",
        sourceUrl: "https://www.pinterest.com/pin/84301824269977360/",
        targetId: "target-pin",
        kind: "image",
        path: "/tmp/primary-pin-budget",
        mediaUrl: "https://i.pinimg.com/originals/primary-pin-budget.jpg",
        contentType: "image/jpeg",
        naturalWidth: 1200,
        naturalHeight: 1600,
        rejectedCandidates: []
      }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };
    const { captureInspiredesignPrimaryPinMediaEvidenceFromManager } = await import("../src/inspiredesign/capture");

    const result = await captureInspiredesignPrimaryPinMediaEvidenceFromManager(
      manager as never,
      "https://uk.pinterest.com/pin/84301824269977360/?utm_source=test",
      {
        referenceId: "pin-ref",
        pinMediaEvidencePath: "/tmp/primary-pin-budget",
        browserMode: "extension",
        cookiePolicyOverride: "off",
        timeoutMs: totalCaptureBudgetMs
      }
    );

    expect(result).toEqual(expect.objectContaining({
      status: "captured",
      pinterestPageQuality: "pin_media",
      sourceUrl: "https://www.pinterest.com/pin/84301824269977360/"
    }));
    expect(manager.waitForLoad).toHaveBeenCalledTimes(2);
    for (const call of manager.waitForLoad.mock.calls) {
      expect(call[2]).toBeLessThanOrEqual(maxPinMediaNetworkIdleWaitMs);
    }
    expect(manager.capturePinterestPinMedia).toHaveBeenCalledWith(
      "session-pin-capture-budget",
      expect.objectContaining({ timeoutMs: expect.any(Number) })
    );
    expect(manager.capturePinterestPinMedia.mock.calls[0]?.[1].timeoutMs).toBeGreaterThan(
      minimumRemainingCaptureBudgetMs
    );
    expect(manager.snapshot).not.toHaveBeenCalled();
    expect(manager.clonePageHtmlWithOptions).not.toHaveBeenCalled();
  });

	  it("imports configured cookies before extension warmup navigation", async () => {
	    const cookieSource = {
	      type: "inline" as const,
      value: [{ name: "sid", value: "abc", url: "https://www.pinterest.com/pin/27654985208435505/" }]
    };
    const manager = {
      launch: vi.fn()
        .mockResolvedValueOnce({ sessionId: "session-cookie-warmup" })
        .mockResolvedValueOnce({ sessionId: "session-cookie-capture" }),
      cookieImport: vi.fn().mockResolvedValue({ imported: 1, rejected: [] }),
      cookieList: vi.fn().mockResolvedValue({ count: 1, cookies: [{ name: "sid" }] }),
      setSessionChallengeAutomationMode: vi.fn(),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn().mockResolvedValue({
        url: "https://www.pinterest.com/pin/27654985208435505/",
        title: "Pinterest",
        content: "Editorial pin media",
        refCount: 1,
        warnings: []
      }),
      clonePageHtmlWithOptions: vi.fn().mockResolvedValue({
        html: "<img data-test-id=\"closeup-image-main-MainPinImage\" src=\"https://i.pinimg.com/originals/pin.jpg\">"
      }),
      capturePinterestPinMedia: vi.fn().mockResolvedValue({
        status: "captured",
        sourceUrl: "https://www.pinterest.com/pin/27654985208435505/",
        targetId: "target-pin",
        kind: "image",
        path: "/tmp/primary-pin-media-cookie",
        mediaUrl: "https://i.pinimg.com/originals/pin.jpg",
        contentType: "image/jpeg",
        naturalWidth: 1200,
        naturalHeight: 1600,
        candidateSelector: "[data-test-id='closeup-image-main-MainPinImage']",
        rejectedCandidates: []
      }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    const { captureInspiredesignPrimaryPinMediaEvidenceFromManager } = await import("../src/inspiredesign/capture");
    await captureInspiredesignPrimaryPinMediaEvidenceFromManager(
      manager as never,
      "https://www.pinterest.com/pin/27654985208435505/",
      {
        referenceId: "pin-ref",
        pinMediaEvidencePath: "/tmp/primary-pin-media-cookie",
        browserMode: "extension",
        cookiePolicyOverride: "required",
        challengeAutomationMode: "browser_with_helper",
        cookieSource
      }
    );

    expect(manager.cookieImport).toHaveBeenNthCalledWith(
      1,
      "session-cookie-warmup",
      cookieSource.value,
      false,
      undefined,
      expect.any(Number)
    );
    expect(manager.cookieList).toHaveBeenNthCalledWith(
      1,
      "session-cookie-warmup",
      ["https://www.pinterest.com/pin/27654985208435505/"],
      undefined,
      expect.any(Number)
    );
    expect(manager.goto).toHaveBeenNthCalledWith(
      1,
      "session-cookie-warmup",
      "https://www.pinterest.com/pin/27654985208435505/",
      "load",
      expect.any(Number)
    );
    expect(manager.cookieImport).toHaveBeenNthCalledWith(
      2,
      "session-cookie-capture",
      cookieSource.value,
      false,
      undefined,
      expect.any(Number)
    );
    expect(manager.cookieList).toHaveBeenNthCalledWith(
      2,
      "session-cookie-capture",
      ["https://www.pinterest.com/pin/27654985208435505/"],
      undefined,
      expect.any(Number)
    );
    expect(manager.goto).toHaveBeenNthCalledWith(
      2,
      "session-cookie-capture",
      "https://www.pinterest.com/pin/27654985208435505/",
      "load",
      expect.any(Number)
    );
  });

  it("skips extension warmup outside exact canonical Pinterest pin extension capture", async () => {
    const cases = [
      { name: "search-url", url: "https://www.pinterest.com/search/pins/?q=studio", browserMode: "extension" },
      { name: "non-http-canonical-pin", url: "ftp://www.pinterest.com/pin/27654985208435505/", browserMode: "extension" },
	      { name: "managed-canonical-pin", url: "https://www.pinterest.com/pin/27654985208435505/", browserMode: "managed" },
	      { name: "non-pinterest-url", url: "https://example.com/pin/27654985208435505/", browserMode: "extension" }
	    ] as const;
    const { captureInspiredesignPrimaryPinMediaEvidenceFromManager } = await import("../src/inspiredesign/capture");

    for (const testCase of cases) {
      const manager = {
        launch: vi.fn().mockResolvedValue({ sessionId: `session-${testCase.name}` }),
        setSessionChallengeAutomationMode: vi.fn(),
        goto: vi.fn().mockResolvedValue(undefined),
        waitForLoad: vi.fn().mockResolvedValue(undefined),
        snapshot: vi.fn().mockResolvedValue({
          url: testCase.url,
          title: "Pinterest",
          content: "Pin media",
          refCount: 1,
          warnings: []
        }),
        clonePageHtmlWithOptions: vi.fn().mockResolvedValue({
          html: "<img data-test-id=\"closeup-image-main-MainPinImage\" src=\"https://i.pinimg.com/originals/pin.jpg\">"
        }),
        capturePinterestPinMedia: vi.fn().mockResolvedValue({
          status: "captured",
          sourceUrl: testCase.url,
          targetId: "target-pin",
          kind: "image",
          path: `/tmp/primary-pin-media-${testCase.name}`,
          mediaUrl: "https://i.pinimg.com/originals/pin.jpg",
          contentType: "image/jpeg",
          naturalWidth: 1200,
          naturalHeight: 1600,
          candidateSelector: "[data-test-id='closeup-image-main-MainPinImage']",
          rejectedCandidates: []
        }),
        disconnect: vi.fn().mockResolvedValue(undefined)
      };

      await captureInspiredesignPrimaryPinMediaEvidenceFromManager(
        manager as never,
        testCase.url,
        {
          referenceId: "pin-ref",
          pinMediaEvidencePath: `/tmp/primary-pin-media-${testCase.name}`,
          browserMode: testCase.browserMode,
          cookiePolicyOverride: "off",
          challengeAutomationMode: "browser_with_helper"
        }
      );

      expect(manager.launch, testCase.name).toHaveBeenCalledTimes(1);
      expect(manager.launch, testCase.name).toHaveBeenCalledWith({
        headless: testCase.browserMode !== "extension",
        startUrl: "about:blank",
        persistProfile: false,
        noExtension: testCase.browserMode === "managed"
      }, expect.any(Number));
      expect(manager.goto, testCase.name).toHaveBeenCalledTimes(1);
      expect(manager.goto, testCase.name).toHaveBeenCalledWith(
        `session-${testCase.name}`,
        testCase.url,
        "load",
        expect.any(Number)
      );
    }
  });

		it("lets direct pin media proof override page-level Pinterest login chrome", async () => {
		const manager = {
		launch: vi.fn().mockResolvedValue({ sessionId: "session-primary-pin-media-login-shell" }),
		setSessionChallengeAutomationMode: vi.fn(),
		goto: vi.fn().mockResolvedValue(undefined),
		waitForLoad: vi.fn().mockResolvedValue(undefined),
		snapshot: vi.fn().mockResolvedValue({
		url: "https://www.pinterest.com/pin/27654985208435505/",
		title: "Log in to continue",
		content: "Log in to continue with Pinterest and sign up to save this pin",
		refCount: 1,
		warnings: []
		}),
		capturePinterestPinMedia: vi.fn().mockResolvedValue({
		status: "captured",
		sourceUrl: "https://www.pinterest.com/pin/27654985208435505/",
		targetId: "target-pin",
		kind: "image",
		path: "/tmp/primary-pin-media-login-shell",
		mediaUrl: "https://i.pinimg.com/originals/pin.jpg",
		contentType: "image/jpeg",
		naturalWidth: 1200,
		naturalHeight: 1600,
		candidateSelector: "[data-test-id='closeup-image-main-MainPinImage']",
		rejectedCandidates: []
		}),
		disconnect: vi.fn().mockResolvedValue(undefined)
	};

	const { captureInspiredesignPrimaryPinMediaEvidenceFromManager } = await import("../src/inspiredesign/capture");
	const result = await captureInspiredesignPrimaryPinMediaEvidenceFromManager(
		manager as never,
		"https://www.pinterest.com/pin/27654985208435505/",
		{
		referenceId: "pin-ref",
		pinMediaEvidencePath: "/tmp/primary-pin-media-login-shell",
		cookiePolicyOverride: "off"
		}
	);

	expect(result).toEqual(expect.objectContaining({
		status: "captured",
		pinterestPageQuality: "pin_media",
		mediaUrl: "https://i.pinimg.com/originals/pin.jpg",
		warnings: []
	}));
	expect(manager.snapshot).not.toHaveBeenCalled();
	});

	it("marks missing primary Pinterest pin media as diagnostic metadata", async () => {
	const manager = {
		launch: vi.fn().mockResolvedValue({ sessionId: "session-primary-pin-media-missing" }),
		setSessionChallengeAutomationMode: vi.fn(),
		goto: vi.fn().mockResolvedValue(undefined),
		waitForLoad: vi.fn().mockResolvedValue(undefined),
		snapshot: vi.fn().mockResolvedValue({
		url: "https://www.pinterest.com/pin/27654985208435505/",
		title: "Pinterest",
		content: "Pinterest",
		refCount: 1,
		warnings: []
		}),
		capturePinterestPinMedia: vi.fn().mockResolvedValue({
		status: "not_found",
		sourceUrl: "https://www.pinterest.com/pin/27654985208435505/",
		targetId: "target-pin",
		rejectedCandidates: [{
			kind: "image",
			mediaUrl: "https://i.pinimg.com/236x/thumb.jpg",
			reasons: ["candidate_not_main_pin_media"]
		}]
		}),
		disconnect: vi.fn().mockResolvedValue(undefined)
	};

	const { captureInspiredesignPrimaryPinMediaEvidenceFromManager } = await import("../src/inspiredesign/capture");
	const result = await captureInspiredesignPrimaryPinMediaEvidenceFromManager(
		manager as never,
		"https://www.pinterest.com/pin/27654985208435505/",
		{
		referenceId: "pin-ref",
		pinMediaEvidencePath: "/tmp/primary-pin-media-missing",
		cookiePolicyOverride: "off"
		}
	);

	expect(result).toEqual(expect.objectContaining({
		status: "skipped",
		failure: "Pinterest pin media capture did not find a primary media candidate.",
		pinterestPageQuality: "unknown",
		rejectionReasons: ["candidate_not_main_pin_media"]
	}));
	});

	it("fails primary Pinterest pin media setup when required helpers or paths are unavailable", async () => {
	const { captureInspiredesignPrimaryPinMediaEvidenceFromManager } = await import("../src/inspiredesign/capture");

	await expect(captureInspiredesignPrimaryPinMediaEvidenceFromManager(
		{} as never,
		"https://www.pinterest.com/pin/27654985208435505/",
		{ referenceId: "pin-ref", pinMediaEvidencePath: "" }
	)).resolves.toEqual(expect.objectContaining({
		status: "failed",
		failure: "Pinterest pin media evidence path was not configured.",
		rejectionReasons: ["pin_media_path_unavailable"]
	}));

	await expect(captureInspiredesignPrimaryPinMediaEvidenceFromManager(
		{} as never,
		"https://www.pinterest.com/pin/27654985208435505/",
		{ referenceId: "pin-ref", pinMediaEvidencePath: "/tmp/pin-media" }
	)).resolves.toEqual(expect.objectContaining({
		status: "failed",
		failure: "Primary media capture session helper unavailable in this execution lane.",
		warnings: ["primary_capture_session_unavailable"],
		rejectionReasons: ["primary_capture_session_unavailable"]
	}));

	await expect(captureInspiredesignPrimaryPinMediaEvidenceFromManager(
		{ launch: vi.fn() } as never,
		"https://www.pinterest.com/pin/27654985208435505/",
		{ referenceId: "pin-ref", pinMediaEvidencePath: "/tmp/pin-media" }
	)).resolves.toEqual(expect.objectContaining({
		status: "failed",
		failure: "Pinterest pin media capture helper unavailable in this execution lane.",
		warnings: ["pin_media_capture_helper_unavailable"],
		rejectionReasons: ["pin_media_capture_helper_unavailable"]
	}));
	});

	it("reports Pinterest pin media launch and capture failures as diagnostic metadata", async () => {
	const { captureInspiredesignPrimaryPinMediaEvidenceFromManager } = await import("../src/inspiredesign/capture");
	const setupFailureManager = {
		launch: vi.fn().mockRejectedValue(new Error("browser setup exploded")),
		capturePinterestPinMedia: vi.fn()
	};

	await expect(captureInspiredesignPrimaryPinMediaEvidenceFromManager(
		setupFailureManager as never,
		"https://www.pinterest.com/pin/27654985208435505/",
		{ referenceId: "pin-ref", pinMediaEvidencePath: "/tmp/pin-media" }
	)).resolves.toEqual(expect.objectContaining({
		status: "failed",
		failure: "browser setup exploded",
		warnings: ["primary_capture_setup_failed"],
		rejectionReasons: ["primary_capture_setup_failed"]
	}));

	const captureFailureManager = {
		launch: vi.fn().mockResolvedValue({ sessionId: "session-pin-capture-failure" }),
		goto: vi.fn().mockResolvedValue(undefined),
		waitForLoad: vi.fn().mockResolvedValue(undefined),
		snapshot: vi.fn().mockRejectedValue(new Error("snapshot unavailable")),
		capturePinterestPinMedia: vi.fn().mockRejectedValue(new Error("pin media failed")),
		disconnect: vi.fn().mockResolvedValue(undefined)
	};

	await expect(captureInspiredesignPrimaryPinMediaEvidenceFromManager(
		captureFailureManager as never,
		"https://www.pinterest.com/pin/27654985208435505/",
		{ referenceId: "pin-ref", pinMediaEvidencePath: "/tmp/pin-media-failure", cookiePolicyOverride: "off" }
	)).resolves.toEqual(expect.objectContaining({
		status: "failed",
		failure: "pin media failed",
		warnings: ["primary_pin_media_capture_failed"],
		rejectionReasons: ["primary_pin_media_capture_failed"]
	}));
	expect(captureFailureManager.disconnect).toHaveBeenCalledWith("session-pin-capture-failure", true);
	});

	it("demotes primary Pinterest pin media with no result path or no rejected candidates", async () => {
	const manager = {
		launch: vi.fn().mockResolvedValue({ sessionId: "session-primary-pin-media-edge" }),
		goto: vi.fn().mockResolvedValue(undefined),
		waitForLoad: vi.fn().mockResolvedValue(undefined),
		snapshot: vi.fn().mockResolvedValue({
		url: "https://www.pinterest.com/pin/27654985208435505/",
		title: "Pinterest",
		content: "Pin detail",
		refCount: 1,
		warnings: []
		}),
		capturePinterestPinMedia: vi.fn()
		.mockResolvedValueOnce({
			status: "captured",
			kind: "video_poster",
			path: "/tmp/other-pin-media",
			warnings: ["candidate_path_changed"],
			rejectedCandidates: []
		})
		.mockResolvedValueOnce({
			status: "captured",
			kind: "image",
			rejectedCandidates: []
		})
		.mockResolvedValueOnce({
			status: "not_found",
			rejectedCandidates: [],
			warnings: []
		}),
		disconnect: vi.fn().mockResolvedValue(undefined)
	};
	const { captureInspiredesignPrimaryPinMediaEvidenceFromManager } = await import("../src/inspiredesign/capture");

	await expect(captureInspiredesignPrimaryPinMediaEvidenceFromManager(
		manager as never,
		"https://www.pinterest.com/pin/27654985208435505/",
		{ referenceId: "pin-ref", pinMediaEvidencePath: "/tmp/primary-pin-media-edge", cookiePolicyOverride: "off" }
	)).resolves.toEqual(expect.objectContaining({
		status: "failed",
		kind: "video_poster",
		failure: "Pinterest pin media evidence temp path did not match the requested artifact path.",
		warnings: ["candidate_path_changed", "pin_media_temp_path_mismatch"],
		rejectionReasons: ["pin_media_temp_path_mismatch"]
	}));

	await expect(captureInspiredesignPrimaryPinMediaEvidenceFromManager(
		manager as never,
		"https://www.pinterest.com/pin/27654985208435505/",
		{ referenceId: "pin-ref", pinMediaEvidencePath: "/tmp/primary-pin-media-missing-path", cookiePolicyOverride: "off" }
	)).resolves.toEqual(expect.objectContaining({
		status: "failed",
		kind: "image",
		failure: "Pinterest pin media evidence temp path did not match the requested artifact path.",
		rejectionReasons: ["pin_media_temp_path_mismatch"]
	}));

	await expect(captureInspiredesignPrimaryPinMediaEvidenceFromManager(
		manager as never,
		"https://www.pinterest.com/pin/27654985208435505/",
		{ referenceId: "pin-ref", pinMediaEvidencePath: "/tmp/primary-pin-media-missing-fallback", cookiePolicyOverride: "off" }
	)).resolves.toEqual(expect.objectContaining({
		status: "skipped",
		rejectionReasons: ["pin_media_candidate_not_found"]
	}));
	});

	it("skips viewport probes on minimal primary Pinterest pin media captures", async () => {
	const manager = {
		launch: vi.fn().mockResolvedValue({ sessionId: "session-primary-pin-media-minimal" }),
		goto: vi.fn().mockResolvedValue(undefined),
		waitForLoad: vi.fn().mockResolvedValue(undefined),
		snapshot: vi.fn().mockResolvedValue({
		title: "Pinterest",
		content: "Pin detail",
		refCount: 1,
		warnings: []
		}),
		capturePinterestPinMedia: vi.fn().mockResolvedValue({
		status: "captured",
		path: "/tmp/primary-pin-media-minimal",
		rejectedCandidates: []
		}),
		disconnect: vi.fn().mockResolvedValue(undefined)
	};
	const { captureInspiredesignPrimaryPinMediaEvidenceFromManager } = await import("../src/inspiredesign/capture");

	await expect(captureInspiredesignPrimaryPinMediaEvidenceFromManager(
		manager as never,
		"https://www.pinterest.com/pin/27654985208435505/",
		{ referenceId: "pin-ref", pinMediaEvidencePath: "/tmp/primary-pin-media-minimal", cookiePolicyOverride: "off" }
	)).resolves.toEqual(expect.objectContaining({
		status: "captured",
		kind: "image",
		referenceId: "pin-ref",
		url: "https://www.pinterest.com/pin/27654985208435505/",
		tempPath: "/tmp/primary-pin-media-minimal",
		pinterestPageQuality: "unknown",
		warnings: [],
		rejectionReasons: []
	}));
	expect(manager.snapshot).not.toHaveBeenCalled();
	});

	it("preserves detailed primary Pinterest pin media capture metadata", async () => {
	const manager = {
		launch: vi.fn().mockResolvedValue({ sessionId: "session-primary-pin-media-detailed" }),
		goto: vi.fn().mockResolvedValue(undefined),
		waitForLoad: vi.fn().mockResolvedValue(undefined),
		snapshot: vi.fn().mockResolvedValue({
		url: "https://www.pinterest.com/pin/27654985208435505/",
		title: "Pinterest",
		content: "Pin detail",
		refCount: 1,
		warnings: []
		}),
		clonePageHtmlWithOptions: vi.fn().mockResolvedValue({
		html: "<main data-test-id=\"pin-closeup\"><img class=\"closeup-image-main-MainPinImage\" src=\"https://i.pinimg.com/originals/detail.jpg\"></main>"
		}),
		capturePinterestPinMedia: vi.fn().mockResolvedValue({
		status: "captured",
		sourceUrl: "https://www.pinterest.com/pin/27654985208435505/",
		kind: "image",
		path: "/tmp/primary-pin-media-detailed",
		mediaUrl: "https://i.pinimg.com/originals/detail.jpg",
		candidateSelector: "img[data-test-id='main-pin']",
		candidateRole: "img",
		alt: "Detailed pin media",
		width: 640,
		height: 960,
		contentType: "image/jpeg",
		warnings: ["candidate_selected_after_tie"],
		rejectedCandidates: []
		}),
		disconnect: vi.fn().mockResolvedValue(undefined)
	};
	const { captureInspiredesignPrimaryPinMediaEvidenceFromManager } = await import("../src/inspiredesign/capture");

	await expect(captureInspiredesignPrimaryPinMediaEvidenceFromManager(
		manager as never,
		"https://www.pinterest.com/pin/27654985208435505/",
		{
		referenceId: "pin-ref",
		pinMediaEvidencePath: "/tmp/primary-pin-media-detailed",
		cookiePolicyOverride: "off",
		pinterestPageQuality: "pin_media"
		}
	)).resolves.toEqual(expect.objectContaining({
		status: "captured",
		kind: "image",
		referenceId: "pin-ref",
		url: "https://www.pinterest.com/pin/27654985208435505/",
		sourceUrl: "https://www.pinterest.com/pin/27654985208435505/",
		endedSourceUrl: "https://www.pinterest.com/pin/27654985208435505/",
		mediaUrl: "https://i.pinimg.com/originals/detail.jpg",
		candidateSelector: "img[data-test-id='main-pin']",
		candidateRole: "img",
		candidateAlt: "Detailed pin media",
		width: 640,
		height: 960,
		contentType: "image/jpeg",
		tempPath: "/tmp/primary-pin-media-detailed",
		warnings: ["candidate_selected_after_tie"],
		rejectionReasons: []
	}));
	});

  it("marks primary Pinterest visual captures diagnostic when the viewport probe sees login chrome", async () => {
    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-primary-visual-login" }),
      setSessionChallengeAutomationMode: vi.fn(),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn().mockResolvedValue({
        url: "https://www.pinterest.com/pin/123/",
        title: "Log in to continue",
        content: "Log in to continue with Pinterest and sign up to save this pin",
        refCount: 1,
        warnings: []
      }),
      screenshot: vi.fn().mockResolvedValue({ path: "/tmp/primary-visual-login.png", warnings: [] }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    const { captureInspiredesignPrimaryVisualEvidenceFromManager } = await import("../src/inspiredesign/capture");
    const result = await captureInspiredesignPrimaryVisualEvidenceFromManager(
      manager as never,
      "https://www.pinterest.com/pin/123/",
      {
        visualEvidencePath: "/tmp/primary-visual-login.png",
        cookiePolicyOverride: "off"
      }
    );

    expect(result).toEqual(expect.objectContaining({
      status: "captured",
      sourceUrl: "https://www.pinterest.com/pin/123/",
      pinterestPageQuality: "login_challenge",
      warnings: ["login_or_challenge_state"]
    }));
  });

  it("marks primary Pinterest visual captures diagnostic when the viewport probe sees search chrome", async () => {
    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-primary-visual-search-shell" }),
      setSessionChallengeAutomationMode: vi.fn(),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn().mockResolvedValue({
        url: "https://www.pinterest.com/pin/456/",
        title: "Search results for couture atelier",
        content: "Related searches, pin card, browse visual ideas, and editorial references",
        refCount: 1,
        warnings: ["When autocomplete results are available"]
      }),
      screenshot: vi.fn().mockResolvedValue({ path: "/tmp/primary-visual-search-shell.png", warnings: [] }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    const { captureInspiredesignPrimaryVisualEvidenceFromManager } = await import("../src/inspiredesign/capture");
    const result = await captureInspiredesignPrimaryVisualEvidenceFromManager(
      manager as never,
      "https://www.pinterest.com/pin/456/",
      {
        visualEvidencePath: "/tmp/primary-visual-search-shell.png",
        cookiePolicyOverride: "off"
      }
    );

    expect(result).toEqual(expect.objectContaining({
      status: "captured",
      sourceUrl: "https://www.pinterest.com/pin/456/",
      pinterestPageQuality: "search_shell",
      warnings: ["interface_chrome_shell"]
    }));
  });

  it("marks primary Pinterest visual captures diagnostic for one chrome blocker marker", async () => {
    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-primary-visual-single-chrome" }),
      setSessionChallengeAutomationMode: vi.fn(),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn().mockResolvedValue({
        url: "https://www.pinterest.com/pin/457/",
        title: "Pinterest",
        content: "Accounts",
        refCount: 1,
        warnings: []
      }),
      screenshot: vi.fn().mockResolvedValue({ path: "/tmp/primary-visual-single-chrome.png", warnings: [] }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    const { captureInspiredesignPrimaryVisualEvidenceFromManager } = await import("../src/inspiredesign/capture");
    const result = await captureInspiredesignPrimaryVisualEvidenceFromManager(
      manager as never,
      "https://www.pinterest.com/pin/457/",
      {
        visualEvidencePath: "/tmp/primary-visual-single-chrome.png",
        cookiePolicyOverride: "off"
      }
    );

    expect(result).toEqual(expect.objectContaining({
      status: "captured",
      sourceUrl: "https://www.pinterest.com/pin/457/",
      pinterestPageQuality: "chrome_only",
      warnings: ["interface_chrome_shell"]
    }));
  });

  it("keeps sparse canonical Pinterest pin viewports out of pin-media authority", async () => {
    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-primary-visual-sparse-pin" }),
      setSessionChallengeAutomationMode: vi.fn(),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn().mockResolvedValue({
        url: "https://www.pinterest.com/pin/654/",
        title: "Pinterest",
        content: "Pinterest",
        refCount: 1,
        warnings: []
      }),
      screenshot: vi.fn().mockResolvedValue({ path: "/tmp/primary-visual-sparse-pin.png", warnings: [] }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    const { captureInspiredesignPrimaryVisualEvidenceFromManager } = await import("../src/inspiredesign/capture");
    const result = await captureInspiredesignPrimaryVisualEvidenceFromManager(
      manager as never,
      "https://www.pinterest.com/pin/654/",
      {
        visualEvidencePath: "/tmp/primary-visual-sparse-pin.png",
        cookiePolicyOverride: "off"
      }
    );

    expect(result).toEqual(expect.objectContaining({
      status: "captured",
      sourceUrl: "https://www.pinterest.com/pin/654/",
      pinterestPageQuality: "unknown",
      warnings: []
    }));
  });

  it("requires structural cloned media before marking primary Pinterest visual captures pin-media", async () => {
    const textOnlyManager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-primary-visual-text-only" }),
      setSessionChallengeAutomationMode: vi.fn(),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn().mockResolvedValue({
        url: "https://www.pinterest.com/pin/655/",
        title: "Pinterest video pin",
        content: "Watch this pin for cinematic studio motion",
        refCount: 1,
        warnings: []
      }),
      screenshot: vi.fn().mockResolvedValue({ path: "/tmp/primary-visual-text-only.png", warnings: [] }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };
    const structuralManager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-primary-visual-structural" }),
      setSessionChallengeAutomationMode: vi.fn(),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn().mockResolvedValue({
        url: "https://www.pinterest.com/pin/656/",
        title: "Pinterest",
        content: "Cinematic studio reference",
        refCount: 1,
        warnings: []
      }),
      clonePageHtmlWithOptions: vi.fn().mockResolvedValue({
        html: "<main><img data-test-id=\"closeup-image\" src=\"/pin.jpg\" alt=\"Cinematic studio reference\" /></main>"
      }),
      screenshot: vi.fn().mockResolvedValue({ path: "/tmp/primary-visual-structural.png", warnings: [] }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    const { captureInspiredesignPrimaryVisualEvidenceFromManager } = await import("../src/inspiredesign/capture");
    await expect(captureInspiredesignPrimaryVisualEvidenceFromManager(
      textOnlyManager as never,
      "https://www.pinterest.com/pin/655/",
      {
        visualEvidencePath: "/tmp/primary-visual-text-only.png",
        cookiePolicyOverride: "off"
      }
    )).resolves.toEqual(expect.objectContaining({
      pinterestPageQuality: "unknown"
    }));
    await expect(captureInspiredesignPrimaryVisualEvidenceFromManager(
      structuralManager as never,
      "https://www.pinterest.com/pin/656/",
      {
        visualEvidencePath: "/tmp/primary-visual-structural.png",
        cookiePolicyOverride: "off"
      }
    )).resolves.toEqual(expect.objectContaining({
      pinterestPageQuality: "pin_media"
    }));
    expect(structuralManager.clonePageHtmlWithOptions).toHaveBeenCalledWith(
      "session-primary-visual-structural",
      undefined,
      { maxNodes: 400, inlineStyles: false },
      expect.any(Number)
    );
  });

  it("keeps malformed viewport probe URLs non-authoritative without adding Pinterest warnings", async () => {
    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-primary-visual-bad-url" }),
      setSessionChallengeAutomationMode: vi.fn(),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn().mockResolvedValue({
        url: "not a url",
        title: "Log in to continue",
        content: "Search results for couture atelier",
        refCount: 1,
        warnings: []
      }),
      screenshot: vi.fn().mockResolvedValue({ path: "/tmp/primary-visual-bad-url.png", warnings: [] }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    const { captureInspiredesignPrimaryVisualEvidenceFromManager } = await import("../src/inspiredesign/capture");
    const result = await captureInspiredesignPrimaryVisualEvidenceFromManager(
      manager as never,
      "https://www.pinterest.com/pin/789/",
      {
        visualEvidencePath: "/tmp/primary-visual-bad-url.png",
        cookiePolicyOverride: "off"
      }
    );

    expect(result).toEqual(expect.objectContaining({
      status: "captured",
      sourceUrl: "not a url",
      warnings: []
    }));
  });

  it("continues primary visual capture after ignorable network idle wait failures", async () => {
    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-primary-visual-timeout" }),
      setSessionChallengeAutomationMode: vi.fn(),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockRejectedValue(new Error("Navigation wait timed out after 5000ms")),
      screenshot: vi.fn().mockResolvedValue({ path: "/tmp/primary-visual-timeout.png", warnings: [] }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    const { captureInspiredesignPrimaryVisualEvidenceFromManager } = await import("../src/inspiredesign/capture");
    const result = await captureInspiredesignPrimaryVisualEvidenceFromManager(
      manager as never,
      "https://example.com/primary-visual-timeout",
      {
        visualEvidencePath: "/tmp/primary-visual-timeout.png",
        cookiePolicyOverride: "off"
      }
    );

    expect(result).toEqual(expect.objectContaining({
      status: "captured",
      tempPath: "/tmp/primary-visual-timeout.png"
    }));
    expect(manager.screenshot).toHaveBeenCalledWith("session-primary-visual-timeout", {
      path: "/tmp/primary-visual-timeout.png",
      fullPage: false
    });
    expect(manager.disconnect).toHaveBeenCalledWith("session-primary-visual-timeout", true);
  });

  it("fails primary visual capture when network idle wait reports non-timeout errors", async () => {
    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-primary-visual-crash" }),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockRejectedValue(new Error("page crashed")),
      screenshot: vi.fn().mockResolvedValue({ path: "/tmp/primary-visual-crash.png", warnings: [] }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    const { captureInspiredesignPrimaryVisualEvidenceFromManager } = await import("../src/inspiredesign/capture");
    const result = await captureInspiredesignPrimaryVisualEvidenceFromManager(
      manager as never,
      "https://example.com/primary-visual-crash",
      {
        visualEvidencePath: "/tmp/primary-visual-crash.png",
        cookiePolicyOverride: "off"
      }
    );

    expect(result).toEqual(expect.objectContaining({
      status: "failed",
      failure: "page crashed",
      warnings: ["primary_capture_setup_failed"]
    }));
    expect(manager.screenshot).not.toHaveBeenCalled();
    expect(manager.disconnect).toHaveBeenCalledWith("session-primary-visual-crash", true);
  });

  it("returns failed primary visual evidence and disconnects when setup fails after launch", async () => {
    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-primary-setup-failure" }),
      cookieList: vi.fn().mockRejectedValue(new Error("cookie verification failed")),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      screenshot: vi.fn().mockResolvedValue({ path: "/tmp/primary-setup-failure.png", warnings: [] }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    const { captureInspiredesignPrimaryVisualEvidenceFromManager } = await import("../src/inspiredesign/capture");

    const result = await captureInspiredesignPrimaryVisualEvidenceFromManager(
      manager as never,
      "https://example.com/primary-setup-failure",
      {
        visualEvidencePath: "/tmp/primary-setup-failure.png",
        cookiePolicyOverride: "required"
      }
    );

    expect(result).toEqual(expect.objectContaining({
      status: "failed",
      failure: "cookie verification failed",
      warnings: ["primary_capture_setup_failed"]
    }));
    expect(manager.disconnect).toHaveBeenCalledWith("session-primary-setup-failure", true);
    expect(manager.goto).not.toHaveBeenCalled();
    expect(manager.screenshot).not.toHaveBeenCalled();
  });

  it("returns failed primary motion evidence and disconnects when setup fails after launch", async () => {
    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-primary-motion-setup-failure" }),
      cookieList: vi.fn().mockRejectedValue(new Error("motion cookie verification failed")),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      startScreencast: vi.fn().mockResolvedValue({ screencastId: "motion-1" }),
      stopScreencast: vi.fn().mockResolvedValue({
        endedAt: "2026-05-23T00:00:00.000Z",
        outputDir: "/tmp/motion",
        frameCount: 1,
        warnings: []
      }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    const { captureInspiredesignPrimaryMotionEvidenceFromManager } = await import("../src/inspiredesign/capture");

    const result = await captureInspiredesignPrimaryMotionEvidenceFromManager(
      manager as never,
      "https://example.com/primary-motion-setup-failure",
      {
        outputDir: "/tmp/primary-motion-setup-failure",
        cookiePolicyOverride: "required"
      }
    );

    expect(result).toEqual(expect.objectContaining({
      status: "failed",
      failure: "motion cookie verification failed",
      diagnostic: true,
      diagnosticReasons: ["primary_capture_setup_failed"]
    }));
    expect(manager.disconnect).toHaveBeenCalledWith("session-primary-motion-setup-failure", true);
    expect(manager.goto).not.toHaveBeenCalled();
    expect(manager.startScreencast).not.toHaveBeenCalled();
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

    const { captureInspiredesignReferenceFromManager } = await import("../src/inspiredesign/capture");

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

    const { captureInspiredesignReferenceFromManager } = await import("../src/inspiredesign/capture");

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
      const { captureInspiredesignReferenceFromManager } = await import("../src/inspiredesign/capture");
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
            detail: "Skipped after clone capture transport timeout."
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
      const { captureInspiredesignReferenceFromManager } = await import("../src/inspiredesign/capture");
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

    const { captureInspiredesignReferenceFromManager } = await import("../src/inspiredesign/capture");
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

    const { captureInspiredesignReferenceFromManager } = await import("../src/inspiredesign/capture");
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

  it("treats coded timeout errors as transport timeouts across capture lanes", async () => {
    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-9d" }),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn().mockResolvedValue({
        content: "capture content",
        refCount: 1,
        warnings: []
      }),
      clonePage: vi.fn().mockRejectedValue(Object.assign(new Error("socket stalled"), { code: "ETIMEDOUT" })),
      clonePageHtmlWithOptions: vi.fn().mockResolvedValue({ html: "<main>late</main>" }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    const { captureInspiredesignReferenceFromManager } = await import("../src/inspiredesign/capture");
    await expect(captureInspiredesignReferenceFromManager(
      manager as never,
      "https://example.com/transport-timeout-code",
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
          detail: "socket stalled"
        },
        dom: {
          status: "skipped",
          detail: "Skipped after clone capture transport timeout."
        }
      }
    });
    expect(manager.clonePageHtmlWithOptions).not.toHaveBeenCalled();
    expect(manager.disconnect).toHaveBeenCalledWith("session-9d", true);
  });

  it("skips remaining deep capture lanes after a snapshot deadline timeout", async () => {
    vi.useFakeTimers();

    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-9e" }),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn(() => new Promise(() => undefined)),
      clonePage: vi.fn().mockResolvedValue({
        component: "<section />",
        css: ".x{}",
        warnings: []
      }),
      clonePageHtmlWithOptions: vi.fn().mockResolvedValue({ html: "<main>late</main>" }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    try {
      const { captureInspiredesignReferenceFromManager } = await import("../src/inspiredesign/capture");
      const capturePromise = captureInspiredesignReferenceFromManager(
        manager as never,
        "https://example.com/snapshot-budget-timeout",
        { timeoutMs: 5 }
      );

      await vi.advanceTimersByTimeAsync(5);

      await expect(capturePromise).resolves.toMatchObject({
        attempts: {
          snapshot: {
            status: "failed",
            detail: "Deep capture snapshot capture exceeded timeout budget."
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
      expect(manager.disconnect).toHaveBeenCalledWith("session-9e", true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips DOM capture after a clone deadline timeout", async () => {
    vi.useFakeTimers();

    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-9f" }),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn().mockResolvedValue({
        content: "capture content",
        refCount: 1,
        warnings: []
      }),
      clonePage: vi.fn(() => new Promise(() => undefined)),
      clonePageHtmlWithOptions: vi.fn().mockResolvedValue({ html: "<main>late</main>" }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    try {
      const { captureInspiredesignReferenceFromManager } = await import("../src/inspiredesign/capture");
      const capturePromise = captureInspiredesignReferenceFromManager(
        manager as never,
        "https://example.com/clone-budget-timeout",
        { timeoutMs: 5 }
      );

      await vi.advanceTimersByTimeAsync(5);

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
            detail: "Skipped after clone capture transport timeout."
          }
        }
      });
      expect(manager.clonePageHtmlWithOptions).not.toHaveBeenCalled();
      expect(manager.disconnect).toHaveBeenCalledWith("session-9f", true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to generic snapshot failure text for non-Error capture faults", async () => {
    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-9g" }),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn().mockRejectedValue("snapshot pipe broke"),
      clonePage: vi.fn().mockResolvedValue({
        component: "<section />",
        css: ".x{}",
        warnings: []
      }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    const { captureInspiredesignReferenceFromManager } = await import("../src/inspiredesign/capture");
    await expect(captureInspiredesignReferenceFromManager(
      manager as never,
      "https://example.com/non-error-snapshot",
      { timeoutMs: 5000 }
    )).resolves.toMatchObject({
      clone: {
        componentPreview: "<section />",
        cssPreview: ".x{}"
      },
      attempts: {
        snapshot: {
          status: "failed",
          detail: "Snapshot capture failed."
        },
        clone: {
          status: "captured"
        },
        dom: {
          status: "skipped",
          detail: "DOM capture helper unavailable in this execution lane."
        }
      }
    });
    expect(manager.disconnect).toHaveBeenCalledWith("session-9g", true);
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
      const { captureInspiredesignReferenceFromManager } = await import("../src/inspiredesign/capture");
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
      const { captureInspiredesignReferenceFromManager } = await import("../src/inspiredesign/capture");

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

  it("reports unavailable primary motion helpers before launching", async () => {
    const { captureInspiredesignPrimaryMotionEvidenceFromManager } = await import("../src/inspiredesign/capture");

    await expect(captureInspiredesignPrimaryMotionEvidenceFromManager(
      { disconnect: vi.fn() } as never,
      "https://www.pinterest.com/pin/77654985208435505/",
      { outputDir: "/tmp/inspiredesign-motion" }
    )).resolves.toEqual(expect.objectContaining({
      status: "failed",
      warnings: ["screencast_helper_unavailable"],
      diagnostic: true,
      diagnosticReasons: ["screencast_helper_unavailable"]
    }));

    const managerWithoutLaunch = {
      startScreencast: vi.fn(),
      stopScreencast: vi.fn(),
      disconnect: vi.fn()
    };
    await expect(captureInspiredesignPrimaryMotionEvidenceFromManager(
      managerWithoutLaunch as never,
      "https://www.pinterest.com/pin/77654985208435505/",
      { outputDir: "/tmp/inspiredesign-motion" }
    )).resolves.toEqual(expect.objectContaining({
      status: "failed",
      warnings: ["primary_capture_session_unavailable"],
      diagnostic: true,
      diagnosticReasons: ["primary_capture_session_unavailable"]
    }));
  });

  it("reports unavailable primary visual helper sessions before screenshot capture", async () => {
    const manager = {
      screenshot: vi.fn(),
      disconnect: vi.fn()
    };
    const { captureInspiredesignPrimaryVisualEvidenceFromManager } = await import("../src/inspiredesign/capture");

    await expect(captureInspiredesignPrimaryVisualEvidenceFromManager(
      manager as never,
      "https://www.pinterest.com/pin/77654985208435505/",
      { visualEvidencePath: "/tmp/inspiredesign-visual.png" }
    )).resolves.toEqual(expect.objectContaining({
      status: "failed",
      warnings: ["primary_capture_session_unavailable"],
      failure: "Primary media capture session helper unavailable in this execution lane."
    }));
    expect(manager.screenshot).not.toHaveBeenCalled();
    expect(manager.disconnect).not.toHaveBeenCalled();
  });

  it("captures primary motion evidence success metadata for diagnostic and design-evidence screencasts", async () => {
    vi.useFakeTimers();

    const { captureInspiredesignPrimaryMotionEvidenceFromManager } = await import("../src/inspiredesign/capture");
    const diagnosticManager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-motion-zero-frame" }),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn().mockResolvedValue({
        url: "https://www.pinterest.com/pin/77654985208435505/",
        content: "Pinterest video pin",
        refCount: 1,
        warnings: []
      }),
      clonePageHtmlWithOptions: vi.fn().mockResolvedValue({
        html: "<main><video data-test-id=\"video\" src=\"/pin.mp4\"></video></main>"
      }),
      startScreencast: vi.fn().mockResolvedValue({ screencastId: "zero-frame-screencast" }),
      stopScreencast: vi.fn().mockResolvedValue({
        endedAt: "2026-05-23T00:00:00.000Z",
        manifestPath: "/tmp/inspiredesign-motion/zero-frame-replay.json",
        replayHtmlPath: "/tmp/inspiredesign-motion/zero-frame-replay.html",
        previewPath: "/tmp/inspiredesign-motion/zero-frame-preview.png",
        outputDir: "/tmp/inspiredesign-motion",
        frameCount: 0
      }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };
    const designEvidenceManager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-motion-design-evidence" }),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn().mockResolvedValue({
        url: "https://www.pinterest.com/pin/77654985208435505/",
        content: "Pinterest video pin",
        refCount: 1,
        warnings: []
      }),
      clonePageHtmlWithOptions: vi.fn().mockResolvedValue({
        html: "<main><video data-test-id=\"video\" src=\"/pin.mp4\"></video></main>"
      }),
      startScreencast: vi.fn().mockResolvedValue({ screencastId: "design-evidence-screencast" }),
      stopScreencast: vi.fn().mockResolvedValue({
        endedAt: "2026-05-23T00:00:00.000Z",
        manifestPath: "/tmp/inspiredesign-motion/design-replay.json",
        replayHtmlPath: "/tmp/inspiredesign-motion/design-replay.html",
        outputDir: "/tmp/inspiredesign-motion",
        frameCount: 2,
        warnings: ["short capture"]
      }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    try {
      const diagnosticCapture = captureInspiredesignPrimaryMotionEvidenceFromManager(
        diagnosticManager as never,
        "https://www.pinterest.com/pin/77654985208435505/",
        {
          outputDir: "/tmp/inspiredesign-motion",
          timeoutMs: 5000
        }
      );
      await vi.advanceTimersByTimeAsync(1500);
	      await expect(diagnosticCapture).resolves.toEqual(expect.objectContaining({
	        status: "captured",
	        sourceUrl: "https://www.pinterest.com/pin/77654985208435505/",
	        startedSourceUrl: "https://www.pinterest.com/pin/77654985208435505/",
	        endedSourceUrl: "https://www.pinterest.com/pin/77654985208435505/",
	        replay: { tempPath: "/tmp/inspiredesign-motion/zero-frame-replay.json" },
        replayHtml: { tempPath: "/tmp/inspiredesign-motion/zero-frame-replay.html" },
        preview: { tempPath: "/tmp/inspiredesign-motion/zero-frame-preview.png" },
        frameCount: 0,
        warnings: [],
        diagnostic: true,
        diagnosticReasons: ["zero_frame_capture"]
      }));
      expect(diagnosticManager.stopScreencast).toHaveBeenCalledWith("session-motion-zero-frame", "zero-frame-screencast");
      expect(diagnosticManager.disconnect).toHaveBeenCalledWith("session-motion-zero-frame", true);

      const designEvidenceCapture = captureInspiredesignPrimaryMotionEvidenceFromManager(
        designEvidenceManager as never,
        "https://www.pinterest.com/pin/77654985208435505/",
        {
          outputDir: "/tmp/inspiredesign-motion",
          timeoutMs: 5000
        }
      );
      await vi.advanceTimersByTimeAsync(1500);
	      await expect(designEvidenceCapture).resolves.toEqual(expect.objectContaining({
	        status: "captured",
	        sourceUrl: "https://www.pinterest.com/pin/77654985208435505/",
	        startedSourceUrl: "https://www.pinterest.com/pin/77654985208435505/",
	        endedSourceUrl: "https://www.pinterest.com/pin/77654985208435505/",
	        replay: { tempPath: "/tmp/inspiredesign-motion/design-replay.json" },
        replayHtml: { tempPath: "/tmp/inspiredesign-motion/design-replay.html" },
        frameCount: 2,
        warnings: ["short capture"],
        diagnostic: false,
        diagnosticReasons: []
      }));
      expect(await designEvidenceCapture).not.toEqual(expect.objectContaining({
        preview: expect.anything()
      }));
      expect(designEvidenceManager.stopScreencast).toHaveBeenCalledWith("session-motion-design-evidence", "design-evidence-screencast");
      expect(designEvidenceManager.disconnect).toHaveBeenCalledWith("session-motion-design-evidence", true);
    } finally {
      vi.useRealTimers();
    }
	  });

	it("marks primary motion evidence diagnostic when viewport source probes are unverified", async () => {
	vi.useFakeTimers();

	const { captureInspiredesignPrimaryMotionEvidenceFromManager } = await import("../src/inspiredesign/capture");
	const manager = {
		launch: vi.fn().mockResolvedValue({ sessionId: "session-motion-unverified-source" }),
		goto: vi.fn().mockResolvedValue(undefined),
		waitForLoad: vi.fn().mockResolvedValue(undefined),
		snapshot: vi.fn().mockResolvedValue({
		content: "outline unavailable",
		refCount: 0,
		warnings: undefined
		}),
		clonePageHtmlWithOptions: vi.fn(),
		startScreencast: vi.fn().mockResolvedValue({ screencastId: "unverified-screencast" }),
		stopScreencast: vi.fn().mockResolvedValue({
		endedAt: "2026-05-23T00:00:00.000Z",
		manifestPath: "/tmp/inspiredesign-motion/unverified-replay.json",
		replayHtmlPath: "/tmp/inspiredesign-motion/unverified-replay.html",
		outputDir: "/tmp/inspiredesign-motion",
		frameCount: 2
		}),
		disconnect: vi.fn().mockResolvedValue(undefined)
	};

	try {
		const capture = captureInspiredesignPrimaryMotionEvidenceFromManager(
		manager as never,
		"https://www.pinterest.com/pin/77654985208435505/",
		{
			outputDir: "/tmp/inspiredesign-motion",
			timeoutMs: 5000
		}
		);
		await vi.advanceTimersByTimeAsync(1500);
		await expect(capture).resolves.toEqual(expect.objectContaining({
		status: "captured",
		frameCount: 2,
		warnings: [
			"viewport_url_unverified",
			"viewport_url_unverified"
		],
		diagnostic: true,
		diagnosticReasons: ["motion_source_unverified"]
		}));
		const result = await capture;
		expect(result).not.toEqual(expect.objectContaining({ sourceUrl: expect.any(String) }));
		expect(result).not.toEqual(expect.objectContaining({ startedSourceUrl: expect.any(String) }));
		expect(result).not.toEqual(expect.objectContaining({ endedSourceUrl: expect.any(String) }));
		expect(result).not.toEqual(expect.objectContaining({ pinterestPageQuality: expect.any(String) }));
		expect(manager.clonePageHtmlWithOptions).not.toHaveBeenCalled();
		expect(manager.disconnect).toHaveBeenCalledWith("session-motion-unverified-source", true);
	} finally {
		vi.useRealTimers();
	}
	});

	  it("marks primary motion evidence diagnostic when the source changes during capture", async () => {
	    vi.useFakeTimers();

	    const { captureInspiredesignPrimaryMotionEvidenceFromManager } = await import("../src/inspiredesign/capture");
	    const manager = {
	      launch: vi.fn().mockResolvedValue({ sessionId: "session-motion-redirect" }),
	      goto: vi.fn().mockResolvedValue(undefined),
	      waitForLoad: vi.fn().mockResolvedValue(undefined),
	      snapshot: vi.fn()
	        .mockResolvedValueOnce({
	          url: "https://www.pinterest.com/pin/77654985208435505/",
	          content: "Pinterest video pin",
	          refCount: 1,
	          warnings: []
	        })
	        .mockResolvedValueOnce({
	          url: "https://www.pinterest.com/login/",
	          content: "Log in to continue",
	          refCount: 1,
	          warnings: []
	        }),
	      clonePageHtmlWithOptions: vi.fn().mockResolvedValue({
	        html: "<main><video data-test-id=\"video\" src=\"/pin.mp4\"></video></main>"
	      }),
	      startScreencast: vi.fn().mockResolvedValue({ screencastId: "redirect-screencast" }),
	      stopScreencast: vi.fn().mockResolvedValue({
	        endedAt: "2026-05-23T00:00:00.000Z",
	        manifestPath: "/tmp/inspiredesign-motion/redirect-replay.json",
	        replayHtmlPath: "/tmp/inspiredesign-motion/redirect-replay.html",
	        previewPath: "/tmp/inspiredesign-motion/redirect-preview.png",
	        outputDir: "/tmp/inspiredesign-motion",
	        frameCount: 2
	      }),
	      disconnect: vi.fn().mockResolvedValue(undefined)
	    };

	    try {
	      const capture = captureInspiredesignPrimaryMotionEvidenceFromManager(
	        manager as never,
	        "https://www.pinterest.com/pin/77654985208435505/",
	        {
	          outputDir: "/tmp/inspiredesign-motion",
	          timeoutMs: 5000
	        }
	      );
	      await vi.advanceTimersByTimeAsync(1500);
	      await expect(capture).resolves.toEqual(expect.objectContaining({
	        sourceUrl: "https://www.pinterest.com/login/",
	        startedSourceUrl: "https://www.pinterest.com/pin/77654985208435505/",
	        endedSourceUrl: "https://www.pinterest.com/login/",
	        diagnostic: true,
	diagnosticReasons: expect.arrayContaining(["motion_source_changed", "motion_source_page_quality_not_pin_media"])
	      }));
	    } finally {
	      vi.useRealTimers();
	    }
	  });

	  it("returns failed primary motion evidence when screencast stop returns no metadata", async () => {
    vi.useFakeTimers();

    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-motion-empty-stop" }),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      startScreencast: vi.fn().mockResolvedValue({ screencastId: "empty-stop-screencast" }),
      stopScreencast: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    try {
      const { captureInspiredesignPrimaryMotionEvidenceFromManager } = await import("../src/inspiredesign/capture");
      const capturePromise = captureInspiredesignPrimaryMotionEvidenceFromManager(
        manager as never,
        "https://www.pinterest.com/pin/77654985208435505/",
        {
          outputDir: "/tmp/inspiredesign-motion",
          timeoutMs: 5000
        }
      );
      await vi.advanceTimersByTimeAsync(1500);
      await expect(capturePromise).resolves.toEqual(expect.objectContaining({
        status: "failed",
        failure: "Motion evidence screencast did not return stop metadata.",
        diagnostic: true,
        diagnosticReasons: ["motion_capture_failed"]
      }));
      expect(manager.stopScreencast).toHaveBeenCalledWith("session-motion-empty-stop", "empty-stop-screencast");
      expect(manager.disconnect).toHaveBeenCalledWith("session-motion-empty-stop", true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns failed primary motion evidence when screencast startup rejects", async () => {
    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-motion-start-reject" }),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      startScreencast: vi.fn().mockRejectedValue(new Error("recorder permission denied")),
      stopScreencast: vi.fn(),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    const { captureInspiredesignPrimaryMotionEvidenceFromManager } = await import("../src/inspiredesign/capture");
    const result = await captureInspiredesignPrimaryMotionEvidenceFromManager(
      manager as never,
      "https://www.pinterest.com/pin/77654985208435505/",
      {
        outputDir: "/tmp/inspiredesign-motion",
        timeoutMs: 5000
      }
    );

    expect(result).toEqual(expect.objectContaining({
      status: "failed",
      failure: "recorder permission denied",
      diagnostic: true,
      diagnosticReasons: ["motion_capture_failed"]
    }));
    expect(manager.stopScreencast).not.toHaveBeenCalled();
    expect(manager.disconnect).toHaveBeenCalledWith("session-motion-start-reject", true);
  });

  it("bounds primary motion capture screencast startup by the capture timeout", async () => {
    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-motion-timeout" }),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      startScreencast: vi.fn(() => new Promise(() => undefined)),
      stopScreencast: vi.fn(),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    const { captureInspiredesignPrimaryMotionEvidenceFromManager } = await import("../src/inspiredesign/capture");
    const result = await captureInspiredesignPrimaryMotionEvidenceFromManager(
      manager as never,
      "https://www.pinterest.com/pin/77654985208435505/",
      {
        outputDir: "/tmp/inspiredesign-motion",
        timeoutMs: 1
      }
    );

    expect(result).toEqual(expect.objectContaining({
      status: "failed",
      failure: expect.stringContaining("primary motion capture start exceeded timeout budget"),
      diagnostic: true,
      diagnosticReasons: ["motion_capture_failed"]
    }));
    expect(manager.stopScreencast).not.toHaveBeenCalled();
    expect(manager.disconnect).toHaveBeenCalledWith("session-motion-timeout", true);
  });

  it("stops primary motion screencasts that resolve after startup timeout", async () => {
    vi.useFakeTimers();

    let resolveStart: (value: { screencastId: string }) => void;
    const startPromise = new Promise<{ screencastId: string }>((resolve) => {
      resolveStart = resolve;
    });
    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-motion-late-start" }),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      startScreencast: vi.fn(() => startPromise),
      stopScreencast: vi.fn().mockResolvedValue({
        endedAt: "2026-05-23T00:00:00.000Z",
        outputDir: "/tmp/inspiredesign-motion",
        frameCount: 1,
        warnings: []
      }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    try {
      const { captureInspiredesignPrimaryMotionEvidenceFromManager } = await import("../src/inspiredesign/capture");
      const capturePromise = captureInspiredesignPrimaryMotionEvidenceFromManager(
        manager as never,
        "https://www.pinterest.com/pin/77654985208435505/",
        {
          outputDir: "/tmp/inspiredesign-motion",
          timeoutMs: 1
        }
      );
      const assertion = expect(capturePromise).resolves.toEqual(expect.objectContaining({
        status: "failed",
        failure: expect.stringContaining("primary motion capture start exceeded timeout budget"),
        diagnostic: true,
        diagnosticReasons: ["motion_capture_failed"]
      }));
      await vi.advanceTimersByTimeAsync(1);
      await assertion;
      expect(manager.stopScreencast).not.toHaveBeenCalled();
      resolveStart!({ screencastId: "late-screencast" });
      await vi.advanceTimersByTimeAsync(0);
      expect(manager.stopScreencast).toHaveBeenCalledWith("session-motion-late-start", "late-screencast");
      expect(manager.disconnect).toHaveBeenCalledWith("session-motion-late-start", true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops primary motion screencasts when sampling exceeds the capture timeout", async () => {
    vi.useFakeTimers();

    const manager = {
      launch: vi.fn().mockResolvedValue({ sessionId: "session-motion-sampling-timeout" }),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoad: vi.fn().mockResolvedValue(undefined),
      startScreencast: vi.fn().mockResolvedValue({ screencastId: "screencast-1" }),
      stopScreencast: vi.fn().mockResolvedValue({
        endedAt: "2026-05-23T00:00:00.000Z",
        manifestPath: "/tmp/inspiredesign-motion/replay.json",
        replayHtmlPath: "/tmp/inspiredesign-motion/replay.html",
        outputDir: "/tmp/inspiredesign-motion",
        frameCount: 1,
        warnings: []
      }),
      disconnect: vi.fn().mockResolvedValue(undefined)
    };

    try {
      const { captureInspiredesignPrimaryMotionEvidenceFromManager } = await import("../src/inspiredesign/capture");
      const capturePromise = captureInspiredesignPrimaryMotionEvidenceFromManager(
        manager as never,
        "https://www.pinterest.com/pin/77654985208435505/",
        {
          outputDir: "/tmp/inspiredesign-motion",
          timeoutMs: 1
        }
      );
      const assertion = expect(capturePromise).resolves.toEqual(expect.objectContaining({
        status: "failed",
        failure: expect.stringContaining("primary motion capture sampling exceeded timeout budget"),
        diagnostic: true,
        diagnosticReasons: ["motion_capture_failed"]
      }));
      await vi.advanceTimersByTimeAsync(1);
      await assertion;
      expect(manager.stopScreencast).toHaveBeenCalledWith("session-motion-sampling-timeout", "screencast-1");
      expect(manager.disconnect).toHaveBeenCalledWith("session-motion-sampling-timeout", true);
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
      const { captureInspiredesignReferenceFromManager } = await import("../src/inspiredesign/capture");
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
