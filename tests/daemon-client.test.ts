import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join, normalize } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { getCurrentDaemonFingerprint, resolveCurrentDaemonEntrypointPath } from "../src/cli/daemon";
import * as daemonStatusModule from "../src/cli/daemon-status";
import { DaemonClient, __test__ as daemonClientTest } from "../src/cli/daemon-client";

const writeDaemonMetadata = async (root: string): Promise<void> => {
  const cacheRoot = join(root, "opendevbrowser");
  await mkdir(cacheRoot, { recursive: true });
  const payload = {
    port: 12345,
    token: "test-token",
    pid: 9999,
    relayPort: 8787,
    startedAt: new Date().toISOString(),
    fingerprint: getCurrentDaemonFingerprint()
  };
  await writeFile(join(cacheRoot, "daemon.json"), JSON.stringify(payload), "utf-8");
};

const writeDaemonConfig = async (
  root: string,
  port: number,
  token: string
): Promise<void> => {
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

describe("daemon-client error parsing", () => {
  let tempRoot = "";
  let previousCacheDir: string | undefined;
  let previousConfigDir: string | undefined;
  let fetchSpy: ReturnType<typeof vi.fn> | null = null;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "odb-daemon-client-"));
    previousCacheDir = process.env.OPENCODE_CACHE_DIR;
    previousConfigDir = process.env.OPENCODE_CONFIG_DIR;
    process.env.OPENCODE_CACHE_DIR = tempRoot;
    daemonClientTest.resetCachedClientState();
    await writeDaemonMetadata(tempRoot);
    await writeDaemonConfig(tempRoot, 12345, "test-token");
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
    if (previousConfigDir === undefined) {
      delete process.env.OPENCODE_CONFIG_DIR;
    } else {
      process.env.OPENCODE_CONFIG_DIR = previousConfigDir;
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

  it("reuses a cached binding across daemon client instances without rebinding", async () => {
    const calls: Array<{ name: string; params: Record<string, unknown> }> = [];

    fetchSpy = vi.fn(async (_url, options) => {
      const body = JSON.parse(String(options?.body ?? "{}")) as { name?: string; params?: Record<string, unknown> };
      const name = body.name ?? "unknown";
      const params = body.params ?? {};
      calls.push({ name, params });

      if (name === "relay.bind") {
        return new Response(JSON.stringify({
          ok: true,
          data: {
            bindingId: "bind-1",
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
        return new Response(JSON.stringify({ ok: true, data: { ok: true } }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      return new Response("Unexpected request", { status: 500 });
    });

    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;

    const firstClient = new DaemonClient({ autoRenew: false });
    await firstClient.call("some.command");

    const secondClient = new DaemonClient({ autoRenew: false });
    const result = await secondClient.call("some.command");

    expect(result).toEqual({ ok: true });
    expect(calls.map((entry) => entry.name)).toEqual([
      "some.command",
      "relay.bind",
      "some.command",
      "some.command"
    ]);
    expect(calls[3]?.params.bindingId).toBe("bind-1");
  });

  it("clears an invalid cached binding and rebinds before retrying", async () => {
    const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
    let bindCount = 0;
    let boundCommandCount = 0;

    fetchSpy = vi.fn(async (_url, options) => {
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

    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;

    const firstClient = new DaemonClient({ autoRenew: false });
    await firstClient.call("some.command");

    const secondClient = new DaemonClient({ autoRenew: false });
    const result = await secondClient.call("some.command");

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

  it("does not release a binding that was only restored from cache", async () => {
    const calls: Array<{ name: string; params: Record<string, unknown> }> = [];

    fetchSpy = vi.fn(async (_url, options) => {
      const body = JSON.parse(String(options?.body ?? "{}")) as { name?: string; params?: Record<string, unknown> };
      const name = body.name ?? "unknown";
      const params = body.params ?? {};
      calls.push({ name, params });

      if (name === "relay.bind") {
        return new Response(JSON.stringify({
          ok: true,
          data: {
            bindingId: "bind-1",
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
        return new Response(JSON.stringify({ ok: true, data: { ok: true } }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      if (name === "relay.release") {
        return new Response(JSON.stringify({ ok: true, data: { released: true } }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      return new Response("Unexpected request", { status: 500 });
    });

    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;

    const firstClient = new DaemonClient({ autoRenew: false });
    await firstClient.call("some.command");

    const restoredClient = new DaemonClient({ autoRenew: false });
    await restoredClient.releaseBinding();

    const thirdClient = new DaemonClient({ autoRenew: false });
    const result = await thirdClient.call("some.command");

    expect(result).toEqual({ ok: true });
    expect(calls.map((entry) => entry.name)).toEqual([
      "some.command",
      "relay.bind",
      "some.command",
      "some.command"
    ]);
  });

  it("clears the cached binding when session.disconnect reports bindingReleased", async () => {
    const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
    let bindCount = 0;

    fetchSpy = vi.fn(async (_url, options) => {
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

      if (name === "some.command" && typeof params.bindingId === "string") {
        return new Response(JSON.stringify({ ok: true, data: { ok: true } }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      if (name === "session.disconnect") {
        return new Response(JSON.stringify({
          ok: true,
          data: { ok: true, bindingReleased: true }
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }

      return new Response("Unexpected request", { status: 500 });
    });

    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;

    const firstClient = new DaemonClient({ autoRenew: false });
    await firstClient.call("some.command");
    await firstClient.call("session.disconnect", { sessionId: "session-1" });

    const secondClient = new DaemonClient({ autoRenew: false });
    const result = await secondClient.call("some.command");

    expect(result).toEqual({ ok: true });
    expect(calls.map((entry) => entry.name)).toEqual([
      "some.command",
      "relay.bind",
      "some.command",
      "session.disconnect",
      "some.command",
      "relay.bind",
      "some.command"
    ]);
    expect(calls[5]?.params.clientId).toBeTruthy();
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

  it("keeps the original click call alive while a second client handles the dialog", async () => {
    const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
    let resolveClickResponse: (() => void) | null = null;

    fetchSpy = vi.fn((_url, options) => {
      const body = JSON.parse(String(options?.body ?? "{}")) as { name?: string; params?: Record<string, unknown> };
      const name = body.name ?? "unknown";
      const params = body.params ?? {};
      calls.push({ name, params });

      if (name === "interact.click") {
        return new Promise<Response>((resolve, reject) => {
          const signal = options?.signal as AbortSignal | undefined;
          resolveClickResponse = () => {
            resolve(new Response(JSON.stringify({ ok: true, data: { ok: true } }), {
              status: 200,
              headers: { "Content-Type": "application/json" }
            }));
          };
          signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            Object.assign(error, { name: "AbortError" });
            reject(error);
          }, { once: true });
        });
      }

      if (name === "page.dialog" && params.action === "status") {
        return Promise.resolve(new Response(JSON.stringify({
          ok: true,
          data: {
            dialog: {
              open: true,
              targetId: "target-1",
              type: "alert",
              message: "I am a JS Alert"
            }
          }
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }));
      }

      if (name === "page.dialog" && params.action === "accept") {
        resolveClickResponse?.();
        return Promise.resolve(new Response(JSON.stringify({
          ok: true,
          data: {
            dialog: { open: false, targetId: "target-1" },
            handled: true
          }
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }));
      }

      return Promise.resolve(new Response("Unexpected request", { status: 500 }));
    }) as ReturnType<typeof vi.fn>;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;

    const firstClient = new DaemonClient({ autoRenew: false });
    const secondClient = new DaemonClient({ autoRenew: false });

    const clickPromise = firstClient.call("interact.click", {
      sessionId: "session-1",
      ref: "r1"
    }, { timeoutMs: 30_000 });
    await Promise.resolve();

    await expect(secondClient.call("page.dialog", {
      sessionId: "session-1",
      action: "status"
    }, { timeoutMs: 30_000 })).resolves.toEqual({
      dialog: {
        open: true,
        targetId: "target-1",
        type: "alert",
        message: "I am a JS Alert"
      }
    });

    await expect(secondClient.call("page.dialog", {
      sessionId: "session-1",
      action: "accept"
    }, { timeoutMs: 30_000 })).resolves.toEqual({
      dialog: { open: false, targetId: "target-1" },
      handled: true
    });

    await expect(clickPromise).resolves.toEqual({ ok: true });
    expect(calls.map((entry) => entry.name)).toEqual([
      "interact.click",
      "page.dialog",
      "page.dialog"
    ]);
  });

  it("allows payload timeout hints to use buffered transport timeouts", async () => {
    vi.useFakeTimers();

    fetchSpy = vi.fn((_url, options) => {
      return new Promise<Response>((resolve, reject) => {
        const signal = options?.signal as AbortSignal | undefined;
        const timer = setTimeout(() => {
          resolve(new Response(JSON.stringify({ ok: true, data: { ok: true } }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }));
        }, 15_100);
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          const error = new Error("aborted");
          Object.assign(error, { name: "AbortError" });
          reject(error);
        }, { once: true });
      });
    }) as ReturnType<typeof vi.fn>;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;

    try {
      const client = new DaemonClient({ autoRenew: false });
      const pending = client.call("interact.click", {
        sessionId: "session-1",
        ref: "r1",
        timeoutMs: 15_000
      });

      await vi.advanceTimersByTimeAsync(15_100);

      await expect(pending).resolves.toEqual({ ok: true });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out when a success response body never resolves after headers arrive", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(async () => undefined);

    fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => await new Promise<unknown>(() => undefined),
      body: { cancel }
    })) as ReturnType<typeof vi.fn>;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;

    try {
      const client = new DaemonClient({ autoRenew: false });
      const pending = client.call("some.command", {}, { timeoutMs: 25 });
      const assertion = expect(pending).rejects.toThrow("Request timed out after 25ms");

      await vi.advanceTimersByTimeAsync(25);

      await assertion;
      expect(cancel).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out when an error response body never resolves after headers arrive", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(async () => undefined);

    fetchSpy = vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => await new Promise<string>(() => undefined),
      body: { cancel }
    })) as ReturnType<typeof vi.fn>;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;

    try {
      const client = new DaemonClient({ autoRenew: false });
      const pending = client.call("some.command", {}, { timeoutMs: 25 });
      const assertion = expect(pending).rejects.toThrow("Request timed out after 25ms");

      await vi.advanceTimersByTimeAsync(25);

      await assertion;
      expect(cancel).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not replay a timed-out command through refreshed daemon discovery", async () => {
    vi.useFakeTimers();

    fetchSpy = vi.fn((_url, options) => {
      return new Promise<never>((_resolve, reject) => {
        const signal = options?.signal as AbortSignal | undefined;
        signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          Object.assign(error, { name: "AbortError" });
          reject(error);
        }, { once: true });
      });
    }) as ReturnType<typeof vi.fn>;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;

    try {
      const client = new DaemonClient({ autoRenew: false });
      const pending = client.call("some.command", {}, { timeoutMs: 25 });
      const assertion = expect(pending).rejects.toThrow("Request timed out after 25ms");

      await vi.advanceTimersByTimeAsync(25);

      await assertion;
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0]?.[0]).toBe("http://127.0.0.1:12345/command");
    } finally {
      vi.useRealTimers();
    }
  });

  it("prefers the configured daemon connection when matching metadata points at another port", async () => {
    await writeDaemonConfig(tempRoot, 23456, "configured-token");
    const fetchCalls: string[] = [];

    fetchSpy = vi.fn(async (input, options) => {
      const url = String(input);
      fetchCalls.push(url);
      const authorization = String((options?.headers as Record<string, string> | undefined)?.Authorization ?? "");
      if (url === "http://127.0.0.1:23456/status") {
        expect(authorization).toBe("Bearer configured-token");
        return new Response(JSON.stringify({
          ok: true,
          pid: 4242,
          fingerprint: getCurrentDaemonFingerprint(),
          hub: { instanceId: "hub-current" },
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
            instanceId: "relay-current",
            epoch: 1,
            health: { ok: true, reason: "ok" }
          },
          binding: null
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (url === "http://127.0.0.1:23456/command") {
        expect(authorization).toBe("Bearer configured-token");
        return new Response(JSON.stringify({ ok: true, data: { ok: true, source: "configured" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as ReturnType<typeof vi.fn>;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;

    const client = new DaemonClient({ autoRenew: false });
    const result = await client.call("some.command");

    expect(result).toEqual({ ok: true, source: "configured" });
    expect(fetchCalls).toEqual([
      "http://127.0.0.1:23456/status",
      "http://127.0.0.1:23456/command"
    ]);

    const refreshedMetadata = JSON.parse(
      await readFile(join(tempRoot, "opendevbrowser", "daemon.json"), "utf-8")
    ) as { port: number; token: string; pid: number };
    expect(refreshedMetadata).toMatchObject({
      port: 23456,
      token: "configured-token",
      pid: 4242
    });
  });

  it("falls back to a current metadata daemon when the configured daemon does not prove current quickly", async () => {
    await writeDaemonConfig(tempRoot, 23456, "configured-token");
    const fetchCalls: string[] = [];

    fetchSpy = vi.fn(async (input, options) => {
      const url = String(input);
      fetchCalls.push(url);
      const authorization = String((options?.headers as Record<string, string> | undefined)?.Authorization ?? "");
      if (url === "http://127.0.0.1:23456/status") {
        expect(authorization).toBe("Bearer configured-token");
        return new Response("stale", { status: 503 });
      }
      if (url === "http://127.0.0.1:12345/command") {
        expect(authorization).toBe("Bearer test-token");
        return new Response(JSON.stringify({ ok: true, data: { ok: true, source: "metadata" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as ReturnType<typeof vi.fn>;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;

    const client = new DaemonClient({ autoRenew: false });
    const result = await client.call("some.command");

    expect(result).toEqual({ ok: true, source: "metadata" });
    expect(fetchCalls).toEqual([
      "http://127.0.0.1:23456/status",
      "http://127.0.0.1:12345/command"
    ]);
  });

  it("waits for a configured daemon to come back during a concurrent restart window", async () => {
    await rm(join(tempRoot, "opendevbrowser", "daemon.json"), { force: true });
    await writeDaemonConfig(tempRoot, 23456, "configured-token");

    const currentStatus = {
      ok: true as const,
      pid: 4242,
      fingerprint: getCurrentDaemonFingerprint(),
      hub: { instanceId: "hub-current" },
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
        instanceId: "relay-current",
        epoch: 1,
        health: { ok: true, reason: "ok" }
      },
      binding: null
    };
    const statusSpy = vi.spyOn(daemonStatusModule, "fetchDaemonStatus")
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(currentStatus);

    fetchSpy = vi.fn(async (input, options) => {
      const url = String(input);
      const authorization = String((options?.headers as Record<string, string> | undefined)?.Authorization ?? "");
      if (url === "http://127.0.0.1:23456/command") {
        expect(authorization).toBe("Bearer configured-token");
        return new Response(JSON.stringify({ ok: true, data: { ok: true, source: "recovered" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as ReturnType<typeof vi.fn>;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;

    try {
      const client = new DaemonClient({ autoRenew: false });
      const result = await client.call("some.command");

      expect(result).toEqual({ ok: true, source: "recovered" });
      expect(statusSpy.mock.calls).toEqual([
        [23456, "configured-token", { retryAttempts: 5, retryDelayMs: 250 }],
        [23456, "configured-token", { timeoutMs: 2_000 }]
      ]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const refreshedMetadata = JSON.parse(
        await readFile(join(tempRoot, "opendevbrowser", "daemon.json"), "utf-8")
      ) as { port: number; token: string; pid: number };
      expect(refreshedMetadata).toMatchObject({
        port: 23456,
        token: "configured-token",
        pid: 4242
      });
    } finally {
      statusSpy.mockRestore();
    }
  });

  it("resolves the daemon entrypoint in ESM contexts without process.argv[1]", () => {
    const originalArgv1 = process.argv[1];
    process.argv[1] = "";

    try {
      const entryPath = resolveCurrentDaemonEntrypointPath();
      expect(normalize(entryPath)).toBe(normalize(fileURLToPath(new URL("../src/cli/daemon.ts", import.meta.url))));
      expect(() => getCurrentDaemonFingerprint()).not.toThrow();
    } finally {
      process.argv[1] = originalArgv1;
    }
  });

  it("prefers the built CLI entrypoint for daemon fingerprinting when argv is missing", () => {
    const repoRoot = join(tmpdir(), "odb-daemon-fingerprint");
    const entryPath = join(repoRoot, "dist", "cli", "index.js");
    const moduleUrl = pathToFileURL(join(repoRoot, "dist", "cli", "daemon.js")).href;

    expect(resolveCurrentDaemonEntrypointPath({
      argv1: "",
      moduleUrl,
      entryExists: (path) => normalize(path) === normalize(entryPath)
    })).toBe(entryPath);
  });

  it("changes the fingerprint when the active daemon module changes under the same built entrypoint", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "odb-daemon-fingerprint-"));
    const cliDir = join(repoRoot, "dist", "cli");
    const entryPath = join(cliDir, "index.js");
    const modulePath = join(cliDir, "daemon.js");
    await mkdir(cliDir, { recursive: true });
    await writeFile(entryPath, "export const entry = true;\n", "utf-8");
    await writeFile(modulePath, "export const daemon = 'one';\n", "utf-8");

    const fingerprintA = getCurrentDaemonFingerprint({
      argv1: "",
      moduleUrl: pathToFileURL(modulePath).href,
      entryExists: (path) => normalize(path) === normalize(entryPath)
    });

    await writeFile(modulePath, "export const daemon = 'two';\n", "utf-8");

    const fingerprintB = getCurrentDaemonFingerprint({
      argv1: "",
      moduleUrl: pathToFileURL(modulePath).href,
      entryExists: (path) => normalize(path) === normalize(entryPath)
    });

    expect(fingerprintB).not.toBe(fingerprintA);
  });

  it("derives a restart-safe CLI tuple from the built daemon-client module when argv is missing", () => {
    const repoRoot = join(tmpdir(), "odb-daemon-client-restart");
    const entryPath = join(repoRoot, "dist", "cli", "index.js");
    const moduleUrl = pathToFileURL(join(repoRoot, "dist", "cli", "daemon-client.js")).href;

    expect(daemonClientTest.resolveDaemonRestartCommand({
      argv1: "",
      execPath: "/usr/local/bin/node",
      moduleUrl,
      entryExists: (path) => normalize(path) === normalize(entryPath)
    })).toEqual({
      command: "/usr/local/bin/node",
      args: [entryPath]
    });
  });

  it("fails restart resolution instead of reusing a source-only daemon module path", () => {
    const repoRoot = join(tmpdir(), "odb-daemon-client-source");

    expect(() => daemonClientTest.resolveDaemonRestartCommand({
      argv1: "",
      execPath: "/usr/local/bin/node",
      moduleUrl: pathToFileURL(join(repoRoot, "src", "cli", "daemon-client.ts")).href,
      entryExists: () => false
    })).toThrow("Daemon restart requires a stable CLI entrypoint.");
  });
});
