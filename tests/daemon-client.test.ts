import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { DaemonClient } from "../src/cli/daemon-client";

const writeDaemonMetadata = async (root: string): Promise<void> => {
  const cacheRoot = join(root, "opendevbrowser");
  await mkdir(cacheRoot, { recursive: true });
  const payload = {
    port: 12345,
    token: "test-token",
    pid: 9999,
    relayPort: 8787,
    startedAt: new Date().toISOString()
  };
  await writeFile(join(cacheRoot, "daemon.json"), JSON.stringify(payload), "utf-8");
};

describe("daemon-client error parsing", () => {
  let tempRoot = "";
  let previousCacheDir: string | undefined;
  let fetchSpy: ReturnType<typeof vi.fn> | null = null;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "odb-daemon-client-"));
    previousCacheDir = process.env.OPENCODE_CACHE_DIR;
    process.env.OPENCODE_CACHE_DIR = tempRoot;
    await writeDaemonMetadata(tempRoot);
  });

  afterEach(async () => {
    if (fetchSpy) {
      fetchSpy.mockRestore();
      fetchSpy = null;
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

  it("auto-binds after RELAY_BINDING_REQUIRED response", async () => {
    const calls: Array<{ name: string; params: Record<string, unknown> }> = [];

    fetchSpy = vi.fn(async (_url, options) => {
      const body = JSON.parse(String(options?.body ?? "{}")) as { name?: string; params?: Record<string, unknown> };
      const name = body.name ?? "unknown";
      const params = body.params ?? {};
      calls.push({ name, params });

      if (name === "relay.bind") {
        const expiresAt = new Date(Date.now() + 60_000).toISOString();
        const responseBody = JSON.stringify({
          ok: true,
          data: {
            bindingId: "bind-1",
            expiresAt,
            renewAfterMs: 20000
          }
        });
        return new Response(responseBody, { status: 200, headers: { "Content-Type": "application/json" } });
      }

      if (name === "some.command" && !params.bindingId) {
        const responseBody = JSON.stringify({
          ok: false,
          error: "RELAY_BINDING_REQUIRED: Call relay.bind to acquire the relay binding."
        });
        return new Response(responseBody, { status: 400, headers: { "Content-Type": "application/json" } });
      }

      if (name === "some.command" && params.bindingId) {
        const responseBody = JSON.stringify({ ok: true, data: { ok: true } });
        return new Response(responseBody, { status: 200, headers: { "Content-Type": "application/json" } });
      }

      return new Response("Unexpected request", { status: 500 });
    });

    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;

    const client = new DaemonClient({ autoRenew: false });
    const result = await client.call("some.command");

    expect(result).toEqual({ ok: true });
    expect(calls.map((entry) => entry.name)).toEqual(["some.command", "relay.bind", "some.command"]);
  });

  it("retries without cached lease when daemon reports RELAY_LEASE_INVALID", async () => {
    const calls: Array<{ name: string; params: Record<string, unknown> }> = [];

    fetchSpy = vi.fn(async (_url, options) => {
      const body = JSON.parse(String(options?.body ?? "{}")) as { name?: string; params?: Record<string, unknown> };
      const name = body.name ?? "unknown";
      const params = body.params ?? {};
      calls.push({ name, params });

      if (name === "session.connect") {
        const responseBody = JSON.stringify({
          ok: true,
          data: {
            sessionId: "session-1",
            leaseId: "lease-stale"
          }
        });
        return new Response(responseBody, { status: 200, headers: { "Content-Type": "application/json" } });
      }

      if (name === "targets.list" && params.leaseId === "lease-stale") {
        const responseBody = JSON.stringify({
          ok: false,
          error: "RELAY_LEASE_INVALID: Lease does not match session owner."
        });
        return new Response(responseBody, { status: 400, headers: { "Content-Type": "application/json" } });
      }

      if (name === "targets.list" && !("leaseId" in params)) {
        const responseBody = JSON.stringify({
          ok: true,
          data: { activeTargetId: null, targets: [] }
        });
        return new Response(responseBody, { status: 200, headers: { "Content-Type": "application/json" } });
      }

      return new Response("Unexpected request", { status: 500 });
    });

    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;

    const client = new DaemonClient({ autoRenew: false });
    await client.call("session.connect", {});
    const result = await client.call("targets.list", { sessionId: "session-1" });

    expect(result).toEqual({ activeTargetId: null, targets: [] });
    expect(calls.map((entry) => entry.name)).toEqual(["session.connect", "targets.list", "targets.list"]);
    expect(calls[1]?.params).toEqual(expect.objectContaining({ sessionId: "session-1", leaseId: "lease-stale" }));
    expect(calls[2]?.params).toEqual(expect.objectContaining({ sessionId: "session-1" }));
    expect(calls[2]?.params.leaseId).toBeUndefined();
  });
});
