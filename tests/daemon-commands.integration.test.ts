import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenDevBrowserConfig } from "../src/config";
import type { OpenDevBrowserCore } from "../src/core";
import { handleDaemonCommand } from "../src/cli/daemon-commands";
import { bindRelay, clearBinding, getBindingState, releaseRelay, waitForBinding } from "../src/cli/daemon-state";

type RelayStatus = {
  running: boolean;
  port?: number;
  extensionConnected: boolean;
  extensionHandshakeComplete: boolean;
  cdpConnected: boolean;
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
    getCdpUrl: vi.fn(() => null)
  };

  return {
    manager,
    relay,
    config: makeConfig(overrides.config)
  } as unknown as OpenDevBrowserCore;
};

describe("daemon-commands integration", () => {
  beforeEach(() => {
    clearBinding();
  });

  afterEach(() => {
    clearBinding();
    vi.restoreAllMocks();
  });

  it("requires binding for extension session commands", async () => {
    const core = makeCore();
    core.manager.status.mockResolvedValue({ mode: "extension", activeTargetId: null });
    core.manager.listTargets.mockResolvedValue({ activeTargetId: null, targets: [] });

    await expect(handleDaemonCommand(core, {
      name: "targets.list",
      params: { sessionId: "session-1", clientId: "client-1" }
    })).rejects.toThrow("RELAY_BINDING_REQUIRED");

    const binding = bindRelay("client-1");
    const response = await handleDaemonCommand(core, {
      name: "targets.list",
      params: { sessionId: "session-1", clientId: "client-1", bindingId: binding.bindingId }
    });

    expect(response).toEqual({ activeTargetId: null, targets: [] });
  });

  it("releases binding when disconnecting an extension session", async () => {
    const core = makeCore();
    core.manager.status.mockResolvedValue({ mode: "extension", activeTargetId: null });
    core.manager.disconnect.mockResolvedValue(undefined);

    const binding = bindRelay("client-1");
    const response = await handleDaemonCommand(core, {
      name: "session.disconnect",
      params: { sessionId: "session-1", clientId: "client-1", bindingId: binding.bindingId }
    });

    expect(response).toEqual({ ok: true, bindingReleased: true });
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
