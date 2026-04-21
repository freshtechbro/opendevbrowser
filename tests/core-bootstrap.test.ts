import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { resolveConfig, type OpenDevBrowserConfig } from "../src/config";
import type { AnnotationCommand, AnnotationResponse } from "../src/relay/protocol";

type RelayStatus = { running: boolean; port: number | null };

const managerInstances: Array<{
  cacheRoot: string;
  config: OpenDevBrowserConfig;
  closeAll: ReturnType<typeof vi.fn>;
  setChallengeOrchestrator: ReturnType<typeof vi.fn>;
}> = [];
const runnerInstances: Array<{ manager: unknown }> = [];
const skillsInstances: Array<{ root: string; paths: string[] }> = [];

let lastRelay: {
  status: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  setToken: ReturnType<typeof vi.fn>;
  setStoreAgentPayloadHandler: ReturnType<typeof vi.fn>;
} | null = null;
let lastStoreAgentPayloadHandler: ((command: AnnotationCommand) => Promise<AnnotationResponse>) | null = null;

const registerLastRelay = (relay: NonNullable<typeof lastRelay>): void => {
  lastRelay = relay;
};

vi.mock("../src/browser/browser-manager", () => ({
  BrowserManager: class BrowserManager {
    cacheRoot: string;
    config: OpenDevBrowserConfig;
    closeAll = vi.fn().mockResolvedValue(undefined);
    setChallengeOrchestrator = vi.fn();
    constructor(cacheRoot: string, config: OpenDevBrowserConfig) {
      this.cacheRoot = cacheRoot;
      this.config = config;
      managerInstances.push({
        cacheRoot,
        config,
        closeAll: this.closeAll,
        setChallengeOrchestrator: this.setChallengeOrchestrator
      });
    }
  }
}));

vi.mock("../src/browser/script-runner", () => ({
  ScriptRunner: class ScriptRunner {
    manager: unknown;
    constructor(manager: unknown) {
      this.manager = manager;
      runnerInstances.push({ manager });
    }
  }
}));

vi.mock("../src/skills/skill-loader", () => ({
  SkillLoader: class SkillLoader {
    root: string;
    paths: string[];
    constructor(root: string, paths: string[]) {
      this.root = root;
      this.paths = paths;
      skillsInstances.push({ root, paths });
    }
  }
}));

vi.mock("../src/relay/relay-server", () => ({
  RelayServer: class RelayServer {
    status = vi.fn<[], RelayStatus>(() => ({ running: false, port: null }));
    start = vi.fn(async () => undefined);
    stop = vi.fn();
    setToken = vi.fn();
    setStoreAgentPayloadHandler = vi.fn((handler: (command: AnnotationCommand) => Promise<AnnotationResponse>) => {
      lastStoreAgentPayloadHandler = handler;
    });
    constructor() {
      registerLastRelay(this);
    }
  }
}));

const makeConfig = (overrides: Partial<OpenDevBrowserConfig> = {}): OpenDevBrowserConfig => ({
  headless: true,
  profile: "default",
  snapshot: { maxChars: 16000, maxNodes: 1000 },
  security: { allowRawCDP: false, allowNonLocalCdp: false, allowUnsafeExport: false },
  devtools: { showFullUrls: false, showFullConsole: false },
  export: { maxNodes: 1000, inlineStyles: true },
  desktop: {
    permissionLevel: "off",
    commandTimeoutMs: 10000,
    auditArtifactsDir: ".opendevbrowser/desktop-runtime",
    accessibilityMaxDepth: 2,
    accessibilityMaxChildren: 25
  },
  skills: { nudge: { enabled: true, keywords: [], maxAgeMs: 60000 } },
  continuity: { enabled: true, filePath: "/tmp/continuity.md", nudge: { enabled: true, keywords: [], maxAgeMs: 60000 } },
  relayPort: 8787,
  relayToken: "token",
  daemonPort: 8788,
  daemonToken: "daemon-token",
  flags: [],
  checkForUpdates: false,
  persistProfile: true,
  skillPaths: [],
  ...overrides
});

