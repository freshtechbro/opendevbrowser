import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { OpenDevBrowserConfig } from "../src/config";

type RelayStatus = { running: boolean; port: number | null };

const managerInstances: Array<{ cacheRoot: string; config: OpenDevBrowserConfig; closeAll: ReturnType<typeof vi.fn> }> = [];
const runnerInstances: Array<{ manager: unknown }> = [];
const skillsInstances: Array<{ root: string; paths: string[] }> = [];

let lastRelay: {
  status: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  setToken: ReturnType<typeof vi.fn>;
} | null = null;

vi.mock("../src/browser/browser-manager", () => ({
  BrowserManager: class BrowserManager {
    cacheRoot: string;
    config: OpenDevBrowserConfig;
    closeAll = vi.fn().mockResolvedValue(undefined);
    constructor(cacheRoot: string, config: OpenDevBrowserConfig) {
      this.cacheRoot = cacheRoot;
      this.config = config;
      managerInstances.push({ cacheRoot, config, closeAll: this.closeAll });
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
    constructor() {
      lastRelay = this;
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
  skills: { nudge: { enabled: true, keywords: [], maxAgeMs: 60000 } },
  continuity: { enabled: true, filePath: "/tmp/continuity.md", nudge: { enabled: true, keywords: [], maxAgeMs: 60000 } },
  relayPort: 8787,
  relayToken: "token",
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
    console.warn = vi.fn();
  });

  afterEach(() => {
    console.warn = originalWarn;
    vi.restoreAllMocks();
  });

  it("creates core components with provided config", async () => {
    const { createOpenDevBrowserCore } = await import("../src/core");
    const config = makeConfig();
    const core = createOpenDevBrowserCore({ directory: "/tmp/root", config });

    expect(core.cacheRoot).toBe("/tmp/root");
    expect(core.config).toBe(config);
    expect(managerInstances[0]?.cacheRoot).toBe("/tmp/root");
    expect(managerInstances[0]?.config).toBe(config);
    expect(runnerInstances.length).toBe(1);
    expect(skillsInstances[0]?.paths).toEqual([]);
    expect(lastRelay?.setToken).toHaveBeenCalledWith("token");
    expect(typeof core.getExtensionPath).toBe("function");
  });

  it("loads config defaults when not provided", async () => {
    const config = makeConfig();
    const configModule = await import("../src/config");
    const spy = vi.spyOn(configModule, "loadGlobalConfig").mockReturnValue(config);
    const { createOpenDevBrowserCore } = await import("../src/core/bootstrap");

    const core = createOpenDevBrowserCore({ directory: "/tmp/root" });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(core.config).toBe(config);
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
