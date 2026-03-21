import { describe, it, expect, vi, afterEach } from "vitest";
import type { OpenDevBrowserConfig } from "../src/config";
import { OpsBrowserManager } from "../src/browser/ops-browser-manager";

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

vi.mock("fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined)
}));

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

vi.mock("../src/browser/ops-client", () => ({
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
}));

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
    await manager.clonePage("base-session");
    await manager.cloneComponent("base-session", "ref-1");
    await manager.perfMetrics("base-session");
    await manager.screenshot("base-session", "/tmp/base.png");
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
      json: async () => ({ relayPort: 8787, pairingRequired: false, instanceId: "relay-1", epoch: 1 })
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
      json: async () => ({ relayPort: 8787, pairingRequired: false, instanceId: "relay-1", epoch: 1 })
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
      json: async () => ({ relayPort: 8787, pairingRequired: false, instanceId: "relay-1", epoch: 1 })
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
      json: async () => ({ relayPort: 8787, pairingRequired: false, instanceId: "relay-1", epoch: 1 })
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

  it("normalizes secure relay status URLs and rejects invalid websocket endpoints", () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const managerAny = manager as unknown as {
      buildRelayStatusUrl: (wsEndpoint: string) => URL | null;
    };

    expect(managerAny.buildRelayStatusUrl("wss://example.com:9443/ops")?.toString()).toBe("https://example.com:9443/status");
    expect(managerAny.buildRelayStatusUrl("not a websocket url")).toBeNull();
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
    await manager.screenshot("ops-2", "/tmp/ops-screenshot.png");
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

    const result = await manager.screenshot("ops-10", "/tmp/ops-warning.png");
    expect(result).toEqual({
      path: "/tmp/ops-warning.png",
      warnings: ["visible_only_fallback"]
    });
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
});
