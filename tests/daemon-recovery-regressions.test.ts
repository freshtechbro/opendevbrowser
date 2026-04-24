import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { getCurrentDaemonFingerprint } from "../src/cli/daemon";
import { DaemonClient, __test__ as daemonClientTest } from "../src/cli/daemon-client";
import { fetchDaemonStatus, fetchDaemonStatusFromMetadata } from "../src/cli/daemon-status";
import { readResponseJsonWithTimeout } from "../src/cli/utils/http";

const writeDaemonMetadata = async (root: string): Promise<void> => {
  const cacheRoot = join(root, "opendevbrowser");
  await mkdir(cacheRoot, { recursive: true });
  await writeFile(join(cacheRoot, "daemon.json"), JSON.stringify({
    port: 12345,
    token: "test-token",
    pid: 9999,
    relayPort: 8787,
    startedAt: new Date().toISOString(),
    fingerprint: getCurrentDaemonFingerprint()
  }), "utf-8");
};

const writeDaemonConfig = async (root: string, port: number, token: string): Promise<void> => {
  const configRoot = join(root, "config");
  await mkdir(configRoot, { recursive: true });
  process.env.OPENCODE_CONFIG_DIR = configRoot;
  await writeFile(join(configRoot, "opendevbrowser.jsonc"), JSON.stringify({
    daemonPort: port,
    daemonToken: token,
    relayPort: 0,
    relayToken: false
  }), "utf-8");
};

