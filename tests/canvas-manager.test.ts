import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { Window } from "happy-dom";
import { resolveConfig } from "../src/config";
import { CANVAS_PROJECT_DEFAULTS, createDefaultCanvasDocument } from "../src/canvas/document-store";
import { saveCanvasDocument } from "../src/canvas/repo-store";

const canvasClientConnectMock = vi.fn().mockResolvedValue({
  type: "canvas_hello_ack",
  version: "1",
  maxPayloadBytes: 1024,
  capabilities: []
});
const canvasClientDisconnectMock = vi.fn();
const canvasClientRequestMock = vi.fn();
const resolveRelayEndpointMock = vi.fn().mockResolvedValue({
  connectEndpoint: "ws://127.0.0.1:8787/canvas?token=test"
});

vi.mock("../src/browser/canvas-client", () => ({
  CanvasClient: class {
    url: string;
    constructor(url: string) {
      this.url = url;
    }
    async connect() {
      return await canvasClientConnectMock();
    }
    async request(...args: unknown[]) {
      return await canvasClientRequestMock(...args);
    }
    disconnect() {
      canvasClientDisconnectMock();
    }
  }
}));

vi.mock("../src/relay/relay-endpoints", () => ({
  resolveRelayEndpoint: (...args: unknown[]) => resolveRelayEndpointMock(...args)
}));

import { CanvasManager } from "../src/browser/canvas-manager";

const config = resolveConfig({});
const validGenerationPlan = {
  targetOutcome: { mode: "high-fi-live-edit", summary: "Refine the canvas." },
  visualDirection: { profile: "clean-room" },
  layoutStrategy: { approach: "hero-led-grid" },
  contentStrategy: { source: "document-context" },
  componentStrategy: { mode: "reuse-first" },
  motionPosture: { level: "subtle" },
  responsivePosture: { primaryViewport: "desktop" },
  accessibilityPosture: { target: "WCAG_2_2_AA" },
  validationTargets: { blockOn: ["contrast-failure"] }
};

const governanceBootstrapPatches = [
  { op: "governance.update", block: "intent", changes: { summary: "Canvas-managed landing page refresh" } },
  { op: "governance.update", block: "designLanguage", changes: { profile: "clean-room" } },
  { op: "governance.update", block: "contentModel", changes: { requiredStates: ["default", "loading", "empty", "error"] } },
  { op: "governance.update", block: "layoutSystem", changes: { grid: { columns: 12, gutter: 24 } } },
  { op: "governance.update", block: "typographySystem", changes: { hierarchy: { display: "display-01" }, fontPolicy: { primary: "Local Sans" } } },
  { op: "governance.update", block: "colorSystem", changes: { roles: { primary: "#0055ff" } } },
  { op: "governance.update", block: "surfaceSystem", changes: { panels: { elevation: "medium" } } },
  { op: "governance.update", block: "iconSystem", changes: { primary: "tabler" } },
  { op: "governance.update", block: "motionSystem", changes: { reducedMotion: "respect-user-preference" } },
  { op: "governance.update", block: "responsiveSystem", changes: { breakpoints: { mobile: 390, tablet: 1024, desktop: 1440 } } },
  { op: "governance.update", block: "accessibilityPolicy", changes: { reducedMotion: "respect-user-preference" } },
  { op: "governance.update", block: "libraryPolicy", changes: { icons: ["tabler"], components: ["shadcn"], styling: ["tailwindcss"], motion: [], threeD: [] } },
  {
    op: "governance.update",
    block: "runtimeBudgets",
    changes: {
      defaultLivePreviewLimit: 2,
      maxPinnedFullPreviewExtra: 1,
      reconnectGraceMs: 20000,
      overflowRenderMode: "thumbnail_only",
      backgroundTelemetryMode: "sampled"
    }
  }
] as const;

function countOccurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

type FakeClassList = {
  add: (name: string) => void;
  remove: (name: string) => void;
};

class FakeHTMLElement {
  id = "";
  className = "";
  innerHTML = "";
  textContent = "";
  children: FakeHTMLElement[] = [];
  removed = false;
  constructor(
    public readonly tagName: string,
    private readonly onClassChange: (element: FakeHTMLElement, className: string, adding: boolean) => void
  ) {}
  get classList(): FakeClassList {
    return {
      add: (name: string) => {
        this.className = [this.className, name].filter(Boolean).join(" ").trim();
        this.onClassChange(this, name, true);
      },
      remove: (name: string) => {
        this.className = this.className
          .split(/\s+/)
          .filter((part) => part && part !== name)
          .join(" ");
        this.onClassChange(this, name, false);
      }
    };
  }
  append(...children: FakeHTMLElement[]): void {
    this.children.push(...children);
  }
  remove(): void {
    this.removed = true;
  }
  get innerText(): string {
    return this.textContent || this.innerHTML.replace(/<[^>]+>/g, " ").trim();
  }
}

const createDomHarness = () => {
  const highlights = new Set<FakeHTMLElement>();
  const byId = new Map<string, FakeHTMLElement>();
  const queryMap = new Map<string, FakeHTMLElement>();
  const trackClassChange = (element: FakeHTMLElement, className: string, adding: boolean) => {
    if (className === "opendevbrowser-canvas-highlight") {
      if (adding) {
        highlights.add(element);
      } else {
        highlights.delete(element);
      }
    }
  };
  const body = new FakeHTMLElement("BODY", trackClassChange);
  body.append = (...children: FakeHTMLElement[]) => {
    for (const child of children) {
      if (child.id) {
        byId.set(child.id, child);
      }
    }
    FakeHTMLElement.prototype.append.call(body, ...children);
  };
  const documentStub = {
    title: "Canvas Preview",
    body,
    getElementById: (id: string) => byId.get(id) ?? null,
    createElement: (tagName: string) => new FakeHTMLElement(tagName.toUpperCase(), trackClassChange),
    querySelectorAll: (selector: string) => selector === ".opendevbrowser-canvas-highlight" ? [...highlights] : [],
    querySelector: (selector: string) => queryMap.get(selector) ?? null
  };
  return {
    documentStub,
    registerSelector(selector: string, element: FakeHTMLElement) {
      queryMap.set(selector, element);
    }
  };
};

const decodeDataUrl = (value: string): string => {
  const prefix = "data:text/html;charset=utf-8,";
  if (!value.startsWith(prefix)) {
    throw new Error(`Expected HTML data URL, received: ${value}`);
  }
  return decodeURIComponent(value.slice(prefix.length));
};

