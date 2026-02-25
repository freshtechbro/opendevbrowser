import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedArgs } from "../src/cli/args";
import type { OpenDevBrowserConfig } from "../src/config";

const mocks = vi.hoisted(() => ({
  startDaemon: vi.fn(),
  readDaemonMetadata: vi.fn(),
  fetchDaemonStatus: vi.fn(),
  loadGlobalConfig: vi.fn(),
  fetchWithTimeout: vi.fn(),
  discoverExtensionId: vi.fn(),
  getNativeStatusSnapshot: vi.fn(),
  installNativeHost: vi.fn(),
  spawnSync: vi.fn()
}));

vi.mock("../src/cli/daemon", () => ({
  startDaemon: mocks.startDaemon,
  readDaemonMetadata: mocks.readDaemonMetadata
}));

vi.mock("../src/config", () => ({
  loadGlobalConfig: mocks.loadGlobalConfig
}));

vi.mock("../src/cli/daemon-status", () => ({
  fetchDaemonStatus: mocks.fetchDaemonStatus
}));

vi.mock("../src/cli/utils/http", () => ({
  fetchWithTimeout: mocks.fetchWithTimeout
}));

vi.mock("../src/cli/commands/native", () => ({
  discoverExtensionId: mocks.discoverExtensionId,
  getNativeStatusSnapshot: mocks.getNativeStatusSnapshot,
  installNativeHost: mocks.installNativeHost
}));

vi.mock("node:child_process", () => ({
  spawnSync: mocks.spawnSync
}));

import { runServe } from "../src/cli/commands/serve";

const makeArgs = (rawArgs: string[]): ParsedArgs => ({
  command: "serve",
  mode: undefined,
  withConfig: false,
  noPrompt: true,
  noInteractive: true,
  quiet: false,
  outputFormat: "json",
  transport: "relay",
  skillsMode: "none",
  fullInstall: false,
  rawArgs
});

const makeConfig = (nativeExtensionId?: string): OpenDevBrowserConfig => ({
  headless: false,
  profile: "default",
  snapshot: { maxChars: 16000, maxNodes: 1000 },
  security: { allowRawCDP: false, allowNonLocalCdp: false, allowUnsafeExport: false },
  devtools: { showFullUrls: false, showFullConsole: false },
  export: { maxNodes: 1000, inlineStyles: true },
  skills: { nudge: { enabled: true, keywords: [], maxAgeMs: 60000 } },
  continuity: { enabled: true, filePath: "opendevbrowser_continuity.md", nudge: { enabled: true, keywords: [], maxAgeMs: 60000 } },
  relayPort: 8787,
  relayToken: "relay-token",
  nativeExtensionId,
  daemonPort: 8788,
  daemonToken: "daemon-token",
  flags: [],
  checkForUpdates: false,
  persistProfile: true,
  skillPaths: []
});

