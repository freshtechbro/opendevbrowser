import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { resolveConfig } from "../src/config";
import { createDefaultCanvasDocument } from "../src/canvas/document-store";
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
    expect(overlay.previewState).toBe("overlay_mounted");

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

    const feedback = await manager.execute("canvas.feedback.poll", {
      canvasSessionId,
      afterCursor: null
    }) as { items: Array<{ category: string }>; nextCursor: string | null };
    expect(feedback.items.map((item) => item.category)).toEqual(expect.arrayContaining(["console", "network", "render"]));
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
        return { targetId: "tab-501", previewState: "design_tab_open" };
      }
      if (command === "canvas.tab.sync") {
        return { ok: true };
      }
      if (command === "canvas.overlay.mount") {
        return { mountId: "mount-ext", targetId: "tab-preview", previewState: "overlay_mounted", capabilities: { selection: true } };
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
  });

  it("covers repo-backed sessions and non-browser guard paths", async () => {
    const document = createDefaultCanvasDocument("dc_repo_backed");
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
      planStatus: "accepted"
    });
    expect(await manager.execute("canvas.capabilities.get", { canvasSessionId })).toMatchObject({
      documentId: "dc_repo_backed"
    });
    expect(await manager.execute("canvas.plan.get", { canvasSessionId, leaseId })).toMatchObject({
      planStatus: "accepted"
    });
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
    })).toEqual({
      items: [],
      nextCursor: null,
      retention: { total: 0 }
    });
    expect(await manager.execute("canvas.feedback.poll", {
      canvasSessionId,
      afterCursor: "cursor_404"
    })).toEqual({
      items: [],
      nextCursor: "cursor_404",
      retention: { total: 0 }
    });
    expect(await manager.execute("canvas.feedback.subscribe", {
      canvasSessionId,
      afterCursor: "cursor_404"
    })).toMatchObject({
      cursor: "cursor_404"
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
    })).rejects.toThrow("Missing selectionHint");
    await expect(manager.execute("canvas.overlay.select", {
      canvasSessionId,
      leaseId,
      mountId: "mount-missing",
      targetId: "tab-preview",
      selectionHint: {}
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
      previewState: "overlay_idle"
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
    })).rejects.toThrow("Unknown preview target: tab-preview");
    await expect(manager.execute("canvas.session.status", {
      canvasSessionId: "canvas_missing"
    })).rejects.toThrow("Unknown canvas session: canvas_missing");
    await expect(manager.execute("canvas.plan.get", {
      canvasSessionId,
      leaseId: "lease_wrong"
    })).rejects.toThrow(`Lease mismatch for ${canvasSessionId}`);
    await expect(manager.execute("canvas.unknown", {})).rejects.toThrow("Unsupported canvas command: canvas.unknown");

    expect(await manager.execute("canvas.session.close", {
      canvasSessionId,
      leaseId
    })).toMatchObject({
      ok: true,
      releasedTargets: []
    });
  });

  it("covers preview resolution and revision conflict branches", async () => {
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
    await expect(manager.execute("canvas.preview.render", {
      canvasSessionId,
      leaseId,
      targetId: "tab-preview",
      prototypeId: "proto_home_default"
    })).rejects.toThrow("Unable to resolve preview target URL.");
    expect(await manager.execute("canvas.preview.render", {
      canvasSessionId,
      leaseId,
      targetId: "tab-preview",
      prototypeId: "proto_relative"
    })).toMatchObject({
      renderStatus: "rendered"
    });
    expect(browserManager.goto).toHaveBeenCalledWith("browser-preview", "preview", "load", 30000, undefined, "tab-preview");

    currentUrl = "https://example.com/app";
    expect(await manager.execute("canvas.preview.render", {
      canvasSessionId,
      leaseId,
      targetId: "tab-preview",
      prototypeId: "proto_routeless"
    })).toMatchObject({
      renderStatus: "rendered",
      previewState: "rendered"
    });
    expect(browserManager.goto).toHaveBeenCalledWith("browser-preview", "https://example.com/app", "load", 30000, undefined, "tab-preview");
    expect(await manager.execute("canvas.preview.render", {
      canvasSessionId,
      leaseId,
      targetId: "tab-preview",
      prototypeId: "proto_home_default"
    })).toMatchObject({
      renderStatus: "rendered",
      previewState: "rendered"
    });
    expect(browserManager.goto).toHaveBeenCalledWith("browser-preview", "https://example.com/", "load", 30000, undefined, "tab-preview");
    browserManager.consolePoll.mockResolvedValueOnce({ events: [], nextSeq: 3 });
    browserManager.networkPoll.mockResolvedValueOnce({ events: [], nextSeq: 0 });
    expect(await manager.execute("canvas.preview.render", {
      canvasSessionId,
      leaseId,
      targetId: "tab-preview",
      prototypeId: "proto_home_default"
    })).toMatchObject({
      renderStatus: "rendered",
      previewState: "rendered"
    });

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
      previewState: "rendered"
    });

    const feedback = await manager.execute("canvas.feedback.poll", {
      canvasSessionId,
      afterCursor: null
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
      selectionHint: {}
    })).toMatchObject({
      selection: { matched: false }
    });

    const classless = new FakeHTMLElement("BUTTON", () => {});
    classless.textContent = "CTA";
    dom.registerSelector(".cta", classless);
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
    expect(overlay.previewState).toBe("overlay_mounted");
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
    expect(canvasClientRequestMock).toHaveBeenCalledWith("canvas.overlay.unmount", expect.any(Object), canvasSessionId, 30000, leaseId);
    expect(canvasClientRequestMock).toHaveBeenCalledWith("canvas.tab.close", expect.any(Object), canvasSessionId, 30000, leaseId);
  });
});
