import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchWithTimeoutContext: vi.fn(),
  readResponseTextWithTimeout: vi.fn(),
  readResponseJsonWithTimeout: vi.fn(),
  readDaemonMetadata: vi.fn(),
  writeDaemonMetadata: vi.fn(),
  getCacheRoot: vi.fn(() => "/tmp/odb-daemon-client"),
  loadGlobalConfig: vi.fn(),
  fetchDaemonStatus: vi.fn()
}));

vi.mock("../src/cli/utils/http", () => ({
  fetchWithTimeoutContext: mocks.fetchWithTimeoutContext,
  readResponseTextWithTimeout: mocks.readResponseTextWithTimeout,
  readResponseJsonWithTimeout: mocks.readResponseJsonWithTimeout
}));

vi.mock("../src/cli/daemon", () => ({
  readDaemonMetadata: mocks.readDaemonMetadata,
  writeDaemonMetadata: mocks.writeDaemonMetadata,
  getCacheRoot: mocks.getCacheRoot
}));

vi.mock("../src/config", () => ({
  loadGlobalConfig: mocks.loadGlobalConfig
}));

vi.mock("../src/cli/daemon-status", () => ({
  fetchDaemonStatus: mocks.fetchDaemonStatus
}));

import { DaemonClient } from "../src/cli/daemon-client";

const createTimedResponse = (response: Response, timeoutMs: number) => ({
  response,
  signal: new AbortController().signal,
  timeoutMs,
  dispose: vi.fn()
});

describe("daemon-client retry timeout propagation", () => {
  beforeEach(() => {
    mocks.fetchWithTimeoutContext.mockReset();
    mocks.readResponseTextWithTimeout.mockReset();
    mocks.readResponseJsonWithTimeout.mockReset();
    mocks.readDaemonMetadata.mockReset();
    mocks.writeDaemonMetadata.mockReset();
    mocks.getCacheRoot.mockReset();
    mocks.loadGlobalConfig.mockReset();
    mocks.fetchDaemonStatus.mockReset();

    mocks.getCacheRoot.mockReturnValue("/tmp/odb-daemon-client");
    mocks.readDaemonMetadata.mockReturnValue({
      port: 8788,
      token: "stale-token",
      pid: 1,
      relayPort: 8787,
      startedAt: new Date().toISOString()
    });
    mocks.loadGlobalConfig.mockReturnValue({
      daemonPort: 8788,
      daemonToken: "fresh-token",
      relayPort: 8787
    });
    mocks.fetchDaemonStatus.mockResolvedValue({
      ok: true,
      pid: 123,
      hub: { instanceId: "hub-1" },
      relay: {
        port: 8787,
        instanceId: "relay-1",
        epoch: 5
      }
    });
    mocks.fetchWithTimeoutContext.mockImplementation(async (_url, _init, timeoutMs) => ({
      response: new Response(null, { status: 500 }),
      signal: new AbortController().signal,
      timeoutMs: typeof timeoutMs === "number" ? timeoutMs : 5000,
      dispose: vi.fn()
    }));
    mocks.readResponseTextWithTimeout.mockImplementation(async (response: Response) => await response.text());
    mocks.readResponseJsonWithTimeout.mockImplementation(async (response: Response) => await response.json());
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
      expect.objectContaining({ retryAttempts: 2, retryDelayMs: 250 })
    );
  });
});
