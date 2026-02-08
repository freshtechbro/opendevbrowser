import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedArgs } from "../src/cli/args";
import type { OpenDevBrowserConfig } from "../src/config";

const mocks = vi.hoisted(() => ({
  startDaemon: vi.fn(),
  readDaemonMetadata: vi.fn(),
  loadGlobalConfig: vi.fn(),
  fetchWithTimeout: vi.fn(),
  discoverExtensionId: vi.fn(),
  getNativeStatusSnapshot: vi.fn(),
  installNativeHost: vi.fn()
}));

vi.mock("../src/cli/daemon", () => ({
  startDaemon: mocks.startDaemon,
  readDaemonMetadata: mocks.readDaemonMetadata
}));

vi.mock("../src/config", () => ({
  loadGlobalConfig: mocks.loadGlobalConfig
}));

vi.mock("../src/cli/utils/http", () => ({
  fetchWithTimeout: mocks.fetchWithTimeout
}));

vi.mock("../src/cli/commands/native", () => ({
  discoverExtensionId: mocks.discoverExtensionId,
  getNativeStatusSnapshot: mocks.getNativeStatusSnapshot,
  installNativeHost: mocks.installNativeHost
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
    mocks.fetchWithTimeout.mockResolvedValue({ ok: true });
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
});
