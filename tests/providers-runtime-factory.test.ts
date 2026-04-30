import { describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  requireChallengeOrchestrationConfig,
  resolveConfig
} from "../src/config";
import type { BrowserManagerLike, ChallengeRuntimeHandle } from "../src/browser/manager-types";
import { OpsRequestTimeoutError } from "../src/browser/ops-client";
import { ProviderRuntimeError } from "../src/providers/errors";
import { resolveProviderRuntimePolicy } from "../src/providers/runtime-policy";
import {
  buildRuntimeInitFromConfig,
  createBrowserFallbackPort,
  createConfiguredProviderRuntime
} from "../src/providers/runtime-factory";

const makeChallengeRuntimeHandle = (): ChallengeRuntimeHandle => ({
  status: vi.fn(async () => ({ mode: "extension", activeTargetId: "target-1" })),
  goto: vi.fn(async () => ({ timingMs: 1 })),
  waitForLoad: vi.fn(async () => ({ timingMs: 1 })),
  snapshot: vi.fn(async () => ({ content: "", warnings: [] })),
  click: vi.fn(async () => ({ timingMs: 1, navigated: false })),
  hover: vi.fn(async () => ({ timingMs: 1 })),
  press: vi.fn(async () => ({ timingMs: 1 })),
  type: vi.fn(async () => ({ timingMs: 1 })),
  select: vi.fn(async () => undefined),
  scroll: vi.fn(async () => undefined),
  pointerMove: vi.fn(async () => ({ timingMs: 1 })),
  pointerDown: vi.fn(async () => ({ timingMs: 1 })),
  pointerUp: vi.fn(async () => ({ timingMs: 1 })),
  drag: vi.fn(async () => ({ timingMs: 1 })),
  cookieList: vi.fn(async () => ({ count: 0, cookies: [] })),
  cookieImport: vi.fn(async () => ({ imported: 0, rejected: [] })),
  debugTraceSnapshot: vi.fn(async () => ({
    channels: {
      console: { events: [] },
      network: { events: [] },
      exception: { events: [] }
    }
  })),
  resolveRefPoint: vi.fn(async () => ({ x: 640, y: 360 }))
});

const expectStagedSettle = (
  waitForLoad: ReturnType<typeof vi.fn>,
  sessionId: string,
  loadTimeoutMs: number,
  networkIdleTimeoutMs: number
) => {
  expect(waitForLoad).toHaveBeenNthCalledWith(1, sessionId, "load", loadTimeoutMs);
  expect(waitForLoad).toHaveBeenNthCalledWith(2, sessionId, "networkidle", networkIdleTimeoutMs);
};

