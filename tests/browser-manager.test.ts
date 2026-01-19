import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { resolveConfig } from "../src/config";

const resolveCachePaths = vi.fn();
const findChromeExecutable = vi.fn();
const downloadChromeForTesting = vi.fn();
const launchPersistentContext = vi.fn();
const connectOverCDP = vi.fn();
const captureDom = vi.fn().mockResolvedValue({ html: "<div>ok</div>", styles: { color: "red" } });
const rm = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("../src/cache/paths", () => ({ resolveCachePaths }));
vi.mock("../src/cache/chrome-locator", () => ({ findChromeExecutable }));
vi.mock("../src/cache/downloader", () => ({ downloadChromeForTesting }));
vi.mock("fs/promises", async () => {
  const actual = await vi.importActual<typeof import("fs/promises")>("fs/promises");
  return { ...actual, rm };
});
vi.mock("playwright-core", () => ({
  chromium: {
    launchPersistentContext,
    connectOverCDP
  }
}));
vi.mock("../src/export/dom-capture", () => ({ captureDom }));

let originalFetch: typeof globalThis.fetch | undefined;
let warnSpy: ReturnType<typeof vi.spyOn> | null = null;

type LegacyNode = { ref: string; role: string; name: string; tag: string; selector: string };

const createPage = (nodes: LegacyNode[]) => {
  let currentUrl = "about:blank";
  const emitter = new EventEmitter();
  const url = vi.fn(() => currentUrl);
  const locator = {
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    press: vi.fn().mockResolvedValue(undefined),
    selectOption: vi.fn().mockResolvedValue(undefined),
    waitFor: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn(async (fn: (el: { scrollBy: (x: number, y: number) => void }, delta: number) => unknown, delta: number) => {
      const element = { scrollBy: vi.fn() };
      return fn(element, delta);
    })
  };

  const axNodes = nodes.map((node, index) => ({
    nodeId: String(index + 1),
    role: { value: node.role },
    name: { value: node.name },
    backendDOMNodeId: 100 + index + 1
  }));
  let lastBackendNodeId = 0;
  const selectorByBackendId = new Map(axNodes.map((node, index) => [node.backendDOMNodeId, nodes[index]?.selector]));

  const page = Object.assign(emitter, {
    url,
    title: vi.fn().mockResolvedValue("Title"),
    goto: vi.fn(async (url: string) => {
      currentUrl = url;
      return { status: () => 200 };
    }),
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
    locator: vi.fn().mockReturnValue(locator),
    $eval: vi.fn(async (_selector: string, fn: (el: { outerHTML: string; innerText: string; textContent: string }) => unknown) => {
      return fn({ outerHTML: "<div>ok</div>", innerText: "text", textContent: "text" });
    }),
    evaluate: vi.fn().mockResolvedValue(nodes),
    screenshot: vi.fn(async () => Buffer.from("image")),
    mouse: { wheel: vi.fn().mockResolvedValue(undefined) },
    close: vi.fn().mockResolvedValue(undefined),
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter)
  });

  const cdpSession = {
    send: vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "Accessibility.getFullAXTree") {
        return { nodes: axNodes };
      }
      if (method === "DOM.resolveNode") {
        const backendNodeId = typeof params?.backendNodeId === "number" ? params.backendNodeId : 0;
        lastBackendNodeId = backendNodeId;
        return { object: { objectId: `obj-${backendNodeId}` } };
      }
      if (method === "Runtime.callFunctionOn") {
        const selector = selectorByBackendId.get(lastBackendNodeId) ?? `#node-${lastBackendNodeId}`;
        return { result: { value: selector } };
      }
      if (method === "Performance.getMetrics") {
        return { metrics: [{ name: "Nodes", value: 1 }] };
      }
      return {};
    }),
    detach: vi.fn(async () => undefined)
  };

  const setContext = (context: BrowserContextLike) => {
    (page as unknown as { context: () => BrowserContextLike }).context = () => context;
  };

  return { page, locator, cdpSession, setContext };
};

type PageLike = ReturnType<typeof createPage>["page"];
type BrowserLike = {
  wsEndpoint: () => string;
  contexts: () => BrowserContextLike[];
  newContext: () => Promise<BrowserContextLike>;
  close: () => Promise<void>;
};
type BrowserContextLike = {
  pages: () => PageLike[];
  newPage: () => Promise<PageLike>;
  newCDPSession: (page: PageLike) => Promise<{ send: (method: string, params?: Record<string, unknown>) => Promise<unknown>; detach: () => Promise<void> }>;
  browser: () => BrowserLike;
  close: () => Promise<void>;
};

const createBrowserBundle = (
  nodes: LegacyNode[],
  options?: { initialPages?: number; contextsEmpty?: boolean; wsEndpoint?: string }
) => {
  const initialPages = options?.initialPages ?? 1;
  const { page, locator, cdpSession, setContext } = createPage(nodes);
  const pages = initialPages === 0 ? [] : [page];
  let browser: BrowserLike;

  const context: BrowserContextLike = {
    pages: () => pages,
    newPage: vi.fn(async () => {
      const nextPage = createPage(nodes);
      nextPage.setContext(context);
      const next = nextPage.page;
      pages.push(next);
      return next;
    }),
    newCDPSession: vi.fn(async () => cdpSession),
    browser: () => browser,
    close: vi.fn().mockResolvedValue(undefined)
  };

  setContext(context);

  browser = {
    wsEndpoint: () => options?.wsEndpoint ?? "ws://browser",
    contexts: () => options?.contextsEmpty ? [] : [context],
    newContext: vi.fn().mockResolvedValue(context),
    close: vi.fn().mockResolvedValue(undefined)
  };

  return { browser, context, page, locator };
};

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), "odb-browser-"));
  resolveCachePaths.mockResolvedValue({
    root,
    projectRoot: join(root, "project"),
    profileDir: join(root, "profile"),
    chromeDir: join(root, "chrome")
  });
  originalFetch = globalThis.fetch;
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  rm.mockClear();
  captureDom.mockClear();
});

