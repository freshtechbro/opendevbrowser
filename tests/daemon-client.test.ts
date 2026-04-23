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

  it("prefers the configured daemon connection and stops the superseded metadata daemon", async () => {
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
      if (url === "http://127.0.0.1:12345/stop") {
        expect(authorization).toBe("Bearer test-token");
        return new Response("", { status: 200 });
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
      "http://127.0.0.1:12345/stop",
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

  it("keeps retrying the configured daemon before falling back to current metadata", async () => {
    await writeDaemonConfig(tempRoot, 23456, "configured-token");
    const fetchCalls: string[] = [];
    let statusAttempts = 0;

    fetchSpy = vi.fn(async (input, options) => {
      const url = String(input);
      fetchCalls.push(url);
      const authorization = String((options?.headers as Record<string, string> | undefined)?.Authorization ?? "");
      if (url === "http://127.0.0.1:23456/status") {
        expect(authorization).toBe("Bearer configured-token");
        statusAttempts += 1;
        if (statusAttempts < 3) {
          return new Response("starting", { status: 503 });
        }
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
      "http://127.0.0.1:23456/status",
      "http://127.0.0.1:23456/status",
      "http://127.0.0.1:12345/stop",
      "http://127.0.0.1:23456/command"
    ]);
  });

  it("keeps retrying when the configured daemon reports a stale fingerprint before turning current", async () => {
    await writeDaemonConfig(tempRoot, 23456, "configured-token");
    vi.useFakeTimers();

    const staleStatus = {
      ok: true as const,
      pid: 1111,
      fingerprint: "stale-fingerprint",
      hub: { instanceId: "hub-stale" },
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
        instanceId: "relay-stale",
        epoch: 1,
        health: { ok: true, reason: "ok" }
      },
      binding: null
    };
    const currentStatus = {
      ...staleStatus,
      pid: 4242,
      fingerprint: getCurrentDaemonFingerprint(),
      hub: { instanceId: "hub-current" },
      relay: {
        ...staleStatus.relay,
        instanceId: "relay-current"
      }
    };
    const statusSpy = vi.spyOn(daemonStatusModule, "fetchDaemonStatus")
      .mockResolvedValueOnce(staleStatus)
      .mockResolvedValueOnce(staleStatus)
      .mockResolvedValueOnce(currentStatus);

    fetchSpy = vi.fn(async (input, options) => {
      const url = String(input);
      const authorization = String((options?.headers as Record<string, string> | undefined)?.Authorization ?? "");
      if (url === "http://127.0.0.1:23456/stop") {
        expect(authorization).toBe("Bearer configured-token");
        return new Response("", { status: 200 });
      }
      if (url === "http://127.0.0.1:12345/stop") {
        expect(authorization).toBe("Bearer test-token");
        return new Response("", { status: 200 });
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

    try {
      const client = new DaemonClient({ autoRenew: false });
      const resultPromise = client.call("some.command");
      await vi.advanceTimersByTimeAsync(500);
      const result = await resultPromise;

      expect(result).toEqual({ ok: true, source: "configured" });
      expect(statusSpy.mock.calls).toEqual([
        [23456, "configured-token", { timeoutMs: 500 }],
        [23456, "configured-token", { timeoutMs: 500 }],
        [23456, "configured-token", { timeoutMs: 500 }]
      ]);
      expect(fetchSpy.mock.calls.map(([input]) => String(input))).toEqual([
        "http://127.0.0.1:12345/stop",
        "http://127.0.0.1:23456/command"
      ]);
    } finally {
      vi.useRealTimers();
      statusSpy.mockRestore();
    }
  });

  it("falls back to a current metadata daemon when the configured daemon does not prove current over the retry window", async () => {
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
      "http://127.0.0.1:23456/status",
      "http://127.0.0.1:23456/status",
      "http://127.0.0.1:12345/command"
    ]);
  });

  it("stops a stale configured daemon while falling back to a current metadata daemon", async () => {
    await writeDaemonConfig(tempRoot, 23456, "configured-token");
    await writeFile(join(tempRoot, "opendevbrowser", "daemon.json"), JSON.stringify({
      port: 12345,
      token: "test-token",
      pid: 9999,
      relayPort: 8787,
      startedAt: new Date().toISOString(),
      fingerprint: "stale-fingerprint"
    }), "utf-8");

    const staleConfiguredStatus = {
      ok: true as const,
      pid: 321,
      fingerprint: "stale-fingerprint",
      hub: { instanceId: "hub-stale" },
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
        instanceId: "relay-stale",
        epoch: 1,
        health: { ok: true, reason: "ok" }
      },
      binding: null
    };
    const currentMetadataStatus = {
      ...staleConfiguredStatus,
      pid: 4242,
      fingerprint: getCurrentDaemonFingerprint(),
      hub: { instanceId: "hub-current" },
      relay: {
        ...staleConfiguredStatus.relay,
        instanceId: "relay-current"
      }
    };

    const statusSpy = vi.spyOn(daemonStatusModule, "fetchDaemonStatus")
      .mockImplementation(async (port, _token, options) => {
        expect(options).toEqual({ timeoutMs: 5_000 });
        if (port === 23456) {
          return staleConfiguredStatus;
        }
        if (port === 12345) {
          return currentMetadataStatus;
        }
        throw new Error(`Unexpected status probe: ${port}`);
      });

    fetchSpy = vi.fn(async (input, options) => {
      const url = String(input);
      const authorization = String((options?.headers as Record<string, string> | undefined)?.Authorization ?? "");
      if (url === "http://127.0.0.1:23456/stop") {
        expect(authorization).toBe("Bearer configured-token");
        return new Response("", { status: 200 });
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

    try {
      const client = new DaemonClient({ autoRenew: false });
      const result = await client.call("some.command");

      expect(result).toEqual({ ok: true, source: "metadata" });
      expect(statusSpy.mock.calls.map(([port]) => port)).toEqual([23456, 12345]);
      expect(fetchSpy.mock.calls.map(([input]) => String(input))).toEqual([
        "http://127.0.0.1:23456/stop",
        "http://127.0.0.1:12345/command"
      ]);
    } finally {
      statusSpy.mockRestore();
    }
  });

  it("keeps the configured-daemon preference probe on a short timeout budget", async () => {
    await writeDaemonConfig(tempRoot, 23456, "configured-token");
    const statusSpy = vi.spyOn(daemonStatusModule, "fetchDaemonStatus")
      .mockResolvedValue(null);
    vi.useFakeTimers();

    fetchSpy = vi.fn(async (input, options) => {
      const url = String(input);
      const authorization = String((options?.headers as Record<string, string> | undefined)?.Authorization ?? "");
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

    try {
      const client = new DaemonClient({ autoRenew: false });
      const resultPromise = client.call("some.command");
      await vi.advanceTimersByTimeAsync(500);
      const result = await resultPromise;

      expect(result).toEqual({ ok: true, source: "metadata" });
      expect(statusSpy.mock.calls).toEqual([
        [23456, "configured-token", { timeoutMs: 500 }],
        [23456, "configured-token", { timeoutMs: 500 }],
        [23456, "configured-token", { timeoutMs: 500 }]
      ]);
    } finally {
      vi.useRealTimers();
      statusSpy.mockRestore();
    }
  });

  it("waits for the configured daemon before stopping stale metadata from another port", async () => {
    await writeDaemonConfig(tempRoot, 23456, "configured-token");
    await writeFile(join(tempRoot, "opendevbrowser", "daemon.json"), JSON.stringify({
      port: 12345,
      token: "test-token",
      pid: 9999,
      relayPort: 8787,
      startedAt: new Date().toISOString(),
      fingerprint: "stale-fingerprint"
    }), "utf-8");
    vi.useFakeTimers();

    const staleMetadataStatus = {
      ok: true as const,
      pid: 9999,
      fingerprint: "stale-fingerprint",
      hub: { instanceId: "hub-stale" },
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
        instanceId: "relay-stale",
        epoch: 1,
        health: { ok: true, reason: "ok" }
      },
      binding: null
    };
    const currentStatus = {
      ...staleMetadataStatus,
      pid: 4242,
      fingerprint: getCurrentDaemonFingerprint(),
      hub: { instanceId: "hub-current" },
      relay: {
        ...staleMetadataStatus.relay,
        instanceId: "relay-current"
      }
    };
    let metadataChecked = false;
    let recoveryAttempts = 0;
    const statusSpy = vi.spyOn(daemonStatusModule, "fetchDaemonStatus")
      .mockImplementation(async (port, _token, options) => {
        if (!metadataChecked && port === 23456) {
          expect(port).toBe(23456);
          expect(options).toEqual({ timeoutMs: 5_000 });
          return null;
        }
        if (!metadataChecked && port === 12345) {
          metadataChecked = true;
          expect(port).toBe(12345);
          expect(options).toEqual({ timeoutMs: 5_000 });
          return staleMetadataStatus;
        }
        expect(port).toBe(23456);
        expect(options).toEqual(expect.objectContaining({ timeoutMs: expect.any(Number) }));
        recoveryAttempts += 1;
        return recoveryAttempts < 2 ? null : currentStatus;
      });

    fetchSpy = vi.fn(async (input, options) => {
      const url = String(input);
      const authorization = String((options?.headers as Record<string, string> | undefined)?.Authorization ?? "");
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

    try {
      const client = new DaemonClient({ autoRenew: false });
      const resultPromise = client.call("some.command");
      await vi.advanceTimersByTimeAsync(1_500);
      const result = await resultPromise;

      expect(result).toEqual({ ok: true, source: "configured" });
      expect(statusSpy.mock.calls.some(([port]) => port === 12345)).toBe(true);
      expect(fetchSpy.mock.calls.map(([input]) => String(input))).toEqual([
        "http://127.0.0.1:12345/stop",
        "http://127.0.0.1:23456/command"
      ]);
    } finally {
      vi.useRealTimers();
      statusSpy.mockRestore();
    }
  });

  it("does not block a current configured daemon command on stale metadata cleanup", async () => {
    await writeDaemonConfig(tempRoot, 23456, "configured-token");
    await writeFile(join(tempRoot, "opendevbrowser", "daemon.json"), JSON.stringify({
      port: 12345,
      token: "test-token",
      pid: 9999,
      relayPort: 8787,
      startedAt: new Date().toISOString(),
      fingerprint: "stale-fingerprint"
    }), "utf-8");
    vi.useFakeTimers();

    const staleMetadataStatus = {
      ok: true as const,
      pid: 9999,
      fingerprint: "stale-fingerprint",
      hub: { instanceId: "hub-stale" },
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
        instanceId: "relay-stale",
        epoch: 1,
        health: { ok: true, reason: "ok" }
      },
      binding: null
    };
    const currentStatus = {
      ...staleMetadataStatus,
      pid: 4242,
      fingerprint: getCurrentDaemonFingerprint(),
      hub: { instanceId: "hub-current" },
      relay: {
        ...staleMetadataStatus.relay,
        instanceId: "relay-current"
      }
    };
    let metadataChecked = false;
    let recoveryAttempts = 0;
    const statusSpy = vi.spyOn(daemonStatusModule, "fetchDaemonStatus")
      .mockImplementation(async (port, _token, options) => {
        if (!metadataChecked && port === 23456) {
          expect(options).toEqual({ timeoutMs: 5_000 });
          return null;
        }
        if (!metadataChecked && port === 12345) {
          metadataChecked = true;
          expect(options).toEqual({ timeoutMs: 5_000 });
          return staleMetadataStatus;
        }
        expect(port).toBe(23456);
        expect(options).toEqual(expect.objectContaining({ timeoutMs: expect.any(Number) }));
        recoveryAttempts += 1;
        return recoveryAttempts < 2 ? null : currentStatus;
      });

    fetchSpy = vi.fn(async (input, options) => {
      const url = String(input);
      const authorization = String((options?.headers as Record<string, string> | undefined)?.Authorization ?? "");
      if (url === "http://127.0.0.1:12345/stop") {
        expect(authorization).toBe("Bearer test-token");
        return await new Promise<Response>(() => undefined);
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

    try {
      const client = new DaemonClient({ autoRenew: false });
      const resultPromise = client.call("some.command");
      await vi.advanceTimersByTimeAsync(1_500);
      const result = await resultPromise;

      expect(result).toEqual({ ok: true, source: "configured" });
      expect(fetchSpy.mock.calls.map(([input]) => String(input))).toEqual([
        "http://127.0.0.1:12345/stop",
        "http://127.0.0.1:23456/command"
      ]);
    } finally {
      vi.useRealTimers();
      statusSpy.mockRestore();
    }
  });

  it("restarts a stale configured daemon instead of waiting before the restart", async () => {
    await rm(join(tempRoot, "opendevbrowser", "daemon.json"), { force: true });
    await writeDaemonConfig(tempRoot, 23456, "configured-token");
    vi.useFakeTimers();

    const staleStatus = {
      ok: true as const,
      pid: 1111,
      fingerprint: "stale-fingerprint",
      hub: { instanceId: "hub-stale" },
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
        instanceId: "relay-stale",
        epoch: 1,
        health: { ok: true, reason: "ok" }
      },
      binding: null
    };
    const currentStatus = {
      ...staleStatus,
      pid: 4242,
      fingerprint: getCurrentDaemonFingerprint(),
      hub: { instanceId: "hub-current" },
      relay: {
        ...staleStatus.relay,
        instanceId: "relay-current"
      }
    };
    const statusSpy = vi.spyOn(daemonStatusModule, "fetchDaemonStatus")
      .mockResolvedValueOnce(staleStatus)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(currentStatus);

    fetchSpy = vi.fn(async (input, options) => {
      const url = String(input);
      const authorization = String((options?.headers as Record<string, string> | undefined)?.Authorization ?? "");
      if (url === "http://127.0.0.1:23456/stop") {
        expect(authorization).toBe("Bearer configured-token");
        return new Response("", { status: 200 });
      }
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
      const resultPromise = client.call("some.command");
      await vi.advanceTimersByTimeAsync(500);
      const result = await resultPromise;

      expect(result).toEqual({ ok: true, source: "recovered" });
      expect(statusSpy.mock.calls[0]).toEqual([
        23456,
        "configured-token",
        { timeoutMs: 5_000 }
      ]);
      expect(statusSpy).toHaveBeenCalledTimes(3);
      expect(statusSpy.mock.calls[1]?.[2]).toEqual({ timeoutMs: 5_000 });
      expect(statusSpy.mock.calls[2]?.[2]).toEqual({ timeoutMs: 5_000 });
      expect(fetchSpy.mock.calls.map(([input]) => String(input))).toEqual([
        "http://127.0.0.1:23456/stop",
        "http://127.0.0.1:23456/command"
      ]);
    } finally {
      vi.useRealTimers();
      statusSpy.mockRestore();
    }
  });

  it("fails stale-daemon restart when the configured port never clears", async () => {
    await rm(join(tempRoot, "opendevbrowser", "daemon.json"), { force: true });
    await writeDaemonConfig(tempRoot, 23456, "configured-token");
    vi.useFakeTimers();

    const staleStatus = {
      ok: true as const,
      pid: 1111,
      fingerprint: "stale-fingerprint",
      hub: { instanceId: "hub-stale" },
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
        instanceId: "relay-stale",
        epoch: 1,
        health: { ok: true, reason: "ok" }
      },
      binding: null
    };
    const statusSpy = vi.spyOn(daemonStatusModule, "fetchDaemonStatus")
      .mockResolvedValueOnce(staleStatus);
    for (let attempt = 0; attempt < 21; attempt += 1) {
      statusSpy.mockResolvedValueOnce(staleStatus);
    }

    fetchSpy = vi.fn(async (input, options) => {
      const url = String(input);
      const authorization = String((options?.headers as Record<string, string> | undefined)?.Authorization ?? "");
      if (url === "http://127.0.0.1:23456/stop") {
        expect(authorization).toBe("Bearer configured-token");
        return new Response("", { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as ReturnType<typeof vi.fn>;

    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;

    try {
      const client = new DaemonClient({ autoRenew: false });
      const resultPromise = client.call("some.command");
      const assertion = expect(resultPromise).rejects.toThrow(
        "Daemon restart could not reclaim the configured port after fingerprint mismatch. Start with `opendevbrowser serve`."
      );
      await vi.advanceTimersByTimeAsync(5_250);
      await assertion;
      expect(fetchSpy.mock.calls.map(([input]) => String(input))).toEqual([
        "http://127.0.0.1:23456/stop"
      ]);
    } finally {
      vi.useRealTimers();
      statusSpy.mockRestore();
    }
  });

  it("waits past the old concurrent-restart window for a configured daemon to recover", async () => {
    await rm(join(tempRoot, "opendevbrowser", "daemon.json"), { force: true });
    await writeDaemonConfig(tempRoot, 23456, "configured-token");
    vi.useFakeTimers();

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
    let callCount = 0;
    let recoveryAttempts = 0;
    const statusSpy = vi.spyOn(daemonStatusModule, "fetchDaemonStatus")
      .mockImplementation(async () => {
        callCount += 1;
        if (callCount <= 5) {
          return null;
        }
        recoveryAttempts += 1;
        return recoveryAttempts < 3 ? null : currentStatus;
      });

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
      const resultPromise = client.call("some.command");
      await vi.advanceTimersByTimeAsync(2_000);
      const result = await resultPromise;

      expect(result).toEqual({ ok: true, source: "recovered" });
      expect(statusSpy.mock.calls[0]).toEqual([
        23456,
        "configured-token",
        { timeoutMs: 5_000 }
      ]);
      expect(statusSpy).toHaveBeenCalledTimes(8);
      expect(statusSpy.mock.calls[5]?.[2]).toEqual(expect.objectContaining({ timeoutMs: expect.any(Number) }));
      expect(statusSpy.mock.calls[7]?.[2]).toEqual(expect.objectContaining({ timeoutMs: expect.any(Number) }));
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
      vi.useRealTimers();
      statusSpy.mockRestore();
    }
  });

  it("fails after the short recovery probe when no current daemon appears", async () => {
    await rm(join(tempRoot, "opendevbrowser", "daemon.json"), { force: true });
    await writeDaemonConfig(tempRoot, 23456, "configured-token");
    vi.useFakeTimers();

    const statusSpy = vi.spyOn(daemonStatusModule, "fetchDaemonStatus")
      .mockResolvedValue(null);

    try {
      const client = new DaemonClient({ autoRenew: false });
      let settled = false;
      const resultPromise = client.call("some.command");
      const assertion = expect(resultPromise).rejects.toThrow("Daemon not running. Start with `opendevbrowser serve`.");
      void resultPromise.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        }
      );

      await vi.advanceTimersByTimeAsync(6_001);

      expect(settled).toBe(true);
      await assertion;
      expect(statusSpy.mock.calls[0]).toEqual([
        23456,
        "configured-token",
        { timeoutMs: 5_000 }
      ]);
      expect(statusSpy.mock.calls[1]).toEqual([
        23456,
        "configured-token",
        { timeoutMs: 5_000 }
      ]);
    } finally {
      vi.useRealTimers();
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
      execArgv: [],
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
      execArgv: [],
      moduleUrl: pathToFileURL(join(repoRoot, "src", "cli", "daemon-client.ts")).href,
      entryExists: () => false
    })).toThrow("Daemon restart requires a stable CLI entrypoint.");
  });

  it("preserves loader args when restart resolution uses a source entrypoint", () => {
    const entryPath = join(tmpdir(), "odb-daemon-client-source", "src", "cli", "index.ts");

    expect(daemonClientTest.resolveDaemonRestartCommand({
      argv1: entryPath,
      execPath: "/usr/local/bin/node",
      execArgv: ["--import", "tsx"],
      moduleUrl: pathToFileURL(join(tmpdir(), "odb-daemon-client-source", "src", "cli", "daemon-client.ts")).href,
      entryExists: (path) => normalize(path) === normalize(entryPath)
    })).toEqual({
      command: "/usr/local/bin/node",
      args: ["--import", "tsx", entryPath]
    });
  });

  it("preserves split-form runtime args while keeping source loader context", () => {
    const entryPath = join(tmpdir(), "odb-daemon-client-source-split", "src", "cli", "index.ts");

    expect(daemonClientTest.resolveDaemonRestartCommand({
      argv1: entryPath,
      execPath: "/usr/local/bin/node",
      execArgv: ["--conditions", "development", "--import", "tsx"],
      moduleUrl: pathToFileURL(join(tmpdir(), "odb-daemon-client-source-split", "src", "cli", "daemon-client.ts")).href,
      entryExists: (path) => normalize(path) === normalize(entryPath)
    })).toEqual({
      command: "/usr/local/bin/node",
      args: ["--conditions", "development", "--import", "tsx", entryPath]
    });
  });

  it("treats native TypeScript runtime flags as valid source restart context", () => {
    const entryPath = join(tmpdir(), "odb-daemon-client-source-native", "src", "cli", "index.ts");

    expect(daemonClientTest.resolveDaemonRestartCommand({
      argv1: entryPath,
      execPath: "/usr/local/bin/node",
      execArgv: ["--experimental-strip-types", "--enable-source-maps"],
      moduleUrl: pathToFileURL(join(tmpdir(), "odb-daemon-client-source-native", "src", "cli", "daemon-client.ts")).href,
      entryExists: (path) => normalize(path) === normalize(entryPath)
    })).toEqual({
      command: "/usr/local/bin/node",
      args: ["--experimental-strip-types", "--enable-source-maps", entryPath]
    });
  });

  it("preserves inline loader and runtime args while dropping debugger flags for source restarts", () => {
    const entryPath = join(tmpdir(), "odb-daemon-client-source-inline", "src", "cli", "index.ts");

    expect(daemonClientTest.resolveDaemonRestartCommand({
      argv1: entryPath,
      execPath: "/usr/local/bin/node",
      execArgv: ["--enable-source-maps", "--env-file=.env", "--inspect-brk=9229", "--import=tsx"],
      moduleUrl: pathToFileURL(join(tmpdir(), "odb-daemon-client-source-inline", "src", "cli", "daemon-client.ts")).href,
      entryExists: (path) => normalize(path) === normalize(entryPath)
    })).toEqual({
      command: "/usr/local/bin/node",
      args: ["--enable-source-maps", "--env-file=.env", "--import=tsx", entryPath]
    });
  });

  it("preserves built runtime args while dropping debugger flags for JS restarts", () => {
    const entryPath = join(tmpdir(), "odb-daemon-client-built", "dist", "cli", "index.js");

    expect(daemonClientTest.resolveDaemonRestartCommand({
      argv1: entryPath,
      execPath: "/usr/local/bin/node",
      execArgv: ["--env-file=.env", "--enable-source-maps", "--inspect=9229"],
      moduleUrl: pathToFileURL(join(tmpdir(), "odb-daemon-client-built", "dist", "cli", "daemon-client.js")).href,
      entryExists: (path) => normalize(path) === normalize(entryPath)
    })).toEqual({
      command: "/usr/local/bin/node",
      args: ["--env-file=.env", "--enable-source-maps", entryPath]
    });
  });

  it("treats require hooks as valid source restart loader context", () => {
    const entryPath = join(tmpdir(), "odb-daemon-client-source-require", "src", "cli", "index.ts");

    expect(daemonClientTest.resolveDaemonRestartCommand({
      argv1: entryPath,
      execPath: "/usr/local/bin/node",
      execArgv: ["-r", "ts-node/register/transpile-only", "--enable-source-maps"],
      moduleUrl: pathToFileURL(join(tmpdir(), "odb-daemon-client-source-require", "src", "cli", "daemon-client.ts")).href,
      entryExists: (path) => normalize(path) === normalize(entryPath)
    })).toEqual({
      command: "/usr/local/bin/node",
      args: ["-r", "ts-node/register/transpile-only", "--enable-source-maps", entryPath]
    });
  });

  it("drops debugger flags when restart resolution preserves source loader args", () => {
    const entryPath = join(tmpdir(), "odb-daemon-client-source-loader", "src", "cli", "index.ts");

    expect(daemonClientTest.resolveDaemonRestartCommand({
      argv1: entryPath,
      execPath: "/usr/local/bin/node",
      execArgv: ["--inspect-brk=9229", "--import", "tsx"],
      moduleUrl: pathToFileURL(join(tmpdir(), "odb-daemon-client-source-loader", "src", "cli", "daemon-client.ts")).href,
      entryExists: (path) => normalize(path) === normalize(entryPath)
    })).toEqual({
      command: "/usr/local/bin/node",
      args: ["--import", "tsx", entryPath]
    });
  });

  it("fails restart resolution for source entrypoints without loader args", () => {
    const entryPath = join(tmpdir(), "odb-daemon-client-source-missing-loader", "src", "cli", "index.ts");

    expect(() => daemonClientTest.resolveDaemonRestartCommand({
      argv1: entryPath,
      execPath: "/usr/local/bin/node",
      execArgv: [],
      moduleUrl: pathToFileURL(join(tmpdir(), "odb-daemon-client-source-missing-loader", "src", "cli", "daemon-client.ts")).href,
      entryExists: (path) => normalize(path) === normalize(entryPath)
    })).toThrow("Daemon restart requires the original loader context.");
  });
});
