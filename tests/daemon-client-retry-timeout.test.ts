import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join, resolve } from "path";

const mocks = vi.hoisted(() => ({
  fetchWithTimeout: vi.fn(),
  fetchWithTimeoutContext: vi.fn(),
  readResponseTextWithTimeout: vi.fn(),
  readResponseJsonWithTimeout: vi.fn(),
  readDaemonMetadata: vi.fn(),
  persistDaemonStatusMetadata: vi.fn(),
  getCacheRoot: vi.fn(() => "/tmp/odb-daemon-client"),
  isCurrentDaemonFingerprint: vi.fn(),
  resolveCurrentDaemonEntrypointPath: vi.fn(),
  loadGlobalConfig: vi.fn(),
  fetchDaemonStatus: vi.fn(),
  spawn: vi.fn()
}));

vi.mock("../src/cli/utils/http", () => ({
  fetchWithTimeout: mocks.fetchWithTimeout,
  fetchWithTimeoutContext: mocks.fetchWithTimeoutContext,
  readResponseTextWithTimeout: mocks.readResponseTextWithTimeout,
  readResponseJsonWithTimeout: mocks.readResponseJsonWithTimeout
}));

vi.mock("../src/cli/daemon", () => ({
  readDaemonMetadata: mocks.readDaemonMetadata,
  getCacheRoot: mocks.getCacheRoot,
  isCurrentDaemonFingerprint: mocks.isCurrentDaemonFingerprint,
  resolveCurrentDaemonEntrypointPath: mocks.resolveCurrentDaemonEntrypointPath
}));

vi.mock("../src/config", () => ({
  loadGlobalConfig: mocks.loadGlobalConfig
}));

vi.mock("../src/cli/daemon-status", () => ({
  fetchDaemonStatus: mocks.fetchDaemonStatus,
  persistDaemonStatusMetadata: mocks.persistDaemonStatusMetadata
}));

vi.mock("node:child_process", () => ({
  spawn: mocks.spawn
}));

import { DaemonClient } from "../src/cli/daemon-client";

const createTimedResponse = (response: Response, timeoutMs: number) => ({
  response,
  signal: new AbortController().signal,
  timeoutMs,
  dispose: vi.fn()
});

