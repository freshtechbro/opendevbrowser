// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChromeMock } from "./extension-chrome-mock";
import type { CanvasPageState } from "../extension/src/canvas/model";

const canvasHtml = readFileSync("extension/canvas.html", "utf8");
const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

type PortListener = (message: unknown, port: chrome.runtime.Port) => void;
type DisconnectListener = (port: chrome.runtime.Port) => void;

const createPort = (tabId: number) => {
  const messageListeners = new Set<PortListener>();
  const disconnectListeners = new Set<DisconnectListener>();
  const messages: unknown[] = [];
  const port = {
    name: "canvas-page",
    sender: { tab: { id: tabId } },
    postMessage: vi.fn((message: unknown) => {
      messages.push(message);
    }),
    disconnect: vi.fn(() => {
      for (const listener of disconnectListeners) {
        listener(port as chrome.runtime.Port);
      }
    }),
    onMessage: {
      addListener: (listener: PortListener) => {
        messageListeners.add(listener);
      }
    },
    onDisconnect: {
      addListener: (listener: DisconnectListener) => {
        disconnectListeners.add(listener);
      }
    },
    emitMessage: (message: unknown) => {
      for (const listener of messageListeners) {
        listener(message, port as chrome.runtime.Port);
      }
    },
    messages
  };
  return port;
};

const buildState = (): CanvasPageState => ({
  tabId: 1,
  targetId: "tab-1",
  canvasSessionId: "canvas_session_01",
  documentId: "doc_canvas",
  documentRevision: 7,
  title: "Marketing Canvas",
  html: "<!doctype html><html><body><main data-preview=\"canvas\"></main></body></html>",
  previewMode: "focused",
  previewState: "focused",
  updatedAt: "2026-03-15T12:00:00.000Z",
  summary: {
    canvasSessionId: "canvas_session_01",
    mode: "dual-track",
    planStatus: "accepted",
    preflightState: "patching_enabled",
    componentInventoryCount: 1,
    availableInventoryCount: 2,
    availableStarterCount: 4,
    componentSourceKinds: ["code_sync"],
    boundFiles: ["src/app.tsx"],
    history: {
      canUndo: true,
      canRedo: false,
      undoDepth: 2,
      redoDepth: 0,
      stale: false,
      depthLimit: 100
    },
    bindings: [{
      bindingId: "binding_card",
      nodeId: "node_card",
      repoPath: "src/app.tsx",
      adapter: "tsx-react-v2",
      syncMode: "two_way",
      projection: "canvas_html",
      state: "in_sync",
      driftState: "clean",
      watchEnabled: true,
      conflictCount: 0,
      unsupportedCount: 0
    }],
    targets: [],
    attachedClients: [{
      clientId: "client-1",
      role: "lease_holder",
      attachedAt: "2026-03-15T12:00:00.000Z",
      lastSeenAt: "2026-03-15T12:00:00.000Z"
    }]
  },
  targets: [{
    targetId: "tab-1",
    prototypeId: null,
    previewMode: "focused",
    previewState: "focused",
    projection: "canvas_html",
    fallbackReason: null
  }],
  overlayMounts: [],
  feedback: [],
  feedbackCursor: null,
  selection: {
    pageId: "page_home",
    nodeId: "node_card",
    targetId: "tab-1",
    updatedAt: "2026-03-15T12:00:00.000Z"
  },
  viewport: {
    x: 96,
    y: 72,
    zoom: 1
  },
  document: {
    documentId: "doc_canvas",
    title: "Marketing Canvas",
    pages: [
      {
        id: "page_home",
        name: "Home",
        path: "/",
        rootNodeId: "node_root",
        prototypeIds: [],
        nodes: [
          {
            id: "node_root",
            kind: "frame",
            name: "Root Frame",
            pageId: "page_home",
            parentId: null,
            childIds: ["node_card", "node_cta"],
            rect: { x: 0, y: 0, width: 720, height: 520 },
            props: {},
            style: { backgroundColor: "#0f172a" },
            tokenRefs: {},
            bindingRefs: {},
            variantPatches: [],
            metadata: {}
          },
          {
            id: "node_card",
            kind: "component-instance",
            name: "Hero Card",
            pageId: "page_home",
            parentId: "node_root",
            childIds: [],
            rect: { x: 64, y: 80, width: 280, height: 180 },
            props: { text: "Hero headline" },
            style: {
              color: "#f8fafc",
              backgroundColor: "#111827",
              fontSize: "24px",
              borderRadius: "20px"
            },
            tokenRefs: { backgroundColor: { path: "theme.primary" } },
            bindingRefs: { primary: "binding_card" },
            variantPatches: [{ selector: { state: "hover" }, changes: { "style.backgroundColor": "#1f2937" } }],
            metadata: {
              accessibility: {
                role: "article",
                label: "Hero card"
              }
            }
          },
          {
            id: "node_cta",
            kind: "component-instance",
            name: "Hero CTA",
            pageId: "page_home",
            parentId: "node_root",
            childIds: [],
            rect: { x: 388, y: 128, width: 180, height: 56 },
            props: {
              text: "Launch",
              tagName: "button"
            },
            style: {
              color: "#ffffff",
              backgroundColor: "#0ea5e9"
            },
            tokenRefs: {},
            bindingRefs: {},
            variantPatches: [],
            metadata: {}
          }
        ],
        metadata: {}
      },
      {
        id: "page_docs",
        name: "Docs",
        path: "/docs",
        rootNodeId: "node_docs_root",
        prototypeIds: [],
        nodes: [
          {
            id: "node_docs_root",
            kind: "frame",
            name: "Docs Root",
            pageId: "page_docs",
            parentId: null,
            childIds: [],
            rect: { x: 0, y: 0, width: 640, height: 420 },
            props: {},
            style: {},
            tokenRefs: {},
            bindingRefs: {},
            variantPatches: [],
            metadata: {}
          }
        ],
        metadata: {}
      }
    ],
    bindings: [{
      id: "binding_card",
      nodeId: "node_card",
      kind: "component",
      selector: "#hero-card",
      componentName: "HeroCard",
      metadata: {
        sourceKind: "code_sync",
        inventoryItemId: "inventory_hero_card",
        selector: "#hero-card"
      }
    }],
    assets: [],
    componentInventory: [{
      id: "inventory_hero_card",
      name: "HeroCard",
      componentName: "HeroCard",
      sourceKind: "code_sync",
      framework: { id: "react", label: "React", metadata: {} },
      adapter: { id: "tsx-react-v2", label: "TSX React", metadata: {} },
      plugin: { id: "local-ui-kit", label: "Local UI Kit", metadata: {} },
      variants: [],
      props: [],
      slots: [],
      events: [],
      content: {},
      metadata: {}
    }],
    tokens: {
      values: {
        theme: {
          primary: "#111827"
        }
      },
      collections: [],
      aliases: [],
      bindings: [],
      metadata: {}
    },
    meta: {
      imports: [{
        id: "import_01",
        source: {
          label: "Homepage Figma",
          kind: "figma",
          frameworkId: "react"
        }
      }],
      starter: null,
      adapterPlugins: [],
      pluginErrors: [],
      metadata: {}
    }
  }
});