describe("provider runtime factory", () => {
  it("returns undefined fallback port when manager is missing", () => {
    expect(createBrowserFallbackPort(undefined)).toBeUndefined();
  });

  it("returns env_limited when fallback request has no URL", async () => {
    const manager = {
      launch: vi.fn(),
      withPage: vi.fn(),
      goto: vi.fn(),
      status: vi.fn(),
      disconnect: vi.fn()
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager);
    const response = await port?.resolve({
      provider: "social/youtube",
      source: "social",
      operation: "fetch",
      reasonCode: "transcript_unavailable",
      trace: { requestId: "rf-1", ts: "2026-02-16T00:00:00.000Z" }
    });

    expect(response).toMatchObject({
      ok: false,
      reasonCode: "env_limited"
    });
    expect(manager.launch).not.toHaveBeenCalled();
  });

  it("captures fallback HTML and disconnects temporary session", async () => {
    const waitForTimeout = vi.fn(async () => undefined);
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "fallback-session" })),
      goto: vi.fn(async () => ({ ok: true })),
      waitForLoad: vi.fn(async () => ({ timingMs: 5 })),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
        return callback({
          waitForTimeout,
          content: async () => "<html><body>fallback</body></html>"
        });
      }),
      status: vi.fn(async () => ({ mode: "extension", url: "https://example.com/watch" })),
      disconnect: vi.fn(async () => undefined)
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager);
    const response = await port?.resolve({
      provider: "social/youtube",
      source: "social",
      operation: "fetch",
      reasonCode: "challenge_detected",
      trace: { requestId: "rf-2", ts: "2026-02-16T00:00:00.000Z" },
      url: "https://example.com/watch"
    });

    expect(response).toMatchObject({
      ok: true,
      reasonCode: "challenge_detected",
      mode: "extension",
      output: {
        html: "<html><body>fallback</body></html>",
        url: "https://example.com/watch"
      },
      details: {
        provider: "social/youtube",
        operation: "fetch"
      }
    });
    expect(manager.launch).toHaveBeenCalledWith(expect.objectContaining({
      noExtension: true,
      headless: false,
      startUrl: "about:blank",
      persistProfile: false
    }));
    expect(manager.goto).toHaveBeenCalledWith("fallback-session", "https://example.com/watch", "load", 45000);
    expectStagedSettle(manager.waitForLoad as ReturnType<typeof vi.fn>, "fallback-session", 1666, 3334);
    expect(waitForTimeout.mock.calls.map(([delay]) => delay)).toEqual([2000, 250]);
    expect(manager.disconnect).toHaveBeenCalledWith("fallback-session", true);
  });

  it("attempts staged load settle before capture", async () => {
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "staged-settle-session" })),
      goto: vi.fn(async () => ({ ok: true })),
      waitForLoad: vi.fn(async () => ({ timingMs: 5 })),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
        return callback({
          waitForTimeout: async () => undefined,
          content: async () => "<html><body>settled</body></html>"
        });
      }),
      status: vi.fn(async () => ({ mode: "managed", url: "https://example.com/settled" })),
      disconnect: vi.fn(async () => undefined)
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager);
    const response = await port?.resolve({
      provider: "community/default",
      source: "community",
      operation: "search",
      reasonCode: "challenge_detected",
      trace: { requestId: "rf-staged-settle", ts: "2026-04-08T00:00:00.000Z" },
      url: "https://example.com/settled"
    });

    expect(response).toMatchObject({ ok: true });
    expect(manager.waitForLoad).toHaveBeenNthCalledWith(1, "staged-settle-session", "load", 1666);
    expect(manager.waitForLoad).toHaveBeenNthCalledWith(2, "staged-settle-session", "networkidle", 3334);
  });

  it("recaptures fallback html until the document stabilizes", async () => {
    const waitForTimeout = vi.fn(async () => undefined);
    const stableHtml = "<html><body><main>Stable recovered content</main><a href=\"https://example.com/post/1\">post</a></body></html>";
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "stable-capture-session" })),
      goto: vi.fn(async () => ({ ok: true })),
      waitForLoad: vi.fn(async () => ({ timingMs: 5 })),
      withPage: vi.fn()
        .mockImplementationOnce(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => callback({
          waitForTimeout,
          content: async () => "<html><body><main>Loading</main></body></html>"
        }))
        .mockImplementationOnce(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => callback({
          waitForTimeout,
          content: async () => stableHtml
        }))
        .mockImplementationOnce(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => callback({
          waitForTimeout,
          content: async () => stableHtml
        })),
      status: vi.fn(async () => ({ mode: "managed", url: "https://example.com/recovered" })),
      disconnect: vi.fn(async () => undefined)
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager);
    const response = await port?.resolve({
      provider: "community/default",
      source: "community",
      operation: "search",
      reasonCode: "challenge_detected",
      trace: { requestId: "rf-stable-capture", ts: "2026-04-08T00:00:00.000Z" },
      url: "https://example.com/recovered"
    });

    expect(response).toMatchObject({
      ok: true,
      output: {
        html: stableHtml
      },
      details: {
        captureDiagnostics: {
          attempts: 3,
          stabilized: true,
          finalLinkCount: 1
        }
      }
    });
    expect(waitForTimeout.mock.calls.map(([delay]) => delay)).toEqual([500, 250, 250]);
  });

  it("waits longer before capturing shopping fallback HTML", async () => {
    const waitForTimeout = vi.fn(async () => undefined);
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "shopping-fallback-session" })),
      goto: vi.fn(async () => ({ ok: true })),
      waitForLoad: vi.fn(async () => ({ timingMs: 25 })),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
        return callback({
          waitForTimeout,
          content: async () => "<html><body>shopping fallback</body></html>"
        });
      }),
      status: vi.fn(async () => ({ mode: "managed", url: "https://example.com/search" })),
      disconnect: vi.fn(async () => undefined)
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager);
    const response = await port?.resolve({
      provider: "shopping/target",
      source: "shopping",
      operation: "search",
      reasonCode: "rate_limited",
      trace: { requestId: "rf-shopping-settle", ts: "2026-02-16T00:00:00.000Z" },
      url: "https://example.com/search"
    });

    expect(response).toMatchObject({
      ok: true,
      mode: "managed_headed",
      output: {
        html: "<html><body>shopping fallback</body></html>",
        url: "https://example.com/search"
      }
    });
    expect(manager.launch).toHaveBeenCalledWith(expect.objectContaining({
      flags: ["--disable-http2"]
    }));
    expectStagedSettle(manager.waitForLoad as ReturnType<typeof vi.fn>, "shopping-fallback-session", 5000, 10000);
    expect(waitForTimeout).toHaveBeenCalledWith(2000);
  });

  it("stops recapturing when the first captured document is an obvious blocker shell", async () => {
    const waitForTimeout = vi.fn(async () => undefined);
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "blocker-short-circuit-session" })),
      goto: vi.fn(async () => ({ ok: true })),
      waitForLoad: vi.fn(async () => ({ timingMs: 5 })),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => callback({
        waitForTimeout,
        content: async () => "<html><body><h1>Security verification</h1><p>Verify you're human.</p></body></html>"
      })),
      status: vi.fn(async () => ({ mode: "managed", url: "https://example.com/challenge" })),
      disconnect: vi.fn(async () => undefined)
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager);
    const response = await port?.resolve({
      provider: "shopping/temu",
      source: "shopping",
      operation: "search",
      reasonCode: "challenge_detected",
      trace: { requestId: "rf-blocker-short-circuit", ts: "2026-04-08T00:00:00.000Z" },
      url: "https://example.com/challenge"
    });

    expect(response).toMatchObject({
      ok: false,
      disposition: "challenge_preserved",
      details: {
        captureDiagnostics: {
          attempts: 1,
          stabilized: false
        }
      }
    });
    expect(waitForTimeout).toHaveBeenCalledTimes(1);
  });

  it("uses startUrl during explicit shopping extension attach", async () => {
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "managed-should-not-launch" })),
      connectRelay: vi.fn(async () => ({ sessionId: "shopping-extension-fallback" })),
      goto: vi.fn(async () => ({ ok: true })),
      waitForLoad: vi.fn(async () => ({ timingMs: 15 })),
      withPage: vi.fn(async () => {
        throw new Error("Direct annotate is unavailable via extension ops sessions.");
      }),
      clonePageHtmlWithOptions: vi.fn(async () => ({
        html: "<html><body>shopping extension fallback</body></html>",
        warnings: ["Export truncated at 5000 nodes; 4399 nodes omitted."]
      })),
      clonePage: vi.fn(async () => ({
        component: "export default function OpenDevBrowserComponent() { return (<div className=\"opendevbrowser-root\" dangerouslySetInnerHTML={{ __html: \"<html><body>shopping extension fallback</body></html>\" }} />); }",
        css: ""
      })),
      status: vi.fn(async () => ({ mode: "extension", url: "https://example.com/search?q=macbook" })),
      cookieList: vi.fn(async () => ({ count: 1, cookies: [] })),
      disconnect: vi.fn(async () => undefined)
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager, {}, { extensionWsEndpoint: "ws://127.0.0.1:8787/ops" });
    const response = await port?.resolve({
      provider: "shopping/target",
      source: "shopping",
      operation: "search",
      reasonCode: "rate_limited",
      trace: { requestId: "rf-shopping-extension-start-url", ts: "2026-02-16T00:00:00.000Z" },
      url: "https://example.com/search?q=macbook",
      preferredModes: ["extension"]
    });

    expect(response).toMatchObject({
      ok: true,
      mode: "extension",
      output: {
        html: "<html><body>shopping extension fallback</body></html>",
        url: "https://example.com/search?q=macbook"
      }
    });
    expect(manager.connectRelay).toHaveBeenCalledWith(
      "ws://127.0.0.1:8787/ops",
      { startUrl: "https://example.com/search?q=macbook" }
    );
    expect(manager.clonePageHtmlWithOptions).toHaveBeenCalledWith(
      "shopping-extension-fallback",
      null,
      { maxNodes: 5000, inlineStyles: false }
    );
    expect(manager.clonePage).not.toHaveBeenCalled();
    expect(manager.goto).not.toHaveBeenCalled();
    expect(manager.launch).not.toHaveBeenCalled();
    expectStagedSettle(manager.waitForLoad as ReturnType<typeof vi.fn>, "shopping-extension-fallback", 5000, 10000);
  });

  it("waits longer before the first social capture so late result links can appear", async () => {
    let elapsedMs = 0;
    const waitForTimeout = vi.fn(async (ms: number) => {
      elapsedMs += ms;
    });
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "managed-should-not-launch" })),
      connectRelay: vi.fn(async () => ({ sessionId: "social-late-capture" })),
      waitForLoad: vi.fn(async () => ({ timingMs: 5 })),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => callback({
        waitForTimeout,
        content: async () => elapsedMs >= 2000
          ? "<html><body><article><a href=\"https://x.com/i/web/status/1\">Recovered post</a></article></body></html>"
          : "<html><body><main>Loading search results</main></body></html>"
      })),
      status: vi.fn(async () => ({ mode: "extension", url: "https://x.com/search?f=live&page=1&q=browser+automation+x" })),
      cookieList: vi.fn(async () => ({ count: 1, cookies: [] })),
      disconnect: vi.fn(async () => undefined)
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager, {}, { extensionWsEndpoint: "ws://127.0.0.1:8787" });
    const requestUrl = "https://x.com/search?f=live&page=1&q=browser+automation+x";
    const response = await port?.resolve({
      provider: "social/x",
      source: "social",
      operation: "search",
      reasonCode: "challenge_detected",
      trace: { requestId: "rf-social-late-capture", ts: "2026-04-08T00:00:00.000Z" },
      url: requestUrl,
      runtimePolicy: resolveProviderRuntimePolicy({
        source: "social",
        preferredFallbackModes: ["extension", "managed_headed"]
      })
    });

    expect(response).toMatchObject({
      ok: true,
      output: {
        html: "<html><body><article><a href=\"https://x.com/i/web/status/1\">Recovered post</a></article></body></html>"
      }
    });
    expect(waitForTimeout).toHaveBeenNthCalledWith(1, 2000);
    expect(manager.connectRelay).toHaveBeenCalledWith("ws://127.0.0.1:8787", { startUrl: requestUrl });
    expect(manager.launch).not.toHaveBeenCalled();
  });

  it("uses the widened clone-page capture for shopping fallback exports when available", async () => {
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "managed-should-not-launch" })),
      connectRelay: vi.fn(async () => ({ sessionId: "shopping-extension-expanded-clone" })),
      goto: vi.fn(async () => ({ ok: true })),
      waitForLoad: vi.fn(async () => ({ timingMs: 15 })),
      withPage: vi.fn(async () => {
        throw new Error("Direct annotate is unavailable via extension ops sessions.");
      }),
      clonePageHtmlWithOptions: vi.fn(async () => ({
        html: "<html><body>shopping extension fallback</body></html>",
        warnings: ["Export truncated at 5000 nodes; 4399 nodes omitted."]
      })),
      clonePageWithOptions: vi.fn(async () => ({
        component: "export default function OpenDevBrowserComponent() { return (<div className=\"opendevbrowser-root\" dangerouslySetInnerHTML={{ __html: \"<html><body>unexpected component parse</body></html>\" }} />); }",
        css: ""
      })),
      clonePage: vi.fn(async () => ({
        component: "export default function OpenDevBrowserComponent() { return (<div className=\\\"opendevbrowser-root\\\" dangerouslySetInnerHTML={{ __html: \\\"<html><body>unexpected legacy clone</body></html>\\\" }} />); }",
        css: ""
      })),
      status: vi.fn(async () => ({ mode: "extension", url: "https://www.ebay.com/sch/i.html?_nkw=macbook" })),
      cookieList: vi.fn(async () => ({ count: 1, cookies: [] })),
      disconnect: vi.fn(async () => undefined)
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager, {}, { extensionWsEndpoint: "ws://127.0.0.1:8787/ops" });
    const response = await port?.resolve({
      provider: "shopping/ebay",
      source: "shopping",
      operation: "search",
      reasonCode: "env_limited",
      trace: { requestId: "rf-shopping-expanded-clone", ts: "2026-03-30T00:00:00.000Z" },
      url: "https://www.ebay.com/sch/i.html?_nkw=macbook",
      preferredModes: ["extension"]
    });

    expect(response).toMatchObject({
      ok: true,
      mode: "extension",
      output: {
        html: "<html><body>shopping extension fallback</body></html>"
      }
    });
    expect(manager.connectRelay).toHaveBeenCalledWith(
      "ws://127.0.0.1:8787/ops",
      { startUrl: "https://www.ebay.com/sch/i.html?_nkw=macbook" }
    );
    expect(manager.clonePageHtmlWithOptions).toHaveBeenCalledWith(
      "shopping-extension-expanded-clone",
      null,
      { maxNodes: 5000, inlineStyles: false }
    );
    expect(manager.clonePageWithOptions).not.toHaveBeenCalled();
    expect(manager.clonePage).not.toHaveBeenCalled();
  });

  it("uses startUrl during explicit shopping extension attach even when status reports the same url with whitespace", async () => {
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "managed-should-not-launch" })),
      connectRelay: vi.fn(async () => ({ sessionId: "shopping-extension-trimmed" })),
      goto: vi.fn(async () => ({ ok: true })),
      waitForLoad: vi.fn(async () => ({ timingMs: 15 })),
      withPage: vi.fn(async () => {
        throw new Error("Direct annotate is unavailable via extension ops sessions.");
      }),
      clonePage: vi.fn(async () => ({
        component: "export default function OpenDevBrowserComponent() { return (<div className=\"opendevbrowser-root\" dangerouslySetInnerHTML={{ __html: \"<html><body>shopping extension fallback</body></html>\" }} />); }",
        css: ""
      })),
      status: vi.fn(async () => ({ mode: "extension", url: "   https://example.com/search?q=macbook   " })),
      cookieList: vi.fn(async () => ({ count: 1, cookies: [] })),
      disconnect: vi.fn(async () => undefined)
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager, {}, { extensionWsEndpoint: "ws://127.0.0.1:8787/ops" });
    const response = await port?.resolve({
      provider: "shopping/target",
      source: "shopping",
      operation: "search",
      reasonCode: "rate_limited",
      trace: { requestId: "rf-shopping-extension-trimmed", ts: "2026-02-16T00:00:00.000Z" },
      url: "https://example.com/search?q=macbook",
      preferredModes: ["extension"]
    });

    expect(response).toMatchObject({
      ok: true,
      mode: "extension"
    });
    expect(manager.connectRelay).toHaveBeenCalledWith(
      "ws://127.0.0.1:8787/ops",
      { startUrl: "https://example.com/search?q=macbook" }
    );
    expect(manager.goto).not.toHaveBeenCalled();
    expect(manager.launch).not.toHaveBeenCalled();
  });

  it("corrects explicit shopping extension attaches when status reports a different url", async () => {
    const requestUrl = "https://example.com/search?q=macbook";
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "managed-should-not-launch" })),
      connectRelay: vi.fn(async () => ({ sessionId: "shopping-extension-fallback-mismatch" })),
      goto: vi.fn(async () => ({ ok: true })),
      waitForLoad: vi.fn(async () => ({ timingMs: 15 })),
      withPage: vi.fn(async () => {
        throw new Error("Direct annotate is unavailable via extension ops sessions.");
      }),
      clonePage: vi.fn(async () => ({
        component: "export default function OpenDevBrowserComponent() { return (<div className=\"opendevbrowser-root\" dangerouslySetInnerHTML={{ __html: \"<html><body>shopping extension fallback</body></html>\" }} />); }",
        css: ""
      })),
      status: vi
        .fn()
        .mockResolvedValueOnce({ mode: "extension", url: "https://example.com/home" })
        .mockResolvedValueOnce({ mode: "extension", url: requestUrl })
        .mockResolvedValueOnce({ mode: "extension", url: requestUrl }),
      cookieList: vi.fn(async () => ({ count: 1, cookies: [] })),
      disconnect: vi.fn(async () => undefined)
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager, {}, { extensionWsEndpoint: "ws://127.0.0.1:8787/ops" });
    const response = await port?.resolve({
      provider: "shopping/target",
      source: "shopping",
      operation: "search",
      reasonCode: "rate_limited",
      trace: { requestId: "rf-shopping-extension-in-place-goto", ts: "2026-02-16T00:00:00.000Z" },
      url: requestUrl,
      preferredModes: ["extension"]
    });

    expect(response).toMatchObject({
      ok: true,
      mode: "extension",
      output: {
        html: "<html><body>shopping extension fallback</body></html>",
        url: requestUrl
      }
    });
    expect(manager.connectRelay).toHaveBeenCalledWith(
      "ws://127.0.0.1:8787/ops",
      { startUrl: requestUrl }
    );
    expect(manager.goto).toHaveBeenCalledWith(
      "shopping-extension-fallback-mismatch",
      requestUrl,
      "load",
      expect.any(Number)
    );
    expect(manager.launch).not.toHaveBeenCalled();
  });

  it("reattaches explicit shopping extension sessions when the attached url value cannot be normalized", async () => {
    const requestUrl = "https://example.com/search?q=macbook";
    let statusCall = 0;
    const stagedUrl = {
      trim: () => "https://example.com/home"
    } as unknown as string;
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "managed-should-not-launch" })),
      connectRelay: vi
        .fn()
        .mockResolvedValueOnce({ sessionId: "shopping-extension-empty-comparable-1" })
        .mockResolvedValueOnce({ sessionId: "shopping-extension-empty-comparable-2" }),
      goto: vi.fn(async () => ({ ok: true })),
      waitForLoad: vi.fn(async () => ({ timingMs: 15 })),
      withPage: vi.fn(async () => {
        throw new Error("Direct annotate is unavailable via extension ops sessions.");
      }),
      clonePage: vi.fn(async (sessionId: string) => ({
        component: `export default function OpenDevBrowserComponent() { return (<div className="opendevbrowser-root" dangerouslySetInnerHTML={{ __html: "<html><body>${sessionId}</body></html>" }} />); }`,
        css: ""
      })),
      status: vi.fn(async () => {
        statusCall += 1;
        return statusCall === 1
          ? { mode: "extension", url: stagedUrl }
          : { mode: "extension", url: requestUrl };
      }),
      cookieList: vi.fn(async () => ({ count: 1, cookies: [] })),
      disconnect: vi.fn(async () => undefined)
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager, {}, { extensionWsEndpoint: "ws://127.0.0.1:8787/ops" });
    const response = await port?.resolve({
      provider: "shopping/target",
      source: "shopping",
      operation: "search",
      reasonCode: "rate_limited",
      trace: { requestId: "rf-shopping-extension-empty-comparable", ts: "2026-02-16T00:00:00.000Z" },
      url: requestUrl,
      preferredModes: ["extension"]
    });

    expect(response).toMatchObject({
      ok: true,
      mode: "extension",
      output: {
        html: "<html><body>shopping-extension-empty-comparable-2</body></html>",
        url: requestUrl
      }
    });
    expect(manager.connectRelay).toHaveBeenNthCalledWith(1, "ws://127.0.0.1:8787/ops", { startUrl: requestUrl });
    expect(manager.connectRelay).toHaveBeenNthCalledWith(2, "ws://127.0.0.1:8787/ops", { startUrl: requestUrl });
    expect(manager.goto).not.toHaveBeenCalled();
    expect(manager.launch).not.toHaveBeenCalled();
  });

  it("returns env_limited when explicit shopping extension recovery still lands on a different url", async () => {
    const requestUrl = "https://example.com/search?q=macbook";
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "managed-should-not-launch" })),
      connectRelay: vi.fn(async () => ({ sessionId: "shopping-extension-still-mismatched" })),
      goto: vi.fn(async () => ({ ok: true })),
      waitForLoad: vi.fn(async () => ({ timingMs: 15 })),
      withPage: vi.fn(async () => {
        throw new Error("Direct annotate is unavailable via extension ops sessions.");
      }),
      clonePage: vi.fn(async () => ({
        component: "export default function OpenDevBrowserComponent() { return (<div className=\"opendevbrowser-root\" dangerouslySetInnerHTML={{ __html: \"<html><body>shopping extension fallback</body></html>\" }} />); }",
        css: ""
      })),
      status: vi
        .fn()
        .mockResolvedValueOnce({ mode: "extension", url: "https://example.com/home" })
        .mockResolvedValueOnce({ mode: "extension", url: "https://example.com/home" }),
      cookieList: vi.fn(async () => ({ count: 1, cookies: [] })),
      disconnect: vi.fn(async () => undefined)
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager, {}, { extensionWsEndpoint: "ws://127.0.0.1:8787/ops" });
    const response = await port?.resolve({
      provider: "shopping/target",
      source: "shopping",
      operation: "search",
      reasonCode: "rate_limited",
      trace: { requestId: "rf-shopping-extension-still-mismatched", ts: "2026-02-16T00:00:00.000Z" },
      url: requestUrl,
      preferredModes: ["extension"]
    });

    expect(response).toMatchObject({
      ok: false,
      reasonCode: "env_limited",
      disposition: "deferred",
      mode: "extension",
      details: {
        message: "Extension fallback did not reach the requested provider URL.",
        extensionTransportRequired: true,
        requestedUrl: requestUrl,
        observedUrl: "https://example.com/home"
      }
    });
    expect(manager.goto).toHaveBeenCalledWith(
      "shopping-extension-still-mismatched",
      requestUrl,
      "load",
      expect.any(Number)
    );
  });

  it.each([
    {
      label: "about:blank",
      requestId: "rf-shopping-extension-about-blank",
      firstSessionId: "shopping-extension-about-blank-1",
      secondSessionId: "shopping-extension-about-blank-2",
      firstStatus: { mode: "extension", url: "about:blank" }
    },
    {
      label: "blank",
      requestId: "rf-shopping-extension-blank",
      firstSessionId: "shopping-extension-blank-1",
      secondSessionId: "shopping-extension-blank-2",
      firstStatus: { mode: "extension", url: "   " }
    },
    {
      label: "missing",
      requestId: "rf-shopping-extension-missing",
      firstSessionId: "shopping-extension-missing-1",
      secondSessionId: "shopping-extension-missing-2",
      firstStatus: { mode: "extension" }
    },
    {
      label: "restricted",
      requestId: "rf-shopping-extension-restricted",
      firstSessionId: "shopping-extension-restricted-1",
      secondSessionId: "shopping-extension-restricted-2",
      firstStatus: { mode: "extension", url: "chrome://newtab/" }
    }
  ])("reattaches explicit shopping extension sessions with startUrl when the attached url is $label", async ({
    requestId,
    firstSessionId,
    secondSessionId,
    firstStatus
  }) => {
    const requestUrl = "https://example.com/search?q=macbook";
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "managed-should-not-launch" })),
      connectRelay: vi
        .fn()
        .mockResolvedValueOnce({ sessionId: firstSessionId })
        .mockResolvedValueOnce({ sessionId: secondSessionId }),
      goto: vi.fn(async () => ({ ok: true })),
      waitForLoad: vi.fn(async () => ({ timingMs: 15 })),
      withPage: vi.fn(async () => {
        throw new Error("Direct annotate is unavailable via extension ops sessions.");
      }),
      clonePage: vi.fn(async (sessionId: string) => ({
        component: `export default function OpenDevBrowserComponent() { return (<div className="opendevbrowser-root" dangerouslySetInnerHTML={{ __html: "<html><body>${sessionId}</body></html>" }} />); }`,
        css: ""
      })),
      status: vi.fn(async (sessionId: string) => (
        sessionId === firstSessionId
          ? firstStatus
          : { mode: "extension", url: requestUrl }
      )),
      cookieList: vi.fn(async () => ({ count: 1, cookies: [] })),
      disconnect: vi.fn(async () => undefined)
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager, {}, { extensionWsEndpoint: "ws://127.0.0.1:8787/ops" });
    const response = await port?.resolve({
      provider: "shopping/target",
      source: "shopping",
      operation: "search",
      reasonCode: "rate_limited",
      trace: { requestId, ts: "2026-02-16T00:00:00.000Z" },
      url: requestUrl,
      preferredModes: ["extension"]
    });

    expect(response).toMatchObject({
      ok: true,
      mode: "extension",
      output: {
        html: `<html><body>${secondSessionId}</body></html>`,
        url: requestUrl
      }
    });
    expect(manager.connectRelay).toHaveBeenNthCalledWith(1, "ws://127.0.0.1:8787/ops", { startUrl: requestUrl });
    expect(manager.connectRelay).toHaveBeenNthCalledWith(2, "ws://127.0.0.1:8787/ops", { startUrl: requestUrl });
    expect(manager.goto).not.toHaveBeenCalled();
    expectStagedSettle(manager.waitForLoad as ReturnType<typeof vi.fn>, secondSessionId, 5000, 10000);
    expect(manager.clonePage).toHaveBeenCalledWith(secondSessionId, null);
    expect(manager.disconnect).toHaveBeenNthCalledWith(1, firstSessionId, true);
    expect(manager.disconnect).toHaveBeenNthCalledWith(2, secondSessionId, true);
    expect(manager.launch).not.toHaveBeenCalled();
  });

  it("still uses startUrl during shopping auto extension attach", async () => {
    const manager = {
      connectRelay: vi.fn(async () => ({ sessionId: "shopping-extension-auto" })),
      goto: vi.fn(async () => ({ ok: true })),
      waitForLoad: vi.fn(async () => ({ timingMs: 15 })),
      withPage: vi.fn(async () => {
        throw new Error("Direct annotate is unavailable via extension ops sessions.");
      }),
      clonePage: vi.fn(async () => ({
        component: "export default function OpenDevBrowserComponent() { return (<div className=\"opendevbrowser-root\" dangerouslySetInnerHTML={{ __html: \"<html><body>shopping extension fallback</body></html>\" }} />); }",
        css: ""
      })),
      status: vi.fn(async () => ({ mode: "extension", url: "https://example.com/search?q=macbook" })),
      cookieList: vi.fn(async () => ({ count: 1, cookies: [] })),
      disconnect: vi.fn(async () => undefined)
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager, {}, { extensionWsEndpoint: "ws://127.0.0.1:8787/ops" });
    const response = await port?.resolve({
      provider: "shopping/target",
      source: "shopping",
      operation: "search",
      reasonCode: "rate_limited",
      trace: { requestId: "rf-shopping-extension-auto-start-url", ts: "2026-02-16T00:00:00.000Z" },
      url: "https://example.com/search?q=macbook",
      preferredModes: ["extension", "managed_headed"]
    });

    expect(response).toMatchObject({
      ok: true,
      mode: "extension",
      output: {
        html: "<html><body>shopping extension fallback</body></html>",
        url: "https://example.com/search?q=macbook"
      }
    });
    expect(manager.connectRelay).toHaveBeenCalledWith(
      "ws://127.0.0.1:8787/ops",
      { startUrl: "https://example.com/search?q=macbook" }
    );
    expect(manager.goto).not.toHaveBeenCalled();
  });

  it("falls back to clonePage for web captures when clonePageWithOptions is unavailable", async () => {
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "web-clone-fallback-session" })),
      goto: vi.fn(async () => ({ ok: true })),
      waitForLoad: vi.fn(async () => ({ timingMs: 5 })),
      withPage: vi.fn(async () => {
        throw new Error("withPage unavailable");
      }),
      clonePage: vi.fn(async () => ({
        component: "export default function OpenDevBrowserComponent() { return (<div className=\"opendevbrowser-root\" dangerouslySetInnerHTML={{ __html: \"<html><body>web clone fallback</body></html>\" }} />); }",
        css: ""
      })),
      status: vi.fn(async () => ({ mode: "managed", url: "https://example.com/guide" })),
      disconnect: vi.fn(async () => undefined)
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager);
    const response = await port?.resolve({
      provider: "web/default",
      source: "web",
      operation: "fetch",
      reasonCode: "env_limited",
      trace: { requestId: "rf-web-clone-fallback", ts: "2026-04-09T00:00:00.000Z" },
      url: "https://example.com/guide"
    });

    expect(response).toMatchObject({
      ok: true,
      mode: "managed_headed",
      output: {
        html: "<html><body>web clone fallback</body></html>",
        url: "https://example.com/guide"
      }
    });
    expect(manager.clonePage).toHaveBeenCalledWith("web-clone-fallback-session", null);
    expect(manager.disconnect).toHaveBeenCalledWith("web-clone-fallback-session", true);
  });

  it.each([
    ["social/x", "https://x.com/search?q=browser+automation&f=live"],
    ["social/bluesky", "https://bsky.app/search?q=browser+automation+bluesky"],
    ["social/youtube", "https://www.youtube.com/results?search_query=browser+automation"],
    ["social/reddit", "https://www.reddit.com/search/?q=browser+automation"],
    ["social/threads", "https://www.threads.net/search?q=browser+automation"]
  ])("social extension startUrl for social fallback attaches on %s", async (provider, url) => {
    const manager = {
      connectRelay: vi.fn(async () => ({ sessionId: "social-extension-fallback" })),
      goto: vi.fn(async () => ({ ok: true })),
      waitForLoad: vi.fn(async () => ({ timingMs: 10 })),
      withPage: vi.fn(async () => {
        throw new Error("Direct annotate is unavailable via extension ops sessions.");
      }),
      clonePageHtmlWithOptions: vi.fn(async () => ({
        html: "<html><body>social extension fallback</body></html>"
      })),
      clonePage: vi.fn(async () => ({
        component: "export default function OpenDevBrowserComponent() { return (<div className=\"opendevbrowser-root\" dangerouslySetInnerHTML={{ __html: \"<html><body>unexpected social legacy clone</body></html>\" }} />); }",
        css: ""
      })),
      status: vi.fn(async () => ({ mode: "extension", url })),
      cookieList: vi.fn(async () => ({ requestId: "list", count: 1, cookies: [] })),
      disconnect: vi.fn(async () => undefined)
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager, {}, {
      extensionWsEndpoint: "ws://127.0.0.1:8787"
    });
    const response = await port?.resolve({
      provider,
      source: "social",
      operation: "fetch",
      reasonCode: "auth_required",
      preferredModes: ["extension"],
      trace: { requestId: `rf-${provider.replace("/", "-")}-extension-start-url`, ts: "2026-02-16T00:00:00.000Z" },
      url
    });

    expect(response).toMatchObject({
      ok: true,
      mode: "extension",
      output: {
        html: "<html><body>social extension fallback</body></html>",
        url
      }
    });
    expect(manager.connectRelay).toHaveBeenCalledWith("ws://127.0.0.1:8787", { startUrl: url });
    expect(manager.goto).not.toHaveBeenCalled();
    expectStagedSettle(manager.waitForLoad as ReturnType<typeof vi.fn>, "social-extension-fallback", 1666, 3334);
    expect(manager.clonePageHtmlWithOptions).toHaveBeenCalledWith("social-extension-fallback", null, {
      maxNodes: 15000,
      inlineStyles: false
    });
    expect(manager.clonePage).not.toHaveBeenCalled();
  });

  it("treats shopping dialog interstitials as preserve-eligible blocker pages", async () => {
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "shopping-popup-session" })),
      goto: vi.fn(async () => ({ ok: true })),
      waitForLoad: vi.fn(async () => ({ timingMs: 20 })),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
        return callback({
          waitForTimeout: async () => undefined,
          content: async () => [
            "<html><body>",
            "<div role=\"dialog\" aria-modal=\"true\">",
            "<h1>Choose where you'd like to shop</h1>",
            "<button>Pickup</button>",
            "<button>Delivery</button>",
            "</div>",
            "</body></html>"
          ].join("")
        });
      }),
      status: vi.fn(async () => ({
        mode: "managed",
        url: "https://www.walmart.com/search?q=macbook",
        activeTargetId: "popup-tab"
      })),
      disconnect: vi.fn(async () => undefined)
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager);
    const response = await port?.resolve({
      provider: "shopping/walmart",
      source: "shopping",
      operation: "search",
      reasonCode: "env_limited",
      trace: { requestId: "rf-shopping-dialog", ts: "2026-02-16T00:00:00.000Z" },
      url: "https://www.walmart.com/search?q=macbook"
    });

    expect(response).toMatchObject({
      ok: false,
      reasonCode: "challenge_detected",
      disposition: "challenge_preserved",
      preservedSessionId: "shopping-popup-session",
      preservedTargetId: "popup-tab"
    });
  });

  it("caps shopping fallback step timeouts to the remaining request budget", async () => {
    const waitForTimeout = vi.fn(async () => undefined);
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "shopping-budget-session" })),
      goto: vi.fn(async () => ({ ok: true })),
      waitForLoad: vi.fn(async () => ({ timingMs: 5 })),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
        return callback({
          waitForTimeout,
          content: async () => "<html><body>shopping budget</body></html>"
        });
      }),
      status: vi.fn(async () => ({ mode: "managed", url: "https://example.com/search" })),
      disconnect: vi.fn(async () => undefined)
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager);
    const response = await port?.resolve({
      provider: "shopping/target",
      source: "shopping",
      operation: "search",
      reasonCode: "env_limited",
      trace: { requestId: "rf-shopping-budget", ts: "2026-02-16T00:00:00.000Z" },
      url: "https://example.com/search",
      timeoutMs: 1000
    });

    expect(response).toMatchObject({ ok: true });
    expect(manager.goto).toHaveBeenCalledWith(
      "shopping-budget-session",
      "https://example.com/search",
      "domcontentloaded",
      expect.any(Number)
    );
    expect(manager.waitForLoad).toHaveBeenCalledWith(
      "shopping-budget-session",
      "networkidle",
      expect.any(Number)
    );
    const gotoTimeout = (manager.goto as ReturnType<typeof vi.fn>).mock.calls[0]?.[3];
    const settleTimeout = (manager.waitForLoad as ReturnType<typeof vi.fn>).mock.calls[0]?.[2];
    const captureTimeout = waitForTimeout.mock.calls[0]?.[0];
    expect(gotoTimeout).toBeLessThanOrEqual(1000);
    expect(settleTimeout).toBeLessThanOrEqual(1000);
    expect(captureTimeout).toBeLessThanOrEqual(750);
  });

  it("rethrows browser fallback timeout errors instead of downgrading them to env_limited", async () => {
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "shopping-timeout-session" })),
      goto: vi.fn(async () => {
        throw new ProviderRuntimeError("timeout", "Provider request timed out after 1000ms");
      }),
      disconnect: vi.fn(async () => undefined)
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager);
    await expect(port?.resolve({
      provider: "shopping/target",
      source: "shopping",
      operation: "search",
      reasonCode: "env_limited",
      trace: { requestId: "rf-shopping-timeout", ts: "2026-02-16T00:00:00.000Z" },
      url: "https://example.com/search",
      timeoutMs: 1000
    })).rejects.toThrow("Provider request timed out after 1000ms");
    expect(manager.disconnect).toHaveBeenCalledWith("shopping-timeout-session", true);
  });

  it("does not block timeout errors on best-effort fallback cleanup", async () => {
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "shopping-timeout-cleanup-session" })),
      goto: vi.fn(async () => {
        throw new ProviderRuntimeError("timeout", "Provider request timed out after 1000ms");
      }),
      disconnect: vi.fn(() => new Promise(() => undefined))
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager);
    const cleanupGuard = new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error("cleanup_blocked")), 25);
    });

    await expect(Promise.race([
      port?.resolve({
        provider: "shopping/temu",
        source: "shopping",
        operation: "search",
        reasonCode: "env_limited",
        trace: { requestId: "rf-shopping-timeout-cleanup", ts: "2026-03-31T00:00:00.000Z" },
        url: "https://www.temu.com/search_result.html?search_key=wireless%20mouse",
        timeoutMs: 1000
      }),
      cleanupGuard
    ])).rejects.toThrow("Provider request timed out after 1000ms");
    expect(manager.disconnect).toHaveBeenCalledWith("shopping-timeout-cleanup-session", true);
  });

  it("preserves extension ops timeout details on explicit extension session failures", async () => {
    const manager = {
      connectRelay: vi.fn(async () => {
        throw new OpsRequestTimeoutError({
          command: "session.connect",
          timeoutMs: 1000,
          requestId: "ops-connect-timeout",
          opsSessionId: "ops-proto-timeout",
          leaseId: "lease-timeout",
          stage: "session.connect"
        });
      }),
      disconnect: vi.fn(async () => undefined)
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager, {}, {
      extensionWsEndpoint: "ws://127.0.0.1:8787/ops"
    });
    await expect(port?.resolve({
      provider: "shopping/ebay",
      source: "shopping",
      operation: "search",
      reasonCode: "env_limited",
      trace: { requestId: "rf-shopping-extension-timeout", ts: "2026-03-30T00:00:00.000Z" },
      url: "https://example.com/search",
      timeoutMs: 1000,
      preferredModes: ["extension"]
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "env_limited",
      disposition: "deferred",
      mode: "extension",
      details: {
        message: "Ops request timed out",
        opsTimeoutCommand: "session.connect",
        opsTimeoutMs: 1000,
        opsTimeoutRequestId: "ops-connect-timeout",
        stage: "session.connect"
      }
    });
    expect(manager.disconnect).not.toHaveBeenCalled();
  });

  it("omits absent extension ops timeout identifiers on explicit extension session failures", async () => {
    const manager = {
      connectRelay: vi.fn(async () => {
        throw new OpsRequestTimeoutError({
          command: "session.connect",
          timeoutMs: 1000,
          requestId: "ops-connect-timeout-minimal"
        });
      }),
      disconnect: vi.fn(async () => undefined)
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager, {}, {
      extensionWsEndpoint: "ws://127.0.0.1:8787/ops"
    });
    const response = await port?.resolve({
      provider: "shopping/ebay",
      source: "shopping",
      operation: "search",
      reasonCode: "env_limited",
      trace: { requestId: "rf-shopping-extension-timeout-minimal", ts: "2026-03-30T00:00:00.000Z" },
      url: "https://example.com/search",
      timeoutMs: 1000,
      preferredModes: ["extension"]
    });

    expect(response).toMatchObject({
      ok: false,
      reasonCode: "env_limited",
      disposition: "deferred",
      mode: "extension",
      details: {
        message: "Ops request timed out",
        opsTimeoutCommand: "session.connect",
        opsTimeoutMs: 1000,
        opsTimeoutRequestId: "ops-connect-timeout-minimal"
      }
    });
    expect(response?.details).not.toHaveProperty("opsSessionId");
    expect(response?.details).not.toHaveProperty("leaseId");
    expect(response?.details).not.toHaveProperty("stage");
    expect(manager.disconnect).not.toHaveBeenCalled();
  });

  it("aborts fallback navigation when the workflow signal times out", async () => {
    const controller = new AbortController();
    let rejectGoto: ((error: Error) => void) | undefined;
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "shopping-abort-session" })),
      goto: vi.fn(() => new Promise((_resolve, reject) => {
        rejectGoto = reject;
      })),
      disconnect: vi.fn(async () => {
        rejectGoto?.(new Error("session closed"));
      })
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager);
    const pending = port?.resolve({
      provider: "shopping/target",
      source: "shopping",
      operation: "search",
      reasonCode: "env_limited",
      trace: { requestId: "rf-shopping-abort", ts: "2026-02-16T00:00:00.000Z" },
      url: "https://example.com/search",
      timeoutMs: 1000,
      signal: controller.signal
    });
    controller.abort("timeout");

    await expect(pending).rejects.toThrow("Browser fallback timed out after 1000ms");
    expect(manager.disconnect).toHaveBeenCalledWith("shopping-abort-session", true);
  });

  it("omits timeout details when a fallback request is already aborted without an explicit timeout", async () => {
    const controller = new AbortController();
    controller.abort("cancelled");

    const manager = {
      launch: vi.fn(async () => ({ sessionId: "pre-aborted-session" })),
      disconnect: vi.fn(async () => undefined)
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager);
    await expect(port?.resolve({
      provider: "shopping/target",
      source: "shopping",
      operation: "search",
      reasonCode: "env_limited",
      trace: { requestId: "rf-shopping-pre-aborted", ts: "2026-02-16T00:00:00.000Z" },
      url: "https://example.com/search",
      signal: controller.signal
    })).rejects.toMatchObject({
      code: "timeout",
      details: {
        stage: "abort"
      }
    });
    expect(manager.launch).not.toHaveBeenCalled();
  });

  it("times out before navigation when the remaining fallback budget is already exhausted", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-02-16T00:00:00.000Z"));

      const manager = {
        launch: vi.fn(async () => {
          vi.setSystemTime(new Date("2026-02-16T00:00:02.000Z"));
          return { sessionId: "shopping-expired-budget" };
        }),
        goto: vi.fn(async () => ({ ok: true })),
        disconnect: vi.fn(async () => undefined)
      } as unknown as BrowserManagerLike;

      const port = createBrowserFallbackPort(manager);

      await expect(port?.resolve({
        provider: "shopping/target",
        source: "shopping",
        operation: "search",
        reasonCode: "env_limited",
        trace: { requestId: "rf-shopping-expired-budget", ts: "2026-02-16T00:00:00.000Z" },
        url: "https://example.com/search",
        timeoutMs: 1000
      })).rejects.toThrow("Browser fallback timed out after 1000ms");

      expect(manager.goto).not.toHaveBeenCalled();
      expect(manager.disconnect).toHaveBeenCalledWith("shopping-expired-budget", true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out fallback capture when page content never resolves", async () => {
    vi.useFakeTimers();
    try {
      let resolveCaptureStarted: (() => void) | undefined;
      const captureStarted = new Promise<void>((resolve) => {
        resolveCaptureStarted = resolve;
      });
      const manager = {
        launch: vi.fn(async () => ({ sessionId: "capture-timeout-session" })),
        goto: vi.fn(async () => ({ ok: true })),
        waitForLoad: vi.fn(async () => ({ timingMs: 5 })),
        withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
          return callback({
            waitForTimeout: async () => undefined,
            content: async () => {
              resolveCaptureStarted?.();
              return await new Promise<string>(() => undefined);
            }
          });
        }),
        disconnect: vi.fn(async () => undefined)
      } as unknown as BrowserManagerLike;

      const port = createBrowserFallbackPort(manager);
      const pending = port?.resolve({
        provider: "social/linkedin",
        source: "social",
        operation: "search",
        reasonCode: "token_required",
        trace: { requestId: "rf-capture-timeout", ts: "2026-03-31T00:00:00.000Z" },
        url: "https://www.linkedin.com/search/results/content/?keywords=browser%20automation&page=1",
        timeoutMs: 25
      });

      const captureTimeout = expect(pending).rejects.toMatchObject({
        code: "timeout",
        details: {
          stage: "capture",
          timeoutMs: 25
        }
      });
      await captureStarted;
      await vi.advanceTimersByTimeAsync(25);
      await captureTimeout;
      expect(manager.disconnect).toHaveBeenCalledWith("capture-timeout-session", true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("swallows late fallback capture rejections after timing out", async () => {
    const unhandledRejection = vi.fn();
    process.on("unhandledRejection", unhandledRejection);
    vi.useFakeTimers();
    try {
      let resolveCaptureStarted: (() => void) | undefined;
      const captureStarted = new Promise<void>((resolve) => {
        resolveCaptureStarted = resolve;
      });
      const manager = {
        launch: vi.fn(async () => ({ sessionId: "capture-timeout-late-rejection-session" })),
        goto: vi.fn(async () => ({ ok: true })),
        waitForLoad: vi.fn(async () => ({ timingMs: 5 })),
        withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
          return callback({
            waitForTimeout: async () => undefined,
            content: async () => {
              resolveCaptureStarted?.();
              return await new Promise<string>((_resolve, reject) => {
                setTimeout(() => reject(new Error("late capture failure")), 50);
              });
            }
          });
        }),
        disconnect: vi.fn(async () => undefined)
      } as unknown as BrowserManagerLike;

      const port = createBrowserFallbackPort(manager);
      const pending = port?.resolve({
        provider: "shopping/ebay",
        source: "shopping",
        operation: "search",
        reasonCode: "env_limited",
        trace: { requestId: "rf-capture-timeout-late-rejection", ts: "2026-03-31T00:00:00.000Z" },
        url: "https://www.ebay.com/sch/i.html?_nkw=portable+monitor",
        timeoutMs: 25
      });

      const captureTimeout = expect(pending).rejects.toMatchObject({
        code: "timeout",
        details: {
          stage: "capture",
          timeoutMs: 25
        }
      });
      await captureStarted;
      await vi.advanceTimersByTimeAsync(25);
      await captureTimeout;
      await vi.advanceTimersByTimeAsync(25);
      await Promise.resolve();
      expect(unhandledRejection).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandledRejection);
      vi.useRealTimers();
    }
  });

  it("disconnects an active fallback session when abort fires after launch completes", async () => {
    const controller = new AbortController();
    let rejectGoto: ((error: Error) => void) | undefined;
    let resolveGotoStarted: (() => void) | undefined;
    const gotoStarted = new Promise<void>((resolve) => {
      resolveGotoStarted = resolve;
    });
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "shopping-abort-after-launch" })),
      goto: vi.fn(() => {
        resolveGotoStarted?.();
        return new Promise((_resolve, reject) => {
          rejectGoto = reject;
        });
      }),
      disconnect: vi.fn(async () => {
        rejectGoto?.(new Error("session closed"));
      })
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager);
    const pending = port?.resolve({
      provider: "shopping/target",
      source: "shopping",
      operation: "search",
      reasonCode: "env_limited",
      trace: { requestId: "rf-shopping-abort-after-launch", ts: "2026-02-16T00:00:00.000Z" },
      url: "https://example.com/search",
      timeoutMs: 1000,
      signal: controller.signal
    });

    await gotoStarted;
    controller.abort("timeout");

    await expect(pending).rejects.toThrow("Browser fallback timed out after 1000ms");
    expect(manager.disconnect).toHaveBeenCalledWith("shopping-abort-after-launch", true);
  });

  it("treats captured login pages as blocker failures instead of successful fallback HTML", async () => {
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "auth-fallback-session" })),
      goto: vi.fn(async () => ({ ok: true })),
      waitForLoad: vi.fn(async () => ({ timingMs: 15 })),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
        return callback({
          content: async () => "<html><head><title>Temu | Login</title></head><body>Please log in to continue.</body></html>"
        });
      }),
      status: vi.fn(async () => ({ mode: "managed", url: "https://www.temu.com/login.html?from=search" })),
      disconnect: vi.fn(async () => undefined)
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager);
    const response = await port?.resolve({
      provider: "shopping/temu",
      source: "shopping",
      operation: "search",
      reasonCode: "env_limited",
      trace: { requestId: "rf-login-blocker", ts: "2026-02-16T00:00:00.000Z" },
      url: "https://www.temu.com/search_result.html?search_key=wireless%20mouse"
    });

    expect(response).toMatchObject({
      ok: false,
      reasonCode: "token_required"
    });
  });

  it("treats script-only verification shells as anti-bot blocker failures", async () => {
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "challenge-fallback-session" })),
      goto: vi.fn(async () => ({ ok: true })),
      waitForLoad: vi.fn(async () => ({ timingMs: 15 })),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
        return callback({
          content: async () => "<html><body><script>function _0x24b9(){} var challenge='challenge';</script></body></html>"
        });
      }),
      status: vi.fn(async () => ({ mode: "managed", url: "https://www.temu.com/bgn_verification.html?verifyCode=test" })),
      disconnect: vi.fn(async () => undefined)
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager);
    const response = await port?.resolve({
      provider: "shopping/temu",
      source: "shopping",
      operation: "search",
      reasonCode: "env_limited",
      trace: { requestId: "rf-challenge-blocker", ts: "2026-02-16T00:00:00.000Z" },
      url: "https://www.temu.com/search_result.html?search_key=wireless%20mouse"
    });

    expect(response).toMatchObject({
      ok: false,
      reasonCode: "challenge_detected"
    });
  });

  it("falls back to the request reason code when captured blocker pages omit one", async () => {
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "restricted-fallback-session" })),
      goto: vi.fn(async () => ({ ok: true })),
      waitForLoad: vi.fn(async () => ({ timingMs: 15 })),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
        return callback({
          content: async () => "<html><body>Restricted target shell</body></html>"
        });
      }),
      status: vi.fn(async () => ({ mode: "managed", url: "chrome://settings" })),
      disconnect: vi.fn(async () => undefined)
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager);
    const response = await port?.resolve({
      provider: "shopping/amazon",
      source: "shopping",
      operation: "search",
      reasonCode: "env_limited",
      trace: { requestId: "rf-restricted-target", ts: "2026-02-16T00:00:00.000Z" },
      url: "https://www.amazon.com/s?k=wireless%20mouse"
    });

    expect(response).toMatchObject({
      ok: false,
      reasonCode: "env_limited",
      details: {
        message: "Browser fallback reached restricted_target page at chrome://settings."
      }
    });
  });

  it("prefers extension fallback sessions when requested and a relay endpoint is available", async () => {
    const manager = {
      connectRelay: vi.fn(async () => ({ sessionId: "extension-fallback-session" })),
      launch: vi.fn(async () => ({ sessionId: "managed-fallback-session" })),
      goto: vi.fn(async () => ({ ok: true })),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
        return callback({ content: async () => "<html><body>extension fallback</body></html>" });
      }),
      status: vi.fn(async () => ({ mode: "extension", url: "https://example.com/watch" })),
      disconnect: vi.fn(async () => undefined),
      cookieList: vi.fn(async () => ({ requestId: "list", cookies: [], count: 1 }))
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager, {}, {
      extensionWsEndpoint: "ws://127.0.0.1:8787"
    });
    const response = await port?.resolve({
      provider: "shopping/ebay",
      source: "shopping",
      operation: "search",
      reasonCode: "challenge_detected",
      runtimePolicy: resolveProviderRuntimePolicy({
        source: "shopping",
        preferredFallbackModes: ["extension", "managed_headed"],
        useCookies: true
      }),
      trace: { requestId: "rf-extension-first", ts: "2026-02-16T00:00:00.000Z" },
      url: "https://example.com/watch"
    });

    expect(response).toMatchObject({
      ok: true,
      mode: "extension",
      output: {
        html: "<html><body>extension fallback</body></html>",
        url: "https://example.com/watch"
      }
    });
    expect(manager.connectRelay).toHaveBeenCalledWith(
      "ws://127.0.0.1:8787",
      { startUrl: "https://example.com/watch" }
    );
    expect(manager.launch).not.toHaveBeenCalled();
    expect(manager.cookieList).toHaveBeenCalledWith("extension-fallback-session", ["https://example.com/watch"]);
  });

  it("falls back to managed sessions when preferred extension fallback cannot attach", async () => {
    const manager = {
      connectRelay: vi.fn(async () => {
        throw new Error("extension unavailable");
      }),
      launch: vi.fn(async () => ({ sessionId: "managed-fallback-session" })),
      goto: vi.fn(async () => ({ ok: true })),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
        return callback({ content: async () => "<html><body>managed fallback</body></html>" });
      }),
      status: vi.fn(async () => ({ mode: "managed", url: "https://example.com/watch" })),
      disconnect: vi.fn(async () => undefined)
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager, {}, {
      extensionWsEndpoint: "ws://127.0.0.1:8787"
    });
    const response = await port?.resolve({
      provider: "shopping/ebay",
      source: "shopping",
      operation: "search",
      reasonCode: "challenge_detected",
      preferredModes: ["extension", "managed_headed"],
      trace: { requestId: "rf-extension-fallback", ts: "2026-02-16T00:00:00.000Z" },
      url: "https://example.com/watch"
    });

    expect(response).toMatchObject({
      ok: true,
      mode: "managed_headed",
      output: {
        html: "<html><body>managed fallback</body></html>",
        url: "https://example.com/watch"
      }
    });
    expect(manager.connectRelay).toHaveBeenCalledWith(
      "ws://127.0.0.1:8787",
      { startUrl: "https://example.com/watch" }
    );
    expect(manager.launch).toHaveBeenCalledWith(expect.objectContaining({
      noExtension: true,
      headless: false,
      persistProfile: false
    }));
  });

  const socialExtensionRetryDelayMs = 500;

  it.each([
    ["social/x", "https://x.com/search?q=browser+automation&f=live"],
    ["social/bluesky", "https://bsky.app/search?q=browser+automation+bluesky"]
  ])("retries extension fallback once for %s before downgrading to managed", async (provider, url) => {
    vi.useFakeTimers();
    try {
      const manager = {
        connectRelay: vi
          .fn()
          .mockRejectedValueOnce(new Error("extension unavailable"))
          .mockResolvedValueOnce({ sessionId: "social-extension-retry" }),
        launch: vi.fn(async () => ({ sessionId: "managed-fallback-session" })),
        goto: vi.fn(async () => ({ ok: true })),
        waitForLoad: vi.fn(async () => ({ timingMs: 10 })),
        withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
          return callback({
            waitForTimeout: async () => undefined,
            content: async () => "<html><body>social extension retry</body></html>"
          });
        }),
        status: vi.fn(async () => ({ mode: "extension", url })),
        cookieList: vi.fn(async () => ({ requestId: "list", count: 1, cookies: [] })),
        disconnect: vi.fn(async () => undefined)
      } as unknown as BrowserManagerLike;

      const port = createBrowserFallbackPort(manager, {}, {
        extensionWsEndpoint: "ws://127.0.0.1:8787"
      });
      const pendingResponse = port?.resolve({
        provider,
        source: "social",
        operation: "search",
        reasonCode: "challenge_detected",
        runtimePolicy: resolveProviderRuntimePolicy({
          source: "social",
          preferredFallbackModes: ["extension", "managed_headed"]
        }),
        trace: { requestId: `rf-${provider.replace("/", "-")}-extension-retry`, ts: "2026-02-16T00:00:00.000Z" },
        url
      });

      await vi.advanceTimersByTimeAsync(socialExtensionRetryDelayMs);
      const response = await pendingResponse;

      expect(response).toMatchObject({
        ok: true,
        mode: "extension",
        output: {
          html: "<html><body>social extension retry</body></html>",
          url
        }
      });
      expect(manager.connectRelay).toHaveBeenNthCalledWith(1, "ws://127.0.0.1:8787", { startUrl: url });
      expect(manager.connectRelay).toHaveBeenNthCalledWith(2, "ws://127.0.0.1:8787", { startUrl: url });
      expect(manager.launch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("downgrades to managed after exhausting the bounded social extension retry", async () => {
    vi.useFakeTimers();
    try {
      const url = "https://bsky.app/search?q=browser+automation+bluesky";
      const manager = {
        connectRelay: vi.fn(async () => {
          throw new Error("extension unavailable");
        }),
        launch: vi.fn(async () => ({ sessionId: "managed-fallback-session" })),
        goto: vi.fn(async () => ({ ok: true })),
        withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
          return callback({
            waitForTimeout: async () => undefined,
            content: async () => "<html><body>managed fallback</body></html>"
          });
        }),
        status: vi.fn(async () => ({ mode: "managed", url })),
        disconnect: vi.fn(async () => undefined)
      } as unknown as BrowserManagerLike;

      const port = createBrowserFallbackPort(manager, {}, {
        extensionWsEndpoint: "ws://127.0.0.1:8787"
      });
      const pendingResponse = port?.resolve({
        provider: "social/bluesky",
        source: "social",
        operation: "search",
        reasonCode: "challenge_detected",
        runtimePolicy: resolveProviderRuntimePolicy({
          source: "social",
          preferredFallbackModes: ["extension", "managed_headed"]
        }),
        trace: { requestId: "rf-social-extension-retry-exhausted", ts: "2026-02-16T00:00:00.000Z" },
        url
      });

      await vi.advanceTimersByTimeAsync(socialExtensionRetryDelayMs * 2);
      const response = await pendingResponse;

      expect(response).toMatchObject({
        ok: true,
        mode: "managed_headed",
        output: {
          html: "<html><body>managed fallback</body></html>",
          url
        }
      });
      expect(manager.connectRelay).toHaveBeenCalledTimes(3);
      expect(manager.launch).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns env_limited when explicit extension fallback has no relay endpoint", async () => {
    const manager = {
      connectRelay: vi.fn(),
      launch: vi.fn(),
      goto: vi.fn(),
      withPage: vi.fn(),
      status: vi.fn(),
      disconnect: vi.fn()
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager);
    const response = await port?.resolve({
      provider: "shopping/ebay",
      source: "shopping",
      operation: "search",
      reasonCode: "challenge_detected",
      preferredModes: ["extension"],
      trace: { requestId: "rf-extension-no-endpoint", ts: "2026-02-16T00:00:00.000Z" },
      url: "https://example.com/watch"
    });

    expect(response).toMatchObject({
      ok: false,
      reasonCode: "env_limited",
      details: {
        extensionTransportRequired: true,
        message: "Extension fallback requires a relay endpoint."
      }
    });
    expect(manager.connectRelay).not.toHaveBeenCalled();
    expect(manager.launch).not.toHaveBeenCalled();
  });

  it.each([
    ["social/x", "https://x.com/search?q=browser+automation"],
    ["social/youtube", "https://www.youtube.com/results?search_query=browser+automation"]
  ])("returns env_limited when explicit social extension fallback cannot attach for %s", async (provider, url) => {
    vi.useFakeTimers();
    try {
      const manager = {
        connectRelay: vi.fn(async () => {
          throw new Error("extension relay timeout");
        }),
        launch: vi.fn(),
        goto: vi.fn(),
        withPage: vi.fn(),
        status: vi.fn(),
        disconnect: vi.fn()
      } as unknown as BrowserManagerLike;

      const port = createBrowserFallbackPort(manager, {}, {
        extensionWsEndpoint: "ws://127.0.0.1:8787"
      });
      const pendingResponse = port?.resolve({
        provider,
        source: "social",
        operation: "search",
        reasonCode: "env_limited",
        runtimePolicy: resolveProviderRuntimePolicy({
          source: "social",
          runtimePolicy: { browserMode: "extension" }
        }),
        trace: { requestId: `rf-${provider.replace("/", "-")}-explicit-extension-attach`, ts: "2026-02-16T00:00:00.000Z" },
        url
      });

      await vi.advanceTimersByTimeAsync(socialExtensionRetryDelayMs * 2);
      const response = await pendingResponse;

      expect(response).toMatchObject({
        ok: false,
        reasonCode: "env_limited",
        details: {
          extensionTransportRequired: true,
          message: "extension relay timeout"
        }
      });
      expect(manager.connectRelay).toHaveBeenCalledTimes(3);
      expect(manager.launch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["social/x", "https://x.com/search?q=browser+automation", "https://x.com/home"],
    ["social/youtube", "https://www.youtube.com/results?search_query=browser+automation", "https://www.youtube.com/"]
  ])("returns env_limited when explicit social extension fallback stays on another URL for %s", async (provider, requestUrl, observedUrl) => {
    const manager = {
      connectRelay: vi.fn(async () => ({ sessionId: "social-extension-wrong-url" })),
      launch: vi.fn(),
      goto: vi.fn(async () => ({ ok: true })),
      waitForLoad: vi.fn(async () => ({ timingMs: 5 })),
      withPage: vi.fn(),
      status: vi.fn(async () => ({ mode: "extension", url: observedUrl })),
      disconnect: vi.fn(async () => undefined),
      cookieList: vi.fn(async () => ({ requestId: "list", cookies: [], count: 1 }))
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager, {}, {
      extensionWsEndpoint: "ws://127.0.0.1:8787"
    });
    const response = await port?.resolve({
      provider,
      source: "social",
      operation: "search",
      reasonCode: "env_limited",
      runtimePolicy: resolveProviderRuntimePolicy({
        source: "social",
        runtimePolicy: { browserMode: "extension" }
      }),
      trace: { requestId: `rf-${provider.replace("/", "-")}-explicit-extension-wrong-url`, ts: "2026-02-16T00:00:00.000Z" },
      url: requestUrl
    });

    expect(response).toMatchObject({
      ok: false,
      reasonCode: "env_limited",
      mode: "extension",
      details: {
        extensionTransportRequired: true,
        requestedUrl: requestUrl,
        observedUrl
      }
    });
    expect(manager.goto).toHaveBeenCalledWith(
      "social-extension-wrong-url",
      requestUrl,
      "load",
      expect.any(Number)
    );
    expect(manager.cookieList).not.toHaveBeenCalled();
    expect(manager.launch).not.toHaveBeenCalled();
  });

  it("fails required extension fallback when the live session exposes no cookies for the request URL", async () => {
    const manager = {
      connectRelay: vi.fn(async () => ({ sessionId: "extension-required-cookie-miss" })),
      launch: vi.fn(),
      goto: vi.fn(async () => ({ ok: true })),
      waitForLoad: vi.fn(async () => ({ timingMs: 5 })),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
        return callback({
          waitForTimeout: async () => undefined,
          content: async () => "<html><body>extension fallback without cookies</body></html>"
        });
      }),
      status: vi.fn(async () => ({ mode: "extension", url: "https://example.com/protected" })),
      disconnect: vi.fn(async () => undefined),
      cookieList: vi.fn(async () => ({ requestId: "list", cookies: [], count: 0 }))
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager, { policy: "required" }, {
      extensionWsEndpoint: "ws://127.0.0.1:8787"
    });
    const response = await port?.resolve({
      provider: "shopping/ebay",
      source: "shopping",
      operation: "search",
      reasonCode: "challenge_detected",
      preferredModes: ["extension"],
      trace: { requestId: "rf-extension-required-cookie-miss", ts: "2026-02-16T00:00:00.000Z" },
      url: "https://example.com/protected"
    });

    expect(response).toMatchObject({
      ok: false,
      reasonCode: "auth_required",
      details: {
        cookieDiagnostics: {
          policy: "required",
          verifiedCount: 0,
          reasonCode: "auth_required",
          message: "Provider cookies were not observable in the live extension session."
        },
        message: "Provider cookies were not observable in the live extension session."
      }
    });
    expect(manager.connectRelay).toHaveBeenCalledWith(
      "ws://127.0.0.1:8787",
      { startUrl: "https://example.com/protected" }
    );
    expect(manager.launch).not.toHaveBeenCalled();
    expect(manager.cookieList).toHaveBeenCalledWith("extension-required-cookie-miss", ["https://example.com/protected"]);
    expect(manager.disconnect).toHaveBeenCalledWith("extension-required-cookie-miss", true);
  });

  it("treats env-limited fallback pages as successful captures instead of blocker failures", async () => {
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "env-limited-page" })),
      goto: vi.fn(async () => ({ ok: true })),
      waitForLoad: vi.fn(async () => ({ timingMs: 5 })),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
        return callback({
          waitForTimeout: async () => undefined,
          content: async () => "<html><body>This feature is not available in this environment.</body></html>"
        });
      }),
      status: vi.fn(async () => ({ mode: "managed", url: "https://example.com/protected" })),
      disconnect: vi.fn(async () => undefined)
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager);
    const response = await port?.resolve({
      provider: "social/youtube",
      source: "social",
      operation: "fetch",
      reasonCode: "transcript_unavailable",
      trace: { requestId: "rf-env-limited-page", ts: "2026-02-16T00:00:00.000Z" },
      url: "https://example.com/protected"
    });

    expect(response).toMatchObject({
      ok: true,
      reasonCode: "transcript_unavailable",
      output: {
        html: "<html><body>This feature is not available in this environment.</body></html>",
        url: "https://example.com/protected"
      }
    });
  });

  it("treats unknown fallback pages as successful captures instead of blocker failures", async () => {
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "unknown-page" })),
      goto: vi.fn(async () => ({ ok: true })),
      waitForLoad: vi.fn(async () => ({ timingMs: 5 })),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
        return callback({
          waitForTimeout: async () => undefined,
          content: async () => "<html><head><title>Hold on</title></head><body>Something odd happened, please retry shortly.</body></html>"
        });
      }),
      status: vi.fn(async () => ({ mode: "managed", url: "https://example.com/hold-on" })),
      disconnect: vi.fn(async () => undefined)
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager);
    const response = await port?.resolve({
      provider: "social/youtube",
      source: "social",
      operation: "fetch",
      reasonCode: "transcript_unavailable",
      trace: { requestId: "rf-unknown-page", ts: "2026-02-16T00:00:00.000Z" },
      url: "https://example.com/hold-on"
    });

    expect(response).toMatchObject({
      ok: true,
      reasonCode: "transcript_unavailable",
      output: {
        html: "<html><head><title>Hold on</title></head><body>Something odd happened, please retry shortly.</body></html>",
        url: "https://example.com/hold-on"
      }
    });
  });

  it("falls back to managed_headed mode and request URL when status metadata is sparse", async () => {
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "fallback-session" })),
      goto: vi.fn(async () => ({ ok: true })),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
        return callback({});
      }),
      status: vi.fn(async () => ({ mode: "managed" })),
      disconnect: vi.fn(async () => undefined)
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager);
    const response = await port?.resolve({
      provider: "social/youtube",
      source: "social",
      operation: "fetch",
      reasonCode: "transcript_unavailable",
      trace: { requestId: "rf-2b", ts: "2026-02-16T00:00:00.000Z" },
      url: "https://example.com/watch?v=fallback"
    });

    expect(response).toMatchObject({
      ok: false,
      reasonCode: "transcript_unavailable",
      disposition: "failed",
      mode: "managed_headed",
      details: {
        message: "Browser fallback captured no HTML content at https://example.com/watch?v=fallback."
      }
    });
  });

  it("preserves existing auth challenge summaries and skips disconnect when fallback remains blocked", async () => {
    const existingChallenge = {
      challengeId: "challenge-existing",
      blockerType: "auth_required" as const,
      ownerSurface: "direct_browser" as const,
      resumeMode: "manual" as const,
      status: "active" as const,
      preserveUntil: "2026-03-22T00:05:00.000Z",
      verifyUntil: "2026-03-22T00:02:00.000Z",
      updatedAt: "2026-03-22T00:00:00.000Z",
      timeline: [
        {
          at: "2026-03-22T00:00:00.000Z",
          event: "claimed" as const,
          status: "active" as const
        }
      ]
    };
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "preserved-auth-session" })),
      goto: vi.fn(async () => ({ ok: true })),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
        return callback({
          content: async () => "<html><head><title>Sign in</title></head><body>Please log in to continue.</body></html>"
        });
      }),
      status: vi.fn(async () => ({
        mode: "managed",
        url: "https://example.com/login",
        meta: {
          challenge: existingChallenge
        }
      })),
      disconnect: vi.fn(async () => undefined)
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager);
    const response = await port?.resolve({
      provider: "community/example",
      source: "community",
      operation: "fetch",
      reasonCode: "auth_required",
      trace: { requestId: "rf-preserved-auth", ts: "2026-03-22T00:00:00.000Z" },
      url: "https://example.com/protected"
    });

    expect(response).toMatchObject({
      ok: false,
      reasonCode: "token_required",
      disposition: "challenge_preserved",
      preservedSessionId: "preserved-auth-session",
      challenge: {
        challengeId: "challenge-existing",
        blockerType: "auth_required",
        preserveUntil: "2026-03-22T00:05:00.000Z",
        verifyUntil: "2026-03-22T00:02:00.000Z"
      }
    });
    expect(response?.challenge?.timeline).toEqual(existingChallenge.timeline);
    expect(manager.disconnect).not.toHaveBeenCalled();
  });

  it("synthesizes preserved challenge metadata when status.challenge is malformed", async () => {
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "preserved-challenge-session" })),
      goto: vi.fn(async () => ({ ok: true })),
      waitForLoad: vi.fn(async () => {
        throw new Error("networkidle never settled");
      }),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
        return callback({
          waitForTimeout: async () => undefined,
          content: async () => "<html><body><h1>Security verification</h1><p>Verify you're human to continue.</p></body></html>"
        });
      }),
      status: vi.fn(async () => ({
        mode: "extension",
        activeTargetId: "tab-1",
        url: "https://example.com/challenge",
        meta: {
          challenge: []
        }
      })),
      disconnect: vi.fn(async () => undefined)
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager);
    const response = await port?.resolve({
      provider: "social/youtube",
      source: "social",
      operation: "fetch",
      reasonCode: "challenge_detected",
      trace: { requestId: "rf-preserved-challenge", ts: "2026-03-22T00:00:00.000Z" },
      url: "https://example.com/watch",
      ownerSurface: "ops",
      ownerLeaseId: "lease-1",
      resumeMode: "manual",
      suspendedIntent: {
        kind: "provider.fetch",
        provider: "social/youtube",
        source: "social",
        operation: "fetch"
      }
    });

    expect(response).toMatchObject({
      ok: false,
      reasonCode: "challenge_detected",
      disposition: "challenge_preserved",
      preservedSessionId: "preserved-challenge-session",
      preservedTargetId: "tab-1",
      challenge: {
        blockerType: "anti_bot_challenge",
        ownerSurface: "ops",
        ownerLeaseId: "lease-1",
        resumeMode: "manual",
        suspendedIntent: {
          kind: "provider.fetch",
          provider: "social/youtube"
        }
      }
    });
    expect(response?.challenge?.challengeId).toMatch(/^fallback-/);
    expect(response?.challenge?.timeline).toBeUndefined();
    expect(manager.disconnect).not.toHaveBeenCalled();
  });

  it("returns a completed fallback response when bounded challenge orchestration clears the blocker", async () => {
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "challenge-orchestration-session" })),
      goto: vi.fn(async () => ({ ok: true })),
      waitForLoad: vi.fn(async () => {
        throw new Error("networkidle never settled");
      }),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
        return callback({
          waitForTimeout: async () => undefined,
          content: async () => "<html><body><h1>Security verification</h1></body></html>"
        });
      }),
      status: vi.fn()
        .mockResolvedValueOnce({
          mode: "extension",
          activeTargetId: "tab-8",
          url: "https://example.com/challenge"
        })
        .mockResolvedValueOnce({
          mode: "extension",
          activeTargetId: "tab-8",
          url: "https://example.com/account"
        }),
      disconnect: vi.fn(async () => undefined),
      createChallengeRuntimeHandle: vi.fn().mockReturnValue(makeChallengeRuntimeHandle())
    } as unknown as BrowserManagerLike;
    const challengeOrchestrator = {
      orchestrate: vi.fn(async () => ({
        action: {
          status: "resolved",
          attempts: 1,
          noProgressCount: 0,
          executedSteps: [],
          verification: {
            status: "clear",
            blockerState: "clear",
            changed: true,
            reason: "Manager verification cleared the blocker.",
            bundle: {
              blockerState: "clear"
            }
          },
          reusedExistingSession: true,
          reusedCookies: false
        },
        outcome: {
          challengeId: "challenge-provider",
          classification: "existing_session_reuse",
          lane: "generic_browser_autonomy",
          status: "resolved",
          reason: "Manager verification cleared the blocker.",
          attempts: 1,
          reusedExistingSession: true,
          reusedCookies: false,
          verification: {
            status: "clear",
            blockerState: "clear",
            changed: true,
            reason: "Manager verification cleared the blocker."
          },
          evidence: {
            url: "https://example.com/challenge",
            title: "Security verification",
            blockerType: "anti_bot_challenge",
            loginRefs: [],
            humanVerificationRefs: ["r1"],
            checkpointRefs: []
          }
        }
      }))
    };

    const port = createBrowserFallbackPort(manager, {}, {}, challengeOrchestrator as never);
    const response = await port?.resolve({
      provider: "shopping/temu",
      source: "shopping",
      operation: "search",
      reasonCode: "challenge_detected",
      trace: { requestId: "rf-challenge-orchestrated", ts: "2026-03-22T00:00:00.000Z" },
      url: "https://example.com/challenge"
    });

    expect(challengeOrchestrator.orchestrate).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "challenge-orchestration-session",
      fallbackDisposition: "challenge_preserved"
    }));
    expect(response).toMatchObject({
      ok: true,
      disposition: "completed",
      output: {
        url: "https://example.com/account"
      },
      details: {
        challengeOrchestration: {
          invoked: true,
          lane: "generic_browser_autonomy",
          status: "resolved"
        }
      }
    });
    expect(manager.disconnect).not.toHaveBeenCalled();
  });

  it("disconnects the fallback session when challenge orchestration exceeds the remaining deadline", async () => {
    vi.useFakeTimers();
    try {
      let resolveOrchestrationStarted: (() => void) | undefined;
      const orchestrationStarted = new Promise<void>((resolve) => {
        resolveOrchestrationStarted = resolve;
      });
      const manager = {
        launch: vi.fn(async () => ({ sessionId: "challenge-orchestration-timeout" })),
        goto: vi.fn(async () => ({ ok: true })),
        waitForLoad: vi.fn(async () => {
          throw new Error("networkidle never settled");
        }),
        withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
          return callback({
            waitForTimeout: async () => undefined,
            content: async () => "<html><body><h1>Security verification</h1></body></html>"
          });
        }),
        status: vi.fn(async () => ({
          mode: "extension",
          activeTargetId: "tab-8",
          url: "https://example.com/challenge"
        })),
        disconnect: vi.fn(async () => undefined),
        createChallengeRuntimeHandle: vi.fn().mockReturnValue(makeChallengeRuntimeHandle())
      } as unknown as BrowserManagerLike;
      const challengeOrchestrator = {
        orchestrate: vi.fn(async () => {
          resolveOrchestrationStarted?.();
          return await new Promise(() => undefined);
        })
      };

      const port = createBrowserFallbackPort(manager, {}, {}, challengeOrchestrator as never);
      const pending = port?.resolve({
        provider: "social/linkedin",
        source: "social",
        operation: "search",
        reasonCode: "token_required",
        trace: { requestId: "rf-challenge-orchestration-timeout", ts: "2026-03-31T00:00:00.000Z" },
        url: "https://www.linkedin.com/search/results/content/?keywords=browser%20automation&page=1",
        timeoutMs: 25
      });

      const orchestrationTimeout = expect(pending).rejects.toMatchObject({
        code: "timeout",
        details: {
          stage: "challenge_orchestration",
          timeoutMs: 25
        }
      });
      await orchestrationStarted;
      await vi.advanceTimersByTimeAsync(25);
      await orchestrationTimeout;
      expect(manager.disconnect).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out post-clear status refresh when challenge orchestration clears the blocker", async () => {
    vi.useFakeTimers();
    try {
      let resolveStatusRefreshStarted: (() => void) | undefined;
      const statusRefreshStarted = new Promise<void>((resolve) => {
        resolveStatusRefreshStarted = resolve;
      });
      const manager = {
        launch: vi.fn(async () => ({ sessionId: "challenge-refresh-status-timeout" })),
        goto: vi.fn(async () => ({ ok: true })),
        waitForLoad: vi.fn(async () => {
          throw new Error("networkidle never settled");
        }),
        withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
          return callback({
            waitForTimeout: async () => undefined,
            content: async () => "<html><body><h1>Security verification</h1></body></html>"
          });
        }),
        status: vi.fn()
          .mockResolvedValueOnce({
            mode: "extension",
            activeTargetId: "tab-8",
            url: "https://example.com/challenge"
          })
          .mockImplementationOnce(async () => {
            resolveStatusRefreshStarted?.();
            return await new Promise(() => undefined);
          }),
        disconnect: vi.fn(async () => undefined),
        createChallengeRuntimeHandle: vi.fn().mockReturnValue(makeChallengeRuntimeHandle())
      } as unknown as BrowserManagerLike;
      const challengeOrchestrator = {
        orchestrate: vi.fn(async () => ({
          action: {
            status: "resolved",
            attempts: 1,
            noProgressCount: 0,
            executedSteps: [],
            verification: {
              status: "clear",
              blockerState: "clear",
              changed: true,
              reason: "Manager verification cleared the blocker.",
              bundle: {
                blockerState: "clear"
              }
            },
            reusedExistingSession: true,
            reusedCookies: false
          },
          outcome: {
            status: "resolved"
          }
        }))
      };

      const port = createBrowserFallbackPort(manager, {}, {}, challengeOrchestrator as never);
      const pending = port?.resolve({
        provider: "social/linkedin",
        source: "social",
        operation: "search",
        reasonCode: "token_required",
        trace: { requestId: "rf-status-refresh-timeout", ts: "2026-03-31T00:00:00.000Z" },
        url: "https://www.linkedin.com/search/results/content/?keywords=browser%20automation&page=1",
        timeoutMs: 25
      });

      const statusRefreshTimeout = expect(pending).rejects.toMatchObject({
        code: "timeout",
        details: {
          stage: "status_refresh",
          timeoutMs: 25
        }
      });
      await statusRefreshStarted;
      await vi.advanceTimersByTimeAsync(25);
      await statusRefreshTimeout;
      expect(manager.disconnect).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out post-clear capture refresh when challenge orchestration clears the blocker", async () => {
    vi.useFakeTimers();
    try {
      let resolveCaptureRefreshStarted: (() => void) | undefined;
      const captureRefreshStarted = new Promise<void>((resolve) => {
        resolveCaptureRefreshStarted = resolve;
      });
      const manager = {
        launch: vi.fn(async () => ({ sessionId: "challenge-refresh-capture-timeout" })),
        goto: vi.fn(async () => ({ ok: true })),
        waitForLoad: vi.fn(async () => {
          throw new Error("networkidle never settled");
        }),
        withPage: vi.fn()
          .mockImplementationOnce(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => callback({
            waitForTimeout: async () => undefined,
            content: async () => "<html><body><h1>Security verification</h1></body></html>"
          }))
          .mockImplementationOnce(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => callback({
            waitForTimeout: async () => undefined,
            content: async () => {
              resolveCaptureRefreshStarted?.();
              return await new Promise<string>(() => undefined);
            }
          })),
        status: vi.fn()
          .mockResolvedValueOnce({
            mode: "extension",
            activeTargetId: "tab-8",
            url: "https://example.com/challenge"
          })
          .mockResolvedValueOnce({
            mode: "extension",
            activeTargetId: "tab-8",
            url: "https://example.com/account"
          }),
        disconnect: vi.fn(async () => undefined),
        createChallengeRuntimeHandle: vi.fn().mockReturnValue(makeChallengeRuntimeHandle())
      } as unknown as BrowserManagerLike;
      const challengeOrchestrator = {
        orchestrate: vi.fn(async () => ({
          action: {
            status: "resolved",
            attempts: 1,
            noProgressCount: 0,
            executedSteps: [],
            verification: {
              status: "clear",
              blockerState: "clear",
              changed: true,
              reason: "Manager verification cleared the blocker.",
              bundle: {
                blockerState: "clear"
              }
            },
            reusedExistingSession: true,
            reusedCookies: false
          },
          outcome: {
            status: "resolved"
          }
        }))
      };

      const port = createBrowserFallbackPort(manager, {}, {}, challengeOrchestrator as never);
      const pending = port?.resolve({
        provider: "social/linkedin",
        source: "social",
        operation: "search",
        reasonCode: "token_required",
        trace: { requestId: "rf-capture-refresh-timeout", ts: "2026-03-31T00:00:00.000Z" },
        url: "https://www.linkedin.com/search/results/content/?keywords=browser%20automation&page=1",
        timeoutMs: 25
      });

      const captureRefreshTimeout = expect(pending).rejects.toMatchObject({
        code: "timeout",
        details: {
          stage: "capture_refresh",
          timeoutMs: 25
        }
      });
      await captureRefreshStarted;
      await vi.advanceTimersByTimeAsync(25);
      await captureRefreshTimeout;
      expect(manager.disconnect).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("recaptures refreshed fallback html until the post-clear document stabilizes", async () => {
    const waitForTimeout = vi.fn(async () => undefined);
    const stableHtml = "<html><body><main>Recovered account content</main><a href=\"https://example.com/post/1\">post</a></body></html>";
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "challenge-refresh-stable-session" })),
      goto: vi.fn(async () => ({ ok: true })),
      waitForLoad: vi.fn(async () => {
        throw new Error("networkidle never settled");
      }),
      withPage: vi.fn()
        .mockImplementationOnce(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => callback({
          waitForTimeout,
          content: async () => "<html><body><h1>Security verification</h1></body></html>"
        }))
        .mockImplementationOnce(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => callback({
          waitForTimeout,
          content: async () => "<html><body><main>Recovered</main></body></html>"
        }))
        .mockImplementationOnce(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => callback({
          waitForTimeout,
          content: async () => stableHtml
        }))
        .mockImplementationOnce(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => callback({
          waitForTimeout,
          content: async () => stableHtml
        })),
      status: vi.fn()
        .mockResolvedValueOnce({
          mode: "extension",
          activeTargetId: "tab-8",
          url: "https://example.com/challenge"
        })
        .mockResolvedValueOnce({
          mode: "extension",
          activeTargetId: "tab-8",
          url: "https://example.com/account"
        }),
      disconnect: vi.fn(async () => undefined),
      createChallengeRuntimeHandle: vi.fn().mockReturnValue(makeChallengeRuntimeHandle())
    } as unknown as BrowserManagerLike;
    const challengeOrchestrator = {
      orchestrate: vi.fn(async () => ({
        action: {
          status: "resolved",
          attempts: 1,
          noProgressCount: 0,
          executedSteps: [],
          verification: {
            status: "clear",
            blockerState: "clear",
            changed: true,
            reason: "Manager verification cleared the blocker.",
            bundle: {
              blockerState: "clear"
            }
          },
          reusedExistingSession: true,
          reusedCookies: false
        },
        outcome: {
          status: "resolved"
        }
      }))
    };

    const port = createBrowserFallbackPort(manager, {}, {}, challengeOrchestrator as never);
    const response = await port?.resolve({
      provider: "social/linkedin",
      source: "social",
      operation: "search",
      reasonCode: "challenge_detected",
      trace: { requestId: "rf-refresh-stable-capture", ts: "2026-04-08T00:00:00.000Z" },
      url: "https://example.com/challenge"
    });

    expect(response).toMatchObject({
      ok: true,
      disposition: "completed",
      output: {
        html: stableHtml,
        url: "https://example.com/account"
      },
      details: {
        captureDiagnostics: {
          attempts: 3,
          stabilized: true,
          finalLinkCount: 1
        }
      }
    });
    expect(waitForTimeout.mock.calls.map(([delay]) => delay)).toEqual([2000, 2000, 250, 250]);
  });

  it("keeps the preserved blocker URL when challenge orchestration clears but refreshed status omits url", async () => {
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "challenge-orchestration-no-url" })),
      goto: vi.fn(async () => ({ ok: true })),
      waitForLoad: vi.fn(async () => {
        throw new Error("networkidle never settled");
      }),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
        return callback({
          waitForTimeout: async () => undefined,
          content: async () => "<html><body><h1>Security verification</h1></body></html>"
        });
      }),
      status: vi.fn()
        .mockResolvedValueOnce({
          mode: "extension",
          activeTargetId: "tab-8",
          url: "https://example.com/challenge"
        })
        .mockResolvedValueOnce({
          mode: "extension",
          activeTargetId: "tab-8",
          url: undefined
        }),
      disconnect: vi.fn(async () => undefined),
      createChallengeRuntimeHandle: vi.fn().mockReturnValue(makeChallengeRuntimeHandle())
    } as unknown as BrowserManagerLike;
    const challengeOrchestrator = {
      orchestrate: vi.fn(async () => ({
        action: {
          status: "resolved",
          attempts: 1,
          noProgressCount: 0,
          executedSteps: [],
          verification: {
            status: "clear",
            blockerState: "clear",
            changed: true,
            reason: "Manager verification cleared the blocker.",
            bundle: {
              blockerState: "clear"
            }
          },
          reusedExistingSession: true,
          reusedCookies: false
        },
        outcome: {
          status: "resolved"
        }
      }))
    };

    const port = createBrowserFallbackPort(manager, {}, {}, challengeOrchestrator as never);
    const response = await port?.resolve({
      provider: "shopping/temu",
      source: "shopping",
      operation: "search",
      reasonCode: "challenge_detected",
      trace: { requestId: "rf-challenge-orchestrated-no-url", ts: "2026-03-22T00:00:00.000Z" },
      url: "https://example.com/challenge"
    });

    expect(response).toMatchObject({
      ok: true,
      disposition: "completed",
      output: {
        url: "https://example.com/challenge"
      }
    });
    expect(manager.disconnect).not.toHaveBeenCalled();
  });

  it("omits preserve-path challenge orchestration details when the original request reason is not challenge-eligible", async () => {
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "preserved-auth-no-meta" })),
      goto: vi.fn(async () => ({ ok: true })),
      waitForLoad: vi.fn(async () => {
        throw new Error("networkidle never settled");
      }),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
        return callback({
          waitForTimeout: async () => undefined,
          content: async () => "<html><body><h1>Login</h1><p>Please sign in to continue.</p></body></html>"
        });
      }),
      status: vi.fn(async () => ({
        mode: "extension",
        activeTargetId: "tab-2",
        url: "https://example.com/login"
      })),
      disconnect: vi.fn(async () => undefined)
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager);
    const response = await port?.resolve({
      provider: "shopping/temu",
      source: "shopping",
      operation: "search",
      reasonCode: "rate_limited",
      trace: { requestId: "rf-preserved-auth-no-meta", ts: "2026-03-22T00:00:00.000Z" },
      url: "https://example.com/search?q=temu"
    });

    expect(response).toMatchObject({
      ok: false,
      reasonCode: "token_required",
      disposition: "challenge_preserved",
      details: {
        message: "Browser fallback preserved auth_required session at https://example.com/login."
      }
    });
    expect((response?.details as Record<string, unknown>)?.challengeOrchestration).toBeUndefined();
    expect(manager.disconnect).not.toHaveBeenCalled();
  });

  it("uses active status challenge metadata when capture html no longer exposes the blocker", async () => {
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "challenge-meta-session" })),
      goto: vi.fn(async () => ({ ok: true })),
      waitForLoad: vi.fn(async () => ({ timingMs: 5 })),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => callback({
        waitForTimeout: async () => undefined,
        content: async () => "<html><body><main>Recovered shell</main></body></html>"
      })),
      status: vi.fn(async () => ({
        mode: "managed",
        url: "https://www.reddit.com/search/?q=browser+automation",
        activeTargetId: "target-1",
        meta: {
          blockerState: "active",
          challenge: {
            challengeId: "challenge-meta",
            blockerType: "anti_bot_challenge",
            reasonCode: "challenge_detected",
            ownerSurface: "provider_fallback",
            resumeMode: "auto",
            preservedSessionId: "challenge-meta-session",
            preservedTargetId: "target-1",
            status: "active",
            updatedAt: "2026-04-08T00:00:00.000Z"
          }
        }
      })),
      disconnect: vi.fn(async () => undefined),
      createChallengeRuntimeHandle: vi.fn().mockReturnValue(makeChallengeRuntimeHandle())
    } as unknown as BrowserManagerLike;
    const challengeOrchestrator = {
      orchestrate: vi.fn(async () => ({
        action: {
          status: "deferred",
          attempts: 0,
          noProgressCount: 0,
          executedSteps: [],
          verification: {
            status: "still_blocked",
            blockerState: "active",
            changed: false,
            reason: "Challenge still active.",
            bundle: {
              blockerState: "active"
            }
          },
          reusedExistingSession: false,
          reusedCookies: false
        },
        outcome: {
          lane: "generic_browser_autonomy",
          status: "deferred",
          reason: "Challenge still active."
        }
      }))
    };

    const port = createBrowserFallbackPort(manager, {}, {}, challengeOrchestrator as never);
    const response = await port?.resolve({
      provider: "community/default",
      source: "community",
      operation: "search",
      reasonCode: "challenge_detected",
      trace: { requestId: "rf-status-challenge-meta", ts: "2026-04-08T00:00:00.000Z" },
      url: "https://www.reddit.com/search/?q=browser+automation"
    });

    expect(challengeOrchestrator.orchestrate).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "challenge-meta-session",
      targetId: "target-1"
    }));
    expect(response).toMatchObject({
      ok: false,
      disposition: "challenge_preserved",
      details: {
        challengeOrchestration: {
          status: "deferred",
          reason: "Challenge still active."
        },
        captureDiagnostics: {
          attempts: 2
        }
      }
    });
    expect(manager.disconnect).not.toHaveBeenCalled();
  });

  it("uses active auth challenge metadata when capture html no longer exposes the blocker", async () => {
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "auth-meta-session" })),
      goto: vi.fn(async () => ({ ok: true })),
      waitForLoad: vi.fn(async () => ({ timingMs: 5 })),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => callback({
        waitForTimeout: async () => undefined,
        content: async () => "<html><body><main>Sign in prompt hidden behind app shell</main></body></html>"
      })),
      status: vi.fn(async () => ({
        mode: "managed",
        url: "https://example.com/account",
        activeTargetId: "target-auth",
        meta: {
          blockerState: "active",
          challenge: {
            challengeId: "challenge-auth-meta",
            blockerType: "auth_required",
            reasonCode: "token_required",
            ownerSurface: "provider_fallback",
            resumeMode: "auto",
            preservedSessionId: "auth-meta-session",
            preservedTargetId: "target-auth",
            status: "active",
            updatedAt: "2026-04-09T00:00:00.000Z"
          }
        }
      })),
      disconnect: vi.fn(async () => undefined),
      createChallengeRuntimeHandle: vi.fn().mockReturnValue(makeChallengeRuntimeHandle())
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager);
    const response = await port?.resolve({
      provider: "community/default",
      source: "community",
      operation: "search",
      reasonCode: "token_required",
      trace: { requestId: "rf-status-auth-meta", ts: "2026-04-09T00:00:00.000Z" },
      url: "https://example.com/account"
    });

    expect(response).toMatchObject({
      ok: false,
      reasonCode: "token_required",
      details: {
        message: "Browser fallback preserved auth_required session at https://example.com/account.",
        captureDiagnostics: {
          attempts: 2
        }
      }
    });
    expect(manager.disconnect).not.toHaveBeenCalled();
  });

  it("ignores expired status challenge metadata when capture html is otherwise usable", async () => {
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "expired-meta-session" })),
      goto: vi.fn(async () => ({ ok: true })),
      waitForLoad: vi.fn(async () => ({ timingMs: 5 })),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => callback({
        waitForTimeout: async () => undefined,
        content: async () => "<html><body><main>Recovered content</main><a href=\"https://example.com/post/1\">post</a></body></html>"
      })),
      status: vi.fn(async () => ({
        mode: "managed",
        url: "https://example.com/post/1",
        activeTargetId: "target-expired",
        meta: {
          blockerState: "active",
          challenge: {
            challengeId: "challenge-expired",
            blockerType: "anti_bot_challenge",
            reasonCode: "challenge_detected",
            ownerSurface: "provider_fallback",
            resumeMode: "auto",
            preservedSessionId: "expired-meta-session",
            preservedTargetId: "target-expired",
            status: "expired",
            updatedAt: "2026-04-09T00:00:00.000Z"
          }
        }
      })),
      disconnect: vi.fn(async () => undefined)
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager);
    const response = await port?.resolve({
      provider: "community/default",
      source: "community",
      operation: "search",
      reasonCode: "challenge_detected",
      trace: { requestId: "rf-status-expired-meta", ts: "2026-04-09T00:00:00.000Z" },
      url: "https://example.com/post/1"
    });

    expect(response).toMatchObject({
      ok: true,
      output: {
        html: "<html><body><main>Recovered content</main><a href=\"https://example.com/post/1\">post</a></body></html>",
        url: "https://example.com/post/1"
      }
    });
    expect(manager.disconnect).toHaveBeenCalledWith("expired-meta-session", true);
  });

  it("merges orchestration outcomes even when the original request reason is not challenge-meta eligible", async () => {
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "challenge-rate-limited-preserve" })),
      goto: vi.fn(async () => ({ ok: true })),
      waitForLoad: vi.fn(async () => {
        throw new Error("networkidle unavailable");
      }),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
        return callback({
          waitForTimeout: async () => undefined,
          content: async () => "<html><body><h1>Security verification</h1></body></html>"
        });
      }),
      status: vi.fn(async () => ({
        mode: "extension",
        url: "https://example.com/challenge",
        activeTargetId: undefined
      })),
      disconnect: vi.fn(async () => undefined),
      createChallengeRuntimeHandle: vi.fn().mockReturnValue(makeChallengeRuntimeHandle())
    } as unknown as BrowserManagerLike;
    const challengeOrchestrator = {
      orchestrate: vi.fn(async () => ({
        action: {
          status: "deferred",
          attempts: 0,
          noProgressCount: 0,
          executedSteps: [],
          verification: {
            status: "still_blocked",
            blockerState: "active",
            changed: false,
            reason: "Challenge still active.",
            bundle: {
              blockerState: "active"
            }
          },
          reusedExistingSession: false,
          reusedCookies: false
        },
        outcome: {
          lane: "generic_browser_autonomy",
          status: "deferred",
          reason: "Challenge still active."
        }
      }))
    };

    const port = createBrowserFallbackPort(manager, {}, {}, challengeOrchestrator as never);
    const response = await port?.resolve({
      provider: "shopping/temu",
      source: "shopping",
      operation: "search",
      reasonCode: "rate_limited",
      trace: { requestId: "rf-rate-limited-preserve", ts: "2026-03-23T00:00:00.000Z" },
      url: "https://example.com/challenge"
    });

    expect(challengeOrchestrator.orchestrate).toHaveBeenCalledWith(expect.objectContaining({
      targetId: undefined
    }));
    expect(response).toMatchObject({
      ok: false,
      disposition: "challenge_preserved",
      details: {
        challengeOrchestration: {
          lane: "generic_browser_autonomy",
          status: "deferred",
          reason: "Challenge still active."
        }
      }
    });
    expect((response as { details?: { challengeOrchestration?: Record<string, unknown> } }).details?.challengeOrchestration)
      .not.toHaveProperty("mode");
    expect(manager.disconnect).not.toHaveBeenCalled();
  });

  it("resolves challenge automation precedence as run then session then config during fallback orchestration", async () => {
    const cases = [
      {
        label: "run",
        runMode: "off" as const,
        sessionMode: "browser_with_helper" as const,
        configMode: "browser" as const,
        expectedMode: "off" as const,
        expectedSource: "run" as const,
        expectedStandDownReason: "challenge_automation_off" as const
      },
      {
        label: "session",
        runMode: undefined,
        sessionMode: "browser_with_helper" as const,
        configMode: "browser" as const,
        expectedMode: "browser_with_helper" as const,
        expectedSource: "session" as const,
        expectedStandDownReason: undefined
      },
      {
        label: "config",
        runMode: undefined,
        sessionMode: undefined,
        configMode: "browser" as const,
        expectedMode: "browser" as const,
        expectedSource: "config" as const,
        expectedStandDownReason: "helper_disabled_for_browser_mode" as const
      }
    ];

    for (const testCase of cases) {
      const manager = {
        launch: vi.fn(async () => ({ sessionId: `challenge-${testCase.label}-session` })),
        goto: vi.fn(async () => ({ ok: true })),
        waitForLoad: vi.fn(async () => {
          throw new Error("networkidle never settled");
        }),
        withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
          return callback({
            waitForTimeout: async () => undefined,
            content: async () => "<html><body><h1>Security verification</h1></body></html>"
          });
        }),
        status: vi.fn(async () => ({
          mode: "extension",
          url: "https://example.com/challenge",
          activeTargetId: "target-1"
        })),
        disconnect: vi.fn(async () => undefined),
        getSessionChallengeAutomationMode: vi.fn(() => testCase.sessionMode),
        setSessionChallengeAutomationMode: vi.fn(),
        createChallengeRuntimeHandle: vi.fn().mockReturnValue(makeChallengeRuntimeHandle())
      } as unknown as BrowserManagerLike;

      const challengeOrchestrator = {
        orchestrate: vi.fn(async ({ policy }: { policy: { mode: string; source: string; standDownReason?: string } }) => ({
          action: {
            status: "deferred",
            attempts: 0,
            noProgressCount: 0,
            executedSteps: [],
            verification: {
              status: "still_blocked",
              blockerState: "active",
              changed: false,
              reason: "Challenge still active.",
              bundle: {
                blockerState: "active"
              }
            },
            reusedExistingSession: false,
            reusedCookies: false
          },
          outcome: {
            challengeId: `challenge-${testCase.label}`,
            classification: "checkpoint_or_friction",
            mode: policy.mode,
            source: policy.source,
            lane: "generic_browser_autonomy",
            status: "deferred",
            reason: "Challenge still active.",
            attempts: 0,
            reusedExistingSession: false,
            reusedCookies: false,
            helperEligibility: {
              allowed: policy.mode === "browser_with_helper",
              reason: policy.mode === "browser_with_helper"
                ? "Optional helper bridge remains eligible after mode resolution."
                : "Helper bridge is standing down."
            },
            ...(policy.standDownReason ? { standDownReason: policy.standDownReason } : {}),
            verification: {
              status: "still_blocked",
              blockerState: "active",
              changed: false,
              reason: "Challenge still active."
            },
            evidence: {
              url: "https://example.com/challenge",
              title: "Security verification",
              blockerType: "anti_bot_challenge",
              loginRefs: [],
              humanVerificationRefs: ["r1"],
              checkpointRefs: []
            }
          }
        }))
      };

      const port = createBrowserFallbackPort(manager, {}, {}, challengeOrchestrator as never, testCase.configMode);
      const response = await port?.resolve({
        provider: "shopping/temu",
        source: "shopping",
        operation: "search",
        reasonCode: "challenge_detected",
        trace: { requestId: `rf-precedence-${testCase.label}`, ts: "2026-03-23T00:00:00.000Z" },
        url: "https://example.com/challenge",
        ...(testCase.runMode
          ? {
            runtimePolicy: resolveProviderRuntimePolicy({
              source: "shopping",
              runtimePolicy: {
                challengeAutomationMode: testCase.runMode
              }
            })
          }
          : {})
      });

      expect(challengeOrchestrator.orchestrate).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: `challenge-${testCase.label}-session`,
        policy: expect.objectContaining({
          mode: testCase.expectedMode,
          source: testCase.expectedSource
        })
      }));
      expect(response).toMatchObject({
        ok: false,
        disposition: "challenge_preserved",
        details: {
          challengeOrchestration: {
            mode: testCase.expectedMode,
            source: testCase.expectedSource
          }
        }
      });
      if (testCase.expectedStandDownReason) {
        expect(response).toMatchObject({
          details: {
            challengeOrchestration: {
              standDownReason: testCase.expectedStandDownReason
            }
          }
        });
      }
      expect(manager.setSessionChallengeAutomationMode).toHaveBeenCalledWith(
        `challenge-${testCase.label}-session`,
        testCase.expectedMode
      );
      expect(manager.disconnect).not.toHaveBeenCalled();
    }
  });

  it("defaults fallback challenge policy to browser_with_helper when no config mode is provided", async () => {
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "default-mode-session" })),
      goto: vi.fn(async () => ({ ok: true })),
      waitForLoad: vi.fn(async () => {
        throw new Error("networkidle unavailable");
      }),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
        return callback({
          waitForTimeout: async () => undefined,
          content: async () => "<html><body><h1>Security verification</h1></body></html>"
        });
      }),
      status: vi.fn(async () => ({
        mode: "extension",
        url: "https://example.com/challenge",
        activeTargetId: "target-default"
      })),
      disconnect: vi.fn(async () => undefined),
      getSessionChallengeAutomationMode: vi.fn(() => undefined),
      setSessionChallengeAutomationMode: vi.fn(),
      createChallengeRuntimeHandle: vi.fn().mockReturnValue(makeChallengeRuntimeHandle())
    } as unknown as BrowserManagerLike;

    const challengeOrchestrator = {
      orchestrate: vi.fn(async ({ policy }: { policy: { mode: string; source: string } }) => ({
        action: {
          status: "deferred",
          attempts: 0,
          noProgressCount: 0,
          executedSteps: [],
          verification: {
            status: "still_blocked",
            blockerState: "active",
            changed: false,
            reason: "Challenge still active.",
            bundle: {
              blockerState: "active"
            }
          },
          reusedExistingSession: false,
          reusedCookies: false
        },
        outcome: {
          challengeId: "challenge-default-mode",
          classification: "checkpoint_or_friction",
          mode: policy.mode,
          source: policy.source,
          lane: "generic_browser_autonomy",
          status: "deferred",
          reason: "Challenge still active.",
          attempts: 0,
          reusedExistingSession: false,
          reusedCookies: false,
          helperEligibility: {
            allowed: policy.mode === "browser_with_helper",
            reason: "Optional helper bridge remains eligible after mode resolution."
          },
          verification: {
            status: "still_blocked",
            blockerState: "active",
            changed: false,
            reason: "Challenge still active."
          },
          evidence: {
            url: "https://example.com/challenge",
            title: "Security verification",
            blockerType: "anti_bot_challenge",
            loginRefs: [],
            humanVerificationRefs: ["r1"],
            checkpointRefs: []
          }
        }
      }))
    };

    const port = createBrowserFallbackPort(manager, {}, {}, challengeOrchestrator as never);
    await port?.resolve({
      provider: "shopping/temu",
      source: "shopping",
      operation: "search",
      reasonCode: "challenge_detected",
      trace: { requestId: "rf-default-mode", ts: "2026-03-23T00:00:00.000Z" },
      url: "https://example.com/challenge"
    });

    expect(challengeOrchestrator.orchestrate).toHaveBeenCalledWith(expect.objectContaining({
      policy: expect.objectContaining({
        mode: "browser_with_helper",
        source: "config"
      })
    }));
  });

  it("sanitizes invalid settle and capture delays while keeping fallback capture alive", async () => {
    const waitForTimeout = vi.fn(async () => undefined);
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "delay-sanitize-session" })),
      goto: vi.fn(async () => ({ ok: true })),
      waitForLoad: vi.fn(async () => {
        throw new Error("networkidle unavailable");
      }),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
        return callback({
          waitForTimeout,
          content: async () => "<html><body>fallback content</body></html>"
        });
      }),
      status: vi.fn(async () => ({ mode: "managed", url: "https://example.com/fallback" })),
      disconnect: vi.fn(async () => undefined)
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager);
    const response = await port?.resolve({
      provider: "social/youtube",
      source: "social",
      operation: "fetch",
      reasonCode: "transcript_unavailable",
      trace: { requestId: "rf-delay-sanitize", ts: "2026-03-22T00:00:00.000Z" },
      url: "https://example.com/fallback",
      settleTimeoutMs: Number.NaN,
      captureDelayMs: -25
    });

    expect(response).toMatchObject({
      ok: true,
      output: {
        html: "<html><body>fallback content</body></html>",
        url: "https://example.com/fallback"
      }
    });
    expect(manager.waitForLoad).toHaveBeenCalledWith(
      "delay-sanitize-session",
      "networkidle",
      expect.any(Number)
    );
    expect(waitForTimeout).toHaveBeenCalledWith(250);
  });

  it("treats empty fallback HTML as env-limited when the page surface lacks capture helpers", async () => {
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "no-helper-session" })),
      goto: vi.fn(async () => ({ ok: true })),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
        return callback({});
      }),
      status: vi.fn(async () => ({ mode: "managed", url: "https://example.com/no-helper" })),
      disconnect: vi.fn(async () => undefined)
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager);
    const response = await port?.resolve({
      provider: "web/default",
      source: "web",
      operation: "fetch",
      reasonCode: "env_limited",
      trace: { requestId: "rf-no-helper", ts: "2026-03-22T00:00:00.000Z" },
      url: "https://example.com/no-helper"
    });

    expect(response).toMatchObject({
      ok: false,
      reasonCode: "env_limited",
      disposition: "deferred",
      details: {
        message: "Browser fallback captured no HTML content at https://example.com/no-helper.",
        challengeOrchestration: {
          mode: "browser_with_helper",
          source: "config",
          invoked: false,
          reason: "Fallback capture cleared without an auth or challenge blocker, so challenge orchestration was not invoked.",
          helperEligibility: {
            allowed: false,
            standDownReason: "helper_no_active_challenge"
          }
        }
      }
    });
    expect(manager.disconnect).toHaveBeenCalledWith("no-helper-session", true);
  });

  it("captures fallback HTML when waitForLoad and waitForTimeout helpers are absent", async () => {
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "no-settle-helper-session" })),
      goto: vi.fn(async () => ({ ok: true })),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
        return callback({
          content: async () => "<html><body>no settle helper</body></html>"
        });
      }),
      status: vi.fn(async () => ({ mode: "managed", url: "https://example.com/no-settle-helper" })),
      disconnect: vi.fn(async () => undefined)
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager);
    const response = await port?.resolve({
      provider: "web/default",
      source: "web",
      operation: "fetch",
      reasonCode: "env_limited",
      trace: { requestId: "rf-no-settle-helper", ts: "2026-03-22T00:00:00.000Z" },
      url: "https://example.com/no-settle-helper"
    });

    expect(response).toMatchObject({
      ok: true,
      output: {
        html: "<html><body>no settle helper</body></html>",
        url: "https://example.com/no-settle-helper"
      }
    });
  });

  it("marks helper-capable auth fallback recoveries as not-invoked when the recovered page is already clear", async () => {
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "clear-auth-session" })),
      goto: vi.fn(async () => ({ ok: true })),
      waitForLoad: vi.fn(async () => undefined),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
        return callback({
          waitForTimeout: async () => undefined,
          content: async () => "<html><body><main>Recovered account content</main></body></html>"
        });
      }),
      status: vi.fn(async () => ({ mode: "extension", url: "https://www.linkedin.com/feed/" })),
      disconnect: vi.fn(async () => undefined),
      setSessionChallengeAutomationMode: vi.fn(),
      getSessionChallengeAutomationMode: vi.fn(() => "browser_with_helper")
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager);
    const response = await port?.resolve({
      provider: "social/linkedin",
      source: "social",
      operation: "search",
      reasonCode: "token_required",
      trace: { requestId: "rf-clear-auth", ts: "2026-03-23T00:00:00.000Z" },
      url: "https://www.linkedin.com/search/results/content/?keywords=browser%20automation&page=1",
      runtimePolicy: resolveProviderRuntimePolicy({
        source: "social",
        runtimePolicy: {
          challengeAutomationMode: "browser_with_helper"
        }
      })
    });

    expect(response).toMatchObject({
      ok: true,
      details: {
        challengeOrchestration: {
          mode: "browser_with_helper",
          source: "run",
          invoked: false,
          reason: "Fallback capture cleared without an auth or challenge blocker, so challenge orchestration was not invoked.",
          helperEligibility: {
            allowed: false,
            standDownReason: "helper_no_active_challenge"
          }
        }
      }
    });
  });

  it("reports helper-disabled policy and strips non-json challenge outcome fields", async () => {
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "helper-disabled-session" })),
      goto: vi.fn(async () => ({ ok: true })),
      waitForLoad: vi.fn(async () => {
        throw new Error("networkidle unavailable");
      }),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
        return callback({
          waitForTimeout: async () => undefined,
          content: async () => "<html><body><h1>Security verification</h1></body></html>"
        });
      }),
      status: vi.fn(async () => ({
        mode: "extension",
        url: "https://example.com/challenge",
        activeTargetId: "target-helper-disabled"
      })),
      disconnect: vi.fn(async () => undefined),
      getSessionChallengeAutomationMode: vi.fn(() => undefined),
      setSessionChallengeAutomationMode: vi.fn(),
      createChallengeRuntimeHandle: vi.fn().mockReturnValue(makeChallengeRuntimeHandle())
    } as unknown as BrowserManagerLike;

    const challengeOrchestrator = {
      orchestrate: vi.fn(async () => ({
        action: {
          status: "deferred",
          attempts: 0,
          noProgressCount: 0,
          executedSteps: [],
          verification: {
            status: "still_blocked",
            blockerState: "active",
            changed: false,
            reason: "Challenge still active.",
            bundle: {
              blockerState: "active"
            }
          },
          reusedExistingSession: false,
          reusedCookies: false
        },
        outcome: {
          lane: "generic_browser_autonomy",
          status: "deferred",
          transientFunction: () => "drop-me"
        }
      }))
    };

    const port = createBrowserFallbackPort(
      manager,
      {},
      {},
      challengeOrchestrator as never,
      "browser_with_helper",
      false
    );
    const response = await port?.resolve({
      provider: "shopping/temu",
      source: "shopping",
      operation: "search",
      reasonCode: "challenge_detected",
      trace: { requestId: "rf-helper-disabled", ts: "2026-03-23T00:00:00.000Z" },
      url: "https://example.com/challenge"
    });

    expect(response).toMatchObject({
      ok: false,
      disposition: "challenge_preserved",
      details: {
        challengeOrchestration: {
          mode: "browser_with_helper",
          source: "config",
          invoked: true,
          helperEligibility: {
            allowed: false,
            standDownReason: "helper_disabled_by_policy"
          },
          lane: "generic_browser_autonomy",
          status: "deferred"
        }
      }
    });
    expect((response as { details?: { challengeOrchestration?: Record<string, unknown> } }).details?.challengeOrchestration)
      .not.toHaveProperty("transientFunction");
    expect(manager.disconnect).not.toHaveBeenCalled();
  });

  it("returns env_limited on fallback manager errors and still disconnects", async () => {
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "fallback-session" })),
      goto: vi.fn(async () => ({ ok: true })),
      withPage: vi.fn(async () => {
        throw new Error("browser unavailable");
      }),
      status: vi.fn(),
      disconnect: vi.fn(async () => undefined)
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager);
    const response = await port?.resolve({
      provider: "social/youtube",
      source: "social",
      operation: "fetch",
      reasonCode: "transcript_unavailable",
      trace: { requestId: "rf-3", ts: "2026-02-16T00:00:00.000Z" },
      url: "https://example.com/watch"
    });

    expect(response).toMatchObject({
      ok: false,
      reasonCode: "env_limited",
      details: {
        message: "browser unavailable"
      }
    });
    expect(manager.disconnect).toHaveBeenCalledWith("fallback-session", true);
  });

  it("falls back to env_limited when clonePage cannot recover a string html payload", async () => {
    const invalidComponentManager = {
      launch: vi.fn(async () => ({ sessionId: "clone-invalid-component" })),
      goto: vi.fn(async () => ({ ok: true })),
      withPage: vi.fn(async () => {
        throw new Error("primary capture failed");
      }),
      clonePage: vi.fn(async () => ({
        component: "export default function Broken() { return null; }",
        css: ""
      })),
      status: vi.fn(async () => ({ mode: "managed", url: "https://example.com/clone-invalid" })),
      disconnect: vi.fn(async () => undefined)
    } as unknown as BrowserManagerLike;
    const nonStringComponentManager = {
      ...invalidComponentManager,
      launch: vi.fn(async () => ({ sessionId: "clone-non-string-component" })),
      clonePage: vi.fn(async () => ({
        component: "export default function Broken() { return (<div dangerouslySetInnerHTML={{ __html: { html: \"bad\" } }} />); }",
        css: ""
      })),
      status: vi.fn(async () => ({ mode: "managed", url: "https://example.com/clone-non-string" }))
    } as unknown as BrowserManagerLike;

    const malformedJsonManager = {
      ...invalidComponentManager,
      launch: vi.fn(async () => ({ sessionId: "clone-malformed-json" })),
      clonePage: vi.fn(async () => ({
        component: "export default function Broken() { return (<div dangerouslySetInnerHTML={{ __html: \"\\x\" }} />); }",
        css: ""
      })),
      status: vi.fn(async () => ({ mode: "managed", url: "https://example.com/clone-malformed" }))
    } as unknown as BrowserManagerLike;

    const invalidPort = createBrowserFallbackPort(invalidComponentManager);
    const nonStringPort = createBrowserFallbackPort(nonStringComponentManager);
    const malformedPort = createBrowserFallbackPort(malformedJsonManager);

    await expect(invalidPort?.resolve({
      provider: "web/default",
      source: "web",
      operation: "fetch",
      reasonCode: "env_limited",
      trace: { requestId: "rf-clone-invalid-component", ts: "2026-03-23T00:00:00.000Z" },
      url: "https://example.com/clone-invalid"
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "env_limited",
      details: {
        message: "primary capture failed"
      }
    });
    await expect(nonStringPort?.resolve({
      provider: "web/default",
      source: "web",
      operation: "fetch",
      reasonCode: "env_limited",
      trace: { requestId: "rf-clone-non-string-component", ts: "2026-03-23T00:00:00.000Z" },
      url: "https://example.com/clone-non-string"
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "env_limited",
      details: {
        message: "primary capture failed"
      }
    });
    await expect(malformedPort?.resolve({
      provider: "web/default",
      source: "web",
      operation: "fetch",
      reasonCode: "env_limited",
      trace: { requestId: "rf-clone-malformed-json", ts: "2026-03-23T00:00:00.000Z" },
      url: "https://example.com/clone-malformed"
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "env_limited",
      details: {
        message: "primary capture failed"
      }
    });
  });

  it("omits non-record orchestrator outcomes and treats empty session ids as missing session mode", async () => {
    const manager = {
      connectRelay: vi.fn(async () => ({ sessionId: "" })),
      goto: vi.fn(async () => ({ ok: true })),
      waitForLoad: vi.fn(async () => ({ timingMs: 5 })),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
        return callback({
          waitForTimeout: async () => undefined,
          content: async () => "<html><body>Security verification</body></html>"
        });
      }),
      status: vi.fn(async () => ({ mode: "extension", url: "https://example.com/challenge" })),
      cookieList: vi.fn(async () => ({ count: 1, cookies: [] })),
      disconnect: vi.fn(async () => undefined),
      getSessionChallengeAutomationMode: vi.fn(() => "session-mode-should-not-apply"),
      createChallengeRuntimeHandle: vi.fn().mockReturnValue(makeChallengeRuntimeHandle())
    } as unknown as BrowserManagerLike;
    const challengeOrchestrator = {
      orchestrate: vi.fn(async () => ({
        outcome: ["ignored-array-payload"],
        action: {
          verification: {
            bundle: undefined
          }
        }
      }))
    } as never;

    const port = createBrowserFallbackPort(
      manager,
      {},
      { extensionWsEndpoint: "ws://127.0.0.1:8787/ops" },
      challengeOrchestrator
    );
    const response = await port?.resolve({
      provider: "social/linkedin",
      source: "social",
      operation: "fetch",
      reasonCode: "challenge_detected",
      trace: { requestId: "rf-empty-session-id", ts: "2026-03-26T00:00:00.000Z" },
      url: "https://example.com/challenge",
      runtimePolicy: resolveProviderRuntimePolicy({
        source: "social",
        preferredFallbackModes: ["extension"],
        challengeAutomationMode: "browser_with_helper"
      })
    });

    expect(response).toMatchObject({
      ok: false,
      disposition: "challenge_preserved"
    });
    expect(challengeOrchestrator.orchestrate).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: ""
    }));
    expect((response as { details?: { challengeOrchestration?: Record<string, unknown> } }).details?.challengeOrchestration)
      .toMatchObject({
        mode: "browser_with_helper",
        source: "run",
        invoked: true
      });
  });

  it("marks non-preserve restricted targets as failed instead of deferred", async () => {
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "restricted-target-session" })),
      goto: vi.fn(async () => ({ ok: true })),
      waitForLoad: vi.fn(async () => ({ timingMs: 5 })),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
        return callback({
          waitForTimeout: async () => undefined,
          content: async () => "<html><body>Chrome settings</body></html>"
        });
      }),
      status: vi.fn(async () => ({ mode: "managed", url: "chrome://settings" })),
      disconnect: vi.fn(async () => undefined)
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager);
    const response = await port?.resolve({
      provider: "web/default",
      source: "web",
      operation: "fetch",
      reasonCode: "transcript_unavailable",
      trace: { requestId: "rf-restricted-target", ts: "2026-03-26T00:00:00.000Z" },
      url: "https://example.com/redirected"
    });

    expect(response).toMatchObject({
      ok: false,
      disposition: "failed"
    });
  });

  it("maps non-Error fallback failures and tolerates disconnect cleanup failures", async () => {
    const manager = {
      launch: vi.fn(async () => {
        return await Promise.reject("launch-failed");
      }),
      goto: vi.fn(),
      withPage: vi.fn(),
      status: vi.fn(),
      disconnect: vi.fn(async () => {
        throw new Error("disconnect failed");
      })
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager);
    const response = await port?.resolve({
      provider: "social/youtube",
      source: "social",
      operation: "fetch",
      reasonCode: "transcript_unavailable",
      trace: { requestId: "rf-3b", ts: "2026-02-16T00:00:00.000Z" },
      url: "https://example.com/watch"
    });

    expect(response).toMatchObject({
      ok: false,
      reasonCode: "env_limited",
      details: {
        message: "launch-failed"
      }
    });
    expect(manager.disconnect).not.toHaveBeenCalled();
  });

  it("fails fast with auth_required when required cookie policy has no cookies", async () => {
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "required-cookie-miss" })),
      goto: vi.fn(async () => ({ ok: true })),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
        return callback({ content: async () => "<html><body>fallback</body></html>" });
      }),
      status: vi.fn(async () => ({ mode: "managed", url: "https://example.com/protected" })),
      disconnect: vi.fn(async () => undefined),
      cookieImport: vi.fn(async () => ({ requestId: "import", imported: 0, rejected: [] })),
      cookieList: vi.fn(async () => ({ requestId: "list", cookies: [], count: 0 }))
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager, {
      policy: "required",
      source: {
        type: "inline",
        value: []
      }
    });
    const response = await port?.resolve({
      provider: "social/youtube",
      source: "social",
      operation: "fetch",
      reasonCode: "transcript_unavailable",
      trace: { requestId: "rf-required-1", ts: "2026-02-16T00:00:00.000Z" },
      url: "https://example.com/protected"
    });

    expect(response).toMatchObject({
      ok: false,
      reasonCode: "auth_required"
    });
    expect(manager.cookieImport).not.toHaveBeenCalled();
    expect(manager.goto).not.toHaveBeenCalled();
    expect(manager.disconnect).toHaveBeenCalledWith("required-cookie-miss", true);
  });

  it("injects and verifies cookies before fallback navigation when available", async () => {
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "cookie-inject-ok" })),
      goto: vi.fn(async () => ({ ok: true })),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
        return callback({ content: async () => "<html><body>ok</body></html>" });
      }),
      status: vi.fn(async () => ({ mode: "managed", url: "https://example.com/protected" })),
      disconnect: vi.fn(async () => undefined),
      cookieImport: vi.fn(async () => ({ requestId: "import", imported: 1, rejected: [] })),
      cookieList: vi.fn(async () => ({
        requestId: "list",
        cookies: [
          {
            name: "sid",
            value: "value",
            domain: "example.com",
            path: "/",
            expires: -1,
            httpOnly: true,
            secure: true
          }
        ],
        count: 1
      }))
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager, {
      policy: "required",
      source: {
        type: "inline",
        value: [{
          name: "sid",
          value: "value",
          domain: ".example.com",
          path: "/",
          secure: true,
          httpOnly: true
        }]
      }
    });
    const response = await port?.resolve({
      provider: "social/youtube",
      source: "social",
      operation: "fetch",
      reasonCode: "transcript_unavailable",
      trace: { requestId: "rf-required-2", ts: "2026-02-16T00:00:00.000Z" },
      url: "https://example.com/protected"
    });

    expect(response).toMatchObject({
      ok: true,
      details: {
        cookieDiagnostics: {
          policy: "required",
          source: "inline",
          injected: 1,
          rejected: 0,
          verifiedCount: 1
        }
      }
    });
    expect(manager.cookieImport).toHaveBeenCalledTimes(1);
    expect(manager.cookieList).toHaveBeenCalledWith("cookie-inject-ok", ["https://example.com/protected"]);
    expect(manager.goto).toHaveBeenCalledWith("cookie-inject-ok", "https://example.com/protected", "load", 45000);
  });

  it("supports deterministic cookie policy overrides per fallback request", async () => {
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "cookie-policy-override" })),
      goto: vi.fn(async () => ({ ok: true })),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
        return callback({ content: async () => "<html><body>ok</body></html>" });
      }),
      status: vi.fn(async () => ({ mode: "managed", url: "https://example.com/protected" })),
      disconnect: vi.fn(async () => undefined),
      cookieImport: vi.fn(async () => ({ requestId: "import", imported: 1, rejected: [] })),
      cookieList: vi.fn(async () => ({ requestId: "list", cookies: [], count: 1 }))
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager, {
      policy: "off",
      source: {
        type: "inline",
        value: [{
          name: "sid",
          value: "value",
          domain: ".example.com",
          path: "/",
          secure: true
        }]
      }
    });

    const withUseCookies = await port?.resolve({
      provider: "social/youtube",
      source: "social",
      operation: "fetch",
      reasonCode: "transcript_unavailable",
      trace: { requestId: "rf-cookie-policy-1", ts: "2026-02-16T00:00:00.000Z" },
      url: "https://example.com/protected",
      runtimePolicy: resolveProviderRuntimePolicy({
        source: "social",
        runtimePolicy: {
          useCookies: true
        }
      })
    });
    expect(withUseCookies).toMatchObject({
      ok: true,
      details: {
        cookieDiagnostics: {
          policy: "auto",
          attempted: true
        }
      }
    });

    const withDisable = await port?.resolve({
      provider: "social/youtube",
      source: "social",
      operation: "fetch",
      reasonCode: "transcript_unavailable",
      trace: { requestId: "rf-cookie-policy-2", ts: "2026-02-16T00:00:00.000Z" },
      url: "https://example.com/protected",
      runtimePolicy: resolveProviderRuntimePolicy({
        source: "social",
        runtimePolicy: {
          useCookies: false
        }
      })
    });
    expect(withDisable).toMatchObject({
      ok: true,
      details: {
        cookieDiagnostics: {
          policy: "off",
          attempted: false
        }
      }
    });

    const withRequiredOverride = await port?.resolve({
      provider: "social/youtube",
      source: "social",
      operation: "fetch",
      reasonCode: "transcript_unavailable",
      trace: { requestId: "rf-cookie-policy-3", ts: "2026-02-16T00:00:00.000Z" },
      url: "https://example.com/protected",
      runtimePolicy: resolveProviderRuntimePolicy({
        source: "social",
        runtimePolicy: {
          useCookies: false,
          cookiePolicyOverride: "required"
        }
      })
    });
    expect(withRequiredOverride).toMatchObject({
      ok: true,
      details: {
        cookieDiagnostics: {
          policy: "required"
        }
      }
    });
  });

  it("continues in auto mode when cookie file read fails for non-ENOENT errors", async () => {
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "cookie-file-eisdir" })),
      goto: vi.fn(async () => ({ ok: true })),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
        return callback({ content: async () => "<html><body>ok</body></html>" });
      }),
      status: vi.fn(async () => ({ mode: "managed", url: "https://example.com/protected" })),
      disconnect: vi.fn(async () => undefined),
      cookieImport: vi.fn(async () => ({ requestId: "import", imported: 0, rejected: [] })),
      cookieList: vi.fn(async () => ({ requestId: "list", cookies: [], count: 0 }))
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager, {
      policy: "auto",
      source: {
        type: "file",
        value: "/"
      }
    });
    const response = await port?.resolve({
      provider: "social/youtube",
      source: "social",
      operation: "fetch",
      reasonCode: "transcript_unavailable",
      trace: { requestId: "rf-cookie-file-1", ts: "2026-02-16T00:00:00.000Z" },
      url: "https://example.com/protected"
    });

    expect(response).toMatchObject({
      ok: true,
      details: {
        cookieDiagnostics: {
          policy: "auto",
          attempted: false,
          message: expect.stringContaining("Cookie file read failed")
        }
      }
    });
    expect(manager.cookieImport).not.toHaveBeenCalled();
    expect(manager.cookieList).not.toHaveBeenCalled();
  });

  it("supports env cookie source for required policy across missing, invalid, and valid payloads", async () => {
    const envKey = "ODB_PROVIDER_COOKIES_TEST";
    const original = process.env[envKey];
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "cookie-env-flow" })),
      goto: vi.fn(async () => ({ ok: true })),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
        return callback({ content: async () => "<html><body>env</body></html>" });
      }),
      status: vi.fn(async () => ({ mode: "managed", url: "https://example.com/protected" })),
      disconnect: vi.fn(async () => undefined),
      cookieImport: vi.fn(async () => ({ requestId: "import", imported: 1, rejected: [] })),
      cookieList: vi.fn(async () => ({ requestId: "list", cookies: [], count: 1 }))
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager, {
      policy: "required",
      source: {
        type: "env",
        value: envKey
      }
    });

    try {
      delete process.env[envKey];
      const missing = await port?.resolve({
        provider: "social/youtube",
        source: "social",
        operation: "fetch",
        reasonCode: "transcript_unavailable",
        trace: { requestId: "rf-cookie-env-1", ts: "2026-02-16T00:00:00.000Z" },
        url: "https://example.com/protected"
      });
      expect(missing).toMatchObject({
        ok: false,
        reasonCode: "auth_required"
      });

      process.env[envKey] = "{broken json";
      const invalid = await port?.resolve({
        provider: "social/youtube",
        source: "social",
        operation: "fetch",
        reasonCode: "transcript_unavailable",
        trace: { requestId: "rf-cookie-env-2", ts: "2026-02-16T00:00:00.000Z" },
        url: "https://example.com/protected"
      });
      expect(invalid).toMatchObject({
        ok: false,
        reasonCode: "auth_required"
      });

      process.env[envKey] = JSON.stringify([{
        name: "sid",
        value: "env",
        domain: ".example.com",
        path: "/",
        secure: true
      }]);
      const valid = await port?.resolve({
        provider: "social/youtube",
        source: "social",
        operation: "fetch",
        reasonCode: "transcript_unavailable",
        trace: { requestId: "rf-cookie-env-3", ts: "2026-02-16T00:00:00.000Z" },
        url: "https://example.com/protected"
      });
      expect(valid).toMatchObject({
        ok: true,
        details: {
          cookieDiagnostics: {
            source: "env",
            loaded: 1,
            injected: 1,
            verifiedCount: 1
          }
        }
      });
    } finally {
      if (typeof original === "undefined") {
        delete process.env[envKey];
      } else {
        process.env[envKey] = original;
      }
    }
  });

  it("expands home-only cookie file source refs in diagnostics", async () => {
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "cookie-home-ref" })),
      goto: vi.fn(async () => ({ ok: true })),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
        return callback({ content: async () => "<html><body>home-ref</body></html>" });
      }),
      status: vi.fn(async () => ({ mode: "managed", url: "https://example.com" })),
      disconnect: vi.fn(async () => undefined)
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager, {
      policy: "off",
      source: {
        type: "file",
        value: "~"
      }
    });

    const response = await port?.resolve({
      provider: "social/youtube",
      source: "social",
      operation: "fetch",
      reasonCode: "transcript_unavailable",
      trace: { requestId: "rf-cookie-home-ref", ts: "2026-02-16T00:00:00.000Z" },
      url: "https://example.com/watch"
    });

    expect(response).toMatchObject({
      ok: true,
      details: {
        cookieDiagnostics: {
          sourceRef: os.homedir(),
          policy: "off"
        }
      }
    });
  });

  it("surfaces non-Error env cookie parse failures deterministically", async () => {
    const envKey = "ODB_PROVIDER_COOKIES_STRING_THROW";
    const original = process.env[envKey];
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "cookie-env-string-throw" })),
      goto: vi.fn(async () => ({ ok: true })),
      withPage: vi.fn(async () => "<html></html>"),
      status: vi.fn(async () => ({ mode: "managed", url: "https://example.com/protected" })),
      disconnect: vi.fn(async () => undefined),
      cookieImport: vi.fn(async () => ({ requestId: "import", imported: 0, rejected: [] })),
      cookieList: vi.fn(async () => ({ requestId: "list", cookies: [], count: 0 }))
    } as unknown as BrowserManagerLike;

    const parseSpy = vi.spyOn(JSON, "parse").mockImplementation(() => {
      throw "json-parse-threw-string";
    });
    process.env[envKey] = "[{\"name\":\"sid\"}]";

    try {
      const port = createBrowserFallbackPort(manager, {
        policy: "required",
        source: {
          type: "env",
          value: envKey
        }
      });
      const response = await port?.resolve({
        provider: "social/youtube",
        source: "social",
        operation: "fetch",
        reasonCode: "transcript_unavailable",
        trace: { requestId: "rf-cookie-env-string-throw", ts: "2026-02-16T00:00:00.000Z" },
        url: "https://example.com/protected"
      });

      expect(response).toMatchObject({
        ok: false,
        reasonCode: "auth_required",
        details: {
          cookieDiagnostics: {
            message: expect.stringContaining("json-parse-threw-string")
          }
        }
      });
    } finally {
      parseSpy.mockRestore();
      if (typeof original === "undefined") {
        delete process.env[envKey];
      } else {
        process.env[envKey] = original;
      }
    }
  });

  it("surfaces non-Error file cookie parse failures deterministically", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "odb-cookie-source-non-error-file-"));
    const filePath = path.join(tmpDir, "cookies.json");
    fs.writeFileSync(filePath, "[]", "utf8");

    const manager = {
      launch: vi.fn(async () => ({ sessionId: "cookie-file-string-parse" })),
      goto: vi.fn(async () => ({ ok: true })),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
        return callback({ content: async () => "<html><body>ok</body></html>" });
      }),
      status: vi.fn(async () => ({ mode: "managed", url: "https://example.com/protected" })),
      disconnect: vi.fn(async () => undefined),
      cookieImport: vi.fn(async () => ({ requestId: "import", imported: 0, rejected: [] })),
      cookieList: vi.fn(async () => ({ requestId: "list", cookies: [], count: 0 }))
    } as unknown as BrowserManagerLike;

    const parseSpy = vi.spyOn(JSON, "parse").mockImplementation(() => {
      throw "file-json-string-error";
    });

    try {
      const port = createBrowserFallbackPort(manager, {
        policy: "auto",
        source: {
          type: "file",
          value: filePath
        }
      });
      const response = await port?.resolve({
        provider: "social/youtube",
        source: "social",
        operation: "fetch",
        reasonCode: "transcript_unavailable",
        trace: { requestId: "rf-cookie-file-string-parse", ts: "2026-02-16T00:00:00.000Z" },
        url: "https://example.com/protected"
      });

      expect(response).toMatchObject({
        ok: true,
        details: {
          cookieDiagnostics: {
            message: expect.stringContaining("file-json-string-error")
          }
        }
      });
    } finally {
      parseSpy.mockRestore();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("fails with required policy and explicit missing-cookie message when file source contains an empty array", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "odb-cookie-source-empty-file-"));
    const filePath = path.join(tmpDir, "cookies.json");
    fs.writeFileSync(filePath, "[]", "utf8");

    const manager = {
      launch: vi.fn(async () => ({ sessionId: "cookie-file-empty-required" })),
      goto: vi.fn(async () => ({ ok: true })),
      withPage: vi.fn(async () => "<html></html>"),
      status: vi.fn(async () => ({ mode: "managed", url: "https://example.com/protected" })),
      disconnect: vi.fn(async () => undefined),
      cookieImport: vi.fn(async () => ({ requestId: "import", imported: 0, rejected: [] })),
      cookieList: vi.fn(async () => ({ requestId: "list", cookies: [], count: 0 }))
    } as unknown as BrowserManagerLike;

    try {
      const port = createBrowserFallbackPort(manager, {
        policy: "required",
        source: {
          type: "file",
          value: filePath
        }
      });
      const response = await port?.resolve({
        provider: "social/youtube",
        source: "social",
        operation: "fetch",
        reasonCode: "transcript_unavailable",
        trace: { requestId: "rf-cookie-file-empty-required", ts: "2026-02-16T00:00:00.000Z" },
        url: "https://example.com/protected"
      });

      expect(response).toMatchObject({
        ok: false,
        reasonCode: "auth_required",
        details: {
          cookieDiagnostics: {
            loaded: 0,
            message: `Cookie file is empty: ${filePath}`
          }
        }
      });
      expect(manager.cookieImport).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("fails required policy when cookies load but import yields zero injected entries", async () => {
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "cookie-import-zero" })),
      goto: vi.fn(async () => ({ ok: true })),
      withPage: vi.fn(async () => "<html></html>"),
      status: vi.fn(async () => ({ mode: "managed", url: "https://example.com/protected" })),
      disconnect: vi.fn(async () => undefined),
      cookieImport: vi.fn(async () => ({ requestId: "import", imported: 0, rejected: [{ name: "sid", reason: "domain_mismatch" }] })),
      cookieList: vi.fn(async () => ({ requestId: "list", cookies: [], count: 0 }))
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager, {
      policy: "required",
      source: {
        type: "inline",
        value: [{
          name: "sid",
          value: "value",
          domain: ".example.com",
          path: "/",
          secure: true
        }]
      }
    });

    const response = await port?.resolve({
      provider: "social/youtube",
      source: "social",
      operation: "fetch",
      reasonCode: "transcript_unavailable",
      trace: { requestId: "rf-cookie-import-zero", ts: "2026-02-16T00:00:00.000Z" },
      url: "https://example.com/protected"
    });

    expect(response).toMatchObject({
      ok: false,
      reasonCode: "auth_required",
      details: {
        cookieDiagnostics: {
          loaded: 1,
          injected: 0,
          message: "Provider cookie injection imported 0 entries."
        }
      }
    });
  });

  it("fails required policy when cookies inject but cannot be observed after import", async () => {
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "cookie-verify-zero" })),
      goto: vi.fn(async () => ({ ok: true })),
      withPage: vi.fn(async () => "<html></html>"),
      status: vi.fn(async () => ({ mode: "managed", url: "https://example.com/protected" })),
      disconnect: vi.fn(async () => undefined),
      cookieImport: vi.fn(async () => ({ requestId: "import", imported: 1, rejected: [] })),
      cookieList: vi.fn(async () => ({ requestId: "list", cookies: [], count: 0 }))
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager, {
      policy: "required",
      source: {
        type: "inline",
        value: [{
          name: "sid",
          value: "value",
          domain: ".example.com",
          path: "/",
          secure: true
        }]
      }
    });

    const response = await port?.resolve({
      provider: "social/youtube",
      source: "social",
      operation: "fetch",
      reasonCode: "transcript_unavailable",
      trace: { requestId: "rf-cookie-verify-zero", ts: "2026-02-16T00:00:00.000Z" },
      url: "https://example.com/protected"
    });

    expect(response).toMatchObject({
      ok: false,
      reasonCode: "auth_required",
      details: {
        cookieDiagnostics: {
          injected: 1,
          verifiedCount: 0,
          message: "Provider cookies were not observable after injection."
        }
      }
    });
  });

  it("supports file cookie source with both invalid and valid JSON payloads", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "odb-cookie-source-"));
    const invalidPath = path.join(tmpDir, "cookies-invalid.json");
    const validPath = path.join(tmpDir, "cookies-valid.json");
    fs.writeFileSync(invalidPath, JSON.stringify({ sid: "bad-shape" }), "utf8");
    fs.writeFileSync(validPath, JSON.stringify([{
      name: "sid",
      value: "file",
      domain: ".example.com",
      path: "/",
      secure: true
    }]), "utf8");

    const manager = {
      launch: vi.fn(async () => ({ sessionId: "cookie-file-source" })),
      goto: vi.fn(async () => ({ ok: true })),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
        return callback({ content: async () => "<html><body>file</body></html>" });
      }),
      status: vi.fn(async () => ({ mode: "managed", url: "https://example.com/protected" })),
      disconnect: vi.fn(async () => undefined),
      cookieImport: vi.fn(async () => ({ requestId: "import", imported: 1, rejected: [] })),
      cookieList: vi.fn(async () => ({ requestId: "list", cookies: [], count: 1 }))
    } as unknown as BrowserManagerLike;

    try {
      const invalidPort = createBrowserFallbackPort(manager, {
        policy: "required",
        source: {
          type: "file",
          value: invalidPath
        }
      });
      const invalid = await invalidPort?.resolve({
        provider: "social/youtube",
        source: "social",
        operation: "fetch",
        reasonCode: "transcript_unavailable",
        trace: { requestId: "rf-cookie-file-2", ts: "2026-02-16T00:00:00.000Z" },
        url: "https://example.com/protected"
      });
      expect(invalid).toMatchObject({
        ok: false,
        reasonCode: "auth_required"
      });

      const validPort = createBrowserFallbackPort(manager, {
        policy: "required",
        source: {
          type: "file",
          value: validPath
        }
      });
      const valid = await validPort?.resolve({
        provider: "social/youtube",
        source: "social",
        operation: "fetch",
        reasonCode: "transcript_unavailable",
        trace: { requestId: "rf-cookie-file-3", ts: "2026-02-16T00:00:00.000Z" },
        url: "https://example.com/protected"
      });
      expect(valid).toMatchObject({
        ok: true,
        details: {
          cookieDiagnostics: {
            source: "file",
            loaded: 1,
            injected: 1,
            verifiedCount: 1
          }
        }
      });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("maps config provider knobs into runtime init", () => {
    const browserFallbackPort = {
      resolve: vi.fn(async () => ({
        ok: false as const,
        reasonCode: "env_limited" as const
      }))
    };

    const runtimeInit = buildRuntimeInitFromConfig({
      blockerDetectionThreshold: 0.83,
      security: {
        allowRawCDP: false,
        allowNonLocalCdp: false,
        allowUnsafeExport: false,
        promptInjectionGuard: { enabled: false }
      },
      providers: {
        tiers: {
          default: "B",
          enableHybrid: true,
          enableRestrictedSafe: true,
          hybridRiskThreshold: 0.4,
          restrictedSafeRecoveryIntervalMs: 120000
        },
        adaptiveConcurrency: {
          enabled: true,
          maxGlobal: 10,
          maxPerDomain: 5
        },
        crawler: {
          workerThreads: 8,
          queueMax: 5000
        },
        antiBotPolicy: {
          enabled: true,
          cooldownMs: 45000,
          maxChallengeRetries: 2,
          proxyHint: "proxy://residential",
          sessionHint: "session:warm",
          allowBrowserEscalation: true
        },
        transcript: {
          modeDefault: "auto",
          strategyOrder: ["native_caption_parse", "optional_asr"],
          enableYtdlp: true,
          enableAsr: true,
          enableYtdlpAudioAsr: true,
          enableApify: true,
          apifyActorId: "streamers/youtube-scraper",
          enableBrowserFallback: true,
          ytdlpTimeoutMs: 20000
        },
        cookiePolicy: "required",
        cookieSource: {
          type: "env",
          value: "OPENDEVBROWSER_PROVIDER_COOKIES"
        }
      }
    }, browserFallbackPort);

    expect(runtimeInit).toMatchObject({
      blockerDetectionThreshold: 0.83,
      promptInjectionGuard: {
        enabled: false
      },
      tiers: {
        defaultTier: "B",
        enableHybrid: true,
        enableRestrictedSafe: true,
        hybridRiskThreshold: 0.4,
        restrictedSafeRecoveryIntervalMs: 120000
      },
      adaptiveConcurrency: {
        enabled: true,
        maxGlobal: 10,
        maxPerDomain: 5
      },
      antiBotPolicy: {
        enabled: true,
        cooldownMs: 45000,
        maxChallengeRetries: 2,
        proxyHint: "proxy://residential",
        sessionHint: "session:warm",
        allowBrowserEscalation: true
      },
      transcript: {
        modeDefault: "auto",
        strategyOrder: ["native_caption_parse", "optional_asr"],
        enableYtdlp: true,
        enableAsr: true,
        enableYtdlpAudioAsr: true,
        enableApify: true,
        apifyActorId: "streamers/youtube-scraper",
        enableBrowserFallback: true,
        ytdlpTimeoutMs: 20000
      },
      cookies: {
        policy: "required",
        source: {
          type: "env",
          value: "OPENDEVBROWSER_PROVIDER_COOKIES"
        }
      },
      browserFallbackPort
    });
  });

  it("maps transcript settings without rollout canary gates", () => {
    const runtimeInit = buildRuntimeInitFromConfig({
      blockerDetectionThreshold: 0.75,
      security: {
        allowRawCDP: false,
        allowNonLocalCdp: false,
        allowUnsafeExport: false,
        promptInjectionGuard: { enabled: true }
      },
      providers: {
        tiers: {
          default: "A",
          enableHybrid: false,
          enableRestrictedSafe: false,
          hybridRiskThreshold: 0.6,
          restrictedSafeRecoveryIntervalMs: 60000
        },
        adaptiveConcurrency: {
          enabled: false,
          maxGlobal: 8,
          maxPerDomain: 4
        },
        crawler: {
          workerThreads: 4,
          queueMax: 2000
        },
        antiBotPolicy: {
          enabled: true,
          cooldownMs: 30000,
          maxChallengeRetries: 1,
          allowBrowserEscalation: false
        },
        transcript: {
          modeDefault: "auto",
          strategyOrder: ["native_caption_parse", "ytdlp_subtitle"],
          enableYtdlp: true,
          enableAsr: false,
          enableYtdlpAudioAsr: false,
          enableApify: false,
          apifyActorId: "streamers/youtube-scraper",
          enableBrowserFallback: true,
          ytdlpTimeoutMs: 12000
        },
        cookiePolicy: "auto",
        cookieSource: {
          type: "file",
          value: "~/.config/opencode/opendevbrowser.provider-cookies.json"
        }
      }
    });

    expect(runtimeInit).toMatchObject({
      transcript: {
        modeDefault: "auto",
        strategyOrder: ["native_caption_parse", "ytdlp_subtitle"],
        enableYtdlp: true,
        enableAsr: false,
        enableYtdlpAudioAsr: false,
        enableApify: false,
        apifyActorId: "streamers/youtube-scraper",
        enableBrowserFallback: true,
        ytdlpTimeoutMs: 12000
      },
      cookies: {
        policy: "auto",
        source: {
          type: "file",
          value: "~/.config/opencode/opendevbrowser.provider-cookies.json"
        }
      }
    });
  });

  it("maps cookie runtime init fields independently when only one knob is configured", () => {
    const cookiePolicyOnly = buildRuntimeInitFromConfig({
      blockerDetectionThreshold: 0.75,
      security: {
        allowRawCDP: false,
        allowNonLocalCdp: false,
        allowUnsafeExport: false,
        promptInjectionGuard: { enabled: true }
      },
      providers: {
        tiers: {
          default: "A",
          enableHybrid: false,
          enableRestrictedSafe: false,
          hybridRiskThreshold: 0.6,
          restrictedSafeRecoveryIntervalMs: 60000
        },
        adaptiveConcurrency: {
          enabled: false,
          maxGlobal: 8,
          maxPerDomain: 4
        },
        crawler: {
          workerThreads: 4,
          queueMax: 2000
        },
        antiBotPolicy: {
          enabled: true,
          cooldownMs: 30000,
          maxChallengeRetries: 1,
          allowBrowserEscalation: false
        },
        transcript: {
          modeDefault: "auto",
          strategyOrder: ["native_caption_parse"],
          enableYtdlp: false,
          enableAsr: false,
          enableYtdlpAudioAsr: false,
          enableApify: false,
          apifyActorId: "streamers/youtube-scraper",
          enableBrowserFallback: false,
          ytdlpTimeoutMs: 10000
        },
        cookiePolicy: "required"
      }
    });

    expect(cookiePolicyOnly).toMatchObject({
      cookies: {
        policy: "required"
      }
    });
    expect((cookiePolicyOnly.cookies as { source?: unknown } | undefined)?.source).toBeUndefined();

    const cookieSourceOnly = buildRuntimeInitFromConfig({
      blockerDetectionThreshold: 0.75,
      security: {
        allowRawCDP: false,
        allowNonLocalCdp: false,
        allowUnsafeExport: false,
        promptInjectionGuard: { enabled: true }
      },
      providers: {
        tiers: {
          default: "A",
          enableHybrid: false,
          enableRestrictedSafe: false,
          hybridRiskThreshold: 0.6,
          restrictedSafeRecoveryIntervalMs: 60000
        },
        adaptiveConcurrency: {
          enabled: false,
          maxGlobal: 8,
          maxPerDomain: 4
        },
        crawler: {
          workerThreads: 4,
          queueMax: 2000
        },
        antiBotPolicy: {
          enabled: true,
          cooldownMs: 30000,
          maxChallengeRetries: 1,
          allowBrowserEscalation: false
        },
        transcript: {
          modeDefault: "auto",
          strategyOrder: ["native_caption_parse"],
          enableYtdlp: false,
          enableAsr: false,
          enableYtdlpAudioAsr: false,
          enableApify: false,
          apifyActorId: "streamers/youtube-scraper",
          enableBrowserFallback: false,
          ytdlpTimeoutMs: 10000
        },
        cookieSource: {
          type: "env",
          value: "OPENDEVBROWSER_PROVIDER_COOKIES"
        }
      }
    });

    expect(cookieSourceOnly).toMatchObject({
      cookies: {
        source: {
          type: "env",
          value: "OPENDEVBROWSER_PROVIDER_COOKIES"
        }
      }
    });
    expect((cookieSourceOnly.cookies as { policy?: unknown } | undefined)?.policy).toBeUndefined();
  });

  it("creates a runtime with default provider set", () => {
    const runtime = createConfiguredProviderRuntime({
      config: {
        blockerDetectionThreshold: 0.7,
        security: {
          allowRawCDP: false,
          allowNonLocalCdp: false,
          allowUnsafeExport: false,
          promptInjectionGuard: { enabled: true }
        },
        providers: {
          tiers: {
            default: "A",
            enableHybrid: false,
            enableRestrictedSafe: false,
            hybridRiskThreshold: 0.6,
            restrictedSafeRecoveryIntervalMs: 60000
          },
          adaptiveConcurrency: {
            enabled: false,
            maxGlobal: 8,
            maxPerDomain: 4
          },
          crawler: {
            workerThreads: 4,
            queueMax: 2000
          },
          antiBotPolicy: {
            enabled: true,
            cooldownMs: 30000,
            maxChallengeRetries: 1,
            allowBrowserEscalation: false
          },
          transcript: {
            modeDefault: "auto",
            strategyOrder: ["native_caption_parse"],
            enableYtdlp: false,
            enableAsr: false,
            enableYtdlpAudioAsr: false,
            enableApify: false,
            apifyActorId: "streamers/youtube-scraper",
            enableBrowserFallback: false,
            ytdlpTimeoutMs: 10000
          },
          cookiePolicy: "auto",
          cookieSource: {
            type: "file",
            value: "~/.config/opencode/opendevbrowser.provider-cookies.json"
          }
        }
      }
    });

    const providerIds = runtime.listProviders().map((provider) => provider.id);
    expect(providerIds).toContain("web/default");
    expect(providerIds).toContain("social/youtube");
    expect(providerIds).toContain("shopping/amazon");
  });

  it("attaches the resolved challenge orchestrator to managers that expose the setter", () => {
    const setChallengeOrchestrator = vi.fn();
    const manager = {
      setChallengeOrchestrator
    } as unknown as BrowserManagerLike;
    const challengeOrchestrator = {
      orchestrate: vi.fn()
    };

    createConfiguredProviderRuntime({
      manager,
      challengeOrchestrator: challengeOrchestrator as never
    });

    expect(setChallengeOrchestrator).toHaveBeenCalledWith(challengeOrchestrator);
  });

  it("builds a challenge orchestrator from threaded challenge config when provided", () => {
    const setChallengeOrchestrator = vi.fn();
    const manager = {
      setChallengeOrchestrator
    } as unknown as BrowserManagerLike;
    const config = resolveConfig({});
    const challengeConfig = requireChallengeOrchestrationConfig(config);

    createConfiguredProviderRuntime({
      manager,
      challengeConfig
    });

    expect(setChallengeOrchestrator).toHaveBeenCalledTimes(1);
    expect(setChallengeOrchestrator.mock.calls[0]?.[0]).toBeDefined();
  });

  it("keeps desktop config out of browser runtime init", () => {
    const config = resolveConfig({
      desktop: {
        permissionLevel: "observe",
        commandTimeoutMs: 1500,
        auditArtifactsDir: ".opendevbrowser/desktop-runtime",
        accessibilityMaxDepth: 3,
        accessibilityMaxChildren: 30
      }
    });
    const challengeConfig = requireChallengeOrchestrationConfig(config);

    const runtimeInit = buildRuntimeInitFromConfig(config, undefined, challengeConfig);

    expect(runtimeInit).not.toHaveProperty("desktop");
    expect(runtimeInit.challengeAutomationModeDefault).toBe(
      challengeConfig.mode
    );
  });
});