const createStalledJsonResponse = (): Response => {
  const stalledBody = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("{"));
    }
  });
  return new Response(stalledBody, {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
};

const createHealthyStatus = (pid: number, fingerprint: string) => ({
  ok: true as const,
  pid,
  fingerprint,
  hub: { instanceId: `hub-${pid}` },
  relay: {
    port: 8788,
    tokenSet: true,
    extensionConnected: false,
    extensionHandshakeComplete: false,
    annotationConnected: false,
    opsConnected: false,
    canvasConnected: false,
    cdpConnected: false,
    pairingRequired: false,
    health: { ok: true, reason: "healthy" }
  },
  binding: null
});

describe("daemon recovery regressions", () => {
  let tempRoot = "";
  let previousCacheDir: string | undefined;
  let previousConfigDir: string | undefined;
  let fetchSpy: ReturnType<typeof vi.spyOn<typeof globalThis, "fetch">> | null = null;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "odb-daemon-recovery-"));
    previousCacheDir = process.env.OPENCODE_CACHE_DIR;
    previousConfigDir = process.env.OPENCODE_CONFIG_DIR;
    process.env.OPENCODE_CACHE_DIR = tempRoot;
    daemonClientTest.resetCachedClientState();
    await writeDaemonMetadata(tempRoot);
    await writeDaemonConfig(tempRoot, 12345, "test-token");
  });

  afterEach(async () => {
    fetchSpy?.mockRestore();
    fetchSpy = null;
    vi.useRealTimers();
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

  it("rebinds after cached binding invalidation on a binding-required call", async () => {
    const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
    let bindCount = 0;
    let boundCommandCount = 0;

    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
      const body = JSON.parse(String(options?.body ?? "{}")) as { name?: string; params?: Record<string, unknown> };
      const name = body.name ?? "unknown";
      const params = body.params ?? {};
      calls.push({ name, params });

      if (name === "relay.bind") {
        bindCount += 1;
        return new Response(JSON.stringify({
          ok: true,
          data: {
            bindingId: `bind-${bindCount}`,
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            renewAfterMs: 20_000
          }
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }

      if (name === "some.command" && !params.bindingId) {
        return new Response(JSON.stringify({
          ok: false,
          error: "RELAY_BINDING_REQUIRED: Call relay.bind to acquire the relay binding."
        }), { status: 400, headers: { "Content-Type": "application/json" } });
      }

      if (name === "some.command" && params.bindingId === "bind-1") {
        boundCommandCount += 1;
        if (boundCommandCount === 1) {
          return new Response(JSON.stringify({ ok: true, data: { ok: true } }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }
        return new Response(JSON.stringify({
          ok: false,
          error: "RELAY_BINDING_INVALID: Binding does not match the current owner."
        }), { status: 400, headers: { "Content-Type": "application/json" } });
      }

      if (name === "some.command" && params.bindingId === "bind-2") {
        return new Response(JSON.stringify({ ok: true, data: { ok: true } }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      return new Response("Unexpected request", { status: 500 });
    });

    const firstClient = new DaemonClient({ autoRenew: false });
    await firstClient.call("some.command");

    const secondClient = new DaemonClient({ autoRenew: false });
    const result = await secondClient.call("some.command", {}, { requireBinding: true });

    expect(result).toEqual({ ok: true });
    expect(calls.map((entry) => entry.name)).toEqual([
      "some.command",
      "relay.bind",
      "some.command",
      "some.command",
      "relay.bind",
      "some.command"
    ]);
    expect(calls[5]?.params.bindingId).toBe("bind-2");
  });

  it("times out a stalled status body read within the requested budget", async () => {
    vi.useFakeTimers();
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(createStalledJsonResponse());

    const pendingStatus = fetchDaemonStatus(8788, "token", { timeoutMs: 25 });
    await vi.advanceTimersByTimeAsync(25);

    await expect(pendingStatus).resolves.toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps metadata and config status probes inside one shared timeout budget", async () => {
    vi.useFakeTimers();
    await writeDaemonConfig(tempRoot, 45678, "config-token");
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => createStalledJsonResponse());

    const pendingStatus = fetchDaemonStatusFromMetadata(undefined, {
      timeoutMs: 25,
      retryAttempts: 2,
      retryDelayMs: 10
    });
    await vi.advanceTimersByTimeAsync(25);

    await expect(pendingStatus).resolves.toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("http://127.0.0.1:45678/status");
    expect(fetchSpy.mock.calls[1]?.[0]).toBe("http://127.0.0.1:12345/status");
  });

  it("prefers the configured daemon when metadata points at another reachable daemon", async () => {
    await writeDaemonConfig(tempRoot, 45678, "config-token");
    const healthyStatus = createHealthyStatus(4567, getCurrentDaemonFingerprint());
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url) === "http://127.0.0.1:45678/status") {
        return new Response(JSON.stringify(healthyStatus), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response(JSON.stringify(createHealthyStatus(1234, "metadata-daemon")), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });

    const status = await fetchDaemonStatusFromMetadata(undefined, {
      timeoutMs: 25,
      retryAttempts: 2,
      retryDelayMs: 10
    });

    expect(status).toEqual({
      ...healthyStatus,
      fingerprintCurrent: true
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("http://127.0.0.1:45678/status");
  });

  it("marks reachable stale daemon status as not current", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(
      createHealthyStatus(1234, "stale-fingerprint")
    ), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));

    const status = await fetchDaemonStatus(8788, "token", { timeoutMs: 25 });

    expect(status?.fingerprintCurrent).toBe(false);
  });

  it("swallows response-body cancel rejections during timeout cleanup", async () => {
    const stalledBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{"));
      }
    });
    const response = new Response(stalledBody, {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
    const responseBody = response.body;
    if (!responseBody) {
      throw new Error("Expected response body for timeout cleanup test");
    }
    const cancelSpy = vi.spyOn(responseBody, "cancel").mockRejectedValue(new Error("stream locked"));
    const controller = new AbortController();
    const pendingRead = readResponseJsonWithTimeout<Record<string, never>>(response, controller.signal, 25);

    controller.abort();

    await expect(pendingRead).rejects.toThrow("Request timed out after 25ms");
    await Promise.resolve();
    expect(cancelSpy).toHaveBeenCalledTimes(1);
  });
});
