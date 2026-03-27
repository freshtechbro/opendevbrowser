import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserFallbackPort } from "../src/providers/types";

describe("provider runtime coverage seams", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock("../src/providers/browser-fallback");
    vi.doUnmock("../src/providers/errors");
    vi.resetModules();
  });

  it("rethrows the original fetch error when browser fallback declines runtime recovery", async () => {
    vi.resetModules();
    const actual = await vi.importActual<typeof import("../src/providers/browser-fallback")>(
      "../src/providers/browser-fallback"
    );
    const resolveProviderBrowserFallback = vi.fn(async () => null);
    vi.doMock("../src/providers/browser-fallback", () => ({
      ...actual,
      resolveProviderBrowserFallback
    }));

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("ECONNRESET runtime coverage seam");
    }) as unknown as typeof fetch);

    const { createDefaultRuntime } = await import("../src/providers");
    const browserFallbackPort: BrowserFallbackPort = {
      resolve: vi.fn(async () => ({
        ok: true,
        reasonCode: "env_limited",
        output: {}
      }))
    };

    const runtime = createDefaultRuntime({}, { browserFallbackPort });
    const result = await runtime.search(
      { query: "browser automation", limit: 3 },
      { source: "social", providerIds: ["social/facebook"] }
    );

    expect(result.ok).toBe(false);
    expect(result.records).toEqual([]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.error).toMatchObject({
      code: "network",
      message: "Failed to retrieve https://www.facebook.com/search/top?q=browser%20automation&page=1",
      provider: "social/facebook",
      source: "social"
    });
    expect(resolveProviderBrowserFallback).toHaveBeenCalledWith(expect.objectContaining({
      provider: "social/facebook",
      source: "social",
      operation: "search",
      reasonCode: "env_limited"
    }));
  });

  it("exposes linkedin extension-first recovery hints through the registered provider adapter", async () => {
    vi.resetModules();
    const { createDefaultRuntime } = await import("../src/providers");
    const runtime = createDefaultRuntime();
    const linkedin = runtime.listProviders().find((provider) => provider.id === "social/linkedin");
    const instagram = runtime.listProviders().find((provider) => provider.id === "social/instagram");

    expect(linkedin?.recoveryHints?.()).toEqual({
      preferredFallbackModes: ["extension", "managed_headed"]
    });
    expect(instagram?.recoveryHints).toBeUndefined();
  });

  it("maps upstream normalized runtime errors without explicit reason codes to ip_blocked fallback", async () => {
    vi.resetModules();
    const actualErrors = await vi.importActual<typeof import("../src/providers/errors")>(
      "../src/providers/errors"
    );
    vi.doMock("../src/providers/errors", () => ({
      ...actualErrors,
      toProviderError: vi.fn(() => ({
        code: "upstream",
        message: "synthetic upstream",
        retryable: false
      }))
    }));

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("ignored upstream transport");
    }) as unknown as typeof fetch);

    const resolve = vi.fn(async (request: { reasonCode: string; url?: string }) => ({
      ok: true,
      reasonCode: request.reasonCode as "ip_blocked",
      output: {
        url: request.url ?? "https://www.facebook.com/search/top?q=browser%20automation&page=1",
        html: "<html><body><main>fallback upstream content</main></body></html>"
      }
    }));

    const { createDefaultRuntime } = await import("../src/providers");
    const runtime = createDefaultRuntime({}, {
      browserFallbackPort: {
        resolve
      }
    });
    const result = await runtime.search(
      { query: "browser automation", limit: 3 },
      { source: "social", providerIds: ["social/facebook"] }
    );

    expect(result.ok).toBe(true);
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({
      provider: "social/facebook",
      reasonCode: "ip_blocked"
    }));
  });

  it("falls back to env_limited when normalized runtime errors have no mapped fallback reason", async () => {
    vi.resetModules();
    const actualErrors = await vi.importActual<typeof import("../src/providers/errors")>(
      "../src/providers/errors"
    );
    vi.doMock("../src/providers/errors", () => ({
      ...actualErrors,
      toProviderError: vi.fn(() => ({
        code: "auth",
        message: "synthetic auth without reason",
        retryable: false
      }))
    }));

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("ignored auth transport");
    }) as unknown as typeof fetch);

    const resolve = vi.fn(async (request: { reasonCode: string; url?: string }) => ({
      ok: true,
      reasonCode: request.reasonCode as "env_limited",
      output: {
        url: request.url ?? "https://www.facebook.com/search/top?q=browser%20automation&page=1",
        html: "<html><body><main>fallback auth content</main></body></html>"
      }
    }));

    const { createDefaultRuntime } = await import("../src/providers");
    const runtime = createDefaultRuntime({}, {
      browserFallbackPort: {
        resolve
      }
    });
    const result = await runtime.search(
      { query: "browser automation", limit: 3 },
      { source: "social", providerIds: ["social/facebook"] }
    );

    expect(result.ok).toBe(true);
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({
      provider: "social/facebook",
      reasonCode: "env_limited"
    }));
  });

  it("uses provider map ids when sequential failure envelopes have no attempted order entries", async () => {
    vi.resetModules();
    const { ProviderRuntime } = await import("../src/providers");
    const runtime = new ProviderRuntime();
    const ghostProvider = {
      id: "web/ghost",
      source: "web",
      search: async () => [],
      capabilities: () => ({
        providerId: "web/ghost",
        source: "web" as const,
        operations: {
          search: { op: "search" as const, supported: true },
          fetch: { op: "fetch" as const, supported: false },
          crawl: { op: "crawl" as const, supported: false },
          post: { op: "post" as const, supported: false }
        },
        policy: {
          posting: "unsupported" as const,
          riskNoticeRequired: false,
          confirmationRequired: false
        },
        metadata: {}
      })
    };

    const providers = {
      [Symbol.iterator]: function* () {
        return;
      },
      map: (mapper: (provider: typeof ghostProvider) => string) => [mapper(ghostProvider)]
    } as unknown as typeof ghostProvider[];

    const internals = runtime as unknown as {
      executeSequential: (
        providers: typeof ghostProvider[],
        operation: "search",
        input: { query: string },
        trace: { requestId: string; ts: string },
        timeoutMs: number,
        selection: "auto",
        startedAt: number,
        tierMetadata: { selected: "A"; reasonCode: string }
      ) => Promise<{ ok: boolean; providerOrder: string[]; failures: unknown[] }>;
    };

    const result = await internals.executeSequential(
      providers,
      "search",
      { query: "ghost" },
      { requestId: "providers-runtime-coverage", ts: "2026-03-23T00:00:00.000Z" },
      50,
      "auto",
      Date.now(),
      { selected: "A", reasonCode: "default_tier" }
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([]);
    expect(result.providerOrder).toEqual(["web/ghost"]);
  });

  it("passes browser transport run options through provider context", async () => {
    vi.resetModules();
    const { ProviderRuntime } = await import("../src/providers");
    const runtime = new ProviderRuntime();
    let capturedContext: Record<string, unknown> | undefined;

    runtime.register({
      id: "web/context-hints",
      source: "web",
      search: vi.fn(async (_input, context) => {
        capturedContext = context as unknown as Record<string, unknown>;
        return [];
      }),
      capabilities: () => ({
        providerId: "web/context-hints",
        source: "web" as const,
        operations: {
          search: { op: "search" as const, supported: true },
          fetch: { op: "fetch" as const, supported: false },
          crawl: { op: "crawl" as const, supported: false },
          post: { op: "post" as const, supported: false }
        },
        policy: {
          posting: "unsupported" as const,
          riskNoticeRequired: false,
          confirmationRequired: false
        },
        metadata: {}
      })
    });

    const result = await runtime.search(
      { query: "context" },
      {
        source: "web",
        providerIds: ["web/context-hints"],
        preferredFallbackModes: ["extension"],
        forceBrowserTransport: true,
        challengeAutomationMode: "browser_with_helper"
      }
    );

    expect(result.ok).toBe(true);
    expect(capturedContext).toMatchObject({
      preferredFallbackModes: ["extension"],
      forceBrowserTransport: true,
      challengeAutomationMode: "browser_with_helper"
    });
  });
});
