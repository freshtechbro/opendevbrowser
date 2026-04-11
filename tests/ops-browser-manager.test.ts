import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { OpenDevBrowserConfig } from "../src/config";
import { OpsBrowserManager } from "../src/browser/ops-browser-manager";
import { OpsRequestTimeoutError } from "../src/browser/ops-client";

const runtimePreviewBridgeMock = vi.hoisted(() => vi.fn().mockResolvedValue({
  ok: true,
  artifact: {
    projection: "bound_app_runtime",
    rootBindingId: "binding-fallback",
    capturedAt: "2026-03-12T10:00:00.000Z",
    hierarchyHash: "node-root:",
    nodes: []
  }
}));

vi.mock("fs/promises", async () => {
  const actual = await vi.importActual<typeof import("fs/promises")>("fs/promises");
  return actual;
});

vi.mock("../src/browser/canvas-runtime-preview-bridge", () => ({
  applyRuntimePreviewBridge: runtimePreviewBridgeMock
}));

const requestMock = vi.fn();
const connectMock = vi.fn().mockResolvedValue({
  type: "ops_hello_ack",
  version: "1",
  clientId: "client-1",
  maxPayloadBytes: 1024,
  capabilities: []
});
const disconnectMock = vi.fn().mockResolvedValue(undefined);

vi.mock("../src/browser/ops-client", async () => {
  const actual = await vi.importActual<typeof import("../src/browser/ops-client")>("../src/browser/ops-client");
  return {
    ...actual,
    OpsClient: class {
      url: string;
      private handlers: { onEvent?: (event: { event?: string; opsSessionId?: string }) => void; onClose?: () => void };
      constructor(url: string, handlers: { onEvent?: (event: { event?: string; opsSessionId?: string }) => void; onClose?: () => void }) {
        this.url = url;
        this.handlers = handlers;
      }
      async connect() {
        return await connectMock();
      }
      async request(...args: unknown[]) {
        return await requestMock(...args);
      }
      disconnect() {
        disconnectMock();
      }
      emitEvent(event: { event?: string; opsSessionId?: string }) {
        this.handlers.onEvent?.(event);
      }
      emitClose() {
        this.handlers.onClose?.();
      }
    }
  };
});

const makeConfig = (): OpenDevBrowserConfig => ({
  headless: false,
  profile: "default",
  snapshot: { maxChars: 16000, maxNodes: 1000 },
  security: { allowRawCDP: false, allowNonLocalCdp: false, allowUnsafeExport: false },
  devtools: { showFullUrls: false, showFullConsole: false },
  export: { maxNodes: 1000, inlineStyles: true },
  parallelism: {
    floor: 1,
    backpressureTimeoutMs: 5000,
    sampleIntervalMs: 2000,
    recoveryStableWindows: 3,
    hostFreeMemMediumPct: 25,
    hostFreeMemHighPct: 18,
    hostFreeMemCriticalPct: 10,
    rssBudgetMb: 2048,
    rssSoftPct: 65,
    rssHighPct: 75,
    rssCriticalPct: 85,
    queueAgeHighMs: 2000,
    queueAgeCriticalMs: 5000,
    modeCaps: {
      managedHeaded: 6,
      managedHeadless: 8,
      cdpConnectHeaded: 6,
      cdpConnectHeadless: 8,
      extensionOpsHeaded: 6,
      extensionLegacyCdpHeaded: 1
    }
  },
  skills: { nudge: { enabled: true, keywords: [], maxAgeMs: 60000 } },
  continuity: { enabled: true, filePath: "/tmp/continuity.md", nudge: { enabled: true, keywords: [], maxAgeMs: 60000 } },
  relayPort: 8787,
  relayToken: false,
  daemonPort: 8788,
  daemonToken: "daemon-token",
  chromePath: undefined,
  flags: [],
  checkForUpdates: false,
  persistProfile: true,
  skillPaths: []
});

function stubOpsScreencastSession(sessionId: string, targetId = "tab-1"): void {
  const url = `https://example.com/${sessionId}`;
  requestMock.mockImplementation(async (...args: unknown[]) => {
    const command = args[0] as string;
    switch (command) {
      case "session.connect":
        return { opsSessionId: sessionId, activeTargetId: targetId, leaseId: `lease-${sessionId}`, url };
      case "session.status":
        return { mode: "extension", activeTargetId: targetId, url, title: "Ops Screencast" };
      case "page.screenshot":
        return { base64: Buffer.from(`image-${sessionId}`).toString("base64") };
      case "targets.list":
        return {
          activeTargetId: targetId,
          targets: [{ targetId, type: "page", title: "Ops Screencast", url }]
        };
      case "targets.close":
        return { ok: true };
      default:
        return { ok: true };
    }
  });

  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ relayPort: 8787, pairingRequired: false, instanceId: "relay-1", epoch: 1 })
  }));
}

