import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DAEMON_STATUS_FETCH_OPTIONS } from "../src/cli/daemon-status-policy";

const agentInbox = {
  registerScope: vi.fn(),
  buildSystemInjection: vi.fn(),
  acknowledge: vi.fn()
};

const createToolsMock = vi.fn(() => ({}));
const createCoreRuntimeAssembliesMock = vi.fn(() => ({
  providerRuntime: {},
  browserFallbackPort: null
}));
const createAutomationCoordinatorMock = vi.fn(() => ({}));
const isHubEnabledMock = vi.fn(() => false);
const fetchDaemonStatusFromMetadataMock = vi.fn();
const fetchDaemonStatusMock = vi.fn();
const fetchWithTimeoutMock = vi.fn();
const startDaemonMock = vi.fn();
const readDaemonMetadataMock = vi.fn();
const isCurrentDaemonFingerprintMock = vi.fn();
const createDaemonStopHeadersMock = vi.fn();
const releaseBindingMock = vi.fn().mockResolvedValue(undefined);
const remoteRelayRefreshMock = vi.fn().mockResolvedValue(undefined);

const config = {
  daemonPort: 8788,
  daemonToken: "daemon-token",
  relayPort: 8787,
  relayToken: "token",
  snapshot: { maxChars: 20_000 },
  skills: { nudge: { enabled: false, keywords: [], maxAgeMs: 60_000 } },
  continuity: { enabled: false, filePath: "CONTINUITY.md", nudge: { enabled: false, keywords: [], maxAgeMs: 60_000 } }
};

vi.mock("../src/core", () => ({
  createOpenDevBrowserCore: vi.fn(() => ({
    cacheRoot: "/tmp/opendevbrowser",
    config,
    configStore: { get: vi.fn(() => config) },
    manager: {},
    agentInbox,
    canvasManager: {},
    annotationManager: {
      setRelay: vi.fn(),
      setBrowserManager: vi.fn()
    },
    runner: {},
    skills: {},
    providerRuntime: {},
    relay: {
      status: vi.fn(() => ({ running: false, port: 8787 }))
    },
    ensureRelay: vi.fn(async () => undefined),
    cleanup: vi.fn(),
    getExtensionPath: vi.fn(() => null),
    desktopRuntime: {},
    automationCoordinator: {},
    browserFallbackPort: null
  })),
  createCoreRuntimeAssemblies: createCoreRuntimeAssembliesMock
}));

vi.mock("../src/config", () => ({
  requireChallengeOrchestrationConfig: vi.fn(() => ({
    mode: "off",
    governed: [],
    optionalComputerUseBridge: { enabled: false }
  }))
}));

vi.mock("../src/tools", () => ({
  createTools: createToolsMock
}));

vi.mock("../src/extension-extractor", () => ({
  extractExtension: vi.fn()
}));

vi.mock("../src/utils/hub-enabled", () => ({
  isHubEnabled: isHubEnabledMock
}));

vi.mock("../src/cli/daemon-status", () => ({
  fetchDaemonStatus: fetchDaemonStatusMock,
  fetchDaemonStatusFromMetadata: fetchDaemonStatusFromMetadataMock
}));

vi.mock("../src/cli/daemon", () => ({
  createDaemonStopHeaders: createDaemonStopHeadersMock,
  isCurrentDaemonFingerprint: isCurrentDaemonFingerprintMock,
  readDaemonMetadata: readDaemonMetadataMock,
  startDaemon: startDaemonMock
}));

vi.mock("../src/cli/utils/http", () => ({
  fetchWithTimeout: fetchWithTimeoutMock
}));

vi.mock("../src/cli/remote-manager", () => ({
  RemoteManager: class {
    remoteKind = "manager";

    constructor(_client: unknown) {}
  }
}));

vi.mock("../src/cli/remote-canvas-manager", () => ({
  RemoteCanvasManager: class {
    constructor(_client: unknown) {}
  }
}));

vi.mock("../src/cli/remote-desktop-runtime", () => ({
  RemoteDesktopRuntime: class {
    constructor(_client: unknown) {}
  }
}));

vi.mock("../src/cli/remote-relay", () => ({
  RemoteRelay: class {
    refresh = remoteRelayRefreshMock;

    constructor(_client: unknown) {}
  }
}));

vi.mock("../src/browser/script-runner", () => ({
  ScriptRunner: class {
    constructor(_manager: unknown) {}
  }
}));

