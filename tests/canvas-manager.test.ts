import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { readFileSync } from "fs";
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
    hasPendingRequests() {
      return false;
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

const figmaFileFixture = readJsonFixture("tests/fixtures/figma/file-response.json");
const figmaNodesFixture = readJsonFixture("tests/fixtures/figma/nodes-response.json");

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
    expect(opened).toMatchObject({
      preflightState: "handshake_read",
      planStatus: "missing",
      mutationPolicy: {
        allowedBeforePlan: ["canvas.capabilities.get", "canvas.plan.get", "canvas.plan.set", "canvas.document.load", "canvas.session.attach", "canvas.session.status"]
      },
      guidance: {
        recommendedNextCommands: ["canvas.plan.set"],
        reason: "Handshake is complete. Submit a complete generationPlan before mutation."
      }
    });

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
    }) as {
      document: { pages: Array<{ rootNodeId: string | null }> };
      handshake: Record<string, unknown>;
    };
    const rootNodeId = loaded.document.pages[0]?.rootNodeId;
    expect(rootNodeId).toBeTruthy();
    expect(loaded.handshake).toMatchObject({
      preflightState: "handshake_read",
      planStatus: "missing",
      guidance: {
        recommendedNextCommands: ["canvas.plan.set"],
        reason: "Handshake is complete. Submit a complete generationPlan before mutation."
      }
    });

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
    expect(planResult).toMatchObject({
      planStatus: "accepted",
      preflightState: "plan_accepted",
      guidance: {
        recommendedNextCommands: ["canvas.document.patch", "canvas.preview.render", "canvas.feedback.poll", "canvas.document.save"],
        reason: "generationPlan is accepted. Patch the document, render the preview, inspect feedback, and save when the iteration is stable."
      }
    });

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
    expect(patchResult).toMatchObject({
      guidance: {
        recommendedNextCommands: ["canvas.preview.render", "canvas.feedback.poll", "canvas.document.save"],
        reason: "The patch is applied. Render the preview, review feedback, and save when the surface is ready."
      }
    });

    const saveResult = await manager.execute("canvas.document.save", {
      canvasSessionId,
      leaseId,
      repoPath: ".opendevbrowser/canvas/documents/test-managed.json"
    }) as Record<string, unknown>;
    expect(String(saveResult.repoPath)).toContain("test-managed.json");
    expect(saveResult).toMatchObject({
      guidance: {
        recommendedNextCommands: ["canvas.document.export", "canvas.session.status", "canvas.document.patch"],
        reason: "The document is persisted. Export deliverables, inspect session state, or keep iterating with another patch."
      }
    });

    const htmlExport = await manager.execute("canvas.document.export", {
      canvasSessionId,
      leaseId,
      exportTarget: "html_bundle"
    }) as { artifactRefs: string[]; guidance: Record<string, unknown> };
    expect(htmlExport.artifactRefs[0]).toContain(".html");
    expect(htmlExport.guidance).toMatchObject({
      recommendedNextCommands: ["canvas.session.status", "canvas.document.patch"],
      reason: "Artifacts are exported. Inspect session state or continue patching if another iteration is required."
    });

    const componentExport = await manager.execute("canvas.document.export", {
      canvasSessionId,
      leaseId,
      exportTarget: "react_component"
    }) as { artifactRefs: string[]; guidance: Record<string, unknown> };
    expect(componentExport.artifactRefs[0]).toContain(".tsx");
    expect(componentExport.guidance).toMatchObject({
      recommendedNextCommands: ["canvas.session.status", "canvas.document.patch"],
      reason: "Artifacts are exported. Inspect session state or continue patching if another iteration is required."
    });

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
    expect(browserManager.screenshot).toHaveBeenCalledWith("browser-managed", { targetId: "tab-preview" });
    expect(preview).toMatchObject({
      guidance: {
        recommendedNextCommands: ["canvas.feedback.poll", "canvas.document.patch", "canvas.document.save"],
        reason: "Preview output is available. Poll feedback, patch again if needed, and save when the runtime matches the contract."
      }
    });

    const feedback = await manager.execute("canvas.feedback.poll", {
      canvasSessionId,
      afterCursor: null
    }) as {
      items: Array<{ category: string }>;
      nextCursor: string | null;
      guidance: Record<string, unknown>;
    };
    expect(feedback.items.map((item) => item.category)).toEqual(expect.arrayContaining(["console", "network", "performance", "render"]));
    expect(feedback.nextCursor).toBeTruthy();
    expect(feedback.guidance).toMatchObject({
      recommendedNextCommands: ["canvas.document.patch", "canvas.preview.render", "canvas.document.save"],
      reason: "Feedback is available. Patch the document to address issues, rerender, and save when blockers are cleared."
    });

    const refreshed = await manager.execute("canvas.preview.refresh", {
      canvasSessionId,
      leaseId,
      targetId: "tab-preview",
      refreshMode: "thumbnail"
    }) as Record<string, unknown>;
    expect(refreshed.targetId).toBe("tab-preview");
    expect(refreshed).toMatchObject({
      guidance: {
        recommendedNextCommands: ["canvas.feedback.poll", "canvas.document.patch", "canvas.document.save"],
        reason: "Preview output is available. Poll feedback, patch again if needed, and save when the runtime matches the contract."
      }
    });

    const subscribed = await manager.execute("canvas.feedback.subscribe", {
      canvasSessionId
    }) as Record<string, unknown>;
    expect(subscribed).toMatchObject({
      subscriptionId: expect.stringMatching(/^canvas_sub_/),
      heartbeatMs: 15000,
      expiresAt: null,
      initialItems: expect.any(Array),
      activeTargetIds: ["tab-preview"]
    });

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

  it("imports figma content through the public command and degrades variables explicitly", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/files/AbCdEf12345/variables/local")) {
        return new Response(JSON.stringify({ err: "Missing required scope" }), {
          status: 403,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("/files/AbCdEf12345/nodes")) {
        return new Response(JSON.stringify(figmaNodesFixture), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("/files/AbCdEf12345")) {
        return new Response(JSON.stringify(figmaFileFixture), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("/images/AbCdEf12345") && url.includes("format=png")) {
        return new Response(JSON.stringify({
          images: {
            "5:1": "https://cdn.example.com/5:1.png"
          }
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("/images/AbCdEf12345") && url.includes("format=svg")) {
        return new Response(JSON.stringify({
          images: {
            "5:1": "https://cdn.example.com/5:1.svg",
            "6:1": "https://cdn.example.com/6:1.svg"
          }
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.endsWith(".png")) {
        return new Response("png-binary", {
          status: 200,
          headers: { "content-type": "image/png" }
        });
      }
      if (url.endsWith(".svg")) {
        return new Response("<svg />", {
          status: 200,
          headers: { "content-type": "image/svg+xml" }
        });
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    }));

    const manager = new CanvasManager({
      worktree,
      browserManager: {
        status: vi.fn(),
        closeTarget: vi.fn()
      } as never,
      config: resolveConfig({
        integrations: {
          figma: {
            accessToken: "figma-config-token"
          }
        }
      })
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

    const imported = await manager.execute("canvas.document.import", {
      canvasSessionId,
      leaseId,
      sourceUrl: "https://www.figma.com/file/AbCdEf12345/Marketing-Landing",
      frameworkId: "react"
    }) as {
      degradedFailureCodes: string[];
      importedPageIds: string[];
      importedInventoryItemIds: string[];
      importedAssetIds: string[];
      summary: { importSources?: string[]; lastImportAt?: string | null };
    };

    expect(imported.importedPageIds).toHaveLength(1);
    expect(imported.importedInventoryItemIds).toEqual([
      "figma-component-ButtonSet",
      "figma-component-ButtonComponent"
    ]);
    expect(imported.importedAssetIds.sort()).toEqual([
      "figma-AbCdEf12345-5-1-png",
      "figma-AbCdEf12345-5-1-svg",
      "figma-AbCdEf12345-6-1-svg"
    ]);
    expect(imported.degradedFailureCodes).toContain("scope_denied");
    expect(imported.degradedFailureCodes).toContain("framework_materializer_missing");
    expect(imported.summary.importSources).toContain("figma.file");
    expect(imported.summary.lastImportAt).toBeTruthy();
  });

  it("imports figma node selections with explicit revisions and no degraded paths when variables are skipped", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/files/AbCdEf12345/nodes")) {
        return new Response(JSON.stringify(figmaNodesFixture), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("/images/AbCdEf12345") && url.includes("format=png")) {
        return new Response(JSON.stringify({
          images: {
            "5:1": "https://cdn.example.com/5:1.png"
          }
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("/images/AbCdEf12345") && url.includes("format=svg")) {
        return new Response(JSON.stringify({
          images: {
            "5:1": "https://cdn.example.com/5:1.svg",
            "6:1": "https://cdn.example.com/6:1.svg"
          }
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.endsWith(".png")) {
        return new Response("png-binary", {
          status: 200,
          headers: { "content-type": "image/png" }
        });
      }
      if (url.endsWith(".svg")) {
        return new Response("<svg />", {
          status: 200,
          headers: { "content-type": "image/svg+xml" }
        });
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const manager = new CanvasManager({
      worktree,
      browserManager: {
        status: vi.fn(),
        closeTarget: vi.fn()
      } as never,
      config: resolveConfig({
        integrations: {
          figma: {
            accessToken: "figma-config-token"
          }
        }
      })
    });

    const opened = await manager.execute("canvas.session.open", {
      browserSessionId: "browser-managed"
    }) as Record<string, unknown>;
    const canvasSessionId = String(opened.canvasSessionId);
    const leaseId = String(opened.leaseId);
    const planned = await manager.execute("canvas.plan.set", {
      canvasSessionId,
      leaseId,
      generationPlan: structuredClone(validGenerationPlan)
    }) as { documentRevision: number };

    const imported = await manager.execute("canvas.document.import", {
      canvasSessionId,
      leaseId,
      baseRevision: planned.documentRevision,
      sourceUrl: "https://www.figma.com/design/AbCdEf12345/Marketing-Landing?node-id=2%3A1",
      includeVariables: false
    }) as {
      degradedFailureCodes: string[];
      importedPageIds: string[];
      importedNodeIds: string[];
      summary: { importSources?: string[]; lastImportAt?: string | null };
    };

    expect(imported.degradedFailureCodes).toEqual([]);
    expect(imported.importedPageIds).toHaveLength(1);
    expect(imported.importedNodeIds.length).toBeGreaterThan(0);
    expect(imported.summary.importSources).toContain("figma.nodes");
    expect(imported.summary.lastImportAt).toBeTruthy();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/variables/local"))).toBe(false);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/files/AbCdEf12345/nodes"))).toBe(true);
  });

  it("rethrows unexpected figma variable import failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/files/AbCdEf12345/variables/local")) {
        throw new Error("variables socket reset");
      }
      if (url.includes("/files/AbCdEf12345")) {
        return new Response(JSON.stringify(figmaFileFixture), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    }));

    const manager = new CanvasManager({
      worktree,
      browserManager: {
        status: vi.fn(),
        closeTarget: vi.fn()
      } as never,
      config: resolveConfig({
        integrations: {
          figma: {
            accessToken: "figma-config-token"
          }
        }
      })
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

    await expect(manager.execute("canvas.document.import", {
      canvasSessionId,
      leaseId,
      sourceUrl: "https://www.figma.com/file/AbCdEf12345/Marketing-Landing"
    })).rejects.toThrow("variables socket reset");
  });

  it("requires an accepted generation plan before importing figma content", async () => {
    const manager = new CanvasManager({
      worktree,
      browserManager: {
        status: vi.fn(),
        closeTarget: vi.fn()
      } as never,
      config
    });

    const opened = await manager.execute("canvas.session.open", {}) as Record<string, unknown>;

    await expect(manager.execute("canvas.document.import", {
      canvasSessionId: String(opened.canvasSessionId),
      leaseId: String(opened.leaseId),
      sourceUrl: "https://www.figma.com/file/AbCdEf12345/Marketing-Landing"
    })).rejects.toMatchObject({
      code: "plan_required"
    });
  });

  it("rejects invalid import modes before issuing figma requests", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

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

    await expect(manager.execute("canvas.document.import", {
      canvasSessionId,
      leaseId,
      sourceUrl: "https://www.figma.com/file/AbCdEf12345/Marketing-Landing",
      mode: "bogus"
    })).rejects.toThrow("Invalid import mode: bogus");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("imports figma components-only requests with adapter provenance and asset degradation evidence", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/files/AbCdEf12345")) {
        return new Response(JSON.stringify(figmaFileFixture), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("/images/AbCdEf12345") && url.includes("format=png")) {
        return new Response(JSON.stringify({
          images: {
            "5:1": "https://cdn.example.com/5:1.png"
          }
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("/images/AbCdEf12345") && url.includes("format=svg")) {
        return new Response(JSON.stringify({
          images: {
            "5:1": "https://cdn.example.com/5:1.svg"
          }
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.endsWith(".png")) {
        return new Response("png-binary", {
          status: 200,
          headers: { "content-type": "image/png" }
        });
      }
      if (url.endsWith(".svg")) {
        return new Response("svg-down", {
          status: 503,
          headers: { "content-type": "text/plain" }
        });
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    }));

    const manager = new CanvasManager({
      worktree,
      browserManager: {
        status: vi.fn(),
        closeTarget: vi.fn()
      } as never,
      config: resolveConfig({
        integrations: {
          figma: {
            accessToken: "figma-config-token"
          }
        }
      })
    });

    const opened = await manager.execute("canvas.session.open", {}) as Record<string, unknown>;
    const canvasSessionId = String(opened.canvasSessionId);
    const leaseId = String(opened.leaseId);

    await manager.execute("canvas.plan.set", {
      canvasSessionId,
      leaseId,
      generationPlan: structuredClone(validGenerationPlan)
    });

    const imported = await manager.execute("canvas.document.import", {
      canvasSessionId,
      leaseId,
      sourceUrl: "https://www.figma.com/file/AbCdEf12345/Marketing-Landing",
      mode: "components_only",
      frameworkId: "react",
      frameworkAdapterId: "tsx-react-v1",
      includeVariables: false,
      depth: 2
    }) as {
      mode: string;
      degradedFailureCodes: string[];
      importedAssetIds: string[];
      importedInventoryItemIds: string[];
      provenance: {
        source: { adapterIds: string[] };
        metadata: { mode: string; requestedFrameworkAdapterId?: string | null };
        assetReceipts: Array<{ status: string; repoPath?: string }>;
      };
    };

    expect(imported.mode).toBe("components_only");
    expect(imported.importedInventoryItemIds.length).toBeGreaterThan(0);
    expect(imported.importedAssetIds).toContain("figma-AbCdEf12345-5-1-png");
    expect(imported.degradedFailureCodes).toContain("asset_fetch_failed");
    expect(imported.provenance.source.adapterIds).toEqual(["tsx-react-v1"]);
    expect(imported.provenance.metadata).toMatchObject({
      mode: "components_only",
      requestedFrameworkAdapterId: "tsx-react-v1"
    });
    expect(imported.provenance.assetReceipts.some((receipt) => receipt.status === "asset_fetch_failed")).toBe(true);
    expect(imported.provenance.assetReceipts.some((receipt) => typeof receipt.repoPath === "string")).toBe(true);

    await expect(manager.execute("canvas.feedback.poll", {
      canvasSessionId,
      categories: ["asset"]
    })).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          class: "figma-assets-degraded",
          evidenceRefs: expect.arrayContaining([expect.stringContaining(".png")])
        })
      ])
    });
  });

  it("tracks lease-aware history state, resets redo on new mutations, and invalidates stale stacks", async () => {
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
    const internalSession = (manager as unknown as {
      sessions: Map<string, {
        store: {
          getDocument: () => { pages: Array<{ rootNodeId: string | null; nodes: Array<{ id: string; style: Record<string, unknown> }> }> };
          getRevision: () => number;
          applyPatches: (baseRevision: number, patches: Array<Record<string, unknown>>) => void;
        };
      }>;
    }).sessions.get(canvasSessionId);
    expect(internalSession).toBeTruthy();
    const session = internalSession as NonNullable<typeof internalSession>;
    const rootNodeId = session.store.getDocument().pages[0]?.rootNodeId as string;
    expect(rootNodeId).toBeTruthy();

    const initialSummary = await manager.execute("canvas.session.status", {
      canvasSessionId
    }) as { history: Record<string, unknown> };
    expect(initialSummary.history).toMatchObject({
      canUndo: false,
      canRedo: false,
      undoDepth: 0,
      redoDepth: 0,
      stale: false,
      depthLimit: 100
    });

    const planResult = await manager.execute("canvas.plan.set", {
      canvasSessionId,
      leaseId,
      generationPlan: structuredClone(validGenerationPlan)
    }) as { documentRevision: number };

    const emptyUndo = await manager.execute("canvas.history.undo", {
      canvasSessionId,
      leaseId
    }) as { ok: boolean; reason: string };
    expect(emptyUndo).toEqual(expect.objectContaining({
      ok: false,
      reason: "history_empty"
    }));

    await manager.execute("canvas.document.patch", {
      canvasSessionId,
      leaseId,
      baseRevision: planResult.documentRevision,
      patches: [{
        op: "node.update",
        nodeId: rootNodeId,
        changes: {
          "style.backgroundColor": "#101827"
        }
      }]
    });

    const afterPatch = await manager.execute("canvas.session.status", {
      canvasSessionId
    }) as { history: Record<string, unknown> };
    expect(afterPatch.history).toMatchObject({
      canUndo: true,
      canRedo: false,
      undoDepth: 1,
      redoDepth: 0,
      stale: false
    });

    await expect(manager.execute("canvas.history.undo", {
      canvasSessionId,
      leaseId: "lease_wrong"
    })).rejects.toThrow("The canvas lease was reclaimed or replaced.");

    const undone = await manager.execute("canvas.history.undo", {
      canvasSessionId,
      leaseId
    }) as {
      ok: boolean;
      documentRevision: number;
      summary: { history: Record<string, unknown> };
    };
    expect(undone.ok).toBe(true);
    expect(undone.summary.history).toMatchObject({
      canUndo: false,
      canRedo: true,
      undoDepth: 0,
      redoDepth: 1,
      stale: false
    });
    expect(session.store.getDocument().pages[0]?.nodes.find((node) => node.id === rootNodeId)?.style.backgroundColor).not.toBe("#101827");

    const redone = await manager.execute("canvas.history.redo", {
      canvasSessionId,
      leaseId
    }) as {
      ok: boolean;
      documentRevision: number;
      summary: { history: Record<string, unknown> };
    };
    expect(redone.ok).toBe(true);
    expect(redone.summary.history).toMatchObject({
      canUndo: true,
      canRedo: false,
      undoDepth: 1,
      redoDepth: 0,
      stale: false
    });
    expect(session.store.getDocument().pages[0]?.nodes.find((node) => node.id === rootNodeId)?.style.backgroundColor).toBe("#101827");

    const undoneAgain = await manager.execute("canvas.history.undo", {
      canvasSessionId,
      leaseId
    }) as {
      documentRevision: number;
      summary: { history: Record<string, unknown> };
    };
    expect(undoneAgain.summary.history).toMatchObject({
      canUndo: false,
      canRedo: true,
      undoDepth: 0,
      redoDepth: 1
    });

    await manager.execute("canvas.document.patch", {
      canvasSessionId,
      leaseId,
      baseRevision: undoneAgain.documentRevision,
      patches: [{
        op: "node.update",
        nodeId: rootNodeId,
        changes: {
          "style.borderRadius": "24px"
        }
      }]
    });

    const afterRedoReset = await manager.execute("canvas.session.status", {
      canvasSessionId
    }) as { history: Record<string, unknown> };
    expect(afterRedoReset.history).toMatchObject({
      canUndo: true,
      canRedo: false,
      undoDepth: 1,
      redoDepth: 0,
      stale: false
    });

    const driftRevision = session.store.getRevision();
    session.store.applyPatches(driftRevision, [{
      op: "node.update",
      nodeId: rootNodeId,
      changes: {
        "style.outlineColor": "#22d3ee"
      }
    }]);

    const staleSummary = await manager.execute("canvas.session.status", {
      canvasSessionId
    }) as { history: Record<string, unknown> };
    expect(staleSummary.history).toMatchObject({
      stale: true,
      undoDepth: 1
    });

    const invalidated = await manager.execute("canvas.history.undo", {
      canvasSessionId,
      leaseId
    }) as {
      ok: boolean;
      reason: string;
      summary: { history: Record<string, unknown> };
    };
    expect(invalidated).toEqual(expect.objectContaining({
      ok: false,
      reason: "history_invalidated"
    }));
    expect(invalidated.summary.history).toMatchObject({
      canUndo: false,
      canRedo: false,
      undoDepth: 0,
      redoDepth: 0,
      stale: false
    });
  });

  it("undoes generated duplicate ids, editor hierarchy changes, token mutations, and bound child removals", async () => {
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
    const session = (manager as unknown as {
      sessions: Map<string, {
        store: {
          getDocument: () => {
            designGovernance: {
              colorSystem: {
                surface: { default?: string };
              };
            };
            tokens: {
              collections: Array<{ id: string }>;
              metadata: Record<string, unknown>;
            };
            bindings: Array<{ id: string; nodeId: string }>;
            pages: Array<{
              id: string;
              rootNodeId: string | null;
              nodes: Array<{
                id: string;
                name: string;
                parentId?: string | null;
                childIds: string[];
                metadata: Record<string, unknown>;
              }>;
            }>;
          };
          getRevision: () => number;
        };
      }>;
    }).sessions.get(canvasSessionId);
    if (!session) {
      throw new Error("Missing history-coverage session");
    }
    const page = session.store.getDocument().pages[0];
    const pageId = page?.id;
    const rootNodeId = page?.rootNodeId;
    if (!pageId || !rootNodeId) {
      throw new Error("Missing root canvas page");
    }

    await manager.execute("canvas.plan.set", {
      canvasSessionId,
      leaseId,
      generationPlan: structuredClone(validGenerationPlan)
    });
    await manager.execute("canvas.document.patch", {
      canvasSessionId,
      leaseId,
      baseRevision: session.store.getRevision(),
      patches: governanceBootstrapPatches
    });

    await manager.execute("canvas.document.patch", {
      canvasSessionId,
      leaseId,
      baseRevision: session.store.getRevision(),
      patches: [
        {
          op: "node.insert",
          pageId,
          parentId: rootNodeId,
          node: {
            id: "node_history_frame",
            kind: "frame",
            name: "History Frame",
            rect: { x: 32, y: 32, width: 320, height: 220 },
            props: {},
            style: { backgroundColor: "#ffffff" },
            tokenRefs: {},
            bindingRefs: {},
            variantPatches: [],
            metadata: {}
          }
        },
        {
          op: "node.insert",
          pageId,
          parentId: "node_history_frame",
          node: {
            id: "node_history_copy",
            kind: "text",
            name: "History Copy",
            rect: { x: 64, y: 96, width: 180, height: 40 },
            props: { text: "History copy" },
            style: { color: "#0f172a" },
            tokenRefs: {},
            bindingRefs: {},
            variantPatches: [],
            metadata: {}
          }
        },
        {
          op: "node.insert",
          pageId,
          parentId: rootNodeId,
          node: {
            id: "node_history_sidebar",
            kind: "note",
            name: "History Sidebar",
            rect: { x: 400, y: 32, width: 180, height: 120 },
            props: { text: "Sidebar" },
            style: { backgroundColor: "#f8fafc" },
            tokenRefs: {},
            bindingRefs: {},
            variantPatches: [],
            metadata: {}
          }
        },
        {
          op: "binding.set",
          nodeId: "node_history_copy",
          binding: {
            id: "binding_history_copy",
            kind: "component-prop",
            selector: "props.text",
            componentName: "HistoryTitle",
            metadata: { source: "cms" }
          }
        }
      ]
    });

    await manager.execute("canvas.document.patch", {
      canvasSessionId,
      leaseId,
      baseRevision: session.store.getRevision(),
      patches: [
        {
          op: "node.reparent",
          nodeId: "node_history_sidebar",
          parentId: "node_history_frame",
          index: 0
        },
        {
          op: "node.reorder",
          nodeId: "node_history_sidebar",
          index: 1
        },
        {
          op: "node.duplicate",
          nodeId: "node_history_frame",
          parentId: rootNodeId,
          index: 1
        },
        {
          op: "node.visibility.set",
          nodeId: "node_history_copy",
          hidden: true
        },
        {
          op: "token.set",
          path: "colorSystem.surface.default",
          value: "#112233"
        },
        {
          op: "tokens.merge",
          tokens: {
            collections: [{
              id: "collection_history_tokens",
              name: "History Tokens",
              items: [{
                id: "token_history_primary",
                path: "history/primary",
                value: "#112233",
                type: "color",
                description: null,
                modes: [],
                metadata: {}
              }],
              metadata: {}
            }],
            metadata: {
              activeModeId: "dark"
            }
          }
        }
      ]
    });

    const afterComposite = session.store.getDocument();
    expect(afterComposite.pages[0]?.nodes.filter((node) => node.id === "node_history_frame" || node.id.startsWith("node_history_frame_copy_"))).toHaveLength(2);
    expect(afterComposite.pages[0]?.nodes.find((node) => node.id === "node_history_sidebar")?.parentId).toBe("node_history_frame");
    expect(afterComposite.pages[0]?.nodes.find((node) => node.id === "node_history_copy")?.metadata.visibility).toEqual({ hidden: true });
    expect(afterComposite.designGovernance.colorSystem.surface.default).toBe("#112233");
    expect(afterComposite.tokens.collections.some((collection) => collection.id === "collection_history_tokens")).toBe(true);
    expect(afterComposite.tokens.metadata.activeModeId).toBe("dark");

    const undoneComposite = await manager.execute("canvas.history.undo", {
      canvasSessionId,
      leaseId
    }) as { ok: boolean };
    expect(undoneComposite.ok).toBe(true);

    const afterUndo = session.store.getDocument();
    expect(afterUndo.pages[0]?.nodes.filter((node) => node.id === "node_history_frame" || node.id.startsWith("node_history_frame_copy_"))).toHaveLength(1);
    expect(afterUndo.pages[0]?.nodes.find((node) => node.id === "node_history_sidebar")?.parentId).toBe(rootNodeId);
    expect(afterUndo.pages[0]?.nodes.find((node) => node.id === "node_history_copy")?.metadata.visibility).toEqual({ hidden: false });
    expect(afterUndo.designGovernance.colorSystem.surface.default).not.toBe("#112233");
    expect(afterUndo.tokens.collections.some((collection) => collection.id === "collection_history_tokens")).toBe(false);
    expect(afterUndo.tokens.metadata.activeModeId).toBeUndefined();

    await manager.execute("canvas.document.patch", {
      canvasSessionId,
      leaseId,
      baseRevision: session.store.getRevision(),
      patches: [{
        op: "node.remove",
        nodeId: "node_history_copy"
      }]
    });
    expect(session.store.getDocument().pages[0]?.nodes.find((node) => node.id === "node_history_copy")).toBeUndefined();
    expect(session.store.getDocument().bindings.find((binding) => binding.id === "binding_history_copy")).toBeUndefined();

    const undoneRemove = await manager.execute("canvas.history.undo", {
      canvasSessionId,
      leaseId
    }) as { ok: boolean };
    expect(undoneRemove.ok).toBe(true);
    expect(session.store.getDocument().pages[0]?.nodes.find((node) => node.id === "node_history_copy")).toMatchObject({
      parentId: "node_history_frame"
    });
  expect(session.store.getDocument().bindings.find((binding) => binding.id === "binding_history_copy")).toMatchObject({
    nodeId: "node_history_copy"
  });
});

it("covers duplicate-history normalization for later-page nodes, missing descendants, and unknown node ids", async () => {
  const manager = new CanvasManager({
    worktree,
    browserManager: {
      status: vi.fn(),
      closeTarget: vi.fn()
    } as never,
    config
  });
  const managerAny = manager as unknown as {
    normalizeHistoryAwarePatches: (
      document: ReturnType<typeof createDefaultCanvasDocument>,
      patches: Array<Record<string, unknown>>
    ) => Array<Record<string, unknown>>;
  };

  const document = createDefaultCanvasDocument("dc_history_duplicate_branches");
  const firstPage = document.pages[0];
  const templateRoot = firstPage?.nodes.find((node) => node.id === firstPage.rootNodeId);
  if (!firstPage || !templateRoot) {
    throw new Error("Expected default canvas root node");
  }

  document.pages.push({
    ...structuredClone(firstPage),
    id: "page_history_secondary",
    name: "History Secondary",
    rootNodeId: "node_history_secondary_root",
    nodes: [
      {
        ...structuredClone(templateRoot),
        id: "node_history_secondary_root",
        name: "History Secondary Root",
        parentId: null,
        childIds: ["node_history_secondary_frame"]
      },
      {
        ...structuredClone(templateRoot),
        id: "node_history_secondary_frame",
        name: "History Secondary Frame",
        parentId: "node_history_secondary_root",
        childIds: ["node_history_missing_descendant"]
      }
    ]
  });

  const [normalizedPatch] = managerAny.normalizeHistoryAwarePatches(document, [{
    op: "node.duplicate",
    nodeId: "node_history_secondary_frame"
  }]) as Array<{ nodeId: string; idMap?: Record<string, string> }>;

  expect(normalizedPatch.nodeId).toBe("node_history_secondary_frame");
  expect(Object.keys(normalizedPatch.idMap ?? {})).toEqual(["node_history_secondary_frame"]);
  expect(managerAny.normalizeHistoryAwarePatches(document, [{
    op: "node.duplicate",
    nodeId: "node_history_secondary_frame",
    idMap: {
      node_history_secondary_frame: "node_history_secondary_frame_copy_fixed"
    }
  }])).toEqual([{
    op: "node.duplicate",
    nodeId: "node_history_secondary_frame",
    idMap: {
      node_history_secondary_frame: "node_history_secondary_frame_copy_fixed"
    }
  }]);

  expect(() => managerAny.normalizeHistoryAwarePatches(document, [{
    op: "node.duplicate",
    nodeId: "node_history_unknown"
  }])).toThrow("Unknown node: node_history_unknown");
});

it("resets history when inverse patches cannot be synthesized for duplicate or missing inventory removals", async () => {
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
  const internal = manager as unknown as {
    sessions: Map<string, {
      editorSelection: { pageId: string | null; nodeId: string | null; targetId: string | null; updatedAt: string | null };
      editorViewport: { x: number; y: number; zoom: number };
      history: { undoStack: unknown[]; redoStack: unknown[] };
    }>;
    recordHistoryEntry: (
      session: {
        editorSelection: { pageId: string | null; nodeId: string | null; targetId: string | null; updatedAt: string | null };
        editorViewport: { x: number; y: number; zoom: number };
        history: { undoStack: unknown[]; redoStack: unknown[] };
      },
      beforeDocument: ReturnType<typeof createDefaultCanvasDocument>,
      patches: Array<Record<string, unknown>>,
      beforeSelection: { pageId: string | null; nodeId: string | null; targetId: string | null; updatedAt: string | null },
      beforeViewport: { x: number; y: number; zoom: number },
      appliedRevision: number,
      source: "agent" | "editor"
    ) => void;
  };
  const session = internal.sessions.get(opened.canvasSessionId);
  if (!session) {
    throw new Error("Expected canvas session");
  }

  const duplicateDocument = createDefaultCanvasDocument("dc_history_duplicate_null_inverse");
  const duplicateRootNodeId = duplicateDocument.pages[0]?.rootNodeId;
  if (!duplicateRootNodeId) {
    throw new Error("Expected duplicate root node id");
  }

  session.history.undoStack.push({ stale: true });
  session.history.redoStack.push({ stale: true });
  internal.recordHistoryEntry(
    session,
    duplicateDocument,
    [{ op: "node.duplicate", nodeId: duplicateRootNodeId, idMap: {} }],
    session.editorSelection,
    session.editorViewport,
    2,
    "agent"
  );
  expect(session.history.undoStack).toEqual([]);
  expect(session.history.redoStack).toEqual([]);

  session.history.undoStack.push({ stale: true });
  session.history.redoStack.push({ stale: true });
  internal.recordHistoryEntry(
    session,
    createDefaultCanvasDocument("dc_history_inventory_null_inverse"),
    [{ op: "inventory.remove", itemId: "inventory_missing" }],
    session.editorSelection,
    session.editorViewport,
    3,
    "agent"
  );
  expect(session.history.undoStack).toEqual([]);
  expect(session.history.redoStack).toEqual([]);
});

  it("undoes inventory upserts, seeded inventory removal, starter patches, and visibility branches together", async () => {
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

    await manager.execute("canvas.starter.apply", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      starterId: "dashboard.analytics",
      frameworkId: "react"
    });

    const session = (manager as unknown as {
      sessions: Map<string, {
        store: {
          getDocument: () => {
            meta: { starter: Record<string, unknown> | null };
            componentInventory: Array<{
              id: string;
              description: string | null;
            }>;
            pages: Array<{
              rootNodeId: string | null;
              nodes: Array<{
                id: string;
                metadata: Record<string, unknown>;
              }>;
            }>;
          };
          getRevision: () => number;
        };
      }>;
    }).sessions.get(opened.canvasSessionId);
    if (!session) {
      throw new Error("Missing composite history session");
    }

    const documentBefore = structuredClone(session.store.getDocument());
    const rootNodeId = documentBefore.pages[0]?.rootNodeId;
    const seededItem = documentBefore.componentInventory.find((item) => item.id === "kit.dashboard.analytics-core.metric-card");
    if (!rootNodeId || !seededItem || !documentBefore.meta.starter) {
      throw new Error("Missing starter-backed history fixture");
    }

    const extraItem = structuredClone({
      ...seededItem,
      id: "kit.dashboard.analytics-core.metric-card-extra",
      description: "Transient history inventory item"
    });

    await manager.execute("canvas.document.patch", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      baseRevision: session.store.getRevision(),
      patches: [
        {
          op: "inventory.upsert",
          item: extraItem
        },
        {
          op: "inventory.upsert",
          item: {
            ...extraItem,
            description: "Updated transient history inventory item"
          }
        },
        {
          op: "inventory.update",
          itemId: seededItem.id,
          changes: {
            description: "Metric card updated during history coverage"
          }
        },
        {
          op: "node.update",
          nodeId: rootNodeId,
          changes: {
            "metadata.visibility.hidden": false
          }
        },
        {
          op: "node.visibility.set",
          nodeId: rootNodeId,
          hidden: true
        },
        {
          op: "starter.apply",
          starter: structuredClone(documentBefore.meta.starter)
        },
        {
          op: "inventory.remove",
          itemId: seededItem.id
        }
      ]
    });

    const afterForward = session.store.getDocument();
    expect(afterForward.componentInventory.some((item) => item.id === seededItem.id)).toBe(false);
    expect(afterForward.pages[0]?.nodes.find((node) => node.id === rootNodeId)?.metadata.visibility).toMatchObject({
      hidden: true
    });

    const undone = await manager.execute("canvas.history.undo", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId
    }) as { ok: boolean };
    expect(undone.ok).toBe(true);

    const afterUndo = session.store.getDocument();
    expect(afterUndo.componentInventory.find((item) => item.id === seededItem.id)).toMatchObject({
      description: seededItem.description
    });
    expect(afterUndo.componentInventory.some((item) => item.id === extraItem.id)).toBe(false);
    expect(afterUndo.pages[0]?.nodes.find((node) => node.id === rootNodeId)?.metadata.visibility?.hidden).not.toBe(true);
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

  it("keeps preview overlays on ops while reserving the canvas relay for design-tab commands", async () => {
    const mountCanvasOverlay = vi.fn().mockResolvedValue({
      mountId: "mount-ext",
      targetId: "tab-preview",
      overlayState: "mounted",
      capabilities: { selection: true }
    });
    const selectCanvasOverlay = vi.fn().mockResolvedValue({
      selection: { matched: true, selector: "#cta" },
      targetId: "tab-preview"
    });
    const syncCanvasOverlay = vi.fn().mockResolvedValue({ ok: true, overlayState: "mounted" });
    const unmountCanvasOverlay = vi.fn().mockResolvedValue({ ok: true, overlayState: "idle" });
    const browserManager = {
      status: vi.fn().mockResolvedValue({
        mode: "extension",
        activeTargetId: "tab-preview",
        url: "https://example.com/app",
        title: "App"
      }),
      mountCanvasOverlay,
      selectCanvasOverlay,
      syncCanvasOverlay,
      unmountCanvasOverlay,
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
      if (command === "canvas.tab.close") {
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
    expect(canvasClientRequestMock).not.toHaveBeenCalledWith("canvas.overlay.mount", expect.any(Object), canvasSessionId, 30000, leaseId);
    expect(canvasClientRequestMock).not.toHaveBeenCalledWith("canvas.overlay.select", expect.any(Object), canvasSessionId, 30000, leaseId);
    expect(canvasClientRequestMock).not.toHaveBeenCalledWith("canvas.overlay.unmount", expect.any(Object), canvasSessionId, 30000, leaseId);
    const openCall = canvasClientRequestMock.mock.calls.find(([command]) => command === "canvas.tab.open");
    expect(openCall?.[1]).toEqual(expect.objectContaining({
      html: expect.stringContaining("odb-canvas-component-button")
    }));
    const syncCall = canvasClientRequestMock.mock.calls.find(([command]) => command === "canvas.tab.sync");
    expect(syncCall?.[1]).toEqual(expect.objectContaining({
      html: expect.stringContaining("data-icon-libraries")
    }));
    expect(mountCanvasOverlay).toHaveBeenCalledWith("browser-extension", "tab-preview", expect.objectContaining({
      title: expect.any(String),
      prototypeId: "proto_home_default",
      mountId: expect.stringMatching(/^mount_/)
    }));
    expect(selectCanvasOverlay).toHaveBeenCalledWith("browser-extension", "tab-preview", {
      mountId: "mount-ext",
      nodeId: null,
      selectionHint: { selector: "#cta" }
    });
    expect(syncCanvasOverlay).toHaveBeenCalled();
    expect(unmountCanvasOverlay).toHaveBeenCalledWith("browser-extension", "tab-preview", "mount-ext");
  });

  it("avoids redundant design-tab sync payloads for canvas-relay overlay commands", async () => {
    const browserManager = {
      status: vi.fn().mockResolvedValue({
        mode: "extension",
        activeTargetId: "tab-preview",
        url: "https://example.com/app",
        title: "App"
      }),
      closeTarget: vi.fn().mockResolvedValue(undefined)
    };

    canvasClientRequestMock.mockImplementation(async (command: string, payload?: Record<string, unknown>) => {
      if (command === "canvas.tab.open") {
        return { targetId: "tab-ext-1", previewState: "focused" };
      }
      if (command === "canvas.overlay.mount") {
        return {
          mountId: "mount-design",
          targetId: payload?.targetId,
          overlayState: "mounted",
          capabilities: { selection: true, guides: true }
        };
      }
      if (command === "canvas.overlay.select") {
        return {
          targetId: payload?.targetId,
          selection: {
            matched: true,
            nodeId: payload?.nodeId,
            selector: `[data-node-id="${String(payload?.nodeId ?? "")}"]`
          }
        };
      }
      if (command === "canvas.overlay.unmount") {
        return { ok: true, mountId: payload?.mountId, overlayState: "idle" };
      }
      if (command === "canvas.tab.close") {
        return { ok: true, targetId: payload?.targetId };
      }
      if (command === "canvas.tab.sync") {
        throw new Error("design-tab overlay should not trigger canvas.tab.sync");
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
          opsConnected: false,
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
            opsConnected: false,
            canvasConnected: true,
            pairingRequired: false
          }
        }),
        getCdpUrl: () => null,
        getCanvasUrl: () => "ws://127.0.0.1:8787/canvas"
      }
    });
    const internal = manager as unknown as {
      syncLiveViews: (session: unknown) => Promise<void>;
    };
    const syncLiveViewsSpy = vi.spyOn(internal, "syncLiveViews");

    const opened = await manager.execute("canvas.session.open", {
      browserSessionId: "browser-extension"
    }) as Record<string, unknown>;
    const canvasSessionId = String(opened.canvasSessionId);
    const leaseId = String(opened.leaseId);
    const documentId = String(opened.documentId);
    const loaded = await manager.execute("canvas.document.load", {
      canvasSessionId,
      leaseId,
      documentId
    }) as { document: { pages: Array<{ rootNodeId: string | null }> } };
    const rootNodeId = loaded.document.pages[0]?.rootNodeId;
    expect(rootNodeId).toBeTruthy();

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
    })).resolves.toMatchObject({
      targetId: "tab-ext-1",
      targetIds: ["tab-ext-1"],
      designTab: true
    });

    canvasClientRequestMock.mockClear();
    syncLiveViewsSpy.mockClear();

    await expect(manager.execute("canvas.overlay.mount", {
      canvasSessionId,
      leaseId,
      targetId: "tab-ext-1",
      prototypeId: "proto_home_default"
    })).resolves.toMatchObject({
      mountId: "mount-design",
      targetId: "tab-ext-1"
    });

    await expect(manager.execute("canvas.overlay.select", {
      canvasSessionId,
      leaseId,
      mountId: "mount-design",
      targetId: "tab-ext-1",
      nodeId: rootNodeId
    })).resolves.toMatchObject({
      selection: {
        matched: true,
        nodeId: rootNodeId
      }
    });

    await expect(manager.execute("canvas.overlay.unmount", {
      canvasSessionId,
      leaseId,
      mountId: "mount-design",
      targetId: "tab-ext-1"
    })).resolves.toMatchObject({
      ok: true,
      mountId: "mount-design"
    });

    expect(syncLiveViewsSpy).not.toHaveBeenCalled();
    expect(canvasClientRequestMock).toHaveBeenCalledWith(
      "canvas.overlay.mount",
      { targetId: "tab-ext-1", prototypeId: "proto_home_default" },
      canvasSessionId,
      30000,
      leaseId
    );
    expect(canvasClientRequestMock).not.toHaveBeenCalledWith("canvas.tab.sync", expect.any(Object), canvasSessionId, 30000, leaseId);
  });

  it("disconnects the canvas relay client when the last extension-backed session closes", async () => {
    const browserManager = {
      status: vi.fn().mockResolvedValue({
        mode: "extension",
        activeTargetId: "tab-preview",
        url: "https://example.com/app",
        title: "App"
      })
    };

    canvasClientRequestMock.mockImplementation(async (command: string) => {
      if (command === "canvas.tab.open") {
        return { targetId: "tab-ext-1", previewState: "focused" };
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
          opsConnected: false,
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
            opsConnected: false,
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
    }) as { canvasSessionId: string; leaseId: string };

    await manager.execute("canvas.plan.set", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      generationPlan: structuredClone(validGenerationPlan)
    });
    await manager.execute("canvas.tab.open", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      prototypeId: "proto_home_default",
      previewMode: "focused"
    });
    await manager.execute("canvas.session.close", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId
    });

    expect(canvasClientConnectMock).toHaveBeenCalledTimes(1);
    expect(canvasClientRequestMock).toHaveBeenCalledWith(
      "canvas.tab.close",
      expect.any(Object),
      opened.canvasSessionId,
      30000,
      opened.leaseId
    );
    expect(canvasClientDisconnectMock).toHaveBeenCalledTimes(1);
  });

  it("returns a warning instead of failing when extension design-tab close hits a transient relay error", async () => {
    const browserManager = {
      status: vi.fn().mockResolvedValue({
        mode: "extension",
        activeTargetId: "tab-preview",
        url: "https://example.com/app",
        title: "App"
      })
    };

    canvasClientRequestMock.mockImplementation(async (command: string) => {
      if (command === "canvas.tab.open") {
        return { targetId: "tab-ext-1", previewState: "focused" };
      }
      if (command === "canvas.tab.close") {
        throw new Error("[ops_unavailable] Extension not connected to relay.");
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
          opsConnected: false,
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
            opsConnected: false,
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
    }) as { canvasSessionId: string; leaseId: string };

    await manager.execute("canvas.plan.set", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      generationPlan: structuredClone(validGenerationPlan)
    });
    await manager.execute("canvas.tab.open", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      prototypeId: "proto_home_default",
      previewMode: "focused"
    });

    await expect(manager.execute("canvas.session.close", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId
    })).resolves.toMatchObject({
      ok: true,
      releasedOverlays: true,
      warnings: ["[ops_unavailable] Extension not connected to relay."]
    });

    expect(canvasClientRequestMock).toHaveBeenCalledWith(
      "canvas.tab.close",
      expect.any(Object),
      opened.canvasSessionId,
      30000,
      opened.leaseId
    );
    expect(canvasClientDisconnectMock).toHaveBeenCalledTimes(1);
    expect((manager as { sessions: Map<string, unknown> }).sessions.has(opened.canvasSessionId)).toBe(false);
  });

  it.each([
    "[invalid_session] Unknown ops session",
    "Extension not connected to relay",
    "Ops request timed out"
  ])("treats extension design-tab close error `%s` as an ignorable session-close warning", async (closeMessage) => {
    const browserManager = {
      status: vi.fn().mockResolvedValue({
        mode: "extension",
        activeTargetId: "tab-preview",
        url: "https://example.com/app",
        title: "App"
      }),
      closeTarget: vi.fn()
    };

    canvasClientRequestMock.mockImplementation(async (command: string) => {
      if (command === "canvas.tab.open") {
        return { targetId: "tab-ext-variant", previewState: "focused" };
      }
      if (command === "canvas.tab.close") {
        throw new Error(closeMessage);
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
          opsConnected: false,
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
            opsConnected: false,
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
    }) as { canvasSessionId: string; leaseId: string };

    await manager.execute("canvas.plan.set", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      generationPlan: structuredClone(validGenerationPlan)
    });
    await manager.execute("canvas.tab.open", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      prototypeId: "proto_home_default",
      previewMode: "focused"
    });

    await expect(manager.execute("canvas.session.close", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId
    })).resolves.toMatchObject({
      ok: true,
      warnings: [closeMessage]
    });

    expect(canvasClientDisconnectMock).toHaveBeenCalledTimes(1);
    expect((manager as { sessions: Map<string, unknown> }).sessions.has(opened.canvasSessionId)).toBe(false);
  });

  it("falls back to browser target close when the canvas relay session is already gone", async () => {
    const browserManager = {
      status: vi.fn().mockResolvedValue({
        mode: "extension",
        activeTargetId: "tab-preview",
        url: "https://example.com/app",
        title: "App"
      }),
      closeTarget: vi.fn(async () => undefined)
    };

    canvasClientRequestMock.mockImplementation(async (command: string) => {
      if (command === "canvas.tab.open") {
        return { targetId: "tab-ext-variant", previewState: "focused" };
      }
      if (command === "canvas.tab.close") {
        throw new Error("Unknown sessionId: canvas-stale");
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
          opsConnected: false,
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
            opsConnected: false,
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
    }) as { canvasSessionId: string; leaseId: string };

    await manager.execute("canvas.plan.set", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      generationPlan: structuredClone(validGenerationPlan)
    });
    await manager.execute("canvas.tab.open", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      prototypeId: "proto_home_default",
      previewMode: "focused"
    });

    await expect(manager.execute("canvas.session.close", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId
    })).resolves.toMatchObject({
      ok: true,
      warnings: []
    });

    expect(browserManager.closeTarget).toHaveBeenCalledWith("browser-extension", "tab-ext-variant");
    expect(canvasClientDisconnectMock).toHaveBeenCalledTimes(1);
    expect((manager as { sessions: Map<string, unknown> }).sessions.has(opened.canvasSessionId)).toBe(false);
  });

  it("treats an already-missing extension design tab as closed during session shutdown", async () => {
    const browserManager = {
      status: vi.fn().mockResolvedValue({
        mode: "extension",
        activeTargetId: "tab-preview",
        url: "https://example.com/app",
        title: "App"
      }),
      listTargets: vi.fn().mockResolvedValue({
        activeTargetId: "tab-root",
        targets: [{ targetId: "tab-root", type: "page", title: "App", url: "https://example.com/app" }]
      }),
      closeTarget: vi.fn(async () => undefined)
    };

    canvasClientRequestMock.mockImplementation(async (command: string) => {
      if (command === "canvas.tab.open") {
        return { targetId: "tab-ext-missing", previewState: "focused" };
      }
      if (command === "canvas.tab.close") {
        throw new Error("Unknown sessionId: canvas-stale");
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
          opsConnected: false,
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
            opsConnected: false,
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
    }) as { canvasSessionId: string; leaseId: string };

    await manager.execute("canvas.plan.set", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      generationPlan: structuredClone(validGenerationPlan)
    });
    await manager.execute("canvas.tab.open", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      prototypeId: "proto_home_default",
      previewMode: "focused"
    });

    await expect(manager.execute("canvas.session.close", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId
    })).resolves.toMatchObject({
      ok: true,
      warnings: []
    });

    expect(browserManager.listTargets).toHaveBeenCalledWith("browser-extension", true);
    expect(browserManager.closeTarget).not.toHaveBeenCalled();
    expect(canvasClientDisconnectMock).toHaveBeenCalledTimes(1);
    expect((manager as { sessions: Map<string, unknown> }).sessions.has(opened.canvasSessionId)).toBe(false);
  });

  it("treats an already-closed extension design tab as closed during session shutdown", async () => {
    const browserManager = {
      status: vi.fn().mockResolvedValue({
        mode: "extension",
        activeTargetId: "tab-preview",
        url: "https://example.com/app",
        title: "App"
      })
    };

    canvasClientRequestMock.mockImplementation(async (command: string) => {
      if (command === "canvas.tab.open") {
        return { targetId: "tab-ext-already-closed", previewState: "focused" };
      }
      if (command === "canvas.tab.close") {
        throw new Error("No tab with id: 1245671463.");
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
          opsConnected: false,
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
            opsConnected: false,
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
    }) as { canvasSessionId: string; leaseId: string };

    await manager.execute("canvas.plan.set", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      generationPlan: structuredClone(validGenerationPlan)
    });
    await manager.execute("canvas.tab.open", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      prototypeId: "proto_home_default",
      previewMode: "focused"
    });

    await expect(manager.execute("canvas.session.close", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId
    })).resolves.toMatchObject({
      ok: true,
      warnings: []
    });

    expect(canvasClientDisconnectMock).toHaveBeenCalledTimes(1);
    expect((manager as { sessions: Map<string, unknown> }).sessions.has(opened.canvasSessionId)).toBe(false);
  });

  it("closes an already-closed extension design tab without querying a restricted active browser tab", async () => {
    const browserManager = {
      status: vi.fn()
        .mockResolvedValueOnce({
          mode: "extension",
          activeTargetId: "tab-preview",
          url: "https://example.com/app",
          title: "App"
        })
        .mockRejectedValue(new Error("[restricted_url] Active tab uses a restricted URL scheme. Focus a normal http(s) tab and retry."))
    };

    canvasClientRequestMock.mockImplementation(async (command: string) => {
      if (command === "canvas.tab.open") {
        return { targetId: "tab-ext-restricted-root", previewState: "focused" };
      }
      if (command === "canvas.tab.close") {
        throw new Error("No tab with id: 1245671468.");
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
          opsConnected: false,
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
            opsConnected: false,
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
    }) as { canvasSessionId: string; leaseId: string };

    await manager.execute("canvas.plan.set", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      generationPlan: structuredClone(validGenerationPlan)
    });
    await manager.execute("canvas.tab.open", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      prototypeId: "proto_home_default",
      previewMode: "focused"
    });

    await expect(manager.execute("canvas.session.close", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId
    })).resolves.toMatchObject({
      ok: true,
      warnings: []
    });

    expect(browserManager.status).toHaveBeenCalledTimes(1);
    expect(canvasClientDisconnectMock).toHaveBeenCalledTimes(1);
    expect((manager as { sessions: Map<string, unknown> }).sessions.has(opened.canvasSessionId)).toBe(false);
  });

  it("rethrows non-ignorable extension design-tab close failures during session shutdown", async () => {
    const browserManager = {
      status: vi.fn().mockResolvedValue({
        mode: "extension",
        activeTargetId: "tab-preview",
        url: "https://example.com/app",
        title: "App"
      })
    };

    canvasClientRequestMock.mockImplementation(async (command: string) => {
      if (command === "canvas.tab.open") {
        return { targetId: "tab-ext-hard-fail", previewState: "focused" };
      }
      if (command === "canvas.tab.close") {
        throw new Error("hard close failure");
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
          opsConnected: false,
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
            opsConnected: false,
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
    }) as { canvasSessionId: string; leaseId: string };

    await manager.execute("canvas.plan.set", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      generationPlan: structuredClone(validGenerationPlan)
    });
    await manager.execute("canvas.tab.open", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      prototypeId: "proto_home_default",
      previewMode: "focused"
    });

    await expect(manager.execute("canvas.session.close", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId
    })).rejects.toThrow("hard close failure");

    expect(canvasClientDisconnectMock).not.toHaveBeenCalled();
    expect((manager as { sessions: Map<string, unknown> }).sessions.has(opened.canvasSessionId)).toBe(true);
  });

  it("keeps the canvas relay client connected while another extension-backed session is still active", async () => {
    const browserManager = {
      status: vi.fn().mockResolvedValue({
        mode: "extension",
        activeTargetId: "tab-preview",
        url: "https://example.com/app",
        title: "App"
      })
    };
    let targetIndex = 0;
    canvasClientRequestMock.mockImplementation(async (command: string) => {
      if (command === "canvas.tab.open") {
        targetIndex += 1;
        return { targetId: `tab-ext-${targetIndex}`, previewState: "focused" };
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
          opsConnected: false,
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
            opsConnected: false,
            canvasConnected: true,
            pairingRequired: false
          }
        }),
        getCdpUrl: () => null,
        getCanvasUrl: () => "ws://127.0.0.1:8787/canvas"
      }
    });

    const first = await manager.execute("canvas.session.open", {
      browserSessionId: "browser-extension"
    }) as { canvasSessionId: string; leaseId: string };
    const second = await manager.execute("canvas.session.open", {
      browserSessionId: "browser-extension"
    }) as { canvasSessionId: string; leaseId: string };

    for (const session of [first, second]) {
      await manager.execute("canvas.plan.set", {
        canvasSessionId: session.canvasSessionId,
        leaseId: session.leaseId,
        generationPlan: structuredClone(validGenerationPlan)
      });
      await manager.execute("canvas.tab.open", {
        canvasSessionId: session.canvasSessionId,
        leaseId: session.leaseId,
        prototypeId: "proto_home_default",
        previewMode: "focused"
      });
    }

    await manager.execute("canvas.session.close", {
      canvasSessionId: first.canvasSessionId,
      leaseId: first.leaseId
    });
    expect(canvasClientDisconnectMock).not.toHaveBeenCalled();

    await manager.execute("canvas.session.close", {
      canvasSessionId: second.canvasSessionId,
      leaseId: second.leaseId
    });
    expect(canvasClientDisconnectMock).toHaveBeenCalledTimes(1);
  });

  it("disconnects the idle canvas relay client when the extension reports canvas_session_closed", async () => {
    const browserManager = {
      status: vi.fn().mockResolvedValue({
        mode: "extension",
        activeTargetId: "tab-preview",
        url: "https://example.com/app",
        title: "App"
      })
    };

    canvasClientRequestMock.mockImplementation(async (command: string) => {
      if (command === "canvas.tab.open") {
        return { targetId: "tab-ext-1", previewState: "focused" };
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
          opsConnected: false,
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
            opsConnected: false,
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
    }) as { canvasSessionId: string; leaseId: string };

    await manager.execute("canvas.plan.set", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      generationPlan: structuredClone(validGenerationPlan)
    });
    await manager.execute("canvas.tab.open", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      prototypeId: "proto_home_default",
      previewMode: "focused"
    });

    const internal = manager as unknown as {
      sessions: Map<string, unknown>;
      handleCanvasEvent: (event: { event: string; canvasSessionId?: string; payload?: unknown }) => Promise<void>;
    };

    await internal.handleCanvasEvent({
      event: "canvas_session_closed",
      canvasSessionId: opened.canvasSessionId,
      payload: { reason: "target_closed" }
    });

    expect(internal.sessions.has(opened.canvasSessionId)).toBe(false);
    expect(canvasClientDisconnectMock).toHaveBeenCalledTimes(1);
  });

  it("covers repo-backed sessions and non-browser guard paths", async () => {
    const document = createDefaultCanvasDocument("dc_repo_backed");
    document.title = "Repo Backed Document";
    document.designGovernance.generationPlan = structuredClone(validGenerationPlan);
    document.componentInventory.push({
      id: "inventory_hero_card",
      name: "HeroCard",
      componentName: "HeroCard",
      sourceKind: "code-sync",
      sourceFamily: "framework_component",
      origin: "code_sync",
      framework: {
        id: "react",
        label: "React",
        packageName: "react",
        metadata: {}
      },
      adapter: {
        id: "tsx-react-v1",
        label: "TSX React v1",
        packageName: "@opendevbrowser/tsx-react-v1",
        metadata: {}
      },
      plugin: {
        id: "local-ui-kit",
        label: "Local UI Kit",
        packageName: "@repo/local-ui-kit",
        metadata: {}
      },
      variants: [],
      props: [],
      slots: [],
      events: [],
      content: {
        acceptsText: false,
        acceptsRichText: false,
        slotNames: [],
        metadata: {}
      },
      metadata: {}
    });
    document.meta.imports.push({
      id: "import_figma_1",
      source: {
        id: "source_figma_1",
        kind: "figma",
        frameworkId: "react",
        pluginId: "local-ui-kit",
        adapterIds: ["tsx-react-v1"],
        metadata: {}
      },
      assetReceipts: [],
      metadata: {}
    });
    document.meta.adapterPlugins.push({
      id: "local-ui-kit",
      label: "Local UI Kit",
      frameworks: [{ frameworkId: "react", versions: ["18"], metadata: {} }],
      libraries: [{ libraryId: "shadcn", categories: ["components"], metadata: {} }],
      declaredCapabilities: ["preview", "code_sync"],
      grantedCapabilities: [
        { capability: "preview", granted: true, metadata: {} },
        { capability: "tokens", granted: false, reason: "not_requested", metadata: {} }
      ],
      metadata: {}
    });
    document.meta.pluginErrors.push({
      pluginId: "local-ui-kit",
      code: "preview_skipped",
      message: "Preview capability remains document-only for this binding.",
      details: {}
    });
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
      componentInventoryCount: 1,
      componentSourceKinds: ["code-sync"],
      frameworkIds: ["react"],
      pluginIds: ["local-ui-kit"],
      inventoryOrigins: ["code_sync"],
      declaredCapabilities: ["code_sync", "preview"],
      grantedCapabilities: ["preview"],
      capabilityDenials: [
        expect.objectContaining({ capability: "tokens", granted: false, reason: "not_requested" })
      ],
      pluginErrors: [
        expect.objectContaining({ pluginId: "local-ui-kit", code: "preview_skipped" })
      ],
      importSources: ["figma"]
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
    })).rejects.toMatchObject({
      code: "generation_plan_invalid",
      blocker: expect.objectContaining({
        code: "generation_plan_invalid",
        requiredNextCommands: ["canvas.plan.set"]
      }),
      details: expect.objectContaining({
        auditId: "CANVAS-03",
        missingFields: expect.arrayContaining([
          "visualDirection",
          "layoutStrategy",
          "contentStrategy",
          "componentStrategy",
          "motionPosture",
          "responsivePosture",
          "accessibilityPosture",
          "validationTargets"
        ])
      })
    });
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
      cursor: "fb_9",
      initialItems: expect.any(Array)
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

  it("preserves the active unsaved document when canvas.document.load is called with the session document id", async () => {
    const manager = new CanvasManager({
      worktree,
      browserManager: {
        status: vi.fn(),
        closeTarget: vi.fn()
      } as never,
      config: resolveConfig({})
    });

    const opened = await manager.execute("canvas.session.open", {
      browserSessionId: "browser-managed"
    }) as Record<string, unknown>;
    const canvasSessionId = opened.canvasSessionId as string;
    const leaseId = opened.leaseId as string;
    const documentId = opened.documentId as string;

    await manager.execute("canvas.plan.set", {
      canvasSessionId,
      leaseId,
      generationPlan: structuredClone(validGenerationPlan)
    });

    expect(await manager.execute("canvas.document.load", {
      canvasSessionId,
      leaseId,
      documentId
    })).toMatchObject({
      documentId,
      documentRevision: 2,
      document: {
        designGovernance: {
          generationPlan: structuredClone(validGenerationPlan)
        }
      },
      handshake: {
        preflightState: "plan_accepted",
        governanceBlockStates: {
          generationPlan: {
            status: "present"
          }
        }
      }
    });

    expect(await manager.execute("canvas.plan.get", {
      canvasSessionId,
      leaseId
    })).toMatchObject({
      planStatus: "accepted",
      documentRevision: 2,
      generationPlan: structuredClone(validGenerationPlan)
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

  it("exposes public feedback next and unsubscribe commands", async () => {
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
      sessions: Map<string, { store: { getRevision: () => number; getDocument: () => { pages: Array<{ rootNodeId: string | null }> } } }>;
      handleCanvasEvent: (event: { event: string; canvasSessionId: string; payload: Record<string, unknown> }) => Promise<void>;
    }).sessions.get(canvasSessionId);
    const rootNodeId = session?.store.getDocument().pages[0]?.rootNodeId;
    expect(rootNodeId).toBeTruthy();

    const subscribed = await manager.execute("canvas.feedback.subscribe", {
      canvasSessionId
    }) as {
      subscriptionId: string;
      heartbeatMs: number;
      expiresAt: string | null;
      initialItems: Array<Record<string, unknown>>;
      activeTargetIds: string[];
    };
    expect(subscribed).toMatchObject({
      subscriptionId: expect.stringMatching(/^canvas_sub_/),
      heartbeatMs: 15000,
      expiresAt: null,
      initialItems: expect.any(Array),
      activeTargetIds: []
    });

    const nextItem = manager.execute("canvas.feedback.next", {
      canvasSessionId,
      subscriptionId: subscribed.subscriptionId,
      timeoutMs: 1000
    });

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
          changes: { "metadata.editor": "public-next" }
        }]
      }
    });

    await expect(nextItem).resolves.toMatchObject({
      eventType: "feedback.item",
      item: {
        class: "editor-document-patched",
        details: { source: "editor" }
      }
    });

    expect(await manager.execute("canvas.feedback.unsubscribe", {
      canvasSessionId,
      subscriptionId: subscribed.subscriptionId
    })).toEqual({
      ok: true,
      subscriptionId: subscribed.subscriptionId
    });
    expect(await manager.execute("canvas.feedback.unsubscribe", {
      canvasSessionId,
      subscriptionId: subscribed.subscriptionId
    })).toEqual({
      ok: true,
      subscriptionId: subscribed.subscriptionId
    });

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
    expect(browserManager.screenshot).toHaveBeenCalledWith("browser-managed", { targetId: "tab-preview" });
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

  it("refreshes preview targets only once after canvas.code.pull applies patches", async () => {
    const sourcePath = join(worktree, "src", "HeroPullPreview.tsx");
    await mkdir(join(worktree, "src"), { recursive: true });
    await writeFile(sourcePath, [
      "export function Hero() {",
      "  return <section className=\"hero-shell\"><span>Hello world</span></section>;",
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
    const documentId = String(opened.documentId);
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
    await manager.execute("canvas.code.bind", {
      canvasSessionId,
      leaseId,
      nodeId: rootNodeId,
      bindingId: "binding_preview_pull",
      repoPath: sourcePath,
      exportName: "Hero",
      syncMode: "manual"
    });
    await manager.execute("canvas.preview.render", {
      canvasSessionId,
      leaseId,
      targetId: "tab-preview",
      prototypeId: "proto_home_default"
    });

    browserManager.goto.mockClear();
    browserManager.screenshot.mockClear();
    browserManager.perfMetrics.mockClear();
    browserManager.consolePoll.mockClear();
    browserManager.networkPoll.mockClear();

    const pulled = await manager.execute("canvas.code.pull", {
      canvasSessionId,
      leaseId,
      bindingId: "binding_preview_pull"
    }) as {
      ok: boolean;
      patchesApplied: number;
      summary: { codeSyncState: string };
    };

    expect(pulled.ok).toBe(true);
    expect(pulled.patchesApplied).toBeGreaterThan(0);
    expect(pulled.summary.codeSyncState).toBe("in_sync");
    expect(browserManager.goto).toHaveBeenCalledTimes(1);
    expect(browserManager.screenshot).toHaveBeenCalledTimes(1);
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
            heartbeatMs: number;
            lastHeartbeatAt: number;
            heartbeatTimer: NodeJS.Timeout;
            active: boolean;
          }>;
        }>;
        createFeedbackStream: (subscription: {
          queue: Array<{ eventType: string } | undefined>;
          waiters: Array<(event: unknown) => void>;
          cursor: string | null;
          heartbeatMs: number;
          lastHeartbeatAt: number;
          heartbeatTimer: NodeJS.Timeout;
          active: boolean;
        }) => AsyncIterable<unknown>;
        flushSubscriptionWaiters: (
          subscription: {
            queue: Array<{ eventType: string } | undefined>;
            waiters: Array<(event: unknown) => void>;
            cursor: string | null;
            heartbeatMs: number;
            lastHeartbeatAt: number;
            heartbeatTimer: NodeJS.Timeout;
            active: boolean;
          },
          event: unknown
        ) => void;
      };

      const session = managerState.sessions.get(canvasSessionId);
      const subscription = session?.feedbackSubscriptions.get(subscribed.subscriptionId);
      expect(subscription?.queue).toHaveLength(0);

      if (!subscription) {
        throw new Error("Expected active feedback subscription");
      }
      subscription.lastHeartbeatAt = Date.now() + 1;
      await vi.advanceTimersByTimeAsync(15000);
      expect(subscription.queue).toHaveLength(0);

      subscription.lastHeartbeatAt = Date.now() - subscription.heartbeatMs;
      await vi.advanceTimersByTimeAsync(15000);
      expect(subscription?.queue).toEqual([
        expect.objectContaining({ eventType: "feedback.heartbeat" })
      ]);
      await expect(manager.execute("canvas.feedback.next", {
        canvasSessionId,
        subscriptionId: subscribed.subscriptionId
      })).resolves.toMatchObject({
        eventType: "feedback.heartbeat"
      });
      expect(subscription?.queue).toHaveLength(0);

      const queuedCount = subscription?.queue.length ?? 0;
      subscription.active = false;
      await vi.advanceTimersByTimeAsync(15000);
      expect(subscription.queue).toHaveLength(queuedCount);

      const emptyQueuedSubscription = {
        id: "empty-queued",
        categories: new Set<string>(),
        targetIds: new Set<string>(),
        queue: [undefined],
        waiters: [],
        cursor: null,
        heartbeatMs: 1000,
        lastHeartbeatAt: Date.now(),
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
        id: "waiting",
        categories: new Set<string>(),
        targetIds: new Set<string>(),
        queue: [],
        waiters: [],
        cursor: null,
        heartbeatMs: 1000,
        lastHeartbeatAt: Date.now(),
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

  it("covers feedback next cleanup and waiter edge branches", async () => {
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

      type InternalFeedbackEvent = {
        eventType: string;
        cursor?: string | null;
        ts?: string;
        reason?: string;
        activeTargetIds?: string[];
      };
      type InternalFeedbackSubscription = {
        id: string;
        categories: Set<string>;
        targetIds: Set<string>;
        queue: Array<InternalFeedbackEvent | undefined>;
        waiters: Array<(event: InternalFeedbackEvent | null) => void>;
        cursor: string | null;
        heartbeatMs: number;
        lastHeartbeatAt: number;
        heartbeatTimer: NodeJS.Timeout;
        active: boolean;
      };
      type InternalCanvasSession = {
        activeTargets: Map<string, unknown>;
        feedbackSubscriptions: Map<string, InternalFeedbackSubscription>;
      };
      const managerState = manager as unknown as {
        sessions: Map<string, InternalCanvasSession>;
        awaitFeedbackEvent: (
          session: InternalCanvasSession,
          subscription: InternalFeedbackSubscription,
          timeoutMs?: number
        ) => Promise<InternalFeedbackEvent>;
        flushSubscriptionWaiters: (
          subscription: InternalFeedbackSubscription,
          event: InternalFeedbackEvent | null
        ) => void;
      };

      const session = managerState.sessions.get(canvasSessionId);
      if (!session) {
        throw new Error("Expected canvas session");
      }

      const inactiveSubscription: InternalFeedbackSubscription = {
        id: "inactive-fast-path",
        categories: new Set<string>(),
        targetIds: new Set<string>(),
        queue: [],
        waiters: [],
        cursor: "fb_inactive",
        heartbeatMs: 1000,
        lastHeartbeatAt: Date.now(),
        heartbeatTimer: setInterval(() => undefined, 1000),
        active: false
      };
      await expect(managerState.awaitFeedbackEvent(session, inactiveSubscription)).resolves.toMatchObject({
        eventType: "feedback.complete",
        cursor: "fb_inactive",
        reason: "subscription_replaced"
      });
      clearInterval(inactiveSubscription.heartbeatTimer);

      const undefinedTimeoutSubscription: InternalFeedbackSubscription = {
        id: "undefined-timeout",
        categories: new Set<string>(),
        targetIds: new Set<string>(),
        queue: [],
        waiters: [],
        cursor: "fb_undefined",
        heartbeatMs: 1000,
        lastHeartbeatAt: Date.now(),
        heartbeatTimer: setInterval(() => undefined, 1000),
        active: true
      };
      const undefinedTimeoutPromise = managerState.awaitFeedbackEvent(session, undefinedTimeoutSubscription);
      expect(undefinedTimeoutSubscription.waiters).toHaveLength(1);
      undefinedTimeoutSubscription.active = false;
      managerState.flushSubscriptionWaiters(undefinedTimeoutSubscription, null);
      await expect(undefinedTimeoutPromise).resolves.toMatchObject({
        eventType: "feedback.complete",
        cursor: "fb_undefined",
        reason: "subscription_replaced"
      });
      clearInterval(undefinedTimeoutSubscription.heartbeatTimer);

      const removedWaiterSubscription: InternalFeedbackSubscription = {
        id: "removed-waiter",
        categories: new Set<string>(),
        targetIds: new Set<string>(),
        queue: [],
        waiters: [],
        cursor: "fb_timeout",
        heartbeatMs: 1000,
        lastHeartbeatAt: Date.now(),
        heartbeatTimer: setInterval(() => undefined, 1000),
        active: true
      };
      const timeoutPromise = managerState.awaitFeedbackEvent(session, removedWaiterSubscription, 25);
      expect(removedWaiterSubscription.waiters).toHaveLength(1);
      removedWaiterSubscription.waiters.splice(0, 1);
      await vi.advanceTimersByTimeAsync(25);
      await expect(timeoutPromise).resolves.toMatchObject({
        eventType: "feedback.heartbeat",
        cursor: "fb_timeout",
        activeTargetIds: []
      });
      clearInterval(removedWaiterSubscription.heartbeatTimer);

      const queuedCompleteSubscription: InternalFeedbackSubscription = {
        id: "queued-complete",
        categories: new Set<string>(),
        targetIds: new Set<string>(),
        queue: [{
          eventType: "feedback.complete",
          cursor: "fb_complete",
          ts: new Date().toISOString(),
          reason: "subscription_replaced"
        }],
        waiters: [],
        cursor: "fb_complete",
        heartbeatMs: 1000,
        lastHeartbeatAt: Date.now(),
        heartbeatTimer: setInterval(() => undefined, 1000),
        active: false
      };
      session.feedbackSubscriptions.set(queuedCompleteSubscription.id, queuedCompleteSubscription);
      await expect(manager.execute("canvas.feedback.next", {
        canvasSessionId,
        subscriptionId: queuedCompleteSubscription.id
      })).resolves.toMatchObject({
        eventType: "feedback.complete",
        cursor: "fb_complete",
        reason: "subscription_replaced"
      });
      expect(session.feedbackSubscriptions.has(queuedCompleteSubscription.id)).toBe(false);
      clearInterval(queuedCompleteSubscription.heartbeatTimer);

      await expect(manager.execute("canvas.feedback.next", {
        canvasSessionId,
        subscriptionId: subscribed.subscriptionId,
        timeoutMs: 0
      })).rejects.toThrow("Invalid timeoutMs");

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

  it("preserves prior editor viewport values when canvas patch events omit or invalidate fields", async () => {
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
        store: { getRevision: () => number };
        editorViewport: { x: number; y: number; zoom: number };
      }>;
      handleCanvasEvent: (event: { event: string; canvasSessionId: string; payload: Record<string, unknown> }) => Promise<void>;
    };
    const session = managerState.sessions.get(canvasSessionId);
    expect(session).toBeTruthy();
    session!.editorViewport = { x: 24, y: 48, zoom: 1.25 };

    await managerState.handleCanvasEvent({
      event: "canvas_patch_requested",
      canvasSessionId,
      payload: {
        baseRevision: session!.store.getRevision(),
        patches: [],
        viewport: {
          x: 128,
          y: "bad",
          zoom: undefined
        }
      }
    });

    expect(session!.editorViewport).toEqual({
      x: 128,
      y: 48,
      zoom: 1.25
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
    const originalCrypto = globalThis.crypto;
    vi.stubGlobal("crypto", {});

    const browserManager = {
      status: vi.fn().mockResolvedValue({
        mode: "managed",
        activeTargetId: "tab-preview",
        url: "https://example.com/app",
        title: "App"
      }),
      withPage: vi.fn().mockImplementation(async (_sessionId: string, _targetId: string, fn: (page: unknown) => Promise<unknown>) => {
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
      browserSessionId: "browser-managed"
    }) as Record<string, unknown>;
    const canvasSessionId = opened.canvasSessionId as string;
    const leaseId = opened.leaseId as string;
    let activeMountId = "";

    await manager.execute("canvas.plan.set", {
      canvasSessionId,
      leaseId,
      generationPlan: structuredClone(validGenerationPlan)
    });
    try {
      const firstOverlay = await manager.execute("canvas.overlay.mount", {
        canvasSessionId,
        leaseId,
        targetId: "tab-preview",
        prototypeId: "proto_home_default"
      }) as Record<string, unknown>;
      const secondOverlay = await manager.execute("canvas.overlay.mount", {
        canvasSessionId,
        leaseId,
        targetId: "tab-preview",
        prototypeId: "proto_home_default"
      }) as Record<string, unknown>;
      activeMountId = String(secondOverlay.mountId);
      expect(dom.documentStub.getElementById(String(firstOverlay.mountId))).toBeNull();
      expect(dom.documentStub.getElementById(String(secondOverlay.mountId))).toBeNull();
    } finally {
      if (originalCrypto) {
        vi.stubGlobal("crypto", originalCrypto);
      } else {
        Reflect.deleteProperty(globalThis as Record<string, unknown>, "crypto");
      }
    }

    const overlays = dom.documentStub.body.children.filter((child) => child.id === "opendevbrowser-canvas-overlay");
    expect(overlays).toHaveLength(2);
    expect(overlays[0]?.removed).toBe(true);
    expect(overlays[1]?.removed).toBe(false);
    const overlayStyles = dom.documentStub.body.children.filter((child) => child.id === "opendevbrowser-canvas-overlay-style");
    expect(overlayStyles).toHaveLength(1);
    expect(overlayStyles[0]?.removed).toBe(false);

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

    await manager.execute("canvas.overlay.unmount", {
      canvasSessionId,
      leaseId,
      mountId: activeMountId,
      targetId: "tab-preview"
    });
    expect(overlays[1]?.removed).toBe(true);
    expect(overlayStyles[0]?.removed).toBe(true);

    await expect(manager.execute("canvas.tab.open", {
      canvasSessionId,
      leaseId,
      prototypeId: "proto_home_default",
      previewMode: "degraded"
    })).rejects.toThrow("Missing previewMode");
  });

  it("falls back to CDP runtime evaluation when direct overlay evaluate times out", async () => {
    const send = vi.fn().mockResolvedValue({
      result: {
        value: {
          matched: true,
          selector: "[data-node-id=\"node_cta\"]",
          tagName: "div",
          text: "Node Bound",
          id: null,
          className: "opendevbrowser-canvas-highlight"
        }
      }
    });
    const detach = vi.fn().mockResolvedValue(undefined);
    const newCDPSession = vi.fn().mockResolvedValue({ send, detach });
    const browserManager = {
      status: vi.fn().mockResolvedValue({
        mode: "managed",
        activeTargetId: "tab-preview",
        url: "https://example.com/app",
        title: "App"
      }),
      withPage: vi.fn().mockImplementation(async (_sessionId: string, _targetId: string, fn: (page: unknown) => Promise<unknown>) => {
        return await fn({
          evaluate: vi.fn().mockRejectedValue(new Error("DIRECT_OVERLAY_EVAL_TIMEOUT")),
          context: () => ({ newCDPSession })
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

    const selection = await manager.execute("canvas.overlay.select", {
      canvasSessionId,
      leaseId,
      mountId: "probe_mount",
      targetId: "tab-preview",
      nodeId: "node_cta"
    }) as Record<string, unknown>;

    expect(selection).toMatchObject({
      selection: {
        matched: true,
        selector: "[data-node-id=\"node_cta\"]"
      }
    });
    expect(newCDPSession).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("Runtime.evaluate", expect.objectContaining({
      awaitPromise: true,
      returnByValue: true
    }));
    expect(detach).toHaveBeenCalledTimes(1);
  });

  it("uses textContent for direct overlay selection summaries", async () => {
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

    const selectable = new FakeHTMLElement("DIV", () => {});
    selectable.textContent = "  Primary   hero   copy  ";
    Object.defineProperty(selectable, "innerText", {
      configurable: true,
      get() {
        throw new Error("innerText should not be read");
      }
    });
    dom.registerSelector(".slow-copy", selectable);

    await expect(manager.execute("canvas.overlay.select", {
      canvasSessionId,
      leaseId,
      mountId: "mount_existing",
      targetId: "tab-preview",
      selectionHint: { selector: ".slow-copy" }
    })).resolves.toMatchObject({
      selection: {
        matched: true,
        selector: ".slow-copy",
        text: "Primary hero copy"
      }
    });
  });

  it("covers extension relay replacement, defaults, and cleanup", async () => {
    let relayUrl: string | null = null;
    let openCount = 0;
    const mountCanvasOverlay = vi.fn().mockResolvedValue({
      mountId: "mount-preview-ops",
      targetId: "tab-preview",
      overlayState: "mounted",
      capabilities: { selection: true, guides: true }
    });
    const selectCanvasOverlay = vi.fn().mockResolvedValue({
      selection: { matched: true, selector: "#cta" },
      targetId: "tab-preview"
    });
    const syncCanvasOverlay = vi.fn().mockResolvedValue({ ok: true, overlayState: "mounted" });
    const unmountCanvasOverlay = vi.fn().mockResolvedValue({ ok: true, overlayState: "idle" });
    const browserManager = {
      status: vi.fn().mockResolvedValue({
        mode: "extension",
        activeTargetId: "tab-preview",
        url: "https://example.com/app",
        title: "App"
      }),
      mountCanvasOverlay,
      selectCanvasOverlay,
      syncCanvasOverlay,
      unmountCanvasOverlay,
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
    expect(overlay.mountId).toBe("mount-preview-ops");
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
    expect(canvasClientDisconnectMock).toHaveBeenCalledTimes(2);
    expect(browserManager.closeTarget).toHaveBeenCalledWith("browser-extension", "tab-other");
    expect(browserManager.registerCanvasTarget).toHaveBeenCalledWith("browser-extension", "tab-ext-1");
    expect(canvasClientRequestMock).not.toHaveBeenCalledWith("canvas.overlay.mount", expect.any(Object), canvasSessionId, 30000, leaseId);
    expect(canvasClientRequestMock).not.toHaveBeenCalledWith("canvas.overlay.select", expect.any(Object), canvasSessionId, 30000, leaseId);
    expect(canvasClientRequestMock).not.toHaveBeenCalledWith("canvas.overlay.unmount", expect.any(Object), canvasSessionId, 30000, leaseId);
    expect(canvasClientRequestMock).toHaveBeenCalledWith("canvas.tab.close", expect.any(Object), canvasSessionId, 30000, leaseId);
    expect(mountCanvasOverlay).toHaveBeenCalledWith("browser-extension", "tab-preview", expect.objectContaining({
      mountId: expect.stringMatching(/^mount_/),
      prototypeId: "proto_home_default"
    }));
    expect(selectCanvasOverlay).toHaveBeenCalledWith("browser-extension", "tab-preview", {
      mountId: "mount-preview-ops",
      nodeId: null,
      selectionHint: { selector: "#cta" }
    });
    expect(syncCanvasOverlay).toHaveBeenCalled();
    expect(unmountCanvasOverlay).toHaveBeenCalledWith("browser-extension", "tab-preview", "mount-preview-ops");
  });

  it("falls back to direct overlays when an extension session is not backed by /ops", async () => {
    const mountCanvasOverlay = vi.fn();
    const selectCanvasOverlay = vi.fn();
    const syncCanvasOverlay = vi.fn();
    const unmountCanvasOverlay = vi.fn();
    const browserManager = {
      status: vi.fn().mockResolvedValue({
        mode: "extension",
        activeTargetId: "tab-preview",
        url: "https://example.com/app",
        title: "App"
      }),
      supportsOpsOverlayTransport: vi.fn().mockReturnValue(false),
      mountCanvasOverlay,
      selectCanvasOverlay,
      syncCanvasOverlay,
      unmountCanvasOverlay
    };

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
    const internal = manager as unknown as {
      mountDirectOverlay: (
        sessionId: string,
        targetId: string,
        canvasDocument: unknown,
        prototypeId: string
      ) => Promise<Record<string, unknown>>;
      selectDirectOverlay: (
        sessionId: string,
        targetId: string,
        nodeId: string | null,
        hint: Record<string, unknown>
      ) => Promise<Record<string, unknown>>;
      unmountDirectOverlay: (sessionId: string, targetId: string) => Promise<void>;
      syncLiveViews: (session: unknown) => Promise<void>;
    };
    const mountDirectOverlay = vi.spyOn(internal, "mountDirectOverlay").mockResolvedValue({
      mountId: "mount-direct",
      targetId: "tab-preview",
      overlayState: "mounted",
      capabilities: { selection: true, guides: true }
    });
    const selectDirectOverlay = vi.spyOn(internal, "selectDirectOverlay").mockResolvedValue({
      matched: true,
      selector: "#cta"
    });
    const unmountDirectOverlay = vi.spyOn(internal, "unmountDirectOverlay").mockResolvedValue(undefined);
    vi.spyOn(internal, "syncLiveViews").mockResolvedValue(undefined);

    const opened = await manager.execute("canvas.session.open", {
      browserSessionId: "browser-extension"
    }) as Record<string, unknown>;
    const canvasSessionId = String(opened.canvasSessionId);
    const leaseId = String(opened.leaseId);

    const overlay = await manager.execute("canvas.overlay.mount", {
      canvasSessionId,
      leaseId,
      targetId: "tab-preview",
      prototypeId: "proto_home_default"
    }) as Record<string, unknown>;
    expect(overlay.mountId).toBe("mount-direct");

    await manager.execute("canvas.overlay.select", {
      canvasSessionId,
      leaseId,
      mountId: "mount-direct",
      targetId: "tab-preview",
      selectionHint: { selector: "#cta" }
    });
    await manager.execute("canvas.overlay.unmount", {
      canvasSessionId,
      leaseId,
      mountId: "mount-direct",
      targetId: "tab-preview"
    });

    expect(browserManager.supportsOpsOverlayTransport).toHaveBeenCalledWith("browser-extension");
    expect(mountCanvasOverlay).not.toHaveBeenCalled();
    expect(selectCanvasOverlay).not.toHaveBeenCalled();
    expect(syncCanvasOverlay).not.toHaveBeenCalled();
    expect(unmountCanvasOverlay).not.toHaveBeenCalled();
    expect(mountDirectOverlay).toHaveBeenCalledWith(
      "browser-extension",
      "tab-preview",
      expect.objectContaining({ title: expect.any(String) }),
      "proto_home_default"
    );
    expect(selectDirectOverlay).toHaveBeenCalledWith("browser-extension", "tab-preview", null, { selector: "#cta" });
    expect(unmountDirectOverlay).toHaveBeenCalledWith("browser-extension", "tab-preview", "mount-direct");
  });

  it("uses the adopted ops target id for extension design tabs after registration", async () => {
    const browserManager = {
      status: vi.fn().mockResolvedValue({
        mode: "extension",
        activeTargetId: "tab-preview",
        url: "https://example.com/app",
        title: "App"
      }),
      registerCanvasTarget: vi.fn().mockResolvedValue({
        targetId: "tab-ext-adopted",
        adopted: true,
        url: "chrome-extension://test/canvas.html",
        title: "Canvas"
      }),
      closeTarget: vi.fn().mockResolvedValue(undefined)
    };

    canvasClientRequestMock.mockImplementation(async (command: string, payload?: Record<string, unknown>) => {
      if (command === "canvas.tab.open") {
        return { targetId: "tab-ext-raw", previewState: "focused" };
      }
      if (command === "canvas.tab.close") {
        return { ok: true, targetId: payload?.targetId };
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
    const canvasSessionId = String(opened.canvasSessionId);
    const leaseId = String(opened.leaseId);

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
    })).resolves.toMatchObject({
      targetId: "tab-ext-adopted",
      targetIds: ["tab-ext-adopted"],
      designTab: true
    });

    await manager.execute("canvas.tab.close", {
      canvasSessionId,
      leaseId,
      targetId: "tab-ext-adopted"
    });

    expect(browserManager.registerCanvasTarget).toHaveBeenCalledWith("browser-extension", "tab-ext-raw");
    expect(canvasClientRequestMock).toHaveBeenCalledWith(
      "canvas.tab.close",
      expect.objectContaining({ targetId: "tab-ext-adopted" }),
      canvasSessionId,
      30000,
      leaseId
    );
  });

  it("retries extension design-tab registration when the target is not yet visible to /ops", async () => {
    const browserManager = {
      status: vi.fn().mockResolvedValue({
        mode: "extension",
        activeTargetId: "tab-root",
        url: "https://example.com/app",
        title: "App"
      }),
      registerCanvasTarget: vi.fn()
        .mockResolvedValueOnce({
          targetId: "tab-ext-raw",
          adopted: true,
          url: "chrome-extension://test/canvas.html",
          title: "Canvas"
        })
        .mockResolvedValueOnce({
          targetId: "tab-ext-raw",
          adopted: false,
          url: "chrome-extension://test/canvas.html",
          title: "Canvas"
        }),
      listTargets: vi.fn()
        .mockResolvedValueOnce({
          activeTargetId: "tab-root",
          targets: [{ targetId: "tab-root", type: "page", title: "App", url: "https://example.com/app" }]
        })
        .mockResolvedValueOnce({
          activeTargetId: "tab-root",
          targets: [
            { targetId: "tab-root", type: "page", title: "App", url: "https://example.com/app" },
            { targetId: "tab-ext-raw", type: "page", title: "Canvas", url: "chrome-extension://test/canvas.html" }
          ]
        }),
      closeTarget: vi.fn().mockResolvedValue(undefined)
    };

    canvasClientRequestMock.mockImplementation(async (command: string) => {
      if (command === "canvas.tab.open") {
        return { targetId: "tab-ext-raw", previewState: "focused" };
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
    const canvasSessionId = String(opened.canvasSessionId);
    const leaseId = String(opened.leaseId);

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
    })).resolves.toMatchObject({
      targetId: "tab-ext-raw",
      targetIds: ["tab-ext-raw"],
      designTab: true
    });

    expect(browserManager.registerCanvasTarget).toHaveBeenCalledTimes(2);
    expect(browserManager.listTargets).toHaveBeenCalledTimes(2);
  });

  it("fails canvas.tab.open when the extension design tab never becomes an /ops target", async () => {
    const browserManager = {
      status: vi.fn().mockResolvedValue({
        mode: "extension",
        activeTargetId: "tab-root",
        url: "https://example.com/app",
        title: "App"
      }),
      registerCanvasTarget: vi.fn().mockResolvedValue({
        targetId: "tab-ext-raw",
        adopted: true,
        url: "chrome-extension://test/canvas.html",
        title: "Canvas"
      }),
      listTargets: vi.fn().mockResolvedValue({
        activeTargetId: "tab-root",
        targets: [{ targetId: "tab-root", type: "page", title: "App", url: "https://example.com/app" }]
      }),
      closeTarget: vi.fn().mockResolvedValue(undefined)
    };

    canvasClientRequestMock.mockImplementation(async (command: string) => {
      if (command === "canvas.tab.open") {
        return { targetId: "tab-ext-raw", previewState: "focused" };
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
    const canvasSessionId = String(opened.canvasSessionId);
    const leaseId = String(opened.leaseId);

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
    })).rejects.toThrow("canvas.tab.open could not register the design tab for /ops. Reload the unpacked extension and retry.");

    expect(browserManager.registerCanvasTarget).toHaveBeenCalledTimes(2);
    expect(browserManager.listTargets).toHaveBeenCalledTimes(2);
  });

  it("keeps the raw extension design-tab target when the relay has no live /ops transport", async () => {
    const browserManager = {
      status: vi.fn().mockResolvedValue({
        mode: "extension",
        activeTargetId: "tab-root",
        url: "https://example.com/app",
        title: "App"
      }),
      supportsOpsOverlayTransport: vi.fn().mockReturnValue(true),
      registerCanvasTarget: vi.fn(),
      listTargets: vi.fn(),
      closeTarget: vi.fn().mockResolvedValue(undefined)
    };

    canvasClientRequestMock.mockImplementation(async (command: string) => {
      if (command === "canvas.tab.open") {
        return { targetId: "tab-ext-raw", previewState: "focused" };
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
          cdpConnected: true,
          annotationConnected: false,
          opsConnected: false,
          canvasConnected: true,
          pairingRequired: false,
          instanceId: "relay-1",
          epoch: 1,
          health: {
            ok: true,
            reason: "ok",
            extensionConnected: true,
            extensionHandshakeComplete: true,
            cdpConnected: true,
            annotationConnected: false,
            opsConnected: false,
            canvasConnected: true,
            pairingRequired: false
          }
        }),
        getCdpUrl: () => "ws://127.0.0.1:8787/cdp",
        getCanvasUrl: () => "ws://127.0.0.1:8787/canvas"
      }
    });

    const opened = await manager.execute("canvas.session.open", {
      browserSessionId: "browser-extension-legacy"
    }) as Record<string, unknown>;
    const canvasSessionId = String(opened.canvasSessionId);
    const leaseId = String(opened.leaseId);

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
    })).resolves.toMatchObject({
      targetId: "tab-ext-raw",
      targetIds: ["tab-ext-raw"],
      designTab: true
    });

    await manager.execute("canvas.tab.close", {
      canvasSessionId,
      leaseId,
      targetId: "tab-ext-raw"
    });

    expect(browserManager.supportsOpsOverlayTransport).toHaveBeenCalledWith("browser-extension-legacy");
    expect(browserManager.registerCanvasTarget).not.toHaveBeenCalled();
    expect(browserManager.listTargets).not.toHaveBeenCalled();
    expect(canvasClientRequestMock).toHaveBeenCalledWith(
      "canvas.tab.close",
      expect.objectContaining({ targetId: "tab-ext-raw" }),
      canvasSessionId,
      30000,
      leaseId
    );
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
      bindingStatus: {
        state: string;
        frameworkAdapterId: string;
        declaredCapabilities: string[];
        grantedCapabilities: string[];
        capabilityDenials: unknown[];
        reasonCode: string;
      };
      summary: { bindings: Array<{ bindingId: string }> };
    };
    expect(bound.bindingStatus).toMatchObject({
      state: "idle",
      frameworkAdapterId: "builtin:react-tsx-v2",
      declaredCapabilities: ["preview", "inventory_extract", "code_pull", "code_push", "token_roundtrip"],
      grantedCapabilities: ["preview", "inventory_extract", "code_pull", "code_push", "token_roundtrip"],
      capabilityDenials: [],
      reasonCode: "none"
    });
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
        projection: "canvas_html",
        frameworkAdapterId: "builtin:react-tsx-v2",
        declaredCapabilities: ["preview", "inventory_extract", "code_pull", "code_push", "token_roundtrip"],
        grantedCapabilities: ["preview", "inventory_extract", "code_pull", "code_push", "token_roundtrip"],
        capabilityDenials: [],
        reasonCode: "none"
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

  it("resolves relative code-sync and document paths against the session repoRoot", async () => {
    const repoRoot = join(worktree, "caller-root");
    const relativeSourcePath = join("src", "Hero.tsx");
    const sourcePath = join(repoRoot, relativeSourcePath);
    const relativeSavePath = ".opendevbrowser/canvas/relative-session.canvas.json";
    const expectedSavePath = join(repoRoot, ".opendevbrowser", "canvas", "relative-session.canvas.json");
    await mkdir(join(repoRoot, "src"), { recursive: true });
    await writeFile(sourcePath, [
      "export function Hero() {",
      "  return <section className=\"hero-shell\"><span>Hello repo root</span></section>;",
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

    const opened = await manager.execute("canvas.session.open", { repoRoot }) as {
      canvasSessionId: string;
      leaseId: string;
      documentId: string;
    };
    const session = (manager as {
      sessions: Map<string, { store: { getRevision: () => number } }>;
    }).sessions.get(opened.canvasSessionId);
    if (!session) {
      throw new Error("Missing canvas session");
    }

    const loaded = await manager.execute("canvas.document.load", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      documentId: opened.documentId
    }) as {
      document: { pages: Array<{ rootNodeId: string | null }> };
    };
    const rootNodeId = loaded.document.pages[0]?.rootNodeId;
    expect(rootNodeId).toBeTruthy();

    await manager.execute("canvas.plan.set", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      generationPlan: structuredClone(validGenerationPlan)
    });
    await manager.execute("canvas.document.patch", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      baseRevision: session.store.getRevision(),
      patches: governanceBootstrapPatches.map((patch) => ({ ...patch }))
    });

    await manager.execute("canvas.code.bind", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      nodeId: rootNodeId,
      bindingId: "binding_relative_repo_root",
      repoPath: relativeSourcePath,
      exportName: "Hero",
      syncMode: "manual"
    });

    expect(await manager.execute("canvas.code.pull", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      bindingId: "binding_relative_repo_root"
    })).toMatchObject({
      ok: true,
      repoPath: sourcePath
    });

    expect(await manager.execute("canvas.document.save", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      repoPath: relativeSavePath
    })).toMatchObject({
      repoPath: expectedSavePath
    });
    expect(await readFile(expectedSavePath, "utf-8")).toContain(`"documentId": "${opened.documentId}"`);
    await expect(readFile(join(worktree, ".opendevbrowser", "canvas", "relative-session.canvas.json"), "utf-8")).rejects.toThrow();
  });

  it("surfaces missing plugin adapters and denial reasons through canvas.code.status", async () => {
    const sourcePath = join(worktree, "PluginBinding.astro");
    await writeFile(sourcePath, "<main id=\"plugin-root\">Plugin shell</main>\n");

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

    await manager.execute("canvas.plan.set", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      generationPlan: structuredClone(validGenerationPlan)
    });

    const bound = await manager.execute("canvas.code.bind", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      nodeId: rootNodeId,
      bindingId: "binding_missing_plugin",
      repoPath: sourcePath,
      frameworkAdapterId: "acme-plugin/astro-v1",
      selector: "#plugin-root",
      syncMode: "manual",
      declaredCapabilities: ["preview", "code_pull"],
      grantedCapabilities: [
        { capability: "preview", granted: true },
        {
          capability: "code_pull",
          granted: false,
          reasonCode: "capability_denied",
          details: { source: "workspace-policy" }
        }
      ]
    }) as {
      bindingStatus: {
        state: string;
        frameworkAdapterId: string;
        declaredCapabilities: string[];
        grantedCapabilities: string[];
        capabilityDenials: Array<{ capability: string; granted: boolean; reasonCode?: string }>;
        reasonCode: string;
      };
    };

    expect(bound.bindingStatus).toMatchObject({
      state: "unsupported",
      frameworkAdapterId: "acme-plugin/astro-v1",
      declaredCapabilities: ["preview", "code_pull"],
      grantedCapabilities: ["preview"],
      capabilityDenials: [
        expect.objectContaining({
          capability: "code_pull",
          granted: false,
          reasonCode: "capability_denied"
        })
      ],
      reasonCode: "plugin_not_found"
    });

    expect(await manager.execute("canvas.code.status", {
      canvasSessionId: opened.canvasSessionId,
      bindingId: "binding_missing_plugin"
    })).toMatchObject({
      bindingStatus: {
        bindingId: "binding_missing_plugin",
        state: "unsupported",
        frameworkAdapterId: "acme-plugin/astro-v1",
        declaredCapabilities: ["preview", "code_pull"],
        grantedCapabilities: ["preview"],
        capabilityDenials: [
          expect.objectContaining({
            capability: "code_pull",
            granted: false,
            reasonCode: "capability_denied"
          })
        ],
        reasonCode: "plugin_not_found"
      },
      summary: {
        boundFiles: [sourcePath],
        codeSyncState: "unsupported"
      }
    });
  });

  it("auto-generates code-sync binding ids and falls back to default conflict messages", async () => {
    const sourcePath = join(worktree, "GeneratedBinding.tsx");
    await writeFile(sourcePath, [
      "export function GeneratedBinding() {",
      "  return <section><span>Generated</span></section>;",
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

    await manager.execute("canvas.plan.set", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      generationPlan: structuredClone(validGenerationPlan)
    });

    const bound = await manager.execute("canvas.code.bind", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      nodeId: rootNodeId,
      repoPath: sourcePath,
      exportName: "GeneratedBinding",
      syncMode: "manual"
    }) as {
      binding: { id: string; codeSync: { repoPath: string } };
      summary: { bindings: Array<{ bindingId: string }> };
    };
    expect(bound.binding.id).toMatch(/^binding_sync_/);
    expect(bound.binding.codeSync.repoPath).toBe(sourcePath);
    expect(bound.summary.bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ bindingId: bound.binding.id })
    ]));

    expect(await manager.execute("canvas.code.status", {
      canvasSessionId: opened.canvasSessionId
    })).toMatchObject({
      codeSyncState: "idle",
      boundFiles: [sourcePath]
    });

    const internal = manager as unknown as {
      codeSyncManager: {
        pull: (args: unknown) => Promise<unknown>;
        push: (args: unknown) => Promise<unknown>;
      };
    };

    vi.spyOn(internal.codeSyncManager, "pull").mockResolvedValueOnce({
      ok: false,
      conflicts: []
    });
    expect(await manager.execute("canvas.code.pull", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      bindingId: bound.binding.id
    })).toMatchObject({
      ok: false,
      conflicts: []
    });

    vi.spyOn(internal.codeSyncManager, "push").mockResolvedValueOnce({
      ok: false,
      conflicts: []
    });
    expect(await manager.execute("canvas.code.push", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      bindingId: bound.binding.id
    })).toMatchObject({
      ok: false,
      conflicts: []
    });

    await expect(manager.execute("canvas.feedback.poll", {
      canvasSessionId: opened.canvasSessionId,
      categories: ["code-sync"]
    })).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          class: "code-sync-conflict",
          message: "Code-sync pull failed."
        }),
        expect.objectContaining({
          class: "code-sync-conflict",
          message: "Code-sync push failed."
        })
      ])
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

  it("covers watch-source change early-return and empty-conflict fallback branches", async () => {
    const sourcePath = join(worktree, "WatchEmptyConflictHero.tsx");
    await writeFile(sourcePath, [
      "export function WatchEmptyConflictHero() {",
      "  return <section><span>Watch fallback</span></section>;",
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

    const internal = manager as unknown as {
      codeSyncManager: {
        pull: (args: unknown) => Promise<unknown>;
      };
      handleWatchedSourceChange: (canvasSessionId: string, bindingId: string) => Promise<void>;
    };

    await expect(internal.handleWatchedSourceChange("canvas_missing", "binding_missing")).resolves.toBeUndefined();

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
      bindingId: "binding_watch_empty_conflict",
      repoPath: sourcePath,
      exportName: "WatchEmptyConflictHero",
      syncMode: "watch"
    });

    const pullSpy = vi.spyOn(internal.codeSyncManager, "pull").mockResolvedValueOnce({
      ok: false,
      conflicts: []
    });

    await internal.handleWatchedSourceChange(opened.canvasSessionId, "binding_watch_empty_conflict");

    expect(pullSpy).toHaveBeenCalledTimes(1);
    await expect(manager.execute("canvas.feedback.poll", {
      canvasSessionId: opened.canvasSessionId,
      categories: ["code-sync"]
    })).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          class: "code-sync-watch-conflict",
          message: "Watched source change could not be imported."
        })
      ])
    });
  });

  it("accepts explicit session modes and rejects invalid ones", async () => {
    const manager = new CanvasManager({
      worktree,
      browserManager: {
        status: vi.fn(),
        closeTarget: vi.fn()
      } as never,
      config
    });

    for (const mode of ["low-fi-wireframe", "high-fi-live-edit", "dual-track"] as const) {
      const opened = await manager.execute("canvas.session.open", { mode }) as {
        canvasSessionId: string;
      };
      expect(await manager.execute("canvas.session.status", {
        canvasSessionId: opened.canvasSessionId
      })).toMatchObject({ mode });
    }

    await expect(manager.execute("canvas.session.open", {
      mode: "unsupported-mode"
    })).rejects.toThrow("Invalid mode: unsupported-mode");
  });

  it("rejects full preview refresh when the active target no longer has a prototype id", async () => {
    const manager = new CanvasManager({
      worktree,
      browserManager: {
        status: vi.fn(),
        closeTarget: vi.fn()
      } as never,
      config
    });

    const opened = await manager.execute("canvas.session.open", {
      browserSessionId: "browser-refresh"
    }) as {
      canvasSessionId: string;
      leaseId: string;
    };

    const session = (manager as unknown as {
      sessions: Map<string, {
        activeTargets: Map<string, Record<string, unknown>>;
      }>;
    }).sessions.get(opened.canvasSessionId);
    session?.activeTargets.set("tab-lost-prototype", {
      targetId: "tab-lost-prototype",
      prototypeId: null,
      previewMode: "focused",
      previewState: "focused",
      renderStatus: "rendered",
      telemetryMode: "full",
      sourceUrl: null,
      screenshotPath: null,
      projection: "canvas_html",
      fallbackReason: null,
      degradeReason: null,
      lastSyncedAt: new Date().toISOString(),
      parityArtifact: null
    });

    await expect(manager.execute("canvas.preview.refresh", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      targetId: "tab-lost-prototype",
      refreshMode: "full"
    })).rejects.toMatchObject({
      code: "unsupported_target"
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

  it("filters starters and applies degraded starter fallbacks with canonical framework ids", async () => {
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

    const listed = await manager.execute("canvas.starter.list", {
      canvasSessionId: opened.canvasSessionId,
      query: "sign-in",
      frameworkIds: ["Next.js"],
      kitIds: ["auth.multi-step"],
      tags: ["auth"]
    }) as {
      total: number;
      items: Array<{ id: string }>;
    };
    expect(listed.total).toBe(1);
    expect(listed.items[0]?.id).toBe("auth.sign-in");

    const applied = await manager.execute("canvas.starter.apply", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      starterId: "hero.saas-product",
      frameworkId: "Next.js",
      libraryAdapterId: "builtin:html-static-v1"
    }) as {
      starterId: string;
      frameworkId: string;
      adapterId: string | null;
      libraryAdapterId: string | null;
      degraded: boolean;
      reason: string | null;
      planSeeded: boolean;
      seededInventoryItemIds: string[];
    };

    expect(applied).toMatchObject({
      starterId: "hero.saas-product",
      frameworkId: "nextjs",
      adapterId: "tsx-react-v1",
      libraryAdapterId: "tsx-react-v1",
      degraded: true,
      reason: "adapter_unavailable:builtin:html-static-v1",
      planSeeded: true,
      seededInventoryItemIds: ["kit.marketing.product-launch.feature-hero"]
    });

    const session = (manager as unknown as {
      sessions: Map<string, {
        store: {
          getDocument: () => {
            componentInventory: Array<{ id: string }>;
            pages: Array<{ nodes: Array<{ metadata?: Record<string, unknown> }> }>;
          };
        };
      }>;
    }).sessions.get(opened.canvasSessionId);
    if (!session) {
      throw new Error("Missing starter session");
    }
    expect(session.store.getDocument().componentInventory.some((item) => item.id === "kit.marketing.product-launch.feature-hero")).toBe(true);
    expect(session.store.getDocument().pages.some((page) =>
      page.nodes.some((node) => node.metadata?.starter)
    )).toBe(true);

    await expect(manager.execute("canvas.feedback.poll", {
      canvasSessionId: opened.canvasSessionId,
      categories: ["validation"]
    })).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          class: "starter-applied-degraded",
          message: "Applied starter SaaS Product Hero with semantic fallback for nextjs."
        })
      ])
    });
  });

  it("applies compatible starters without degradation and fills framework adapter metadata", async () => {
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

    const applied = await manager.execute("canvas.starter.apply", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      starterId: "dashboard.analytics",
      frameworkId: "react-tsx"
    }) as {
      starterId: string;
      frameworkId: string;
      adapterId: string | null;
      libraryAdapterId: string | null;
      degraded: boolean;
      reason: string | null;
      seededInventoryItemIds: string[];
    };

    expect(applied).toMatchObject({
      starterId: "dashboard.analytics",
      frameworkId: "react",
      adapterId: "tsx-react-v1",
      libraryAdapterId: "tsx-react-v1",
      degraded: false,
      reason: null,
      seededInventoryItemIds: ["kit.dashboard.analytics-core.metric-card"]
    });

    const session = (manager as unknown as {
      sessions: Map<string, {
        store: {
          getDocument: () => {
            componentInventory: Array<{
              id: string;
              framework?: {
                id: string;
                label: string;
                packageName: string | null;
                adapter: { id: string; label: string; packageName: string | null } | null;
              };
              adapter?: { id: string; label: string; packageName: string | null };
            }>;
          };
        };
      }>;
    }).sessions.get(opened.canvasSessionId);
    if (!session) {
      throw new Error("Missing starter session");
    }
    const metricCard = session.store.getDocument().componentInventory.find((item) => item.id === "kit.dashboard.analytics-core.metric-card");
    expect(metricCard).toMatchObject({
      framework: {
        id: "react",
        label: "React",
        packageName: "react",
        adapter: {
          id: "tsx-react-v1",
          label: "TSX React v1",
          packageName: "@opendevbrowser/tsx-react-v1"
        }
      },
      adapter: {
        id: "tsx-react-v1",
        label: "TSX React v1",
        packageName: "@opendevbrowser/tsx-react-v1"
      }
    });

    await expect(manager.execute("canvas.feedback.poll", {
      canvasSessionId: opened.canvasSessionId,
      categories: ["validation"]
    })).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          class: "starter-applied",
          details: expect.objectContaining({
            starterId: "dashboard.analytics",
            frameworkId: "react",
            adapterId: "tsx-react-v1",
            degraded: false,
            reason: null
          })
        })
      ])
    });
  });

  it("applies starter templates without kit hooks and preserves null adapter metadata", async () => {
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

    const applied = await manager.execute("canvas.starter.apply", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      starterId: "docs.reference",
      frameworkId: "astro"
    }) as {
      starterId: string;
      frameworkId: string;
      adapterId: string | null;
      degraded: boolean;
      reason: string | null;
      planSeeded: boolean;
      seededInventoryItemIds: string[];
      installedKitIds: string[];
      insertedNodeIds: string[];
    };

    expect(applied).toMatchObject({
      starterId: "docs.reference",
      frameworkId: "astro",
      adapterId: null,
      degraded: false,
      reason: null,
      planSeeded: true,
      seededInventoryItemIds: [],
      installedKitIds: []
    });
    expect(applied.insertedNodeIds.length).toBeGreaterThan(0);

    const session = (manager as unknown as {
      sessions: Map<string, {
        store: {
          getDocument: () => {
            meta: {
              starter: {
                frameworkId: string;
                metadata?: {
                  adapterId?: string | null;
                  installedKitIds?: string[];
                  seededInventoryItemIds?: string[];
                  materializedItemIds?: string[];
                };
              } | null;
            };
            componentInventory: Array<{ id: string }>;
            tokens: { collections: Array<{ id: string }> };
            pages: Array<{ nodes: Array<{ metadata?: { starter?: { id?: string; role?: string } } }> }>;
          };
        };
      }>;
    }).sessions.get(opened.canvasSessionId);
    if (!session) {
      throw new Error("Missing docs starter session");
    }
    const document = session.store.getDocument();
    expect(document.componentInventory).toEqual([]);
    expect(document.tokens.collections).toEqual([]);
    expect(document.meta.starter).toMatchObject({
      frameworkId: "astro",
      metadata: {
        adapterId: null,
        installedKitIds: [],
        seededInventoryItemIds: [],
        materializedItemIds: []
      }
    });
    expect(document.pages.some((page) =>
      page.nodes.some((node) => node.metadata?.starter?.id === "docs.reference")
    )).toBe(true);

    await expect(manager.execute("canvas.feedback.poll", {
      canvasSessionId: opened.canvasSessionId,
      categories: ["validation"]
    })).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          class: "starter-applied",
          details: expect.objectContaining({
            starterId: "docs.reference",
            frameworkId: "astro",
            adapterId: null,
            degraded: false,
            installedKitIds: [],
            seededInventoryItemIds: []
          })
        })
      ])
    });
  });

  it("applies remix starter metadata with remix framework package details", async () => {
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

    const applied = await manager.execute("canvas.starter.apply", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      starterId: "auth.sign-up",
      frameworkId: "remix"
    }) as {
      starterId: string;
      frameworkId: string;
      adapterId: string | null;
      libraryAdapterId: string | null;
      degraded: boolean;
      reason: string | null;
      seededInventoryItemIds: string[];
    };

    expect(applied).toMatchObject({
      starterId: "auth.sign-up",
      frameworkId: "remix",
      adapterId: "tsx-react-v1",
      libraryAdapterId: "tsx-react-v1",
      degraded: false,
      reason: null,
      seededInventoryItemIds: ["kit.auth.multi-step.sign-in-shell"]
    });

    const session = (manager as unknown as {
      sessions: Map<string, {
        store: {
          getDocument: () => {
            componentInventory: Array<{
              id: string;
              framework?: {
                id: string;
                label: string;
                packageName: string | null;
                adapter: { id: string; label: string; packageName: string | null } | null;
              };
              adapter?: { id: string; label: string; packageName: string | null };
              metadata?: {
                starter?: {
                  appliedFrameworkId?: string;
                  compatibleFrameworkIds?: string[];
                };
              };
            }>;
          };
        };
      }>;
    }).sessions.get(opened.canvasSessionId);
    if (!session) {
      throw new Error("Missing remix starter session");
    }
    const signUpShell = session.store.getDocument().componentInventory.find((item) => item.id === "kit.auth.multi-step.sign-in-shell");
    expect(signUpShell).toMatchObject({
      framework: {
        id: "remix",
        label: "Remix",
        packageName: "@remix-run/react",
        adapter: {
          id: "tsx-react-v1",
          label: "TSX React v1",
          packageName: "@opendevbrowser/tsx-react-v1"
        }
      },
      adapter: {
        id: "tsx-react-v1",
        label: "TSX React v1",
        packageName: "@opendevbrowser/tsx-react-v1"
      },
      metadata: {
        starter: {
          appliedFrameworkId: "remix",
          compatibleFrameworkIds: expect.arrayContaining(["react", "nextjs", "remix"])
        }
      }
    });
  });

  it("routes canvas_history_requested events only for supported undo and redo directions", async () => {
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

    const internal = manager as unknown as {
      handleCanvasEvent: (event: { event: string; canvasSessionId?: string; payload?: unknown }) => Promise<void>;
      applyHistoryDirection: (params: { canvasSessionId: string; leaseId: string }, direction: "undo" | "redo") => Promise<void>;
    };
    const applyHistoryDirection = vi.spyOn(internal, "applyHistoryDirection").mockResolvedValue(undefined);

    await internal.handleCanvasEvent({
      event: "canvas_history_requested",
      canvasSessionId: opened.canvasSessionId,
      payload: { direction: "undo" }
    });
    await internal.handleCanvasEvent({
      event: "canvas_history_requested",
      canvasSessionId: opened.canvasSessionId,
      payload: { direction: "redo" }
    });
    await internal.handleCanvasEvent({
      event: "canvas_history_requested",
      canvasSessionId: opened.canvasSessionId,
      payload: { direction: "sideways" }
    });

    expect(applyHistoryDirection.mock.calls).toEqual([
      [{ canvasSessionId: opened.canvasSessionId, leaseId: opened.leaseId }, "undo"],
      [{ canvasSessionId: opened.canvasSessionId, leaseId: opened.leaseId }, "redo"]
    ]);
  });

  it("returns empty perf metrics on missing or failing browser hooks and passes through successful metrics", async () => {
    const managerWithoutMetrics = new CanvasManager({
      worktree,
      browserManager: {
        status: vi.fn(),
        closeTarget: vi.fn()
      } as never,
      config
    });
    const perfMetrics = vi.fn()
      .mockRejectedValueOnce(new Error("metrics unavailable"))
      .mockResolvedValueOnce({ metrics: [{ name: "Nodes", value: 42 }] });
    const managerWithMetrics = new CanvasManager({
      worktree,
      browserManager: {
        status: vi.fn(),
        closeTarget: vi.fn(),
        perfMetrics
      } as never,
      config
    });
    const withoutMetrics = managerWithoutMetrics as unknown as {
      collectPerfMetrics: (sessionId: string, targetId: string) => Promise<{ metrics: Array<{ name: string; value: number }> }>;
    };
    const withMetrics = managerWithMetrics as unknown as {
      collectPerfMetrics: (sessionId: string, targetId: string) => Promise<{ metrics: Array<{ name: string; value: number }> }>;
    };

    await expect(withoutMetrics.collectPerfMetrics("session-a", "target-a")).resolves.toEqual({ metrics: [] });
    await expect(withMetrics.collectPerfMetrics("session-b", "target-b")).resolves.toEqual({ metrics: [] });
    await expect(withMetrics.collectPerfMetrics("session-c", "target-c")).resolves.toEqual({
      metrics: [{ name: "Nodes", value: 42 }]
    });
  });

  it("reconciles watched bindings during summary canvas.code.status without an explicit binding id", async () => {
    const sourcePath = join(worktree, "WatchSummaryHero.tsx");
    await writeFile(sourcePath, [
      "export function WatchSummaryHero() {",
      "  return <section><span>Watch summary</span></section>;",
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
    await manager.execute("canvas.code.bind", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      nodeId: loaded.document.pages[0]?.rootNodeId,
      bindingId: "binding_watch_summary",
      repoPath: sourcePath,
      exportName: "WatchSummaryHero",
      syncMode: "watch"
    });

    const internal = manager as unknown as {
      codeSyncManager: {
        getBindingStatus: (...args: unknown[]) => Promise<unknown>;
      };
      handleWatchedSourceChange: (canvasSessionId: string, bindingId: string) => Promise<void>;
    };
    vi.spyOn(internal.codeSyncManager, "getBindingStatus").mockResolvedValue({
      bindingId: "binding_watch_summary",
      nodeId: loaded.document.pages[0]?.rootNodeId,
      repoPath: sourcePath,
      adapter: "builtin:react-tsx-v2",
      frameworkAdapterId: "builtin:react-tsx-v2",
      frameworkId: "react",
      sourceFamily: "react-tsx",
      adapterKind: "tsx-react",
      adapterVersion: 2,
      syncMode: "watch",
      projection: "canvas_html",
      state: "drift_detected",
      driftState: "source_changed",
      watchEnabled: true,
      conflictCount: 0,
      unsupportedCount: 0,
      libraryAdapterIds: [],
      manifestVersion: 2,
      declaredCapabilities: [],
      grantedCapabilities: [],
      capabilityDenials: [],
      reasonCode: "none"
    });
    const watchedChange = vi.spyOn(internal, "handleWatchedSourceChange").mockResolvedValue(undefined);

    await manager.execute("canvas.code.status", {
      canvasSessionId: opened.canvasSessionId
    });

    expect(watchedChange).toHaveBeenCalledWith(opened.canvasSessionId, "binding_watch_summary");
  });

  it("falls back to canvas_html without a runtime fallback reason when the bound runtime node is removed", async () => {
    const sourcePath = join(worktree, "RuntimeMissingBinding.tsx");
    await writeFile(sourcePath, [
      "export function RuntimeMissingBinding() {",
      "  return <section>Runtime missing binding</section>;",
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
      goto: vi.fn().mockResolvedValue({ finalUrl: "https://example.com/app", status: 200, timingMs: 5 }),
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
      browserSessionId: "browser-runtime-missing-binding"
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
    const rootNodeId = loaded.document.pages[0]?.rootNodeId;
    await manager.execute("canvas.plan.set", {
      canvasSessionId,
      leaseId,
      generationPlan: structuredClone(validGenerationPlan)
    });
    await manager.execute("canvas.code.bind", {
      canvasSessionId,
      leaseId,
      nodeId: rootNodeId,
      bindingId: "binding_runtime_missing_html",
      repoPath: sourcePath,
      exportName: "RuntimeMissingBinding",
      projection: "bound_app_runtime",
      runtimeRootSelector: "#runtime-root"
    });
    const runtimeSession = (manager as unknown as {
      sessions: Map<string, { store: { getRevision: () => number } }>;
    }).sessions.get(canvasSessionId);
    if (!runtimeSession) {
      throw new Error("Missing runtime fallback session");
    }
    await manager.execute("canvas.document.patch", {
      canvasSessionId,
      leaseId,
      baseRevision: runtimeSession.store.getRevision(),
      patches: [{
        op: "node.remove",
        nodeId: String(rootNodeId)
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

    expect(String(browserManager.goto.mock.calls.at(-1)?.[1])).toContain("data:text/html");
    await expect(manager.execute("canvas.feedback.poll", {
      canvasSessionId,
      categories: ["render"]
    })).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          details: expect.objectContaining({
            projection: "canvas_html",
            fallbackReason: null
          })
        })
      ])
    });
  });

  it("uses browserManager.applyRuntimePreviewBridge when available and reports explicit runtime fallback reasons", async () => {
    const sourcePath = join(worktree, "RuntimeBridgeFailure.tsx");
    await writeFile(sourcePath, [
      "export function RuntimeBridgeFailure() {",
      "  return <section>Runtime bridge failure</section>;",
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
      goto: vi.fn().mockResolvedValue({ finalUrl: "https://example.com/app", status: 200, timingMs: 5 }),
      screenshot: vi.fn().mockResolvedValue({ path: undefined }),
      perfMetrics: vi.fn().mockResolvedValue({ metrics: [] }),
      consolePoll: vi.fn().mockResolvedValue({ events: [], nextSeq: 0 }),
      networkPoll: vi.fn().mockResolvedValue({ events: [], nextSeq: 0 }),
      applyRuntimePreviewBridge: vi.fn().mockResolvedValue({
        ok: false,
        fallbackReason: "runtime_root_missing",
        artifact: null
      })
    };

    const manager = new CanvasManager({
      worktree,
      browserManager: browserManager as never,
      config
    });

    const opened = await manager.execute("canvas.session.open", {
      browserSessionId: "browser-runtime-bridge-failure"
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
      bindingId: "binding_runtime_bridge_failure",
      repoPath: sourcePath,
      exportName: "RuntimeBridgeFailure",
      projection: "bound_app_runtime",
      runtimeRootSelector: "#runtime-root"
    });

    await manager.execute("canvas.preview.render", {
      canvasSessionId,
      leaseId,
      targetId: "tab-preview",
      prototypeId: "proto_home_default"
    });
    expect(browserManager.applyRuntimePreviewBridge).toHaveBeenCalled();
    expect(String(browserManager.goto.mock.calls.at(-1)?.[1])).toContain("data:text/html");

    const feedback = await manager.execute("canvas.feedback.poll", {
      canvasSessionId,
      categories: ["render"]
    }) as {
      items: Array<{ details?: { projection?: string; fallbackReason?: string | null } }>;
    };
    expect(feedback.items.some((item) =>
      item.details?.projection === "canvas_html"
      && item.details.fallbackReason === "runtime_root_missing"
    )).toBe(true);
  });
});

function readJsonFixture(relativePath: string): unknown {
  return JSON.parse(readFileSync(join(process.cwd(), relativePath), "utf-8"));
}