describe("OpsBrowserManager", () => {
  afterEach(() => {
    requestMock.mockReset();
    connectMock.mockClear();
    disconnectMock.mockClear();
    vi.unstubAllGlobals();
  });

  it("delegates /cdp relay endpoints to base manager", async () => {
    const base = {
      connect: vi.fn().mockResolvedValue({
        sessionId: "base-session",
        mode: "cdpConnect",
        activeTargetId: null,
        warnings: [],
        wsEndpoint: "ws://127.0.0.1:9222/devtools/browser/test"
      }),
      connectRelay: vi.fn().mockResolvedValue({
        sessionId: "base-session",
        mode: "extension",
        activeTargetId: null,
        warnings: [],
        wsEndpoint: "ws://127.0.0.1:8787/cdp"
      }),
      listPages: vi.fn().mockResolvedValue({ pages: [] }),
      closePage: vi.fn().mockResolvedValue(undefined),
      withPage: vi.fn().mockResolvedValue("ok"),
      applyRuntimePreviewBridge: vi.fn().mockResolvedValue({
        ok: true,
        artifact: {
          projection: "bound_app_runtime",
          rootBindingId: "binding-base",
          capturedAt: "2026-03-12T10:00:00.000Z",
          hierarchyHash: "node-root:",
          nodes: []
        }
      })
    };
    const manager = new OpsBrowserManager(base as never, makeConfig());

    const connectResult = await manager.connect({ wsEndpoint: "ws://127.0.0.1:9222/devtools/browser/test" } as never);
    expect(connectResult.sessionId).toBe("base-session");

    const result = await manager.connectRelay("ws://127.0.0.1:8787/cdp");
    expect(result.sessionId).toBe("base-session");
    expect(base.connectRelay).toHaveBeenCalledWith("ws://127.0.0.1:8787/cdp");

    await manager.listPages("base-session");
    expect(base.listPages).toHaveBeenCalled();
    await manager.closePage("base-session", "main");
    expect(base.closePage).toHaveBeenCalled();

    const value = await manager.withPage("base-session", null, async () => "ok");
    expect(value).toBe("ok");
    expect(await manager.applyRuntimePreviewBridge("base-session", null, {
      bindingId: "binding-base",
      rootSelector: "#root",
      html: "<div />"
    })).toEqual({
      ok: true,
      artifact: {
        projection: "bound_app_runtime",
        rootBindingId: "binding-base",
        capturedAt: "2026-03-12T10:00:00.000Z",
        hierarchyHash: "node-root:",
        nodes: []
      }
    });
  });

  it("delegates non-ops sessions to the base manager", async () => {
    const base = {
      launch: vi.fn().mockResolvedValue({
        sessionId: "base-session",
        mode: "managed",
        activeTargetId: null,
        warnings: [],
        wsEndpoint: "ws://127.0.0.1:9222/devtools/browser/base"
      }),
      connect: vi.fn().mockResolvedValue({
        sessionId: "base-session",
        mode: "cdpConnect",
        activeTargetId: null,
        warnings: [],
        wsEndpoint: "ws://127.0.0.1:9222/devtools/browser/base"
      }),
      connectRelay: vi.fn().mockResolvedValue({
        sessionId: "base-session",
        mode: "extension",
        activeTargetId: null,
        warnings: [],
        wsEndpoint: "ws://127.0.0.1:8787/cdp"
      }),
      disconnect: vi.fn().mockResolvedValue(undefined),
      status: vi.fn().mockResolvedValue({ mode: "managed", activeTargetId: null }),
      withPage: vi.fn().mockImplementation(async (_sessionId: string, _targetId: string | null, fn: () => Promise<string>) => {
        return await fn();
      }),
      applyRuntimePreviewBridge: vi.fn().mockResolvedValue({
        ok: false,
        fallbackReason: "runtime_projection_unsupported",
        message: "Missing runtime root"
      }),
      goto: vi.fn().mockResolvedValue({ finalUrl: "https://example.com", status: 200, timingMs: 1 }),
      waitForLoad: vi.fn().mockResolvedValue({ timingMs: 1 }),
      waitForRef: vi.fn().mockResolvedValue({ timingMs: 1 }),
      snapshot: vi.fn().mockResolvedValue({ snapshotId: "snap", content: "", truncated: false, refCount: 0, timingMs: 1 }),
      click: vi.fn().mockResolvedValue({ timingMs: 1, navigated: false }),
      hover: vi.fn().mockResolvedValue({ timingMs: 1 }),
      press: vi.fn().mockResolvedValue({ timingMs: 1 }),
      check: vi.fn().mockResolvedValue({ timingMs: 1 }),
      uncheck: vi.fn().mockResolvedValue({ timingMs: 1 }),
      type: vi.fn().mockResolvedValue({ timingMs: 1 }),
      select: vi.fn().mockResolvedValue(undefined),
      scroll: vi.fn().mockResolvedValue(undefined),
      scrollIntoView: vi.fn().mockResolvedValue({ timingMs: 1 }),
      domGetHtml: vi.fn().mockResolvedValue({ outerHTML: "<div></div>", truncated: false }),
      domGetText: vi.fn().mockResolvedValue({ text: "text", truncated: false }),
      domGetAttr: vi.fn().mockResolvedValue({ value: "attr" }),
      domGetValue: vi.fn().mockResolvedValue({ value: "value" }),
      domIsVisible: vi.fn().mockResolvedValue({ value: true }),
      domIsEnabled: vi.fn().mockResolvedValue({ value: true }),
      domIsChecked: vi.fn().mockResolvedValue({ value: false }),
      clonePageHtmlWithOptions: vi.fn().mockResolvedValue({ html: "<div>component</div>" }),
      clonePageWithOptions: vi.fn().mockResolvedValue({ component: "component", css: "" }),
      clonePage: vi.fn().mockResolvedValue({ component: "component", css: "" }),
      cloneComponent: vi.fn().mockResolvedValue({ component: "component", css: "" }),
      perfMetrics: vi.fn().mockResolvedValue({ metrics: [] }),
      screenshot: vi.fn().mockResolvedValue({ path: "/tmp/base.png" }),
      consolePoll: vi.fn().mockResolvedValue({ events: [], nextSeq: 0 }),
      networkPoll: vi.fn().mockResolvedValue({ events: [], nextSeq: 0 }),
      listTargets: vi.fn().mockResolvedValue({ activeTargetId: null, targets: [] }),
      useTarget: vi.fn().mockResolvedValue({ activeTargetId: "tab-1", url: "https://example.com", title: "Example" }),
      newTarget: vi.fn().mockResolvedValue({ targetId: "tab-2" }),
      closeTarget: vi.fn().mockResolvedValue(undefined),
      cookieImport: vi.fn().mockResolvedValue({ requestId: "req-base", imported: 1, rejected: [] }),
      cookieList: vi.fn().mockResolvedValue({ requestId: "req-base-list", cookies: [], count: 0 }),
      page: vi.fn().mockResolvedValue({ targetId: "tab-3", created: true, url: "https://example.com", title: "Example" }),
      listPages: vi.fn().mockResolvedValue({ pages: [] }),
      closePage: vi.fn().mockResolvedValue(undefined)
    };
    const manager = new OpsBrowserManager(base as never, makeConfig());

    await manager.launch({} as never);
    await manager.connect({} as never);
    await manager.connectRelay("ws://127.0.0.1:8787/cdp");
    await manager.disconnect("base-session", false);
    await manager.status("base-session");
    await manager.withPage("base-session", null, async () => "ok");
    await manager.applyRuntimePreviewBridge("base-session", null, {
      bindingId: "binding-base",
      rootSelector: "#root",
      html: "<div />"
    });
    await manager.goto("base-session", "https://example.com", "load", 1000);
    await manager.waitForLoad("base-session", "load", 1000);
    await manager.waitForRef("base-session", "ref-1", "attached", 1000);
    await manager.snapshot("base-session", "outline", 1000, "cursor-1");
    await manager.click("base-session", "ref-1");
    await manager.hover("base-session", "ref-1");
    await manager.press("base-session", "Enter", "ref-1");
    await manager.check("base-session", "ref-1");
    await manager.uncheck("base-session", "ref-1");
    await manager.type("base-session", "ref-1", "text", true, true);
    await manager.select("base-session", "ref-1", ["a"]);
    await manager.scroll("base-session", 10, "ref-1");
    await manager.scrollIntoView("base-session", "ref-1");
    await manager.domGetHtml("base-session", "ref-1", 1000);
    await manager.domGetText("base-session", "ref-1", 1000);
    await manager.domGetAttr("base-session", "ref-1", "id");
    await manager.domGetValue("base-session", "ref-1");
    await manager.domIsVisible("base-session", "ref-1");
    await manager.domIsEnabled("base-session", "ref-1");
    await manager.domIsChecked("base-session", "ref-1");
    await manager.clonePageHtmlWithOptions("base-session", null, { maxNodes: 2500 });
    await manager.clonePageWithOptions("base-session", null, { maxNodes: 2500 });
    await manager.clonePage("base-session");
    await manager.cloneComponent("base-session", "ref-1");
    await manager.perfMetrics("base-session");
    await manager.screenshot("base-session", { path: "/tmp/base.png" });
    await manager.consolePoll("base-session", 0, 10);
    await manager.networkPoll("base-session", 0, 10);
    await manager.listTargets("base-session", true);
    await manager.useTarget("base-session", "tab-1");
    await manager.newTarget("base-session", "https://example.com");
    await manager.closeTarget("base-session", "tab-1");
    await manager.cookieImport("base-session", [{ name: "session", value: "abc", url: "https://example.com" }], true, "req-base");
    await manager.cookieList("base-session", ["https://example.com"], "req-base-list");
    await manager.page("base-session", "main", "https://example.com");
    await manager.listPages("base-session");
    await manager.closePage("base-session", "main");

    expect(base.connectRelay).toHaveBeenCalledWith("ws://127.0.0.1:8787/cdp");
    expect(base.goto).toHaveBeenCalled();
    expect(base.cookieList).toHaveBeenCalledWith("base-session", ["https://example.com"], "req-base-list");
    expect(base.clonePageHtmlWithOptions).toHaveBeenCalledWith("base-session", null, { maxNodes: 2500 });
    expect(base.clonePageWithOptions).toHaveBeenCalledWith("base-session", null, { maxNodes: 2500 });
  });

  it("delegates pointer primitives to the base manager for non-ops sessions", async () => {
    const base = {
      pointerMove: vi.fn().mockResolvedValue({ timingMs: 1 }),
      pointerDown: vi.fn().mockResolvedValue({ timingMs: 2 }),
      pointerUp: vi.fn().mockResolvedValue({ timingMs: 3 }),
      drag: vi.fn().mockResolvedValue({ timingMs: 4 })
    };
    const manager = new OpsBrowserManager(base as never, makeConfig());

    await expect(manager.pointerMove("base-session", 10, 20)).resolves.toEqual({ timingMs: 1 });
    await expect(manager.pointerDown("base-session", 10, 20)).resolves.toEqual({ timingMs: 2 });
    await expect(manager.pointerUp("base-session", 10, 20)).resolves.toEqual({ timingMs: 3 });
    await expect(manager.drag("base-session", { x: 1, y: 2 }, { x: 3, y: 4 })).resolves.toEqual({ timingMs: 4 });

    expect(base.pointerMove).toHaveBeenCalledWith("base-session", 10, 20, undefined, undefined);
    expect(base.pointerDown).toHaveBeenCalledWith("base-session", 10, 20, undefined, "left", 1);
    expect(base.pointerUp).toHaveBeenCalledWith("base-session", 10, 20, undefined, "left", 1);
    expect(base.drag).toHaveBeenCalledWith("base-session", { x: 1, y: 2 }, { x: 3, y: 4 }, undefined, undefined);
  });

  it("delegates upload and dialog to the base manager for non-ops sessions", async () => {
    const base = {
      upload: vi.fn().mockResolvedValue({ fileCount: 1, mode: "direct_input" }),
      dialog: vi.fn().mockResolvedValue({ dialog: { open: false }, handled: true })
    };
    const manager = new OpsBrowserManager(base as never, makeConfig());

    await expect(manager.upload("base-session", {
      ref: "ref-1",
      files: ["/tmp/a.txt"]
    })).resolves.toEqual({ fileCount: 1, mode: "direct_input" });
    await expect(manager.dialog("base-session", {
      targetId: "tab-1",
      action: "dismiss"
    })).resolves.toEqual({ dialog: { open: false }, handled: true });

    expect(base.upload).toHaveBeenCalledWith("base-session", {
      ref: "ref-1",
      files: ["/tmp/a.txt"]
    });
    expect(base.dialog).toHaveBeenCalledWith("base-session", {
      targetId: "tab-1",
      action: "dismiss"
    });
  });

  it("delegates ref-point resolution to the base manager for non-ops sessions", async () => {
    const base = {
      resolveRefPoint: vi.fn().mockResolvedValue({ x: 12, y: 34 })
    };
    const manager = new OpsBrowserManager(base as never, makeConfig());

    await expect(manager.resolveRefPoint("base-session", "ref-1")).resolves.toEqual({ x: 12, y: 34 });
    expect(base.resolveRefPoint).toHaveBeenCalledWith("base-session", "ref-1", undefined);
  });

  it("fails ref-point resolution when the base manager does not expose the helper", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());

    await expect(manager.resolveRefPoint("base-session", "ref-1")).rejects.toThrow(
      "Base browser manager does not support ref-point resolution."
    );
  });

  it("routes ref-point resolution through ops requests for ops sessions", async () => {
    requestMock.mockImplementation(async (...args: unknown[]) => {
      const command = args[0] as string;
      if (command === "session.connect") {
        return { opsSessionId: "ops-ref-point", activeTargetId: "tab-1", leaseId: "lease-ref-point" };
      }
      if (command === "dom.refPoint") {
        return { x: 45, y: 67 };
      }
      return { ok: true };
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        relayPort: 8787,
        pairingRequired: false,
        instanceId: "relay-1",
        epoch: 1,
        extensionConnected: true,
        extensionHandshakeComplete: true
      })
    }));

    const manager = new OpsBrowserManager({ connectRelay: vi.fn() } as never, makeConfig());
    await manager.connectRelay("ws://127.0.0.1:8787/ops");

    await expect(manager.resolveRefPoint("ops-ref-point", "r8", "tab-1")).resolves.toEqual({ x: 45, y: 67 });
    expect(requestMock).toHaveBeenNthCalledWith(
      2,
      "dom.refPoint",
      {
        targetId: "tab-1",
        ref: "r8"
      },
      "ops-ref-point",
      30000,
      "lease-ref-point"
    );
  });

  it("passes startUrl when delegating cdp relay connections to the base manager", async () => {
    const base = {
      connectRelay: vi.fn().mockResolvedValue({
        sessionId: "base-session",
        mode: "extension",
        activeTargetId: "tab-1",
        warnings: []
      })
    };
    const manager = new OpsBrowserManager(base as never, makeConfig());

    await manager.connectRelay("ws://127.0.0.1:8787/cdp", { startUrl: "https://example.com/start" });

    expect(base.connectRelay).toHaveBeenCalledWith(
      "ws://127.0.0.1:8787/cdp",
      { startUrl: "https://example.com/start" }
    );
  });

  it("returns non-adopted canvas targets for non-ops sessions", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());

    await expect(manager.registerCanvasTarget("base-session", "tab-canvas")).resolves.toEqual({
      targetId: "tab-canvas",
      adopted: false
    });
  });

  it("falls back to withPage runtime preview bridging when the base manager lacks a direct helper", async () => {
    const page = { evaluate: vi.fn() };
    const base = {
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, fn: (value: typeof page) => Promise<unknown>) => {
        return await fn(page);
      })
    };
    const manager = new OpsBrowserManager(base as never, makeConfig());

    const result = await manager.applyRuntimePreviewBridge("base-session", "tab-1", {
      bindingId: "binding-fallback",
      rootSelector: "#root",
      html: "<article data-node-id=\"node-root\"></article>"
    });

    expect(base.withPage).toHaveBeenCalledWith("base-session", "tab-1", expect.any(Function));
    expect(runtimePreviewBridgeMock).toHaveBeenCalledWith(page, {
      bindingId: "binding-fallback",
      rootSelector: "#root",
      html: "<article data-node-id=\"node-root\"></article>"
    });
    expect(result).toEqual({
      ok: true,
      artifact: {
        projection: "bound_app_runtime",
        rootBindingId: "binding-fallback",
        capturedAt: "2026-03-12T10:00:00.000Z",
        hierarchyHash: "node-root:",
        nodes: []
      }
    });
  });

  it("routes ops sessions through ops client and tracks sessions", async () => {
    requestMock.mockImplementation(async (...args: unknown[]) => {
      const command = args[0] as string;
      if (command === "session.connect") {
        return { opsSessionId: "ops-1", activeTargetId: "tab-1", url: "https://example.com", title: "Example", leaseId: "lease-1" };
      }
      if (command === "session.status") {
        return { mode: "extension", activeTargetId: "tab-1" };
      }
      if (command === "session.disconnect") {
        return { ok: true };
      }
      return { ok: true };
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        relayPort: 8787,
        pairingRequired: false,
        instanceId: "relay-1",
        epoch: 1,
        extensionConnected: true,
        extensionHandshakeComplete: true
      })
    }));

    const base = {
      connectRelay: vi.fn()
    };
    const manager = new OpsBrowserManager(base as never, makeConfig());

    const result = await manager.connectRelay("ws://127.0.0.1:8787/ops");
    expect(result.sessionId).toBe("ops-1");
    expect(result.mode).toBe("extension");
    expect(requestMock).toHaveBeenCalledWith(
      "session.connect",
      expect.objectContaining({
        parallelismPolicy: expect.objectContaining({
          floor: 1,
          backpressureTimeoutMs: 5000,
          sampleIntervalMs: 2000,
          modeCaps: expect.objectContaining({
            extensionOpsHeaded: 6,
            extensionLegacyCdpHeaded: 1
          })
        })
      }),
      undefined,
      30000,
      expect.any(String)
    );

    const status = await manager.status("ops-1");
    expect(status.mode).toBe("extension");
    expect(requestMock).toHaveBeenCalledWith("session.status", {}, "ops-1", 30000, "lease-1");

    await manager.disconnect("ops-1");
    expect(requestMock).toHaveBeenCalledWith("session.disconnect", { closeBrowser: false }, "ops-1", 30000, "lease-1");
  });

  it("reconnects a lost extension ops session and retries the original request once", async () => {
    let recovered = false;
    requestMock.mockImplementation(async (...args: unknown[]) => {
      const command = args[0] as string;
      if (command === "session.connect") {
        const payload = args[1] as Record<string, unknown>;
        if (payload.sessionId === "ops-1") {
          recovered = true;
          expect(payload).toEqual(
            expect.objectContaining({
              sessionId: "ops-1",
              tabId: 101,
              parallelismPolicy: expect.any(Object)
            })
          );
        }
        return { opsSessionId: "ops-1", activeTargetId: "tab-101", leaseId: "lease-1" };
      }
      if (command === "nav.goto") {
        if (!recovered) {
          throw new Error("[invalid_session] Unknown ops session");
        }
        return { finalUrl: "https://example.com/", timingMs: 12 };
      }
      return { ok: true };
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        relayPort: 8787,
        pairingRequired: false,
        instanceId: "relay-1",
        epoch: 1,
        extensionConnected: true,
        extensionHandshakeComplete: true
      })
    }));

    const manager = new OpsBrowserManager({ connectRelay: vi.fn() } as never, makeConfig());
    await manager.connectRelay("ws://127.0.0.1:8787/ops");

    const result = await manager.goto("ops-1", "https://example.com/", "load", 30000);

    expect(result).toEqual({ finalUrl: "https://example.com/", timingMs: 12 });
    expect(recovered).toBe(true);
    expect(requestMock).toHaveBeenCalledWith(
      "nav.goto",
      expect.objectContaining({
        url: "https://example.com/",
        waitUntil: "load",
        timeoutMs: 30000
      }),
      "ops-1",
      30000,
      "lease-1"
    );
  });

  it("keeps the public session stable when recovery returns a new protocol session id", async () => {
    let recovered = false;
    requestMock.mockImplementation(async (...args: unknown[]) => {
      const command = args[0] as string;
      const payload = (args[1] as Record<string, unknown> | undefined) ?? {};
      const opsSessionId = args[2] as string | undefined;
      if (command === "session.connect") {
        if (payload.sessionId === "ops-1") {
          recovered = true;
          return { opsSessionId: "ops-2", activeTargetId: "tab-202", leaseId: "lease-2" };
        }
        return { opsSessionId: "ops-1", activeTargetId: "tab-101", leaseId: "lease-1" };
      }
      if (command === "nav.goto") {
        if (!recovered) {
          expect(opsSessionId).toBe("ops-1");
          throw new Error("[invalid_session] Unknown ops session");
        }
        expect(opsSessionId).toBe("ops-2");
        return { finalUrl: "https://example.com/recovered", timingMs: 18 };
      }
      if (command === "session.status") {
        expect(opsSessionId).toBe("ops-2");
        return { mode: "extension", activeTargetId: "tab-202" };
      }
      if (command === "session.disconnect") {
        expect(opsSessionId).toBe("ops-2");
        return { ok: true };
      }
      return { ok: true };
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        relayPort: 8787,
        pairingRequired: false,
        instanceId: "relay-1",
        epoch: 1,
        extensionConnected: true,
        extensionHandshakeComplete: true
      })
    }));

    const manager = new OpsBrowserManager({ connectRelay: vi.fn() } as never, makeConfig());
    await manager.connectRelay("ws://127.0.0.1:8787/ops");

    const gotoResult = await manager.goto("ops-1", "https://example.com/recovered", "load", 30000);
    expect(gotoResult).toEqual({ finalUrl: "https://example.com/recovered", timingMs: 18 });

    const status = await manager.status("ops-1");
    expect(status).toEqual({ mode: "extension", activeTargetId: "tab-202" });

    await manager.disconnect("ops-1");
    expect(recovered).toBe(true);
  });

  it("does not remember non-tab status targets or blank urls", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const managerAny = manager as unknown as {
      opsClient: { request: ReturnType<typeof vi.fn> } | null;
      opsSessions: Set<string>;
      opsLeases: Map<string, string>;
      opsSessionTabs: Map<string, number>;
      opsSessionUrls: Map<string, string>;
    };

    managerAny.opsClient = {
      request: vi.fn().mockResolvedValue({
        mode: "extension",
        activeTargetId: "canvas-preview",
        url: "   "
      })
    };
    managerAny.opsSessions.add("ops-null-status");
    managerAny.opsLeases.set("ops-null-status", "lease-null-status");

    const status = await manager.status("ops-null-status");

    expect(status).toEqual({
      mode: "extension",
      activeTargetId: "canvas-preview",
      url: "   "
    });
    expect(managerAny.opsSessionTabs.has("ops-null-status")).toBe(false);
    expect(managerAny.opsSessionUrls.has("ops-null-status")).toBe(false);
  });

  it("falls back to url-based recovery when the remembered tabId is gone", async () => {
    let recoveryAttempt = 0;
    requestMock.mockImplementation(async (...args: unknown[]) => {
      const command = args[0] as string;
      const payload = (args[1] as Record<string, unknown> | undefined) ?? {};
      const opsSessionId = args[2] as string | undefined;
      if (command === "session.connect") {
        if (payload.sessionId === "ops-1") {
          recoveryAttempt += 1;
          if (recoveryAttempt === 1) {
            expect(payload.tabId).toBe(101);
            throw new Error("[invalid_request] Unknown tabId: 101");
          }
          expect(payload).toEqual(
            expect.objectContaining({
              sessionId: "ops-1",
              startUrl: "https://example.com/recovered"
            })
          );
          return { opsSessionId: "ops-2", activeTargetId: "tab-202", leaseId: "lease-2", url: "https://example.com/recovered" };
        }
        return { opsSessionId: "ops-1", activeTargetId: "tab-101", leaseId: "lease-1", url: "https://example.com/original" };
      }
      if (command === "nav.goto") {
        if (recoveryAttempt === 0) {
          expect(opsSessionId).toBe("ops-1");
          throw new Error("[invalid_session] Unknown ops session");
        }
        expect(opsSessionId).toBe("ops-2");
        return { finalUrl: "https://example.com/recovered", timingMs: 21 };
      }
      if (command === "devtools.consolePoll") {
        expect(opsSessionId).toBe("ops-2");
        return { events: [] };
      }
      return { ok: true };
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        relayPort: 8787,
        pairingRequired: false,
        instanceId: "relay-1",
        epoch: 1,
        extensionConnected: true,
        extensionHandshakeComplete: true
      })
    }));

    const manager = new OpsBrowserManager({ connectRelay: vi.fn() } as never, makeConfig());
    await manager.connectRelay("ws://127.0.0.1:8787/ops");

    const gotoResult = await manager.goto("ops-1", "https://example.com/recovered", "load", 30000);
    expect(gotoResult).toEqual({ finalUrl: "https://example.com/recovered", timingMs: 21 });

    const consoleResult = await manager.consolePoll("ops-1");
    expect(consoleResult).toEqual({ events: [] });
    expect(recoveryAttempt).toBe(2);
  });

  it("disconnects the shared ops client when the last ops session closes and recreates it on reconnect", async () => {
    let connectIndex = 0;
    requestMock.mockImplementation(async (...args: unknown[]) => {
      const command = args[0] as string;
      if (command === "session.connect") {
        connectIndex += 1;
        return {
          opsSessionId: `ops-${connectIndex}`,
          activeTargetId: `tab-${connectIndex}`,
          leaseId: `lease-${connectIndex}`
        };
      }
      if (command === "session.disconnect") {
        return { ok: true };
      }
      return { ok: true };
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ relayPort: 8787, pairingRequired: false, instanceId: "relay-1", epoch: 1 })
    }));

    const manager = new OpsBrowserManager({ connectRelay: vi.fn() } as never, makeConfig());
    await manager.connectRelay("ws://127.0.0.1:8787/ops");
    const firstClient = (manager as { opsClient: unknown | null }).opsClient;

    await manager.disconnect("ops-1");

    expect(disconnectMock).toHaveBeenCalledTimes(1);
    expect((manager as { opsClient: unknown | null }).opsClient).toBeNull();
    expect((manager as { opsEndpoint: string | null }).opsEndpoint).toBeNull();

    await manager.connectRelay("ws://127.0.0.1:8787/ops");

    expect(connectMock).toHaveBeenCalledTimes(2);
    expect((manager as { opsClient: unknown | null }).opsClient).not.toBe(firstClient);
  });

  it("defaults connectRelay activeTargetId to null when ops payload omits it", async () => {
    requestMock.mockImplementation(async (...args: unknown[]) => {
      const command = args[0] as string;
      if (command === "session.connect") {
        return { opsSessionId: "ops-null-target", leaseId: "lease-null-target" };
      }
      return { ok: true };
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ relayPort: 8787, pairingRequired: false, instanceId: "relay-1", epoch: 1 })
    }));

    const manager = new OpsBrowserManager({ connectRelay: vi.fn() } as never, makeConfig());
    const result = await manager.connectRelay("ws://127.0.0.1:8787/ops");
    expect(result.activeTargetId).toBeNull();
  });

  it("forwards startUrl through ops relay connect requests", async () => {
    requestMock.mockImplementation(async (...args: unknown[]) => {
      const command = args[0] as string;
      if (command === "session.connect") {
        return { opsSessionId: "ops-start-url", activeTargetId: "tab-start-url", leaseId: "lease-start-url" };
      }
      return { ok: true };
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ relayPort: 8787, pairingRequired: false, instanceId: "relay-1", epoch: 1 })
    }));

    const manager = new OpsBrowserManager({ connectRelay: vi.fn() } as never, makeConfig());
    await manager.connectRelay("ws://127.0.0.1:8787/ops", { startUrl: "http://127.0.0.1:41731/" });
    expect(requestMock).toHaveBeenCalledWith(
      "session.connect",
      expect.objectContaining({
        startUrl: "http://127.0.0.1:41731/"
      }),
      undefined,
      30000,
      expect.any(String)
    );
  });

  it("routes pointer primitives through ops sessions", async () => {
    requestMock.mockImplementation(async (...args: unknown[]) => {
      const command = args[0] as string;
      if (command === "session.connect") {
        return { opsSessionId: "ops-pointer", activeTargetId: "tab-pointer", leaseId: "lease-pointer" };
      }
      return { timingMs: 5 };
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ relayPort: 8787, pairingRequired: false, instanceId: "relay-1", epoch: 1 })
    }));

    const manager = new OpsBrowserManager({ reconnectExternalBlockerMeta: vi.fn() } as never, makeConfig());
    await manager.connectRelay("ws://127.0.0.1:8787/ops");

    await manager.pointerMove("ops-pointer", 10, 20, null, 4);
    await manager.pointerDown("ops-pointer", 10, 20);
    await manager.pointerUp("ops-pointer", 10, 20);
    await manager.drag("ops-pointer", { x: 1, y: 2 }, { x: 3, y: 4 }, null, 6);

    expect(requestMock).toHaveBeenCalledWith("pointer.move", { x: 10, y: 20, steps: 4 }, "ops-pointer", 30000, "lease-pointer");
    expect(requestMock).toHaveBeenCalledWith(
      "pointer.down",
      { x: 10, y: 20, button: "left", clickCount: 1 },
      "ops-pointer",
      30000,
      "lease-pointer"
    );
    expect(requestMock).toHaveBeenCalledWith(
      "pointer.up",
      { x: 10, y: 20, button: "left", clickCount: 1 },
      "ops-pointer",
      30000,
      "lease-pointer"
    );
    expect(requestMock).toHaveBeenCalledWith(
      "pointer.drag",
      { from: { x: 1, y: 2 }, to: { x: 3, y: 4 }, steps: 6 },
      "ops-pointer",
      30000,
      "lease-pointer"
    );
  });

  it("tracks ops session close events", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const opsSessions = (manager as { opsSessions: Set<string> }).opsSessions;
    const opsLeases = (manager as { opsLeases: Map<string, string> }).opsLeases;
    const closedOpsSessions = (manager as { closedOpsSessions: Map<string, number> }).closedOpsSessions;

    opsSessions.add("ops-1");
    opsLeases.set("ops-1", "lease-1");

    (manager as unknown as { handleOpsEvent: (event: { event?: string; opsSessionId?: string }) => void })
      .handleOpsEvent({ opsSessionId: "ops-1", event: "ops_session_closed" });

    expect(opsSessions.has("ops-1")).toBe(false);
    expect(opsLeases.has("ops-1")).toBe(false);
    expect(closedOpsSessions.has("ops-1")).toBe(true);
  });

  it("disconnects the shared ops client when the final ops session closes via event", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const opsSessions = (manager as { opsSessions: Set<string> }).opsSessions;
    const opsLeases = (manager as { opsLeases: Map<string, string> }).opsLeases;

    opsSessions.add("ops-1");
    opsLeases.set("ops-1", "lease-1");
    (manager as { opsClient: { disconnect: () => void } | null }).opsClient = {
      disconnect: disconnectMock
    };
    (manager as { opsEndpoint: string | null }).opsEndpoint = "ws://127.0.0.1:8787/ops";

    (manager as unknown as { handleOpsEvent: (event: { event?: string; opsSessionId?: string }) => void })
      .handleOpsEvent({ opsSessionId: "ops-1", event: "ops_session_closed" });

    expect(disconnectMock).toHaveBeenCalledTimes(1);
    expect((manager as { opsClient: unknown | null }).opsClient).toBeNull();
    expect((manager as { opsEndpoint: string | null }).opsEndpoint).toBeNull();
  });

  it("keeps the shared ops client attached while another ops session remains active", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const opsSessions = (manager as { opsSessions: Set<string> }).opsSessions;
    const opsLeases = (manager as { opsLeases: Map<string, string> }).opsLeases;
    const client = { disconnect: disconnectMock };

    opsSessions.add("ops-1");
    opsSessions.add("ops-2");
    opsLeases.set("ops-1", "lease-1");
    opsLeases.set("ops-2", "lease-2");
    (manager as { opsClient: { disconnect: () => void } | null }).opsClient = client;
    (manager as { opsEndpoint: string | null }).opsEndpoint = "ws://127.0.0.1:8787/ops";

    (manager as unknown as { handleOpsEvent: (event: { event?: string; opsSessionId?: string }) => void })
      .handleOpsEvent({ opsSessionId: "ops-1", event: "ops_session_closed" });

    expect(disconnectMock).not.toHaveBeenCalled();
    expect((manager as { opsClient: unknown | null }).opsClient).toBe(client);
    expect((manager as { opsEndpoint: string | null }).opsEndpoint).toBe("ws://127.0.0.1:8787/ops");
    expect(opsSessions.has("ops-2")).toBe(true);
  });

  it("tracks ops session expired events", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const opsSessions = (manager as { opsSessions: Set<string> }).opsSessions;
    const opsLeases = (manager as { opsLeases: Map<string, string> }).opsLeases;
    const closedOpsSessions = (manager as { closedOpsSessions: Map<string, number> }).closedOpsSessions;

    opsSessions.add("ops-expired");
    opsLeases.set("ops-expired", "lease-expired");

    (manager as unknown as { handleOpsEvent: (event: { event?: string; opsSessionId?: string }) => void })
      .handleOpsEvent({ opsSessionId: "ops-expired", event: "ops_session_expired" });

    expect(opsSessions.has("ops-expired")).toBe(false);
    expect(opsLeases.has("ops-expired")).toBe(false);
    expect(closedOpsSessions.has("ops-expired")).toBe(true);
  });

  it("logs ops session-close screencast failures with tracked ids", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const managerAny = manager as unknown as {
      logger: { warn: (event: string, payload: unknown) => void };
      finalizeSessionScreencasts: (sessionId: string) => Promise<void>;
      screencastIdsBySession: Map<string, Set<string>>;
      handleOpsEvent: (event: { event?: string; opsSessionId?: string }) => void;
      opsSessions: Set<string>;
      opsLeases: Map<string, string>;
    };
    const warnSpy = vi.spyOn(managerAny.logger, "warn");
    vi.spyOn(managerAny, "finalizeSessionScreencasts").mockRejectedValue(new Error("ops-finalize-failed"));
    managerAny.opsSessions.add("ops-failing");
    managerAny.opsLeases.set("ops-failing", "lease-failing");
    managerAny.screencastIdsBySession.set("ops-failing", new Set(["cast-a", "cast-b"]));

    managerAny.handleOpsEvent({ opsSessionId: "ops-failing", event: "ops_session_closed" });

    await vi.waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith("screencast.ops_session_close.failed", expect.objectContaining({
        sessionId: "ops-failing",
        data: expect.objectContaining({
          screencastIds: ["cast-a", "cast-b"],
          error: "ops-finalize-failed"
        })
      }));
    });
  });

  it("logs ops session-close screencast failures without tracked ids for non-Error values", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const managerAny = manager as unknown as {
      logger: { warn: (event: string, payload: unknown) => void };
      finalizeSessionScreencasts: (sessionId: string) => Promise<void>;
      handleOpsEvent: (event: { event?: string; opsSessionId?: string }) => void;
      opsSessions: Set<string>;
      opsLeases: Map<string, string>;
    };
    const warnSpy = vi.spyOn(managerAny.logger, "warn");
    vi.spyOn(managerAny, "finalizeSessionScreencasts").mockRejectedValue("plain-ops-failure");
    managerAny.opsSessions.add("ops-plain-failing");
    managerAny.opsLeases.set("ops-plain-failing", "lease-plain-failing");

    managerAny.handleOpsEvent({ opsSessionId: "ops-plain-failing", event: "ops_session_closed" });

    await vi.waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith("screencast.ops_session_close.failed", expect.objectContaining({
        sessionId: "ops-plain-failing",
        data: expect.objectContaining({
          screencastIds: [],
          error: "plain-ops-failure"
        })
      }));
    });
  });

  it("ignores ops events without session ids", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const opsSessions = (manager as { opsSessions: Set<string> }).opsSessions;
    const closedOpsSessions = (manager as { closedOpsSessions: Map<string, number> }).closedOpsSessions;

    opsSessions.add("ops-1");

    (manager as unknown as { handleOpsEvent: (event: { event?: string; opsSessionId?: string }) => void })
      .handleOpsEvent({ event: "ops_session_closed" });

    expect(opsSessions.has("ops-1")).toBe(true);
    expect(closedOpsSessions.size).toBe(0);
  });

  it("ignores non-close ops events", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const opsSessions = (manager as { opsSessions: Set<string> }).opsSessions;
    const closedOpsSessions = (manager as { closedOpsSessions: Map<string, number> }).closedOpsSessions;

    opsSessions.add("ops-2");

    (manager as unknown as { handleOpsEvent: (event: { event?: string; opsSessionId?: string }) => void })
      .handleOpsEvent({ opsSessionId: "ops-2", event: "ops_session_opened" });

    expect(opsSessions.has("ops-2")).toBe(true);
    expect(closedOpsSessions.size).toBe(0);
  });

  it("handles closed sessions on disconnect and status checks", async () => {
    const base = {
      disconnect: vi.fn().mockResolvedValue(undefined),
      status: vi.fn().mockResolvedValue({ mode: "managed", activeTargetId: null })
    };
    const manager = new OpsBrowserManager(base as never, makeConfig());
    const closedOpsSessions = (manager as { closedOpsSessions: Map<string, number> }).closedOpsSessions;

    closedOpsSessions.set("ops-closed", Date.now());
    await manager.disconnect("ops-closed", false);
    await expect(manager.status("ops-closed")).rejects.toThrow("Session already closed");
    expect(base.disconnect).not.toHaveBeenCalled();
  });

  it("manages ops screencast lifecycle and duplicate target guards", async () => {
    stubOpsScreencastSession("ops-cast");

    const manager = new OpsBrowserManager({ connectRelay: vi.fn() } as never, makeConfig());
    const connected = await manager.connectRelay("ws://127.0.0.1:8787/ops");
    const outputDir = await mkdtemp(join(tmpdir(), "odb-ops-screencast-"));

    const screencast = await manager.startScreencast(connected.sessionId, {
      outputDir,
      intervalMs: 250,
      maxFrames: 5
    });

    await expect(manager.startScreencast(connected.sessionId)).rejects.toThrow(
      `Screencast already active for target ${screencast.targetId}.`
    );
    await expect(manager.stopScreencast(screencast.screencastId)).resolves.toMatchObject({
      screencastId: screencast.screencastId,
      sessionId: connected.sessionId,
      targetId: screencast.targetId,
      endedReason: "stopped",
      outputDir
    });
    await expect(manager.stopScreencast(screencast.screencastId)).rejects.toThrow(
      `[invalid_screencast] Unknown screencastId: ${screencast.screencastId}`
    );
  });

  it("delegates screencast start to the base manager for non-ops sessions", async () => {
    const expected = {
      screencastId: "base-cast",
      sessionId: "base-session",
      targetId: "base-target",
      outputDir: "/tmp/base-cast",
      startedAt: "2026-04-10T00:00:00.000Z",
      intervalMs: 250,
      maxFrames: 1
    };
    const base = {
      startScreencast: vi.fn().mockResolvedValue(expected)
    };
    const manager = new OpsBrowserManager(base as never, makeConfig());

    await expect(manager.startScreencast("base-session", { intervalMs: 250, maxFrames: 1 })).resolves.toEqual(expected);
    expect(base.startScreencast).toHaveBeenCalledWith("base-session", { intervalMs: 250, maxFrames: 1 });
  });

  it("delegates screencast stop to the base manager when no ops recorder is tracked", async () => {
    const expected = {
      screencastId: "base-cast",
      sessionId: "base-session",
      targetId: "base-target",
      outputDir: "/tmp/base-cast",
      startedAt: "2026-04-10T00:00:00.000Z",
      endedAt: "2026-04-10T00:00:01.000Z",
      endedReason: "max_frames_reached",
      frameCount: 1,
      manifestPath: "/tmp/base-cast/replay.json",
      replayHtmlPath: "/tmp/base-cast/replay.html"
    } as const;
    const base = {
      stopScreencast: vi.fn().mockResolvedValue(expected)
    };
    const manager = new OpsBrowserManager(base as never, makeConfig());

    await expect(manager.stopScreencast("base-cast")).resolves.toEqual(expected);
    expect(base.stopScreencast).toHaveBeenCalledWith("base-cast");
  });

  it("rejects ops screencast starts when there is no active target", async () => {
    requestMock.mockImplementation(async (...args: unknown[]) => {
      const command = args[0] as string;
      if (command === "session.connect") {
        return { opsSessionId: "ops-no-target", activeTargetId: null, leaseId: "lease-no-target", url: "https://example.com/no-target" };
      }
      if (command === "session.status") {
        return { mode: "extension", activeTargetId: null };
      }
      return { ok: true };
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ relayPort: 8787, pairingRequired: false, instanceId: "relay-1", epoch: 1 })
    }));

    const manager = new OpsBrowserManager({ connectRelay: vi.fn() } as never, makeConfig());
    const connected = await manager.connectRelay("ws://127.0.0.1:8787/ops");

    await expect(manager.startScreencast(connected.sessionId)).rejects.toThrow("No active target");
  });

  it("stores immediately completed ops screencasts with warning-only metadata", async () => {
    const targetId = "tab-warning";
    requestMock.mockImplementation(async (...args: unknown[]) => {
      const command = args[0] as string;
      switch (command) {
        case "session.connect":
          return {
            opsSessionId: "ops-immediate",
            activeTargetId: targetId,
            leaseId: "lease-immediate",
            url: "https://example.com/immediate"
          };
        case "session.status":
          return { mode: "extension", activeTargetId: targetId };
        case "page.screenshot":
          return {
            base64: Buffer.from("image-ops-immediate").toString("base64"),
            warning: "ops-warning"
          };
        case "targets.list":
          return {
            activeTargetId: targetId,
            targets: [{ targetId, type: "page" }]
          };
        default:
          return { ok: true };
      }
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ relayPort: 8787, pairingRequired: false, instanceId: "relay-1", epoch: 1 })
    }));

    const manager = new OpsBrowserManager({ connectRelay: vi.fn() } as never, makeConfig());
    const connected = await manager.connectRelay("ws://127.0.0.1:8787/ops");
    const outputDir = await mkdtemp(join(tmpdir(), "odb-ops-screencast-immediate-"));
    const managerPrivate = manager as unknown as {
      activeScreencasts: Map<string, unknown>;
      completedScreencasts: Map<string, unknown>;
      screencastIdsBySession: Map<string, Set<string>>;
      screencastIdsByTarget: Map<string, string>;
      clearTrackedScreencast: (screencastId: string) => void;
    };
    const originalClearTrackedScreencast = managerPrivate.clearTrackedScreencast.bind(manager);
    let sawCompletedBeforeActiveClear = false;
    managerPrivate.clearTrackedScreencast = (screencastId: string) => {
      if (managerPrivate.activeScreencasts.has(screencastId)) {
        sawCompletedBeforeActiveClear = true;
        expect(managerPrivate.completedScreencasts.has(screencastId)).toBe(true);
      }
      originalClearTrackedScreencast(screencastId);
    };

    const screencast = await manager.startScreencast(connected.sessionId, {
      outputDir,
      intervalMs: 250,
      maxFrames: 1
    });

    expect(sawCompletedBeforeActiveClear).toBe(true);
    expect(managerPrivate.completedScreencasts.has(screencast.screencastId)).toBe(true);
    expect(managerPrivate.activeScreencasts.has(screencast.screencastId)).toBe(false);
    expect(managerPrivate.screencastIdsByTarget.has(`${connected.sessionId}:${screencast.targetId}`)).toBe(false);
    expect(managerPrivate.screencastIdsBySession.has(connected.sessionId)).toBe(false);
    await expect(manager.stopScreencast(screencast.screencastId)).resolves.toMatchObject({
      screencastId: screencast.screencastId,
      endedReason: "max_frames_reached",
      warnings: ["ops-warning"]
    });
  });

  it("replays target-closed ops screencasts after closeTarget", async () => {
    stubOpsScreencastSession("ops-close");

    const manager = new OpsBrowserManager({ connectRelay: vi.fn() } as never, makeConfig());
    const connected = await manager.connectRelay("ws://127.0.0.1:8787/ops");
    const outputDir = await mkdtemp(join(tmpdir(), "odb-ops-screencast-close-"));

    const screencast = await manager.startScreencast(connected.sessionId, {
      outputDir,
      intervalMs: 250,
      maxFrames: 5
    });
    const completedScreencasts = (manager as unknown as {
      completedScreencasts: Map<string, unknown>;
    }).completedScreencasts;

    await manager.closeTarget(connected.sessionId, screencast.targetId);

    await vi.waitFor(() => {
      expect(completedScreencasts.has(screencast.screencastId)).toBe(true);
    });

    await expect(manager.stopScreencast(screencast.screencastId)).resolves.toMatchObject({
      screencastId: screencast.screencastId,
      sessionId: connected.sessionId,
      targetId: screencast.targetId,
      endedReason: "target_closed",
      outputDir
    });
  });

  it("replays session-closed ops screencasts after ops_tab_closed", async () => {
    stubOpsScreencastSession("ops-tab-close");

    const manager = new OpsBrowserManager({ connectRelay: vi.fn() } as never, makeConfig());
    const connected = await manager.connectRelay("ws://127.0.0.1:8787/ops");
    const outputDir = await mkdtemp(join(tmpdir(), "odb-ops-screencast-tab-close-"));

    const screencast = await manager.startScreencast(connected.sessionId, {
      outputDir,
      intervalMs: 250,
      maxFrames: 5
    });
    const completedScreencasts = (manager as unknown as {
      completedScreencasts: Map<string, unknown>;
      opsSessions: Set<string>;
    });

    (manager as unknown as {
      handleOpsEvent: (event: { event?: string; opsSessionId?: string }) => void;
    }).handleOpsEvent({ opsSessionId: connected.sessionId, event: "ops_tab_closed" });

    await vi.waitFor(() => {
      expect(completedScreencasts.completedScreencasts.has(screencast.screencastId)).toBe(true);
      expect(completedScreencasts.opsSessions.has(connected.sessionId)).toBe(false);
    });

    await expect(manager.stopScreencast(screencast.screencastId)).resolves.toMatchObject({
      screencastId: screencast.screencastId,
      sessionId: connected.sessionId,
      targetId: screencast.targetId,
      endedReason: "session_closed",
      outputDir
    });
  });

  it("logs Error screencast result failures and clears tracked ops recorders", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const managerAny = manager as unknown as {
      logger: { warn: (event: string, payload: unknown) => void };
      trackScreencast: (recorder: {
        screencastId: string;
        sessionId: string;
        targetId: string;
        resultPromise: Promise<never>;
      }) => void;
      activeScreencasts: Map<string, unknown>;
      screencastIdsByTarget: Map<string, string>;
      screencastIdsBySession: Map<string, Set<string>>;
    };
    const warnSpy = vi.spyOn(managerAny.logger, "warn");

    managerAny.trackScreencast({
      screencastId: "ops-cast-error",
      sessionId: "ops-session-error",
      targetId: "ops-target-error",
      resultPromise: Promise.reject(new Error("ops-rejected-error"))
    });

    await vi.waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith("screencast.result.failed", expect.objectContaining({
        sessionId: "ops-session-error",
        data: expect.objectContaining({
          screencastId: "ops-cast-error",
          targetId: "ops-target-error",
          error: "ops-rejected-error"
        })
      }));
    });
    expect(managerAny.activeScreencasts.has("ops-cast-error")).toBe(false);
    expect(managerAny.screencastIdsByTarget.has("ops-session-error:ops-target-error")).toBe(false);
    expect(managerAny.screencastIdsBySession.has("ops-session-error")).toBe(false);
  });

  it("clears tracked ops screencasts when the session index is missing or emptied", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const managerAny = manager as unknown as {
      activeScreencasts: Map<string, { sessionId: string; targetId: string }>;
      screencastIdsByTarget: Map<string, string>;
      screencastIdsBySession: Map<string, Set<string>>;
      clearTrackedScreencast: (screencastId: string) => void;
    };

    managerAny.activeScreencasts.set("ops-cast-orphan", {
      sessionId: "ops-session-orphan",
      targetId: "ops-target-orphan"
    });
    managerAny.screencastIdsByTarget.set("ops-session-orphan:ops-target-orphan", "ops-cast-orphan");
    managerAny.clearTrackedScreencast("ops-cast-orphan");
    expect(managerAny.screencastIdsByTarget.has("ops-session-orphan:ops-target-orphan")).toBe(false);

    const sessionIds = new Set(["ops-cast-last"]);
    managerAny.activeScreencasts.set("ops-cast-last", {
      sessionId: "ops-session-last",
      targetId: "ops-target-last"
    });
    managerAny.screencastIdsByTarget.set("ops-session-last:ops-target-last", "ops-cast-last");
    managerAny.screencastIdsBySession.set("ops-session-last", sessionIds);
    managerAny.clearTrackedScreencast("ops-cast-last");

    expect(managerAny.screencastIdsBySession.has("ops-session-last")).toBe(false);
  });

  it("handles stale and rejected ops session screencast finalization paths", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const managerAny = manager as unknown as {
      activeScreencasts: Map<string, { stop: (reason: "session_closed") => Promise<never> }>;
      screencastIdsBySession: Map<string, Set<string>>;
      finalizeSessionScreencasts: (sessionId: string) => Promise<void>;
    };
    managerAny.activeScreencasts.set("ops-cast-failing", {
      stop: vi.fn(async () => {
        throw new Error("ops-stop-failed");
      })
    });
    managerAny.screencastIdsBySession.set("ops-session-finalize", new Set(["ops-cast-missing", "ops-cast-failing"]));

    await expect(managerAny.finalizeSessionScreencasts("ops-session-finalize")).rejects.toThrow("ops-stop-failed");
  });

  it("removes stale ops target screencast mappings without a recorder", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const managerAny = manager as unknown as {
      screencastIdsByTarget: Map<string, string>;
      finalizeTargetScreencast: (sessionId: string, targetId: string) => Promise<void>;
    };
    managerAny.screencastIdsByTarget.set("ops-session-target:ops-target-target", "ops-cast-missing");

    await managerAny.finalizeTargetScreencast("ops-session-target", "ops-target-target");

    expect(managerAny.screencastIdsByTarget.has("ops-session-target:ops-target-target")).toBe(false);
  });

  it("treats ops disconnect timeout as idempotent success and clears local session state", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const opsSessions = (manager as { opsSessions: Set<string> }).opsSessions;
    const opsLeases = (manager as { opsLeases: Map<string, string> }).opsLeases;

    opsSessions.add("ops-timeout");
    opsLeases.set("ops-timeout", "lease-timeout");
    (manager as { opsClient: { request: () => Promise<unknown> } | null }).opsClient = {
      request: vi.fn().mockRejectedValue(new Error("Ops request timed out"))
    };

    await expect(manager.disconnect("ops-timeout", false)).resolves.toBeUndefined();
    expect(opsSessions.has("ops-timeout")).toBe(false);
    expect(opsLeases.has("ops-timeout")).toBe(false);
  });

  it("recovers ops disconnect after transient relay unavailability", async () => {
    let connectAttempt = 0;
    let disconnectAttempt = 0;
    requestMock.mockImplementation(async (...args: unknown[]) => {
      const command = args[0] as string;
      const opsSessionId = args[2] as string | undefined;
      if (command === "session.connect") {
        connectAttempt += 1;
        return {
          opsSessionId: connectAttempt === 1 ? "ops-1" : "ops-2",
          activeTargetId: connectAttempt === 1 ? "tab-1" : "tab-2",
          leaseId: "lease-1",
          url: "https://example.com/recovered"
        };
      }
      if (command === "session.disconnect") {
        disconnectAttempt += 1;
        if (disconnectAttempt === 1) {
          throw new Error("[ops_unavailable] Extension not connected to relay.");
        }
        expect(opsSessionId).toBe("ops-2");
        return { ok: true };
      }
      return { ok: true };
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        relayPort: 8787,
        pairingRequired: false,
        instanceId: "relay-1",
        epoch: 1,
        extensionConnected: true,
        extensionHandshakeComplete: true
      })
    }));

    const manager = new OpsBrowserManager({ connectRelay: vi.fn() } as never, makeConfig());
    await manager.connectRelay("ws://127.0.0.1:8787/ops");

    await expect(manager.disconnect("ops-1", false)).resolves.toBeUndefined();
    expect(connectAttempt).toBe(2);
    expect(disconnectAttempt).toBe(2);
  });

  it("rethrows relay-unavailable ops requests when the relay never reports extension readiness", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const managerAny = manager as unknown as {
      opsClient: { request: ReturnType<typeof vi.fn> } | null;
      opsLeases: Map<string, string>;
      requestOps: (sessionId: string, command: string, payload: Record<string, unknown>) => Promise<unknown>;
    };

    managerAny.opsClient = {
      request: vi.fn().mockRejectedValue(new Error("[ops_unavailable] Extension not connected to relay."))
    };
    managerAny.opsLeases.set("ops-unready", "lease-unready");

    await expect(managerAny.requestOps("ops-unready", "session.status", {})).rejects.toThrow(
      "[ops_unavailable] Extension not connected to relay."
    );
  });

  it("reconnects and recovers a live ops session when the websocket client is missing", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const managerAny = manager as unknown as {
      opsClient: { request: ReturnType<typeof vi.fn> } | null;
      opsEndpoint: string | null;
      opsSessions: Set<string>;
      opsLeases: Map<string, string>;
      opsSessionTabs: Map<string, number>;
      requestOps: (sessionId: string, command: string, payload: Record<string, unknown>) => Promise<unknown>;
    };

    managerAny.opsClient = null;
    managerAny.opsEndpoint = "ws://127.0.0.1:8787/ops";
    managerAny.opsSessions.add("ops-recover");
    managerAny.opsLeases.set("ops-recover", "lease-recover");
    managerAny.opsSessionTabs.set("ops-recover", 202);

    requestMock
      .mockResolvedValueOnce({
        opsSessionId: "ops-proto-recover",
        activeTargetId: "tab-202",
        leaseId: "lease-recover",
        url: "https://example.com/canvas"
      })
      .mockResolvedValueOnce({
        activeTargetId: "tab-202",
        targets: [{ targetId: "tab-202", type: "page", title: "Canvas", url: "https://example.com/canvas" }]
      });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        extensionConnected: true,
        extensionHandshakeComplete: true
      })
    }));

    await expect(managerAny.requestOps("ops-recover", "targets.list", { includeUrls: true })).resolves.toEqual({
      activeTargetId: "tab-202",
      targets: [{ targetId: "tab-202", type: "page", title: "Canvas", url: "https://example.com/canvas" }]
    });
    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(requestMock).toHaveBeenNthCalledWith(
      1,
      "session.connect",
      expect.objectContaining({
        sessionId: "ops-recover",
        tabId: 202,
        parallelismPolicy: expect.any(Object)
      }),
      undefined,
      30000,
      "lease-recover"
    );
    expect(requestMock).toHaveBeenNthCalledWith(
      2,
      "targets.list",
      { includeUrls: true },
      "ops-proto-recover",
      30000,
      "lease-recover"
    );
  });

  it("builds ops debug traces without optional page metadata and resolves latest status helpers", async () => {
    requestMock.mockImplementation(async (...args: unknown[]) => {
      const command = args[0] as string;
      if (command === "session.connect") {
        return { opsSessionId: "ops-trace", activeTargetId: "tab-1", leaseId: "lease-trace" };
      }
      if (command === "session.status") {
        return { mode: "extension", activeTargetId: "tab-1", url: "", title: "" };
      }
      if (command === "devtools.consolePoll") {
        return { events: [], nextSeq: 12 };
      }
      if (command === "devtools.networkPoll") {
        return { events: [{ status: "bad" }, {}, { status: 503 }], nextSeq: 34 };
      }
      return { ok: true };
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ relayPort: 8787, pairingRequired: false, instanceId: "relay-1", epoch: 1 })
    }));

    const base = {
      reconcileExternalBlockerMeta: vi.fn().mockReturnValue(undefined)
    };
    const manager = new OpsBrowserManager(base as never, makeConfig());
    await manager.connectRelay("ws://127.0.0.1:8787/ops");

    const trace = await manager.debugTraceSnapshot("ops-trace", {
      sinceConsoleSeq: 2,
      sinceNetworkSeq: 3,
      sinceExceptionSeq: 9
    });

    expect(trace.page).toEqual({
      mode: "extension",
      activeTargetId: "tab-1"
    });
    expect(trace.channels.exception.nextSeq).toBe(9);

    const managerAny = manager as unknown as {
      findLatestStatus: (events: Array<{ status?: number | string }>) => number | undefined;
    };
    expect(managerAny.findLatestStatus([{ status: "bad" }, {}, { status: 204 }])).toBe(204);
    expect(managerAny.findLatestStatus([{ status: "bad" }, {}])).toBeUndefined();
  });

  it("covers ops meta passthrough, non-ops debug-trace delegation, and fallback page metadata branches", async () => {
    const baseTrace = {
      requestId: "base-trace",
      generatedAt: "2026-03-22T00:00:00.000Z",
      page: {
        mode: "managed",
        activeTargetId: null
      },
      channels: {
        console: { nextSeq: 0, events: [] },
        network: { nextSeq: 0, events: [] },
        exception: { nextSeq: 0, events: [] }
      },
      fingerprint: { tier1: { ok: true } }
    };
    const base = {
      debugTraceSnapshot: vi.fn().mockResolvedValue(baseTrace),
      reconcileExternalBlockerMeta: vi.fn()
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce({ blockerState: "clear" })
    };
    const manager = new OpsBrowserManager(base as never, makeConfig());
    const managerAny = manager as unknown as {
      opsLeases: Map<string, string>;
      withOpsMeta: <T extends Record<string, unknown>>(
        sessionId: string,
        result: T,
        options: Record<string, unknown>
      ) => T & { meta?: unknown };
    };

    managerAny.opsLeases.set("ops-meta", "lease-meta");
    expect(managerAny.withOpsMeta("ops-meta", { timingMs: 1 }, {
      source: "navigation",
      url: "https://example.com"
    })).toEqual({ timingMs: 1 });

    await expect(manager.debugTraceSnapshot("base-session", { max: 5 })).resolves.toEqual(baseTrace);
    expect(base.debugTraceSnapshot).toHaveBeenCalledWith("base-session", { max: 5 });

    requestMock.mockImplementation(async (...args: unknown[]) => {
      const command = args[0] as string;
      if (command === "session.connect") {
        return { opsSessionId: "ops-fallback", activeTargetId: null, leaseId: "lease-fallback" };
      }
      if (command === "session.status") {
        return { mode: "extension", activeTargetId: null };
      }
      if (command === "nav.goto") {
        return { timingMs: 7 };
      }
      if (command === "devtools.consolePoll") {
        return { events: [], nextSeq: 4 };
      }
      if (command === "devtools.networkPoll") {
        return { events: [{ status: "ignored" }], nextSeq: 5 };
      }
      return { ok: true };
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ relayPort: 8787, pairingRequired: false, instanceId: "relay-1", epoch: 1 })
    }));

    await manager.connectRelay("ws://127.0.0.1:8787/ops");
    const goto = await manager.goto("ops-fallback", "https://example.com/fallback", "load", 1000);
    expect(goto).toMatchObject({
      timingMs: 7,
      meta: {
        blockerState: "clear"
      }
    });
    expect(base.reconcileExternalBlockerMeta).toHaveBeenLastCalledWith("ops-fallback", expect.objectContaining({
      finalUrl: "https://example.com/fallback",
      targetKey: undefined
    }));

    const trace = await manager.debugTraceSnapshot("ops-fallback");
    expect(trace.page).toEqual({
      mode: "extension",
      activeTargetId: null
    });
    expect(trace.channels.exception.nextSeq).toBe(0);
    expect(base.reconcileExternalBlockerMeta).toHaveBeenLastCalledWith("ops-fallback", expect.objectContaining({
      targetKey: undefined
    }));
  });

  it("merges dialog state into blocker metadata when external blocker context exists", () => {
    const base = {
      reconcileExternalBlockerMeta: vi.fn().mockReturnValue({
        blockerState: "active",
        blocker: { kind: "challenge" }
      })
    };
    const manager = new OpsBrowserManager(base as never, makeConfig());
    const managerAny = manager as unknown as {
      opsLeases: Map<string, string>;
      withOpsMeta: <T extends Record<string, unknown>>(
        sessionId: string,
        result: T,
        options: Record<string, unknown>
      ) => T & { meta?: unknown };
    };

    managerAny.opsLeases.set("ops-meta-dialog", "lease-meta-dialog");
    expect(managerAny.withOpsMeta("ops-meta-dialog", {
      timingMs: 2,
      dialog: { open: true, type: "prompt", message: "Continue?" }
    }, {
      source: "navigation",
      url: "https://example.com/dialog"
    })).toEqual({
      timingMs: 2,
      meta: {
        blockerState: "active",
        blocker: { kind: "challenge" },
        dialog: { open: true, type: "prompt", message: "Continue?" }
      }
    });
  });

  it("synthesizes clear blocker metadata when only dialog state exists", () => {
    const base = {
      reconcileExternalBlockerMeta: vi.fn().mockReturnValue(undefined)
    };
    const manager = new OpsBrowserManager(base as never, makeConfig());
    const managerAny = manager as unknown as {
      withOpsMeta: <T extends Record<string, unknown>>(
        sessionId: string,
        result: T,
        options: Record<string, unknown>
      ) => T & { meta?: unknown };
    };

    expect(managerAny.withOpsMeta("ops-dialog-only", {
      ok: true,
      dialog: { open: true, type: "alert", message: "Heads up" }
    }, {
      source: "navigation",
      url: "https://example.com/alert"
    })).toEqual({
      ok: true,
      meta: {
        blockerState: "clear",
        dialog: { open: true, type: "alert", message: "Heads up" }
      }
    });
  });

  it("includes url and title in ops debug traces when status reports them", async () => {
    requestMock.mockImplementation(async (...args: unknown[]) => {
      const command = args[0] as string;
      if (command === "session.connect") {
        return { opsSessionId: "ops-trace-page", activeTargetId: "tab-9", leaseId: "lease-trace-page" };
      }
      if (command === "session.status") {
        return {
          mode: "extension",
          activeTargetId: "tab-9",
          url: "https://example.com/trace",
          title: "Trace Title"
        };
      }
      if (command === "devtools.consolePoll") {
        return { events: [], nextSeq: 1 };
      }
      if (command === "devtools.networkPoll") {
        return { events: [], nextSeq: 2 };
      }
      return { ok: true };
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ relayPort: 8787, pairingRequired: false, instanceId: "relay-1", epoch: 1 })
    }));

    const manager = new OpsBrowserManager({
      reconcileExternalBlockerMeta: vi.fn().mockReturnValue(undefined)
    } as never, makeConfig());
    await manager.connectRelay("ws://127.0.0.1:8787/ops");

    const trace = await manager.debugTraceSnapshot("ops-trace-page");
    expect(trace.page).toEqual({
      mode: "extension",
      activeTargetId: "tab-9",
      url: "https://example.com/trace",
      title: "Trace Title"
    });
  });

  it("merges bounded challenge orchestration into ops status metadata", async () => {
    requestMock.mockImplementation(async (...args: unknown[]) => {
      const command = args[0] as string;
      if (command === "session.connect") {
        return { opsSessionId: "ops-challenge", activeTargetId: "tab-4", leaseId: "lease-challenge" };
      }
      if (command === "session.status") {
        return {
          mode: "extension",
          activeTargetId: "tab-4",
          url: "https://example.com/login",
          title: "Sign in"
        };
      }
      return { ok: true };
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ relayPort: 8787, pairingRequired: false, instanceId: "relay-1", epoch: 1 })
    }));

    const base = {
      setChallengeOrchestrator: vi.fn(),
      reconcileExternalBlockerMeta: vi.fn().mockReturnValue({
        blockerState: "active",
        challenge: {
          challengeId: "challenge-ops",
          blockerType: "auth_required",
          ownerSurface: "ops",
          ownerLeaseId: "lease-challenge",
          resumeMode: "manual",
          status: "active",
          updatedAt: "2026-03-22T00:00:00.000Z"
        }
      })
    };
    const orchestrate = vi.fn().mockResolvedValue({
      action: {
        status: "resolved",
        attempts: 1,
        noProgressCount: 0,
        executedSteps: [],
        verification: {
          status: "clear",
          blockerState: "clear",
          changed: true,
          reason: "Manager verification cleared the blocker."
        },
        reusedExistingSession: true,
        reusedCookies: false
      },
      outcome: {
        challengeId: "challenge-ops",
        classification: "existing_session_reuse",
        lane: "generic_browser_autonomy",
        status: "resolved",
        reason: "Manager verification cleared the blocker.",
        attempts: 1,
        reusedExistingSession: true,
        reusedCookies: false,
        verification: {
          status: "clear",
          blockerState: "clear",
          changed: true,
          reason: "Manager verification cleared the blocker."
        },
        evidence: {
          url: "https://example.com/login",
          title: "Sign in",
          blockerType: "auth_required",
          loginRefs: ["r1"],
          humanVerificationRefs: [],
          checkpointRefs: []
        }
      }
    });
    const manager = new OpsBrowserManager(base as never, makeConfig());
    manager.setChallengeOrchestrator({ orchestrate } as never);

    await manager.connectRelay("ws://127.0.0.1:8787/ops");
    const status = await manager.status("ops-challenge");

    expect(base.setChallengeOrchestrator).toHaveBeenCalled();
    expect(orchestrate).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "ops-challenge",
      canImportCookies: true
    }));
    expect(status.meta).toMatchObject({
      blockerState: "clear",
      challengeOrchestration: {
        lane: "generic_browser_autonomy",
        status: "resolved"
      }
    });
  });

  it("normalizes secure relay status URLs and rejects invalid websocket endpoints", () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const managerAny = manager as unknown as {
      buildRelayStatusUrl: (wsEndpoint: string) => URL | null;
    };

    expect(managerAny.buildRelayStatusUrl("wss://example.com:9443/ops")?.toString()).toBe("https://example.com:9443/status");
    expect(managerAny.buildRelayStatusUrl("not a websocket url")).toBeNull();
  });

  it("ignores invalid remembered recovery urls", () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const managerAny = manager as unknown as {
      opsSessionUrls: Map<string, string>;
      rememberSessionUrl: (sessionId: string, url: string | null | undefined) => void;
    };

    managerAny.rememberSessionUrl("ops-bad-url", "not a valid url");
    managerAny.rememberSessionUrl("ops-ftp-url", "ftp://example.com/file");

    expect(managerAny.opsSessionUrls.has("ops-bad-url")).toBe(false);
    expect(managerAny.opsSessionUrls.has("ops-ftp-url")).toBe(false);
  });

  it("recovers ops sessions without remembered targets or fallback URLs and preserves the prior lease", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const clientRequest = vi.fn().mockResolvedValue({
      opsSessionId: "ops-2"
    });
    const managerAny = manager as unknown as {
      opsClient: { request: ReturnType<typeof vi.fn> } | null;
      opsLeases: Map<string, string>;
      opsSessionTabs: Map<string, number>;
      opsSessionUrls: Map<string, string>;
      recoverOpsSession: (sessionId: string, payload: Record<string, unknown>) => Promise<boolean>;
      opsProtocolSessions: Map<string, string>;
      publicSessionIdsByProtocolId: Map<string, string>;
    };

    managerAny.opsClient = { request: clientRequest };
    managerAny.opsLeases.set("ops-no-target", "lease-keep");

    await expect(managerAny.recoverOpsSession("ops-no-target", {})).resolves.toBe(true);
    expect(clientRequest).toHaveBeenCalledWith(
      "session.connect",
      {
        sessionId: "ops-no-target",
        parallelismPolicy: expect.any(Object)
      },
      undefined,
      30000,
      "lease-keep"
    );
    expect(managerAny.opsLeases.get("ops-no-target")).toBe("lease-keep");
    expect(managerAny.opsSessionTabs.has("ops-no-target")).toBe(false);
    expect(managerAny.opsSessionUrls.has("ops-no-target")).toBe(false);
    expect(managerAny.opsProtocolSessions.get("ops-no-target")).toBe("ops-2");
    expect(managerAny.publicSessionIdsByProtocolId.get("ops-2")).toBe("ops-no-target");
  });

  it("treats string timeout disconnect errors as idempotent success", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const opsSessions = (manager as { opsSessions: Set<string> }).opsSessions;
    const opsLeases = (manager as { opsLeases: Map<string, string> }).opsLeases;

    opsSessions.add("ops-timeout-string");
    opsLeases.set("ops-timeout-string", "lease-timeout-string");
    (manager as { opsClient: { request: () => Promise<unknown> } | null }).opsClient = {
      request: vi.fn().mockRejectedValue("Ops request timed out")
    };

    await expect(manager.disconnect("ops-timeout-string", false)).resolves.toBeUndefined();
    expect(opsSessions.has("ops-timeout-string")).toBe(false);
    expect(opsLeases.has("ops-timeout-string")).toBe(false);
  });

  it("throws non-ignorable disconnect errors without clearing local session state", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const opsSessions = (manager as { opsSessions: Set<string> }).opsSessions;
    const opsLeases = (manager as { opsLeases: Map<string, string> }).opsLeases;

    opsSessions.add("ops-fail");
    opsLeases.set("ops-fail", "lease-fail");
    (manager as { opsClient: { request: () => Promise<unknown> } | null }).opsClient = {
      request: vi.fn().mockRejectedValue(new Error("disconnect failed"))
    };

    await expect(manager.disconnect("ops-fail", false)).rejects.toThrow("disconnect failed");
    expect(opsSessions.has("ops-fail")).toBe(true);
    expect(opsLeases.has("ops-fail")).toBe(true);
  });

  it("treats null disconnect errors as non-ignorable and preserves session state", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const opsSessions = (manager as { opsSessions: Set<string> }).opsSessions;
    const opsLeases = (manager as { opsLeases: Map<string, string> }).opsLeases;

    opsSessions.add("ops-null");
    opsLeases.set("ops-null", "lease-null");
    (manager as { opsClient: { request: () => Promise<unknown> } | null }).opsClient = {
      request: vi.fn().mockRejectedValue(null)
    };

    await expect(manager.disconnect("ops-null", false)).rejects.toBeNull();
    expect(opsSessions.has("ops-null")).toBe(true);
    expect(opsLeases.has("ops-null")).toBe(true);
  });

  it("preserves live ops session metadata when the ops client closes unexpectedly", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const opsSessions = (manager as { opsSessions: Set<string> }).opsSessions;
    const opsLeases = (manager as { opsLeases: Map<string, string> }).opsLeases;
    const opsSessionTabs = (manager as { opsSessionTabs: Map<string, number> }).opsSessionTabs;
    const opsSessionUrls = (manager as { opsSessionUrls: Map<string, string> }).opsSessionUrls;
    const opsProtocolSessions = (manager as { opsProtocolSessions: Map<string, string> }).opsProtocolSessions;
    const publicSessionIdsByProtocolId = (manager as { publicSessionIdsByProtocolId: Map<string, string> }).publicSessionIdsByProtocolId;
    const closedOpsSessions = (manager as { closedOpsSessions: Map<string, number> }).closedOpsSessions;
    const client = { disconnect: vi.fn() };

    opsSessions.add("ops-1");
    opsSessions.add("ops-2");
    opsLeases.set("ops-1", "lease-1");
    opsLeases.set("ops-2", "lease-2");
    opsSessionTabs.set("ops-1", 41);
    opsSessionUrls.set("ops-1", "https://example.com/canvas");
    opsProtocolSessions.set("ops-1", "ops-proto-1");
    publicSessionIdsByProtocolId.set("ops-proto-1", "ops-1");
    (manager as { opsClient: { disconnect: () => void } | null }).opsClient = client;
    (manager as { opsEndpoint: string | null }).opsEndpoint = "ws://127.0.0.1:8787/ops";

    (manager as unknown as { handleOpsClientClosed: (value: unknown) => void }).handleOpsClientClosed(client);

    expect(opsSessions.size).toBe(2);
    expect(opsLeases.get("ops-1")).toBe("lease-1");
    expect(opsSessionTabs.get("ops-1")).toBe(41);
    expect(opsSessionUrls.get("ops-1")).toBe("https://example.com/canvas");
    expect(opsProtocolSessions.size).toBe(0);
    expect(publicSessionIdsByProtocolId.size).toBe(0);
    expect(closedOpsSessions.size).toBe(0);
    expect((manager as { opsClient: unknown | null }).opsClient).toBeNull();
    expect((manager as { opsEndpoint: string | null }).opsEndpoint).toBe("ws://127.0.0.1:8787/ops");
  });

  it("no-ops when ops client closes without sessions", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const closedOpsSessions = (manager as { closedOpsSessions: Map<string, number> }).closedOpsSessions;
    const client = { disconnect: vi.fn() };
    (manager as { opsClient: { disconnect: () => void } | null }).opsClient = client;
    (manager as { opsEndpoint: string | null }).opsEndpoint = "ws://127.0.0.1:8787/ops";

    (manager as unknown as { handleOpsClientClosed: (value: unknown) => void }).handleOpsClientClosed(client);

    expect(closedOpsSessions.size).toBe(0);
    expect((manager as { opsClient: unknown | null }).opsClient).toBeNull();
    expect((manager as { opsEndpoint: string | null }).opsEndpoint).toBeNull();
  });

  it("ignores close notifications from stale ops clients", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const opsSessions = (manager as { opsSessions: Set<string> }).opsSessions;
    const opsLeases = (manager as { opsLeases: Map<string, string> }).opsLeases;
    const activeClient = { disconnect: vi.fn() };
    const staleClient = { disconnect: vi.fn() };

    opsSessions.add("ops-1");
    opsLeases.set("ops-1", "lease-1");
    (manager as { opsClient: { disconnect: () => void } | null }).opsClient = activeClient;
    (manager as { opsEndpoint: string | null }).opsEndpoint = "ws://127.0.0.1:8787/ops";

    (manager as unknown as { handleOpsClientClosed: (value: unknown) => void }).handleOpsClientClosed(staleClient);

    expect((manager as { opsClient: unknown | null }).opsClient).toBe(activeClient);
    expect((manager as { opsEndpoint: string | null }).opsEndpoint).toBe("ws://127.0.0.1:8787/ops");
    expect(opsSessions.has("ops-1")).toBe(true);
  });

  it("throws when ops lease is missing", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    (manager as { opsClient: { request: () => Promise<unknown> } | null }).opsClient = {
      request: vi.fn().mockResolvedValue({})
    };
    const opsSessions = (manager as { opsSessions: Set<string> }).opsSessions;
    opsSessions.add("ops-lease-missing");

    await expect(manager.goto("ops-lease-missing", "https://example.com")).rejects.toThrow("Ops lease not found");
  });

  it("invokes ops client event handlers", async () => {
    requestMock.mockImplementation(async (...args: unknown[]) => {
      const command = args[0] as string;
      if (command === "session.connect") {
        return { opsSessionId: "ops-evt", activeTargetId: "tab-1", url: "https://example.com", title: "Example", leaseId: "lease-evt" };
      }
      return {};
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ relayPort: 8787, pairingRequired: false, instanceId: "relay-1", epoch: 1 })
    }) as never);
    const manager = new OpsBrowserManager({} as never, makeConfig());
    await manager.connectRelay("ws://127.0.0.1:8787/ops");

    const opsClient = (manager as { opsClient: { emitEvent: (event: { event?: string; opsSessionId?: string }) => void; emitClose: () => void } | null }).opsClient;
    const opsSessions = (manager as { opsSessions: Set<string> }).opsSessions;

    opsClient?.emitEvent({ opsSessionId: "ops-evt", event: "ops_tab_closed" });
    expect(opsSessions.has("ops-evt")).toBe(false);

    opsSessions.add("ops-evt");
    opsClient?.emitClose();
    expect(opsSessions.size).toBe(1);
    expect((manager as { opsClient: unknown | null }).opsClient).toBeNull();
  });

  it("prunes closed ops sessions beyond 100", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const closedOpsSessions = (manager as { closedOpsSessions: Map<string, number> }).closedOpsSessions;

    for (let i = 0; i < 105; i += 1) {
      closedOpsSessions.set(`ops-${i}`, i);
    }

    (manager as unknown as { trackClosedSessionCleanup: () => void }).trackClosedSessionCleanup();

    expect(closedOpsSessions.size).toBe(100);
    expect(closedOpsSessions.has("ops-0")).toBe(false);
  });

  it("skips cleanup when closed ops sessions are under the limit", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const closedOpsSessions = (manager as { closedOpsSessions: Map<string, number> }).closedOpsSessions;

    for (let i = 0; i < 100; i += 1) {
      closedOpsSessions.set(`ops-${i}`, i);
    }

    (manager as unknown as { trackClosedSessionCleanup: () => void }).trackClosedSessionCleanup();

    expect(closedOpsSessions.size).toBe(100);
    expect(closedOpsSessions.has("ops-0")).toBe(true);
  });

  it("preserves falsy session ids during cleanup", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const closedOpsSessions = (manager as { closedOpsSessions: Map<string, number> }).closedOpsSessions;

    closedOpsSessions.set("", -1);
    for (let i = 0; i < 101; i += 1) {
      closedOpsSessions.set(`ops-${i}`, i);
    }

    (manager as unknown as { trackClosedSessionCleanup: () => void }).trackClosedSessionCleanup();

    expect(closedOpsSessions.has("")).toBe(true);
    expect(closedOpsSessions.size).toBe(101);
  });

  it("recreates ops client when endpoint changes", async () => {
    requestMock.mockImplementation(async (command: string) => {
      if (command === "session.connect") {
        return { opsSessionId: "ops-3", activeTargetId: "tab-1" };
      }
      return { ok: true };
    });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ relayPort: 8787, pairingRequired: false, instanceId: "relay-1", epoch: 1 })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ relayPort: 9999, pairingRequired: false, instanceId: "relay-1", epoch: 1 })
      });
    vi.stubGlobal("fetch", fetchMock as never);

    const base = { connectRelay: vi.fn() };
    const manager = new OpsBrowserManager(base as never, makeConfig());

    await manager.connectRelay("ws://127.0.0.1:8787/ops");
    await manager.connectRelay("ws://127.0.0.1:9999/ops");

    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });

  it("executes ops commands for an active ops session", async () => {
    const domCapture = { html: "<div></div>", styles: {}, warnings: [], inlineStyles: true };
    requestMock.mockImplementation(async (...args: unknown[]) => {
      const command = args[0] as string;
      switch (command) {
        case "session.connect":
          return { opsSessionId: "ops-2", activeTargetId: "tab-1", leaseId: "lease-ops" };
        case "nav.goto":
          return { finalUrl: "https://example.com", status: 200, timingMs: 1 };
        case "nav.wait":
          return { timingMs: 1 };
        case "nav.snapshot":
          return { snapshotId: "snap", content: "", truncated: false, refCount: 0, timingMs: 1 };
        case "interact.click":
          return { timingMs: 1, navigated: false };
        case "interact.hover":
        case "interact.press":
        case "interact.check":
        case "interact.uncheck":
        case "interact.type":
          return { timingMs: 1 };
        case "interact.select":
        case "interact.scroll":
          return undefined;
        case "interact.scrollIntoView":
          return { timingMs: 1 };
        case "dom.getHtml":
          return { outerHTML: "<div></div>", truncated: false };
        case "dom.getText":
          return { text: "hello", truncated: false };
        case "dom.getAttr":
          return { value: "attr" };
        case "dom.getValue":
          return { value: "value" };
        case "dom.isVisible":
          return { value: true };
        case "dom.isEnabled":
          return { value: true };
        case "dom.isChecked":
          return { value: false };
        case "canvas.applyRuntimePreviewBridge":
          return {
            ok: true,
            artifact: {
              projection: "bound_app_runtime",
              rootBindingId: "binding-runtime",
              capturedAt: "2026-03-12T12:00:00.000Z",
              hierarchyHash: "node-root:",
              nodes: []
            }
          };
        case "export.clonePage":
        case "export.cloneComponent":
          return { capture: domCapture };
        case "devtools.perf":
          return { metrics: [] };
        case "page.screenshot":
          return { base64: Buffer.from("image").toString("base64") };
        case "devtools.consolePoll":
        case "devtools.networkPoll":
          return { events: [], nextSeq: 0 };
        case "targets.list":
          return { activeTargetId: null, targets: [] };
        case "targets.registerCanvas":
          return {
            targetId: "tab-canvas",
            adopted: true,
            url: "chrome-extension://test/canvas.html",
            title: "Canvas"
          };
        case "targets.use":
          return { activeTargetId: "tab-1", url: "https://example.com", title: "Example" };
        case "targets.new":
          return { targetId: "tab-2" };
        case "targets.close":
          return { ok: true };
        case "storage.setCookies":
          return { requestId: "req-ops", imported: 1, rejected: [] };
        case "storage.getCookies":
          return {
            requestId: "req-ops-list",
            cookies: [{
              name: "session",
              value: "abc",
              domain: "example.com",
              path: "/",
              expires: -1,
              httpOnly: true,
              secure: true
            }],
            count: 1
          };
        case "page.open":
          return { targetId: "tab-3", created: true, url: "https://example.com", title: "Example" };
        case "page.list":
          return { pages: [] };
        case "page.close":
          return { ok: true };
        default:
          return { ok: true };
      }
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ relayPort: 8787, pairingRequired: false, instanceId: "relay-1", epoch: 1 })
    }));

    const base = {
      connectRelay: vi.fn()
    };
    const manager = new OpsBrowserManager(base as never, makeConfig());

    const connected = await manager.connectRelay("ws://127.0.0.1:8787/ops");
    expect(connected.sessionId).toBe("ops-2");
    await manager.connectRelay("ws://127.0.0.1:8787/ops");
    expect(connectMock).toHaveBeenCalled();

    await manager.goto("ops-2", "https://example.com", "load", 1000);
    await manager.waitForLoad("ops-2", "load", 1000);
    await manager.waitForRef("ops-2", "ref-1", "visible", 1000);
    await manager.snapshot("ops-2", "outline", 1000, "cursor-1");
    await manager.click("ops-2", "ref-1");
    await manager.hover("ops-2", "ref-1");
    await manager.press("ops-2", "Enter", "ref-1");
    await manager.check("ops-2", "ref-1");
    await manager.uncheck("ops-2", "ref-1");
    await manager.type("ops-2", "ref-1", "text", true, true);
    await manager.select("ops-2", "ref-1", ["a"]);
    await manager.scroll("ops-2", 10, "ref-1");
    await manager.scrollIntoView("ops-2", "ref-1");
    await manager.domGetHtml("ops-2", "ref-1", 1000);
    await manager.domGetText("ops-2", "ref-1", 1000);
    await manager.domGetAttr("ops-2", "ref-1", "id");
    await manager.domGetValue("ops-2", "ref-1");
    await manager.domIsVisible("ops-2", "ref-1");
    await manager.domIsEnabled("ops-2", "ref-1");
    await manager.domIsChecked("ops-2", "ref-1");
    await manager.clonePage("ops-2");
    await manager.cloneComponent("ops-2", "ref-1");
    await manager.perfMetrics("ops-2");
    await manager.screenshot("ops-2");
    await manager.screenshot("ops-2", { path: "/tmp/ops-screenshot.png" });
    await manager.consolePoll("ops-2", 0, 10);
    await manager.networkPoll("ops-2", 0, 10);
    await manager.listTargets("ops-2", true);
    await manager.registerCanvasTarget("ops-2", "tab-canvas");
    await manager.useTarget("ops-2", "tab-1");
    await manager.newTarget("ops-2", "https://example.com");
    await manager.closeTarget("ops-2", "tab-1");
    const cookieResult = await manager.cookieImport(
      "ops-2",
      [{ name: "session", value: "abc", url: "https://example.com" }],
      true,
      "req-ops"
    );
    expect(cookieResult).toEqual({ requestId: "req-ops", imported: 1, rejected: [] });
    const cookieListResult = await manager.cookieList("ops-2", ["https://example.com"], "req-ops-list");
    expect(cookieListResult).toEqual({
      requestId: "req-ops-list",
      cookies: [{
        name: "session",
        value: "abc",
        domain: "example.com",
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: true
      }],
      count: 1
    });
    await manager.page("ops-2", "main", "https://example.com");
    await manager.listPages("ops-2");
    await manager.closePage("ops-2", "main");

    const nonConnectCalls = requestMock.mock.calls.filter((call) => call[0] !== "session.connect");
    for (const call of nonConnectCalls) {
      expect(call[4]).toBe("lease-ops");
    }
    await expect(manager.withPage("ops-2", null, async () => "ok")).rejects.toThrow("Direct annotate is unavailable");
    await expect(manager.applyRuntimePreviewBridge("ops-2", "tab-1", {
      bindingId: "binding-runtime",
      rootSelector: "#runtime-root",
      html: "<article data-node-id=\"node-root\"></article>"
    })).resolves.toEqual({
      ok: true,
      artifact: {
        projection: "bound_app_runtime",
        rootBindingId: "binding-runtime",
        capturedAt: "2026-03-12T12:00:00.000Z",
        hierarchyHash: "node-root:",
        nodes: []
      }
    });
    expect(requestMock).toHaveBeenCalledWith(
      "canvas.applyRuntimePreviewBridge",
      {
        bindingId: "binding-runtime",
        rootSelector: "#runtime-root",
        html: "<article data-node-id=\"node-root\"></article>",
        targetId: "tab-1"
      },
      "ops-2",
      30000,
      "lease-ops"
    );
    expect(requestMock).toHaveBeenCalledWith(
      "targets.registerCanvas",
      { targetId: "tab-canvas" },
      "ops-2",
      30000,
      "lease-ops"
    );
  });

  it("propagates ops screenshot warnings", async () => {
    requestMock.mockImplementation(async (...args: unknown[]) => {
      const command = args[0] as string;
      if (command === "session.connect") {
        return { opsSessionId: "ops-9", activeTargetId: "tab-1", leaseId: "lease-9" };
      }
      if (command === "page.screenshot") {
        return { base64: Buffer.from("image").toString("base64"), warning: "visible_only_fallback" };
      }
      return { ok: true };
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ relayPort: 8787, pairingRequired: false, instanceId: "relay-1", epoch: 1 })
    }));

    const manager = new OpsBrowserManager({ connectRelay: vi.fn() } as never, makeConfig());
    await manager.connectRelay("ws://127.0.0.1:8787/ops");

    const result = await manager.screenshot("ops-9");
    expect(result).toEqual({
      base64: Buffer.from("image").toString("base64"),
      warnings: ["visible_only_fallback"]
    });
  });

  it("routes upload and dialog through ops requests", async () => {
    requestMock.mockImplementation(async (...args: unknown[]) => {
      const command = args[0] as string;
      if (command === "session.connect") {
        return { opsSessionId: "ops-dialog-upload", activeTargetId: "tab-1", leaseId: "lease-dialog-upload" };
      }
      if (command === "interact.upload") {
        return { fileCount: 2, mode: "file_chooser" };
      }
      if (command === "page.dialog") {
        return { dialog: { open: true, type: "prompt" }, handled: true };
      }
      return { ok: true };
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ relayPort: 8787, pairingRequired: false, instanceId: "relay-1", epoch: 1 })
    }));

    const manager = new OpsBrowserManager({ connectRelay: vi.fn() } as never, makeConfig());
    await manager.connectRelay("ws://127.0.0.1:8787/ops");

    await expect(manager.upload("ops-dialog-upload", {
      targetId: "tab-1",
      ref: "r4",
      files: ["/tmp/a.txt", "/tmp/b.txt"]
    })).resolves.toEqual({ fileCount: 2, mode: "file_chooser" });

    await expect(manager.dialog("ops-dialog-upload", {
      targetId: "tab-1",
      action: "accept",
      promptText: "hello"
    })).resolves.toEqual({ dialog: { open: true, type: "prompt" }, handled: true });

    expect(requestMock).toHaveBeenNthCalledWith(
      2,
      "interact.upload",
      {
        targetId: "tab-1",
        ref: "r4",
        files: ["/tmp/a.txt", "/tmp/b.txt"]
      },
      "ops-dialog-upload",
      30000,
      "lease-dialog-upload"
    );
    expect(requestMock).toHaveBeenNthCalledWith(
      3,
      "page.dialog",
      {
        targetId: "tab-1",
        action: "accept",
        promptText: "hello"
      },
      "ops-dialog-upload",
      30000,
      "lease-dialog-upload"
    );
  });

  it("forwards clone-page overrides through ops export capture", async () => {
    const domCapture = { html: "<div></div>", styles: {}, warnings: [], inlineStyles: true };
    requestMock.mockImplementation(async (...args: unknown[]) => {
      const command = args[0] as string;
      if (command === "session.connect") {
        return { opsSessionId: "ops-clone-options", activeTargetId: "tab-1", leaseId: "lease-clone-options" };
      }
      if (command === "export.clonePage") {
        return { capture: domCapture };
      }
      return { ok: true };
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ relayPort: 8787, pairingRequired: false, instanceId: "relay-1", epoch: 1 })
    }));

    const manager = new OpsBrowserManager({ connectRelay: vi.fn() } as never, makeConfig());
    await manager.connectRelay("ws://127.0.0.1:8787/ops");

    await manager.clonePageWithOptions("ops-clone-options", null, { maxNodes: 2500 });
    await expect(manager.clonePageHtmlWithOptions("ops-clone-options", null, { maxNodes: 2500 })).resolves.toEqual({
      html: "<div></div>",
      warnings: []
    });

    expect(requestMock).toHaveBeenCalledWith(
      "export.clonePage",
      expect.objectContaining({
        sanitize: true,
        maxNodes: 2500,
        inlineStyles: true
      }),
      "ops-clone-options",
      30000,
      "lease-clone-options"
    );
    expect(requestMock).toHaveBeenNthCalledWith(
      3,
      "export.clonePage",
      expect.objectContaining({
        sanitize: true,
        maxNodes: 2500,
        inlineStyles: true
      }),
      "ops-clone-options",
      30000,
      "lease-clone-options"
    );
  });

  it("omits warnings from clonePageHtmlWithOptions when ops capture returns none", async () => {
    requestMock.mockImplementation(async (...args: unknown[]) => {
      const command = args[0] as string;
      if (command === "session.connect") {
        return { opsSessionId: "ops-clone-html", activeTargetId: "tab-1", leaseId: "lease-clone-html" };
      }
      if (command === "export.clonePage") {
        return { capture: { html: "<section></section>" } };
      }
      return { ok: true };
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ relayPort: 8787, pairingRequired: false, instanceId: "relay-1", epoch: 1 })
    }));

    const manager = new OpsBrowserManager({ connectRelay: vi.fn() } as never, makeConfig());
    await manager.connectRelay("ws://127.0.0.1:8787/ops");

    await expect(manager.clonePageHtmlWithOptions("ops-clone-html", null, { maxNodes: 2500 })).resolves.toEqual({
      html: "<section></section>"
    });
  });

  it("propagates ops screenshot warnings when writing to a path", async () => {
    requestMock.mockImplementation(async (...args: unknown[]) => {
      const command = args[0] as string;
      if (command === "session.connect") {
        return { opsSessionId: "ops-10", activeTargetId: "tab-1", leaseId: "lease-10" };
      }
      if (command === "page.screenshot") {
        return { base64: Buffer.from("image").toString("base64"), warning: "visible_only_fallback" };
      }
      return { ok: true };
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ relayPort: 8787, pairingRequired: false, instanceId: "relay-1", epoch: 1 })
    }));

    const manager = new OpsBrowserManager({ connectRelay: vi.fn() } as never, makeConfig());
    await manager.connectRelay("ws://127.0.0.1:8787/ops");

    const result = await manager.screenshot("ops-10", { path: "/tmp/ops-warning.png" });
    expect(result).toEqual({
      path: "/tmp/ops-warning.png",
      warnings: ["visible_only_fallback"]
    });
  });

  it("routes screenshot ref/full-page payloads and defaults dialog to status in ops mode", async () => {
    requestMock.mockImplementation(async (...args: unknown[]) => {
      const command = args[0] as string;
      if (command === "session.connect") {
        return { opsSessionId: "ops-lanes", activeTargetId: "tab-1", leaseId: "lease-lanes" };
      }
      if (command === "page.screenshot") {
        return { base64: Buffer.from("lane-image").toString("base64"), warnings: ["captured"] };
      }
      if (command === "page.dialog") {
        return { dialog: { open: false, targetId: "tab-1" } };
      }
      return { ok: true };
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ relayPort: 8787, pairingRequired: false, instanceId: "relay-1", epoch: 1 })
    }));

    const manager = new OpsBrowserManager({ connectRelay: vi.fn() } as never, makeConfig());
    await manager.connectRelay("ws://127.0.0.1:8787/ops");

    await expect(manager.screenshot("ops-lanes", {
      targetId: "tab-1",
      ref: "r4"
    })).resolves.toEqual({
      base64: Buffer.from("lane-image").toString("base64"),
      warnings: ["captured"]
    });

    await expect(manager.screenshot("ops-lanes", {
      fullPage: true
    })).resolves.toEqual({
      base64: Buffer.from("lane-image").toString("base64"),
      warnings: ["captured"]
    });

    await expect(manager.dialog("ops-lanes")).resolves.toEqual({
      dialog: { open: false, targetId: "tab-1" }
    });

    expect(requestMock).toHaveBeenNthCalledWith(
      2,
      "page.screenshot",
      expect.objectContaining({
        targetId: "tab-1",
        ref: "r4"
      }),
      "ops-lanes",
      30000,
      "lease-lanes"
    );
    expect(requestMock).toHaveBeenNthCalledWith(
      3,
      "page.screenshot",
      expect.objectContaining({
        fullPage: true
      }),
      "ops-lanes",
      30000,
      "lease-lanes"
    );
    expect(requestMock).toHaveBeenNthCalledWith(
      4,
      "page.dialog",
      expect.objectContaining({
        action: "status"
      }),
      "ops-lanes",
      30000,
      "lease-lanes"
    );

    await expect(manager.screenshot("ops-lanes", {
      ref: "r4",
      fullPage: true
    })).rejects.toThrow("Screenshot ref and fullPage options are mutually exclusive.");
  });

  it("throws when ops screenshot payload is missing", async () => {
    requestMock.mockImplementation(async (command: string) => {
      if (command === "session.connect") {
        return { opsSessionId: "ops-4", activeTargetId: "tab-1" };
      }
      if (command === "page.screenshot") {
        return {};
      }
      return { ok: true };
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ relayPort: 8787, pairingRequired: false, instanceId: "relay-1", epoch: 1 })
    }));

    const manager = new OpsBrowserManager({ connectRelay: vi.fn() } as never, makeConfig());
    await manager.connectRelay("ws://127.0.0.1:8787/ops");

    await expect(manager.screenshot("ops-4")).rejects.toThrow("Screenshot failed");
  });

  it("errors when an ops session has no connected client", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    (manager as unknown as { opsSessions: Set<string> }).opsSessions.add("ops-missing");
    (manager as unknown as { opsLeases: Map<string, string> }).opsLeases.set("ops-missing", "lease-missing");
    await expect(manager.goto("ops-missing", "https://example.com", "load", 1000)).rejects.toThrow("Ops client not connected");
  });

  it("remembers ops targets and urls across status, goto, page, and closeTarget flows", async () => {
    requestMock.mockImplementation(async (...args: unknown[]) => {
      const command = args[0] as string;
      if (command === "session.connect") {
        return { opsSessionId: "ops-helper", activeTargetId: "tab-41", leaseId: "lease-helper", url: "https://example.com/start" };
      }
      if (command === "session.status") {
        return { mode: "extension", activeTargetId: "tab-41", url: "https://example.com/status" };
      }
      if (command === "nav.goto") {
        return { timingMs: 7 };
      }
      if (command === "targets.new") {
        return { targetId: "tab-42" };
      }
      if (command === "targets.close") {
        return { ok: true };
      }
      if (command === "page.open") {
        return { targetId: "tab-43", created: true, url: "https://example.com/docs", title: "Docs" };
      }
      return { ok: true };
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ relayPort: 8787, pairingRequired: false, instanceId: "relay-1", epoch: 1 })
    }));

    const manager = new OpsBrowserManager({ connectRelay: vi.fn() } as never, makeConfig());
    await manager.connectRelay("ws://127.0.0.1:8787/ops");

    await manager.status("ops-helper");
    expect((manager as { opsSessionTabs: Map<string, number> }).opsSessionTabs.get("ops-helper")).toBe(41);
    expect((manager as { opsSessionUrls: Map<string, string> }).opsSessionUrls.get("ops-helper")).toBe("https://example.com/status");

    await manager.goto("ops-helper", "https://example.com/next", "load", 1000, undefined, "  tab-41  ");
    expect(requestMock).toHaveBeenCalledWith(
      "nav.goto",
      expect.objectContaining({
        url: "https://example.com/next",
        targetId: "tab-41"
      }),
      "ops-helper",
      30000,
      "lease-helper"
    );
    expect((manager as { opsSessionUrls: Map<string, string> }).opsSessionUrls.get("ops-helper")).toBe("https://example.com/next");

    await manager.goto("ops-helper", "https://example.com/blank-target", "load", 1000, undefined, "   ");
    const blankTargetPayload = requestMock.mock.calls
      .filter(([command]) => command === "nav.goto")
      .at(-1)?.[1] as Record<string, unknown> | undefined;
    expect(blankTargetPayload).toMatchObject({ url: "https://example.com/blank-target" });
    expect(blankTargetPayload).not.toHaveProperty("targetId");

    await manager.newTarget("ops-helper", "https://example.com/new");
    expect((manager as { opsSessionTabs: Map<string, number> }).opsSessionTabs.get("ops-helper")).toBe(42);

    await manager.page("ops-helper", "docs", "https://example.com/docs");
    expect((manager as { opsSessionTabs: Map<string, number> }).opsSessionTabs.get("ops-helper")).toBe(43);

    await manager.closeTarget("ops-helper", "tab-99");
    expect((manager as { opsSessionTabs: Map<string, number> }).opsSessionTabs.get("ops-helper")).toBe(43);

    await manager.closeTarget("ops-helper", "tab-43");
    expect((manager as { opsSessionTabs: Map<string, number> }).opsSessionTabs.has("ops-helper")).toBe(false);
  });

  it("retains the last recoverable http url when status switches to the extension canvas page", async () => {
    let statusCalls = 0;
    requestMock.mockImplementation(async (...args: unknown[]) => {
      const command = args[0] as string;
      if (command === "session.connect") {
        return { opsSessionId: "ops-safe-url", activeTargetId: "tab-41", leaseId: "lease-safe-url", url: "https://example.com/root" };
      }
      if (command === "session.status") {
        statusCalls += 1;
        if (statusCalls === 1) {
          return { mode: "extension", activeTargetId: "tab-41", url: "https://example.com/root" };
        }
        return { mode: "extension", activeTargetId: "tab-202", url: "chrome-extension://test/canvas.html" };
      }
      return { ok: true };
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ relayPort: 8787, pairingRequired: false, instanceId: "relay-1", epoch: 1 })
    }));

    const manager = new OpsBrowserManager({ connectRelay: vi.fn() } as never, makeConfig());
    await manager.connectRelay("ws://127.0.0.1:8787/ops");

    await manager.status("ops-safe-url");
    await manager.status("ops-safe-url");

    expect((manager as { opsSessionTabs: Map<string, number> }).opsSessionTabs.get("ops-safe-url")).toBe(202);
    expect((manager as { opsSessionUrls: Map<string, string> }).opsSessionUrls.get("ops-safe-url")).toBe("https://example.com/root");
  });

  it("recovers an ops session from the latest selected tab before falling back to the stable reconnect tab", async () => {
    requestMock.mockImplementation(async (...args: unknown[]) => {
      const command = args[0] as string;
      if (command === "session.connect") {
        return {
          opsSessionId: "ops-root-proto",
          activeTargetId: "tab-41",
          leaseId: "lease-root",
          url: "https://example.com/root"
        };
      }
      if (command === "targets.use") {
        return {
          activeTargetId: "tab-202",
          url: "https://example.com/popup",
          title: "Popup"
        };
      }
      return { ok: true };
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ relayPort: 8787, pairingRequired: false, instanceId: "relay-1", epoch: 1 })
    }));

    const manager = new OpsBrowserManager({ connectRelay: vi.fn() } as never, makeConfig());
    const connected = await manager.connectRelay("ws://127.0.0.1:8787/ops");
    await manager.useTarget(connected.sessionId, "tab-202");

    const managerAny = manager as unknown as {
      opsSessionTabs: Map<string, number>;
      opsSessionReconnectTabs: Map<string, number>;
      recoverOpsSession: (sessionId: string, payload: Record<string, unknown>) => Promise<boolean>;
    };

    expect(managerAny.opsSessionTabs.get(connected.sessionId)).toBe(202);
    expect(managerAny.opsSessionReconnectTabs.get(connected.sessionId)).toBe(41);

    requestMock.mockReset();
    requestMock.mockResolvedValueOnce({
      opsSessionId: "ops-root-proto-2",
      activeTargetId: "tab-202",
      leaseId: "lease-root",
      url: "https://example.com/popup"
    });

    await expect(managerAny.recoverOpsSession(connected.sessionId, {})).resolves.toBe(true);
    expect(requestMock).toHaveBeenCalledWith(
      "session.connect",
      expect.objectContaining({
        sessionId: connected.sessionId,
        tabId: 202,
        parallelismPolicy: expect.any(Object)
      }),
      undefined,
      30000,
      "lease-root"
    );
    expect(managerAny.opsSessionTabs.get(connected.sessionId)).toBe(202);
    expect(managerAny.opsSessionReconnectTabs.get(connected.sessionId)).toBe(41);
  });

  it("recovers an ops session from an explicit targetId before using remembered tabs", async () => {
    requestMock.mockImplementation(async (...args: unknown[]) => {
      const command = args[0] as string;
      if (command === "session.connect") {
        return {
          opsSessionId: "ops-root-proto",
          activeTargetId: "tab-41",
          leaseId: "lease-root",
          url: "https://example.com/root"
        };
      }
      if (command === "targets.use") {
        return {
          activeTargetId: "tab-202",
          url: "https://example.com/popup",
          title: "Popup"
        };
      }
      return { ok: true };
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ relayPort: 8787, pairingRequired: false, instanceId: "relay-1", epoch: 1 })
    }));

    const manager = new OpsBrowserManager({ connectRelay: vi.fn() } as never, makeConfig());
    const connected = await manager.connectRelay("ws://127.0.0.1:8787/ops");
    await manager.useTarget(connected.sessionId, "tab-202");

    const managerAny = manager as unknown as {
      opsSessionTabs: Map<string, number>;
      opsSessionReconnectTabs: Map<string, number>;
      recoverOpsSession: (sessionId: string, payload: Record<string, unknown>) => Promise<boolean>;
    };

    requestMock.mockReset();
    requestMock.mockResolvedValueOnce({
      opsSessionId: "ops-root-proto-3",
      activeTargetId: "tab-303",
      leaseId: "lease-root",
      url: "https://example.com/explicit"
    });

    await expect(managerAny.recoverOpsSession(connected.sessionId, { targetId: "tab-303" })).resolves.toBe(true);
    expect(requestMock).toHaveBeenCalledWith(
      "session.connect",
      expect.objectContaining({
        sessionId: connected.sessionId,
        tabId: 303,
        parallelismPolicy: expect.any(Object)
      }),
      undefined,
      30000,
      "lease-root"
    );
    expect(managerAny.opsSessionTabs.get(connected.sessionId)).toBe(303);
    expect(managerAny.opsSessionReconnectTabs.get(connected.sessionId)).toBe(41);
  });

  it("covers ops recovery, idle disconnect reuse, and protocol session mapping helpers", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const managerAny = manager as unknown as {
      opsClient: { request: ReturnType<typeof vi.fn>; disconnect?: () => Promise<void> } | null;
      opsSessions: Set<string>;
      opsLeases: Map<string, string>;
      opsSessionTabs: Map<string, number>;
      opsSessionUrls: Map<string, string>;
      opsProtocolSessions: Map<string, string>;
      publicSessionIdsByProtocolId: Map<string, string>;
      idleDisconnectPromise: Promise<void> | null;
      recoverOpsSession: (sessionId: string, payload: Record<string, unknown>) => Promise<boolean>;
      disconnectOpsClientIfIdle: () => Promise<void>;
      trackProtocolSession: (sessionId: string, protocolSessionId: string) => void;
      releaseProtocolSession: (sessionId: string) => void;
    };

    await expect(managerAny.recoverOpsSession("missing", {})).resolves.toBe(false);

    managerAny.opsClient = {
      request: vi.fn().mockRejectedValueOnce(new Error("[invalid_request] Unknown tabId: 55"))
    };
    managerAny.opsLeases.set("ops-1", "lease-1");
    managerAny.opsSessionTabs.set("ops-1", 55);
    await expect(managerAny.recoverOpsSession("ops-1", {})).rejects.toThrow("[invalid_request] Unknown tabId: 55");

    managerAny.opsClient = {
      request: vi.fn().mockRejectedValueOnce(null)
    };
    managerAny.opsLeases.set("ops-nullish", "lease-nullish");
    await expect(managerAny.recoverOpsSession("ops-nullish", {})).rejects.toBeNull();

    managerAny.opsSessionUrls.set("ops-1", "https://example.com/recover");
    managerAny.opsClient.request = vi.fn()
      .mockRejectedValueOnce(new Error("[invalid_request] Unknown tabId: 55"))
      .mockResolvedValueOnce({
        opsSessionId: "ops-2",
        activeTargetId: "tab-77",
        leaseId: "lease-2",
        url: "https://example.com/recover"
      });

    await expect(managerAny.recoverOpsSession("ops-1", { url: "   " })).resolves.toBe(true);
    expect(managerAny.opsLeases.get("ops-1")).toBe("lease-2");
    expect(managerAny.opsSessionTabs.get("ops-1")).toBe(77);
    expect(managerAny.publicSessionIdsByProtocolId.get("ops-2")).toBe("ops-1");

    managerAny.opsLeases.set("ops-2", "lease-2");
    managerAny.opsSessionTabs.set("ops-2", 88);
    managerAny.opsClient.request = vi.fn()
      .mockRejectedValueOnce("[invalid_request] Unknown tabId: 88")
      .mockResolvedValueOnce({
        opsSessionId: "ops-4",
        activeTargetId: "tab-91",
        leaseId: "lease-4",
        url: "https://example.com/recovered-again"
      });

    await expect(managerAny.recoverOpsSession("ops-2", { url: "https://example.com/recovered-again" })).resolves.toBe(true);
    expect(managerAny.opsLeases.get("ops-2")).toBe("lease-4");
    expect(managerAny.opsSessionTabs.get("ops-2")).toBe(91);
    expect(managerAny.publicSessionIdsByProtocolId.get("ops-4")).toBe("ops-2");

    managerAny.opsLeases.set("ops-timeout-retry", "lease-timeout-retry");
    managerAny.opsSessionTabs.set("ops-timeout-retry", 99);
    managerAny.opsSessionUrls.set("ops-timeout-retry", "https://example.com/recovered-timeout");
    managerAny.opsClient.request = vi.fn()
      .mockRejectedValueOnce(new OpsRequestTimeoutError({
        command: "session.connect",
        timeoutMs: 30000,
        requestId: "ops-timeout-connect",
        leaseId: "lease-timeout-retry"
      }))
      .mockResolvedValueOnce({
        opsSessionId: "ops-timeout-recovered",
        activeTargetId: "tab-109",
        leaseId: "lease-timeout-recovered",
        url: "https://example.com/recovered-timeout"
      });

    await expect(managerAny.recoverOpsSession("ops-timeout-retry", { url: "   " })).resolves.toBe(true);
    expect(managerAny.opsClient.request).toHaveBeenNthCalledWith(
      1,
      "session.connect",
      expect.objectContaining({
        sessionId: "ops-timeout-retry",
        tabId: 99
      }),
      undefined,
      expect.any(Number),
      "lease-timeout-retry"
    );
    expect(managerAny.opsClient.request).toHaveBeenNthCalledWith(
      2,
      "session.connect",
      expect.objectContaining({
        sessionId: "ops-timeout-retry",
        startUrl: "https://example.com/recovered-timeout"
      }),
      undefined,
      expect.any(Number),
      "lease-timeout-retry"
    );
    expect(managerAny.opsLeases.get("ops-timeout-retry")).toBe("lease-timeout-recovered");
    expect(managerAny.opsSessionTabs.get("ops-timeout-retry")).toBe(109);
    expect(managerAny.publicSessionIdsByProtocolId.get("ops-timeout-recovered")).toBe("ops-timeout-retry");

    managerAny.trackProtocolSession("ops-1", "ops-3");
    expect(managerAny.publicSessionIdsByProtocolId.has("ops-2")).toBe(false);
    expect(managerAny.publicSessionIdsByProtocolId.get("ops-3")).toBe("ops-1");

    managerAny.releaseProtocolSession("ops-1");
    expect(managerAny.opsProtocolSessions.has("ops-1")).toBe(false);
    expect(managerAny.publicSessionIdsByProtocolId.has("ops-3")).toBe(false);

    let releaseExistingIdle: (() => void) | null = null;
    managerAny.idleDisconnectPromise = new Promise<void>((resolve) => {
      releaseExistingIdle = resolve;
    });
    const disconnectFn = vi.fn();
    const waitingOnIdle = managerAny.disconnectOpsClientIfIdle();
    expect(disconnectFn).not.toHaveBeenCalled();
    releaseExistingIdle?.();
    await waitingOnIdle;

    let releaseDisconnect: (() => void) | null = null;
    const pendingDisconnect = new Promise<void>((resolve) => {
      releaseDisconnect = resolve;
    });
    disconnectFn.mockImplementation(() => pendingDisconnect);
    managerAny.opsClient = {
      request: vi.fn(),
      disconnect: disconnectFn
    };
    managerAny.idleDisconnectPromise = null;
    managerAny.opsSessions.clear();

    const first = managerAny.disconnectOpsClientIfIdle();
    releaseDisconnect?.();
    await first;

    expect(disconnectFn).toHaveBeenCalledTimes(1);
    expect(managerAny.idleDisconnectPromise).toBeNull();
    expect(managerAny.opsClient).toBeNull();
  });

  it("preserves a replacement idle disconnect promise when an older disconnect settles", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const managerAny = manager as unknown as {
      opsClient: { disconnect?: ReturnType<typeof vi.fn> } | null;
      opsSessions: Set<string>;
      idleDisconnectPromise: Promise<void> | null;
      disconnectOpsClientIfIdle: () => Promise<void>;
    };

    let releaseDisconnect: (() => void) | null = null;
    const disconnect = vi.fn().mockImplementation(() => new Promise<void>((resolve) => {
      releaseDisconnect = resolve;
    }));

    managerAny.opsClient = { disconnect };
    managerAny.opsSessions.clear();

    const pending = managerAny.disconnectOpsClientIfIdle();
    const replacement = Promise.resolve();
    managerAny.idleDisconnectPromise = replacement;

    releaseDisconnect?.();
    await pending;

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(managerAny.idleDisconnectPromise).toBe(replacement);
  });

  it("awaits an existing idle disconnect promise without starting another ops disconnect", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const managerAny = manager as unknown as {
      opsClient: { disconnect?: ReturnType<typeof vi.fn> } | null;
      idleDisconnectPromise: Promise<void> | null;
      disconnectOpsClientIfIdle: () => Promise<void>;
    };

    let releaseExistingIdle: (() => void) | null = null;
    managerAny.idleDisconnectPromise = new Promise<void>((resolve) => {
      releaseExistingIdle = resolve;
    });
    const disconnect = vi.fn();
    managerAny.opsClient = { disconnect };

    const pending = managerAny.disconnectOpsClientIfIdle();
    expect(disconnect).not.toHaveBeenCalled();

    releaseExistingIdle?.();
    await pending;

    expect(disconnect).not.toHaveBeenCalled();
  });

  it("recovers ops sessions with a remembered startUrl when no tabId is available", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const request = vi.fn().mockResolvedValue({
      opsSessionId: "ops-2",
      activeTargetId: null,
      leaseId: "lease-2",
      url: "https://example.com/recovered"
    });
    const managerAny = manager as unknown as {
      opsClient: { request: ReturnType<typeof vi.fn> } | null;
      opsLeases: Map<string, string>;
      opsSessionUrls: Map<string, string>;
      opsSessions: Set<string>;
      recoverOpsSession: (sessionId: string, payload: Record<string, unknown>) => Promise<boolean>;
    };
    managerAny.opsClient = { request };
    managerAny.opsLeases.set("ops-url", "lease-url");
    managerAny.opsSessionUrls.set("ops-url", "https://example.com/recovered");

    await expect(managerAny.recoverOpsSession("ops-url", {})).resolves.toBe(true);

    expect(request).toHaveBeenCalledWith(
      "session.connect",
      expect.objectContaining({
        sessionId: "ops-url",
        startUrl: "https://example.com/recovered"
      }),
      undefined,
      30000,
      "lease-url"
    );
    expect(managerAny.opsSessions.has("ops-url")).toBe(true);
  });

  it("surfaces startUrl reconnect timeouts with stageful details", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const timeoutError = new OpsRequestTimeoutError({
      command: "session.connect",
      timeoutMs: 30000,
      requestId: "ops-starturl-timeout"
    });
    const managerAny = manager as unknown as {
      opsClient: { request: ReturnType<typeof vi.fn> } | null;
      opsLeases: Map<string, string>;
      opsSessionUrls: Map<string, string>;
      recoverOpsSession: (sessionId: string, payload: Record<string, unknown>) => Promise<boolean>;
    };
    managerAny.opsClient = {
      request: vi.fn().mockRejectedValue(timeoutError)
    };
    managerAny.opsLeases.set("ops-starturl", "lease-starturl");
    managerAny.opsSessionUrls.set("ops-starturl", "https://example.com/recover-start");

    const error = await managerAny.recoverOpsSession("ops-starturl", {}).catch((caught) => caught);
    expect(error).toBeInstanceOf(OpsRequestTimeoutError);
    expect(error).toMatchObject({
      details: {
        command: "session.connect",
        requestId: "ops-starturl-timeout",
        stage: "session.connect.startUrl"
      }
    });
  });

  it("rethrows session.connect failures without attempting recovery", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const error = new Error("connect failed");
    const managerAny = manager as unknown as {
      opsClient: { request: ReturnType<typeof vi.fn> } | null;
      opsLeases: Map<string, string>;
      requestOps: (sessionId: string, command: string, payload: Record<string, unknown>) => Promise<unknown>;
      recoverOpsSession: ReturnType<typeof vi.fn>;
    };

    managerAny.opsClient = {
      request: vi.fn().mockRejectedValue(error)
    };
    managerAny.opsLeases.set("ops-connect", "lease-connect");
    managerAny.recoverOpsSession = vi.fn();

    await expect(managerAny.requestOps("ops-connect", "session.connect", {})).rejects.toBe(error);
    expect(managerAny.recoverOpsSession).not.toHaveBeenCalled();
  });

  it("rebuilds the ops client during relay-unavailable request recovery when the socket is gone", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const recoveredClient = {
      request: vi.fn().mockResolvedValue({ activeTargetId: "tab-202", targets: [] })
    };
    const managerAny = manager as unknown as {
      opsClient: { request: ReturnType<typeof vi.fn> } | null;
      opsEndpoint: string | null;
      opsLeases: Map<string, string>;
      requestOps: (sessionId: string, command: string, payload: Record<string, unknown>) => Promise<unknown>;
      waitForRelayExtensionReady: ReturnType<typeof vi.fn>;
      ensureOpsClient: ReturnType<typeof vi.fn>;
      recoverOpsSession: ReturnType<typeof vi.fn>;
    };

    managerAny.opsClient = {
      request: vi.fn().mockImplementation(async () => {
        managerAny.opsClient = null;
        throw new Error("[ops_unavailable] Extension not connected to relay.");
      })
    };
    managerAny.opsEndpoint = "ws://127.0.0.1:8787/ops";
    managerAny.opsLeases.set("ops-retry", "lease-retry");
    managerAny.waitForRelayExtensionReady = vi.fn().mockResolvedValue(true);
    managerAny.ensureOpsClient = vi.fn().mockResolvedValue(recoveredClient);
    managerAny.recoverOpsSession = vi.fn().mockResolvedValue(true);

    await expect(managerAny.requestOps("ops-retry", "targets.list", { includeUrls: true })).resolves.toEqual({
      activeTargetId: "tab-202",
      targets: []
    });
    expect(managerAny.ensureOpsClient).toHaveBeenCalledWith("ws://127.0.0.1:8787/ops");
    expect(managerAny.recoverOpsSession).toHaveBeenCalledWith("ops-retry", { includeUrls: true });
    expect(recoveredClient.request).toHaveBeenCalledWith("targets.list", { includeUrls: true }, "ops-retry", 30000, "lease-retry");
  });

  it.each([
    ["unknown-session", new Error("[invalid_session] Unknown ops session")],
    ["recoverable-timeout", new OpsRequestTimeoutError({
      command: "targets.list",
      timeoutMs: 30000,
      requestId: "ops-timeout-gated",
      opsSessionId: "ops-timeout-proto",
      leaseId: "lease-gated"
    })]
  ])("waits for a healthy relay handshake before recovering %s failures", async (_label, failure) => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const recoveredClient = {
      request: vi.fn().mockResolvedValue({ activeTargetId: "tab-202", targets: [] })
    };
    const steps: string[] = [];
    const managerAny = manager as unknown as {
      opsClient: { request: ReturnType<typeof vi.fn> } | null;
      opsEndpoint: string | null;
      opsLeases: Map<string, string>;
      requestOps: (sessionId: string, command: string, payload: Record<string, unknown>) => Promise<unknown>;
      waitForRelayExtensionReady: ReturnType<typeof vi.fn>;
      ensureOpsClient: ReturnType<typeof vi.fn>;
      recoverOpsSession: ReturnType<typeof vi.fn>;
    };

    managerAny.opsClient = {
      request: vi.fn().mockRejectedValue(failure)
    };
    managerAny.opsEndpoint = "ws://127.0.0.1:8787/ops";
    managerAny.opsLeases.set("ops-handshake-gated", "lease-gated");
    managerAny.waitForRelayExtensionReady = vi.fn().mockImplementation(async () => {
      steps.push("wait");
      return true;
    });
    managerAny.ensureOpsClient = vi.fn().mockResolvedValue(recoveredClient);
    managerAny.recoverOpsSession = vi.fn().mockImplementation(async () => {
      steps.push("recover");
      managerAny.opsClient = recoveredClient;
      return true;
    });

    await expect(managerAny.requestOps("ops-handshake-gated", "targets.list", { includeUrls: true })).resolves.toEqual({
      activeTargetId: "tab-202",
      targets: []
    });

    expect(managerAny.waitForRelayExtensionReady).toHaveBeenCalledTimes(1);
    expect(managerAny.ensureOpsClient).not.toHaveBeenCalled();
    expect(managerAny.recoverOpsSession).toHaveBeenCalledWith("ops-handshake-gated", { includeUrls: true });
    expect(steps).toEqual(["wait", "recover"]);
    expect(recoveredClient.request).toHaveBeenCalledWith(
      "targets.list",
      { includeUrls: true },
      "ops-handshake-gated",
      30000,
      "lease-gated"
    );
  });

  it("rethrows unknown-session errors when relay handshake never becomes healthy during recovery", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const error = new Error("[invalid_session] Unknown ops session");
    const managerAny = manager as unknown as {
      opsClient: { request: ReturnType<typeof vi.fn> } | null;
      opsEndpoint: string | null;
      opsLeases: Map<string, string>;
      requestOps: (sessionId: string, command: string, payload: Record<string, unknown>) => Promise<unknown>;
      waitForRelayExtensionReady: ReturnType<typeof vi.fn>;
      ensureOpsClient: ReturnType<typeof vi.fn>;
      recoverOpsSession: ReturnType<typeof vi.fn>;
    };

    managerAny.opsClient = {
      request: vi.fn().mockRejectedValue(error)
    };
    managerAny.opsEndpoint = "ws://127.0.0.1:8787/ops";
    managerAny.opsLeases.set("ops-unhealthy-handshake", "lease-unhealthy-handshake");
    managerAny.waitForRelayExtensionReady = vi.fn().mockResolvedValue(false);
    managerAny.ensureOpsClient = vi.fn();
    managerAny.recoverOpsSession = vi.fn();

    await expect(managerAny.requestOps("ops-unhealthy-handshake", "targets.list", { includeUrls: true })).rejects.toBe(error);
    expect(managerAny.waitForRelayExtensionReady).toHaveBeenCalledTimes(1);
    expect(managerAny.ensureOpsClient).not.toHaveBeenCalled();
    expect(managerAny.recoverOpsSession).not.toHaveBeenCalled();
  });

  it("rethrows unknown-session errors when request recovery cannot restore the session", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const error = new Error("[invalid_session] Unknown ops session");
    const managerAny = manager as unknown as {
      opsClient: { request: ReturnType<typeof vi.fn> } | null;
      opsLeases: Map<string, string>;
      requestOps: (sessionId: string, command: string, payload: Record<string, unknown>) => Promise<unknown>;
      recoverOpsSession: ReturnType<typeof vi.fn>;
    };

    managerAny.opsClient = {
      request: vi.fn().mockRejectedValue(error)
    };
    managerAny.opsLeases.set("ops-unrecovered", "lease-unrecovered");
    managerAny.recoverOpsSession = vi.fn().mockResolvedValue(false);

    await expect(managerAny.requestOps("ops-unrecovered", "targets.list", { includeUrls: true })).rejects.toBe(error);
    expect(managerAny.recoverOpsSession).toHaveBeenCalledWith("ops-unrecovered", { includeUrls: true });
  });

  it("rethrows the original error when recovery succeeds without a replacement client", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const error = new Error("[invalid_session] Unknown ops session");
    const managerAny = manager as unknown as {
      opsClient: { request: ReturnType<typeof vi.fn> } | null;
      opsLeases: Map<string, string>;
      requestOps: (sessionId: string, command: string, payload: Record<string, unknown>) => Promise<unknown>;
      recoverOpsSession: ReturnType<typeof vi.fn>;
    };

    managerAny.opsClient = {
      request: vi.fn().mockRejectedValue(error)
    };
    managerAny.opsLeases.set("ops-client-missing", "lease-client-missing");
    managerAny.recoverOpsSession = vi.fn().mockImplementation(async () => {
      managerAny.opsClient = null;
      return true;
    });

    await expect(managerAny.requestOps("ops-client-missing", "targets.list", { includeUrls: true })).rejects.toBe(error);
  });

  it("retries timed-out ops requests after recovering the session", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const timeoutError = new OpsRequestTimeoutError({
      command: "targets.list",
      timeoutMs: 30000,
      requestId: "ops-timeout-request",
      opsSessionId: "ops-timeout-proto",
      leaseId: "lease-timeout"
    });
    const recoveredClient = {
      request: vi.fn().mockResolvedValue({ activeTargetId: "tab-202", targets: [] })
    };
    const managerAny = manager as unknown as {
      opsClient: { request: ReturnType<typeof vi.fn> } | null;
      opsLeases: Map<string, string>;
      requestOps: (sessionId: string, command: string, payload: Record<string, unknown>) => Promise<unknown>;
      recoverOpsSession: ReturnType<typeof vi.fn>;
    };

    managerAny.opsClient = {
      request: vi.fn().mockRejectedValue(timeoutError)
    };
    managerAny.opsLeases.set("ops-timeout-recover", "lease-timeout");
    managerAny.recoverOpsSession = vi.fn().mockImplementation(async () => {
      managerAny.opsClient = recoveredClient;
      return true;
    });

    await expect(managerAny.requestOps("ops-timeout-recover", "targets.list", { includeUrls: true })).resolves.toEqual({
      activeTargetId: "tab-202",
      targets: []
    });
    expect(managerAny.recoverOpsSession).toHaveBeenCalledWith("ops-timeout-recover", { includeUrls: true });
    expect(recoveredClient.request).toHaveBeenCalledWith(
      "targets.list",
      { includeUrls: true },
      "ops-timeout-recover",
      30000,
      "lease-timeout"
    );
  });

  it("keeps an ops click pending while dialog status and accept complete without reconnecting", async () => {
    requestMock.mockResolvedValueOnce({
      opsSessionId: "ops-dialog-handoff",
      activeTargetId: "tab-101",
      leaseId: "lease-dialog-handoff"
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ relayPort: 8787, pairingRequired: false, instanceId: "relay-1", epoch: 1 })
    }));

    const manager = new OpsBrowserManager({ connectRelay: vi.fn() } as never, makeConfig());
    const connected = await manager.connectRelay("ws://127.0.0.1:8787/ops");

    requestMock.mockReset();

    let resolveClick: ((value: { timingMs: number; navigated: boolean }) => void) | null = null;
    const clickResult = new Promise<{ timingMs: number; navigated: boolean }>((resolve) => {
      resolveClick = resolve;
    });
    requestMock.mockImplementation(async (...args: unknown[]) => {
      const command = args[0] as string;
      const payload = args[1] as Record<string, unknown>;
      if (command === "interact.click") {
        return await clickResult;
      }
      if (command === "page.dialog" && payload.action === "status") {
        return {
          dialog: {
            open: true,
            type: "alert",
            message: "I am a JS Alert"
          }
        };
      }
      if (command === "page.dialog" && payload.action === "accept") {
        resolveClick?.({ timingMs: 11822, navigated: false });
        return {
          dialog: { open: false },
          handled: true
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const clickPromise = manager.click(connected.sessionId, "r2", "tab-101");
    await Promise.resolve();

    await expect(manager.dialog(connected.sessionId, {
      targetId: "tab-101",
      action: "status"
    })).resolves.toEqual({
      dialog: {
        open: true,
        type: "alert",
        message: "I am a JS Alert"
      }
    });
    await expect(manager.dialog(connected.sessionId, {
      targetId: "tab-101",
      action: "accept"
    })).resolves.toEqual({
      dialog: { open: false },
      handled: true
    });
    await expect(clickPromise).resolves.toEqual({ timingMs: 11822, navigated: false });

    expect(requestMock.mock.calls.filter(([command]) => command === "interact.click")).toHaveLength(1);
    expect(requestMock.mock.calls.filter(([command]) => command === "page.dialog")).toHaveLength(2);
    expect(requestMock.mock.calls.filter(([command]) => command === "session.connect")).toHaveLength(0);
  });

  it("uses a click-specific ops request timeout budget", async () => {
    requestMock.mockResolvedValueOnce({
      opsSessionId: "ops-click-timeout-budget",
      activeTargetId: "tab-101",
      leaseId: "lease-click-timeout-budget"
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ relayPort: 8787, pairingRequired: false, instanceId: "relay-1", epoch: 1 })
    }));

    const manager = new OpsBrowserManager({ connectRelay: vi.fn() } as never, makeConfig());
    const connected = await manager.connectRelay("ws://127.0.0.1:8787/ops");

    requestMock.mockReset();
    requestMock.mockResolvedValue({ timingMs: 11822, navigated: false });

    await expect(manager.click(connected.sessionId, "r2", "tab-101")).resolves.toEqual({
      timingMs: 11822,
      navigated: false
    });

    expect(requestMock).toHaveBeenCalledWith(
      "interact.click",
      {
        targetId: "tab-101",
        ref: "r2"
      },
      connected.sessionId,
      expect.any(Number),
      "lease-click-timeout-budget"
    );
    expect((requestMock.mock.calls[0] ?? [])[3]).toBeGreaterThan(30000);
  });

  it.each([
    ["interact.click", { ref: "r2" }],
    ["page.dialog", { action: "accept" }]
  ])("rethrows timed-out %s commands without attempting recovery", async (command, payload) => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const timeoutError = new OpsRequestTimeoutError({
      command,
      timeoutMs: 30000,
      requestId: `${command}-timeout`,
      opsSessionId: "ops-timeout-no-recover",
      leaseId: "lease-timeout-no-recover"
    });
    const managerAny = manager as unknown as {
      opsClient: { request: ReturnType<typeof vi.fn> } | null;
      opsLeases: Map<string, string>;
      requestOps: (sessionId: string, command: string, payload: Record<string, unknown>) => Promise<unknown>;
      recoverOpsSession: ReturnType<typeof vi.fn>;
    };

    managerAny.opsClient = {
      request: vi.fn().mockRejectedValue(timeoutError)
    };
    managerAny.opsLeases.set("ops-timeout-no-recover", "lease-timeout-no-recover");
    managerAny.recoverOpsSession = vi.fn().mockResolvedValue(true);

    await expect(managerAny.requestOps("ops-timeout-no-recover", command, payload)).rejects.toBe(timeoutError);
    expect(managerAny.recoverOpsSession).not.toHaveBeenCalled();
    expect(managerAny.opsClient.request).toHaveBeenCalledTimes(1);
  });

  it("returns deferred challenge guidance when manager suppression is active", async () => {
    const base = { setChallengeOrchestrator: vi.fn() };
    const manager = new OpsBrowserManager(base as never, makeConfig());
    const orchestrate = vi.fn();
    manager.setChallengeOrchestrator({ orchestrate } as never);
    const managerAny = manager as unknown as {
      challengeAutomationSuppression: Map<string, number>;
      maybeOrchestrateChallenge: (
        sessionId: string,
        targetId: string | null | undefined,
        result: Record<string, unknown> & { meta?: Record<string, unknown> }
      ) => Promise<Record<string, unknown> & { meta?: Record<string, unknown> }>;
    };
    managerAny.challengeAutomationSuppression.set("ops-suppressed", 1);

    const result = await managerAny.maybeOrchestrateChallenge("ops-suppressed", "tab-1", {
      ok: true,
      meta: {
        blockerState: "blocked",
        blocker: { type: "auth_required" },
        challenge: { challengeId: "challenge-suppressed" }
      }
    });

    expect(orchestrate).not.toHaveBeenCalled();
    expect(result.meta).toMatchObject({
      challengeOrchestration: {
        status: "deferred",
        standDownReason: "suppressed_by_manager",
        helperEligibility: {
          allowed: false,
          standDownReason: "suppressed_by_manager"
        }
      }
    });
  });

  it("restores nested challenge suppression counts after wrapped actions complete", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const managerAny = manager as unknown as {
      challengeAutomationSuppression: Map<string, number>;
      withChallengeAutomationSuppressed: <T>(sessionId: string, action: () => Promise<T>) => Promise<T>;
    };
    managerAny.challengeAutomationSuppression.set("ops-nested", 1);

    await expect(
      managerAny.withChallengeAutomationSuppressed("ops-nested", async () => {
        expect(managerAny.challengeAutomationSuppression.get("ops-nested")).toBe(2);
        return "ok";
      })
    ).resolves.toBe("ok");

    expect(managerAny.challengeAutomationSuppression.get("ops-nested")).toBe(1);
  });

  it("tolerates suppression bookkeeping disappearing during wrapped actions", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const managerAny = manager as unknown as {
      challengeAutomationSuppression: Map<string, number>;
      withChallengeAutomationSuppressed: <T>(sessionId: string, action: () => Promise<T>) => Promise<T>;
    };
    managerAny.challengeAutomationSuppression.set("ops-missing", 1);

    await expect(
      managerAny.withChallengeAutomationSuppressed("ops-missing", async () => {
        managerAny.challengeAutomationSuppression.delete("ops-missing");
        return "ok";
      })
    ).resolves.toBe("ok");

    expect(managerAny.challengeAutomationSuppression.has("ops-missing")).toBe(false);
  });

  it("classifies suppressed non-auth challenges as unsupported third-party work", async () => {
    const base = { setChallengeOrchestrator: vi.fn() };
    const manager = new OpsBrowserManager(base as never, makeConfig());
    const orchestrate = vi.fn();
    manager.setChallengeOrchestrator({ orchestrate } as never);
    const managerAny = manager as unknown as {
      challengeAutomationSuppression: Map<string, number>;
      maybeOrchestrateChallenge: (
        sessionId: string,
        targetId: string | null | undefined,
        result: Record<string, unknown> & { meta?: Record<string, unknown> }
      ) => Promise<Record<string, unknown> & { meta?: Record<string, unknown> }>;
    };
    managerAny.challengeAutomationSuppression.set("ops-third-party", 1);

    const result = await managerAny.maybeOrchestrateChallenge("ops-third-party", "tab-1", {
      ok: true,
      meta: {
        blockerState: "blocked",
        blocker: { type: "challenge_detected" },
        challenge: { challengeId: "challenge-third-party" }
      }
    });

    expect(orchestrate).not.toHaveBeenCalled();
    expect(result.meta).toMatchObject({
      challengeOrchestration: {
        classification: "unsupported_third_party_challenge",
        status: "deferred",
        standDownReason: "suppressed_by_manager"
      }
    });
  });

  it("returns blocked challenge results unchanged when no orchestrator is configured", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const managerAny = manager as unknown as {
      maybeOrchestrateChallenge: (
        sessionId: string,
        targetId: string | null | undefined,
        result: Record<string, unknown> & { meta?: Record<string, unknown> }
      ) => Promise<Record<string, unknown> & { meta?: Record<string, unknown> }>;
    };
    const original = {
      ok: true,
      meta: {
        blockerState: "blocked",
        blocker: { type: "auth_required" },
        challenge: { challengeId: "challenge-no-orchestrator" }
      }
    };

    await expect(managerAny.maybeOrchestrateChallenge("ops-no-orchestrator", "tab-1", original)).resolves.toEqual(original);
  });

  it("returns the original challenge result when orchestration throws", async () => {
    const base = { setChallengeOrchestrator: vi.fn() };
    const manager = new OpsBrowserManager(base as never, makeConfig());
    const orchestrate = vi.fn().mockRejectedValue(new Error("challenge failed"));
    manager.setChallengeOrchestrator({ orchestrate } as never);
    const managerAny = manager as unknown as {
      maybeOrchestrateChallenge: (
        sessionId: string,
        targetId: string | null | undefined,
        result: Record<string, unknown> & { meta?: Record<string, unknown> }
      ) => Promise<Record<string, unknown> & { meta?: Record<string, unknown> }>;
    };
    const original = {
      ok: true,
      meta: {
        blockerState: "blocked",
        blocker: { type: "auth_required" },
        challenge: { challengeId: "challenge-failed" }
      }
    };

    await expect(managerAny.maybeOrchestrateChallenge("ops-challenge-error", "tab-1", original)).resolves.toEqual(original);
    expect(orchestrate).toHaveBeenCalledTimes(1);
  });

  it("falls back to the existing lease when recovered sessions do not return a replacement", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const error = new Error("[invalid_session] Unknown ops session");
    const recoveredClient = {
      request: vi.fn().mockResolvedValue({ activeTargetId: "tab-202", targets: [] })
    };
    const managerAny = manager as unknown as {
      opsClient: { request: ReturnType<typeof vi.fn> } | null;
      opsLeases: Map<string, string>;
      requestOps: (sessionId: string, command: string, payload: Record<string, unknown>) => Promise<unknown>;
      recoverOpsSession: ReturnType<typeof vi.fn>;
    };

    managerAny.opsClient = {
      request: vi.fn().mockRejectedValue(error)
    };
    managerAny.opsLeases.set("ops-lease-fallback", "lease-existing");
    managerAny.recoverOpsSession = vi.fn().mockImplementation(async () => {
      managerAny.opsClient = recoveredClient;
      managerAny.opsLeases.delete("ops-lease-fallback");
      return true;
    });

    await expect(managerAny.requestOps("ops-lease-fallback", "targets.list", { includeUrls: true })).resolves.toEqual({
      activeTargetId: "tab-202",
      targets: []
    });
    expect(recoveredClient.request).toHaveBeenCalledWith(
      "targets.list",
      { includeUrls: true },
      "ops-lease-fallback",
      30000,
      "lease-existing"
    );
  });

  it("fails reconnectOpsClient when relay readiness or session recovery cannot be restored", async () => {
    const notReadyManager = new OpsBrowserManager({} as never, makeConfig());
    const notReadyAny = notReadyManager as unknown as {
      opsEndpoint: string | null;
      reconnectOpsClient: (sessionId: string, payload: Record<string, unknown>) => Promise<unknown>;
      waitForRelayExtensionReady: ReturnType<typeof vi.fn>;
    };
    notReadyAny.opsEndpoint = "ws://127.0.0.1:8787/ops";
    notReadyAny.waitForRelayExtensionReady = vi.fn().mockResolvedValue(false);

    await expect(notReadyAny.reconnectOpsClient("ops-reconnect", {})).rejects.toThrow("Ops client not connected");

    const unrecoveredManager = new OpsBrowserManager({} as never, makeConfig());
    const unrecoveredAny = unrecoveredManager as unknown as {
      opsEndpoint: string | null;
      reconnectOpsClient: (sessionId: string, payload: Record<string, unknown>) => Promise<unknown>;
      waitForRelayExtensionReady: ReturnType<typeof vi.fn>;
      ensureOpsClient: ReturnType<typeof vi.fn>;
      recoverOpsSession: ReturnType<typeof vi.fn>;
    };
    unrecoveredAny.opsEndpoint = "ws://127.0.0.1:8787/ops";
    unrecoveredAny.waitForRelayExtensionReady = vi.fn().mockResolvedValue(true);
    unrecoveredAny.ensureOpsClient = vi.fn().mockResolvedValue({ request: vi.fn() });
    unrecoveredAny.recoverOpsSession = vi.fn().mockResolvedValue(false);

    await expect(unrecoveredAny.reconnectOpsClient("ops-reconnect", { includeUrls: true })).rejects.toThrow("Ops client not connected");
    expect(unrecoveredAny.ensureOpsClient).toHaveBeenCalledWith("ws://127.0.0.1:8787/ops");
    expect(unrecoveredAny.recoverOpsSession).toHaveBeenCalledWith("ops-reconnect", { includeUrls: true });
  });

  it("covers relay readiness probes for missing endpoints, invalid urls, auth headers, and incomplete handshakes", async () => {
    const missingManager = new OpsBrowserManager({} as never, makeConfig());
    const missingAny = missingManager as unknown as {
      opsEndpoint: string | null;
      waitForRelayExtensionReady: (timeoutMs?: number) => Promise<boolean>;
    };
    missingAny.opsEndpoint = null;
    await expect(missingAny.waitForRelayExtensionReady(1)).resolves.toBe(false);

    const invalidManager = new OpsBrowserManager({} as never, makeConfig());
    const invalidAny = invalidManager as unknown as {
      opsEndpoint: string | null;
      waitForRelayExtensionReady: (timeoutMs?: number) => Promise<boolean>;
    };
    invalidAny.opsEndpoint = "not a websocket url";
    await expect(invalidAny.waitForRelayExtensionReady(1)).resolves.toBe(false);

    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          extensionConnected: true,
          extensionHandshakeComplete: false
        })
      });
      vi.stubGlobal("fetch", fetchMock);

      const manager = new OpsBrowserManager({} as never, {
        ...makeConfig(),
        relayToken: " relay-secret "
      });
      const managerAny = manager as unknown as {
        opsEndpoint: string | null;
        waitForRelayExtensionReady: (timeoutMs?: number) => Promise<boolean>;
      };
      managerAny.opsEndpoint = "wss://example.com:9443/ops";

      const readinessPromise = managerAny.waitForRelayExtensionReady(1);
      await vi.advanceTimersByTimeAsync(250);
      await expect(readinessPromise).resolves.toBe(false);
      expect(fetchMock).toHaveBeenCalledWith("https://example.com:9443/status", {
        headers: {
          Accept: "application/json",
          Authorization: "Bearer relay-secret"
        }
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats non-ok relay readiness responses as not ready", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({})
      });
      vi.stubGlobal("fetch", fetchMock);

      const manager = new OpsBrowserManager({} as never, makeConfig());
      const managerAny = manager as unknown as {
        opsEndpoint: string | null;
        waitForRelayExtensionReady: (timeoutMs?: number) => Promise<boolean>;
      };
      managerAny.opsEndpoint = "wss://example.com:9443/ops";

      const readinessPromise = managerAny.waitForRelayExtensionReady(1);
      await vi.advanceTimersByTimeAsync(250);
      await expect(readinessPromise).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
