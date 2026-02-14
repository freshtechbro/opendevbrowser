import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchWithTimeout: vi.fn(),
  readDaemonMetadata: vi.fn(),
  writeDaemonMetadata: vi.fn(),
  getCacheRoot: vi.fn(() => "/tmp/odb-daemon-client"),
  loadGlobalConfig: vi.fn(),
  fetchDaemonStatus: vi.fn()
}));

vi.mock("../src/cli/utils/http", () => ({
  fetchWithTimeout: mocks.fetchWithTimeout
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

describe("daemon-client retry timeout propagation", () => {
  beforeEach(() => {
    mocks.fetchWithTimeout.mockReset();
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
  });

  it("preserves timeoutMs when retrying unauthorized requests", async () => {
    mocks.fetchWithTimeout
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, data: { ok: true } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }));

    const client = new DaemonClient({ autoRenew: false, clientId: "client-1" });
    const result = await client.call<{ ok: boolean }>("session.status", {}, { timeoutMs: 45_000 });

    expect(result).toEqual({ ok: true });
    expect(mocks.fetchWithTimeout).toHaveBeenCalledTimes(2);
    expect(mocks.fetchWithTimeout.mock.calls[0]?.[2]).toBe(45_000);
    expect(mocks.fetchWithTimeout.mock.calls[1]?.[2]).toBe(45_000);
  });
});
