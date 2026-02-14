import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenDevBrowserConfig } from "../src/config";
import type { OpenDevBrowserCore } from "../src/core";
import { handleDaemonCommand } from "../src/cli/daemon-commands";
import { bindRelay, clearBinding, clearSessionLeases, getBindingState, registerSessionLease, releaseRelay, waitForBinding } from "../src/cli/daemon-state";

type RelayStatus = {
  running: boolean;
  port?: number;
  extensionConnected: boolean;
  extensionHandshakeComplete: boolean;
  cdpConnected: boolean;
  annotationConnected: boolean;
  opsConnected: boolean;
  pairingRequired: boolean;
  instanceId: string;
};

const makeConfig = (overrides: Partial<OpenDevBrowserConfig> = {}): OpenDevBrowserConfig => ({
  headless: true,
  profile: "default",
  snapshot: { maxChars: 16000, maxNodes: 1000 },
  security: { allowRawCDP: false, allowNonLocalCdp: false, allowUnsafeExport: false },
  blockerDetectionThreshold: 0.7,
  blockerResolutionTimeoutMs: 600000,
  blockerArtifactCaps: {
    maxNetworkEvents: 20,
    maxConsoleEvents: 20,
    maxExceptionEvents: 10,
    maxHosts: 10,
    maxTextLength: 512
  },
  devtools: { showFullUrls: false, showFullConsole: false },
  export: { maxNodes: 1000, inlineStyles: true },
  skills: { nudge: { enabled: true, keywords: [], maxAgeMs: 60000 } },
  continuity: { enabled: true, filePath: "/tmp/continuity.md", nudge: { enabled: true, keywords: [], maxAgeMs: 60000 } },
  relayPort: 8787,
  relayToken: false,
  daemonPort: 8788,
  daemonToken: "daemon-token",
  flags: [],
  checkForUpdates: false,
  persistProfile: true,
  skillPaths: [],
  ...overrides
});

const makeCore = (overrides: {
  config?: Partial<OpenDevBrowserConfig>;
  relayStatus?: Partial<RelayStatus>;
} = {}): OpenDevBrowserCore => {
  const relayStatus: RelayStatus = {
    running: false,
    extensionConnected: false,
    extensionHandshakeComplete: false,
    cdpConnected: false,
    annotationConnected: false,
    opsConnected: false,
    pairingRequired: false,
    instanceId: "relay-test",
    ...overrides.relayStatus
  };

  const manager = {
    status: vi.fn(),
    goto: vi.fn(),
    waitForLoad: vi.fn(),
    waitForRef: vi.fn(),
    consolePoll: vi.fn(),
    networkPoll: vi.fn(),
    withPage: vi.fn(async (_sessionId: string, _targetId: string | null, fn: (page: { context: () => { addCookies: (cookies: unknown[]) => Promise<void> } }) => Promise<unknown>) => {
      const addCookies = vi.fn(async () => undefined);
      return fn({
        context: () => ({ addCookies })
      });
    }),
    listTargets: vi.fn(),
    disconnect: vi.fn(),
    connectRelay: vi.fn(),
    connect: vi.fn(),
    debugTraceSnapshot: vi.fn(),
    cookieImport: vi.fn()
  };

  const relay = {
    status: vi.fn(() => relayStatus),
    getCdpUrl: vi.fn(() => null),
    getOpsUrl: vi.fn(() => null)
  };

  const annotationManager = {
    requestAnnotation: vi.fn()
  };

  return {
    manager,
    relay,
    annotationManager,
    config: makeConfig(overrides.config)
  } as unknown as OpenDevBrowserCore;
};

