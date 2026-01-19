import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import http from "http";
import type { AddressInfo } from "net";
import type { OpenDevBrowserConfig } from "../src/config";
import { startDaemon } from "../src/cli/daemon";
import { DaemonClient } from "../src/cli/daemon-client";
import { fetchDaemonStatusFromMetadata } from "../src/cli/daemon-status";

const getAvailablePort = async (): Promise<number> => {
  const tempServer = http.createServer();
  await new Promise<void>((resolve) => {
    tempServer.listen(0, "127.0.0.1", () => resolve());
  });
  const address = tempServer.address() as AddressInfo;
  await new Promise<void>((resolve) => tempServer.close(() => resolve()));
  return address.port;
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
  relayPort: 0,
  relayToken: false,
  daemonPort: 0,
  daemonToken: "daemon-token",
  flags: [],
  checkForUpdates: false,
  persistProfile: true,
  skillPaths: [],
  ...overrides
});

const fetchStatus = async (port: number, token: string): Promise<Record<string, unknown>> => {
  const response = await fetch(`http://127.0.0.1:${port}/status`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    throw new Error(`Status request failed: ${response.status}`);
  }
  return await response.json() as Record<string, unknown>;
};

describe("daemon e2e", () => {
  let tempRoot = "";
  let previousCacheDir: string | undefined;
  let daemonStop: (() => Promise<void>) | null = null;
  let daemonPort = 0;
  const token = "test-token";
  let previousConfigDir: string | undefined;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "odb-daemon-"));
    previousCacheDir = process.env.OPENCODE_CACHE_DIR;
    previousConfigDir = process.env.OPENCODE_CONFIG_DIR;
    process.env.OPENCODE_CACHE_DIR = tempRoot;
  });

  afterEach(async () => {
    if (daemonStop) {
      await daemonStop();
      daemonStop = null;
    }
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
    if (previousCacheDir === undefined) {
      delete process.env.OPENCODE_CACHE_DIR;
    } else {
      process.env.OPENCODE_CACHE_DIR = previousCacheDir;
    }
    if (previousConfigDir === undefined) {
      delete process.env.OPENCODE_CONFIG_DIR;
    } else {
      process.env.OPENCODE_CONFIG_DIR = previousConfigDir;
    }
  });

  it("binds through the daemon and releases on request", async () => {
    daemonPort = await getAvailablePort();
    const { stop } = await startDaemon({
      port: daemonPort,
      token,
      config: makeConfig(),
      directory: tempRoot,
      worktree: null
    });
    daemonStop = stop;

    const statusBefore = await fetchStatus(daemonPort, token);
    expect(statusBefore.binding).toBeNull();

    const client = new DaemonClient({ autoRenew: false });
    const binding = await client.call<{ bindingId: string; expiresAt: string }>("relay.bind");
    expect(binding).toEqual(expect.objectContaining({
      bindingId: expect.any(String),
      expiresAt: expect.any(String)
    }));

    const statusAfter = await fetchStatus(daemonPort, token);
    expect(statusAfter.binding).not.toBeNull();

    await client.call("relay.release", { bindingId: binding.bindingId });

    const statusFinal = await fetchStatus(daemonPort, token);
    expect(statusFinal.binding).toBeNull();
  });

  it("fetches daemon status from metadata", async () => {
    daemonPort = await getAvailablePort();
    const { stop } = await startDaemon({
      port: daemonPort,
      token,
      config: makeConfig(),
      directory: tempRoot,
      worktree: null
    });
    daemonStop = stop;

    const status = await fetchDaemonStatusFromMetadata();
    expect(status).toEqual(expect.objectContaining({
      ok: true,
      pid: expect.any(Number),
      hub: { instanceId: expect.any(String) },
      relay: expect.any(Object)
    }));
  });

  it("recovers daemon status when metadata is missing", async () => {
    daemonPort = await getAvailablePort();
    const configDir = join(tempRoot, "config");
    await mkdir(configDir, { recursive: true });
    process.env.OPENCODE_CONFIG_DIR = configDir;
    await writeFile(
      join(configDir, "opendevbrowser.jsonc"),
      JSON.stringify({ daemonPort, daemonToken: token, relayPort: 0, relayToken: false }),
      "utf-8"
    );

    const { stop } = await startDaemon({
      port: daemonPort,
      token,
      config: makeConfig({ daemonPort, daemonToken: token }),
      directory: tempRoot,
      worktree: null
    });
    daemonStop = stop;

    const metadataPath = join(tempRoot, "opendevbrowser", "daemon.json");
    await rm(metadataPath, { force: true });

    const status = await fetchDaemonStatusFromMetadata();
    expect(status?.ok).toBe(true);
  });

  it("refreshes relay instance metadata after daemon restart", async () => {
    daemonPort = await getAvailablePort();
    const { stop } = await startDaemon({
      port: daemonPort,
      token,
      config: makeConfig({ daemonPort, daemonToken: token }),
      directory: tempRoot,
      worktree: null
    });
    daemonStop = stop;

    await fetchDaemonStatusFromMetadata();
    const metadataPath = join(tempRoot, "opendevbrowser", "daemon.json");
    const first = JSON.parse(await readFile(metadataPath, "utf-8")) as { relayInstanceId?: string };

    await stop();
    daemonStop = null;

    const { stop: stop2 } = await startDaemon({
      port: daemonPort,
      token,
      config: makeConfig({ daemonPort, daemonToken: token }),
      directory: tempRoot,
      worktree: null
    });
    daemonStop = stop2;

    await fetchDaemonStatusFromMetadata();
    const second = JSON.parse(await readFile(metadataPath, "utf-8")) as { relayInstanceId?: string };

    expect(first.relayInstanceId).toBeTruthy();
    expect(second.relayInstanceId).toBeTruthy();
    expect(second.relayInstanceId).not.toEqual(first.relayInstanceId);
  });
});