describe("serve command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readDaemonMetadata.mockReturnValue(null);
    mocks.fetchDaemonStatus.mockResolvedValue(null);
    mocks.fetchWithTimeout.mockResolvedValue({ ok: true });
    mocks.spawnSync.mockReturnValue({ status: 1, stdout: "" });
    mocks.startDaemon.mockResolvedValue({
      state: { port: 8788, pid: 1234, relayPort: 8787 },
      stop: vi.fn()
    });
  });

  it("does not attempt native install when host is already installed", async () => {
    const config = makeConfig("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    mocks.loadGlobalConfig.mockReturnValue(config);
    mocks.getNativeStatusSnapshot.mockReturnValue({
      installed: true,
      manifestPath: "/tmp/manifest.json",
      wrapperPath: "/tmp/wrapper.sh",
      hostScriptPath: "/tmp/host.cjs",
      extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      registryPath: null
    });

    const result = await runServe(makeArgs([]));

    expect(result.success).toBe(true);
    expect(result.message).toBe("Daemon running on 127.0.0.1:8788 (relay 8787)");
    expect(mocks.discoverExtensionId).not.toHaveBeenCalled();
    expect(mocks.installNativeHost).not.toHaveBeenCalled();
    expect(mocks.startDaemon).toHaveBeenCalledWith({ port: undefined, token: undefined, config });
  });

  it("returns a graceful success when daemon is already running", async () => {
    const config = makeConfig("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    mocks.loadGlobalConfig.mockReturnValue(config);
    mocks.readDaemonMetadata.mockReturnValue({
      port: 8788,
      token: "daemon-token",
      pid: 8080,
      relayPort: 8787,
      startedAt: new Date().toISOString()
    });
    mocks.fetchDaemonStatus.mockResolvedValue({
      ok: true,
      pid: 8080,
      hub: { instanceId: "hub-1" },
      relay: {
        extensionConnected: false,
        extensionHandshakeComplete: false,
        cdpConnected: false,
        annotationConnected: false,
        opsConnected: false,
        pairingRequired: false,
        port: 8787,
        tokenConfigured: true,
        health: { status: "ok", reason: "ready" }
      },
      binding: null
    });

    const result = await runServe(makeArgs([]));

    expect(result.success).toBe(true);
    expect(result.message).toBe("Daemon already running on 127.0.0.1:8788 (pid=8080, relay 8787).");
    expect(result.data).toMatchObject({
      port: 8788,
      pid: 8080,
      relayPort: 8787,
      alreadyRunning: true
    });
    expect(mocks.startDaemon).not.toHaveBeenCalled();
    expect(mocks.getNativeStatusSnapshot).not.toHaveBeenCalled();
  });

  it("installs using configured nativeExtensionId when host is missing", async () => {
    const config = makeConfig("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    mocks.loadGlobalConfig.mockReturnValue(config);
    mocks.getNativeStatusSnapshot
      .mockReturnValueOnce({
        installed: false,
        manifestPath: null,
        wrapperPath: null,
        hostScriptPath: "/tmp/host.cjs",
        extensionId: null,
        registryPath: null
      })
      .mockReturnValueOnce({
        installed: true,
        manifestPath: "/tmp/manifest.json",
        wrapperPath: "/tmp/wrapper.sh",
        hostScriptPath: "/tmp/host.cjs",
        extensionId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        registryPath: null
      });
    mocks.discoverExtensionId.mockReturnValue({ extensionId: "cccccccccccccccccccccccccccccccc", matchedBy: "path" });
    mocks.installNativeHost.mockReturnValue({
      success: true,
      message: "Native host installed for extension bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb."
    });

    const result = await runServe(makeArgs([]));

    expect(mocks.installNativeHost).toHaveBeenCalledWith("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    expect(result.success).toBe(true);
    expect(result.message).toContain("Native host installed for extension bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.");
    expect(result.data?.native).toEqual({
      installed: true,
      manifestPath: "/tmp/manifest.json",
      wrapperPath: "/tmp/wrapper.sh",
      hostScriptPath: "/tmp/host.cjs",
      extensionId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      registryPath: null
    });
    expect(mocks.startDaemon).toHaveBeenCalledWith({ port: undefined, token: undefined, config });
  });

  it("installs using discovered extension id when config id is missing", async () => {
    const config = makeConfig(undefined);
    mocks.loadGlobalConfig.mockReturnValue(config);
    mocks.getNativeStatusSnapshot
      .mockReturnValueOnce({
        installed: false,
        manifestPath: null,
        wrapperPath: null,
        hostScriptPath: "/tmp/host.cjs",
        extensionId: null,
        registryPath: null
      })
      .mockReturnValueOnce({
        installed: true,
        manifestPath: "/tmp/manifest.json",
        wrapperPath: "/tmp/wrapper.sh",
        hostScriptPath: "/tmp/host.cjs",
        extensionId: "dddddddddddddddddddddddddddddddd",
        registryPath: null
      });
    mocks.discoverExtensionId.mockReturnValue({
      extensionId: "dddddddddddddddddddddddddddddddd",
      matchedBy: "name"
    });
    mocks.installNativeHost.mockReturnValue({
      success: true,
      message: "Native host installed for extension dddddddddddddddddddddddddddddddd."
    });

    const result = await runServe(makeArgs([]));

    expect(mocks.installNativeHost).toHaveBeenCalledWith("dddddddddddddddddddddddddddddddd");
    expect(result.success).toBe(true);
    expect(result.message).toContain("(auto-detected by name)");
    expect(mocks.startDaemon).toHaveBeenCalledWith({ port: undefined, token: undefined, config });
  });

  it("continues startup with warning when no extension id is available", async () => {
    const config = makeConfig(undefined);
    mocks.loadGlobalConfig.mockReturnValue(config);
    mocks.getNativeStatusSnapshot.mockReturnValue({
      installed: false,
      manifestPath: null,
      wrapperPath: null,
      hostScriptPath: "/tmp/host.cjs",
      extensionId: null,
      registryPath: null
    });
    mocks.discoverExtensionId.mockReturnValue({ extensionId: null });

    const result = await runServe(makeArgs([]));

    expect(mocks.installNativeHost).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.message).toContain(
      "Native host not installed. Set nativeExtensionId in opendevbrowser.jsonc to auto-install."
    );
    expect(mocks.startDaemon).toHaveBeenCalledWith({ port: undefined, token: undefined, config });
  });

  it("continues startup when native install fails", async () => {
    const config = makeConfig("eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
    mocks.loadGlobalConfig.mockReturnValue(config);
    mocks.getNativeStatusSnapshot.mockReturnValue({
      installed: false,
      manifestPath: null,
      wrapperPath: null,
      hostScriptPath: "/tmp/host.cjs",
      extensionId: null,
      registryPath: null
    });
    mocks.discoverExtensionId.mockReturnValue({ extensionId: null });
    mocks.installNativeHost.mockReturnValue({
      success: false,
      message: "Native install failed: boom"
    });

    const result = await runServe(makeArgs([]));

    expect(mocks.installNativeHost).toHaveBeenCalledWith("eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
    expect(result.success).toBe(true);
    expect(result.message).toContain("Native host install skipped: Native install failed: boom");
    expect(mocks.startDaemon).toHaveBeenCalledWith({ port: undefined, token: undefined, config });
  });

  it("returns graceful daemon-running message when startup hits EADDRINUSE and daemon is reachable", async () => {
    const config = makeConfig("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    mocks.loadGlobalConfig.mockReturnValue(config);
    mocks.startDaemon.mockRejectedValueOnce(new Error("listen EADDRINUSE: address already in use 127.0.0.1:8788"));
    mocks.fetchDaemonStatus
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ok: true,
        pid: 9999,
        hub: { instanceId: "hub-1" },
        relay: {
          extensionConnected: false,
          extensionHandshakeComplete: false,
          cdpConnected: false,
          annotationConnected: false,
          opsConnected: false,
          pairingRequired: false,
          port: 8787,
          tokenConfigured: true,
          health: { status: "ok", reason: "ready" }
        },
        binding: null
      });

    const result = await runServe(makeArgs([]));

    expect(result.success).toBe(true);
    expect(result.message).toBe("Daemon already running on 127.0.0.1:8788 (pid=9999, relay 8787).");
    expect(result.data).toMatchObject({
      port: 8788,
      pid: 9999,
      relayPort: 8787,
      alreadyRunning: true
    });
  });

  it("returns clear guidance when port is busy but daemon cannot be verified", async () => {
    const config = makeConfig("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    mocks.loadGlobalConfig.mockReturnValue(config);
    mocks.startDaemon.mockRejectedValueOnce(new Error("listen EADDRINUSE: address already in use 127.0.0.1:8788"));
    mocks.fetchDaemonStatus.mockResolvedValue(null);

    const result = await runServe(makeArgs([]));

    expect(result.success).toBe(false);
    expect(result.message).toContain("Daemon port 8788 is already in use by another process.");
    expect(result.message).toContain("opendevbrowser status --daemon");
  });

  it("clears stale serve daemons before startup", async () => {
    const config = makeConfig("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    mocks.loadGlobalConfig.mockReturnValue(config);
    mocks.spawnSync.mockReturnValue({
      status: 0,
      stdout: [
        `${process.pid} /opt/homebrew/bin/node /repo/dist/cli/index.js serve --output-format json`,
        `${process.ppid} npm exec opendevbrowser serve --output-format json`,
        "7777 /opt/homebrew/bin/node /repo/node_modules/.bin/opendevbrowser serve --output-format json",
        "8888 /opt/homebrew/bin/node /repo/dist/cli/index.js serve --output-format json"
      ].join("\n")
    });
    const killSpy = vi.spyOn(process, "kill").mockReturnValue(true);

    const result = await runServe(makeArgs([]));

    expect(result.success).toBe(true);
    expect(result.message).toContain("Cleared 2 stale daemon processes.");
    expect(killSpy).toHaveBeenCalledWith(7777, "SIGTERM");
    expect(killSpy).toHaveBeenCalledWith(8888, "SIGTERM");
    expect(killSpy).toHaveBeenCalledWith(7777, "SIGKILL");
    expect(killSpy).toHaveBeenCalledWith(8888, "SIGKILL");
    killSpy.mockRestore();
  });

  it("keeps the active daemon pid when cleaning stale serve daemons", async () => {
    const config = makeConfig("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    mocks.loadGlobalConfig.mockReturnValue(config);
    mocks.readDaemonMetadata.mockReturnValue({
      port: 8788,
      token: "daemon-token",
      pid: 8080,
      relayPort: 8787,
      startedAt: new Date().toISOString()
    });
    mocks.fetchDaemonStatus.mockResolvedValue({
      ok: true,
      pid: 8080,
      hub: { instanceId: "hub-1" },
      relay: {
        extensionConnected: false,
        extensionHandshakeComplete: false,
        cdpConnected: false,
        annotationConnected: false,
        opsConnected: false,
        pairingRequired: false,
        port: 8787,
        tokenConfigured: true,
        health: { status: "ok", reason: "ready" }
      },
      binding: null
    });
    mocks.spawnSync.mockReturnValue({
      status: 0,
      stdout: [
        "8080 /opt/homebrew/bin/node /repo/node_modules/.bin/opendevbrowser serve --output-format json",
        "9999 /opt/homebrew/bin/node /repo/dist/cli/index.js serve --output-format json"
      ].join("\n")
    });
    const killSpy = vi.spyOn(process, "kill").mockReturnValue(true);

    const result = await runServe(makeArgs([]));

    expect(result.success).toBe(true);
    expect(result.message).toContain("Cleared 1 stale daemon process.");
    expect(killSpy).toHaveBeenCalledWith(9999, "SIGTERM");
    expect(killSpy).not.toHaveBeenCalledWith(8080, "SIGTERM");
    killSpy.mockRestore();
  });
});