describe("daemon-commands integration", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      return {
        status: 200,
        url,
        text: async () => `<html><body><main>daemon content ${url}</main><a href="https://example.com/result">result</a></body></html>`,
        json: async () => ({})
      };
    }) as unknown as typeof fetch);
    clearBinding();
    clearSessionLeases();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearBinding();
    clearSessionLeases();
    vi.restoreAllMocks();
  });

  it("allows implicit lease for owner and rejects mismatched lease/client", async () => {
    const core = makeCore();
    core.manager.status.mockResolvedValue({ mode: "extension", activeTargetId: null });
    core.manager.listTargets.mockResolvedValue({ activeTargetId: null, targets: [] });
    registerSessionLease("session-1", "lease-1", "client-1");

    const implicitLeaseResponse = await handleDaemonCommand(core, {
      name: "targets.list",
      params: { sessionId: "session-1", clientId: "client-1" }
    });
    expect(implicitLeaseResponse).toEqual({ activeTargetId: null, targets: [] });

    await expect(handleDaemonCommand(core, {
      name: "targets.list",
      params: { sessionId: "session-1", clientId: "client-2" }
    })).rejects.toThrow("RELAY_LEASE_INVALID");

    await expect(handleDaemonCommand(core, {
      name: "targets.list",
      params: { sessionId: "session-1", clientId: "client-1", leaseId: "lease-wrong" }
    })).rejects.toThrow("RELAY_LEASE_INVALID");

    const explicitLeaseResponse = await handleDaemonCommand(core, {
      name: "targets.list",
      params: { sessionId: "session-1", clientId: "client-1", leaseId: "lease-1" }
    });

    expect(explicitLeaseResponse).toEqual({ activeTargetId: null, targets: [] });
  });

  it("requires binding for annotate when extension mode", async () => {
    const core = makeCore();
    core.manager.status.mockResolvedValue({ mode: "extension", activeTargetId: null });

    await expect(handleDaemonCommand(core, {
      name: "annotate",
      params: { sessionId: "session-1", clientId: "client-1" }
    })).rejects.toThrow("RELAY_BINDING_REQUIRED");
  });

  it("returns annotate response when lease owner invokes extension annotate", async () => {
    const core = makeCore();
    core.manager.status.mockResolvedValue({ mode: "extension", activeTargetId: null });
    core.annotationManager.requestAnnotation.mockResolvedValue({
      version: 1,
      requestId: "req-annotate",
      status: "ok",
      payload: { url: "https://example.com", timestamp: "2026-01-31T00:00:00Z", screenshotMode: "visible", screenshots: [], annotations: [] }
    });
    registerSessionLease("session-1", "lease-1", "client-1");

    const response = await handleDaemonCommand(core, {
      name: "annotate",
      params: {
        sessionId: "session-1",
        clientId: "client-1",
        url: "https://example.com",
        screenshotMode: "full",
        debug: true,
        context: "Review",
        timeoutMs: 5000
      }
    });

    expect(response).toEqual({
      version: 1,
      requestId: "req-annotate",
      status: "ok",
      payload: { url: "https://example.com", timestamp: "2026-01-31T00:00:00Z", screenshotMode: "visible", screenshots: [], annotations: [] }
    });
    expect(core.annotationManager.requestAnnotation).toHaveBeenCalledWith({
      sessionId: "session-1",
      transport: "auto",
      targetId: undefined,
      tabId: undefined,
      url: "https://example.com",
      screenshotMode: "full",
      debug: true,
      context: "Review",
      timeoutMs: 5000
    });
  });

  it("rejects annotate when lease owner does not match client", async () => {
    const core = makeCore();
    core.manager.status.mockResolvedValue({ mode: "extension", activeTargetId: null });
    registerSessionLease("session-1", "lease-1", "client-1");

    await expect(handleDaemonCommand(core, {
      name: "annotate",
      params: {
        sessionId: "session-1",
        clientId: "client-2",
        transport: "relay"
      }
    })).rejects.toThrow("RELAY_LEASE_INVALID");
  });

  it("allows direct annotate without binding on managed sessions", async () => {
    const core = makeCore();
    core.manager.status.mockResolvedValue({ mode: "managed", activeTargetId: null });
    core.annotationManager.requestAnnotation.mockResolvedValue({
      version: 1,
      requestId: "req-direct",
      status: "ok",
      payload: { url: "https://example.com", timestamp: "2026-01-31T00:00:00Z", screenshotMode: "visible", screenshots: [], annotations: [] }
    });

    const response = await handleDaemonCommand(core, {
      name: "annotate",
      params: {
        sessionId: "session-1",
        clientId: "client-1",
        transport: "direct"
      }
    });

    expect(response).toEqual({
      version: 1,
      requestId: "req-direct",
      status: "ok",
      payload: { url: "https://example.com", timestamp: "2026-01-31T00:00:00Z", screenshotMode: "visible", screenshots: [], annotations: [] }
    });
    expect(core.annotationManager.requestAnnotation).toHaveBeenCalledWith({
      sessionId: "session-1",
      transport: "direct",
      targetId: undefined,
      tabId: undefined,
      url: undefined,
      screenshotMode: "visible",
      debug: false,
      context: undefined,
      timeoutMs: undefined
    });
  });

  it("rejects relay annotate on managed sessions", async () => {
    const core = makeCore();
    core.manager.status.mockResolvedValue({ mode: "managed", activeTargetId: null });

    await expect(handleDaemonCommand(core, {
      name: "annotate",
      params: {
        sessionId: "session-1",
        clientId: "client-1",
        transport: "relay"
      }
    })).rejects.toThrow("Relay annotations require extension mode.");
  });

  it("allows extension disconnect for implicit lease owner and rejects mismatches", async () => {
    const core = makeCore();
    core.manager.status.mockResolvedValue({ mode: "extension", activeTargetId: null });
    core.manager.disconnect.mockResolvedValue(undefined);

    registerSessionLease("session-1", "lease-1", "client-1");
    const response = await handleDaemonCommand(core, {
      name: "session.disconnect",
      params: { sessionId: "session-1", clientId: "client-1" }
    });

    expect(response).toEqual({ ok: true });
    expect(getBindingState()).toBeNull();

    registerSessionLease("session-2", "lease-2", "client-1");
    await expect(handleDaemonCommand(core, {
      name: "session.disconnect",
      params: { sessionId: "session-2", clientId: "client-2" }
    })).rejects.toThrow("RELAY_LEASE_INVALID");
  });

  it("includes hub + relay identifiers in relay.bind response", async () => {
    const core = makeCore();
    const response = await handleDaemonCommand(core, {
      name: "relay.bind",
      params: { clientId: "client-1" }
    }) as { hubInstanceId: string; relayInstanceId: string; bindingConfig?: unknown };

    expect(response.hubInstanceId).toEqual(expect.any(String));
    expect(response.relayInstanceId).toBe("relay-test");
    expect(response.bindingConfig).toEqual(expect.objectContaining({
      ttlMs: expect.any(Number),
      renewIntervalMs: expect.any(Number),
      graceMs: expect.any(Number)
    }));
  });

  it("rejects invalid numeric params", async () => {
    const core = makeCore();
    await expect(handleDaemonCommand(core, {
      name: "relay.wait",
      params: { clientId: "client-1", timeoutMs: "nope" }
    })).rejects.toThrow("Invalid timeoutMs");
  });

  it("queues relay bindings in FIFO order", async () => {
    const first = bindRelay("client-1");
    const queued = bindRelay("client-2");
    expect("queued" in queued && queued.queued).toBe(true);

    const released = releaseRelay("client-1", first.bindingId);
    expect(released).toEqual({ released: true });

    const binding = await waitForBinding("client-2", 1000);
    expect(binding.bindingId).toEqual(expect.any(String));
  });

  it("returns relay status and cdp url", async () => {
    const core = makeCore({
      relayStatus: {
        running: true,
        port: 8787,
        extensionConnected: true,
        extensionHandshakeComplete: true,
        cdpConnected: false,
        annotationConnected: false,
        opsConnected: false,
        pairingRequired: true,
        instanceId: "relay-status"
      }
    });
    core.relay.getCdpUrl = vi.fn(() => "ws://127.0.0.1:8787/cdp");

    const status = await handleDaemonCommand(core, { name: "relay.status" }) as RelayStatus;
    expect(status.instanceId).toBe("relay-status");

    const cdpUrl = await handleDaemonCommand(core, { name: "relay.cdpUrl" });
    expect(cdpUrl).toBe("ws://127.0.0.1:8787/cdp");
  });

  it("routes extension legacy connect on local base endpoint to /cdp", async () => {
    const core = makeCore();
    core.manager.connectRelay.mockResolvedValue({
      sessionId: "session-legacy",
      mode: "extension",
      activeTargetId: "target-1",
      warnings: [],
      wsEndpoint: "ws://127.0.0.1:8787/cdp"
    });
    const binding = bindRelay("client-legacy");
    if ("queued" in binding && binding.queued) {
      throw new Error("Expected immediate binding for test setup.");
    }

    const response = await handleDaemonCommand(core, {
      name: "session.connect",
      params: {
        clientId: "client-legacy",
        bindingId: binding.bindingId,
        wsEndpoint: "ws://127.0.0.1:8787",
        extensionLegacy: true
      }
    });

    expect(core.manager.connectRelay).toHaveBeenCalledWith("ws://127.0.0.1:8787/cdp");
    expect(response).toEqual(expect.objectContaining({
      sessionId: "session-legacy",
      mode: "extension"
    }));
  });

  it("routes debug trace snapshot to manager capability when available", async () => {
    const core = makeCore();
    core.manager.status.mockResolvedValue({ mode: "managed", activeTargetId: "target-1", url: "https://example.com", title: "Example" });
    core.manager.debugTraceSnapshot.mockResolvedValue({
      requestId: "req-debug",
      generatedAt: "2026-02-01T00:00:00.000Z",
      page: { mode: "managed", activeTargetId: "target-1", url: "https://example.com", title: "Example" },
      channels: {
        console: { events: [], nextSeq: 0 },
        network: { events: [], nextSeq: 0 },
        exception: { events: [], nextSeq: 0 }
      }
    });

    const response = await handleDaemonCommand(core, {
      name: "devtools.debugTraceSnapshot",
      params: { sessionId: "session-1", clientId: "client-1", max: 10 }
    });

    expect(response).toEqual(expect.objectContaining({ requestId: "req-debug" }));
    expect(core.manager.debugTraceSnapshot).toHaveBeenCalledWith("session-1", expect.objectContaining({ max: 10 }));
  });

  it("adds blocker metadata on daemon nav.goto responses when manager response has no blocker meta", async () => {
    const core = makeCore();
    core.manager.status.mockResolvedValue({
      mode: "managed",
      activeTargetId: "target-1",
      url: "https://x.com/i/flow/login",
      title: "Log in to X / X"
    });
    core.manager.goto.mockResolvedValue({
      finalUrl: "https://x.com/i/flow/login",
      status: 200,
      timingMs: 1
    });
    core.manager.networkPoll.mockResolvedValue({ events: [], nextSeq: 0 });

    const response = await handleDaemonCommand(core, {
      name: "nav.goto",
      params: {
        sessionId: "session-1",
        clientId: "client-1",
        url: "https://x.com/i/flow/login",
        waitUntil: "load",
        timeoutMs: 30000
      }
    }) as { meta?: { blockerState?: string; blocker?: { type?: string } } };

    expect(response.meta?.blockerState).toBe("active");
    expect(response.meta?.blocker?.type).toBe("auth_required");
  });

  it("routes cookie import to manager capability when available", async () => {
    const core = makeCore();
    core.manager.status.mockResolvedValue({ mode: "managed", activeTargetId: "target-1" });
    core.manager.cookieImport.mockResolvedValue({
      requestId: "req-cookie",
      imported: 1,
      rejected: []
    });

    const response = await handleDaemonCommand(core, {
      name: "session.cookieImport",
      params: {
        sessionId: "session-1",
        clientId: "client-1",
        cookies: [{ name: "session", value: "abc123", url: "https://example.com" }]
      }
    });

    expect(response).toEqual({
      requestId: "req-cookie",
      imported: 1,
      rejected: []
    });
    expect(core.manager.cookieImport).toHaveBeenCalled();
  });

  it("resolves macros through daemon command (resolve only)", async () => {
    const core = makeCore();

    const response = await handleDaemonCommand(core, {
      name: "macro.resolve",
      params: {
        expression: "@web.search(\"openai\")",
        defaultProvider: "web/default",
        includeCatalog: true
      }
    }) as { runtime: string; resolution: unknown; catalog?: unknown[]; execution?: unknown };

    expect(response.runtime === "macros" || response.runtime === "fallback").toBe(true);
    expect(response.resolution).toBeDefined();
    expect(response.execution).toBeUndefined();
    if (response.runtime === "macros") {
      expect(Array.isArray(response.catalog)).toBe(true);
    }
  });

  it("resolves and executes macros through daemon command", async () => {
    const core = makeCore();

    const response = await handleDaemonCommand(core, {
      name: "macro.resolve",
      params: {
        expression: "@community.search(\"openai\")",
        execute: true
      }
    }) as {
      runtime: string;
      resolution: unknown;
      execution?: {
        records: unknown[];
        failures: unknown[];
        metrics: {
          attempted: number;
          succeeded: number;
          failed: number;
          retries: number;
          latencyMs: number;
        };
        meta: {
          ok: boolean;
          partial: boolean;
          sourceSelection: string;
          providerOrder: string[];
          trace: Record<string, unknown>;
          tier?: {
            selected: string;
            reasonCode: string;
          };
          provenance?: {
            provider: string;
            retrievalPath: string;
            retrievedAt: string;
          };
          error?: Record<string, unknown>;
        };
        diagnostics?: {
          promptGuard?: {
            enabled: boolean;
            quarantinedSegments: number;
            entries: number;
          };
        };
      };
    };

    expect(response.runtime === "macros" || response.runtime === "fallback").toBe(true);
    expect(response.resolution).toBeDefined();
    expect(response.execution).toMatchObject({
      records: expect.any(Array),
      failures: expect.any(Array),
      metrics: {
        attempted: expect.any(Number),
        succeeded: expect.any(Number),
        failed: expect.any(Number),
        retries: expect.any(Number),
        latencyMs: expect.any(Number)
      },
      meta: {
        ok: expect.any(Boolean),
        partial: expect.any(Boolean),
        sourceSelection: expect.any(String),
        providerOrder: expect.any(Array),
        trace: expect.any(Object),
        tier: expect.objectContaining({
          selected: expect.any(String),
          reasonCode: expect.any(String)
        }),
        provenance: expect.objectContaining({
          provider: expect.any(String),
          retrievalPath: expect.any(String),
          retrievedAt: expect.any(String)
        })
      }
    });
    expect(response.execution?.diagnostics?.promptGuard).toEqual(expect.objectContaining({
      enabled: expect.any(Boolean),
      quarantinedSegments: expect.any(Number),
      entries: expect.any(Number)
    }));
    expect(response.execution?.meta.ok).toBe(true);
    expect(response.execution?.records.length ?? 0).toBeGreaterThan(0);
    expect(response.execution?.meta).not.toHaveProperty("blocker");
  });
});
