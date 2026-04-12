import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentInbox } from "../src/annotate/agent-inbox";
import type { OpenDevBrowserConfig } from "../src/config";
import type { OpenDevBrowserCore } from "../src/core";
import { handleDaemonCommand } from "../src/cli/daemon-commands";
import {
  bindRelay,
  clearBinding,
  clearScreencastOwners,
  clearSessionLeases,
  getBindingState,
  getSessionLease,
  registerScreencastOwner,
  registerSessionLease,
  releaseRelay,
  waitForBinding
} from "../src/cli/daemon-state";
import * as macroExecuteModule from "../src/macros/execute";
import * as providerRuntimeFactoryModule from "../src/providers/runtime-factory";
import * as workflowModule from "../src/providers/workflows";

type RelayStatus = {
  running: boolean;
  port?: number;
  extensionConnected: boolean;
  extensionHandshakeComplete: boolean;
  cdpConnected: boolean;
  annotationConnected: boolean;
  opsConnected: boolean;
  pairingRequired: boolean;
  health: { ok: boolean };
  instanceId: string;
};

function createDeferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

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
    health: { ok: true },
    instanceId: "relay-test",
    ...overrides.relayStatus
  };
  const inboxRoot = mkdtempSync(join(tmpdir(), "odb-daemon-agent-inbox-"));
  tempRoots.push(inboxRoot);

  const manager = {
    status: vi.fn(),
    goto: vi.fn(),
    waitForLoad: vi.fn(),
    waitForRef: vi.fn(),
    click: vi.fn(),
    dialog: vi.fn(),
    consolePoll: vi.fn(),
    networkPoll: vi.fn(),
    withPage: vi.fn(async (
      _sessionId: string,
      _targetId: string | null,
      fn: (page: { context: () => { addCookies: (cookies: unknown[]) => Promise<void>; cookies: (urls?: string[]) => Promise<unknown[]> } }) => Promise<unknown>
    ) => {
      const addCookies = vi.fn(async () => undefined);
      const cookies = vi.fn(async () => []);
      return fn({
        context: () => ({ addCookies, cookies })
      });
    }),
    listTargets: vi.fn(),
    disconnect: vi.fn(),
    connectRelay: vi.fn(),
    connect: vi.fn(),
    debugTraceSnapshot: vi.fn(),
    cookieImport: vi.fn(),
    cookieList: vi.fn(),
    startScreencast: vi.fn(),
    stopScreencast: vi.fn()
  };

  const relay = {
    status: vi.fn(() => relayStatus),
    getCdpUrl: vi.fn(() => null),
    getOpsUrl: vi.fn(() => null)
  };

  const annotationManager = {
    requestAnnotation: vi.fn()
  };
  const agentInbox = new AgentInbox(inboxRoot);
  const desktopRuntime = {
    status: vi.fn().mockResolvedValue({
      platform: "darwin",
      permissionLevel: "observe",
      available: true,
      capabilities: ["observe.windows"],
      auditArtifactsDir: "/tmp/desktop-audit"
    }),
    listWindows: vi.fn().mockResolvedValue({
      ok: true,
      value: { windows: [] },
      audit: {
        auditId: "desktop-audit-1",
        at: "2026-04-10T00:00:00.000Z",
        recordPath: "/tmp/desktop-audit-1.json",
        artifactPaths: []
      }
    }),
    activeWindow: vi.fn().mockResolvedValue({
      ok: true,
      value: null,
      audit: {
        auditId: "desktop-audit-2",
        at: "2026-04-10T00:00:00.000Z",
        recordPath: "/tmp/desktop-audit-2.json",
        artifactPaths: []
      }
    }),
    captureDesktop: vi.fn().mockResolvedValue({
      ok: true,
      value: { capture: { path: "/tmp/desktop.png", mimeType: "image/png" } },
      audit: {
        auditId: "desktop-audit-3",
        at: "2026-04-10T00:00:00.000Z",
        recordPath: "/tmp/desktop-audit-3.json",
        artifactPaths: ["/tmp/desktop.png"]
      }
    }),
    captureWindow: vi.fn().mockResolvedValue({
      ok: true,
      value: { capture: { path: "/tmp/window.png", mimeType: "image/png" } },
      audit: {
        auditId: "desktop-audit-4",
        at: "2026-04-10T00:00:00.000Z",
        recordPath: "/tmp/desktop-audit-4.json",
        artifactPaths: ["/tmp/window.png"]
      }
    }),
    accessibilitySnapshot: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        tree: { role: "AXWindow", children: [] },
        window: {
          id: "window-1",
          ownerName: "Codex",
          ownerPid: 123,
          bounds: { x: 0, y: 0, width: 1200, height: 800 },
          layer: 0,
          alpha: 1,
          isOnscreen: true
        }
      },
      audit: {
        auditId: "desktop-audit-5",
        at: "2026-04-10T00:00:00.000Z",
        recordPath: "/tmp/desktop-audit-5.json",
        artifactPaths: []
      }
    })
  };

  return {
    manager,
    relay,
    agentInbox,
    annotationManager,
    desktopRuntime,
    config: makeConfig(overrides.config)
  } as unknown as OpenDevBrowserCore;
};