vi.mock("../src/automation/coordinator", () => ({
  createAutomationCoordinator: createAutomationCoordinatorMock
}));

vi.mock("../src/cli/daemon-client", () => ({
  DaemonClient: class {
    releaseBinding = releaseBindingMock;
  }
}));

describe("plugin inbox hooks", () => {
  beforeEach(() => {
    vi.resetModules();
    createToolsMock.mockClear();
    isHubEnabledMock.mockReset();
    isHubEnabledMock.mockReturnValue(false);
    fetchDaemonStatusFromMetadataMock.mockReset();
    fetchDaemonStatusFromMetadataMock.mockResolvedValue(null);
    fetchDaemonStatusMock.mockReset();
    fetchDaemonStatusMock.mockResolvedValue(null);
    fetchWithTimeoutMock.mockReset();
    fetchWithTimeoutMock.mockResolvedValue({ ok: true, status: 200 });
    readDaemonMetadataMock.mockReset();
    readDaemonMetadataMock.mockReturnValue({
      port: 8788,
      token: "daemon-token",
      pid: 42,
      relayPort: 8787,
      startedAt: new Date().toISOString(),
      fingerprint: "stale-fingerprint"
    });
    isCurrentDaemonFingerprintMock.mockReset();
    isCurrentDaemonFingerprintMock.mockImplementation((fingerprint: string | null | undefined) => {
      return fingerprint === "current-fingerprint";
    });
    createDaemonStopHeadersMock.mockReset();
    createDaemonStopHeadersMock.mockImplementation((token: string, reason: string) => ({
      Authorization: `Bearer ${token}`,
      "x-test-stop-reason": reason
    }));
    startDaemonMock.mockReset();
    startDaemonMock.mockResolvedValue({ stop: vi.fn().mockResolvedValue(undefined) });
    releaseBindingMock.mockClear();
    remoteRelayRefreshMock.mockClear();
    createCoreRuntimeAssembliesMock.mockClear();
    createAutomationCoordinatorMock.mockClear();
    agentInbox.registerScope.mockReset();
    agentInbox.buildSystemInjection.mockReset();
    agentInbox.acknowledge.mockReset();
    vi.spyOn(process, "on").mockImplementation((() => process) as typeof process.on);
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers chat scopes on user messages and injects scoped inbox blocks into system prompts", async () => {
    agentInbox.buildSystemInjection.mockReturnValue({
      systemBlock: "[opendevbrowser-agent-inbox]\n{}\n[opendevbrowser-agent-inbox]",
      receiptIds: ["receipt-1"]
    });

    const pluginFactory = (await import("../src/index")).default;
    const hooks = await pluginFactory({
      directory: "/tmp/opendevbrowser",
      worktree: "/tmp/opendevbrowser"
    } as never);

    await hooks["chat.message"]?.({
      sessionID: "session-1",
      messageID: "message-1",
      agent: "codex",
      model: { providerID: "openai", modelID: "gpt-5" },
      variant: "default"
    }, {
      message: { role: "user" },
      parts: [{ type: "text", text: "continue the task" }]
    } as never);

    expect(agentInbox.registerScope).toHaveBeenCalledWith("session-1", expect.objectContaining({
      messageId: "message-1",
      agent: "codex",
      model: { providerID: "openai", modelID: "gpt-5" },
      variant: "default"
    }));

    const output = { system: ["existing"] };
    await hooks["experimental.chat.system.transform"]?.({
      sessionID: "session-1",
      model: {} as never
    }, output as never);

    expect(agentInbox.buildSystemInjection).toHaveBeenCalledWith("session-1");
    expect(agentInbox.acknowledge).toHaveBeenCalledWith(["receipt-1"]);
    expect(output.system).toEqual([
      "existing",
      "[opendevbrowser-agent-inbox]\n{}\n[opendevbrowser-agent-inbox]"
    ]);
  });

  it("uses the shared daemon status fetch policy during ensureHub bootstrap", async () => {
    vi.useFakeTimers();
    startDaemonMock.mockRejectedValue(new Error("daemon unavailable"));

    const toolsModule = await import("../src/tools");
    const pluginFactory = (await import("../src/index")).default;
    await pluginFactory({
      directory: "/tmp/opendevbrowser",
      worktree: "/tmp/opendevbrowser"
    } as never);

    const deps = vi.mocked(toolsModule.createTools).mock.calls.at(-1)?.[0] as {
      ensureHub?: () => Promise<void>;
    };

    isHubEnabledMock.mockReturnValue(true);
    const pending = deps.ensureHub?.();
    const expectation = expect(pending).rejects.toThrow("daemon unavailable");
    await vi.advanceTimersByTimeAsync(1000);

    await expectation;
    expect(fetchDaemonStatusFromMetadataMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ relayPort: 8787 }),
      {
        ...DEFAULT_DAEMON_STATUS_FETCH_OPTIONS,
        timeoutMs: 2_000
      }
    );
  });

  it("reuses a daemon that becomes responsive after a non-destructive bootstrap miss", async () => {
    vi.useFakeTimers();
    fetchDaemonStatusFromMetadataMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ok: true,
        pid: 43,
        fingerprint: "current-fingerprint",
        hub: { instanceId: "hub-2" },
        relay: { running: true, port: 8787 },
        binding: null
      });
    startDaemonMock.mockRejectedValue(new Error("listen EADDRINUSE: address already in use 127.0.0.1:8788"));

    const toolsModule = await import("../src/tools");
    const pluginFactory = (await import("../src/index")).default;
    await pluginFactory({
      directory: "/tmp/opendevbrowser",
      worktree: "/tmp/opendevbrowser"
    } as never);

    const deps = vi.mocked(toolsModule.createTools).mock.calls.at(-1)?.[0] as {
      ensureHub?: () => Promise<void>;
    };

    isHubEnabledMock.mockReturnValue(true);
    const pending = deps.ensureHub?.();
    const expectation = expect(pending).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(1_000);

    await expectation;
    expect(fetchDaemonStatusFromMetadataMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ relayPort: 8787 }),
      {
        ...DEFAULT_DAEMON_STATUS_FETCH_OPTIONS,
        timeoutMs: 2_000
      }
    );
    expect(startDaemonMock).toHaveBeenCalledTimes(1);
    expect(remoteRelayRefreshMock).toHaveBeenCalledTimes(1);
  });

  it("stops a responsive mismatched daemon during ensureHub bootstrap", async () => {
    fetchDaemonStatusFromMetadataMock
      .mockResolvedValueOnce({
        ok: true,
        pid: 42,
        fingerprint: "stale-fingerprint",
        hub: { instanceId: "hub-1" },
        relay: { running: false, port: 8787 },
        binding: null
      })
      .mockResolvedValueOnce({
        ok: true,
        pid: 43,
        fingerprint: "current-fingerprint",
        hub: { instanceId: "hub-2" },
        relay: { running: true, port: 8787 },
        binding: null
      });

    const toolsModule = await import("../src/tools");
    const pluginFactory = (await import("../src/index")).default;
    await pluginFactory({
      directory: "/tmp/opendevbrowser",
      worktree: "/tmp/opendevbrowser"
    } as never);

    const deps = vi.mocked(toolsModule.createTools).mock.calls.at(-1)?.[0] as {
      ensureHub?: () => Promise<void>;
    };

    isHubEnabledMock.mockReturnValue(true);
    await expect(deps.ensureHub?.()).resolves.toBeUndefined();
    expect(fetchWithTimeoutMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8788/stop",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer daemon-token",
          "x-test-stop-reason": "plugin.ensureHub.upgrade"
        }
      },
      expect.any(Number)
    );
    expect(startDaemonMock).toHaveBeenCalledTimes(1);
    expect(remoteRelayRefreshMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a refreshed fingerprint-protected mismatch during ensureHub bootstrap", async () => {
    fetchDaemonStatusFromMetadataMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ok: true,
        pid: 42,
        fingerprint: "stale-fingerprint",
        hub: { instanceId: "hub-stale" },
        relay: { running: false, port: 8787 },
        binding: null
      });
    startDaemonMock.mockRejectedValue(new Error("listen EADDRINUSE: address already in use 127.0.0.1:8788"));
    fetchWithTimeoutMock.mockResolvedValueOnce({ ok: false, status: 409 });

    const toolsModule = await import("../src/tools");
    const pluginFactory = (await import("../src/index")).default;
    await pluginFactory({
      directory: "/tmp/opendevbrowser",
      worktree: "/tmp/opendevbrowser"
    } as never);

    const deps = vi.mocked(toolsModule.createTools).mock.calls.at(-1)?.[0] as {
      ensureHub?: () => Promise<void>;
    };

    isHubEnabledMock.mockReturnValue(true);
    await expect(deps.ensureHub?.()).rejects.toThrow("protected by a different opendevbrowser build");
    expect(startDaemonMock).toHaveBeenCalledTimes(1);
    expect(fetchWithTimeoutMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8788/stop",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer daemon-token",
          "x-test-stop-reason": "plugin.ensureHub.upgrade"
        }
      },
      expect.any(Number)
    );
    expect(remoteRelayRefreshMock).not.toHaveBeenCalled();
  });

  it("ignores a fingerprint-protected metadata-only daemon during ensureHub bootstrap", async () => {
    readDaemonMetadataMock.mockReturnValue({
      port: 12345,
      token: "foreign-token",
      pid: 99,
      relayPort: 8787,
      startedAt: new Date().toISOString(),
      fingerprint: "foreign-fingerprint"
    });
    fetchDaemonStatusFromMetadataMock
      .mockResolvedValueOnce({
        ok: true,
        pid: 99,
        fingerprint: "foreign-fingerprint",
        hub: { instanceId: "hub-foreign" },
        relay: { running: false, port: 8787 },
        binding: null
      })
      .mockResolvedValueOnce({
        ok: true,
        pid: 43,
        fingerprint: "current-fingerprint",
        hub: { instanceId: "hub-current" },
        relay: { running: true, port: 8787 },
        binding: null
      });
    fetchWithTimeoutMock.mockResolvedValueOnce({ ok: false, status: 409 });

    const toolsModule = await import("../src/tools");
    const pluginFactory = (await import("../src/index")).default;
    await pluginFactory({
      directory: "/tmp/opendevbrowser",
      worktree: "/tmp/opendevbrowser"
    } as never);

    const deps = vi.mocked(toolsModule.createTools).mock.calls.at(-1)?.[0] as {
      ensureHub?: () => Promise<void>;
    };

    isHubEnabledMock.mockReturnValue(true);
    await expect(deps.ensureHub?.()).resolves.toBeUndefined();
    expect(fetchWithTimeoutMock).toHaveBeenCalledWith(
      "http://127.0.0.1:12345/stop",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer foreign-token",
          "x-test-stop-reason": "plugin.ensureHub.upgrade"
        }
      },
      expect.any(Number)
    );
    expect(startDaemonMock).toHaveBeenCalledTimes(1);
    expect(remoteRelayRefreshMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a fingerprint-protected mismatched daemon during ensureHub bootstrap", async () => {
    fetchDaemonStatusFromMetadataMock.mockResolvedValue({
      ok: true,
      pid: 42,
      fingerprint: "stale-fingerprint",
      hub: { instanceId: "hub-1" },
      relay: { running: false, port: 8787 },
      binding: null
    });
    fetchWithTimeoutMock.mockResolvedValueOnce({ ok: false, status: 409 });

    const toolsModule = await import("../src/tools");
    const pluginFactory = (await import("../src/index")).default;
    await pluginFactory({
      directory: "/tmp/opendevbrowser",
      worktree: "/tmp/opendevbrowser"
    } as never);

    const deps = vi.mocked(toolsModule.createTools).mock.calls.at(-1)?.[0] as {
      ensureHub?: () => Promise<void>;
    };

    isHubEnabledMock.mockReturnValue(true);
    await expect(deps.ensureHub?.()).rejects.toThrow("protected by a different opendevbrowser build");
    expect(startDaemonMock).not.toHaveBeenCalled();
    expect(remoteRelayRefreshMock).not.toHaveBeenCalled();
  });

  it("does not bind remote managers during failed hub-enabled startup", async () => {
    isHubEnabledMock.mockReturnValue(true);
    fetchDaemonStatusFromMetadataMock.mockResolvedValue({
      ok: true,
      pid: 42,
      fingerprint: "stale-fingerprint",
      hub: { instanceId: "hub-1" },
      relay: { running: false, port: 8787 },
      binding: null
    });
    fetchWithTimeoutMock.mockResolvedValueOnce({ ok: false, status: 409 });

    const toolsModule = await import("../src/tools");
    const pluginFactory = (await import("../src/index")).default;
    await pluginFactory({
      directory: "/tmp/opendevbrowser",
      worktree: "/tmp/opendevbrowser"
    } as never);

    const deps = vi.mocked(toolsModule.createTools).mock.calls.at(-1)?.[0] as {
      manager?: { remoteKind?: string };
    };

    expect(deps.manager?.remoteKind).toBeUndefined();
    expect(remoteRelayRefreshMock).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Hub daemon unavailable:"));
  });
});
