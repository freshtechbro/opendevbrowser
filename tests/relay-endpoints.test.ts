import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveConfig } from "../src/config";
import {
  buildLoopbackSessionRelayEndpoint,
  classifySessionRelayEndpoint,
  resolveRelayEndpoint,
  resolveSessionRelayRoute,
  sanitizeWsEndpoint
} from "../src/relay/relay-endpoints";

let originalFetch: typeof globalThis.fetch | undefined;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("relay endpoints", () => {
  it("classifies base relay endpoints for session routing", () => {
    expect(classifySessionRelayEndpoint("ws://127.0.0.1:8787")).toEqual({
      baseOrigin: "ws://127.0.0.1:8787",
      inputPath: ""
    });
  });

  it("classifies explicit /ops and /cdp relay paths", () => {
    expect(classifySessionRelayEndpoint("ws://127.0.0.1:8787/ops/")).toEqual({
      baseOrigin: "ws://127.0.0.1:8787",
      inputPath: "/ops"
    });
    expect(classifySessionRelayEndpoint("ws://127.0.0.1:8787/cdp")).toEqual({
      baseOrigin: "ws://127.0.0.1:8787",
      inputPath: "/cdp"
    });
  });

  it("returns null for non-session relay paths", () => {
    expect(classifySessionRelayEndpoint("ws://127.0.0.1:8787/annotation")).toBeNull();
  });

  it("resolves the default session relay route to /ops", () => {
    const parsed = classifySessionRelayEndpoint("ws://127.0.0.1:8787");
    expect(parsed).not.toBeNull();
    if (!parsed) throw new Error("Expected relay endpoint to parse.");
    expect(resolveSessionRelayRoute(parsed, {})).toEqual({
      route: "ops",
      normalizedEndpoint: "ws://127.0.0.1:8787/ops"
    });
  });

  it("resolves legacy base relay routes to /cdp", () => {
    const parsed = classifySessionRelayEndpoint("ws://127.0.0.1:8787");
    expect(parsed).not.toBeNull();
    if (!parsed) throw new Error("Expected relay endpoint to parse.");
    expect(resolveSessionRelayRoute(parsed, { extensionLegacy: true })).toEqual({
      route: "cdp",
      normalizedEndpoint: "ws://127.0.0.1:8787/cdp"
    });
  });

  it("preserves explicit /ops routes even when extensionLegacy is enabled", () => {
    const parsed = classifySessionRelayEndpoint("ws://127.0.0.1:8787/ops");
    expect(parsed).not.toBeNull();
    if (!parsed) throw new Error("Expected relay endpoint to parse.");
    expect(resolveSessionRelayRoute(parsed, { extensionLegacy: true })).toEqual({
      route: "ops",
      normalizedEndpoint: "ws://127.0.0.1:8787/ops"
    });
  });

  it("rejects explicit /cdp routes when extensionLegacy is not enabled", () => {
    const parsed = classifySessionRelayEndpoint("ws://127.0.0.1:8787/cdp");
    expect(parsed).not.toBeNull();
    if (!parsed) throw new Error("Expected relay endpoint to parse.");
    expect(resolveSessionRelayRoute(parsed, {})).toEqual({
      code: "extension_legacy_required",
      message: "Legacy extension relay (/cdp) requires extensionLegacy=true."
    });
  });

  it("builds loopback session relay endpoints from the requested route", () => {
    expect(buildLoopbackSessionRelayEndpoint(8787)).toBe("ws://127.0.0.1:8787/ops");
    expect(buildLoopbackSessionRelayEndpoint(8787, { extensionLegacy: true })).toBe("ws://127.0.0.1:8787/cdp");
  });

  it("resolves without pairing and adds relay authorization", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ relayPort: 8787, pairingRequired: false, instanceId: "i1", epoch: 2 })
    });
    globalThis.fetch = fetchMock as never;

    const result = await resolveRelayEndpoint({
      wsEndpoint: "ws://127.0.0.1:9000/annotation?token=abc",
      path: "annotation",
      config: resolveConfig({ relayToken: " secret " })
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:9000/config",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer secret" })
      })
    );
    expect(result.connectEndpoint).toBe("ws://127.0.0.1:8787/annotation");
    expect(result.reportedEndpoint).toBe("ws://127.0.0.1:8787/annotation");
  });

  it("uses https config endpoints when ws endpoint is wss", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ relayPort: 8787, pairingRequired: false })
    });
    globalThis.fetch = fetchMock as never;

    const result = await resolveRelayEndpoint({
      wsEndpoint: "wss://127.0.0.1:9001/annotation",
      path: "annotation",
      config: resolveConfig({})
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://127.0.0.1:9001/config",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(result.connectEndpoint).toBe("wss://127.0.0.1:8787/annotation");
  });

  it("omits authorization when relay token is empty after trimming", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ relayPort: 8787, pairingRequired: false })
    });
    globalThis.fetch = fetchMock as never;

    await resolveRelayEndpoint({
      wsEndpoint: "ws://127.0.0.1:9000/annotation",
      path: "annotation",
      config: resolveConfig({ relayToken: "   " })
    });

    const headers = (fetchMock.mock.calls[0]?.[1] as { headers?: Record<string, string> } | undefined)?.headers ?? {};
    expect(headers.Authorization).toBeUndefined();
  });

  it("treats non-string relay tokens as empty", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ relayPort: 8787, pairingRequired: false })
    });
    globalThis.fetch = fetchMock as never;

    const config = { ...resolveConfig({}), relayToken: 123 as unknown as string };
    await resolveRelayEndpoint({
      wsEndpoint: "ws://127.0.0.1:9000/annotation",
      path: "annotation",
      config
    });

    const headers = (fetchMock.mock.calls[0]?.[1] as { headers?: Record<string, string> } | undefined)?.headers ?? {};
    expect(headers.Authorization).toBeUndefined();
  });

  it("resolves pairing endpoints with tokenized websocket url", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ relayPort: 8787, pairingRequired: true, instanceId: "i1", epoch: 3 })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: "pair123", instanceId: "i1", epoch: 3 })
      });
    globalThis.fetch = fetchMock as never;

    const result = await resolveRelayEndpoint({
      wsEndpoint: "ws://127.0.0.1:9000/annotation",
      path: "annotation",
      config: resolveConfig({})
    });

    expect(result.connectEndpoint).toBe("ws://127.0.0.1:8787/annotation?token=pair123");
    expect(result.reportedEndpoint).toBe("ws://127.0.0.1:8787/annotation");
  });

  it("throws when relay pairing instance ids do not match", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ relayPort: 8787, pairingRequired: true, instanceId: "i1", epoch: 3 })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: "pair123", instanceId: "i2", epoch: 3 })
      });
    globalThis.fetch = fetchMock as never;

    await expect(resolveRelayEndpoint({
      wsEndpoint: "ws://127.0.0.1:9000/annotation",
      path: "annotation",
      config: resolveConfig({})
    })).rejects.toThrow("Relay pairing mismatch detected");
  });

  it("throws when relay config omits relay port", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ relayPort: 0, pairingRequired: false })
    });
    globalThis.fetch = fetchMock as never;

    await expect(resolveRelayEndpoint({
      wsEndpoint: "ws://127.0.0.1:9000/annotation",
      path: "annotation",
      config: resolveConfig({})
    })).rejects.toThrow("Relay config missing relayPort");
  });

  it("sanitizes websocket endpoints by stripping tokens", () => {
    expect(sanitizeWsEndpoint("ws://127.0.0.1:8787/annotation?token=abc#hash")).toBe(
      "ws://127.0.0.1:8787/annotation"
    );
  });
});
