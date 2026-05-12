import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import http from "http";
import type { AddressInfo } from "net";
import type { OpenDevBrowserConfig } from "../src/config";
import { createDaemonStopHeaders, startDaemon } from "../src/cli/daemon";
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

const postStop = async (port: number, headers: Record<string, string>): Promise<Response> => {
  return await fetch(`http://127.0.0.1:${port}/stop`, {
    method: "POST",
    headers
  });
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
      fingerprint: expect.any(String),
      hub: { instanceId: expect.any(String) },
      relay: expect.any(Object)
    }));
  });

  it("rejects stale stop requests that only know the daemon token", async () => {
    daemonPort = await getAvailablePort();
    const { stop } = await startDaemon({
      port: daemonPort,
      token,
      config: makeConfig(),
      directory: tempRoot,
      worktree: null
    });
    daemonStop = stop;

    const response = await postStop(daemonPort, { Authorization: `Bearer ${token}` });

    expect(response.status).toBe(409);
    const status = await fetchStatus(daemonPort, token);
    expect(status.ok).toBe(true);
  });

  it("allows current clients to stop the daemon with a matching fingerprint", async () => {
    daemonPort = await getAvailablePort();
    const { stop } = await startDaemon({
      port: daemonPort,
      token,
      config: makeConfig(),
      directory: tempRoot,
      worktree: null
    });
    daemonStop = stop;

    const response = await postStop(daemonPort, createDaemonStopHeaders(token, "test.current"));

    expect(response.status).toBe(200);
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

  it("recovers daemon status when metadata points at the wrong pid and port", async () => {
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

    let stalePort = await getAvailablePort();
    if (stalePort === daemonPort) {
      stalePort += 1;
    }

    const metadataPath = join(tempRoot, "opendevbrowser", "daemon.json");
    await writeFile(metadataPath, JSON.stringify({
      port: stalePort,
      token: "stale-token",
      pid: 999999,
      relayPort: 0,
      startedAt: new Date(0).toISOString()
    }, null, 2), "utf-8");

    const status = await fetchDaemonStatusFromMetadata();
    expect(status?.ok).toBe(true);
    expect(status?.pid).toBeTypeOf("number");

    const refreshed = JSON.parse(await readFile(metadataPath, "utf-8")) as {
      port: number;
      token: string;
      pid: number;
    };
    expect(refreshed.port).toBe(daemonPort);
    expect(refreshed.token).toBe(token);
    expect(refreshed.pid).toBe(status?.pid);
  });

  it("retries one transient daemon status miss before reporting disconnected", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      fetchSpy
        .mockRejectedValueOnce(new Error("socket hang up"))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          ok: true,
          pid: 1234,
          fingerprint: "test-fingerprint",
          hub: { instanceId: "hub-1" },
          relay: {
            running: true,
            url: "ws://127.0.0.1:8787",
            port: 8787,
            extensionConnected: false,
            extensionHandshakeComplete: false,
            cdpConnected: false,
            annotationConnected: false,
            opsConnected: false,
            canvasConnected: false,
            pairingRequired: false,
            instanceId: "relay-1",
            epoch: 1,
            health: { ok: true, reason: "ok" }
          },
          binding: null
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }));

      const status = await fetchDaemonStatusFromMetadata(
        makeConfig({ daemonPort: 8788, daemonToken: token }),
        { retryAttempts: 2, retryDelayMs: 0 }
      );

      expect(status?.ok).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      fetchSpy.mockRestore();
    }
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

    const config = makeConfig({ daemonPort, daemonToken: token });
    await fetchDaemonStatusFromMetadata(config);
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

    await fetchDaemonStatusFromMetadata(config);
    const second = JSON.parse(await readFile(metadataPath, "utf-8")) as { relayInstanceId?: string };

    expect(first.relayInstanceId).toBeTruthy();
    expect(second.relayInstanceId).toBeTruthy();
    expect(second.relayInstanceId).not.toEqual(first.relayInstanceId);
  });

  it("keeps the daemon alive after recoverable Playwright transport exceptions", async () => {
    daemonPort = await getAvailablePort();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { stop } = await startDaemon({
      port: daemonPort,
      token,
      config: makeConfig(),
      directory: tempRoot,
      worktree: null
    });
    daemonStop = stop;

    process.emit("uncaughtException", new Error("{\"code\":-32000,\"message\":\"Cannot find context with specified id\"}"));
    process.emit("unhandledRejection", new Error("Detached while handling command."), Promise.resolve());

    const status = await fetchStatus(daemonPort, token);
    expect(status.ok).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("ignored recoverable Playwright transport error"));
  });

  it("keeps the daemon alive after Playwright transport assertions that follow a recoverable detach", async () => {
    daemonPort = await getAvailablePort();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { stop } = await startDaemon({
      port: daemonPort,
      token,
      config: makeConfig(),
      directory: tempRoot,
      worktree: null
    });
    daemonStop = stop;

    process.emit("unhandledRejection", new Error("{\"code\":-32000,\"message\":\"Cannot find context with specified id\"}"), Promise.resolve());

    const assertion = new Error("Assertion error");
    assertion.stack = [
      "Error: Assertion error",
      "    at assert (/repo/node_modules/playwright-core/lib/utils/isomorphic/assert.js:26:11)",
      "    at CRSession._onMessage (/repo/node_modules/playwright-core/lib/server/chromium/crConnection.js:129:31)",
      "    at CRConnection._onMessage (/repo/node_modules/playwright-core/lib/server/chromium/crConnection.js:67:15)",
      "    at Immediate.<anonymous> (/repo/node_modules/playwright-core/lib/server/transport.js:73:28)"
    ].join("\n");
    process.emit("uncaughtException", assertion);

    const status = await fetchStatus(daemonPort, token);
    expect(status.ok).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("ignored recoverable Playwright transport follow-on"));
  });

  it("keeps the daemon alive after Playwright no-tab transport assertions", async () => {
    daemonPort = await getAvailablePort();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { stop } = await startDaemon({
      port: daemonPort,
      token,
      config: makeConfig(),
      directory: tempRoot,
      worktree: null
    });
    daemonStop = stop;

    const assertion = new Error("No tab attached");
    assertion.stack = [
      "Error: No tab attached",
      "    at assert (/repo/node_modules/playwright-core/lib/utils/isomorphic/assert.js:26:11)",
      "    at CRSession._onMessage (/repo/node_modules/playwright-core/lib/server/chromium/crConnection.js:129:31)",
      "    at CRConnection._onMessage (/repo/node_modules/playwright-core/lib/server/chromium/crConnection.js:67:15)",
      "    at Immediate.<anonymous> (/repo/node_modules/playwright-core/lib/server/transport.js:73:28)"
    ].join("\n");
    process.emit("uncaughtException", assertion);

    const status = await fetchStatus(daemonPort, token);
    expect(status.ok).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("ignored recoverable Playwright transport follow-on"));
  });

  it("keeps the daemon alive after Playwright missing-frame transport errors", async () => {
    daemonPort = await getAvailablePort();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { stop } = await startDaemon({
      port: daemonPort,
      token,
      config: makeConfig(),
      directory: tempRoot,
      worktree: null
    });
    daemonStop = stop;

    process.emit("unhandledRejection", new Error('{"code":-32000,"message":"No frame with given id found"}'), Promise.resolve());

    const status = await fetchStatus(daemonPort, token);
    expect(status.ok).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("ignored recoverable Playwright transport error"));
  });
});
