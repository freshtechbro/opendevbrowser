import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedArgs } from "../src/cli/args";
import type { OpenDevBrowserConfig } from "../src/config";

const mocks = vi.hoisted(() => ({
  startDaemon: vi.fn(),
  readDaemonMetadata: vi.fn(),
  getCurrentDaemonFingerprint: vi.fn(),
  isCurrentDaemonFingerprint: vi.fn(),
  createDaemonStopHeaders: vi.fn(),
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
  readDaemonMetadata: mocks.readDaemonMetadata,
  getCurrentDaemonFingerprint: mocks.getCurrentDaemonFingerprint,
  isCurrentDaemonFingerprint: mocks.isCurrentDaemonFingerprint,
  createDaemonStopHeaders: mocks.createDaemonStopHeaders
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

const CURRENT_UID = typeof process.getuid === "function" ? process.getuid() : 501;
const CURRENT_CLI_ENTRYPOINT = process.argv[1] ?? "/repo/dist/cli/index.js";
const DEFAULT_SERVE_COMMAND = `${process.execPath} ${CURRENT_CLI_ENTRYPOINT} serve --port 8788 --output-format json`;

const makePsLine = (
  pid: number,
  options: {
    uid?: number;
    command?: string;
  } = {}
): string => {
  return `${pid} ${options.uid ?? CURRENT_UID} ${options.command ?? DEFAULT_SERVE_COMMAND}\n`;
};

describe("serve command", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.readDaemonMetadata.mockReturnValue(null);
    mocks.getCurrentDaemonFingerprint.mockReturnValue("current-fingerprint");
    mocks.isCurrentDaemonFingerprint.mockImplementation((fingerprint: string | null | undefined) => {
      return fingerprint === "current-fingerprint";
    });
    mocks.createDaemonStopHeaders.mockImplementation((token: string, reason: string) => ({
      Authorization: `Bearer ${token}`,
      "x-test-stop-reason": reason
    }));
    mocks.fetchDaemonStatus.mockResolvedValue(null);
    mocks.fetchWithTimeout.mockResolvedValue({ ok: true });
    mocks.getNativeStatusSnapshot.mockReturnValue({
      installed: true,
      manifestPath: "/tmp/manifest.json",
      wrapperPath: "/tmp/wrapper.sh",
      hostScriptPath: "/tmp/host.cjs",
      extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      registryPath: null
    });
    mocks.discoverExtensionId.mockReturnValue({ extensionId: null });
    mocks.installNativeHost.mockReturnValue({ success: false, message: "unused" });
    mocks.spawnSync.mockReturnValue({ status: 1, stdout: "" });
    mocks.startDaemon.mockResolvedValue({
      state: { port: 8788, pid: 1234, relayPort: 8787 },
      stop: vi.fn()
    });
  });

  it("tags explicit stop requests for debug attribution", async () => {
    mocks.readDaemonMetadata.mockReturnValue({
      port: 8788,
      token: "daemon-token",
      pid: 8080,
      relayPort: 8787,
      startedAt: new Date().toISOString(),
      fingerprint: "current-fingerprint"
    });

    const result = await runServe(makeArgs(["--stop"]));

    expect(result.success).toBe(true);
    expect(mocks.createDaemonStopHeaders).toHaveBeenCalledWith("daemon-token", "serve.stop");
    expect(mocks.fetchWithTimeout).toHaveBeenCalledWith(
      "http://127.0.0.1:8788/stop",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer daemon-token",
          "x-test-stop-reason": "serve.stop"
        }
      }
    );
  });

  it("rejects unsupported daemon flag before starting a shell-owned foreground daemon", async () => {
    await expect(runServe(makeArgs(["--daemon"]))).rejects.toMatchObject({
      exitCode: 1,
      message: expect.stringContaining("serve --daemon")
    });
    expect(mocks.startDaemon).not.toHaveBeenCalled();
  });

  it("terminates the recorded foreground serve process when HTTP stop succeeds but the pid remains alive", async () => {
    mocks.readDaemonMetadata.mockReturnValue({
      port: 8788,
      token: "daemon-token",
      pid: 8080,
      relayPort: 8787,
      startedAt: new Date().toISOString(),
      fingerprint: "current-fingerprint"
    });
    mocks.fetchDaemonStatus.mockResolvedValue(null);
    mocks.spawnSync.mockReturnValue({
      status: 0,
      stdout: makePsLine(8080)
    });
    const killSpy = vi.spyOn(process, "kill").mockReturnValue(true);

    const result = await runServe(makeArgs(["--stop"]));

    expect(result.success).toBe(true);
    expect(result.message).toBe("Daemon stopped.");
    expect(killSpy).toHaveBeenCalledWith(8080, "SIGTERM");
    expect(killSpy).toHaveBeenCalledWith(8080, "SIGKILL");
    killSpy.mockRestore();
  });

  it("does not terminate foreground serve processes reported only with a basename node executable", async () => {
    mocks.readDaemonMetadata.mockReturnValue({
      port: 8788,
      token: "daemon-token",
      pid: 8080,
      relayPort: 8787,
      startedAt: new Date().toISOString(),
      fingerprint: "current-fingerprint"
    });
    mocks.fetchDaemonStatus.mockResolvedValue(null);
    mocks.spawnSync.mockReturnValue({
      status: 0,
      stdout: makePsLine(8080, {
        command: "node dist/cli/index.js serve --output-format json"
      })
    });
    const killSpy = vi.spyOn(process, "kill").mockReturnValue(true);

    const result = await runServe(makeArgs(["--stop"]));

    expect(result.success).toBe(true);
    expect(result.message).toBe("Daemon stopped.");
    expect(killSpy).not.toHaveBeenCalled();
    killSpy.mockRestore();
  });

  it("terminates the recorded foreground serve process when HTTP stop is wedged but the pid matches this CLI", async () => {
    mocks.readDaemonMetadata.mockReturnValue({
      port: 8788,
      token: "daemon-token",
      pid: 8080,
      relayPort: 8787,
      startedAt: new Date().toISOString(),
      fingerprint: "current-fingerprint"
    });
    mocks.fetchWithTimeout.mockRejectedValue(new Error("socket hung up"));
    mocks.spawnSync.mockReturnValue({
      status: 0,
      stdout: makePsLine(8080)
    });
    const killSpy = vi.spyOn(process, "kill").mockReturnValue(true);

    const result = await runServe(makeArgs(["--stop"]));

    expect(result.success).toBe(true);
    expect(result.message).toBe("Daemon stopped.");
    expect(killSpy).toHaveBeenCalledWith(8080, "SIGTERM");
    expect(killSpy).toHaveBeenCalledWith(8080, "SIGKILL");
    killSpy.mockRestore();
  });

  it("does not clear competing serve processes reported only with a basename node executable", async () => {
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
      fingerprint: "current-fingerprint",
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
        makePsLine(8080),
        makePsLine(9999, { command: `${process.execPath} /repo/dist/cli/index.js serve --port 8788 --output-format json` })
      ].join("")
    });
    const killSpy = vi.spyOn(process, "kill").mockReturnValue(true);

    const result = await runServe(makeArgs([]));

    expect(result.success).toBe(true);
    expect(result.message).not.toContain("Cleared 1 stale daemon process.");
    expect(result.data).toMatchObject({
      port: 8788,
      pid: 8080,
      staleDaemonsCleared: 0
    });
    expect(killSpy).not.toHaveBeenCalledWith(9999, "SIGTERM");
    expect(killSpy).not.toHaveBeenCalledWith(9999, "SIGKILL");
    killSpy.mockRestore();
  });

  it("reports a stop timeout when the daemon status remains reachable", async () => {
    mocks.readDaemonMetadata.mockReturnValue({
      port: 8788,
      token: "daemon-token",
      pid: 8080,
      relayPort: 8787,
      startedAt: new Date().toISOString(),
      fingerprint: "current-fingerprint"
    });
    mocks.fetchDaemonStatus.mockResolvedValue({
      ok: true,
      pid: 8080,
      fingerprint: "current-fingerprint",
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
      stdout: ""
    });
    const killSpy = vi.spyOn(process, "kill").mockReturnValue(true);

    const result = await runServe(makeArgs(["--stop"]));

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.message).toContain("Timed out waiting for daemon on 127.0.0.1:8788 to stop.");
    expect(killSpy).not.toHaveBeenCalled();
    killSpy.mockRestore();
  });

  it("reports stale fingerprint stop rejections with daemon details", async () => {
    mocks.readDaemonMetadata.mockReturnValue({
      port: 8788,
      token: "daemon-token",
      pid: 8080,
      relayPort: 8787,
      startedAt: new Date().toISOString(),
      fingerprint: "stale-fingerprint"
    });
    mocks.fetchWithTimeout.mockResolvedValue({ ok: false, status: 409 });
    mocks.spawnSync.mockReturnValue({
      status: 0,
      stdout: makePsLine(8080)
    });
    const killSpy = vi.spyOn(process, "kill").mockReturnValue(true);

    const result = await runServe(makeArgs(["--stop"]));

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.message).toContain("rejected stale stop request");
    expect(result.message).toContain("127.0.0.1:8788 pid=8080");
    expect(result.message).toContain("opendevbrowser status --daemon");
    expect(killSpy).not.toHaveBeenCalled();
    killSpy.mockRestore();
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
      fingerprint: "current-fingerprint",
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
    const killSpy = vi.spyOn(process, "kill").mockReturnValue(true);

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
    expect(killSpy).not.toHaveBeenCalled();
    killSpy.mockRestore();
  });

  it("stops a responsive daemon with mismatched fingerprint before starting current daemon", async () => {
    const config = makeConfig("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    mocks.loadGlobalConfig.mockReturnValue(config);
    mocks.readDaemonMetadata.mockReturnValue({
      port: 8788,
      token: "daemon-token",
      pid: 8080,
      relayPort: 8787,
      startedAt: new Date().toISOString()
    });
    mocks.fetchDaemonStatus
      .mockResolvedValueOnce({
        ok: true,
        pid: 8080,
        fingerprint: "stale-fingerprint",
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
      })
      .mockResolvedValueOnce(null);

    const result = await runServe(makeArgs([]));

    expect(result.success).toBe(true);
    expect(result.message).toBe("Daemon running on 127.0.0.1:8788 (relay 8787)");
    expect(mocks.fetchWithTimeout).toHaveBeenCalledWith(
      "http://127.0.0.1:8788/stop",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer daemon-token",
          "x-test-stop-reason": "serve.upgrade"
        }
      },
      1000
    );
    expect(mocks.startDaemon).toHaveBeenCalledWith({ port: undefined, token: undefined, config });
  });

  it("starts current daemon when mismatched daemon exits before stop", async () => {
    const config = makeConfig("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    mocks.loadGlobalConfig.mockReturnValue(config);
    mocks.readDaemonMetadata.mockReturnValue({
      port: 8788,
      token: "daemon-token",
      pid: 8080,
      relayPort: 8787,
      startedAt: new Date().toISOString()
    });
    mocks.fetchDaemonStatus
      .mockResolvedValueOnce({
        ok: true,
        pid: 8080,
        fingerprint: "stale-fingerprint",
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
      })
      .mockResolvedValueOnce(null);
    mocks.fetchWithTimeout.mockRejectedValueOnce(new Error("socket closed"));

    const result = await runServe(makeArgs([]));

    expect(result.success).toBe(true);
    expect(result.message).toBe("Daemon running on 127.0.0.1:8788 (relay 8787)");
    expect(mocks.fetchWithTimeout).toHaveBeenCalledWith(
      "http://127.0.0.1:8788/stop",
      expect.objectContaining({ method: "POST" }),
      1000
    );
    expect(mocks.fetchDaemonStatus).toHaveBeenNthCalledWith(2, 8788, "daemon-token", {
      timeoutMs: 250
    });
    expect(mocks.startDaemon).toHaveBeenCalledWith({ port: undefined, token: undefined, config });
  });

  it("refuses to reuse a fingerprint-protected mismatched daemon", async () => {
    const config = makeConfig("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    mocks.loadGlobalConfig.mockReturnValue(config);
    mocks.readDaemonMetadata.mockReturnValue({
      port: 8788,
      token: "daemon-token",
      pid: 8080,
      relayPort: 8787,
      startedAt: new Date().toISOString()
    });
    mocks.fetchDaemonStatus.mockResolvedValueOnce({
      ok: true,
      pid: 8080,
      fingerprint: "stale-fingerprint",
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
    mocks.fetchWithTimeout.mockResolvedValueOnce({ ok: false, status: 409 });
    const killSpy = vi.spyOn(process, "kill").mockReturnValue(true);

    const result = await runServe(makeArgs([]));

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.message).toContain("protected by a different opendevbrowser build");
    expect(mocks.startDaemon).not.toHaveBeenCalled();
    expect(killSpy).not.toHaveBeenCalled();
    killSpy.mockRestore();
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
        registryPath: null,
        discoveredExtensionId: "cccccccccccccccccccccccccccccccc",
        discoveredMatchedBy: "path",
        expectedExtensionId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        expectedExtensionSource: "config",
        mismatch: false
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
      registryPath: null,
      discoveredExtensionId: "cccccccccccccccccccccccccccccccc",
      discoveredMatchedBy: "path",
      expectedExtensionId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      expectedExtensionSource: "config",
      mismatch: false
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

  it("reinstalls the native host when the installed extension id is stale", async () => {
    const config = makeConfig(undefined);
    mocks.loadGlobalConfig.mockReturnValue(config);
    mocks.getNativeStatusSnapshot
      .mockReturnValueOnce({
        installed: true,
        manifestPath: "/tmp/manifest.json",
        wrapperPath: "/tmp/wrapper.sh",
        hostScriptPath: "/tmp/host.cjs",
        extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        registryPath: null,
        discoveredExtensionId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        discoveredMatchedBy: "path",
        expectedExtensionId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        expectedExtensionSource: "path",
        mismatch: true
      })
      .mockReturnValueOnce({
        installed: true,
        manifestPath: "/tmp/manifest.json",
        wrapperPath: "/tmp/wrapper.sh",
        hostScriptPath: "/tmp/host.cjs",
        extensionId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        registryPath: null,
        discoveredExtensionId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        discoveredMatchedBy: "path",
        expectedExtensionId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        expectedExtensionSource: "path",
        mismatch: false
      });
    mocks.discoverExtensionId.mockReturnValue({
      extensionId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      matchedBy: "path"
    });
    mocks.installNativeHost.mockReturnValue({
      success: true,
      message: "Native host installed for extension bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb."
    });

    const result = await runServe(makeArgs([]));

    expect(mocks.installNativeHost).toHaveBeenCalledWith("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    expect(result.success).toBe(true);
    expect(result.message).toContain(
      "Native host reinstalled for extension bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb (replacing stale aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa)."
    );
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
        fingerprint: "current-fingerprint",
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

  it("reuses the healthy requested-port daemon while evicting only same-port competitors", async () => {
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
      fingerprint: "current-fingerprint",
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
        makePsLine(8080),
        makePsLine(9999),
        makePsLine(2222, { command: `${process.execPath} ${CURRENT_CLI_ENTRYPOINT} serve --port 9999 --output-format json` })
      ].join("")
    });
    const killSpy = vi.spyOn(process, "kill").mockReturnValue(true);

    const result = await runServe(makeArgs([]));

    expect(result.success).toBe(true);
    expect(result.message).toContain("Daemon already running on 127.0.0.1:8788 (pid=8080, relay 8787).");
    expect(result.message).toContain("Cleared 1 stale daemon process.");
    expect(result.data).toMatchObject({
      port: 8788,
      pid: 8080,
      relayPort: 8787,
      alreadyRunning: true,
      staleDaemonsCleared: 1
    });
    expect(mocks.startDaemon).not.toHaveBeenCalled();
    expect(killSpy).toHaveBeenCalledWith(9999, "SIGTERM");
    expect(killSpy).toHaveBeenCalledWith(9999, "SIGKILL");
    expect(killSpy).not.toHaveBeenCalledWith(2222, "SIGTERM");
    expect(killSpy).not.toHaveBeenCalledWith(2222, "SIGKILL");
    expect(killSpy).not.toHaveBeenCalledWith(8080, "SIGTERM");
    killSpy.mockRestore();
  });

  it("clears competing daemon processes even when metadata points at a different pid", async () => {
    const config = makeConfig("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    mocks.loadGlobalConfig.mockReturnValue(config);
    mocks.readDaemonMetadata.mockReturnValue({
      port: 8123,
      token: "stale-token",
      pid: 4444,
      relayPort: 8787,
      startedAt: new Date().toISOString()
    });
    mocks.spawnSync.mockReturnValue({
      status: 0,
      stdout: `${makePsLine(7777)}${makePsLine(8888)}`
    });
    const killSpy = vi.spyOn(process, "kill").mockReturnValue(true);

    const result = await runServe(makeArgs([]));

    expect(result.success).toBe(true);
    expect(result.message).toContain("Cleared 2 stale daemon processes.");
    expect(mocks.startDaemon).toHaveBeenCalledTimes(1);
    expect(killSpy).toHaveBeenCalledWith(7777, "SIGTERM");
    expect(killSpy).toHaveBeenCalledWith(7777, "SIGKILL");
    expect(killSpy).toHaveBeenCalledWith(8888, "SIGTERM");
    expect(killSpy).toHaveBeenCalledWith(8888, "SIGKILL");
    expect(killSpy).not.toHaveBeenCalledWith(4444, "SIGTERM");
    killSpy.mockRestore();
  });

  it("proactively clears discovered stale same-executable daemons before first startup attempt", async () => {
    const config = makeConfig("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    mocks.loadGlobalConfig.mockReturnValue(config);
    mocks.readDaemonMetadata.mockReturnValue({
      port: 8123,
      token: "stale-token",
      pid: 7777,
      relayPort: 8787,
      startedAt: new Date().toISOString()
    });
    mocks.spawnSync.mockReturnValue({
      status: 0,
      stdout: [
        makePsLine(8888),
        makePsLine(9999, { command: `${process.execPath} ${CURRENT_CLI_ENTRYPOINT} serve --port=8788 --output-format json` }),
        makePsLine(2222, { command: `${process.execPath} ${CURRENT_CLI_ENTRYPOINT} serve --port 9999 --output-format json` })
      ].join("")
    });
    const killSpy = vi.spyOn(process, "kill").mockReturnValue(true);

    const result = await runServe(makeArgs([]));

    expect(result.success).toBe(true);
    expect(result.message).toContain("Cleared 2 stale daemon processes.");
    expect(mocks.startDaemon).toHaveBeenCalledTimes(1);
    expect(killSpy).toHaveBeenCalledWith(8888, "SIGTERM");
    expect(killSpy).toHaveBeenCalledWith(8888, "SIGKILL");
    expect(killSpy).toHaveBeenCalledWith(9999, "SIGTERM");
    expect(killSpy).toHaveBeenCalledWith(9999, "SIGKILL");
    expect(killSpy).not.toHaveBeenCalledWith(2222, "SIGTERM");
    expect(killSpy).not.toHaveBeenCalledWith(2222, "SIGKILL");
    expect(killSpy).not.toHaveBeenCalledWith(7777, "SIGTERM");
    expect(killSpy.mock.invocationCallOrder[0]).toBeLessThan(mocks.startDaemon.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER);
    killSpy.mockRestore();
  });

  it("does not kill same-executable daemon processes owned by another user", async () => {
    const config = makeConfig("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    mocks.loadGlobalConfig.mockReturnValue(config);
    mocks.startDaemon.mockRejectedValueOnce(new Error("listen EADDRINUSE: address already in use 127.0.0.1:8788"));
    mocks.spawnSync.mockReturnValue({
      status: 0,
      stdout: makePsLine(7777, { uid: CURRENT_UID + 1 })
    });
    const killSpy = vi.spyOn(process, "kill").mockReturnValue(true);

    const result = await runServe(makeArgs([]));

    expect(result.success).toBe(false);
    expect(result.message).toContain("Daemon port 8788 is already in use by another process.");
    expect(killSpy).not.toHaveBeenCalled();
    killSpy.mockRestore();
  });

  it("does not kill same-user processes that are not long-running opendevbrowser serve daemons", async () => {
    const config = makeConfig("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    mocks.loadGlobalConfig.mockReturnValue(config);
    mocks.spawnSync.mockReturnValue({
      status: 0,
      stdout: [
        makePsLine(7777, { command: `${process.execPath} /repo/node_modules/.bin/opendevbrowser serve --stop --output-format json` }),
        makePsLine(8888, { command: `${process.execPath} /repo/node_modules/.bin/opendevbrowser status --daemon --output-format json` }),
        makePsLine(9999, { command: `${process.execPath} /repo/scripts/not-opendevbrowser.js serve` })
      ].join("")
    });
    const killSpy = vi.spyOn(process, "kill").mockReturnValue(true);

    const result = await runServe(makeArgs([]));

    expect(result.success).toBe(true);
    expect(result.data?.staleDaemonsCleared).toBe(0);
    expect(killSpy).not.toHaveBeenCalled();
    killSpy.mockRestore();
  });

  it("retries startup once after evicting same-executable daemons discovered on EADDRINUSE", async () => {
    const config = makeConfig("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    mocks.loadGlobalConfig.mockReturnValue(config);
    mocks.startDaemon
      .mockRejectedValueOnce(new Error("listen EADDRINUSE: address already in use 127.0.0.1:8788"))
      .mockResolvedValueOnce({
        state: { port: 8788, pid: 1234, relayPort: 8787 },
        stop: vi.fn()
      });
    mocks.fetchDaemonStatus.mockResolvedValue(null);
    mocks.spawnSync
      .mockReturnValueOnce({ status: 0, stdout: "" })
      .mockReturnValueOnce({ status: 0, stdout: makePsLine(7777) });
    const killSpy = vi.spyOn(process, "kill").mockReturnValue(true);

    const result = await runServe(makeArgs([]));

    expect(result.success).toBe(true);
    expect(result.message).toContain("Daemon running on 127.0.0.1:8788 (relay 8787)");
    expect(result.message).toContain("Cleared 1 stale daemon process.");
    expect(mocks.startDaemon).toHaveBeenCalledTimes(2);
    expect(killSpy).toHaveBeenCalledWith(7777, "SIGTERM");
    expect(killSpy).toHaveBeenCalledWith(7777, "SIGKILL");
    killSpy.mockRestore();
  });

  it("does not evict same-node daemons from a different CLI entrypoint on EADDRINUSE", async () => {
    const config = makeConfig("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    mocks.loadGlobalConfig.mockReturnValue(config);
    mocks.startDaemon.mockRejectedValueOnce(new Error("listen EADDRINUSE: address already in use 127.0.0.1:8788"));
    mocks.fetchDaemonStatus.mockResolvedValue(null);
    mocks.spawnSync.mockReturnValue({
      status: 0,
      stdout: makePsLine(7777, {
        command: `${process.execPath} /other/checkout/dist/cli/index.js serve --port 8788 --output-format json`
      })
    });
    const killSpy = vi.spyOn(process, "kill").mockReturnValue(true);

    const result = await runServe(makeArgs([]));

    expect(result.success).toBe(false);
    expect(result.message).toContain("Daemon port 8788 is already in use by another process.");
    expect(mocks.startDaemon).toHaveBeenCalledTimes(1);
    expect(killSpy).not.toHaveBeenCalled();
    killSpy.mockRestore();
  });

  it("stops a healthy daemon when fingerprint does not match", async () => {
    const config = makeConfig("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    mocks.loadGlobalConfig.mockReturnValue(config);
    mocks.readDaemonMetadata.mockReturnValue({
      port: 8788,
      token: "daemon-token",
      pid: 8080,
      relayPort: 8787,
      startedAt: new Date().toISOString(),
      fingerprint: "stale-fingerprint"
    });
    mocks.fetchDaemonStatus
      .mockResolvedValueOnce({
        ok: true,
        pid: 8080,
        fingerprint: "stale-fingerprint",
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
      })
      .mockResolvedValueOnce(null);
    const killSpy = vi.spyOn(process, "kill").mockReturnValue(true);

    const result = await runServe(makeArgs([]));

    expect(result.success).toBe(true);
    expect(result.message).toBe("Daemon running on 127.0.0.1:8788 (relay 8787)");
    expect(mocks.fetchWithTimeout).toHaveBeenCalledWith(
      "http://127.0.0.1:8788/stop",
      expect.objectContaining({ method: "POST" }),
      1000
    );
    expect(mocks.startDaemon).toHaveBeenCalledTimes(1);
    expect(killSpy).not.toHaveBeenCalled();
    killSpy.mockRestore();
  });

  it("does not retry startup when EADDRINUSE cleanup finds no new daemon pids", async () => {
    const config = makeConfig("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    mocks.loadGlobalConfig.mockReturnValue(config);
    mocks.startDaemon.mockRejectedValueOnce(new Error("listen EADDRINUSE: address already in use 127.0.0.1:8788"));
    mocks.fetchDaemonStatus.mockResolvedValue(null);
    mocks.spawnSync.mockReturnValue({
      status: 0,
      stdout: makePsLine(7777)
    });
    const killSpy = vi.spyOn(process, "kill").mockReturnValue(true);

    const result = await runServe(makeArgs([]));

    expect(result.success).toBe(false);
    expect(result.message).toContain("Daemon port 8788 is already in use by another process.");
    expect(mocks.startDaemon).toHaveBeenCalledTimes(1);
    expect(killSpy).toHaveBeenCalledWith(7777, "SIGTERM");
    expect(killSpy).toHaveBeenCalledWith(7777, "SIGKILL");
    killSpy.mockRestore();
  });

  it("does not evict same-executable daemon processes on other or unknown ports", async () => {
    const config = makeConfig("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    mocks.loadGlobalConfig.mockReturnValue(config);
    mocks.readDaemonMetadata.mockReturnValue({
      port: 8123,
      token: "stale-token",
      pid: 7777,
      relayPort: 8787,
      startedAt: new Date().toISOString()
    });
    mocks.getNativeStatusSnapshot.mockReturnValue({
      installed: true,
      manifestPath: "/tmp/manifest.json",
      wrapperPath: "/tmp/wrapper.sh",
      hostScriptPath: "/tmp/host.cjs",
      extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      registryPath: null
    });
    mocks.spawnSync.mockReturnValue({
      status: 0,
      stdout: [
        makePsLine(7777, {
          command: `${process.execPath} ${CURRENT_CLI_ENTRYPOINT} serve --port 8788 --output-format json`
        }),
        makePsLine(8888, {
          command: `${process.execPath} ${CURRENT_CLI_ENTRYPOINT} serve --output-format json`
        })
      ].join("")
    });
    mocks.startDaemon.mockResolvedValueOnce({
      state: { port: 9999, pid: 1234, relayPort: 8787 },
      stop: vi.fn()
    });
    const killSpy = vi.spyOn(process, "kill").mockReturnValue(true);

    const result = await runServe(makeArgs(["--port", "9999"]));

    expect(result.success).toBe(true);
    expect(result.message).toContain("Daemon running on 127.0.0.1:9999 (relay 8787)");
    expect(result.data?.staleDaemonsCleared).toBe(0);
    expect(mocks.startDaemon).toHaveBeenCalledWith({ port: 9999, token: undefined, config });
    expect(killSpy).not.toHaveBeenCalled();
    killSpy.mockRestore();
  });
});