describe("extension canvas editor", () => {
  const originalChrome = globalThis.chrome;
  const originalBroadcastChannel = globalThis.BroadcastChannel;
  const originalIndexedDb = globalThis.indexedDB;
  const originalPointerEvent = globalThis.PointerEvent;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const originalSetPointerCapture = HTMLElement.prototype.setPointerCapture;

  let chromeState: ReturnType<typeof createChromeMock>;
  let port: ReturnType<typeof createPort>;

  beforeEach(async () => {
    vi.resetModules();
    document.documentElement.innerHTML = canvasHtml;
    chromeState = createChromeMock({ activeTab: { id: 1, url: "chrome-extension://test/canvas.html", title: "Canvas", status: "complete" } });
    port = createPort(1);

    const runtimeSendMessage = vi.fn((message: unknown, callback?: (response: unknown) => void) => {
      callback?.({
        ok: true,
        receipt: {
          deliveryState: "stored_only"
        },
        echoedMessage: message
      });
    });

    globalThis.chrome = {
      ...chromeState.chrome,
      runtime: {
        ...chromeState.chrome.runtime,
        connect: vi.fn(() => port as unknown as chrome.runtime.Port),
        sendMessage: runtimeSendMessage
      }
    } as typeof chrome;

    vi.stubGlobal("BroadcastChannel", undefined);
    vi.stubGlobal("indexedDB", undefined);
    vi.stubGlobal("PointerEvent", (globalThis.PointerEvent ?? MouseEvent) as typeof PointerEvent);
    vi.stubGlobal("requestAnimationFrame", ((callback: FrameRequestCallback) => setTimeout(() => callback(0), 0)) as typeof requestAnimationFrame);
    vi.stubGlobal("cancelAnimationFrame", ((handle: number) => clearTimeout(handle)) as typeof cancelAnimationFrame);
    HTMLElement.prototype.setPointerCapture = vi.fn();

    const stage = document.getElementById("canvas-stage") as HTMLElement;
    Object.defineProperty(stage, "clientWidth", { configurable: true, value: 960 });
    Object.defineProperty(stage, "clientHeight", { configurable: true, value: 640 });
    stage.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 960,
      height: 640,
      right: 960,
      bottom: 640,
      x: 0,
      y: 0,
      toJSON: () => ({})
    });

    await import("../extension/src/canvas-page");
    await flushMicrotasks();
    port.emitMessage({
      type: "canvas-page:init",
      state: buildState()
    });
    await flushMicrotasks();
  });

  afterEach(() => {
    globalThis.chrome = originalChrome;
    vi.unstubAllGlobals();
    if (originalBroadcastChannel) {
      globalThis.BroadcastChannel = originalBroadcastChannel;
    }
    if (originalIndexedDb) {
      globalThis.indexedDB = originalIndexedDb;
    }
    if (originalPointerEvent) {
      globalThis.PointerEvent = originalPointerEvent;
    }
    if (originalRequestAnimationFrame) {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    }
    if (originalCancelAnimationFrame) {
      globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    }
    HTMLElement.prototype.setPointerCapture = originalSetPointerCapture;
    vi.restoreAllMocks();
  });

  it("renders page navigation and requests history through the runtime port", async () => {
    const pageSelect = document.getElementById("canvas-page-select") as HTMLSelectElement;
    expect(Array.from(pageSelect.options).map((option) => option.value)).toEqual(["page_home", "page_docs"]);

    pageSelect.value = "page_docs";
    pageSelect.dispatchEvent(new Event("change", { bubbles: true }));

    expect(port.messages).toContainEqual(expect.objectContaining({
      type: "canvas-page-view-state",
      selection: expect.objectContaining({ pageId: "page_docs" })
    }));

    const undoButton = document.getElementById("canvas-history-undo") as HTMLButtonElement;
    undoButton.click();

    expect(port.messages).toContainEqual({
      type: "canvas-page-history-request",
      direction: "undo"
    });
  });

  it("emits duplicate requests from keyboard shortcuts", async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "d",
      ctrlKey: true,
      bubbles: true
    }));

    expect(port.messages).toContainEqual(expect.objectContaining({
      type: "canvas-page-patch-request",
      patches: [
        expect.objectContaining({
          op: "node.duplicate",
          nodeId: "node_card",
          idMap: expect.any(Object)
        })
      ]
    }));
  });

  it("commits layer rename and visibility changes through canvas.document.patch", async () => {
    const layerInput = document.querySelector("[data-node-id=\"node_card\"] .canvas-layer-name-input") as HTMLInputElement;
    layerInput.value = "Hero Card Updated";
    layerInput.dispatchEvent(new Event("change", { bubbles: true }));

    expect(port.messages).toContainEqual(expect.objectContaining({
      type: "canvas-page-patch-request",
      patches: [
        expect.objectContaining({
          op: "node.update",
          nodeId: "node_card",
          changes: expect.objectContaining({ name: "Hero Card Updated" })
        })
      ]
    }));

    port.emitMessage({
      type: "canvas-page:update",
      state: {
        ...buildState(),
        pendingMutation: false,
        updatedAt: "2026-03-15T12:00:01.000Z"
      }
    });
    await flushMicrotasks();

    const visibilityButton = document.querySelector("[data-node-id=\"node_card\"] .canvas-layer-visibility") as HTMLButtonElement;
    visibilityButton.click();

    expect(port.messages).toContainEqual(expect.objectContaining({
      type: "canvas-page-patch-request",
      patches: [
        expect.objectContaining({
          op: "node.visibility.set",
          nodeId: "node_card",
          hidden: true
        })
      ]
    }));
  });

  it("renders distinct framework, adapter, plugin, and import metadata for the current selection", () => {
    const selectionMeta = document.getElementById("canvas-selection-meta") as HTMLElement;

    expect(selectionMeta.textContent).toContain("Binding");
    expect(selectionMeta.textContent).toContain("HeroCard");
    expect(selectionMeta.textContent).toContain("Framework");
    expect(selectionMeta.textContent).toContain("React");
    expect(selectionMeta.textContent).toContain("Adapter");
    expect(selectionMeta.textContent).toContain("TSX React");
    expect(selectionMeta.textContent).toContain("Plugin");
    expect(selectionMeta.textContent).toContain("Local UI Kit");
    expect(selectionMeta.textContent).toContain("Latest import");
    expect(selectionMeta.textContent).toContain("Homepage Figma");
  });

  it("captures region annotations on the stage and sends region payloads through runtime messaging", async () => {
    const annotationMode = document.getElementById("canvas-annotation-mode") as HTMLSelectElement;
    annotationMode.value = "region";
    annotationMode.dispatchEvent(new Event("change", { bubbles: true }));

    const stage = document.getElementById("canvas-stage") as HTMLElement;
    stage.dispatchEvent(new PointerEvent("pointerdown", { clientX: 100, clientY: 100, bubbles: true }));
    stage.dispatchEvent(new PointerEvent("pointermove", { clientX: 240, clientY: 220, bubbles: true }));
    stage.dispatchEvent(new PointerEvent("pointerup", { clientX: 240, clientY: 220, bubbles: true }));
    await flushMicrotasks();

    const annotationList = document.getElementById("canvas-annotation-list") as HTMLElement;
    expect(annotationList.textContent).toContain("Region");

    const sendAllButton = document.getElementById("canvas-annotation-send") as HTMLButtonElement;
    sendAllButton.click();
    await flushMicrotasks();

    expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "annotation:sendPayload",
        payload: expect.objectContaining({
          annotations: [
            expect.objectContaining({
              tag: "canvas-region",
              selector: expect.stringContaining("[data-canvas-region="),
              attributes: expect.objectContaining({
                "data-canvas-kind": "region"
              })
            })
          ]
        })
      }),
      expect.any(Function)
    );
  });

  it("creates collections and modes from the token panel", async () => {
    const collectionName = document.getElementById("canvas-token-collection-name") as HTMLInputElement;
    const collectionCreate = document.getElementById("canvas-token-collection-create") as HTMLButtonElement;
    const tokenPath = document.getElementById("canvas-token-path") as HTMLInputElement;
    const tokenValue = document.getElementById("canvas-token-value") as HTMLInputElement;
    const tokenSave = document.getElementById("canvas-token-save") as HTMLButtonElement;
    const modeName = document.getElementById("canvas-token-mode-name") as HTMLInputElement;
    const modeCreate = document.getElementById("canvas-token-mode-create") as HTMLButtonElement;

    collectionName.value = "Brand";
    collectionCreate.click();
    await flushMicrotasks();

    expect(port.messages).toContainEqual(expect.objectContaining({
      type: "canvas-page-patch-request",
      patches: [
        expect.objectContaining({
          op: "tokens.replace",
          tokens: expect.objectContaining({
            collections: expect.arrayContaining([
              expect.objectContaining({
                id: "brand",
                name: "Brand"
              })
            ])
          })
        })
      ]
    }));

    port.emitMessage({
      type: "canvas-page:update",
      state: {
        ...buildState(),
        pendingMutation: false,
        document: {
          ...buildState().document,
          tokens: {
            ...buildState().document.tokens,
            collections: [{
              id: "brand",
              name: "Brand",
              items: [],
              metadata: {}
            }]
          }
        }
      }
    });
    await flushMicrotasks();

    tokenPath.value = "brand.primary";
    tokenPath.dispatchEvent(new Event("input", { bubbles: true }));
    tokenValue.value = "#22c55e";
    tokenSave.click();
    await flushMicrotasks();

    expect(port.messages.at(-1)).toEqual(expect.objectContaining({
      type: "canvas-page-patch-request",
      patches: [
        expect.objectContaining({
          op: "tokens.replace",
          tokens: expect.objectContaining({
            collections: expect.arrayContaining([
              expect.objectContaining({
                id: "brand",
                items: expect.arrayContaining([
                  expect.objectContaining({
                    path: "brand.primary",
                    value: "#22c55e"
                  })
                ])
              })
            ])
          })
        })
      ]
    }));

    port.emitMessage({
      type: "canvas-page:update",
      state: {
        ...buildState(),
        pendingMutation: false,
        document: {
          ...buildState().document,
          tokens: {
            ...buildState().document.tokens,
            collections: [{
              id: "brand",
              name: "Brand",
              items: [{
                id: "brand_primary",
                path: "brand.primary",
                value: "#22c55e",
                modes: [],
                metadata: {}
              }],
              metadata: {}
            }]
          }
        }
      }
    });
    await flushMicrotasks();

    modeName.value = "Night";
    modeCreate.click();
    await flushMicrotasks();

    expect(port.messages).toContainEqual(expect.objectContaining({
      type: "canvas-page-patch-request",
      patches: [
        expect.objectContaining({
          op: "tokens.replace",
          tokens: expect.objectContaining({
            metadata: expect.objectContaining({
              activeModeId: "night"
            }),
            collections: expect.arrayContaining([
              expect.objectContaining({
                id: "brand",
                items: expect.arrayContaining([
                  expect.objectContaining({
                    path: "brand.primary",
                    modes: expect.arrayContaining([
                      expect.objectContaining({
                        id: "night",
                        name: "Night"
                      })
                    ])
                  })
                ])
              })
            ])
          })
        })
      ]
    }));
  });

  it("updates stage styles and usage when token values change", async () => {
    const renderedStageNode = document.querySelector("#canvas-stage-inner [data-node-id=\"node_card\"]") as HTMLElement;
    const tokenPath = document.getElementById("canvas-token-path") as HTMLInputElement;
    const tokenValue = document.getElementById("canvas-token-value") as HTMLInputElement;
    const tokenSave = document.getElementById("canvas-token-save") as HTMLButtonElement;
    const tokenUsage = document.getElementById("canvas-token-usage") as HTMLElement;

    expect(renderedStageNode.style.getPropertyValue("background-color")).toBe("#111827");

    tokenPath.value = "theme.primary";
    tokenPath.dispatchEvent(new Event("input", { bubbles: true }));
    tokenValue.value = "#22c55e";
    tokenSave.click();
    await flushMicrotasks();

    const updatedStageNode = document.querySelector("#canvas-stage-inner [data-node-id=\"node_card\"]") as HTMLElement;
    expect(updatedStageNode.style.getPropertyValue("background-color")).toBe("#22c55e");
    expect(tokenUsage.textContent).toContain("Hero Card");
    expect(tokenUsage.textContent).toContain("backgroundColor");
    expect(port.messages).toContainEqual(expect.objectContaining({
      type: "canvas-page-patch-request",
      patches: [
        expect.objectContaining({
          op: "tokens.replace",
          tokens: expect.objectContaining({
            values: expect.objectContaining({
              theme: expect.objectContaining({
                primary: "#22c55e"
              })
            })
          })
        })
      ]
    }));
  });

  it("binds and clears selected-node token references from the token panel", async () => {
    const tokenPath = document.getElementById("canvas-token-path") as HTMLInputElement;
    const propertySelect = document.getElementById("canvas-token-binding-property") as HTMLSelectElement;
    const bindButton = document.getElementById("canvas-token-bind") as HTMLButtonElement;
    const clearButton = document.getElementById("canvas-token-binding-clear") as HTMLButtonElement;

    tokenPath.value = "theme.primary";
    tokenPath.dispatchEvent(new Event("input", { bubbles: true }));
    propertySelect.value = "color";
    propertySelect.dispatchEvent(new Event("change", { bubbles: true }));
    bindButton.click();
    await flushMicrotasks();

    expect(port.messages.at(-1)).toEqual(expect.objectContaining({
      type: "canvas-page-patch-request",
      patches: [
        expect.objectContaining({
          op: "node.update",
          nodeId: "node_card",
          changes: expect.objectContaining({
            tokenRefs: expect.objectContaining({
              backgroundColor: expect.anything(),
              color: "theme.primary"
            })
          })
        }),
        expect.objectContaining({
          op: "tokens.replace",
          tokens: expect.objectContaining({
            bindings: expect.arrayContaining([
              expect.objectContaining({
                path: "theme.primary",
                nodeId: "node_card",
                property: "color"
              })
            ])
          })
        })
      ]
    }));

    port.emitMessage({
      type: "canvas-page:update",
      state: {
        ...buildState(),
        pendingMutation: false,
        document: {
          ...buildState().document,
          tokens: {
            ...buildState().document.tokens,
            bindings: [{
              path: "theme.primary",
              nodeId: "node_card",
              bindingId: "binding_card",
              property: "color",
              metadata: {}
            }]
          },
          pages: buildState().document.pages.map((page) => page.id === "page_home"
            ? {
              ...page,
              nodes: page.nodes.map((node) => node.id === "node_card"
                ? {
                  ...node,
                  tokenRefs: {
                    ...node.tokenRefs,
                    color: "theme.primary"
                  }
                }
                : node)
            }
            : page)
        }
      }
    });
    await flushMicrotasks();

    clearButton.click();
    await flushMicrotasks();

    expect(port.messages.at(-1)).toEqual(expect.objectContaining({
      type: "canvas-page-patch-request",
      patches: [
        expect.objectContaining({
          op: "node.update",
          nodeId: "node_card",
          changes: expect.objectContaining({
            tokenRefs: expect.not.objectContaining({
              color: expect.anything()
            })
          })
        }),
        expect.objectContaining({
          op: "tokens.replace",
          tokens: expect.objectContaining({
            bindings: expect.not.arrayContaining([
              expect.objectContaining({
                nodeId: "node_card",
                property: "color"
              })
            ])
          })
        })
      ]
    }));
  });
});
