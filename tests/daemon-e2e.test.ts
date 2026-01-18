import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import http from "http";
import type { AddressInfo } from "net";
import type { OpenDevBrowserConfig } from "../src/config";
import { startDaemon } from "../src/cli/daemon";
import { DaemonClient } from "../src/cli/daemon-client";

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

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "odb-daemon-"));
    previousCacheDir = process.env.OPENCODE_CACHE_DIR;
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
});
