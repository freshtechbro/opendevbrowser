import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { Window } from "happy-dom";
import { resolveConfig } from "../src/config";
import { CanvasManager } from "../src/browser/canvas-manager";

const config = resolveConfig({});
const validGenerationPlan = {
  targetOutcome: { mode: "high-fi-live-edit", summary: "Exercise history and event edge branches." },
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

describe("CanvasManager edge branches", () => {
  let worktree: string;

  beforeEach(async () => {
    worktree = await mkdtemp(join(tmpdir(), "odb-canvas-edge-"));
  });

  afterEach(async () => {
    await rm(worktree, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("requires accepted plans for history commands, trims depth-limited history, and invalidates stale redo stacks", async () => {
    const manager = new CanvasManager({
      worktree,
      browserManager: {
        status: vi.fn(),
        closeTarget: vi.fn()
      } as never,
      config
    });

    const opened = await manager.execute("canvas.session.open", {}) as {
      canvasSessionId: string;
      leaseId: string;
    };

    await expect(manager.execute("canvas.history.undo", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId
    })).rejects.toThrow("generationPlan must be accepted before mutation.");
    await expect(manager.execute("canvas.history.redo", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId
    })).rejects.toThrow("generationPlan must be accepted before mutation.");

    const internal = manager as unknown as {
      sessions: Map<string, {
        history: {
          depthLimit: number;
        };
        store: {
          getDocument: () => { pages: Array<{ rootNodeId: string | null }> };
          getRevision: () => number;
          applyPatches: (baseRevision: number, patches: Array<Record<string, unknown>>) => void;
        };
      }>;
    };
    const session = internal.sessions.get(opened.canvasSessionId);
    if (!session) {
      throw new Error("Expected canvas session");
    }
    const rootNodeId = session.store.getDocument().pages[0]?.rootNodeId;
    if (!rootNodeId) {
      throw new Error("Expected root node id");
    }

    const planned = await manager.execute("canvas.plan.set", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      generationPlan: structuredClone(validGenerationPlan)
    }) as { documentRevision: number };

    session.history.depthLimit = 1;

    const firstPatch = await manager.execute("canvas.document.patch", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      baseRevision: planned.documentRevision,
      patches: [{
        op: "node.update",
        nodeId: rootNodeId,
        changes: {
          "style.backgroundColor": "#101827"
        }
      }]
    }) as { appliedRevision: number };

    await manager.execute("canvas.document.patch", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      baseRevision: firstPatch.appliedRevision,
      patches: [{
        op: "node.update",
        nodeId: rootNodeId,
        changes: {
          "style.borderRadius": "24px"
        }
      }]
    });

    await expect(manager.execute("canvas.session.status", {
      canvasSessionId: opened.canvasSessionId
    })).resolves.toMatchObject({
      history: {
        undoDepth: 1,
        redoDepth: 0,
        stale: false,
        depthLimit: 1
      }
    });

    const undone = await manager.execute("canvas.history.undo", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId
    }) as {
      ok: boolean;
      summary: { history: Record<string, unknown> };
    };
    expect(undone.ok).toBe(true);
    expect(undone.summary.history).toMatchObject({
      undoDepth: 0,
      redoDepth: 1,
      stale: false
    });

    session.store.applyPatches(session.store.getRevision(), [{
      op: "node.update",
      nodeId: rootNodeId,
      changes: {
        "style.borderColor": "#f8fafc"
      }
    }]);

    await expect(manager.execute("canvas.session.status", {
      canvasSessionId: opened.canvasSessionId
    })).resolves.toMatchObject({
      history: {
        canUndo: false,
        canRedo: false,
        undoDepth: 0,
        redoDepth: 1,
        stale: true
      }
    });

    await expect(manager.execute("canvas.history.redo", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId
    })).resolves.toMatchObject({
      ok: false,
      reason: "history_invalidated",
      summary: {
        history: {
          undoDepth: 0,
          redoDepth: 0,
          stale: false
        }
      }
    });
  });

  it("skips design and prototype-less preview targets and reports string render failures", async () => {
    const manager = new CanvasManager({
      worktree,
      browserManager: {
        status: vi.fn(),
        closeTarget: vi.fn()
      } as never,
      config
    });

    const opened = await manager.execute("canvas.session.open", {
      browserSessionId: "browser-preview-sync"
    }) as {
      canvasSessionId: string;
      leaseId: string;
    };

    await manager.execute("canvas.plan.set", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      generationPlan: structuredClone(validGenerationPlan)
    });

    const internal = manager as unknown as {
      sessions: Map<string, {
        designTabTargetId: string | null;
        activeTargets: Map<string, { targetId: string; prototypeId: string | null }>;
      }>;
      syncPreviewTargets: (session: unknown, source: "editor" | "agent") => Promise<void>;
      renderPreviewTarget: (session: unknown, targetId: string, prototypeId: string, options: Record<string, unknown>) => Promise<unknown>;
    };
    const session = internal.sessions.get(opened.canvasSessionId);
    if (!session) {
      throw new Error("Expected canvas session");
    }

    session.designTabTargetId = "tab-design";
    session.activeTargets.set("tab-design", {
      targetId: "tab-design",
      prototypeId: "proto_home_default"
    });
    session.activeTargets.set("tab-missing-prototype", {
      targetId: "tab-missing-prototype",
      prototypeId: ""
    });
    session.activeTargets.set("tab-preview", {
      targetId: "tab-preview",
      prototypeId: "proto_home_default"
    });

    const renderPreviewTarget = vi.spyOn(internal, "renderPreviewTarget").mockRejectedValueOnce("preview sync string failure");
    await internal.syncPreviewTargets(session, "editor");

    expect(renderPreviewTarget).toHaveBeenCalledTimes(1);
    expect(renderPreviewTarget).toHaveBeenCalledWith(
      session,
      "tab-preview",
      "proto_home_default",
      expect.objectContaining({
        cause: "patch_sync",
        source: "editor",
        syncAfter: false
      })
    );
    await expect(manager.execute("canvas.feedback.poll", {
      canvasSessionId: opened.canvasSessionId,
      categories: ["render"]
    })).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          class: "preview-sync-failed",
          message: "preview sync string failure",
          targetId: "tab-preview"
        })
      ])
    });
  });

  it("covers canvas-event no-op guards and complementary viewport fallback branches", async () => {
    const manager = new CanvasManager({
      worktree,
      browserManager: {
        status: vi.fn(),
        closeTarget: vi.fn()
      } as never,
      config
    });

    const opened = await manager.execute("canvas.session.open", {}) as {
      canvasSessionId: string;
      leaseId: string;
    };

    await manager.execute("canvas.plan.set", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      generationPlan: structuredClone(validGenerationPlan)
    });

    const internal = manager as unknown as {
      sessions: Map<string, {
        editorViewport: { x: number; y: number; zoom: number };
        store: { getRevision: () => number };
        feedback: Array<{ class: string }>;
      }>;
      handleCanvasEvent: (event: { event: string; canvasSessionId?: string; payload?: unknown }) => Promise<void>;
      applyDocumentPatches: (session: unknown, baseRevision: number, patches: Array<Record<string, unknown>>, source: string, options?: Record<string, unknown>) => Promise<{ appliedRevision: number }>;
    };
    const session = internal.sessions.get(opened.canvasSessionId);
    if (!session) {
      throw new Error("Expected canvas session");
    }

    session.editorViewport = { x: 11, y: 22, zoom: 0.9 };
    const applyDocumentPatches = vi.spyOn(internal, "applyDocumentPatches").mockResolvedValue({
      appliedRevision: session.store.getRevision()
    });

    await internal.handleCanvasEvent({ event: "canvas_patch_requested" });
    await internal.handleCanvasEvent({
      event: "canvas_status",
      canvasSessionId: opened.canvasSessionId,
      payload: {}
    });
    expect(applyDocumentPatches).not.toHaveBeenCalled();

    await internal.handleCanvasEvent({
      event: "canvas_patch_requested",
      canvasSessionId: opened.canvasSessionId,
      payload: {
        baseRevision: session.store.getRevision(),
        patches: [],
        viewport: {
          x: "bad",
          y: 72,
          zoom: 1.5
        }
      }
    });

    expect(applyDocumentPatches).toHaveBeenCalledTimes(1);
    expect(session.editorViewport).toEqual({
      x: 11,
      y: 72,
      zoom: 1.5
    });
    expect(session.feedback.some((item) => item.class === "editor-patch-rejected")).toBe(false);
  });

  it("syncs direct overlays across existing, highlighted, and incomplete overlay roots", async () => {
    const window = new Window();
    vi.stubGlobal("document", window.document);
    vi.stubGlobal("HTMLElement", window.HTMLElement);

    const browserManager = {
      withPage: vi.fn().mockImplementation(async (_sessionId: string, _targetId: string, fn: (page: {
        addStyleTag: (input: { content: string }) => Promise<void>;
        evaluate: (pageFunction: (arg: unknown) => unknown, arg: unknown) => Promise<unknown>;
      }) => Promise<unknown>) => {
        return await fn({
          addStyleTag: vi.fn().mockResolvedValue(undefined),
          evaluate: vi.fn(async (pageFunction: (arg: unknown) => unknown, arg: unknown) => await pageFunction(arg))
        });
      })
    };

    const manager = new CanvasManager({
      worktree,
      browserManager: browserManager as never,
      config
    });

    const internal = manager as unknown as {
      syncDirectOverlay: (
        sessionId: string,
        mountId: string,
        targetId: string,
        title: string,
        selection: { pageId: string | null; nodeId: string | null; targetId: string | null; updatedAt?: string | null }
      ) => Promise<void>;
    };

    window.document.body.innerHTML = [
      '<div id="mount-overlay"><strong>Old Heading</strong><div>Old Title</div><div>Old Selection</div></div>',
      '<div data-node-id="node_alpha"></div>'
    ].join("");

    await internal.syncDirectOverlay("browser-overlay", "mount-overlay", "tab-preview", "Overlay Title", {
      pageId: "page_home",
      nodeId: null,
      targetId: "tab-preview",
      updatedAt: null
    });
    expect(window.document.getElementById("mount-overlay")?.textContent).toContain("Canvas overlay synced");

    await internal.syncDirectOverlay("browser-overlay", "mount-overlay", "tab-preview", "Overlay Title", {
      pageId: "page_home",
      nodeId: "node_alpha",
      targetId: "tab-preview",
      updatedAt: null
    });
    expect(window.document.getElementById("mount-overlay")?.textContent).toContain("Selected node_alpha");
    expect(window.document.querySelector('[data-node-id="node_alpha"]')?.className).toContain("opendevbrowser-canvas-highlight");

    window.document.getElementById("mount-overlay")!.innerHTML = "<strong>Heading Only</strong>";
    await expect(internal.syncDirectOverlay("browser-overlay", "mount-overlay", "tab-preview", "Overlay Title", {
      pageId: "page_home",
      nodeId: "node_missing",
      targetId: "tab-preview",
      updatedAt: null
    })).resolves.toBeUndefined();
  });
});