const tempRoots: string[] = [];

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
    clearScreencastOwners();
    clearSessionLeases();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearBinding();
    clearScreencastOwners();
    clearSessionLeases();
    vi.restoreAllMocks();
    while (tempRoots.length > 0) {
      const root = tempRoots.pop();
      if (root) {
        rmSync(root, { recursive: true, force: true });
      }
    }
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

  it("clears stale extension leases and returns relaunch guidance for invalid session errors", async () => {
    const core = makeCore();
    core.manager.status.mockResolvedValue({ mode: "extension", activeTargetId: null });
    core.manager.listTargets.mockRejectedValue(new Error("[invalid_session] Unknown sessionId: session-1"));
    registerSessionLease("session-1", "lease-1", "client-1");

    await expect(handleDaemonCommand(core, {
      name: "targets.list",
      params: { sessionId: "session-1", clientId: "client-1", leaseId: "lease-1" }
    })).rejects.toThrow("[relaunch_required]");

    expect(getSessionLease("session-1")).toBeNull();
  });

  it("clears stale extension leases when upstream ownership no longer matches", async () => {
    const core = makeCore();
    core.manager.status.mockResolvedValue({ mode: "extension", activeTargetId: null });
    core.manager.listTargets.mockRejectedValue(new Error("[not_owner] Lease does not match session owner"));
    registerSessionLease("session-1", "lease-1", "client-1");

    await expect(handleDaemonCommand(core, {
      name: "targets.list",
      params: { sessionId: "session-1", clientId: "client-1", leaseId: "lease-1" }
    })).rejects.toThrow("[relaunch_required]");

    expect(getSessionLease("session-1")).toBeNull();
  });

  it("requires binding for annotate when extension mode", async () => {
    const core = makeCore();
    core.manager.status.mockResolvedValue({ mode: "extension", activeTargetId: null });

    await expect(handleDaemonCommand(core, {
      name: "annotate",
      params: { sessionId: "session-1", clientId: "client-1" }
    })).rejects.toThrow("RELAY_BINDING_REQUIRED");
  });

  it("routes desktop observation commands without relay binding", async () => {
    const core = makeCore();

    await expect(handleDaemonCommand(core, {
      name: "desktop.status"
    })).resolves.toEqual({
      platform: "darwin",
      permissionLevel: "observe",
      available: true,
      capabilities: ["observe.windows"],
      auditArtifactsDir: "/tmp/desktop-audit"
    });
    await handleDaemonCommand(core, {
      name: "desktop.capture.window",
      params: {
        windowId: "window-1",
        reason: "capture-window"
      }
    });
    await handleDaemonCommand(core, {
      name: "desktop.accessibility.snapshot",
      params: {
        reason: "accessibility",
        windowId: "window-1"
      }
    });

    expect(core.desktopRuntime.captureWindow).toHaveBeenCalledWith("window-1", {
      reason: "capture-window"
    });
    expect(core.desktopRuntime.accessibilitySnapshot).toHaveBeenCalledWith("accessibility", "window-1");
  });

  it("routes screencast start and stop through session authorization", async () => {
    const core = makeCore();
    core.manager.status.mockResolvedValue({ mode: "managed", activeTargetId: "target-1" });
    core.manager.startScreencast.mockResolvedValue({
      screencastId: "cast-1",
      sessionId: "session-1",
      targetId: "target-1"
    });
    core.manager.stopScreencast.mockResolvedValue({
      screencastId: "cast-1",
      sessionId: "session-1",
      targetId: "target-1",
      endedReason: "stopped"
    });
    registerSessionLease("session-1", "lease-1", "client-1");

    await expect(handleDaemonCommand(core, {
      name: "page.screencast.start",
      params: {
        sessionId: "session-1",
        clientId: "client-1",
        leaseId: "lease-1",
        targetId: "target-1",
        outputDir: "/tmp/cast",
        intervalMs: 750,
        maxFrames: 5
      }
    })).resolves.toEqual({
      screencastId: "cast-1",
      sessionId: "session-1",
      targetId: "target-1"
    });

    await expect(handleDaemonCommand(core, {
      name: "page.screencast.stop",
      params: {
        sessionId: "session-1",
        clientId: "client-1",
        leaseId: "lease-1",
        screencastId: "cast-1"
      }
    })).resolves.toEqual({
      screencastId: "cast-1",
      sessionId: "session-1",
      targetId: "target-1",
      endedReason: "stopped"
    });

    await expect(handleDaemonCommand(core, {
      name: "page.screencast.stop",
      params: {
        sessionId: "session-1",
        clientId: "client-2",
        leaseId: "lease-1",
        screencastId: "cast-1"
      }
    })).rejects.toThrow("RELAY_LEASE_INVALID");

    expect(core.manager.startScreencast).toHaveBeenCalledWith("session-1", {
      targetId: "target-1",
      outputDir: "/tmp/cast",
      intervalMs: 750,
      maxFrames: 5
    });
    expect(core.manager.stopScreencast).toHaveBeenCalledWith("session-1", "cast-1");
  });

  it.each([
    "[invalid_session] Unknown sessionId: session-1",
    "Unknown ops session: session-1"
  ])("allows completed screencast retrieval after session teardown for the owning client (%s)", async (statusError) => {
    const core = makeCore();
    core.manager.status.mockRejectedValue(new Error(statusError));
    core.manager.stopScreencast.mockResolvedValue({
      screencastId: "cast-1",
      sessionId: "session-1",
      targetId: "target-1",
      endedReason: "session_closed"
    });
    registerScreencastOwner("session-1", "cast-1", "client-1");

    await expect(handleDaemonCommand(core, {
      name: "page.screencast.stop",
      params: {
        sessionId: "session-1",
        clientId: "client-1",
        screencastId: "cast-1"
      }
    })).resolves.toEqual({
      screencastId: "cast-1",
      sessionId: "session-1",
      targetId: "target-1",
      endedReason: "session_closed"
    });

    expect(core.manager.stopScreencast).toHaveBeenCalledWith("session-1", "cast-1");
  });

  it.each([
    "[invalid_session] Unknown sessionId: session-1",
    "Unknown ops session: session-1"
  ])("rejects completed screencast retrieval after session teardown for a different client (%s)", async (statusError) => {
    const core = makeCore();
    core.manager.status.mockRejectedValue(new Error(statusError));
    registerScreencastOwner("session-1", "cast-1", "client-1");

    await expect(handleDaemonCommand(core, {
      name: "page.screencast.stop",
      params: {
        sessionId: "session-1",
        clientId: "client-2",
        screencastId: "cast-1"
      }
    })).rejects.toThrow("RELAY_SCREENCAST_OWNER_INVALID");

    expect(core.manager.stopScreencast).not.toHaveBeenCalled();
  });

  it("routes session.inspect through the daemon with default includeUrls and relay status", async () => {
    const core = makeCore({
      relayStatus: {
        running: true,
        extensionConnected: true,
        extensionHandshakeComplete: true,
        cdpConnected: false,
        annotationConnected: true,
        opsConnected: true,
        pairingRequired: false,
        health: { ok: true },
        instanceId: "relay-inspect"
      }
    });
    core.manager.status.mockResolvedValue({ mode: "managed", activeTargetId: "target-1", url: "https://example.com", title: "Example" });
    const inspector = {
      status: vi.fn(async () => ({ mode: "managed", activeTargetId: "target-1", url: "https://example.com", title: "Example" })),
      listTargets: vi.fn(async (_sessionId: string, includeUrls: boolean) => ({
        activeTargetId: "target-1",
        targets: includeUrls
          ? [{ targetId: "target-1", type: "page", url: "https://example.com" }]
          : [{ targetId: "target-1", type: "page" }]
      })),
      consolePoll: vi.fn(async () => ({ events: [], nextSeq: 0 })),
      networkPoll: vi.fn(async () => ({ events: [], nextSeq: 0 })),
      debugTraceSnapshot: vi.fn(async (_sessionId: string, options: {
        sinceConsoleSeq?: number;
        sinceNetworkSeq?: number;
        sinceExceptionSeq?: number;
        max?: number;
        requestId?: string;
      }) => ({
        requestId: options.requestId ?? "inspect-request",
        generatedAt: "2026-04-04T00:00:00.000Z",
        page: { url: "https://example.com", title: "Example" },
        channels: {
          console: { events: [], nextSeq: 0, truncated: false },
          network: { events: [], nextSeq: 0, truncated: false }
        },
        meta: { blockerState: "clear" }
      }))
    };
    const createSessionInspector = vi.fn(() => inspector);
    (core.manager as typeof core.manager & { createSessionInspector: typeof createSessionInspector }).createSessionInspector = createSessionInspector;

    const response = await handleDaemonCommand(core, {
      name: "session.inspect",
      params: {
        sessionId: "session-1",
        clientId: "client-1",
        sinceConsoleSeq: 4,
        sinceNetworkSeq: 5,
        sinceExceptionSeq: 6,
        max: 7,
        requestId: "inspect-request"
      }
    }) as {
      session: { mode: string; activeTargetId: string | null };
      relay: { running: boolean; opsConnected: boolean; health: { ok: boolean } } | null;
      targets: { activeTargetId: string | null; count: number; items: Array<{ targetId: string; type: string }> };
      proofArtifact: { requestId: string | null; blockerState: string };
      healthState: string;
      suggestedNextAction: string;
    };

    expect(createSessionInspector).toHaveBeenCalledTimes(1);
    expect(inspector.listTargets).toHaveBeenCalledWith("session-1", true);
    expect(inspector.debugTraceSnapshot).toHaveBeenCalledWith("session-1", {
      sinceConsoleSeq: 4,
      sinceNetworkSeq: 5,
      sinceExceptionSeq: 6,
      max: 7,
      requestId: "inspect-request"
    });
    expect(response).toMatchObject({
      session: { mode: "managed", activeTargetId: "target-1" },
      relay: { running: true, opsConnected: true, health: { ok: true } },
      targets: { activeTargetId: "target-1", count: 1 },
      proofArtifact: { requestId: "inspect-request", blockerState: "clear" },
      healthState: "ok"
    });
    expect(response.suggestedNextAction).toContain("snapshot");
  });

  it("does not serialize page.dialog behind a pending managed interact.click command", async () => {
    const core = makeCore();
    const clickDeferred = createDeferred<{ timingMs: number; navigated: boolean }>();
    core.manager.status.mockResolvedValue({ mode: "managed", activeTargetId: "target-1" });
    core.manager.click.mockReturnValue(clickDeferred.promise);
    core.manager.dialog.mockResolvedValue({
      dialog: {
        open: true,
        targetId: "target-1",
        type: "alert",
        message: "I am a JS Alert"
      }
    });

    let clickSettled = false;
    const clickPromise = handleDaemonCommand(core, {
      name: "interact.click",
      params: {
        sessionId: "session-1",
        clientId: "client-1",
        ref: "r1"
      }
    }).finally(() => {
      clickSettled = true;
    });

    await vi.waitFor(() => {
      expect(core.manager.click).toHaveBeenCalledWith("session-1", "r1", undefined);
    });

    await expect(handleDaemonCommand(core, {
      name: "page.dialog",
      params: {
        sessionId: "session-1",
        clientId: "client-1",
        action: "status"
      }
    })).resolves.toEqual({
      dialog: {
        open: true,
        targetId: "target-1",
        type: "alert",
        message: "I am a JS Alert"
      }
    });

    expect(core.manager.dialog).toHaveBeenCalledWith("session-1", { action: "status" });
    expect(clickSettled).toBe(false);

    clickDeferred.resolve({ timingMs: 1, navigated: false });
    await expect(clickPromise).resolves.toEqual({ timingMs: 1, navigated: false });
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
      stored: false,
      includeScreenshots: true,
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
      stored: false,
      includeScreenshots: true,
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

  it("routes stored annotate fetches without requiring a page url", async () => {
    const core = makeCore();
    core.manager.status.mockResolvedValue({ mode: "extension", activeTargetId: "target-1" });
    core.annotationManager.requestAnnotation.mockResolvedValue({
      version: 1,
      requestId: "req-stored",
      status: "ok",
      payload: {
        url: "https://example.com",
        timestamp: "2026-03-13T00:00:00Z",
        screenshotMode: "visible",
        annotations: []
      }
    });
    registerSessionLease("session-1", "lease-1", "client-1");

    const response = await handleDaemonCommand(core, {
      name: "annotate",
      params: {
        sessionId: "session-1",
        clientId: "client-1",
        stored: true,
        includeScreenshots: false
      }
    });

    expect(response).toEqual({
      version: 1,
      requestId: "req-stored",
      status: "ok",
      payload: {
        url: "https://example.com",
        timestamp: "2026-03-13T00:00:00Z",
        screenshotMode: "visible",
        annotations: []
      }
    });
    expect(core.annotationManager.requestAnnotation).toHaveBeenCalledWith({
      sessionId: "session-1",
      transport: "relay",
      stored: true,
      includeScreenshots: false,
      targetId: undefined,
      tabId: undefined,
      url: undefined,
      screenshotMode: "visible",
      debug: false,
      context: undefined,
      timeoutMs: undefined
    });
  });

  it("supports internal agent inbox commands against the shared store", async () => {
    const core = makeCore();
    const payload = {
      url: "https://example.com",
      title: "Example",
      timestamp: "2026-03-15T00:00:00.000Z",
      screenshotMode: "visible" as const,
      screenshots: [{ id: "shot-1", mimeType: "image/png", path: "/tmp/example.png" }],
      annotations: [{ id: "note-1", selector: "#hero", text: "Hero copy" }]
    };

    const receipt = await handleDaemonCommand(core, {
      name: "agent.inbox.enqueue",
      params: {
        payload,
        source: "popup_all",
        label: "Popup annotation payload",
        chatScopeKey: "session-1"
      }
    });

    expect(receipt).toMatchObject({
      deliveryState: "delivered",
      chatScopeKey: "session-1",
      storedFallback: false,
      source: "popup_all",
      label: "Popup annotation payload"
    });

    const peek = await handleDaemonCommand(core, {
      name: "agent.inbox.peek",
      params: { chatScopeKey: "session-1" }
    });

    expect(peek).toMatchObject({
      chatScopeKey: "session-1",
      entries: [
        expect.objectContaining({
          chatScopeKey: "session-1",
          deliveryState: "delivered",
          payloadSansScreenshots: expect.objectContaining({
            screenshotMode: "none"
          })
        })
      ]
    });

    const consume = await handleDaemonCommand(core, {
      name: "agent.inbox.consume",
      params: { chatScopeKey: "session-1" }
    });

    expect(consume).toMatchObject({
      chatScopeKey: "session-1",
      receiptIds: [expect.any(String)],
      entries: [
        expect.objectContaining({
          deliveryState: "consumed",
          receipt: expect.objectContaining({
            deliveryState: "consumed",
            storedFallback: false
          })
        })
      ]
    });

    const ack = await handleDaemonCommand(core, {
      name: "agent.inbox.ack",
      params: { receiptIds: (consume as { receiptIds: string[] }).receiptIds }
    });

    expect(ack).toEqual({
      ok: true,
      receiptIds: (consume as { receiptIds: string[] }).receiptIds
    });
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

  it("treats lost ops status during disconnect as best-effort cleanup for the lease owner", async () => {
    const core = makeCore();
    core.manager.status.mockRejectedValue(new Error("Ops client not connected"));

    registerSessionLease("session-ops", "lease-ops", "client-1");
    const response = await handleDaemonCommand(core, {
      name: "session.disconnect",
      params: { sessionId: "session-ops", clientId: "client-1" }
    });

    expect(response).toEqual({ ok: true });
    expect(core.manager.disconnect).not.toHaveBeenCalled();
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

  it("preserves explicit /ops relay endpoints even when extensionLegacy is enabled", async () => {
    const core = makeCore();
    core.manager.connectRelay.mockResolvedValue({
      sessionId: "session-ops-legacy",
      mode: "extension",
      activeTargetId: "target-1",
      warnings: [],
      wsEndpoint: "ws://127.0.0.1:8787/ops"
    });
    const binding = bindRelay("client-ops-legacy");
    if ("queued" in binding && binding.queued) {
      throw new Error("Expected immediate binding for test setup.");
    }

    const response = await handleDaemonCommand(core, {
      name: "session.connect",
      params: {
        clientId: "client-ops-legacy",
        bindingId: binding.bindingId,
        wsEndpoint: "ws://127.0.0.1:8787/ops",
        extensionLegacy: true
      }
    });

    expect(core.manager.connectRelay).toHaveBeenCalledWith("ws://127.0.0.1:8787/ops");
    expect(response).toEqual(expect.objectContaining({
      sessionId: "session-ops-legacy",
      mode: "extension"
    }));
  });

  it("routes local base relay endpoints to /ops and preserves startUrl", async () => {
    const core = makeCore();
    core.manager.connectRelay.mockResolvedValue({
      sessionId: "session-ops",
      mode: "extension",
      activeTargetId: "target-1",
      warnings: [],
      wsEndpoint: "ws://127.0.0.1:8787/ops",
      leaseId: "lease-ops"
    });

    const response = await handleDaemonCommand(core, {
      name: "session.connect",
      params: {
        clientId: "client-ops",
        wsEndpoint: "ws://127.0.0.1:8787",
        startUrl: "http://127.0.0.1:41731/"
      }
    });

    expect(core.manager.connectRelay).toHaveBeenCalledWith("ws://127.0.0.1:8787/ops", {
      startUrl: "http://127.0.0.1:41731/"
    });
    expect(response).toEqual(expect.objectContaining({
      sessionId: "session-ops",
      leaseId: "lease-ops"
    }));
    expect(getSessionLease("session-ops")).toEqual(expect.objectContaining({
      leaseId: "lease-ops",
      clientId: "client-ops"
    }));
  });

  it("rejects explicit /cdp relay endpoints without extensionLegacy", async () => {
    const core = makeCore();

    await expect(handleDaemonCommand(core, {
      name: "session.connect",
      params: {
        clientId: "client-cdp",
        wsEndpoint: "ws://127.0.0.1:8787/cdp"
      }
    })).rejects.toThrow("Legacy extension relay (/cdp) requires --extension-legacy.");
  });

  it("rejects non-legacy extension connect results that do not return a lease", async () => {
    const core = makeCore();
    const relay = core.relay as unknown as {
      getOpsUrl: ReturnType<typeof vi.fn>;
    };
    relay.getOpsUrl = vi.fn(() => "ws://127.0.0.1:8787/ops");
    core.manager.connectRelay.mockResolvedValue({
      sessionId: "session-ops",
      mode: "extension",
      activeTargetId: "target-1",
      warnings: [],
      wsEndpoint: "ws://127.0.0.1:8787/ops"
    });

    await expect(handleDaemonCommand(core, {
      name: "session.connect",
      params: {
        clientId: "client-1"
      }
    })).rejects.toThrow("[invalid_session] Extension relay session missing leaseId.");
  });

  it("rejects non-legacy extension launch results that do not return a lease", async () => {
    const core = makeCore({
      relayStatus: {
        extensionConnected: true,
        extensionHandshakeComplete: true
      }
    });
    const relay = core.relay as unknown as {
      getOpsUrl: ReturnType<typeof vi.fn>;
    };
    relay.getOpsUrl = vi.fn(() => "ws://127.0.0.1:8787/ops");
    core.manager.connectRelay.mockResolvedValue({
      sessionId: "session-ops",
      mode: "extension",
      activeTargetId: "target-1",
      warnings: [],
      wsEndpoint: "ws://127.0.0.1:8787/ops"
    });

    await expect(handleDaemonCommand(core, {
      name: "session.launch",
      params: {
        clientId: "client-1"
      }
    })).rejects.toThrow("[invalid_session] Extension relay session missing leaseId.");
  });

  it("rejects extension launch when the websocket is connected but the handshake is still incomplete", async () => {
    const core = makeCore({
      relayStatus: {
        extensionConnected: true,
        extensionHandshakeComplete: false
      }
    });
    const relay = core.relay as unknown as {
      getOpsUrl: ReturnType<typeof vi.fn>;
    };
    relay.getOpsUrl = vi.fn(() => "ws://127.0.0.1:8787/ops");

    await expect(handleDaemonCommand(core, {
      name: "session.launch",
      params: {
        clientId: "client-1",
        extensionOnly: true
      }
    })).rejects.toThrow("clean daemon-extension handshake");

    expect(core.manager.connectRelay).not.toHaveBeenCalled();
  });

  it("accepts extension launch when observed status confirms handshake completion", async () => {
    const core = makeCore({
      relayStatus: {
        extensionConnected: true,
        extensionHandshakeComplete: false
      }
    });
    const relay = core.relay as unknown as {
      getOpsUrl: ReturnType<typeof vi.fn>;
    };
    relay.getOpsUrl = vi.fn(() => "ws://127.0.0.1:8787/ops");
    core.manager.connectRelay.mockResolvedValue({
      sessionId: "session-ops",
      mode: "extension",
      activeTargetId: "target-1",
      leaseId: "lease-ops",
      warnings: [],
      wsEndpoint: "ws://127.0.0.1:8787/ops"
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        instanceId: "relay-observed",
        running: true,
        port: 8787,
        extensionConnected: true,
        extensionHandshakeComplete: true,
        cdpConnected: false,
        annotationConnected: false,
        opsConnected: false,
        pairingRequired: false
      })
    }) as unknown as typeof fetch);

    await expect(handleDaemonCommand(core, {
      name: "session.launch",
      params: {
        clientId: "client-1",
        extensionOnly: true
      }
    })).resolves.toEqual(expect.objectContaining({
      sessionId: "session-ops",
      leaseId: "lease-ops",
      mode: "extension"
    }));

    expect(core.manager.connectRelay).toHaveBeenCalledWith("ws://127.0.0.1:8787/ops");
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

  it("routes cookie list to manager capability when available", async () => {
    const core = makeCore();
    core.manager.status.mockResolvedValue({ mode: "managed", activeTargetId: "target-1" });
    core.manager.cookieList.mockResolvedValue({
      requestId: "req-cookie-list",
      cookies: [],
      count: 0
    });

    const response = await handleDaemonCommand(core, {
      name: "session.cookieList",
      params: {
        sessionId: "session-1",
        clientId: "client-1",
        urls: ["https://example.com"]
      }
    });

    expect(response).toEqual({
      requestId: "req-cookie-list",
      cookies: [],
      count: 0
    });
    expect(core.manager.cookieList).toHaveBeenCalledWith(
      "session-1",
      ["https://example.com/"],
      expect.any(String)
    );
  });

  it("falls back to withPage for cookie list when manager capability is unavailable", async () => {
    const core = makeCore();
    core.manager.status.mockResolvedValue({ mode: "managed", activeTargetId: "target-1" });
    delete (core.manager as { cookieList?: unknown }).cookieList;
    core.manager.withPage.mockImplementationOnce(async (_sessionId: string, _targetId: string | null, fn: (page: {
      context: () => {
        cookies: (urls?: string[]) => Promise<Array<{
          name: string;
          value: string;
          domain: string;
          path: string;
          expires: number;
          httpOnly: boolean;
          secure: boolean;
        }>>;
      };
    }) => Promise<unknown>) => {
      return fn({
        context: () => ({
          cookies: async (urls?: string[]) => {
            expect(urls).toEqual(["https://example.com/"]);
            return [{
              name: "session",
              value: "abc",
              domain: "example.com",
              path: "/",
              expires: -1,
              httpOnly: true,
              secure: true
            }];
          }
        })
      });
    });

    const response = await handleDaemonCommand(core, {
      name: "session.cookieList",
      params: {
        sessionId: "session-1",
        clientId: "client-1",
        urls: ["https://example.com"]
      }
    });

    expect(response).toEqual({
      requestId: expect.any(String),
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
  });

  it("rejects invalid cookie list url filters", async () => {
    const core = makeCore();
    core.manager.status.mockResolvedValue({ mode: "managed", activeTargetId: "target-1" });

    await expect(handleDaemonCommand(core, {
      name: "session.cookieList",
      params: {
        sessionId: "session-1",
        clientId: "client-1",
        urls: ["ftp://example.com"]
      }
    })).rejects.toThrow("Invalid urls");
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

  it("uses temporary profiles for product-video screenshot capture", async () => {
    const core = makeCore();
    const manager = core.manager as unknown as {
      launch: ReturnType<typeof vi.fn>;
      goto: ReturnType<typeof vi.fn>;
      screenshot: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
    };
    manager.launch = vi.fn(async () => ({ sessionId: "shot-session" }));
    manager.goto = vi.fn(async () => ({ ok: true }));
    manager.screenshot = vi.fn(async () => ({ base64: Buffer.from("shot").toString("base64") }));
    manager.disconnect = vi.fn(async () => undefined);

    await handleDaemonCommand(core, {
      name: "product.video.run",
      params: {
        product_url: "https://example.com/product",
        include_screenshots: true,
        include_copy: true
      }
    });

    expect(manager.launch).toHaveBeenCalled();
    expect(manager.launch).toHaveBeenCalledWith(expect.objectContaining({
      headless: true,
      startUrl: "about:blank",
      persistProfile: false
    }));
    expect(manager.goto).toHaveBeenCalledWith("shot-session", "https://example.com/product", "load", 30000);
    expect(manager.disconnect).toHaveBeenCalledWith("shot-session", true);
  });

  it("forwards product-video timeoutMs through the daemon router", async () => {
    const core = makeCore();
    const workflowSpy = vi.spyOn(workflowModule, "runProductVideoWorkflow").mockResolvedValue({
      path: "/tmp/product-assets",
      manifest: {},
      product: {},
      pricing: {},
      screenshots: [],
      images: [],
      meta: {}
    });

    await handleDaemonCommand(core, {
      name: "product.video.run",
      params: {
        product_name: "Timeout Product",
        timeoutMs: 45000
      }
    });

    expect(workflowSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        product_name: "Timeout Product",
        timeoutMs: 45000
      }),
      expect.any(Object)
    );
  });

  it("forwards research timeoutMs through the daemon router", async () => {
    const core = makeCore();
    const workflowSpy = vi.spyOn(workflowModule, "runResearchWorkflow").mockResolvedValue({
      records: [],
      meta: {}
    });

    await handleDaemonCommand(core, {
      name: "research.run",
      params: {
        topic: "Timeout Research",
        mode: "json",
        timeoutMs: 45000
      }
    });

    expect(workflowSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        topic: "Timeout Research",
        mode: "json",
        timeoutMs: 45000
      })
    );
  });

  it("threads browserFallbackPort into daemon shopping workflows", async () => {
    const core = makeCore();
    const browserFallbackPort = { resolve: vi.fn() };
    (core as OpenDevBrowserCore & { browserFallbackPort?: typeof browserFallbackPort }).browserFallbackPort = browserFallbackPort as never;
    const runtimeSpy = vi.spyOn(providerRuntimeFactoryModule, "createConfiguredProviderRuntime").mockReturnValue({} as never);
    const workflowSpy = vi.spyOn(workflowModule, "runShoppingWorkflow").mockResolvedValue({
      mode: "json",
      offers: [],
      meta: {}
    } as never);

    await handleDaemonCommand(core, {
      name: "shopping.run",
      params: {
        query: "macbook pro m4 32gb ram",
        browserMode: "extension"
      }
    });

    expect(runtimeSpy).toHaveBeenCalledWith(expect.objectContaining({
      config: core.config,
      manager: core.manager,
      browserFallbackPort
    }));
    expect(workflowSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        query: "macbook pro m4 32gb ram",
        browserMode: "extension"
      })
    );
  });

  it("forwards macro timeoutMs into provider runtime budgets", async () => {
    const core = makeCore();
    const browserFallbackPort = { resolve: vi.fn() };
    (core as OpenDevBrowserCore & { browserFallbackPort?: typeof browserFallbackPort }).browserFallbackPort = browserFallbackPort as never;
    const runtimeSpy = vi.spyOn(providerRuntimeFactoryModule, "createConfiguredProviderRuntime").mockReturnValue({} as never);
    const executeSpy = vi.spyOn(macroExecuteModule, "executeMacroResolution").mockResolvedValue({
      records: [],
      failures: [],
      metrics: {
        attempted: 0,
        succeeded: 0,
        failed: 0,
        retries: 0,
        latencyMs: 0
      },
      meta: {
        ok: true,
        partial: false,
        sourceSelection: "community",
        providerOrder: [],
        trace: {}
      }
    } as never);

    await handleDaemonCommand(core, {
      name: "macro.resolve",
      params: {
        expression: "@community.search(\"openai\")",
        execute: true,
        timeoutMs: 45000,
        challengeAutomationMode: "browser_with_helper"
      }
    });

    expect(runtimeSpy).toHaveBeenCalledWith(expect.objectContaining({
      config: core.config,
      manager: core.manager,
      browserFallbackPort,
      init: {
        budgets: {
          timeoutMs: {
            search: 45000,
            fetch: 45000,
            crawl: 45000,
            post: 45000
          }
        }
      }
    }));
    expect(executeSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { challengeAutomationMode: "browser_with_helper" }
    );
  });

  it("rejects extension-mode headless launch with unsupported_mode", async () => {
    const core = makeCore();
    const manager = core.manager as unknown as {
      connectRelay: ReturnType<typeof vi.fn>;
    };

    await expect(handleDaemonCommand(core, {
      name: "session.launch",
      params: {
        clientId: "client-1",
        headless: true
      }
    })).rejects.toThrow("[unsupported_mode]");

    expect(manager.connectRelay).not.toHaveBeenCalled();
  });

  it("rejects extension-routed headless connect with unsupported_mode", async () => {
    const core = makeCore();
    const relay = core.relay as unknown as {
      getOpsUrl: ReturnType<typeof vi.fn>;
    };
    relay.getOpsUrl = vi.fn(() => "ws://127.0.0.1:8787/ops");
    const manager = core.manager as unknown as {
      connectRelay: ReturnType<typeof vi.fn>;
      connect: ReturnType<typeof vi.fn>;
    };

    await expect(handleDaemonCommand(core, {
      name: "session.connect",
      params: {
        clientId: "client-1",
        headless: true
      }
    })).rejects.toThrow("[unsupported_mode]");

    expect(manager.connectRelay).not.toHaveBeenCalled();
    expect(manager.connect).not.toHaveBeenCalled();
  });

});
