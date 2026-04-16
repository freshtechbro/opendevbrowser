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
      Number.POSITIVE_INFINITY
    );

    expect(manager.goto).toHaveBeenCalledWith("session-1", "https://example.com/reference", "load", 30000);
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
      -10
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
      "https://example.com/dom"
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
      "https://example.com/empty-html"
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
});