describe("CanvasManager", () => {
  let worktree: string;

  beforeEach(async () => {
    worktree = await mkdtemp(join(tmpdir(), "odb-canvas-manager-"));
  });

  afterEach(async () => {
    await rm(worktree, { recursive: true, force: true });
    canvasClientConnectMock.mockClear();
    canvasClientDisconnectMock.mockClear();
    canvasClientRequestMock.mockReset();
    resolveRelayEndpointMock.mockClear();
    vi.unstubAllGlobals();
  });

  it("runs the managed canvas flow end to end", async () => {
    const dom = createDomHarness();
    vi.stubGlobal("document", dom.documentStub);
    vi.stubGlobal("HTMLElement", FakeHTMLElement);

    const selectable = new FakeHTMLElement("DIV", () => {});
    selectable.id = "hero";
    selectable.textContent = "Primary hero copy";
    dom.registerSelector("#hero", selectable);

    const browserManager = {
      status: vi.fn().mockResolvedValue({
        mode: "managed",
        activeTargetId: "tab-preview",
        url: "https://example.com/app",
        title: "App"
      }),
      page: vi.fn().mockResolvedValue({
        targetId: "tab-design",
        created: true,
        url: "data:text/html,canvas",
        title: "Canvas"
      }),
      closeTarget: vi.fn().mockResolvedValue(undefined),
      goto: vi.fn().mockResolvedValue({ finalUrl: "https://example.com/", status: 200, timingMs: 5 }),
      screenshot: vi.fn().mockResolvedValue({ path: join(worktree, "preview.png") }),
      perfMetrics: vi.fn().mockResolvedValue({ metrics: [{ name: "ScriptDuration", value: 12 }] }),
      consolePoll: vi.fn().mockResolvedValue({ events: [{ level: "warn", text: "warn" }], nextSeq: 1 }),
      networkPoll: vi.fn().mockResolvedValue({ events: [{ status: 500, url: "https://example.com/api" }], nextSeq: 1 }),
      withPage: vi.fn().mockImplementation(async (_sessionId: string, _targetId: string | null, fn: (page: unknown) => Promise<unknown>) => {
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

    const opened = await manager.execute("canvas.session.open", {
      browserSessionId: "browser-managed"
    }) as Record<string, unknown>;
    const canvasSessionId = opened.canvasSessionId as string;
    const leaseId = opened.leaseId as string;
    const documentId = opened.documentId as string;
    expect(opened.allowedLibraries).toEqual(CANVAS_PROJECT_DEFAULTS.libraryPolicy);

    await expect(manager.execute("canvas.document.patch", {
      canvasSessionId,
      leaseId,
      baseRevision: 1,
      patches: []
    })).rejects.toThrow("generationPlan must be accepted");

    const loaded = await manager.execute("canvas.document.load", {
      canvasSessionId,
      leaseId,
      documentId
    }) as { document: { pages: Array<{ rootNodeId: string | null }> } };
    const rootNodeId = loaded.document.pages[0]?.rootNodeId;
    expect(rootNodeId).toBeTruthy();

    const planResult = await manager.execute("canvas.plan.set", {
      canvasSessionId,
      leaseId,
      generationPlan: {
        targetOutcome: { mode: "high-fi-live-edit", summary: "Refine hero." },
        visualDirection: { profile: "clean-room" },
        layoutStrategy: { approach: "hero-led-grid" },
        contentStrategy: { source: "document-context" },
        componentStrategy: { mode: "reuse-first" },
        motionPosture: { level: "subtle" },
        responsivePosture: { primaryViewport: "desktop" },
        accessibilityPosture: { target: "WCAG_2_2_AA" },
        validationTargets: { blockOn: ["contrast-failure"] }
      }
    }) as Record<string, unknown>;
    expect(planResult.planStatus).toBe("accepted");

    const patchResult = await manager.execute("canvas.document.patch", {
      canvasSessionId,
      leaseId,
      baseRevision: planResult.documentRevision,
      patches: [
        ...governanceBootstrapPatches,
        {
          op: "node.insert",
          pageId: "page_home",
          parentId: rootNodeId,
          node: {
            id: "node_copy",
            kind: "text",
            name: "Copy",
            props: { text: "Design canvas" }
          }
        },
        {
          op: "node.update",
          nodeId: "node_copy",
          changes: {
            "props.text": "Design canvas ready",
            "style.color": "#20d5c6"
          }
        }
      ]
    }) as Record<string, unknown>;
    expect(patchResult.appliedRevision).toBe(Number(planResult.documentRevision) + 1);

    const saveResult = await manager.execute("canvas.document.save", {
      canvasSessionId,
      leaseId,
      repoPath: ".opendevbrowser/canvas/documents/test-managed.json"
    }) as Record<string, unknown>;
    expect(String(saveResult.repoPath)).toContain("test-managed.json");

    const htmlExport = await manager.execute("canvas.document.export", {
      canvasSessionId,
      leaseId,
      exportTarget: "html_bundle"
    }) as { artifactRefs: string[] };
    expect(htmlExport.artifactRefs[0]).toContain(".html");

    const componentExport = await manager.execute("canvas.document.export", {
      canvasSessionId,
      leaseId,
      exportTarget: "react_component"
    }) as { artifactRefs: string[] };
    expect(componentExport.artifactRefs[0]).toContain(".tsx");

    const designTab = await manager.execute("canvas.tab.open", {
      canvasSessionId,
      leaseId,
      prototypeId: "proto_home_default",
      previewMode: "focused"
    }) as Record<string, unknown>;
    expect(designTab.targetId).toBe("tab-design");

    const overlay = await manager.execute("canvas.overlay.mount", {
      canvasSessionId,
      leaseId,
      targetId: "tab-preview",
      prototypeId: "proto_home_default"
    }) as Record<string, unknown>;
    expect(overlay.previewState).toBe("background");
    expect(overlay.overlayState).toBe("mounted");

    const selection = await manager.execute("canvas.overlay.select", {
      canvasSessionId,
      leaseId,
      mountId: overlay.mountId,
      targetId: "tab-preview",
      selectionHint: { selector: "#hero" }
    }) as { selection: { matched: boolean; selector: string } };
    expect(selection.selection.matched).toBe(true);
    expect(selection.selection.selector).toBe("#hero");

    const preview = await manager.execute("canvas.preview.render", {
      canvasSessionId,
      leaseId,
      targetId: "tab-preview",
      prototypeId: "proto_home_default"
    }) as Record<string, unknown>;
    expect(preview.renderStatus).toBe("rendered");
    expect(browserManager.screenshot).toHaveBeenCalledWith("browser-managed", undefined, "tab-preview");

    const feedback = await manager.execute("canvas.feedback.poll", {
      canvasSessionId,
      afterCursor: null
    }) as { items: Array<{ category: string }>; nextCursor: string | null };
    expect(feedback.items.map((item) => item.category)).toEqual(expect.arrayContaining(["console", "network", "performance", "render"]));
    expect(feedback.nextCursor).toBeTruthy();

    const refreshed = await manager.execute("canvas.preview.refresh", {
      canvasSessionId,
      leaseId,
      targetId: "tab-preview",
      refreshMode: "thumbnail"
    }) as Record<string, unknown>;
    expect(refreshed.targetId).toBe("tab-preview");

    const subscribed = await manager.execute("canvas.feedback.subscribe", {
      canvasSessionId
    }) as Record<string, unknown>;
    expect(String(subscribed.subscriptionId)).toContain("canvas_sub_");

    await manager.execute("canvas.overlay.unmount", {
      canvasSessionId,
      leaseId,
      mountId: overlay.mountId,
      targetId: "tab-preview"
    });
    const closed = await manager.execute("canvas.session.close", {
      canvasSessionId,
      leaseId
    }) as Record<string, unknown>;
    expect(closed.ok).toBe(true);
    expect(browserManager.closeTarget).toHaveBeenCalledWith("browser-managed", "tab-design");
  });

  it("covers repo-only session guard rails and empty feedback branches", async () => {
    const manager = new CanvasManager({
      worktree,
      browserManager: {
        status: vi.fn(),
        closeTarget: vi.fn()
      } as never,
      config
    });

    const opened = await manager.execute("canvas.session.open", {}) as Record<string, unknown>;
    const canvasSessionId = String(opened.canvasSessionId);
    const leaseId = String(opened.leaseId);

    await expect(manager.execute("canvas.document.save", {
      canvasSessionId,
      leaseId,
      repoPath: ".opendevbrowser/canvas/documents/repo-only.json"
    })).rejects.toThrow("Required save governance blocks are missing");

    expect(await manager.execute("canvas.overlay.unmount", {
      canvasSessionId,
      leaseId,
      mountId: "missing-mount",
      targetId: "tab-preview"
    })).toEqual({
      ok: true,
      mountId: "missing-mount",
      previewState: "background",
      overlayState: "idle"
    });

    await manager.execute("canvas.plan.set", {
      canvasSessionId,
      leaseId,
      generationPlan: validGenerationPlan
    });

    expect(await manager.execute("canvas.feedback.poll", {
      canvasSessionId,
      categories: ["render"]
    })).toEqual(expect.objectContaining({
      items: [],
      nextCursor: null,
      retention: expect.objectContaining({
        filteredTotal: 0,
        activeTargetIds: []
      })
    }));

    await expect(manager.execute("canvas.document.patch", {
      canvasSessionId,
      leaseId,
      baseRevision: 2,
      patches: [{
        op: "node.update",
        nodeId: "node_missing",
        changes: { name: "Missing node" }
      }]
    })).rejects.toThrow("Unknown node: node_missing");
  });

  it("reuses the canvas relay client for extension-mode commands", async () => {
    const browserManager = {
      status: vi.fn().mockResolvedValue({
        mode: "extension",
        activeTargetId: "tab-preview",
        url: "https://example.com/app",
        title: "App"
      }),
      goto: vi.fn().mockResolvedValue({ finalUrl: "https://example.com/", status: 200, timingMs: 5 }),
      screenshot: vi.fn().mockResolvedValue({ path: join(worktree, "preview-ext.png") }),
      perfMetrics: vi.fn().mockResolvedValue({ metrics: [{ name: "LayoutDuration", value: 4 }] }),
      consolePoll: vi.fn().mockResolvedValue({
        events: [
          { level: "warn", text: "warn one" },
          { level: "error", text: "warn two" }
        ],
        nextSeq: 2
      }),
      networkPoll: vi.fn().mockResolvedValue({ events: [], nextSeq: 0 })
    };

    canvasClientRequestMock.mockImplementation(async (command: string) => {
      if (command === "canvas.tab.open") {
        return { targetId: "tab-501", previewState: "focused" };
      }
      if (command === "canvas.tab.sync") {
        return { ok: true };
      }
      if (command === "canvas.overlay.mount") {
        return { mountId: "mount-ext", targetId: "tab-preview", previewState: "background", overlayState: "mounted", capabilities: { selection: true } };
      }
      if (command === "canvas.overlay.select") {
        return { selection: { matched: true, selector: "#cta" }, targetId: "tab-preview" };
      }
      if (command === "canvas.overlay.unmount" || command === "canvas.tab.close") {
        return { ok: true };
      }
      return { ok: true };
    });

    const manager = new CanvasManager({
      worktree,
      browserManager: browserManager as never,
      config,
      relay: {
        status: () => ({
          running: true,
          extensionConnected: true,
          extensionHandshakeComplete: true,
          cdpConnected: false,
          annotationConnected: false,
          opsConnected: true,
          canvasConnected: true,
          pairingRequired: false,
          instanceId: "relay-1",
          epoch: 1,
          health: {
            ok: true,
            reason: "ok",
            extensionConnected: true,
            extensionHandshakeComplete: true,
            cdpConnected: false,
            annotationConnected: false,
            opsConnected: true,
            canvasConnected: true,
            pairingRequired: false
          }
        }),
        getCdpUrl: () => null,
        getCanvasUrl: () => "ws://127.0.0.1:8787/canvas"
      }
    });

    const opened = await manager.execute("canvas.session.open", {
      browserSessionId: "browser-extension"
    }) as Record<string, unknown>;
    const canvasSessionId = opened.canvasSessionId as string;
    const leaseId = opened.leaseId as string;
    const documentId = opened.documentId as string;
    const loaded = await manager.execute("canvas.document.load", {
      canvasSessionId,
      leaseId,
      documentId
    }) as { documentRevision: number; document: { pages: Array<{ rootNodeId: string | null }> } };
    const rootNodeId = loaded.document.pages[0]?.rootNodeId;
    expect(rootNodeId).toBeTruthy();

    await manager.execute("canvas.plan.set", {
      canvasSessionId,
      leaseId,
      generationPlan: {
        targetOutcome: { mode: "high-fi-live-edit", summary: "Refine CTA." },
        visualDirection: { profile: "clean-room" },
        layoutStrategy: { approach: "hero-led-grid" },
        contentStrategy: { source: "document-context" },
        componentStrategy: { mode: "reuse-first" },
        motionPosture: { level: "subtle" },
        responsivePosture: { primaryViewport: "desktop" },
        accessibilityPosture: { target: "WCAG_2_2_AA" },
        validationTargets: { blockOn: ["contrast-failure"] }
      }
    });

    await manager.execute("canvas.tab.open", {
      canvasSessionId,
      leaseId,
      prototypeId: "proto_home_default",
      previewMode: "focused"
    });

    const patchResult = await manager.execute("canvas.document.patch", {
      canvasSessionId,
      leaseId,
      baseRevision: loaded.documentRevision + 1,
      patches: [
        {
          op: "node.update",
          nodeId: rootNodeId,
          changes: {
            "metadata.refreshed": true
          }
        }
      ]
    }) as Record<string, unknown>;
    expect(patchResult.appliedRevision).toBe(3);

    const overlay = await manager.execute("canvas.overlay.mount", {
      canvasSessionId,
      leaseId,
      targetId: "tab-preview",
      prototypeId: "proto_home_default"
    }) as Record<string, unknown>;
    expect(overlay.mountId).toBe("mount-ext");

    const selection = await manager.execute("canvas.overlay.select", {
      canvasSessionId,
      leaseId,
      mountId: "mount-ext",
      targetId: "tab-preview",
      selectionHint: { selector: "#cta" }
    }) as { selection: { matched: boolean } };
    expect(selection.selection.matched).toBe(true);

    await manager.execute("canvas.overlay.unmount", {
      canvasSessionId,
      leaseId,
      mountId: "mount-ext",
      targetId: "tab-preview"
    });
    await manager.execute("canvas.tab.close", {
      canvasSessionId,
      leaseId,
      targetId: "tab-501"
    });

    expect(resolveRelayEndpointMock).toHaveBeenCalledTimes(1);
    expect(canvasClientConnectMock).toHaveBeenCalledTimes(1);
    expect(canvasClientRequestMock).toHaveBeenCalledWith("canvas.tab.open", expect.any(Object), canvasSessionId, 30000, leaseId);
    const openCall = canvasClientRequestMock.mock.calls.find(([command]) => command === "canvas.tab.open");
    expect(openCall?.[1]).toEqual(expect.objectContaining({
      html: expect.stringContaining("odb-canvas-component-button")
    }));
    const syncCall = canvasClientRequestMock.mock.calls.find(([command]) => command === "canvas.tab.sync");
    expect(syncCall?.[1]).toEqual(expect.objectContaining({
      html: expect.stringContaining("data-icon-libraries")
    }));
  });

  it("covers repo-backed sessions and non-browser guard paths", async () => {
    const document = createDefaultCanvasDocument("dc_repo_backed");
    document.title = "Repo Backed Document";
    document.designGovernance.generationPlan = structuredClone(validGenerationPlan);
    const repoPath = await saveCanvasDocument(worktree, document, ".opendevbrowser/canvas/documents/preseeded.json");
    const browserManager = {
      closeTarget: vi.fn().mockResolvedValue(undefined),
      status: vi.fn()
    };

    const manager = new CanvasManager({
      worktree,
      browserManager: browserManager as never,
      config
    });

    const opened = await manager.execute("canvas.session.open", {
      repoPath,
      mode: "document-only"
    }) as Record<string, unknown>;
    const canvasSessionId = opened.canvasSessionId as string;
    const leaseId = opened.leaseId as string;

    expect(await manager.execute("canvas.session.status", { canvasSessionId })).toMatchObject({
      documentId: "dc_repo_backed",
      mode: "document-only",
      planStatus: "accepted",
      libraryPolicy: CANVAS_PROJECT_DEFAULTS.libraryPolicy,
      componentInventoryCount: 0,
      componentSourceKinds: []
    });
    expect(await manager.execute("canvas.capabilities.get", { canvasSessionId })).toMatchObject({
      documentId: "dc_repo_backed"
    });
    expect(await manager.execute("canvas.plan.get", { canvasSessionId, leaseId })).toMatchObject({
      planStatus: "accepted"
    });
    expect(await manager.execute("canvas.document.load", {
      canvasSessionId,
      leaseId,
      documentId: "dc_repo_backed"
    })).toMatchObject({
      documentId: "dc_repo_backed",
      document: { title: "Repo Backed Document" },
      handshake: { preflightState: "plan_accepted" }
    });
    await expect(manager.execute("canvas.plan.set", {
      canvasSessionId,
      leaseId,
      generationPlan: []
    })).rejects.toThrow("Missing generationPlan");
    await expect(manager.execute("canvas.plan.set", {
      canvasSessionId,
      leaseId,
      generationPlan: { targetOutcome: { mode: "draft" } }
    })).rejects.toThrow("Generation plan missing fields");
    expect(await manager.execute("canvas.document.load", {
      canvasSessionId,
      leaseId,
      documentId: "dc_loaded_only"
    })).toMatchObject({
      documentId: "dc_loaded_only"
    });
    const defaultPathDocument = createDefaultCanvasDocument("dc_default_path");
    defaultPathDocument.title = "Default Path Repo Document";
    await saveCanvasDocument(worktree, defaultPathDocument);
    expect(await manager.execute("canvas.document.load", {
      canvasSessionId,
      leaseId,
      documentId: "dc_default_path"
    })).toMatchObject({
      documentId: "dc_default_path",
      document: { title: "Default Path Repo Document" }
    });
    expect(await manager.execute("canvas.document.load", {
      canvasSessionId,
      leaseId,
      repoPath
    })).toMatchObject({
      documentId: "dc_repo_backed",
      handshake: { preflightState: "plan_accepted" }
    });
    const planResult = await manager.execute("canvas.plan.set", {
      canvasSessionId,
      leaseId,
      generationPlan: structuredClone(validGenerationPlan)
    }) as Record<string, unknown>;
    await expect(manager.execute("canvas.document.load", {
      canvasSessionId,
      leaseId,
      documentId: "dc_one",
      repoPath: "docs/two.json"
    })).rejects.toThrow("Provide exactly one of documentId or repoPath.");
    expect(await manager.execute("canvas.feedback.poll", {
      canvasSessionId,
      afterCursor: null
    })).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ category: "validation", class: "missing-intent" })
      ]),
      nextCursor: expect.any(String),
      retention: {
        total: 9,
        filteredTotal: 9,
        byTarget: { session: 9 }
      }
    });
    expect(await manager.execute("canvas.feedback.poll", {
      canvasSessionId,
      afterCursor: "cursor_404"
    })).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ category: "validation", class: "missing-intent" })
      ]),
      nextCursor: expect.any(String),
      retention: {
        total: 9,
        filteredTotal: 9
      }
    });
    expect(await manager.execute("canvas.feedback.subscribe", {
      canvasSessionId,
      afterCursor: "cursor_404"
    })).toMatchObject({
      cursor: "fb_9"
    });
    await expect(manager.execute("canvas.document.patch", {
      canvasSessionId,
      leaseId,
      patches: []
    })).rejects.toThrow("Missing baseRevision");
    await expect(manager.execute("canvas.document.patch", {
      canvasSessionId,
      leaseId,
      baseRevision: Number(planResult.documentRevision)
    })).rejects.toThrow("Missing patches");
    await expect(manager.execute("canvas.document.patch", {
      canvasSessionId,
      leaseId,
      baseRevision: Number(planResult.documentRevision),
      patches: [{
        op: "node.update",
        nodeId: "node_missing",
        changes: { "metadata.note": "missing" }
      }]
    })).rejects.toThrow("Unknown node: node_missing");

    await expect(manager.execute("canvas.document.export", {
      canvasSessionId,
      leaseId,
      exportTarget: "design_document",
      repoPath: ".opendevbrowser/canvas/documents/exported.json"
    })).rejects.toMatchObject({
      code: "policy_violation"
    });
    await manager.execute("canvas.document.patch", {
      canvasSessionId,
      leaseId,
      baseRevision: Number(planResult.documentRevision),
      patches: [...governanceBootstrapPatches]
    });
    const designDocument = await manager.execute("canvas.document.export", {
      canvasSessionId,
      leaseId,
      exportTarget: "design_document",
      repoPath: ".opendevbrowser/canvas/documents/exported.json"
    }) as { artifactRefs: string[] };
    expect(designDocument.artifactRefs[0]).toContain("exported.json");

    await expect(manager.execute("canvas.document.export", {
      canvasSessionId,
      leaseId,
      exportTarget: "zip"
    })).rejects.toThrow("Unsupported exportTarget: zip");
    await expect(manager.execute("canvas.overlay.select", {
      canvasSessionId,
      leaseId,
      mountId: "mount-missing",
      targetId: "tab-preview"
    })).rejects.toThrow("canvas.overlay.select requires nodeId or selectionHint.");
    await expect(manager.execute("canvas.overlay.select", {
      canvasSessionId,
      leaseId,
      mountId: "mount-missing",
      targetId: "tab-preview",
      nodeId: "node_missing"
    })).rejects.toThrow("canvas.overlay.select requires a browserSessionId.");
    await expect(manager.execute("canvas.tab.open", {
      canvasSessionId,
      leaseId,
      prototypeId: "proto_home_default",
      previewMode: "focused"
    })).rejects.toThrow("canvas.tab.open requires a browserSessionId.");
    await expect(manager.execute("canvas.tab.open", {
      canvasSessionId,
      leaseId,
      previewMode: "focused"
    })).rejects.toThrow("Missing prototypeId");
    await expect(manager.execute("canvas.tab.close", {
      canvasSessionId,
      leaseId,
      targetId: "tab-preview"
    })).rejects.toThrow("canvas.tab.close requires a browserSessionId.");
    await expect(manager.execute("canvas.overlay.mount", {
      canvasSessionId,
      leaseId,
      targetId: "tab-preview",
      prototypeId: "proto_home_default"
    })).rejects.toThrow("canvas.overlay.mount requires a browserSessionId.");
    expect(await manager.execute("canvas.overlay.unmount", {
      canvasSessionId,
      leaseId,
      mountId: "mount-missing"
    })).toMatchObject({
      ok: true,
      previewState: "background",
      overlayState: "idle"
    });
    await expect(manager.execute("canvas.preview.render", {
      canvasSessionId,
      leaseId,
      targetId: "tab-preview",
      prototypeId: "proto_home_default"
    })).rejects.toThrow("canvas.preview.render requires a browserSessionId.");
    await expect(manager.execute("canvas.preview.refresh", {
      canvasSessionId,
      leaseId,
      targetId: "tab-preview",
      refreshMode: "thumbnail"
    })).rejects.toMatchObject({
      code: "unsupported_target"
    });
    await expect(manager.execute("canvas.session.status", {
      canvasSessionId: "canvas_missing"
    })).rejects.toThrow("Unknown canvas session: canvas_missing");
    await expect(manager.execute("canvas.plan.get", {
      canvasSessionId,
      leaseId: "lease_wrong"
    })).rejects.toMatchObject({
      code: "lease_reclaim_required"
    });
    await expect(manager.execute("canvas.unknown", {})).rejects.toThrow("Unsupported canvas command: canvas.unknown");

    expect(await manager.execute("canvas.session.close", {
      canvasSessionId,
      leaseId
    })).toMatchObject({
      ok: true,
      releasedTargets: []
    });
  });

  it("covers empty-page runtime budget fallbacks, selectorless overlay hints, and feedback filters", async () => {
    const dom = createDomHarness();
    vi.stubGlobal("document", dom.documentStub);
    vi.stubGlobal("HTMLElement", FakeHTMLElement);

    const nullBudgetDocument = createDefaultCanvasDocument("dc_empty_runtime_null");
    nullBudgetDocument.pages = [];
    nullBudgetDocument.designGovernance.generationPlan = structuredClone(validGenerationPlan);
    nullBudgetDocument.designGovernance.runtimeBudgets = null as unknown as typeof nullBudgetDocument.designGovernance.runtimeBudgets;
    const nullBudgetRepoPath = await saveCanvasDocument(
      worktree,
      nullBudgetDocument,
      ".opendevbrowser/canvas/documents/empty-runtime-null.json"
    );

    const invalidBudgetDocument = createDefaultCanvasDocument("dc_empty_runtime_invalid");
    invalidBudgetDocument.pages = [];
    invalidBudgetDocument.designGovernance.generationPlan = structuredClone(validGenerationPlan);
    invalidBudgetDocument.designGovernance.runtimeBudgets = {
      defaultLivePreviewLimit: "bad",
      maxPinnedFullPreviewExtra: Number.POSITIVE_INFINITY,
      reconnectGraceMs: Number.NaN,
      overflowRenderMode: 42,
      backgroundTelemetryMode: false
    } as unknown as typeof invalidBudgetDocument.designGovernance.runtimeBudgets;
    const invalidBudgetRepoPath = await saveCanvasDocument(
      worktree,
      invalidBudgetDocument,
      ".opendevbrowser/canvas/documents/empty-runtime-invalid.json"
    );

    const browserManager = {
      status: vi.fn().mockResolvedValue({
        mode: "managed",
        activeTargetId: "tab-preview",
        url: "https://example.com/app",
        title: "App"
      }),
      withPage: vi.fn().mockImplementation(async (_sessionId: string, _targetId: string, fn: (page: unknown) => Promise<unknown>) => {
        return await fn({
          addStyleTag: vi.fn().mockResolvedValue(undefined),
          evaluate: vi.fn(async (pageFunction: (arg: unknown) => unknown, arg: unknown) => await pageFunction(arg))
        });
      }),
      closeTarget: vi.fn().mockResolvedValue(undefined)
    };

    const manager = new CanvasManager({
      worktree,
      browserManager: browserManager as never,
      config
    });

    const opened = await manager.execute("canvas.session.open", {
      browserSessionId: "browser-empty",
      repoPath: nullBudgetRepoPath
    }) as Record<string, unknown>;
    const canvasSessionId = String(opened.canvasSessionId);
    const leaseId = String(opened.leaseId);
    expect(opened.runtimeBudgets).toEqual(CANVAS_PROJECT_DEFAULTS.runtimeBudgets);

    const managerState = manager as unknown as {
      sessions: Map<string, {
        canvasSessionId: string;
        feedback: Array<Record<string, unknown>>;
        feedbackSubscriptions: Map<string, {
          id: string;
          categories: Set<string>;
          targetIds: Set<string>;
          queue: unknown[];
          waiters: Array<(event: unknown) => void>;
          cursor: string | null;
          heartbeatTimer: NodeJS.Timeout;
          active: boolean;
        }>;
        store: { getDocumentId: () => string; getRevision: () => number };
        editorSelection: { pageId: string | null; nodeId: string | null; targetId: string | null };
      }>;
      buildFeedbackSnapshot: (session: unknown) => Array<{ eventType: string; cursor?: string | null }>;
      getLatestFeedbackCursor: (session: unknown) => string | null;
      subscriptionMatchesItem: (
        subscription: { categories: Set<string>; targetIds: Set<string> },
        item: { category: string; targetId: string | null }
      ) => boolean;
      pushFeedback: (
        session: unknown,
        payload: {
          category: string;
          class: string;
          severity: string;
          message: string;
          pageId: string | null;
          prototypeId: string | null;
          targetId: string | null;
          evidenceRefs: string[];
          details: Record<string, unknown>;
        }
      ) => void;
    };
    const session = managerState.sessions.get(canvasSessionId);
    expect(session?.editorSelection.pageId).toBeNull();

    const loaded = await manager.execute("canvas.document.load", {
      canvasSessionId,
      leaseId,
      repoPath: invalidBudgetRepoPath
    }) as { handshake: { runtimeBudgets: unknown } };
    expect(loaded.handshake.runtimeBudgets).toEqual(CANVAS_PROJECT_DEFAULTS.runtimeBudgets);
    expect(session?.editorSelection.pageId).toBeNull();

    expect(managerState.buildFeedbackSnapshot(session)).toMatchObject([
      { eventType: "feedback.heartbeat", cursor: null }
    ]);
    expect(managerState.getLatestFeedbackCursor(session)).toBeNull();
    expect(managerState.subscriptionMatchesItem({
      categories: new Set(["render"]),
      targetIds: new Set(["tab-preview"])
    }, {
      category: "validation",
      targetId: null
    })).toBe(false);
    expect(managerState.subscriptionMatchesItem({
      categories: new Set(),
      targetIds: new Set()
    }, {
      category: "validation",
      targetId: null
    })).toBe(true);
    expect(managerState.subscriptionMatchesItem({
      categories: new Set(["validation"]),
      targetIds: new Set(["tab-preview"])
    }, {
      category: "validation",
      targetId: null
    })).toBe(true);
    expect(managerState.subscriptionMatchesItem({
      categories: new Set(["validation"]),
      targetIds: new Set(["tab-preview"])
    }, {
      category: "validation",
      targetId: "tab-other"
    })).toBe(false);

    const filteredSubscription = {
      id: "sub_filtered",
      categories: new Set(["render"]),
      targetIds: new Set(["tab-preview"]),
      queue: [],
      waiters: [],
      cursor: null,
      heartbeatTimer: setInterval(() => undefined, 1000),
      active: true
    };
    try {
      session?.feedbackSubscriptions.set(filteredSubscription.id, filteredSubscription);
      managerState.pushFeedback(session, {
        category: "validation",
        class: "ignored-feedback",
        severity: "info",
        message: "should be filtered",
        pageId: null,
        prototypeId: null,
        targetId: null,
        evidenceRefs: [],
        details: {}
      });
      expect(filteredSubscription.queue).toEqual([]);
    } finally {
      clearInterval(filteredSubscription.heartbeatTimer);
      session?.feedbackSubscriptions.delete(filteredSubscription.id);
    }

    expect(await manager.execute("canvas.overlay.select", {
      canvasSessionId,
      leaseId,
      mountId: "mount-empty",
      targetId: "tab-preview",
      selectionHint: { label: "no-selector" }
    })).toMatchObject({
      selection: { matched: false }
    });

    expect(await manager.execute("canvas.overlay.select", {
      canvasSessionId,
      leaseId,
      mountId: "mount-empty",
      targetId: "tab-preview",
      nodeId: "node-empty"
    })).toMatchObject({
      selection: { matched: false }
    });
    expect(session?.editorSelection).toMatchObject({
      pageId: null,
      nodeId: "node-empty",
      targetId: "tab-preview"
    });

    const subscribed = await manager.execute("canvas.feedback.subscribe", {
      canvasSessionId,
      categories: ["validation"]
    }) as { subscriptionId: string; unsubscribe: () => void };
    expect(subscribed.subscriptionId).toMatch(/^canvas_sub_/);
    subscribed.unsubscribe();

    await manager.execute("canvas.session.close", {
      canvasSessionId,
      leaseId
    });
  });

  it("streams live feedback for editor-originated patch requests", async () => {
    const manager = new CanvasManager({
      worktree,
      browserManager: {
        status: vi.fn(),
        closeTarget: vi.fn()
      } as never,
      config
    });

    const opened = await manager.execute("canvas.session.open", {}) as Record<string, unknown>;
    const canvasSessionId = String(opened.canvasSessionId);
    const leaseId = String(opened.leaseId);

    await manager.execute("canvas.plan.set", {
      canvasSessionId,
      leaseId,
      generationPlan: structuredClone(validGenerationPlan)
    });
    await manager.execute("canvas.document.patch", {
      canvasSessionId,
      leaseId,
      baseRevision: 2,
      patches: [...governanceBootstrapPatches]
    });

    const session = (manager as unknown as {
      sessions: Map<string, { store: { getRevision: () => number; getDocument: () => { pages: Array<{ rootNodeId: string | null; nodes: Array<{ id: string; metadata: Record<string, unknown> }> }> } } }>;
      handleCanvasEvent: (event: { event: string; canvasSessionId: string; payload: Record<string, unknown> }) => Promise<void>;
    }).sessions.get(canvasSessionId);
    const rootNodeId = session?.store.getDocument().pages[0]?.rootNodeId;
    expect(rootNodeId).toBeTruthy();

    const subscribed = await manager.execute("canvas.feedback.subscribe", {
      canvasSessionId
    }) as Record<string, unknown> & {
      stream: AsyncIterable<{ eventType: string; item?: { class: string; details?: Record<string, unknown> }; reason?: string }>;
      unsubscribe: () => void;
    };
    const iterator = subscribed.stream[Symbol.asyncIterator]();
    const nextItem = iterator.next();

    await (manager as unknown as {
      handleCanvasEvent: (event: { event: string; canvasSessionId: string; payload: Record<string, unknown> }) => Promise<void>;
    }).handleCanvasEvent({
      event: "canvas_patch_requested",
      canvasSessionId,
      payload: {
        baseRevision: session?.store.getRevision(),
        selection: {
          pageId: "page_home",
          nodeId: rootNodeId,
          targetId: "tab-preview"
        },
        patches: [{
          op: "node.update",
          nodeId: rootNodeId,
          changes: { "metadata.editor": "live" }
        }]
      }
    });

    await expect(nextItem).resolves.toMatchObject({
      value: {
        eventType: "feedback.item",
        item: {
          class: "editor-document-patched",
          details: { source: "editor" }
        }
      },
      done: false
    });
    expect(session?.store.getDocument().pages[0]?.nodes.find((node) => node.id === rootNodeId)?.metadata.editor).toBe("live");

    const nextComplete = iterator.next();
    subscribed.unsubscribe();
    await expect(nextComplete).resolves.toMatchObject({
      value: {
        eventType: "feedback.complete",
        reason: "subscription_replaced"
      },
      done: false
    });
    await iterator.return?.();
    await manager.execute("canvas.session.close", {
      canvasSessionId,
      leaseId
    });
  });

  it("auto-refreshes active preview targets after accepted editor patches", async () => {
    const browserManager = {
      status: vi.fn().mockResolvedValue({
        mode: "managed",
        activeTargetId: "tab-preview",
        url: "https://example.com/app",
        title: "App"
      }),
      goto: vi.fn().mockResolvedValue({ finalUrl: "data:text/html", status: 200, timingMs: 5 }),
      screenshot: vi.fn().mockResolvedValue({ path: join(worktree, "preview-live.png") }),
      perfMetrics: vi.fn().mockResolvedValue({ metrics: [{ name: "LayoutDuration", value: 4 }] }),
      consolePoll: vi.fn().mockResolvedValue({ events: [], nextSeq: 0 }),
      networkPoll: vi.fn().mockResolvedValue({ events: [], nextSeq: 0 }),
      closeTarget: vi.fn().mockResolvedValue(undefined)
    };

    const manager = new CanvasManager({
      worktree,
      browserManager: browserManager as never,
      config
    });

    const opened = await manager.execute("canvas.session.open", {
      browserSessionId: "browser-managed"
    }) as Record<string, unknown>;
    const canvasSessionId = String(opened.canvasSessionId);
    const leaseId = String(opened.leaseId);

    await manager.execute("canvas.plan.set", {
      canvasSessionId,
      leaseId,
      generationPlan: structuredClone(validGenerationPlan)
    });

    const managerState = manager as unknown as {
      sessions: Map<string, {
        editorSelection: { pageId: string | null; nodeId: string | null; targetId: string | null };
        feedback: Array<{ class: string; targetId: string | null; details: Record<string, unknown> }>;
        store: { getRevision: () => number; getDocument: () => { pages: Array<{ rootNodeId: string | null; nodes: Array<{ id: string; metadata: Record<string, unknown> }> }> } };
      }>;
      handleCanvasEvent: (event: { event: string; canvasSessionId: string; payload: Record<string, unknown> }) => Promise<void>;
    };
    const session = managerState.sessions.get(canvasSessionId);
    const rootNodeId = session?.store.getDocument().pages[0]?.rootNodeId;
    expect(rootNodeId).toBeTruthy();

    await manager.execute("canvas.preview.render", {
      canvasSessionId,
      leaseId,
      targetId: "tab-preview",
      prototypeId: "proto_home_default"
    });

    browserManager.goto.mockClear();
    browserManager.screenshot.mockClear();

    await managerState.handleCanvasEvent({
      event: "canvas_patch_requested",
      canvasSessionId,
      payload: {
        baseRevision: session?.store.getRevision(),
        selection: {
          pageId: "page_home",
          nodeId: rootNodeId,
          targetId: "tab-preview"
        },
        patches: [{
          op: "node.update",
          nodeId: rootNodeId,
          changes: { "metadata.editor": "live" }
        }]
      }
    });

    expect(browserManager.goto).toHaveBeenCalledTimes(1);
    expect(browserManager.screenshot).toHaveBeenCalledWith("browser-managed", undefined, "tab-preview");
    expect(decodeDataUrl(browserManager.goto.mock.calls[0]?.[1] as string)).toContain('data-preview-prototype-id="proto_home_default"');
    expect(decodeDataUrl(browserManager.goto.mock.calls[0]?.[1] as string)).toContain('<base href="https://example.com/" />');

    expect(session?.feedback.some((item) => item.class === "editor-document-patched" && item.details.source === "editor")).toBe(true);
    expect(session?.feedback.some((item) => (
      item.class === "render-complete"
      && item.targetId === "tab-preview"
      && item.details.cause === "patch_sync"
      && item.details.source === "editor"
      && item.details.projection === "canvas_html"
    ))).toBe(true);
    expect(session?.editorSelection).toMatchObject({
      pageId: "page_home",
      nodeId: rootNodeId,
      targetId: "tab-preview"
    });
    expect(session?.store.getDocument().pages[0]?.nodes.find((node) => node.id === rootNodeId)?.metadata.editor).toBe("live");
  });

  it("covers feedback heartbeat timers and stream wakeups without payload events", async () => {
    vi.useFakeTimers();
    try {
      const manager = new CanvasManager({
        worktree,
        browserManager: {
          status: vi.fn(),
          closeTarget: vi.fn()
        } as never,
        config
      });

      const opened = await manager.execute("canvas.session.open", {}) as Record<string, unknown>;
      const canvasSessionId = String(opened.canvasSessionId);
      const leaseId = String(opened.leaseId);
      const subscribed = await manager.execute("canvas.feedback.subscribe", {
        canvasSessionId
      }) as { subscriptionId: string };

      const managerState = manager as unknown as {
        sessions: Map<string, {
          feedbackSubscriptions: Map<string, {
            queue: Array<{ eventType: string } | undefined>;
            waiters: Array<(event: unknown) => void>;
            cursor: string | null;
            heartbeatTimer: NodeJS.Timeout;
            active: boolean;
          }>;
        }>;
        createFeedbackStream: (subscription: {
          queue: Array<{ eventType: string } | undefined>;
          waiters: Array<(event: unknown) => void>;
          cursor: string | null;
          heartbeatTimer: NodeJS.Timeout;
          active: boolean;
        }) => AsyncIterable<unknown>;
        flushSubscriptionWaiters: (
          subscription: {
            queue: Array<{ eventType: string } | undefined>;
            waiters: Array<(event: unknown) => void>;
            cursor: string | null;
            heartbeatTimer: NodeJS.Timeout;
            active: boolean;
          },
          event: unknown
        ) => void;
      };

      const session = managerState.sessions.get(canvasSessionId);
      const subscription = session?.feedbackSubscriptions.get(subscribed.subscriptionId);
      expect(subscription?.queue).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(15000);
      expect(subscription?.queue).toEqual([
        expect.objectContaining({ eventType: "feedback.heartbeat" })
      ]);

      const queuedCount = subscription?.queue.length ?? 0;
      if (!subscription) {
        throw new Error("Expected active feedback subscription");
      }
      subscription.active = false;
      await vi.advanceTimersByTimeAsync(15000);
      expect(subscription.queue).toHaveLength(queuedCount);

      const emptyQueuedSubscription = {
        queue: [undefined],
        waiters: [],
        cursor: null,
        heartbeatTimer: setInterval(() => undefined, 1000),
        active: false
      };
      const emptyQueuedIterator = managerState.createFeedbackStream(emptyQueuedSubscription)[Symbol.asyncIterator]();
      await expect(emptyQueuedIterator.next()).resolves.toEqual({
        done: true,
        value: undefined
      });
      clearInterval(emptyQueuedSubscription.heartbeatTimer);

      const waitingSubscription = {
        queue: [],
        waiters: [],
        cursor: null,
        heartbeatTimer: setInterval(() => undefined, 1000),
        active: true
      };
      const waitingIterator = managerState.createFeedbackStream(waitingSubscription)[Symbol.asyncIterator]();
      const waitingNext = waitingIterator.next();
      waitingSubscription.active = false;
      managerState.flushSubscriptionWaiters(waitingSubscription, null);
      await expect(waitingNext).resolves.toEqual({
        done: true,
        value: undefined
      });
      clearInterval(waitingSubscription.heartbeatTimer);

      clearInterval(subscription.heartbeatTimer);
      session?.feedbackSubscriptions.delete(subscribed.subscriptionId);
      await manager.execute("canvas.session.close", {
        canvasSessionId,
        leaseId
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("covers canvas-event guard branches and rejected editor patches", async () => {
    const manager = new CanvasManager({
      worktree,
      browserManager: {
        status: vi.fn(),
        closeTarget: vi.fn()
      } as never,
      config
    });

    const opened = await manager.execute("canvas.session.open", {}) as Record<string, unknown>;
    const canvasSessionId = String(opened.canvasSessionId);
    const leaseId = String(opened.leaseId);

    await manager.execute("canvas.plan.set", {
      canvasSessionId,
      leaseId,
      generationPlan: structuredClone(validGenerationPlan)
    });

    await (manager as unknown as {
      handleCanvasEvent: (event: { event: string; canvasSessionId?: string; payload?: unknown }) => Promise<void>;
    }).handleCanvasEvent({ event: "canvas_status", canvasSessionId });
    await (manager as unknown as {
      handleCanvasEvent: (event: { event: string; canvasSessionId?: string; payload?: unknown }) => Promise<void>;
    }).handleCanvasEvent({ event: "canvas_patch_requested", canvasSessionId: "canvas_missing", payload: {} });
    await (manager as unknown as {
      handleCanvasEvent: (event: { event: string; canvasSessionId?: string; payload?: unknown }) => Promise<void>;
    }).handleCanvasEvent({ event: "canvas_patch_requested", canvasSessionId, payload: null });
    await (manager as unknown as {
      handleCanvasEvent: (event: { event: string; canvasSessionId?: string; payload?: unknown }) => Promise<void>;
    }).handleCanvasEvent({
      event: "canvas_patch_requested",
      canvasSessionId,
      payload: {
        baseRevision: 2,
        selection: {
          pageId: "page_home",
          nodeId: "node_missing",
          targetId: "tab-preview"
        },
        patches: [{
          op: "node.update",
          nodeId: "node_missing",
          changes: { "metadata.note": "missing" }
        }]
      }
    });

    expect(await manager.execute("canvas.feedback.poll", {
      canvasSessionId,
      categories: ["validation"]
    })).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          class: "editor-patch-rejected",
          details: { source: "editor" }
        })
      ])
    });

    await manager.execute("canvas.session.close", {
      canvasSessionId,
      leaseId
    });
  });

  it("covers non-Error patch failures and editor selection fallback updates", async () => {
    const manager = new CanvasManager({
      worktree,
      browserManager: {
        status: vi.fn(),
        closeTarget: vi.fn()
      } as never,
      config
    });

    const opened = await manager.execute("canvas.session.open", {}) as Record<string, unknown>;
    const canvasSessionId = String(opened.canvasSessionId);
    const leaseId = String(opened.leaseId);

    await manager.execute("canvas.plan.set", {
      canvasSessionId,
      leaseId,
      generationPlan: structuredClone(validGenerationPlan)
    });

    const managerState = manager as unknown as {
      sessions: Map<string, {
        editorSelection: { pageId: string | null; nodeId: string | null; targetId: string | null };
        store: { getRevision: () => number; getDocument: () => { pages: Array<{ rootNodeId: string | null }> } };
      }>;
      applyDocumentPatches: (...args: unknown[]) => Promise<unknown>;
      handleCanvasEvent: (event: { event: string; canvasSessionId: string; payload: Record<string, unknown> }) => Promise<void>;
    };

    const session = managerState.sessions.get(canvasSessionId);
    const rootNodeId = session?.store.getDocument().pages[0]?.rootNodeId;
    expect(rootNodeId).toBeTruthy();

    const patchSpy = vi.spyOn(managerState, "applyDocumentPatches");
    patchSpy.mockRejectedValueOnce("agent patch exploded");
    await expect(manager.execute("canvas.document.patch", {
      canvasSessionId,
      leaseId,
      baseRevision: 2,
      patches: []
    })).rejects.toEqual("agent patch exploded");

    patchSpy.mockRestore();
    await managerState.handleCanvasEvent({
      event: "canvas_patch_requested",
      canvasSessionId,
      payload: {
        baseRevision: session?.store.getRevision(),
        patches: []
      }
    });

    session!.editorSelection = {
      pageId: "page_home",
      nodeId: null,
      targetId: null
    };
    const editorSpy = vi.spyOn(managerState, "applyDocumentPatches").mockRejectedValueOnce("editor patch exploded");
    await managerState.handleCanvasEvent({
      event: "canvas_patch_requested",
      canvasSessionId,
      payload: {
        baseRevision: session?.store.getRevision(),
        selection: {
          pageId: "",
          nodeId: "",
          targetId: ""
        },
        patches: [{
          op: "node.update",
          nodeId: rootNodeId,
          changes: { "metadata.note": "ignored" }
        }]
      }
    });
    editorSpy.mockRestore();

    expect(session?.editorSelection).toMatchObject({
      pageId: "page_home",
      nodeId: null,
      targetId: null
    });
    expect(await manager.execute("canvas.feedback.poll", {
      canvasSessionId,
      categories: ["validation"]
    })).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          class: "editor-patch-rejected",
          message: "editor patch exploded",
          details: { source: "editor" }
        })
      ])
    });

    await manager.execute("canvas.session.close", {
      canvasSessionId,
      leaseId
    });
  });

  it("covers queued feedback completion and inactive subscription guards", async () => {
    const manager = new CanvasManager({
      worktree,
      browserManager: {
        status: vi.fn(),
        closeTarget: vi.fn()
      } as never,
      config
    });

    const opened = await manager.execute("canvas.session.open", {}) as Record<string, unknown>;
    const canvasSessionId = String(opened.canvasSessionId);
    const leaseId = String(opened.leaseId);
    await manager.execute("canvas.plan.set", {
      canvasSessionId,
      leaseId,
      generationPlan: structuredClone(validGenerationPlan)
    });

    const subscribed = await manager.execute("canvas.feedback.subscribe", {
      canvasSessionId
    }) as Record<string, unknown> & {
      subscriptionId: string;
      stream: AsyncIterable<{ eventType: string }>;
      unsubscribe: () => void;
    };
    const session = (manager as unknown as {
      sessions: Map<string, { feedbackSubscriptions: Map<string, { active: boolean; queue: unknown[] }> }>;
      enqueueFeedbackEvent: (subscription: { active: boolean; queue: unknown[] }, event: unknown) => void;
    }).sessions.get(canvasSessionId);
    const subscription = session?.feedbackSubscriptions.get(subscribed.subscriptionId);
    expect(subscription).toBeTruthy();

    subscribed.unsubscribe();
    subscribed.unsubscribe();
    const iterator = subscribed.stream[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({
      value: { eventType: "feedback.complete" },
      done: false
    });

    const queuedBefore = subscription?.queue.length ?? 0;
    (manager as unknown as {
      enqueueFeedbackEvent: (subscription: { active: boolean; queue: unknown[] }, event: unknown) => void;
    }).enqueueFeedbackEvent(subscription as { active: boolean; queue: unknown[] }, {
      eventType: "feedback.item",
      item: {
        id: "fb_ignore",
        cursor: "fb_ignore",
        documentId: "dc_ignore",
        documentRevision: 1,
        severity: "info",
        category: "validation",
        class: "ignored",
        message: "ignored",
        pageId: null,
        prototypeId: null,
        targetId: null,
        evidenceRefs: [],
        details: {}
      }
    });
    expect(subscription?.queue.length ?? 0).toBe(queuedBefore);

    await iterator.return?.();
    await manager.execute("canvas.session.close", {
      canvasSessionId,
      leaseId
    });
  });

  it("covers preview feedback filtering, degraded allocation, and helper validation guards", async () => {
    const document = createDefaultCanvasDocument("dc_preview_feedback");
    document.designGovernance.generationPlan = structuredClone(validGenerationPlan);
    document.designGovernance.intent = { summary: "Preview feedback coverage" };
    document.designGovernance.designLanguage = { profile: "clean-room" };
    document.designGovernance.contentModel = { requiredStates: ["default", "loading", "empty", "error"] };
    document.designGovernance.layoutSystem = { grid: { columns: 12 } };
    document.designGovernance.typographySystem = { hierarchy: { display: "display-01" }, fontPolicy: "Local Sans" };
    document.designGovernance.colorSystem = { roles: { primary: "#0055ff" } };
    document.designGovernance.surfaceSystem = { panels: { elevation: "medium" } };
    document.designGovernance.iconSystem = { primary: "tabler" };
    document.designGovernance.motionSystem = { reducedMotion: "respect-user-preference" };
    document.designGovernance.responsiveSystem = { breakpoints: { mobile: 390, tablet: 1024, desktop: 1440 } };
    document.designGovernance.accessibilityPolicy = { reducedMotion: "respect-user-preference" };
    document.designGovernance.libraryPolicy = {
      icons: ["tabler"],
      components: ["shadcn"],
      styling: ["tailwindcss"],
      motion: [],
      threeD: []
    };
    document.designGovernance.runtimeBudgets = {
      defaultLivePreviewLimit: 1,
      maxPinnedFullPreviewExtra: 0,
      reconnectGraceMs: 20_000,
      overflowRenderMode: "thumbnail_only",
      backgroundTelemetryMode: "sampled"
    };
    document.viewports = [{ id: "desktop" }, { id: "tablet" }, { id: "mobile" }] as typeof document.viewports;
    document.themes = [{ id: "light" }] as typeof document.themes;
    document.assets = [
      {
        id: "asset_page",
        sourceType: "page-derived",
        url: "https://example.com/asset.png",
        metadata: {}
      } as typeof document.assets[number]
    ];

    const repoPath = await saveCanvasDocument(worktree, document, ".opendevbrowser/canvas/documents/preview-feedback.json");

    const browserManager = {
      status: vi.fn().mockResolvedValue({
        mode: "managed",
        activeTargetId: "tab-focused",
        url: "https://example.com/app",
        title: "App"
      }),
      page: vi.fn().mockResolvedValue({
        targetId: "tab-design",
        created: true,
        url: "data:text/html,canvas",
        title: "Canvas"
      }),
      closeTarget: vi.fn().mockResolvedValue(undefined),
      goto: vi.fn().mockResolvedValue({ finalUrl: "https://example.com/", status: 200, timingMs: 5 }),
      screenshot: vi.fn().mockResolvedValue({ path: null }),
      consolePoll: vi.fn().mockResolvedValue({ events: [], nextSeq: 0 }),
      networkPoll: vi.fn().mockResolvedValue({ events: [], nextSeq: 0 })
    };

    const manager = new CanvasManager({
      worktree,
      browserManager: browserManager as never,
      config
    });

    const opened = await manager.execute("canvas.session.open", {
      browserSessionId: "browser-managed",
      repoPath
    }) as Record<string, unknown>;
    const canvasSessionId = opened.canvasSessionId as string;
    const leaseId = opened.leaseId as string;

    await expect(manager.execute("canvas.tab.open", {
      canvasSessionId,
      leaseId,
      prototypeId: "proto_home_default",
      previewMode: "sideways"
    })).rejects.toThrow("Missing previewMode");

    const background = await manager.execute("canvas.preview.render", {
      canvasSessionId,
      leaseId,
      targetId: "tab-preview-1",
      prototypeId: "proto_home_default"
    }) as Record<string, unknown>;
    expect(background.previewState).toBe("background");

    const degraded = await manager.execute("canvas.preview.render", {
      canvasSessionId,
      leaseId,
      targetId: "tab-preview-2",
      prototypeId: "proto_home_default"
    }) as Record<string, unknown>;
    expect(degraded.previewState).toBe("degraded");
    expect(degraded.degradeReason).toBe("overflow");

    await expect(manager.execute("canvas.preview.refresh", {
      canvasSessionId,
      leaseId,
      targetId: "tab-preview-1",
      refreshMode: "partial"
    })).rejects.toThrow("Missing refreshMode");

    expect(await manager.execute("canvas.feedback.poll", {
      canvasSessionId,
      categories: ["asset"],
      targetId: "tab-preview-1"
    })).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          category: "asset",
          class: "asset-provenance-missing",
          targetId: "tab-preview-1"
        })
      ]),
      retention: {
        byTarget: { "tab-preview-1": expect.any(Number) }
      }
    });

    expect(await manager.execute("canvas.feedback.poll", {
      canvasSessionId,
      categories: ["render"],
      targetIds: ["tab-preview-2"]
    })).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          category: "render",
          class: "render-degraded",
          targetId: "tab-preview-2"
        })
      ]),
      retention: {
        byTarget: { "tab-preview-2": expect.any(Number) }
      }
    });

    const unopened = await manager.execute("canvas.session.open", {
      browserSessionId: "browser-managed"
    }) as Record<string, unknown>;
    expect(await manager.execute("canvas.feedback.poll", {
      canvasSessionId: unopened.canvasSessionId as string,
      categories: ["render"],
      targetId: "tab-preview-1"
    })).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          category: "validation",
          class: "preflight-blocker",
          targetId: null
        })
      ])
    });
  });

  it("covers preview projection and revision conflict branches", async () => {
    let currentUrl: string | undefined;
    const browserManager = {
      status: vi.fn().mockImplementation(async () => ({
        mode: "managed",
        activeTargetId: "tab-preview",
        url: currentUrl,
        title: "App"
      })),
      goto: vi.fn().mockResolvedValue({ finalUrl: "https://example.com/", status: 200, timingMs: 5 }),
      screenshot: vi.fn().mockResolvedValue({ path: undefined }),
      perfMetrics: vi.fn().mockResolvedValue({ metrics: [{ name: "TaskDuration", value: 3 }] }),
      consolePoll: vi.fn().mockResolvedValue({
        events: [
          { level: "warn", text: "warn one" },
          { level: "error", text: "warn two" }
        ],
        nextSeq: 2
      }),
      networkPoll: vi.fn().mockResolvedValue({ events: [], nextSeq: 0 })
    };

    const manager = new CanvasManager({
      worktree,
      browserManager: browserManager as never,
      config
    });

    const opened = await manager.execute("canvas.session.open", {
      browserSessionId: "browser-preview"
    }) as Record<string, unknown>;
    const canvasSessionId = opened.canvasSessionId as string;
    const leaseId = opened.leaseId as string;

    await expect(manager.execute("canvas.preview.render", {
      canvasSessionId,
      leaseId,
      targetId: "tab-preview",
      prototypeId: "proto_home_default"
    })).rejects.toMatchObject({
      code: "plan_required"
    });

    await manager.execute("canvas.plan.set", {
      canvasSessionId,
      leaseId,
      generationPlan: structuredClone(validGenerationPlan)
    });
    await manager.execute("canvas.document.patch", {
      canvasSessionId,
      leaseId,
      baseRevision: 2,
      patches: [
        {
          op: "prototype.upsert",
          prototype: {
            id: "proto_routeless",
            pageId: "page_home",
            route: "",
            name: "Routeless",
            defaultVariants: { viewport: "desktop", theme: "light" },
            metadata: {}
          }
        },
        {
          op: "prototype.upsert",
          prototype: {
            id: "proto_relative",
            pageId: "page_home",
            route: "preview",
            name: "Relative Preview",
            defaultVariants: { viewport: "desktop", theme: "light" },
            metadata: {}
          }
        }
      ]
    });

    await expect(manager.execute("canvas.document.patch", {
      canvasSessionId,
      leaseId,
      baseRevision: 999,
      patches: []
    })).rejects.toMatchObject({
      code: "revision_conflict"
    });

    await expect(manager.execute("canvas.preview.render", {
      canvasSessionId,
      leaseId,
      targetId: "tab-preview",
      prototypeId: "proto_missing"
    })).rejects.toThrow("Unknown prototype: proto_missing");

    currentUrl = undefined;
    expect(await manager.execute("canvas.preview.render", {
      canvasSessionId,
      leaseId,
      targetId: "tab-preview",
      prototypeId: "proto_routeless"
    })).toMatchObject({
      renderStatus: "rendered"
    });
    expect(decodeDataUrl(browserManager.goto.mock.calls.at(-1)?.[1] as string)).toContain('data-preview-route=""');
    expect(decodeDataUrl(browserManager.goto.mock.calls.at(-1)?.[1] as string)).not.toContain("<base href=");

    expect(await manager.execute("canvas.preview.render", {
      canvasSessionId,
      leaseId,
      targetId: "tab-preview",
      prototypeId: "proto_relative"
    })).toMatchObject({
      renderStatus: "rendered"
    });
    expect(decodeDataUrl(browserManager.goto.mock.calls.at(-1)?.[1] as string)).toContain('data-preview-source-url="preview"');
    expect(decodeDataUrl(browserManager.goto.mock.calls.at(-1)?.[1] as string)).not.toContain("<base href=");

    currentUrl = "http://[";
    expect(await manager.execute("canvas.preview.render", {
      canvasSessionId,
      leaseId,
      targetId: "tab-preview",
      prototypeId: "proto_home_default"
    })).toMatchObject({
      renderStatus: "rendered"
    });
    expect(decodeDataUrl(browserManager.goto.mock.calls.at(-1)?.[1] as string)).toContain('data-preview-source-url=""');

    currentUrl = "https://example.com/app";
    expect(await manager.execute("canvas.preview.render", {
      canvasSessionId,
      leaseId,
      targetId: "tab-preview",
      prototypeId: "proto_routeless"
    })).toMatchObject({
      renderStatus: "rendered",
      previewState: "focused"
    });
    expect(decodeDataUrl(browserManager.goto.mock.calls.at(-1)?.[1] as string)).toContain('<base href="https://example.com/app" />');
    expect(await manager.execute("canvas.preview.render", {
      canvasSessionId,
      leaseId,
      targetId: "tab-preview",
      prototypeId: "proto_home_default"
    })).toMatchObject({
      renderStatus: "rendered",
      previewState: "focused"
    });
    expect(decodeDataUrl(browserManager.goto.mock.calls.at(-1)?.[1] as string)).toContain('<base href="https://example.com/" />');
    browserManager.consolePoll.mockResolvedValueOnce({ events: [], nextSeq: 3 });
    browserManager.networkPoll.mockResolvedValueOnce({ events: [], nextSeq: 0 });
    expect(await manager.execute("canvas.preview.render", {
      canvasSessionId,
      leaseId,
      targetId: "tab-preview",
      prototypeId: "proto_home_default"
    })).toMatchObject({
      renderStatus: "rendered",
      previewState: "focused"
    });
    expect(decodeDataUrl(browserManager.goto.mock.calls.at(-1)?.[1] as string)).toContain('data-preview-prototype-id="proto_home_default"');

    expect(await manager.execute("canvas.preview.refresh", {
      canvasSessionId,
      leaseId,
      targetId: "tab-preview",
      refreshMode: "full"
    })).toMatchObject({
      renderStatus: "rendered"
    });
    expect(await manager.execute("canvas.preview.refresh", {
      canvasSessionId,
      leaseId,
      targetId: "tab-preview",
      refreshMode: "thumbnail"
    })).toMatchObject({
      targetId: "tab-preview",
      previewState: "focused"
    });

    const feedback = await manager.execute("canvas.feedback.poll", {
      canvasSessionId,
      afterCursor: null,
      categories: ["render", "console", "network", "performance"]
    }) as { items: Array<{ category: string; class: string; evidenceRefs: string[] }>; retention: { total: number } };
    expect(feedback.items.some((item) => item.category === "console")).toBe(true);
    expect(feedback.items.some((item) => item.category === "network")).toBe(false);
    expect(feedback.items.find((item) => item.class === "render-complete")?.evidenceRefs).toEqual([]);
    for (let index = 0; index < 205; index += 1) {
      await manager.execute("canvas.preview.refresh", {
        canvasSessionId,
        leaseId,
        targetId: "tab-preview",
        refreshMode: "thumbnail"
      });
    }
    expect(await manager.execute("canvas.feedback.poll", {
      canvasSessionId,
      afterCursor: null
    })).toMatchObject({
      retention: { total: 200 }
    });
  });

  it("covers internal warning classification and blocker dedupe branches", async () => {
    const manager = new CanvasManager({
      worktree,
      browserManager: {
        status: vi.fn(),
        closeTarget: vi.fn()
      } as never,
      config
    });

    const opened = await manager.execute("canvas.session.open", {}) as Record<string, unknown>;
    const canvasSessionId = String(opened.canvasSessionId);
    const session = (manager as { sessions: Map<string, unknown> }).sessions.get(canvasSessionId) as {
      planStatus: string;
      feedback: Array<Record<string, unknown>>;
      store: { getDocumentId: () => string; getRevision: () => number };
    };

    session.feedback.push({
      id: "fb_preflight_1",
      cursor: "fb_preflight_1",
      category: "validation",
      class: "preflight-blocker",
      severity: "warning",
      message: "duplicate blocker",
      pageId: null,
      prototypeId: null,
      targetId: null,
      documentId: session.store.getDocumentId(),
      documentRevision: session.store.getRevision(),
      evidenceRefs: [],
      details: { auditId: "CANVAS-01" }
    });

    const deduped = await manager.execute("canvas.feedback.poll", {
      canvasSessionId
    }) as { items: Array<{ id: string }> };
    expect(deduped.items.filter((item) => item.id === "fb_preflight_1")).toHaveLength(1);

    session.planStatus = "accepted";
    session.feedback.length = 0;
    (manager as { emitWarnings: (s: unknown, warnings: Array<Record<string, unknown>>, context?: Record<string, unknown>) => void }).emitWarnings(session, [{
      code: "export-warning",
      severity: "warning",
      message: "Export warning without audit id"
    }], {});

    expect(await manager.execute("canvas.feedback.poll", {
      canvasSessionId,
      categories: ["export"]
    })).toEqual(expect.objectContaining({
      items: [expect.objectContaining({
        category: "export",
        class: "export-warning",
        details: expect.objectContaining({ auditId: null })
      })]
    }));
  });

  it("replaces direct overlays and reports unmatched selections", async () => {
    const dom = createDomHarness();
    vi.stubGlobal("document", dom.documentStub);
    vi.stubGlobal("HTMLElement", FakeHTMLElement);

    const browserManager = {
      status: vi.fn().mockResolvedValue({
        mode: "managed",
        activeTargetId: "tab-preview",
        url: "https://example.com/app",
        title: "App"
      }),
      withPage: vi.fn().mockImplementation(async (_sessionId: string, _targetId: string, fn: (page: unknown) => Promise<unknown>) => {
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

    const opened = await manager.execute("canvas.session.open", {
      browserSessionId: "browser-managed"
    }) as Record<string, unknown>;
    const canvasSessionId = opened.canvasSessionId as string;
    const leaseId = opened.leaseId as string;

    await manager.execute("canvas.plan.set", {
      canvasSessionId,
      leaseId,
      generationPlan: structuredClone(validGenerationPlan)
    });
    await manager.execute("canvas.overlay.mount", {
      canvasSessionId,
      leaseId,
      targetId: "tab-preview",
      prototypeId: "proto_home_default"
    });
    await manager.execute("canvas.overlay.mount", {
      canvasSessionId,
      leaseId,
      targetId: "tab-preview",
      prototypeId: "proto_home_default"
    });

    const overlays = dom.documentStub.body.children.filter((child) => child.id === "opendevbrowser-canvas-overlay");
    expect(overlays).toHaveLength(2);
    expect(overlays[0]?.removed).toBe(true);
    expect(overlays[1]?.removed).toBe(false);

    expect(await manager.execute("canvas.overlay.select", {
      canvasSessionId,
      leaseId,
      mountId: "mount_missing",
      targetId: "tab-preview",
      nodeId: "node_missing"
    })).toMatchObject({
      selection: { matched: false }
    });

    const classless = new FakeHTMLElement("BUTTON", () => {});
    classless.textContent = "CTA";
    dom.registerSelector(".cta", classless);
    const nodeBound = new FakeHTMLElement("DIV", () => {});
    nodeBound.textContent = "Node Bound";
    dom.registerSelector("[data-node-id=\"node_cta\"]", nodeBound);
    expect(await manager.execute("canvas.overlay.select", {
      canvasSessionId,
      leaseId,
      mountId: "mount_existing",
      targetId: "tab-preview",
      nodeId: "node_cta"
    })).toMatchObject({
      selection: { matched: true, selector: "[data-node-id=\"node_cta\"]" }
    });

    expect(await manager.execute("canvas.overlay.select", {
      canvasSessionId,
      leaseId,
      mountId: "mount_existing",
      targetId: "tab-preview",
      selectionHint: { selector: ".cta" }
    })).toMatchObject({
      selection: { matched: true, id: null, className: "opendevbrowser-canvas-highlight", selector: ".cta" }
    });

    expect(await manager.execute("canvas.overlay.select", {
      canvasSessionId,
      leaseId,
      mountId: "mount_missing",
      targetId: "tab-preview",
      selectionHint: { selector: "#missing" }
    })).toMatchObject({
      selection: { matched: false }
    });

    await expect(manager.execute("canvas.tab.open", {
      canvasSessionId,
      leaseId,
      prototypeId: "proto_home_default",
      previewMode: "degraded"
    })).rejects.toThrow("Missing previewMode");
  });

  it("covers extension relay replacement, defaults, and cleanup", async () => {
    let relayUrl: string | null = null;
    let openCount = 0;
    const browserManager = {
      status: vi.fn().mockResolvedValue({
        mode: "extension",
        activeTargetId: "tab-preview",
        url: "https://example.com/app",
        title: "App"
      }),
      registerCanvasTarget: vi.fn().mockResolvedValue({
        targetId: "tab-ext-1",
        adopted: true,
        url: "chrome-extension://test/canvas.html",
        title: "Canvas"
      }),
      goto: vi.fn().mockResolvedValue({ finalUrl: "https://example.com/", status: 200, timingMs: 5 }),
      screenshot: vi.fn().mockResolvedValue({ path: undefined }),
      consolePoll: vi.fn().mockResolvedValue({ events: [], nextSeq: 0 }),
      networkPoll: vi.fn().mockResolvedValue({ events: [], nextSeq: 0 }),
      closeTarget: vi.fn().mockResolvedValue(undefined)
    };

    canvasClientRequestMock.mockImplementation(async (command: string) => {
      if (command === "canvas.tab.open") {
        openCount += 1;
        return openCount === 1 ? {} : { targetId: "tab-ext-1" };
      }
      if (command === "canvas.tab.sync") {
        throw new Error("sync failed");
      }
      if (command === "canvas.overlay.mount") {
        return {};
      }
      if (command === "canvas.overlay.select") {
        return { matched: true, selector: "#cta" };
      }
      return { ok: true };
    });

    const manager = new CanvasManager({
      worktree,
      browserManager: browserManager as never,
      config,
      relay: {
        status: () => ({
          running: true,
          extensionConnected: true,
          extensionHandshakeComplete: true,
          cdpConnected: false,
          annotationConnected: false,
          opsConnected: true,
          canvasConnected: true,
          pairingRequired: false,
          instanceId: "relay-1",
          epoch: 1,
          health: {
            ok: true,
            reason: "ok",
            extensionConnected: true,
            extensionHandshakeComplete: true,
            cdpConnected: false,
            annotationConnected: false,
            opsConnected: true,
            canvasConnected: true,
            pairingRequired: false
          }
        }),
        getCdpUrl: () => null,
        getCanvasUrl: () => relayUrl
      }
    });

    const opened = await manager.execute("canvas.session.open", {
      browserSessionId: "browser-extension"
    }) as Record<string, unknown>;
    const canvasSessionId = opened.canvasSessionId as string;
    const leaseId = opened.leaseId as string;

    await manager.execute("canvas.plan.set", {
      canvasSessionId,
      leaseId,
      generationPlan: structuredClone(validGenerationPlan)
    });

    await expect(manager.execute("canvas.tab.open", {
      canvasSessionId,
      leaseId,
      prototypeId: "proto_home_default",
      previewMode: "focused"
    })).rejects.toThrow("Canvas relay unavailable.");

    relayUrl = "ws://127.0.0.1:8787/canvas";
    expect(await manager.execute("canvas.tab.open", {
      canvasSessionId,
      leaseId,
      prototypeId: "proto_home_default",
      previewMode: "focused"
    })).toMatchObject({
      targetId: null,
      targetIds: []
    });
    expect(await manager.execute("canvas.tab.open", {
      canvasSessionId,
      leaseId,
      prototypeId: "proto_home_default",
      previewMode: "focused"
    })).toMatchObject({
      targetId: "tab-ext-1",
      targetIds: ["tab-ext-1"]
    });

    await manager.execute("canvas.document.patch", {
      canvasSessionId,
      leaseId,
      baseRevision: 2,
      patches: []
    });

    const overlay = await manager.execute("canvas.overlay.mount", {
      canvasSessionId,
      leaseId,
      targetId: "tab-preview",
      prototypeId: "proto_home_default"
    }) as Record<string, unknown>;
    expect(String(overlay.mountId)).toContain("mount_");
    expect(overlay.previewState).toBe("background");
    expect(overlay.overlayState).toBe("mounted");
    const extensionSyncCall = [...canvasClientRequestMock.mock.calls].reverse().find(([command]) => command === "canvas.tab.sync");
    expect(extensionSyncCall?.[1]).toEqual(expect.objectContaining({
      html: expect.stringContaining("odb-canvas-root")
    }));
    expect(overlay.capabilities).toEqual({ selection: true, guides: true });

    relayUrl = "ws://127.0.0.1:9797/canvas";
    expect(await manager.execute("canvas.overlay.select", {
      canvasSessionId,
      leaseId,
      mountId: overlay.mountId,
      targetId: "tab-preview",
      selectionHint: { selector: "#cta" }
    })).toMatchObject({
      selection: { matched: true, selector: "#cta" }
    });
    await manager.execute("canvas.tab.close", {
      canvasSessionId,
      leaseId,
      targetId: "tab-other"
    });

    await manager.execute("canvas.session.close", {
      canvasSessionId,
      leaseId
    });

    expect(resolveRelayEndpointMock).toHaveBeenCalledTimes(2);
    expect(canvasClientDisconnectMock).toHaveBeenCalledTimes(1);
    expect(browserManager.closeTarget).toHaveBeenCalledWith("browser-extension", "tab-other");
    expect(browserManager.registerCanvasTarget).toHaveBeenCalledWith("browser-extension", "tab-ext-1");
    expect(canvasClientRequestMock).toHaveBeenCalledWith("canvas.overlay.unmount", expect.any(Object), canvasSessionId, 30000, leaseId);
    expect(canvasClientRequestMock).toHaveBeenCalledWith("canvas.tab.close", expect.any(Object), canvasSessionId, 30000, leaseId);
  });

  it("tracks attached observers, lease reclaim, and summary state", async () => {
    const manager = new CanvasManager({
      worktree,
      browserManager: {
        status: vi.fn(),
        closeTarget: vi.fn()
      } as never,
      config
    });

    const opened = await manager.execute("canvas.session.open", {
      clientId: "client-owner"
    }) as Record<string, unknown>;
    const canvasSessionId = String(opened.canvasSessionId);
    const originalLeaseId = String(opened.leaseId);

    const observer = await manager.execute("canvas.session.attach", {
      canvasSessionId,
      clientId: "client-observer",
      attachMode: "observer"
    }) as {
      role: string;
      summary: {
        attachedClients: Array<{ clientId: string; role: string }>;
        leaseHolderClientId: string;
      };
    };
    expect(observer.role).toBe("observer");
    expect(observer.summary.leaseHolderClientId).toBe("client-owner");
    expect(observer.summary.attachedClients).toEqual(expect.arrayContaining([
      expect.objectContaining({ clientId: "client-owner", role: "lease_holder" }),
      expect.objectContaining({ clientId: "client-observer", role: "observer" })
    ]));

    await expect(manager.execute("canvas.session.attach", {
      canvasSessionId,
      clientId: "client-invalid",
      attachMode: "invalid"
    })).rejects.toThrow("Unsupported attachMode: invalid");

    const reclaimed = await manager.execute("canvas.session.attach", {
      canvasSessionId,
      clientId: "client-reclaimer",
      attachMode: "lease_reclaim"
    }) as {
      leaseId: string;
      role: string;
      summary: {
        attachedClients: Array<{ clientId: string; role: string }>;
        leaseHolderClientId: string;
      };
    };
    expect(reclaimed.role).toBe("lease_holder");
    expect(reclaimed.leaseId).not.toBe(originalLeaseId);
    expect(reclaimed.summary.leaseHolderClientId).toBe("client-reclaimer");
    expect(reclaimed.summary.attachedClients).toEqual(expect.arrayContaining([
      expect.objectContaining({ clientId: "client-owner", role: "observer" }),
      expect.objectContaining({ clientId: "client-observer", role: "observer" }),
      expect.objectContaining({ clientId: "client-reclaimer", role: "lease_holder" })
    ]));

    const planResult = await manager.execute("canvas.plan.set", {
      canvasSessionId,
      leaseId: reclaimed.leaseId,
      generationPlan: structuredClone(validGenerationPlan)
    }) as { documentRevision: number };
    await expect(manager.execute("canvas.document.patch", {
      canvasSessionId,
      leaseId: originalLeaseId,
      baseRevision: 1,
      patches: []
    })).rejects.toMatchObject({
      code: "lease_reclaim_required"
    });

    await expect(manager.execute("canvas.document.patch", {
      canvasSessionId,
      leaseId: reclaimed.leaseId,
      baseRevision: planResult.documentRevision,
      patches: [{
        op: "governance.update",
        block: "intent",
        changes: { summary: "Lease reclaimer can still mutate." }
      }]
    })).resolves.toMatchObject({
      appliedRevision: planResult.documentRevision + 1
    });

    expect(await manager.execute("canvas.session.status", {
      canvasSessionId,
      clientId: "client-observer"
    })).toMatchObject({
      leaseId: reclaimed.leaseId,
      leaseHolderClientId: "client-reclaimer"
    });
  });

  it("round-trips canvas.code bind, pull, push, status, and resolve flows", async () => {
    const sourcePath = join(worktree, "Hero.tsx");
    await writeFile(sourcePath, [
      "export function Hero() {",
      "  return <section className=\"hero-shell\"><span>Hello world</span></section>;",
      "}",
      ""
    ].join("\n"));

    const manager = new CanvasManager({
      worktree,
      browserManager: {
        status: vi.fn(),
        closeTarget: vi.fn()
      } as never,
      config
    });

    const opened = await manager.execute("canvas.session.open", {}) as Record<string, unknown>;
    const canvasSessionId = String(opened.canvasSessionId);
    const leaseId = String(opened.leaseId);
    const documentId = String(opened.documentId);
    const session = (manager as {
      sessions: Map<string, {
        store: {
          getDocument: () => {
            pages: Array<{
              rootNodeId: string | null;
              nodes: Array<{ id: string; props: Record<string, unknown> }>;
            }>;
          };
          getRevision: () => number;
        };
      }>;
    }).sessions.get(canvasSessionId);
    if (!session) {
      throw new Error("Missing canvas session");
    }

    const loaded = await manager.execute("canvas.document.load", {
      canvasSessionId,
      leaseId,
      documentId
    }) as {
      document: { pages: Array<{ rootNodeId: string | null }> };
    };
    const rootNodeId = loaded.document.pages[0]?.rootNodeId;
    expect(rootNodeId).toBeTruthy();
    await manager.execute("canvas.plan.set", {
      canvasSessionId,
      leaseId,
      generationPlan: structuredClone(validGenerationPlan)
    });
    await manager.execute("canvas.document.patch", {
      canvasSessionId,
      leaseId,
      baseRevision: session.store.getRevision(),
      patches: [{
        op: "binding.set",
        nodeId: rootNodeId,
        binding: {
          id: "binding_plain",
          kind: "component-prop",
          selector: "props.text",
          componentName: "HeroTitle",
          metadata: { source: "cms" }
        }
      }]
    });
    await expect(manager.execute("canvas.code.pull", {
      canvasSessionId,
      leaseId,
      bindingId: "binding_plain"
    })).rejects.toMatchObject({
      code: "code_sync_required",
      details: { bindingId: "binding_plain" }
    });

    const bound = await manager.execute("canvas.code.bind", {
      canvasSessionId,
      leaseId,
      nodeId: rootNodeId,
      bindingId: "binding_code",
      repoPath: sourcePath,
      exportName: "Hero",
      syncMode: "manual"
    }) as {
      bindingStatus: { state: string };
      summary: { bindings: Array<{ bindingId: string }> };
    };
    expect(bound.bindingStatus.state).toBe("idle");
    expect(bound.summary.bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ bindingId: "binding_code" })
    ]));
    expect(await manager.execute("canvas.code.status", {
      canvasSessionId
    })).toMatchObject({
      codeSyncState: "idle",
      boundFiles: [sourcePath],
      bindings: expect.arrayContaining([
        expect.objectContaining({ bindingId: "binding_code" })
      ])
    });
    expect(await manager.execute("canvas.code.push", {
      canvasSessionId,
      leaseId,
      bindingId: "binding_code"
    })).toMatchObject({
      ok: false,
      conflicts: expect.arrayContaining([
        expect.objectContaining({
          kind: "unsupported_change",
          message: "No existing code-sync manifest found. Run canvas.code.pull first."
        })
      ]),
      summary: {
        codeSyncState: "conflict"
      }
    });
    await expect(manager.execute("canvas.code.pull", {
      canvasSessionId,
      leaseId,
      bindingId: "binding_code",
      resolutionPolicy: "broken"
    })).rejects.toThrow("Unsupported resolutionPolicy: broken");

    const pulled = await manager.execute("canvas.code.pull", {
      canvasSessionId,
      leaseId,
      bindingId: "binding_code"
    }) as {
      ok: boolean;
      patchesApplied: number;
      summary: { codeSyncState: string };
    };
    expect(pulled.ok).toBe(true);
    expect(pulled.patchesApplied).toBeGreaterThan(0);
    expect(pulled.summary.codeSyncState).toBe("in_sync");

    const manifestPath = join(worktree, ".opendevbrowser", "canvas", "code-sync", documentId, "binding_code.json");
    expect(await readFile(manifestPath, "utf-8")).toContain("\"bindingId\": \"binding_code\"");

    const importedTextNode = session.store.getDocument().pages[0]?.nodes.find((node) => node.props.text === "Hello world");
    expect(importedTextNode).toBeTruthy();

    await manager.execute("canvas.document.patch", {
      canvasSessionId,
      leaseId,
      baseRevision: session.store.getRevision(),
      patches: [{
        op: "node.update",
        nodeId: importedTextNode?.id,
        changes: { "props.text": "Hello canvas" }
      }]
    });

    const pushed = await manager.execute("canvas.code.push", {
      canvasSessionId,
      leaseId,
      bindingId: "binding_code"
    }) as {
      ok: boolean;
      repoPath: string;
      summary: { lastPushAt?: string };
    };
    expect(pushed.ok).toBe(true);
    expect(pushed.repoPath).toBe(sourcePath);
    expect(pushed.summary.lastPushAt).toBeTruthy();
    const pushedSource = await readFile(sourcePath, "utf-8");
    expect(pushedSource).toContain("Hello canvas");
    expect(pushedSource).toContain("data-node-id");
    expect(pushedSource).toContain("data-binding-id=\"binding_code\"");
    expect(countOccurrences(pushedSource, "data-node-id=")).toBe(2);
    expect(countOccurrences(pushedSource, 'data-binding-id="binding_code"')).toBe(2);

    await manager.execute("canvas.document.patch", {
      canvasSessionId,
      leaseId,
      baseRevision: session.store.getRevision(),
      patches: [{
        op: "node.update",
        nodeId: importedTextNode?.id,
        changes: { "props.text": "Hello canvas again" }
      }]
    });

    expect(await manager.execute("canvas.code.push", {
      canvasSessionId,
      leaseId,
      bindingId: "binding_code"
    })).toMatchObject({
      ok: true,
      repoPath: sourcePath
    });
    const secondPushedSource = await readFile(sourcePath, "utf-8");
    expect(secondPushedSource).toContain("Hello canvas again");
    expect(countOccurrences(secondPushedSource, "data-node-id=")).toBe(2);
    expect(countOccurrences(secondPushedSource, 'data-binding-id="binding_code"')).toBe(2);

    expect(await manager.execute("canvas.code.status", {
      canvasSessionId,
      bindingId: "binding_code"
    })).toMatchObject({
      bindingStatus: {
        bindingId: "binding_code",
        state: "in_sync",
        projection: "canvas_html"
      },
      summary: {
        boundFiles: [sourcePath],
        codeSyncState: "in_sync"
      }
    });

    await manager.execute("canvas.document.patch", {
      canvasSessionId,
      leaseId,
      baseRevision: session.store.getRevision(),
      patches: [{
        op: "node.update",
        nodeId: importedTextNode?.id,
        changes: { "props.text": "Canvas drift" }
      }]
    });
    await writeFile(sourcePath, pushedSource.replace("Hello canvas", "Hello source"));

    const conflicted = await manager.execute("canvas.code.pull", {
      canvasSessionId,
      leaseId,
      bindingId: "binding_code"
    }) as {
      ok: boolean;
      conflicts: Array<{ kind: string }>;
    };
    expect(conflicted.ok).toBe(false);
    expect(conflicted.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "source_hash_changed" }),
      expect.objectContaining({ kind: "document_revision_changed" })
    ]));

    const manual = await manager.execute("canvas.code.resolve", {
      canvasSessionId,
      leaseId,
      bindingId: "binding_code",
      resolutionPolicy: "manual"
    }) as {
      ok: boolean;
      conflicts: Array<{ kind: string; message: string }>;
      summary: { codeSyncState: string };
    };
    expect(manual.ok).toBe(false);
    expect(manual.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "ownership_violation",
        message: "Manual conflict resolution is not automatable. Choose prefer_code or prefer_canvas."
      })
    ]));
    expect(manual.summary.codeSyncState).toBe("conflict");

    const resolved = await manager.execute("canvas.code.resolve", {
      canvasSessionId,
      leaseId,
      bindingId: "binding_code",
      resolutionPolicy: "prefer_code"
    }) as {
      ok: boolean;
      summary: { codeSyncState: string };
    };
    expect(resolved.ok).toBe(true);
    expect(resolved.summary.codeSyncState).toBe("in_sync");

    expect(session.store.getDocument().pages[0]?.nodes.some((node) => node.props.text === "Hello source")).toBe(true);

    expect(await manager.execute("canvas.code.unbind", {
      canvasSessionId,
      leaseId,
      bindingId: "binding_code"
    })).toMatchObject({
      ok: true,
      bindingId: "binding_code",
      summary: {
        bindings: expect.not.arrayContaining([
          expect.objectContaining({ bindingId: "binding_code" })
        ])
      }
    });
  });

  it("reconciles watch-mode source drift during canvas.code.status when the source changed ahead of watcher import", async () => {
    const sourcePath = join(worktree, "WatchStatusHero.tsx");
    await writeFile(sourcePath, [
      "export function Hero() {",
      "  return <section className=\"hero-shell\"><span>Hello baseline</span></section>;",
      "}",
      ""
    ].join("\n"));

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
      documentId: string;
    };
    const loaded = await manager.execute("canvas.document.load", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      documentId: opened.documentId
    }) as {
      document: { pages: Array<{ rootNodeId: string | null }> };
    };
    const rootNodeId = loaded.document.pages[0]?.rootNodeId;
    expect(rootNodeId).toBeTruthy();

    const planResult = await manager.execute("canvas.plan.set", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      generationPlan: structuredClone(validGenerationPlan)
    }) as { documentRevision: number };
    await manager.execute("canvas.document.patch", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      baseRevision: planResult.documentRevision,
      patches: governanceBootstrapPatches
    });

    await manager.execute("canvas.code.bind", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      nodeId: rootNodeId,
      bindingId: "binding_watch_status_reconcile",
      repoPath: sourcePath,
      exportName: "Hero",
      syncMode: "watch"
    });
    await manager.execute("canvas.code.pull", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      bindingId: "binding_watch_status_reconcile"
    });

    const session = (manager as {
      sessions: Map<string, {
        store: {
          getDocument: () => {
            pages: Array<{
              nodes: Array<{ id: string; props: Record<string, unknown> }>;
            }>;
          };
          getRevision: () => number;
        };
      }>;
    }).sessions.get(opened.canvasSessionId);
    if (!session) {
      throw new Error("Missing watch-status session");
    }
    const importedTextNode = session.store.getDocument().pages[0]?.nodes.find((node) => node.props.text === "Hello baseline");
    if (!importedTextNode) {
      throw new Error("Expected imported text node");
    }

    const patched = await manager.execute("canvas.document.patch", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      baseRevision: session.store.getRevision(),
      patches: [{
        op: "node.update",
        nodeId: importedTextNode.id,
        changes: { "props.text": "Hello from canvas status" }
      }]
    }) as { appliedRevision: number };
    await manager.execute("canvas.code.push", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      bindingId: "binding_watch_status_reconcile"
    });

    const pushedSource = await readFile(sourcePath, "utf-8");
    await writeFile(sourcePath, pushedSource.replace("Hello from canvas status", "Hello from source status"));

    const status = await manager.execute("canvas.code.status", {
      canvasSessionId: opened.canvasSessionId,
      bindingId: "binding_watch_status_reconcile"
    }) as {
      bindingStatus: { state: string; driftState: string };
      summary: { documentRevision: number };
    };
    expect(status.bindingStatus).toMatchObject({
      state: "in_sync",
      driftState: "clean"
    });
    expect(status.summary.documentRevision).toBeGreaterThan(patched.appliedRevision);
    expect(session.store.getDocument().pages[0]?.nodes.some((node) => node.props.text === "Hello from source status")).toBe(true);
  });

  it("records watch conflicts when a watched source change cannot be imported", async () => {
    const sourcePath = join(worktree, "WatchConflictHero.tsx");
    await writeFile(sourcePath, [
      "export function Hero() {",
      "  return <section><span>Hello conflict</span></section>;",
      "}",
      ""
    ].join("\n"));

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
      documentId: string;
    };
    const loaded = await manager.execute("canvas.document.load", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      documentId: opened.documentId
    }) as {
      document: { pages: Array<{ rootNodeId: string | null }> };
    };
    await manager.execute("canvas.plan.set", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      generationPlan: structuredClone(validGenerationPlan)
    });
    await manager.execute("canvas.document.patch", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      baseRevision: 2,
      patches: governanceBootstrapPatches
    });
    await manager.execute("canvas.code.bind", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      nodeId: loaded.document.pages[0]?.rootNodeId,
      bindingId: "binding_watch_conflict",
      repoPath: sourcePath,
      exportName: "Hero",
      syncMode: "watch"
    });

    const internal = manager as unknown as {
      codeSyncManager: {
        pull: (args: unknown) => Promise<{
          ok: boolean;
          conflicts: Array<{ message: string }>;
        }>;
      };
      handleWatchedSourceChange: (canvasSessionId: string, bindingId: string) => Promise<void>;
    };
    const pullSpy = vi.spyOn(internal.codeSyncManager, "pull").mockResolvedValue({
      ok: false,
      conflicts: [{ message: "Source drift requires manual review." }]
    });

    await internal.handleWatchedSourceChange(opened.canvasSessionId, "binding_watch_conflict");

    expect(pullSpy).toHaveBeenCalledTimes(1);
    await expect(manager.execute("canvas.feedback.poll", {
      canvasSessionId: opened.canvasSessionId,
      categories: ["code-sync"]
    })).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          class: "code-sync-watch-conflict",
          message: "Source drift requires manual review."
        })
      ])
    });
  });

  it("prefers bound_app_runtime preview when bridge instrumentation is available and falls back explicitly when it is not", async () => {
    const runtimeWindow = new Window();
    vi.stubGlobal("window", runtimeWindow);
    vi.stubGlobal("document", runtimeWindow.document);
    vi.stubGlobal("HTMLElement", runtimeWindow.HTMLElement);

    const runtimeRoot = runtimeWindow.document.createElement("section");
    runtimeRoot.id = "runtime-root";
    runtimeRoot.setAttribute("data-binding-id", "binding_runtime");
    runtimeWindow.document.body.appendChild(runtimeRoot);

    const sourcePath = join(worktree, "RuntimeView.tsx");
    await writeFile(sourcePath, [
      "export function RuntimeView() {",
      "  return <section>Runtime preview</section>;",
      "}",
      ""
    ].join("\n"));

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
      withPage: vi.fn().mockImplementation(async (_sessionId: string, _targetId: string | null, fn: (page: unknown) => Promise<unknown>) => {
        return await fn({
          evaluate: vi.fn(async (pageFunction: (arg: unknown) => unknown, arg: unknown) => await pageFunction(arg))
        });
      })
    };

    const manager = new CanvasManager({
      worktree,
      browserManager: browserManager as never,
      config
    });

    const opened = await manager.execute("canvas.session.open", {
      browserSessionId: "browser-runtime-preview"
    }) as Record<string, unknown>;
    const canvasSessionId = String(opened.canvasSessionId);
    const leaseId = String(opened.leaseId);
    const documentId = String(opened.documentId);

    const loaded = await manager.execute("canvas.document.load", {
      canvasSessionId,
      leaseId,
      documentId
    }) as {
      document: { pages: Array<{ rootNodeId: string | null }> };
    };
    await manager.execute("canvas.plan.set", {
      canvasSessionId,
      leaseId,
      generationPlan: structuredClone(validGenerationPlan)
    });

    await manager.execute("canvas.code.bind", {
      canvasSessionId,
      leaseId,
      nodeId: loaded.document.pages[0]?.rootNodeId,
      bindingId: "binding_runtime",
      repoPath: sourcePath,
      exportName: "RuntimeView",
      projection: "bound_app_runtime",
      runtimeRootSelector: "#runtime-root"
    });

    await expect(manager.execute("canvas.preview.render", {
      canvasSessionId,
      leaseId,
      targetId: "tab-preview",
      prototypeId: "proto_home_default"
    })).resolves.toMatchObject({
      renderStatus: "rendered",
      previewState: "focused"
    });
    expect(String(browserManager.goto.mock.calls[0]?.[1])).toBe("https://example.com/");
    expect(runtimeRoot.innerHTML).toContain("data-node-id");
    expect(await manager.execute("canvas.feedback.poll", {
      canvasSessionId,
      categories: ["render"]
    })).toMatchObject({
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

    const runtimeSession = (manager as {
      sessions: Map<string, {
        store: {
          getRevision: () => number;
          getDocument: () => {
            prototypes: Array<{
              id: string;
              pageId: string;
              route: string;
              name: string;
              defaultVariants?: Record<string, string>;
              metadata?: Record<string, unknown>;
            }>;
          };
        };
      }>;
    }).sessions.get(canvasSessionId);
    const runtimePrototype = runtimeSession?.store.getDocument().prototypes.find((entry) => entry.id === "proto_home_default");
    if (!runtimeSession || !runtimePrototype) {
      throw new Error("Missing runtime preview prototype");
    }
    await manager.execute("canvas.document.patch", {
      canvasSessionId,
      leaseId,
      baseRevision: runtimeSession.store.getRevision(),
      patches: [{
        op: "prototype.upsert",
        prototype: {
          ...runtimePrototype,
          route: ""
        }
      }]
    });

    await expect(manager.execute("canvas.preview.render", {
      canvasSessionId,
      leaseId,
      targetId: "tab-preview",
      prototypeId: "proto_home_default"
    })).resolves.toMatchObject({
      renderStatus: "rendered",
      previewState: "focused"
    });
    expect(String(browserManager.goto.mock.calls.at(-1)?.[1])).toBe("https://example.com/app");

    runtimeRoot.removeAttribute("data-binding-id");
    await manager.execute("canvas.preview.render", {
      canvasSessionId,
      leaseId,
      targetId: "tab-preview",
      prototypeId: "proto_home_default"
    });
    expect(String(browserManager.goto.mock.calls.at(-1)?.[1])).toContain("data:text/html");
    const renderFeedback = await manager.execute("canvas.feedback.poll", {
      canvasSessionId,
      categories: ["render"]
    }) as {
      items: Array<{ details?: { projection?: string; fallbackReason?: string | null } }>;
    };
    expect(renderFeedback.items.some((item) => item.details?.projection === "canvas_html" && item.details.fallbackReason === "runtime_instrumentation_missing")).toBe(true);
  });

  it("falls back explicitly when a bound runtime preview lacks a runtime root selector", async () => {
    const sourcePath = join(worktree, "RuntimeNoSelector.tsx");
    await writeFile(sourcePath, [
      "export function RuntimeNoSelector() {",
      "  return <section>Runtime no selector</section>;",
      "}",
      ""
    ].join("\n"));

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
      networkPoll: vi.fn().mockResolvedValue({ events: [], nextSeq: 0 })
    };

    const manager = new CanvasManager({
      worktree,
      browserManager: browserManager as never,
      config
    });

    const opened = await manager.execute("canvas.session.open", {
      browserSessionId: "browser-runtime-no-selector"
    }) as Record<string, unknown>;
    const canvasSessionId = String(opened.canvasSessionId);
    const leaseId = String(opened.leaseId);
    const documentId = String(opened.documentId);

    const loaded = await manager.execute("canvas.document.load", {
      canvasSessionId,
      leaseId,
      documentId
    }) as {
      document: { pages: Array<{ rootNodeId: string | null }> };
    };
    await manager.execute("canvas.plan.set", {
      canvasSessionId,
      leaseId,
      generationPlan: structuredClone(validGenerationPlan)
    });

    await manager.execute("canvas.code.bind", {
      canvasSessionId,
      leaseId,
      nodeId: loaded.document.pages[0]?.rootNodeId,
      bindingId: "binding_runtime_no_selector",
      repoPath: sourcePath,
      exportName: "RuntimeNoSelector",
      projection: "bound_app_runtime"
    });

    await expect(manager.execute("canvas.preview.render", {
      canvasSessionId,
      leaseId,
      targetId: "tab-preview",
      prototypeId: "proto_home_default"
    })).resolves.toMatchObject({
      renderStatus: "rendered",
      previewState: "focused",
      degradeReason: null
    });

    expect(String(browserManager.goto.mock.calls.at(-1)?.[1])).toContain("data:text/html");
    expect(await manager.execute("canvas.feedback.poll", {
      canvasSessionId,
      categories: ["render"]
    })).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          class: "render-complete",
          details: expect.objectContaining({
            projection: "canvas_html",
            fallbackReason: "runtime_bridge_unavailable"
          })
        })
      ])
    });
  });

  it("reuses the last stable source url after a runtime fallback", async () => {
    const runtimeWindow = new Window();
    vi.stubGlobal("window", runtimeWindow);
    vi.stubGlobal("document", runtimeWindow.document);
    vi.stubGlobal("HTMLElement", runtimeWindow.HTMLElement);

    const runtimeRoot = runtimeWindow.document.createElement("section");
    runtimeRoot.id = "runtime-root";
    runtimeRoot.setAttribute("data-binding-id", "binding_runtime_recover");
    runtimeWindow.document.body.appendChild(runtimeRoot);

    const sourcePath = join(worktree, "RuntimeRecover.tsx");
    await writeFile(sourcePath, [
      "export function RuntimeRecover() {",
      "  return <section>Runtime recover</section>;",
      "}",
      ""
    ].join("\n"));

    let currentUrl = "https://example.com/app";
    let bridgeCallCount = 0;
    const browserManager = {
      status: vi.fn().mockImplementation(async () => ({
        mode: "managed",
        activeTargetId: "tab-preview",
        url: currentUrl,
        title: "App"
      })),
      goto: vi.fn().mockImplementation(async (_sessionId: string, url: string) => {
        currentUrl = url;
        return { finalUrl: url, status: 200, timingMs: 5 };
      }),
      screenshot: vi.fn().mockResolvedValue({ path: undefined }),
      perfMetrics: vi.fn().mockResolvedValue({ metrics: [] }),
      consolePoll: vi.fn().mockResolvedValue({ events: [], nextSeq: 0 }),
      networkPoll: vi.fn().mockResolvedValue({ events: [], nextSeq: 0 }),
      withPage: vi.fn().mockImplementation(async (_sessionId: string, _targetId: string | null, fn: (page: unknown) => Promise<unknown>) => {
        bridgeCallCount += 1;
        if (bridgeCallCount === 1) {
          runtimeRoot.removeAttribute("data-binding-id");
        } else {
          runtimeRoot.setAttribute("data-binding-id", "binding_runtime_recover");
        }
        return await fn({
          evaluate: vi.fn(async (pageFunction: (arg: unknown) => unknown, arg: unknown) => await pageFunction(arg))
        });
      })
    };

    const manager = new CanvasManager({
      worktree,
      browserManager: browserManager as never,
      config
    });

    const opened = await manager.execute("canvas.session.open", {
      browserSessionId: "browser-runtime-recover"
    }) as Record<string, unknown>;
    const canvasSessionId = String(opened.canvasSessionId);
    const leaseId = String(opened.leaseId);
    const documentId = String(opened.documentId);

    const loaded = await manager.execute("canvas.document.load", {
      canvasSessionId,
      leaseId,
      documentId
    }) as {
      document: { pages: Array<{ rootNodeId: string | null }> };
    };
    await manager.execute("canvas.plan.set", {
      canvasSessionId,
      leaseId,
      generationPlan: structuredClone(validGenerationPlan)
    });
    await manager.execute("canvas.code.bind", {
      canvasSessionId,
      leaseId,
      nodeId: loaded.document.pages[0]?.rootNodeId,
      bindingId: "binding_runtime_recover",
      repoPath: sourcePath,
      exportName: "RuntimeRecover",
      projection: "bound_app_runtime",
      runtimeRootSelector: "#runtime-root"
    });

    const runtimeSession = (manager as {
      sessions: Map<string, {
        store: {
          getRevision: () => number;
          getDocument: () => {
            prototypes: Array<{
              id: string;
              pageId: string;
              route: string;
              name: string;
              defaultVariants?: Record<string, string>;
              metadata?: Record<string, unknown>;
            }>;
          };
        };
      }>;
    }).sessions.get(canvasSessionId);
    const runtimePrototype = runtimeSession?.store.getDocument().prototypes.find((entry) => entry.id === "proto_home_default");
    if (!runtimeSession || !runtimePrototype) {
      throw new Error("Missing runtime preview recovery prototype");
    }
    await manager.execute("canvas.document.patch", {
      canvasSessionId,
      leaseId,
      baseRevision: runtimeSession.store.getRevision(),
      patches: [{
        op: "prototype.upsert",
        prototype: {
          ...runtimePrototype,
          route: ""
        }
      }]
    });

    await manager.execute("canvas.preview.render", {
      canvasSessionId,
      leaseId,
      targetId: "tab-preview",
      prototypeId: "proto_home_default"
    });
    expect(currentUrl).toContain("data:text/html");

    await manager.execute("canvas.preview.render", {
      canvasSessionId,
      leaseId,
      targetId: "tab-preview",
      prototypeId: "proto_home_default"
    });

    expect(currentUrl).toBe("https://example.com/app");
    const status = await manager.execute("canvas.session.status", {
      canvasSessionId
    }) as {
      targets: Array<{ projection?: string; fallbackReason?: string | null; sourceUrl?: string | null }>;
    };
    expect(status.targets[0]).toMatchObject({
      projection: "bound_app_runtime",
      fallbackReason: null,
      sourceUrl: "https://example.com/app"
    });
  });
});
