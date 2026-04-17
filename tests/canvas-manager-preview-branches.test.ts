import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { resolveConfig } from "../src/config";

const config = resolveConfig({});
const validGenerationPlan = {
  targetOutcome: { mode: "high-fi-live-edit", summary: "Exercise runtime preview branches." },
  visualDirection: { profile: "clean-room", themeStrategy: "single-theme" },
  layoutStrategy: { approach: "hero-led-grid", navigationModel: "global-header" },
  contentStrategy: { source: "document-context" },
  componentStrategy: { mode: "reuse-first", interactionStates: ["default", "hover", "focus", "disabled"] },
  motionPosture: { level: "subtle", reducedMotion: "respect-user-preference" },
  responsivePosture: { primaryViewport: "desktop", requiredViewports: ["desktop", "tablet", "mobile"] },
  accessibilityPosture: { target: "WCAG_2_2_AA", keyboardNavigation: "full" },
  validationTargets: {
    blockOn: ["contrast-failure"],
    requiredThemes: ["light"],
    browserValidation: "required",
    maxInteractionLatencyMs: 150
  }
};

async function loadCanvasManager(
  exportOverrides: Partial<typeof import("../src/canvas/export")> = {}
): Promise<typeof import("../src/browser/canvas-manager")> {
  vi.resetModules();
  vi.doMock("../src/canvas/export", async () => {
    const actual = await vi.importActual<typeof import("../src/canvas/export")>("../src/canvas/export");
    return {
      ...actual,
      ...exportOverrides
    };
  });
  return await import("../src/browser/canvas-manager");
}