describe("createOpenDevBrowserCore", () => {
  const originalWarn = console.warn;

  beforeEach(() => {
    managerInstances.length = 0;
    runnerInstances.length = 0;
    skillsInstances.length = 0;
    lastRelay = null;
    lastStoreAgentPayloadHandler = null;
    console.warn = vi.fn();
  });

  afterEach(() => {
    console.warn = originalWarn;
    vi.restoreAllMocks();
  });

  it("creates core components with provided config", async () => {
    const { createOpenDevBrowserCore } = await import("../src/core");
    const config = makeConfig();
    const expectedConfig = resolveConfig(config);
    const core = createOpenDevBrowserCore({ directory: "/tmp/root", config });

    expect(core.cacheRoot).toBe("/tmp/root");
    expect(core.config).toEqual(expectedConfig);
    expect(core.config).not.toBe(config);
    expect(managerInstances[0]?.cacheRoot).toBe("/tmp/root");
    expect(managerInstances[0]?.config).toBe(core.config);
    expect(runnerInstances.length).toBe(1);
    expect(skillsInstances[0]?.paths).toEqual([]);
    expect(lastRelay?.setToken).toHaveBeenCalledWith("token");
    expect(lastRelay?.setStoreAgentPayloadHandler).toHaveBeenCalledTimes(1);
    expect(core.agentInbox).toBeTruthy();
    expect(core.desktopRuntime).toBeTruthy();
    expect(core.automationCoordinator).toBeTruthy();
    expect(typeof core.observeDesktopAndVerify).toBe("function");
    expect(typeof core.getExtensionPath).toBe("function");
  });

  it("prefers a bounded worktree when cwd lookup throws", async () => {
    const { createOpenDevBrowserCore } = await import("../src/core");
    const previousPwd = process.env.PWD;
    process.env.PWD = "/";
    const cwdSpy = vi.spyOn(process, "cwd").mockImplementation(() => {
      throw new Error("cwd unavailable");
    });

    try {
      const core = createOpenDevBrowserCore({
        directory: "/tmp/root",
        worktree: "/tmp/worktree",
        config: makeConfig()
      });

      expect(core.cacheRoot).toBe("/tmp/worktree");
      expect(managerInstances[0]?.cacheRoot).toBe("/tmp/worktree");
      expect(skillsInstances[0]?.root).toBe("/tmp/worktree");
      expect(cwdSpy).not.toHaveBeenCalled();
    } finally {
      process.env.PWD = previousPwd;
    }
  });

  it("falls back to the caller directory when worktree resolves to filesystem root", async () => {
    const { createOpenDevBrowserCore } = await import("../src/core");
    const core = createOpenDevBrowserCore({
      directory: "/tmp/root",
      worktree: "/",
      config: makeConfig()
    });

    expect(core.cacheRoot).toBe("/tmp/root");
    expect(managerInstances[0]?.cacheRoot).toBe("/tmp/root");
  });

  it("falls back to process cwd when directory resolves to filesystem root", async () => {
    const { createOpenDevBrowserCore } = await import("../src/core");
    const previousPwd = process.env.PWD;
    process.env.PWD = "/";
    vi.spyOn(process, "cwd").mockReturnValue("/tmp/from-cwd");

    try {
      const core = createOpenDevBrowserCore({
        directory: "/",
        config: makeConfig()
      });

      expect(core.cacheRoot).toBe("/tmp/from-cwd");
      expect(managerInstances[0]?.cacheRoot).toBe("/tmp/from-cwd");
    } finally {
      process.env.PWD = previousPwd;
    }
  });

  it("rejects filesystem root when no bounded project directory is available", async () => {
    const { createOpenDevBrowserCore } = await import("../src/core");
    const previousPwd = process.env.PWD;
    process.env.PWD = "/";
    vi.spyOn(process, "cwd").mockReturnValue("/");

    try {
      expect(() => createOpenDevBrowserCore({
        directory: "/",
        worktree: "/",
        config: makeConfig()
      })).toThrow("OpenDevBrowser requires a non-root project/worktree directory.");
    } finally {
      process.env.PWD = previousPwd;
    }
  });

  it("rejects store_agent_payload requests without a payload", async () => {
    const { createOpenDevBrowserCore } = await import("../src/core");
    createOpenDevBrowserCore({ directory: "/tmp/root", config: makeConfig() });

    const response = await lastStoreAgentPayloadHandler?.({
      version: 1,
      requestId: "req-missing",
      command: "store_agent_payload"
    } as AnnotationCommand);

    expect(response).toEqual({
      version: 1,
      requestId: "req-missing",
      status: "error",
      error: {
        code: "invalid_request",
        message: "Annotation payload required for store_agent_payload."
      }
    });
  });

  it("applies default source and label when storing agent payloads", async () => {
    const { createOpenDevBrowserCore } = await import("../src/core");
    const core = createOpenDevBrowserCore({ directory: "/tmp/root", config: makeConfig() });
    core.agentInbox.registerScope("session-1");

    const response = await lastStoreAgentPayloadHandler?.({
      version: 1,
      requestId: "req-store",
      command: "store_agent_payload",
      payload: {
        url: "https://example.com",
        timestamp: "2026-03-15T00:00:00.000Z",
        screenshotMode: "visible",
        annotations: []
      }
    } as AnnotationCommand);

    expect(response).toMatchObject({
      version: 1,
      requestId: "req-store",
      status: "ok",
      receipt: {
        source: "popup_all",
        label: "Popup annotation payload",
        deliveryState: "delivered",
        storedFallback: false
      }
    });
  });

  it("loads config defaults when not provided", async () => {
    const config = resolveConfig(makeConfig());
    const configModule = await import("../src/config");
    const spy = vi.spyOn(configModule, "loadGlobalConfig").mockReturnValue(config);
    const { createOpenDevBrowserCore } = await import("../src/core/bootstrap");

    const core = createOpenDevBrowserCore({ directory: "/tmp/root" });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(core.config).toBe(config);
  });

  it("wires configured challenge orchestration into the browser managers", async () => {
    const { createOpenDevBrowserCore } = await import("../src/core/bootstrap");
    const config = resolveConfig({
      ...makeConfig(),
      providers: {
        challengeOrchestration: {
          mode: "browser_with_helper"
        }
      }
    });

    createOpenDevBrowserCore({ directory: "/tmp/root", config });

    expect(managerInstances[0]?.setChallengeOrchestrator).toHaveBeenCalled();
    expect(managerInstances[0]?.setChallengeOrchestrator.mock.calls[0]?.[0]).toBeDefined();
  });

  it("exposes a composed internal desktop observation and verification flow", async () => {
    vi.resetModules();
    const observation = {
      observationId: "obs-1",
      requestedAt: "2026-04-08T00:00:00.000Z",
      browserSessionId: "browser-session",
      status: {
        platform: "darwin" as const,
        permissionLevel: "observe" as const,
        available: true,
        capabilities: ["observe.windows"] as const,
        auditArtifactsDir: "/tmp/desktop-audits"
      }
    };
    const verification = {
      observationId: "obs-1",
      verifiedAt: "2026-04-08T00:00:01.000Z",
      review: {
        sessionId: "browser-session",
        mode: "managed" as const,
        snapshotId: "snapshot-1",
        url: "https://example.com",
        title: "Example Domain",
        content: "[r1] heading \"Example Domain\"",
        truncated: false,
        refCount: 1,
        timingMs: 1
      }
    };
    const requestDesktopObservation = vi.fn(async () => observation);
    const verifyAfterDesktopObservation = vi.fn(async () => verification);
    const providerRuntime = {
      search: vi.fn(),
      fetch: vi.fn(),
      crawl: vi.fn(),
      post: vi.fn()
    };
    const desktopRuntime = {
      status: vi.fn(),
      listWindows: vi.fn(),
      activeWindow: vi.fn(),
      captureDesktop: vi.fn(),
      captureWindow: vi.fn(),
      accessibilitySnapshot: vi.fn()
    };
    const createCoreRuntimeAssemblies = vi.fn(() => ({
      providerRuntime,
      desktopRuntime,
      automationCoordinator: {
        desktopAvailable: vi.fn(),
        requestDesktopObservation,
        verifyAfterDesktopObservation
      }
    }));

    vi.doMock("../src/core/runtime-assemblies", () => ({
      createCoreRuntimeAssemblies
    }));

    try {
      const { createOpenDevBrowserCore } = await import("../src/core/bootstrap");
      const core = createOpenDevBrowserCore({ directory: "/tmp/root", config: makeConfig() });
      const result = await core.observeDesktopAndVerify({
        reason: "live desktop proof",
        browserSessionId: "browser-session",
        targetId: "target-1",
        targetWindowHint: {
          ownerName: "Google Chrome",
          title: "Example Domain"
        },
        includeWindows: true,
        capture: "hinted_window",
        accessibility: "hinted_window",
        maxChars: 2048,
        cursor: "80"
      });

      expect(createCoreRuntimeAssemblies).toHaveBeenCalledOnce();
      expect(requestDesktopObservation).toHaveBeenCalledWith({
        reason: "live desktop proof",
        browserSessionId: "browser-session",
        targetWindowHint: {
          ownerName: "Google Chrome",
          title: "Example Domain"
        },
        includeWindows: true,
        capture: "hinted_window",
        accessibility: "hinted_window"
      });
      expect(verifyAfterDesktopObservation).toHaveBeenCalledWith({
        browserSessionId: "browser-session",
        targetId: "target-1",
        observationId: "obs-1",
        maxChars: 2048,
        cursor: "80"
      });
      expect(requestDesktopObservation.mock.invocationCallOrder[0]).toBeLessThan(
        verifyAfterDesktopObservation.mock.invocationCallOrder[0]!
      );
      expect(result).toEqual({
        observation,
        verification
      });
    } finally {
      vi.doUnmock("../src/core/runtime-assemblies");
      vi.resetModules();
    }
  });

  it("omits browserFallbackPort when the fallback factory returns undefined", async () => {
    vi.resetModules();
    const actual = await vi.importActual<typeof import("../src/providers/runtime-factory")>("../src/providers/runtime-factory");
    const providerRuntime = {
      search: vi.fn(),
      fetch: vi.fn(),
      crawl: vi.fn(),
      post: vi.fn()
    };
    vi.doMock("../src/providers/runtime-factory", () => ({
      ...actual,
      createBrowserFallbackPort: vi.fn(() => undefined),
      createConfiguredProviderRuntime: vi.fn(() => providerRuntime)
    }));

    try {
      const { createOpenDevBrowserCore } = await import("../src/core/bootstrap");
      const core = createOpenDevBrowserCore({ directory: "/tmp/root", config: makeConfig() });
      const runtimeFactory = await import("../src/providers/runtime-factory");

      expect(runtimeFactory.createBrowserFallbackPort).toHaveBeenCalledOnce();
      expect(core).not.toHaveProperty("browserFallbackPort");
      expect(core.providerRuntime).toBe(providerRuntime);
    } finally {
      vi.doUnmock("../src/providers/runtime-factory");
      vi.resetModules();
    }
  });

  it("omits verification cursor when observeDesktopAndVerify is called without one", async () => {
    vi.resetModules();
    const observation = { observationId: "obs-no-cursor" };
    const verification = { review: "verified" };
    const requestDesktopObservation = vi.fn(async () => observation);
    const verifyAfterDesktopObservation = vi.fn(async () => verification);

    vi.doMock("../src/core/runtime-assemblies", () => ({
      createCoreRuntimeAssemblies: () => ({
        providerRuntime: {
          search: vi.fn(),
          fetch: vi.fn(),
          crawl: vi.fn(),
          post: vi.fn()
        },
        desktopRuntime: {
          status: vi.fn(),
          listWindows: vi.fn(),
          activeWindow: vi.fn(),
          captureDesktop: vi.fn(),
          captureWindow: vi.fn(),
          accessibilitySnapshot: vi.fn()
        },
        automationCoordinator: {
          desktopAvailable: vi.fn(),
          requestDesktopObservation,
          verifyAfterDesktopObservation
        }
      })
    }));

    try {
      const { createOpenDevBrowserCore } = await import("../src/core/bootstrap");
      const core = createOpenDevBrowserCore({ directory: "/tmp/root", config: makeConfig() });

      await core.observeDesktopAndVerify({
        reason: "no cursor",
        browserSessionId: "browser-session",
        includeWindows: false,
        capture: "none",
        accessibility: "none"
      });

      expect(verifyAfterDesktopObservation).toHaveBeenCalledWith({
        browserSessionId: "browser-session",
        targetId: undefined,
        observationId: "obs-no-cursor",
        maxChars: undefined
      });
    } finally {
      vi.doUnmock("../src/core/runtime-assemblies");
      vi.resetModules();
    }
  });

  it("stops relay when disabled or invalid port", async () => {
    const { createOpenDevBrowserCore } = await import("../src/core/bootstrap");
    const config = makeConfig({ relayToken: false });
    const core = createOpenDevBrowserCore({ directory: "/tmp/root", config });

    await core.ensureRelay(-1);
    expect(lastRelay?.stop).toHaveBeenCalledTimes(1);

    await core.ensureRelay(8787);
    expect(lastRelay?.stop).toHaveBeenCalledTimes(2);
  });

  it("does nothing when relay is already running on the same port", async () => {
    const { createOpenDevBrowserCore } = await import("../src/core/bootstrap");
    const config = makeConfig();
    const core = createOpenDevBrowserCore({ directory: "/tmp/root", config });

    lastRelay?.status.mockReturnValue({ running: true, port: 8787 });
    await core.ensureRelay(8787);

    expect(lastRelay?.start).not.toHaveBeenCalled();
    expect(lastRelay?.stop).not.toHaveBeenCalled();
  });

  it("restarts relay when port changes", async () => {
    const { createOpenDevBrowserCore } = await import("../src/core/bootstrap");
    const config = makeConfig();
    const core = createOpenDevBrowserCore({ directory: "/tmp/root", config });

    lastRelay?.status.mockReturnValue({ running: true, port: 9000 });
    await core.ensureRelay(8787);

    expect(lastRelay?.stop).toHaveBeenCalledTimes(1);
    expect(lastRelay?.start).toHaveBeenCalledWith(8787);
  });

  it("warns when relay port is already in use", async () => {
    const { createOpenDevBrowserCore } = await import("../src/core/bootstrap");
    const config = makeConfig();
    const core = createOpenDevBrowserCore({ directory: "/tmp/root", config });

    lastRelay?.status.mockReturnValue({ running: false, port: null });
    lastRelay?.start.mockRejectedValue(new Error("EADDRINUSE"));
    await core.ensureRelay(8787);

    expect(console.warn).toHaveBeenCalled();
  });

  it("warns when relay fails for other reasons", async () => {
    const { createOpenDevBrowserCore } = await import("../src/core/bootstrap");
    const config = makeConfig();
    const core = createOpenDevBrowserCore({ directory: "/tmp/root", config });

    lastRelay?.status.mockReturnValue({ running: false, port: null });
    lastRelay?.start.mockRejectedValue(new Error("boom"));
    await core.ensureRelay(8787);

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Failed to start relay server"));
  });

  it("formats non-error relay failures", async () => {
    const { createOpenDevBrowserCore } = await import("../src/core/bootstrap");
    const config = makeConfig();
    const core = createOpenDevBrowserCore({ directory: "/tmp/root", config });

    lastRelay?.status.mockReturnValue({ running: false, port: null });
    lastRelay?.start.mockRejectedValue("boom");
    await core.ensureRelay(8787);

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Failed to start relay server"));
  });

  it("cleans up relay and manager", async () => {
    const { createOpenDevBrowserCore } = await import("../src/core/bootstrap");
    const config = makeConfig();
    const core = createOpenDevBrowserCore({ directory: "/tmp/root", config });

    core.cleanup();
    expect(lastRelay?.stop).toHaveBeenCalledTimes(1);
    expect(managerInstances[0]?.closeAll).toHaveBeenCalledTimes(1);
  });
});
