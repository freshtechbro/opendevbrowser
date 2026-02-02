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
    listTargets: vi.fn(),
    disconnect: vi.fn()
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
    clearBinding();
    clearSessionLeases();
  });

  afterEach(() => {
    clearBinding();
    clearSessionLeases();
    vi.restoreAllMocks();
  });

  it("requires lease for extension session commands", async () => {
    const core = makeCore();
    core.manager.status.mockResolvedValue({ mode: "extension", activeTargetId: null });
    core.manager.listTargets.mockResolvedValue({ activeTargetId: null, targets: [] });
    registerSessionLease("session-1", "lease-1", "client-1");

    await expect(handleDaemonCommand(core, {
      name: "targets.list",
      params: { sessionId: "session-1", clientId: "client-1" }
    })).rejects.toThrow("RELAY_LEASE_REQUIRED");

    const response = await handleDaemonCommand(core, {
      name: "targets.list",
      params: { sessionId: "session-1", clientId: "client-1", leaseId: "lease-1" }
    });

    expect(response).toEqual({ activeTargetId: null, targets: [] });
  });

  it("requires binding for annotate when extension mode", async () => {
    const core = makeCore();
    core.manager.status.mockResolvedValue({ mode: "extension", activeTargetId: null });

    await expect(handleDaemonCommand(core, {
      name: "annotate",
      params: { sessionId: "session-1", clientId: "client-1" }
    })).rejects.toThrow("RELAY_BINDING_REQUIRED");
  });

  it("returns annotate response when bound", async () => {
    const core = makeCore();
    core.manager.status.mockResolvedValue({ mode: "extension", activeTargetId: null });
    core.annotationManager.requestAnnotation.mockResolvedValue({
      version: 1,
      requestId: "req-annotate",
      status: "ok",
      payload: { url: "https://example.com", timestamp: "2026-01-31T00:00:00Z", screenshotMode: "visible", screenshots: [], annotations: [] }
    });

    const binding = bindRelay("client-1");
    const response = await handleDaemonCommand(core, {
      name: "annotate",
      params: {
        sessionId: "session-1",
        clientId: "client-1",
        bindingId: binding.bindingId,
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

  it("requires lease when disconnecting an extension session", async () => {
    const core = makeCore();
    core.manager.status.mockResolvedValue({ mode: "extension", activeTargetId: null });
    core.manager.disconnect.mockResolvedValue(undefined);

    registerSessionLease("session-1", "lease-1", "client-1");
    const response = await handleDaemonCommand(core, {
      name: "session.disconnect",
      params: { sessionId: "session-1", clientId: "client-1", leaseId: "lease-1" }
    });

    expect(response).toEqual({ ok: true });
    expect(getBindingState()).toBeNull();
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
});