describe("CanvasManager runtime preview branches", () => {
  let worktree: string;

  beforeEach(async () => {
    worktree = await mkdtemp(join(tmpdir(), "odb-canvas-runtime-"));
  });

  afterEach(async () => {
    await rm(worktree, { recursive: true, force: true });
    vi.doUnmock("../src/canvas/export");
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("falls back to canvas_html when runtime binding html cannot be rendered", async () => {
    const { CanvasManager } = await loadCanvasManager({
      renderCanvasBindingHtml: vi.fn(() => null)
    });
    const sourcePath = join(worktree, "RuntimeBindingMissing.tsx");
    await writeFile(sourcePath, "export function RuntimeBindingMissing() { return <section />; }\n");

    const browserManager = {
      status: vi.fn().mockResolvedValue({
        mode: "managed",
        activeTargetId: "tab-preview",
        url: "https://example.com/app",
        title: "App"
      }),
      goto: vi.fn().mockResolvedValue({ finalUrl: "https://example.com/", status: 200, timingMs: 5 }),
      screenshot: vi.fn().mockResolvedValue({ path: undefined }),
      perfMetrics: vi.fn().mockResolvedValue({ metrics: [] }),
      consolePoll: vi.fn().mockResolvedValue({ events: [], nextSeq: 0 }),
      networkPoll: vi.fn().mockResolvedValue({ events: [], nextSeq: 0 }),
      applyRuntimePreviewBridge: vi.fn()
    };

    const manager = new CanvasManager({
      worktree,
      browserManager: browserManager as never,
      config
    });

    const opened = await manager.execute("canvas.session.open", {
      browserSessionId: "browser-runtime-no-html"
    }) as { canvasSessionId: string; leaseId: string; documentId: string };
    const loaded = await manager.execute("canvas.document.load", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      documentId: opened.documentId
    }) as { document: { pages: Array<{ rootNodeId: string | null }> } };

    await manager.execute("canvas.plan.set", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      generationPlan: structuredClone(validGenerationPlan)
    });
    await manager.execute("canvas.code.bind", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      nodeId: loaded.document.pages[0]?.rootNodeId,
      bindingId: "binding_runtime_no_html",
      repoPath: sourcePath,
      exportName: "RuntimeBindingMissing",
      projection: "bound_app_runtime",
      runtimeRootSelector: "#runtime-root"
    });

    await expect(manager.execute("canvas.preview.render", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      targetId: "tab-preview",
      prototypeId: "proto_home_default"
    })).resolves.toMatchObject({
      renderStatus: "rendered",
      previewState: "focused"
    });

    expect(browserManager.applyRuntimePreviewBridge).not.toHaveBeenCalled();
    expect(String(browserManager.goto.mock.calls.at(-1)?.[1])).toContain("data:text/html");
    await expect(manager.execute("canvas.feedback.poll", {
      canvasSessionId: opened.canvasSessionId,
      categories: ["render"]
    })).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          class: "render-complete",
          details: expect.objectContaining({
            projection: "canvas_html",
            fallbackReason: "runtime_projection_unsupported"
          })
        })
      ])
    });
  });

  it("records runtime bridge failures when applyRuntimePreviewBridge throws a non-Error value", async () => {
    const { CanvasManager } = await loadCanvasManager();
    const sourcePath = join(worktree, "RuntimeBridgeFailure.tsx");
    await writeFile(sourcePath, "export function RuntimeBridgeFailure() { return <section>Runtime</section>; }\n");

    const browserManager = {
      status: vi.fn().mockResolvedValue({
        mode: "managed",
        activeTargetId: "tab-preview",
        url: "https://example.com/app",
        title: "App"
      }),
      goto: vi.fn().mockResolvedValue({ finalUrl: "https://example.com/", status: 200, timingMs: 5 }),
      screenshot: vi.fn().mockResolvedValue({ path: undefined }),
      perfMetrics: vi.fn().mockResolvedValue({ metrics: [] }),
      consolePoll: vi.fn().mockResolvedValue({ events: [], nextSeq: 0 }),
      networkPoll: vi.fn().mockResolvedValue({ events: [], nextSeq: 0 }),
      applyRuntimePreviewBridge: vi.fn().mockRejectedValue("bridge string failure")
    };

    const manager = new CanvasManager({
      worktree,
      browserManager: browserManager as never,
      config
    });

    const opened = await manager.execute("canvas.session.open", {
      browserSessionId: "browser-runtime-throw"
    }) as { canvasSessionId: string; leaseId: string; documentId: string };
    const loaded = await manager.execute("canvas.document.load", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      documentId: opened.documentId
    }) as { document: { pages: Array<{ rootNodeId: string | null }> } };

    await manager.execute("canvas.plan.set", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      generationPlan: structuredClone(validGenerationPlan)
    });
    await manager.execute("canvas.code.bind", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      nodeId: loaded.document.pages[0]?.rootNodeId,
      bindingId: "binding_runtime_throw",
      repoPath: sourcePath,
      exportName: "RuntimeBridgeFailure",
      projection: "bound_app_runtime",
      runtimeRootSelector: "#runtime-root"
    });

    await expect(manager.execute("canvas.preview.render", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      targetId: "tab-preview",
      prototypeId: "proto_home_default"
    })).resolves.toMatchObject({
      renderStatus: "rendered",
      previewState: "focused"
    });

    expect(String(browserManager.goto.mock.calls.at(-1)?.[1])).toContain("data:text/html");
    const feedback = await manager.execute("canvas.feedback.poll", {
      canvasSessionId: opened.canvasSessionId,
      categories: ["parity", "render"]
    }) as {
      items: Array<{ class: string; message: string; details?: { fallbackReason?: string | null; projection?: string } }>;
    };
    expect(feedback.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        class: "runtime-preview-bridge-failed",
        message: "bridge string failure"
      }),
      expect.objectContaining({
        class: "render-complete",
        details: expect.objectContaining({
          projection: "canvas_html",
          fallbackReason: "runtime_projection_failed"
        })
      })
    ]));
  });

  it("uses the browser-manager runtime bridge when it succeeds without the withPage fallback", async () => {
    const { CanvasManager } = await loadCanvasManager();
    const sourcePath = join(worktree, "RuntimeBridgeDirect.tsx");
    await writeFile(sourcePath, "export function RuntimeBridgeDirect() { return <section>Runtime</section>; }\n");

    const browserManager = {
      status: vi.fn().mockResolvedValue({
        mode: "managed",
        activeTargetId: "tab-preview",
        url: "https://example.com/app",
        title: "App"
      }),
      goto: vi.fn().mockResolvedValue({ finalUrl: "https://example.com/", status: 200, timingMs: 5 }),
      screenshot: vi.fn().mockResolvedValue({ path: undefined }),
      perfMetrics: vi.fn().mockResolvedValue({ metrics: [] }),
      consolePoll: vi.fn().mockResolvedValue({ events: [], nextSeq: 0 }),
      networkPoll: vi.fn().mockResolvedValue({ events: [], nextSeq: 0 }),
      withPage: vi.fn(),
      applyRuntimePreviewBridge: vi.fn().mockResolvedValue({
        ok: true,
        artifact: {
          projection: "bound_app_runtime",
          rootBindingId: "binding_runtime_direct",
          capturedAt: new Date().toISOString(),
          hierarchyHash: "hash",
          nodes: []
        }
      })
    };

    const manager = new CanvasManager({
      worktree,
      browserManager: browserManager as never,
      config
    });

    const opened = await manager.execute("canvas.session.open", {
      browserSessionId: "browser-runtime-direct"
    }) as { canvasSessionId: string; leaseId: string; documentId: string };
    const loaded = await manager.execute("canvas.document.load", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      documentId: opened.documentId
    }) as { document: { pages: Array<{ rootNodeId: string | null }> } };

    await manager.execute("canvas.plan.set", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      generationPlan: structuredClone(validGenerationPlan)
    });
    await manager.execute("canvas.code.bind", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      nodeId: loaded.document.pages[0]?.rootNodeId,
      bindingId: "binding_runtime_direct",
      repoPath: sourcePath,
      exportName: "RuntimeBridgeDirect",
      projection: "bound_app_runtime",
      runtimeRootSelector: "#runtime-root"
    });

    const rendered = await manager.execute("canvas.preview.render", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      targetId: "tab-preview",
      prototypeId: "proto_home_default"
    }) as {
      renderStatus: string;
      previewState: string;
    };

    expect(rendered).toMatchObject({
      renderStatus: "rendered",
      previewState: "focused"
    });
    expect(browserManager.applyRuntimePreviewBridge).toHaveBeenCalledWith("browser-runtime-direct", "tab-preview", expect.objectContaining({
      bindingId: "binding_runtime_direct",
      rootSelector: "#runtime-root"
    }));
    expect(browserManager.withPage).not.toHaveBeenCalled();

    await expect(manager.execute("canvas.feedback.poll", {
      canvasSessionId: opened.canvasSessionId,
      categories: ["render"]
    })).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          class: "render-complete",
          details: expect.objectContaining({
            projection: "bound_app_runtime",
            fallbackReason: null
          })
        })
      ])
    });
  });
});