describe("daemon-client retry timeout propagation", () => {
  const originalArgv1 = process.argv[1];
  const restartEntrypoint = resolve(join("repo-fixture", "dist", "cli", "index.js"));

  beforeEach(() => {
    mocks.fetchWithTimeoutContext.mockReset();
    mocks.fetchWithTimeout.mockReset();
    mocks.readResponseTextWithTimeout.mockReset();
    mocks.readResponseJsonWithTimeout.mockReset();
    mocks.readDaemonMetadata.mockReset();
    mocks.persistDaemonStatusMetadata.mockReset();
    mocks.getCacheRoot.mockReset();
    mocks.isCurrentDaemonFingerprint.mockReset();
    mocks.resolveCurrentDaemonEntrypointPath.mockReset();
    mocks.loadGlobalConfig.mockReset();
    mocks.fetchDaemonStatus.mockReset();
    mocks.spawn.mockReset();
    process.argv[1] = restartEntrypoint;

    mocks.getCacheRoot.mockReturnValue("/tmp/odb-daemon-client");
    mocks.resolveCurrentDaemonEntrypointPath.mockImplementation((options?: { argv1?: string }) => {
      const rawEntry = options?.argv1 ?? process.argv[1];
      return typeof rawEntry === "string" && rawEntry.trim().length > 0
        ? resolve(rawEntry)
        : restartEntrypoint;
    });
    mocks.readDaemonMetadata.mockReturnValue({
      port: 8788,
      token: "stale-token",
      pid: 1,
      relayPort: 8787,
      startedAt: new Date().toISOString(),
      fingerprint: "current-fingerprint"
    });
    mocks.isCurrentDaemonFingerprint.mockImplementation((fingerprint?: string) => fingerprint === "current-fingerprint");
    mocks.loadGlobalConfig.mockReturnValue({
      daemonPort: 8788,
      daemonToken: "fresh-token",
      relayPort: 8787
    });
    mocks.fetchDaemonStatus.mockResolvedValue({
      ok: true,
      pid: 123,
      hub: { instanceId: "hub-1" },
      fingerprint: "current-fingerprint",
      relay: {
        port: 8787,
        instanceId: "relay-1",
        epoch: 5
      }
    });
    mocks.fetchWithTimeout.mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));
    mocks.spawn.mockReturnValue({ unref: vi.fn() });
    mocks.fetchWithTimeoutContext.mockImplementation(async (_url, _init, timeoutMs) => ({
      response: new Response(null, { status: 500 }),
      signal: new AbortController().signal,
      timeoutMs: typeof timeoutMs === "number" ? timeoutMs : 5000,
      dispose: vi.fn()
    }));
    mocks.readResponseTextWithTimeout.mockImplementation(async (response: Response) => await response.text());
    mocks.readResponseJsonWithTimeout.mockImplementation(async (response: Response) => await response.json());
  });

  afterEach(() => {
    process.argv[1] = originalArgv1;
  });

  it("preserves timeoutMs when retrying unauthorized requests", async () => {
    mocks.fetchWithTimeoutContext
      .mockResolvedValueOnce(createTimedResponse(new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      }), 45_000))
      .mockResolvedValueOnce(createTimedResponse(new Response(JSON.stringify({ ok: true, data: { ok: true } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }), 45_000));

    const client = new DaemonClient({ autoRenew: false, clientId: "client-1" });
    const result = await client.call<{ ok: boolean }>("session.status", {}, { timeoutMs: 45_000 });

    expect(result).toEqual({ ok: true });
    expect(mocks.fetchWithTimeoutContext).toHaveBeenCalledTimes(2);
    expect(mocks.fetchWithTimeoutContext.mock.calls[0]?.[2]).toBe(45_000);
    expect(mocks.fetchWithTimeoutContext.mock.calls[1]?.[2]).toBe(45_000);
    expect(mocks.fetchDaemonStatus).toHaveBeenCalledWith(
      8788,
      "fresh-token",
      expect.objectContaining({ retryAttempts: 5, retryDelayMs: 250 })
    );
  });

  it("restarts a healthy stale daemon before issuing the command", async () => {
    const unref = vi.fn();
    mocks.readDaemonMetadata.mockReturnValue({
      port: 8788,
      token: "fresh-token",
      pid: 1,
      relayPort: 8787,
      startedAt: new Date().toISOString(),
      fingerprint: "stale-fingerprint"
    });
    mocks.fetchDaemonStatus
      .mockResolvedValueOnce({
        ok: true,
        pid: 321,
        fingerprint: "stale-fingerprint",
        hub: { instanceId: "hub-1" },
        relay: {
          port: 8787,
          instanceId: "relay-1",
          epoch: 5
        }
      })
      .mockResolvedValueOnce({
        ok: true,
        pid: 321,
        fingerprint: "stale-fingerprint",
        hub: { instanceId: "hub-1" },
        relay: {
          port: 8787,
          instanceId: "relay-1",
          epoch: 5
        }
      })
      .mockResolvedValueOnce({
        ok: true,
        pid: 654,
        fingerprint: "current-fingerprint",
        hub: { instanceId: "hub-2" },
        relay: {
          port: 8787,
          instanceId: "relay-2",
          epoch: 6
        }
      });
    mocks.spawn.mockReturnValue({ unref });
    mocks.fetchWithTimeoutContext.mockResolvedValue(createTimedResponse(new Response(JSON.stringify({
      ok: true,
      data: { ok: true }
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }), 30_000));

    const client = new DaemonClient({ autoRenew: false, clientId: "client-1" });
    const result = await client.call<{ ok: boolean }>("desktop.status", {}, { timeoutMs: 30_000 });

    expect(result).toEqual({ ok: true });
    expect(mocks.fetchWithTimeout).toHaveBeenCalledWith(
      "http://127.0.0.1:8788/stop",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer fresh-token" })
      }),
      5_000
    );
    expect(mocks.spawn).toHaveBeenCalledWith(
      process.execPath,
      [
        restartEntrypoint,
        "serve",
        "--port",
        "8788",
        "--token",
        "fresh-token",
        "--output-format",
        "json"
      ],
      expect.objectContaining({ detached: true, stdio: "ignore" })
    );
    expect(unref).toHaveBeenCalledTimes(1);
    expect(mocks.persistDaemonStatusMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 8788,
        token: "fresh-token",
        fingerprint: "current-fingerprint"
      }),
      expect.objectContaining({
        pid: 654,
        fingerprint: "current-fingerprint"
      }),
      expect.objectContaining({
        daemonPort: 8788,
        daemonToken: "fresh-token"
      })
    );
    expect(mocks.fetchWithTimeoutContext).toHaveBeenCalledTimes(1);
    expect(mocks.fetchWithTimeoutContext.mock.calls[0]?.[0]).toBe("http://127.0.0.1:8788/command");
  });

  it("waits through a slow stale-daemon restart before issuing the command", async () => {
    vi.useFakeTimers();
    try {
      const unref = vi.fn();
      const staleStatus = {
        ok: true,
        pid: 321,
        fingerprint: "stale-fingerprint",
        hub: { instanceId: "hub-1" },
        relay: {
          port: 8787,
          instanceId: "relay-1",
          epoch: 5
        }
      };
      const currentStatus = {
        ok: true,
        pid: 654,
        fingerprint: "current-fingerprint",
        hub: { instanceId: "hub-2" },
        relay: {
          port: 8787,
          instanceId: "relay-2",
          epoch: 6
        }
      };
      mocks.readDaemonMetadata.mockReturnValue({
        port: 8788,
        token: "fresh-token",
        pid: 1,
        relayPort: 8787,
        startedAt: new Date().toISOString(),
        fingerprint: "stale-fingerprint"
      });
      mocks.fetchDaemonStatus
        .mockResolvedValueOnce(staleStatus)
        .mockResolvedValueOnce(staleStatus);
      for (let attempt = 0; attempt < 21; attempt += 1) {
        mocks.fetchDaemonStatus.mockResolvedValueOnce(staleStatus);
      }
      mocks.fetchDaemonStatus.mockResolvedValueOnce(currentStatus);
      mocks.spawn.mockReturnValue({ unref });
      mocks.fetchWithTimeoutContext.mockResolvedValue(createTimedResponse(new Response(JSON.stringify({
        ok: true,
        data: { ok: true }
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }), 30_000));

      const client = new DaemonClient({ autoRenew: false, clientId: "client-1" });
      const resultPromise = client.call<{ ok: boolean }>("desktop.status", {}, { timeoutMs: 30_000 });

      await vi.advanceTimersByTimeAsync(5_250);

      await expect(resultPromise).resolves.toEqual({ ok: true });
      expect(mocks.spawn).toHaveBeenCalledTimes(1);
      expect(unref).toHaveBeenCalledTimes(1);
      expect(mocks.fetchWithTimeoutContext).toHaveBeenCalledTimes(1);
      expect(mocks.persistDaemonStatusMetadata).toHaveBeenCalledWith(
        expect.objectContaining({
          port: 8788,
          token: "fresh-token",
          fingerprint: "current-fingerprint"
        }),
        expect.objectContaining({
          pid: 654,
          fingerprint: "current-fingerprint"
        }),
        expect.objectContaining({
          daemonPort: 8788,
          daemonToken: "fresh-token"
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