afterEach(() => {
  if (originalFetch) {
    globalThis.fetch = originalFetch;
  }
  warnSpy?.mockRestore();
  warnSpy = null;
});

describe("BrowserManager", () => {
  it("launches a session using system Chrome", async () => {
    const nodes = [
      { ref: "r1", role: "button", name: "OK", tag: "button", selector: "[data-odb-ref=\"r1\"]" }
    ];
    const { context, page } = createBrowserBundle(nodes);

    findChromeExecutable.mockResolvedValue("/bin/chrome");
    downloadChromeForTesting.mockResolvedValue({ executablePath: "/bin/chrome" });
    launchPersistentContext.mockResolvedValue(context);

    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));
    manager.updateConfig(resolveConfig({}));

    const result = await manager.launch({ profile: "default" });
    expect(result.mode).toBe("managed");
    expect(result.warnings).toEqual([]);

    await manager.snapshot(result.sessionId, "outline", 500);
    await manager.click(result.sessionId, "r1");

    page.title.mockRejectedValueOnce(new Error("boom"));
    const status = await manager.status(result.sessionId);
    expect(status.url).toBeDefined();
  });

  it("updates tracker options when config changes", async () => {
    const nodes = [
      { ref: "r1", role: "button", name: "OK", tag: "button", selector: "[data-odb-ref=\"r1\"]" }
    ];
    const { context } = createBrowserBundle(nodes);

    findChromeExecutable.mockResolvedValue("/bin/chrome");
    launchPersistentContext.mockResolvedValue(context);

    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));
    const result = await manager.launch({ profile: "default" });

    const sessions = (manager as unknown as { sessions: Map<string, { consoleTracker: { setOptions: (opts: unknown) => void }; networkTracker: { setOptions: (opts: unknown) => void } }> }).sessions;
    const managed = sessions.get(result.sessionId);
    if (!managed) throw new Error("Missing managed session");

    const consoleSpy = vi.spyOn(managed.consoleTracker, "setOptions");
    const networkSpy = vi.spyOn(managed.networkTracker, "setOptions");

    manager.updateConfig({
      ...resolveConfig({}),
      devtools: { showFullConsole: true, showFullUrls: true }
    });

    expect(consoleSpy).toHaveBeenCalledWith({ showFullConsole: true });
    expect(networkSpy).toHaveBeenCalledWith({ showFullUrls: true });
  });

  it("downloads Chrome when missing", async () => {
    const nodes = [
      { ref: "r1", role: "button", name: "OK", tag: "button", selector: "[data-odb-ref=\"r1\"]" }
    ];
    const { context } = createBrowserBundle(nodes);

    findChromeExecutable.mockResolvedValue(null);
    downloadChromeForTesting.mockResolvedValue({ executablePath: "/tmp/chrome" });
    launchPersistentContext.mockResolvedValue(context);

    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));

    const result = await manager.launch({ profile: "default" });
    expect(result.warnings.length).toBe(1);
  });

  it("throws when browser instance is unavailable", async () => {
    const nodes = [
      { ref: "r1", role: "button", name: "OK", tag: "button", selector: "[data-odb-ref=\"r1\"]" }
    ];
    const { context } = createBrowserBundle(nodes);

    (context as unknown as { browser: () => null }).browser = () => null;
    findChromeExecutable.mockResolvedValue("/bin/chrome");
    launchPersistentContext.mockResolvedValue(context);

    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));

    await expect(manager.launch({ profile: "default" })).rejects.toThrow("Browser instance unavailable");
  });

  it("launches startUrl with default profile", async () => {
    const nodes = [
      { ref: "r1", role: "button", name: "OK", tag: "button", selector: "[data-odb-ref=\"r1\"]" }
    ];
    const { context, page } = createBrowserBundle(nodes);

    findChromeExecutable.mockResolvedValue("/bin/chrome");
    downloadChromeForTesting.mockResolvedValue({ executablePath: "/bin/chrome" });
    launchPersistentContext.mockResolvedValue(context);

    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));

    await manager.launch({ startUrl: "https://example.com" });
    expect(page.goto).toHaveBeenCalledWith("https://example.com", expect.objectContaining({ waitUntil: "load" }));
  });

  it("skips startUrl when no active target exists", async () => {
    const nodes = [
      { ref: "r1", role: "button", name: "OK", tag: "button", selector: "[data-odb-ref=\"r1\"]" }
    ];
    const { context, page } = createBrowserBundle(nodes);

    findChromeExecutable.mockResolvedValue("/bin/chrome");
    launchPersistentContext.mockResolvedValue(context);

    const { TargetManager } = await import("../src/browser/target-manager");
    const targetSpy = vi.spyOn(TargetManager.prototype, "getActiveTargetId").mockReturnValue(null);

    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));

    const result = await manager.launch({ startUrl: "https://example.com" });
    expect(result.activeTargetId).toBeNull();
    expect(page.goto).not.toHaveBeenCalled();

    targetSpy.mockRestore();
  });

  it("handles missing executable path and empty wsEndpoint", async () => {
    const nodes = [
      { ref: "r1", role: "button", name: "OK", tag: "button", selector: "[data-odb-ref=\"r1\"]" }
    ];
    const { context } = createBrowserBundle(nodes, { wsEndpoint: "" });

    findChromeExecutable.mockResolvedValue(null);
    downloadChromeForTesting.mockResolvedValue({ executablePath: undefined as unknown as string });
    launchPersistentContext.mockResolvedValue(context);

    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));

    const result = await manager.launch({ profile: "default" });
    expect(launchPersistentContext).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ executablePath: undefined }));
    expect(result.wsEndpoint).toBeUndefined();
  });

  it("returns undefined wsEndpoint when browser lacks wsEndpoint provider", async () => {
    const nodes = [
      { ref: "r1", role: "button", name: "OK", tag: "button", selector: "[data-odb-ref=\"r1\"]" }
    ];
    const { context, browser } = createBrowserBundle(nodes);

    delete (browser as { wsEndpoint?: () => string }).wsEndpoint;

    findChromeExecutable.mockResolvedValue("/bin/chrome");
    downloadChromeForTesting.mockResolvedValue({ executablePath: "/bin/chrome" });
    launchPersistentContext.mockResolvedValue(context);

    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));

    const result = await manager.launch({ profile: "default" });
    expect(result.wsEndpoint).toBeUndefined();
  });

  it("connects via wsEndpoint lookup", async () => {
    const nodes = [
      { ref: "r1", role: "button", name: "OK", tag: "button", selector: "[data-odb-ref=\"r1\"]" }
    ];
    const { browser } = createBrowserBundle(nodes);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser" })
    }) as never;

    connectOverCDP.mockResolvedValue(browser);

    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));

    const result = await manager.connect({ host: "127.0.0.1", port: 9222 });
    expect(result.mode).toBe("cdpConnect");
  });

  it("connects via relay endpoint", async () => {
    const nodes = [
      { ref: "r1", role: "button", name: "OK", tag: "button", selector: "[data-odb-ref=\"r1\"]" }
    ];
    const { browser } = createBrowserBundle(nodes);

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ relayPort: 8787, pairingRequired: true, instanceId: "relay-1" })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: "secret-token", instanceId: "relay-1" })
      }) as never;

    connectOverCDP.mockResolvedValue(browser);

    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));

    const result = await manager.connectRelay("ws://127.0.0.1:8787/cdp");
    expect(result.mode).toBe("extension");
    expect(connectOverCDP).toHaveBeenCalledWith("ws://127.0.0.1:8787/cdp?token=secret-token");
    expect(result.wsEndpoint).toBe("ws://127.0.0.1:8787/cdp");
  });

  it("ignores token query params on relay endpoints", async () => {
    const nodes = [
      { ref: "r1", role: "button", name: "OK", tag: "button", selector: "[data-odb-ref=\"r1\"]" }
    ];
    const { browser } = createBrowserBundle(nodes);

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ relayPort: 8787, pairingRequired: true, instanceId: "relay-1" })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: "pair-token", instanceId: "relay-1" })
      }) as never;

    connectOverCDP.mockResolvedValue(browser);

    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));

    const result = await manager.connectRelay("ws://127.0.0.1:8787/cdp?token=user-token");
    expect(connectOverCDP).toHaveBeenCalledWith("ws://127.0.0.1:8787/cdp?token=pair-token");
    expect(result.wsEndpoint).toBe("ws://127.0.0.1:8787/cdp");
  });

  it("connects via relay endpoint without pairing", async () => {
    const nodes = [
      { ref: "r1", role: "button", name: "OK", tag: "button", selector: "[data-odb-ref=\"r1\"]" }
    ];
    const { browser } = createBrowserBundle(nodes);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ relayPort: 8787, pairingRequired: false })
    }) as never;

    connectOverCDP.mockResolvedValue(browser);

    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));

    const result = await manager.connectRelay("ws://127.0.0.1:8787/cdp");
    expect(result.mode).toBe("extension");
    expect(connectOverCDP).toHaveBeenCalledWith("ws://127.0.0.1:8787/cdp");
    expect(result.wsEndpoint).toBe("ws://127.0.0.1:8787/cdp");
  });

  it("waits for an existing page when connecting via relay with no pages", async () => {
    const nodes = [
      { ref: "r1", role: "button", name: "OK", tag: "button", selector: "[data-odb-ref=\"r1\"]" }
    ];
    const { browser, context, page } = createBrowserBundle(nodes, { initialPages: 0 });
    context.waitForEvent = vi.fn().mockResolvedValue(page);

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ relayPort: 8787, pairingRequired: true, instanceId: "relay-1" })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: "secret-token", instanceId: "relay-1" })
      }) as never;

    connectOverCDP.mockResolvedValue(browser);

    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));

    const result = await manager.connectRelay("ws://127.0.0.1:8787/cdp");
    expect(result.mode).toBe("extension");
    expect(context.waitForEvent).toHaveBeenCalled();
    expect(context.newPage).not.toHaveBeenCalled();
  });

  it("throws when relay connects with no context in extension mode", async () => {
    const nodes = [
      { ref: "r1", role: "button", name: "OK", tag: "button", selector: "[data-odb-ref=\"r1\"]" }
    ];
    const { browser } = createBrowserBundle(nodes, { contextsEmpty: true });

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ relayPort: 8787, pairingRequired: false })
      }) as never;

    connectOverCDP.mockResolvedValue(browser);

    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));

    await expect(manager.connectRelay("ws://127.0.0.1:8787/cdp"))
      .rejects.toThrow("Extension relay did not expose a browser context");
  });

  it("throws when relay connects without any detectable page", async () => {
    const nodes = [
      { ref: "r1", role: "button", name: "OK", tag: "button", selector: "[data-odb-ref=\"r1\"]" }
    ];
    const { browser, context } = createBrowserBundle(nodes, { initialPages: 0 });
    context.waitForEvent = vi.fn().mockRejectedValue(new Error("timeout"));

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ relayPort: 8787, pairingRequired: false })
      }) as never;

    connectOverCDP.mockResolvedValue(browser);

    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));

    await expect(manager.connectRelay("ws://127.0.0.1:8787/cdp"))
      .rejects.toThrow("Extension relay connected but no page was detected");
  });

  it("throws when relay config fetch fails", async () => {
    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));

    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false }) as never;

    await expect(manager.connectRelay("ws://127.0.0.1:8787/cdp"))
      .rejects.toThrow("Failed to fetch relay config");
  });

  it("throws when relay config is missing relayPort", async () => {
    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ pairingRequired: true })
    }) as never;

    await expect(manager.connectRelay("ws://127.0.0.1:8787/cdp"))
      .rejects.toThrow("Relay config missing relayPort");
  });

  it("throws when relay pairing fetch fails", async () => {
    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ relayPort: 8787, pairingRequired: true })
      })
      .mockResolvedValueOnce({ ok: false }) as never;

    await expect(manager.connectRelay("ws://127.0.0.1:8787/cdp"))
      .rejects.toThrow("Failed to fetch relay pairing token");
  });

  it("throws when pairing token is missing from /pair", async () => {
    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ relayPort: 8787, pairingRequired: true, instanceId: "relay-1" })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ instanceId: "relay-1" })
      }) as never;

    await expect(manager.connectRelay("ws://127.0.0.1:8787/cdp"))
      .rejects.toThrow("Relay pairing token missing");
  });

  it("throws on relay pairing instance mismatch", async () => {
    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ relayPort: 8787, pairingRequired: true, instanceId: "relay-1" })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: "secret", instanceId: "relay-2" })
      }) as never;

    await expect(manager.connectRelay("ws://127.0.0.1:8787/cdp"))
      .rejects.toThrow("Relay pairing mismatch");
  });

  it("returns input for invalid relay endpoint sanitize fallback", async () => {
    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));

    const result = (manager as unknown as { sanitizeWsEndpointForOutput: (value: string) => string })
      .sanitizeWsEndpointForOutput("not-a-valid-url");
    expect(result).toBe("not-a-valid-url");
  });

  it("maps unauthorized relay errors to a stable message", async () => {
    const nodes = [
      { ref: "r1", role: "button", name: "OK", tag: "button", selector: "[data-odb-ref=\"r1\"]" }
    ];
    createBrowserBundle(nodes);

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ relayPort: 8787, pairingRequired: true, instanceId: "relay-1" })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: "secret", instanceId: "relay-1" })
      }) as never;

    connectOverCDP.mockRejectedValue(new Error("Unexpected server response: 401"));

    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));

    await expect(manager.connectRelay("ws://127.0.0.1:8787/cdp"))
      .rejects.toThrow("Relay /cdp rejected the connection (unauthorized)");
  });

  it("propagates non-401 relay connection errors", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ relayPort: 8787, pairingRequired: false })
    }) as never;

    connectOverCDP.mockRejectedValueOnce(new Error("Unexpected server response: 500"));

    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));

    await expect(manager.connectRelay("ws://127.0.0.1:8787/cdp"))
      .rejects.toThrow("Unexpected server response: 500");
  });

  it("connects using default host and port", async () => {
    const nodes = [
      { ref: "r1", role: "button", name: "OK", tag: "button", selector: "[data-odb-ref=\"r1\"]" }
    ];
    const { browser } = createBrowserBundle(nodes);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser" })
    }) as never;

    connectOverCDP.mockResolvedValue(browser);

    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));

    await manager.connect({});
    const call = (globalThis.fetch as unknown as { mock: { calls: Array<[string]> } }).mock.calls[0][0];
    expect(call).toContain("http://127.0.0.1:9222/json/version");
  });

  it("fails when wsEndpoint lookup returns no websocket", async () => {
    const nodes = [
      { ref: "r1", role: "button", name: "OK", tag: "button", selector: "[data-odb-ref=\"r1\"]" }
    ];
    const { browser } = createBrowserBundle(nodes);
    connectOverCDP.mockResolvedValue(browser);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({})
    }) as never;

    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));

    await expect(manager.connect({ host: "127.0.0.1", port: 9222 }))
      .rejects
      .toThrow("webSocketDebuggerUrl");
  });

  it("fails when wsEndpoint lookup response is not ok", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false }) as never;
    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));

    await expect(manager.connect({ host: "127.0.0.1", port: 9222 }))
      .rejects
      .toThrow("Failed to fetch CDP endpoint");
  });

  it("fails when wsEndpoint lookup fetch throws", async () => {
    globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error("network down")) as never;
    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));

    await expect(manager.connect({ host: "127.0.0.1", port: 9222 }))
      .rejects
      .toThrow("network down");
  });

  it("rejects non-local endpoints by default", async () => {
    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));

    await expect(manager.connect({ wsEndpoint: "ws://example.com" }))
      .rejects
      .toThrow("Non-local CDP endpoints");
  });

  it("rejects bypass attempts via crafted hostnames", async () => {
    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));

    await expect(manager.connect({ wsEndpoint: "ws://127.0.0.1.evil.com/cdp" }))
      .rejects
      .toThrow("Non-local CDP endpoints");

    await expect(manager.connect({ wsEndpoint: "ws://localhost.evil.com/cdp" }))
      .rejects
      .toThrow("Non-local CDP endpoints");

    await expect(manager.connect({ wsEndpoint: "ws://evil.com?host=127.0.0.1" }))
      .rejects
      .toThrow("Non-local CDP endpoints");
  });

  it("rejects invalid CDP endpoint URLs", async () => {
    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));

    await expect(manager.connect({ wsEndpoint: "not-a-valid-url" }))
      .rejects
      .toThrow("Invalid CDP endpoint URL");
  });

  it("rejects disallowed protocol endpoints", async () => {
    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));

    await expect(manager.connect({ wsEndpoint: "ftp://127.0.0.1:9222/devtools/browser" }))
      .rejects
      .toThrow("Disallowed protocol \"ftp:\"");
  });

  it("normalizes hostname case for localhost validation", async () => {
    const nodes = [
      { ref: "r1", role: "button", name: "OK", tag: "button", selector: "[data-odb-ref=\"r1\"]" }
    ];
    const { browser } = createBrowserBundle(nodes);
    connectOverCDP.mockResolvedValue(browser);

    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));

    await manager.connect({ wsEndpoint: "ws://LOCALHOST:9222/cdp" });
    expect(connectOverCDP).toHaveBeenCalled();

    connectOverCDP.mockClear();
    await manager.connect({ wsEndpoint: "ws://LocalHost:9222/cdp" });
    expect(connectOverCDP).toHaveBeenCalled();
  });

  it("re-validates webSocketDebuggerUrl from /json/version", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ webSocketDebuggerUrl: "ws://evil.com:9222/cdp" })
    }) as never;

    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));

    await expect(manager.connect({ host: "127.0.0.1", port: 9222 }))
      .rejects
      .toThrow("Non-local CDP endpoints");
  });

  it("accepts IPv6 loopback endpoints", async () => {
    const nodes = [
      { ref: "r1", role: "button", name: "OK", tag: "button", selector: "[data-odb-ref=\"r1\"]" }
    ];
    const { browser } = createBrowserBundle(nodes);
    connectOverCDP.mockResolvedValue(browser);

    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));

    await manager.connect({ wsEndpoint: "ws://[::1]:9222/cdp" });
    expect(connectOverCDP).toHaveBeenCalled();
  });

  it("allows non-local endpoints when configured", async () => {
    const nodes = [
      { ref: "r1", role: "button", name: "OK", tag: "button", selector: "[data-odb-ref=\"r1\"]" }
    ];
    const { browser } = createBrowserBundle(nodes);
    connectOverCDP.mockResolvedValue(browser);

    const config = { ...resolveConfig({}), security: { allowRawCDP: false, allowNonLocalCdp: true, allowUnsafeExport: false } };
    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", config);

    await manager.connect({ wsEndpoint: "ws://example.com" });
    expect(connectOverCDP).toHaveBeenCalled();
  });

  it("handles dom extraction and scroll", async () => {
    const nodes = [
      { ref: "r1", role: "button", name: "OK", tag: "button", selector: "[data-odb-ref=\"r1\"]" }
    ];
    const { context } = createBrowserBundle(nodes);

    findChromeExecutable.mockResolvedValue("/bin/chrome");
    downloadChromeForTesting.mockResolvedValue({ executablePath: "/bin/chrome" });
    launchPersistentContext.mockResolvedValue(context);

    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));

    const result = await manager.launch({ profile: "default", persistProfile: false });
    await manager.snapshot(result.sessionId, "outline", 500);

    const html = await manager.domGetHtml(result.sessionId, "r1", 4);
    expect(html.truncated).toBe(true);

    const text = await manager.domGetText(result.sessionId, "r1", 2);
    expect(text.truncated).toBe(true);

    const fullHtml = await manager.domGetHtml(result.sessionId, "r1", 1000);
    expect(fullHtml.truncated).toBe(false);

    const fullText = await manager.domGetText(result.sessionId, "r1", 1000);
    expect(fullText.truncated).toBe(false);

    await manager.scroll(result.sessionId, 100);
    await manager.scroll(result.sessionId, 100, "r1");
    const consolePoll = await manager.consolePoll(result.sessionId);
    expect(consolePoll.events).toEqual([]);
    const networkPoll = await manager.networkPoll(result.sessionId);
    expect(networkPoll.events).toEqual([]);

    await manager.disconnect(result.sessionId, false);
  });

  it("passes retry options when cleaning up temp profiles", async () => {
    const nodes = [
      { ref: "r1", role: "button", name: "OK", tag: "button", selector: "[data-odb-ref=\"r1\"]" }
    ];
    const { context } = createBrowserBundle(nodes);

    findChromeExecutable.mockResolvedValue("/bin/chrome");
    downloadChromeForTesting.mockResolvedValue({ executablePath: "/bin/chrome" });
    launchPersistentContext.mockResolvedValue(context);

    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));

    const result = await manager.launch({ profile: "default", persistProfile: false });
    await manager.disconnect(result.sessionId, false);

    expect(rm).toHaveBeenCalledWith(expect.any(String), {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100
    });
  });

  it("manages targets and wait helpers", async () => {
    const nodes = [
      { ref: "r1", role: "button", name: "OK", tag: "button", selector: "[data-odb-ref=\"r1\"]" }
    ];
    const { context } = createBrowserBundle(nodes);

    findChromeExecutable.mockResolvedValue("/bin/chrome");
    downloadChromeForTesting.mockResolvedValue({ executablePath: "/bin/chrome" });
    launchPersistentContext.mockResolvedValue(context);

    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));

    const result = await manager.launch({ profile: "default" });
    await manager.snapshot(result.sessionId, "outline", 500);

    const list = await manager.listTargets(result.sessionId, true);
    expect(list.targets.length).toBeGreaterThan(0);
    const originalTarget = list.activeTargetId;

    const created = await manager.newTarget(result.sessionId, "https://example.com");
    expect(created.targetId).toBeTruthy();

    if (originalTarget) {
      await manager.useTarget(result.sessionId, originalTarget);
    }
    await manager.waitForLoad(result.sessionId, "load");
    await manager.waitForRef(result.sessionId, "r1", "attached");
    await manager.goto(result.sessionId, "https://example.com");

    await manager.closeTarget(result.sessionId, created.targetId);
  });

  it("creates a page when none exist", async () => {
    const nodes = [
      { ref: "r1", role: "button", name: "OK", tag: "button", selector: "[data-odb-ref=\"r1\"]" }
    ];
    const { context } = createBrowserBundle(nodes, { initialPages: 0 });

    findChromeExecutable.mockResolvedValue("/bin/chrome");
    downloadChromeForTesting.mockResolvedValue({ executablePath: "/bin/chrome" });
    launchPersistentContext.mockResolvedValue(context);

    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));

    await manager.launch({ profile: "default" });
    expect(context.newPage).toHaveBeenCalled();
  });

  it("creates a page when connecting to an empty context", async () => {
    const nodes = [
      { ref: "r1", role: "button", name: "OK", tag: "button", selector: "[data-odb-ref=\"r1\"]" }
    ];
    const { browser, context } = createBrowserBundle(nodes, { initialPages: 0 });
    connectOverCDP.mockResolvedValue(browser);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser" })
    }) as never;

    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));
    await manager.connect({ host: "127.0.0.1", port: 9222 });
    expect(context.newPage).toHaveBeenCalled();
  });

  it("uses newContext when connecting without contexts", async () => {
    const nodes = [
      { ref: "r1", role: "button", name: "OK", tag: "button", selector: "[data-odb-ref=\"r1\"]" }
    ];
    const { browser } = createBrowserBundle(nodes, { contextsEmpty: true });
    connectOverCDP.mockResolvedValue(browser);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser" })
    }) as never;

    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));
    await manager.connect({ host: "127.0.0.1", port: 9222 });
    expect(browser.newContext).toHaveBeenCalled();
  });

  it("handles closeBrowser disconnect", async () => {
    const nodes = [
      { ref: "r1", role: "button", name: "OK", tag: "button", selector: "[data-odb-ref=\"r1\"]" }
    ];
    const { context, browser } = createBrowserBundle(nodes);

    findChromeExecutable.mockResolvedValue("/bin/chrome");
    launchPersistentContext.mockResolvedValue(context);

    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));
    const result = await manager.launch({ profile: "default" });

    await manager.disconnect(result.sessionId, true);
    expect(browser.close).toHaveBeenCalled();
  });

  it("cleans up session state when disconnect throws", async () => {
    const nodes = [
      { ref: "r1", role: "button", name: "OK", tag: "button", selector: "[data-odb-ref=\"r1\"]" }
    ];
    const { context } = createBrowserBundle(nodes);

    findChromeExecutable.mockResolvedValue("/bin/chrome");
    launchPersistentContext.mockResolvedValue(context);

    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));
    const result = await manager.launch({ profile: "default" });

    vi.spyOn(context, "close").mockRejectedValue(new Error("close fail"));

    await expect(manager.disconnect(result.sessionId, false)).rejects.toThrow("close fail");

    const sessions = (manager as unknown as { sessions: Map<string, unknown> }).sessions;
    expect(sessions.has(result.sessionId)).toBe(false);
  });

  it("aggregates disconnect cleanup errors", async () => {
    const nodes = [
      { ref: "r1", role: "button", name: "OK", tag: "button", selector: "[data-odb-ref=\"r1\"]" }
    ];
    const { context } = createBrowserBundle(nodes);

    findChromeExecutable.mockResolvedValue("/bin/chrome");
    launchPersistentContext.mockResolvedValue(context);

    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));
    const result = await manager.launch({ profile: "default", persistProfile: false });

    vi.spyOn(context, "close").mockRejectedValue(new Error("close fail"));
    rm.mockRejectedValueOnce(new Error("rm fail"));

    await expect(manager.disconnect(result.sessionId, false))
      .rejects
      .toThrow("Failed to disconnect browser session.");
  });

  it("rejects unknown refs and snapshots with no target", async () => {
    const nodes = [
      { ref: "r1", role: "button", name: "OK", tag: "button", selector: "[data-odb-ref=\"r1\"]" }
    ];
    const { context } = createBrowserBundle(nodes);

    findChromeExecutable.mockResolvedValue("/bin/chrome");
    launchPersistentContext.mockResolvedValue(context);

    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));
    const result = await manager.launch({ profile: "default" });

    await expect(manager.click(result.sessionId, "missing")).rejects.toThrow("Unknown ref");
    await manager.closeTarget(result.sessionId, result.activeTargetId as string);
    await expect(manager.snapshot(result.sessionId, "outline", 100)).rejects.toThrow("No active target");
  });

  it("clears refs on navigation", async () => {
    const nodes = [
      { ref: "r1", role: "button", name: "OK", tag: "button", selector: "[data-odb-ref=\"r1\"]" }
    ];
    const { context, page } = createBrowserBundle(nodes);

    findChromeExecutable.mockResolvedValue("/bin/chrome");
    launchPersistentContext.mockResolvedValue(context);

    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));
    const result = await manager.launch({ profile: "default" });

    await manager.snapshot(result.sessionId, "outline", 500);
    (page as unknown as { emit: (event: string, frame: { parentFrame: () => unknown }) => void }).emit(
      "framenavigated",
      { parentFrame: () => null }
    );

    await expect(manager.click(result.sessionId, "r1")).rejects.toThrow("Unknown ref");
  });

  it("clears refs on page close", async () => {
    const nodes = [
      { ref: "r1", role: "button", name: "OK", tag: "button", selector: "[data-odb-ref=\"r1\"]" }
    ];
    const { context, page } = createBrowserBundle(nodes);

    findChromeExecutable.mockResolvedValue("/bin/chrome");
    launchPersistentContext.mockResolvedValue(context);

    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));
    const result = await manager.launch({ profile: "default" });

    await manager.snapshot(result.sessionId, "outline", 500);
    (page as unknown as { emit: (event: string) => void }).emit("close");

    await expect(manager.click(result.sessionId, "r1")).rejects.toThrow("Unknown ref");
  });

  it("returns undefined status when no active target", async () => {
    const nodes = [
      { ref: "r1", role: "button", name: "OK", tag: "button", selector: "[data-odb-ref=\"r1\"]" }
    ];
    const { context } = createBrowserBundle(nodes);

    findChromeExecutable.mockResolvedValue("/bin/chrome");
    launchPersistentContext.mockResolvedValue(context);

    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));
    const result = await manager.launch({ profile: "default" });

    await manager.closeTarget(result.sessionId, result.activeTargetId as string);
    const status = await manager.status(result.sessionId);
    expect(status.activeTargetId).toBeNull();
    expect(status.url).toBeUndefined();
    expect(status.title).toBeUndefined();
  });

  it("handles url failures in status", async () => {
    const nodes = [
      { ref: "r1", role: "button", name: "OK", tag: "button", selector: "[data-odb-ref=\"r1\"]" }
    ];
    const { context, page } = createBrowserBundle(nodes);
    page.url.mockImplementationOnce(() => {
      throw new Error("url fail");
    });

    findChromeExecutable.mockResolvedValue("/bin/chrome");
    launchPersistentContext.mockResolvedValue(context);

    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));
    const result = await manager.launch({ profile: "default" });

    const status = await manager.status(result.sessionId);
    expect(status.url).toBeUndefined();
  });

  it("rejects ref resolution without an active target", async () => {
    const nodes = [
      { ref: "r1", role: "button", name: "OK", tag: "button", selector: "[data-odb-ref=\"r1\"]" }
    ];
    const { context } = createBrowserBundle(nodes);

    findChromeExecutable.mockResolvedValue("/bin/chrome");
    launchPersistentContext.mockResolvedValue(context);

    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));
    const result = await manager.launch({ profile: "default" });

    await manager.closeTarget(result.sessionId, result.activeTargetId as string);
    await expect(manager.click(result.sessionId, "r1")).rejects.toThrow("No active target");
  });

  it("throws on unknown session ids", async () => {
    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));
    await expect(manager.status("missing")).rejects.toThrow("Unknown sessionId");
  });

  it("uses textContent and empty fallbacks for domGetText", async () => {
    const nodes = [
      { ref: "r1", role: "button", name: "OK", tag: "button", selector: "[data-odb-ref=\"r1\"]" }
    ];
    const { context, page } = createBrowserBundle(nodes);

    findChromeExecutable.mockResolvedValue("/bin/chrome");
    launchPersistentContext.mockResolvedValue(context);

    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));
    const result = await manager.launch({ profile: "default" });
    await manager.snapshot(result.sessionId, "outline", 500);

    page.$eval
      .mockImplementationOnce(async (_selector: string, fn: (el: { outerHTML: string; innerText: string; textContent: string }) => unknown) => {
        return fn({ outerHTML: "<div>ok</div>", innerText: "", textContent: "from textContent" });
      })
      .mockImplementationOnce(async (_selector: string, fn: (el: { outerHTML: string; innerText: string; textContent: string }) => unknown) => {
        return fn({ outerHTML: "<div>ok</div>", innerText: "", textContent: "" });
      });

    const textContent = await manager.domGetText(result.sessionId, "r1", 1000);
    expect(textContent.text).toBe("from textContent");

    const empty = await manager.domGetText(result.sessionId, "r1", 1000);
    expect(empty.text).toBe("");
  });

  it("handles title failures in useTarget", async () => {
    const nodes = [
      { ref: "r1", role: "button", name: "OK", tag: "button", selector: "[data-odb-ref=\"r1\"]" }
    ];
    const { context, page } = createBrowserBundle(nodes);
    page.title.mockRejectedValueOnce(new Error("title fail"));

    findChromeExecutable.mockResolvedValue("/bin/chrome");
    launchPersistentContext.mockResolvedValue(context);

    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));
    const result = await manager.launch({ profile: "default" });

    const active = result.activeTargetId as string;
    const used = await manager.useTarget(result.sessionId, active);
    expect(used.title).toBeUndefined();
  });

  it("manages named pages", async () => {
    const nodes = [
      { ref: "r1", role: "button", name: "OK", tag: "button", selector: "[data-odb-ref=\"r1\"]" }
    ];
    const { context } = createBrowserBundle(nodes);

    findChromeExecutable.mockResolvedValue("/bin/chrome");
    launchPersistentContext.mockResolvedValue(context);

    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));
    const launch = await manager.launch({ profile: "default" });

    const created = await manager.page(launch.sessionId, "main", "https://example.com");
    expect(created.created).toBe(true);

    const existing = await manager.page(launch.sessionId, "main");
    expect(existing.created).toBe(false);

    const list = await manager.listPages(launch.sessionId);
    expect(list.pages[0]?.name).toBe("main");

    await manager.closePage(launch.sessionId, "main");
    const empty = await manager.listPages(launch.sessionId);
    expect(empty.pages.length).toBe(0);
  });

  it("rejects closing unknown page names", async () => {
    const nodes = [
      { ref: "r1", role: "button", name: "OK", tag: "button", selector: "[data-odb-ref=\"r1\"]" }
    ];
    const { context } = createBrowserBundle(nodes);

    findChromeExecutable.mockResolvedValue("/bin/chrome");
    launchPersistentContext.mockResolvedValue(context);

    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));
    const launch = await manager.launch({ profile: "default" });

    await expect(manager.closePage(launch.sessionId, "missing")).rejects.toThrow("Unknown page name");
  });

  it("types with clear/submit and selects options", async () => {
    const nodes = [
      { ref: "r1", role: "button", name: "OK", tag: "button", selector: "[data-odb-ref=\"r1\"]" }
    ];
    const { context, locator } = createBrowserBundle(nodes);

    findChromeExecutable.mockResolvedValue("/bin/chrome");
    launchPersistentContext.mockResolvedValue(context);

    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));
    const launch = await manager.launch({ profile: "default" });

    await manager.snapshot(launch.sessionId, "outline", 500);
    await manager.type(launch.sessionId, "r1", "hello", true, true);
    expect(locator.fill).toHaveBeenNthCalledWith(1, "");
    expect(locator.fill).toHaveBeenNthCalledWith(2, "hello");
    expect(locator.press).toHaveBeenCalledWith("Enter");

    await manager.select(launch.sessionId, "r1", ["one"]);
    expect(locator.selectOption).toHaveBeenCalledWith(["one"]);
  });

  it("exports clones and collects perf metrics", async () => {
    const nodes = [
      { ref: "r1", role: "button", name: "OK", tag: "button", selector: "[data-odb-ref=\"r1\"]" }
    ];
    const { context, page } = createBrowserBundle(nodes);

    findChromeExecutable.mockResolvedValue("/bin/chrome");
    launchPersistentContext.mockResolvedValue(context);

    const { BrowserManager } = await import("../src/browser/browser-manager");
    const baseConfig = resolveConfig({});
    const manager = new BrowserManager("/tmp/project", {
      ...baseConfig,
      export: { ...baseConfig.export, maxNodes: 10, inlineStyles: false }
    });
    const launch = await manager.launch({ profile: "default" });

    const clonePage = await manager.clonePage(launch.sessionId);
    expect(clonePage.component).toContain("OpenDevBrowserComponent");
    expect(clonePage.css).toContain(".opendevbrowser-root");
    expect(captureDom).toHaveBeenNthCalledWith(
      1,
      page,
      "body",
      expect.objectContaining({ sanitize: true, maxNodes: 10, inlineStyles: false })
    );

    await manager.snapshot(launch.sessionId, "outline", 500);
    const cloneComponent = await manager.cloneComponent(launch.sessionId, "r1");
    expect(cloneComponent.component).toContain("OpenDevBrowserComponent");
    expect(captureDom).toHaveBeenNthCalledWith(
      2,
      page,
      expect.any(String),
      expect.objectContaining({ sanitize: true, maxNodes: 10, inlineStyles: false })
    );

    const perf = await manager.perfMetrics(launch.sessionId);
    expect(perf.metrics[0]?.name).toBe("Nodes");

    const shot = await manager.screenshot(launch.sessionId);
    expect(shot.base64).toBe(Buffer.from("image").toString("base64"));

    await manager.screenshot(launch.sessionId, "/tmp/example.png");
    expect(page.screenshot).toHaveBeenCalledWith(expect.objectContaining({ path: "/tmp/example.png" }));
  });

  it("returns empty perf metrics when CDP response lacks metrics", async () => {
    const nodes = [
      { ref: "r1", role: "button", name: "OK", tag: "button", selector: "[data-odb-ref=\"r1\"]" }
    ];
    const { context } = createBrowserBundle(nodes);
    context.newCDPSession = vi.fn(async () => ({
      send: vi.fn(async (method: string) => (method === "Performance.getMetrics" ? {} : {})),
      detach: vi.fn(async () => undefined)
    }));

    findChromeExecutable.mockResolvedValue("/bin/chrome");
    launchPersistentContext.mockResolvedValue(context);

    const { BrowserManager } = await import("../src/browser/browser-manager");
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));
    const launch = await manager.launch({ profile: "default" });

    const perf = await manager.perfMetrics(launch.sessionId);
    expect(perf.metrics).toEqual([]);
  });
});
