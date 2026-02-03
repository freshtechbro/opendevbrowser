import { describe, it, expect, vi, afterEach } from "vitest";
import type { OpenDevBrowserConfig } from "../src/config";
import { OpsBrowserManager } from "../src/browser/ops-browser-manager";

vi.mock("fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined)
}));

const requestMock = vi.fn();
const connectMock = vi.fn().mockResolvedValue({
  type: "ops_hello_ack",
  version: "1",
  clientId: "client-1",
  maxPayloadBytes: 1024,
  capabilities: []
});
const disconnectMock = vi.fn();

vi.mock("../src/browser/ops-client", () => ({
  OpsClient: class {
    url: string;
    private handlers: { onEvent?: (event: { event?: string; opsSessionId?: string }) => void; onClose?: () => void };
    constructor(url: string, handlers: { onEvent?: (event: { event?: string; opsSessionId?: string }) => void; onClose?: () => void }) {
      this.url = url;
      this.handlers = handlers;
    }
    async connect() {
      return await connectMock();
    }
    async request(...args: unknown[]) {
      return await requestMock(...args);
    }
    disconnect() {
      disconnectMock();
    }
    emitEvent(event: { event?: string; opsSessionId?: string }) {
      this.handlers.onEvent?.(event);
    }
    emitClose() {
      this.handlers.onClose?.();
    }
  }
}));

const makeConfig = (): OpenDevBrowserConfig => ({
  headless: false,
  profile: "default",
  snapshot: { maxChars: 16000, maxNodes: 1000 },
  security: { allowRawCDP: false, allowNonLocalCdp: false, allowUnsafeExport: false },
  devtools: { showFullUrls: false, showFullConsole: false },
  export: { maxNodes: 1000, inlineStyles: true },
  skills: { nudge: { enabled: true, keywords: [], maxAgeMs: 60000 } },
  continuity: { enabled: true, filePath: "/tmp/continuity.md", nudge: { enabled: true, keywords: [], maxAgeMs: 60000 } },
  relayPort: 8787,
  relayToken: false,
  daemonPort: 8788,
  daemonToken: "daemon-token",
  chromePath: undefined,
  flags: [],
  checkForUpdates: false,
  persistProfile: true,
  skillPaths: []
});

describe("OpsBrowserManager", () => {
  afterEach(() => {
    requestMock.mockReset();
    connectMock.mockClear();
    disconnectMock.mockClear();
    vi.unstubAllGlobals();
  });

  it("delegates /cdp relay endpoints to base manager", async () => {
    const base = {
      connect: vi.fn().mockResolvedValue({
        sessionId: "base-session",
        mode: "cdpConnect",
        activeTargetId: null,
        warnings: [],
        wsEndpoint: "ws://127.0.0.1:9222/devtools/browser/test"
      }),
      connectRelay: vi.fn().mockResolvedValue({
        sessionId: "base-session",
        mode: "extension",
        activeTargetId: null,
        warnings: [],
        wsEndpoint: "ws://127.0.0.1:8787/cdp"
      }),
      listPages: vi.fn().mockResolvedValue({ pages: [] }),
      closePage: vi.fn().mockResolvedValue(undefined),
      withPage: vi.fn().mockResolvedValue("ok")
    };
    const manager = new OpsBrowserManager(base as never, makeConfig());

    const connectResult = await manager.connect({ wsEndpoint: "ws://127.0.0.1:9222/devtools/browser/test" } as never);
    expect(connectResult.sessionId).toBe("base-session");

    const result = await manager.connectRelay("ws://127.0.0.1:8787/cdp");
    expect(result.sessionId).toBe("base-session");
    expect(base.connectRelay).toHaveBeenCalledWith("ws://127.0.0.1:8787/cdp");

    await manager.listPages("base-session");
    expect(base.listPages).toHaveBeenCalled();
    await manager.closePage("base-session", "main");
    expect(base.closePage).toHaveBeenCalled();

    const value = await manager.withPage("base-session", null, async () => "ok");
    expect(value).toBe("ok");
  });

  it("delegates non-ops sessions to the base manager", async () => {
    const base = {
      launch: vi.fn().mockResolvedValue({
        sessionId: "base-session",
        mode: "managed",
        activeTargetId: null,
        warnings: [],
        wsEndpoint: "ws://127.0.0.1:9222/devtools/browser/base"
      }),
      connect: vi.fn().mockResolvedValue({
        sessionId: "base-session",
        mode: "cdpConnect",
        activeTargetId: null,
        warnings: [],
        wsEndpoint: "ws://127.0.0.1:9222/devtools/browser/base"
      }),
      connectRelay: vi.fn().mockResolvedValue({
        sessionId: "base-session",
        mode: "extension",
        activeTargetId: null,
        warnings: [],
        wsEndpoint: "ws://127.0.0.1:8787/cdp"
      }),
      disconnect: vi.fn().mockResolvedValue(undefined),
      status: vi.fn().mockResolvedValue({ mode: "managed", activeTargetId: null }),
      withPage: vi.fn().mockImplementation(async (_sessionId: string, _targetId: string | null, fn: () => Promise<string>) => {
        return await fn();
      }),
      goto: vi.fn().mockResolvedValue({ finalUrl: "https://example.com", status: 200, timingMs: 1 }),
      waitForLoad: vi.fn().mockResolvedValue({ timingMs: 1 }),
      waitForRef: vi.fn().mockResolvedValue({ timingMs: 1 }),
      snapshot: vi.fn().mockResolvedValue({ snapshotId: "snap", content: "", truncated: false, refCount: 0, timingMs: 1 }),
      click: vi.fn().mockResolvedValue({ timingMs: 1, navigated: false }),
      hover: vi.fn().mockResolvedValue({ timingMs: 1 }),
      press: vi.fn().mockResolvedValue({ timingMs: 1 }),
      check: vi.fn().mockResolvedValue({ timingMs: 1 }),
      uncheck: vi.fn().mockResolvedValue({ timingMs: 1 }),
      type: vi.fn().mockResolvedValue({ timingMs: 1 }),
      select: vi.fn().mockResolvedValue(undefined),
      scroll: vi.fn().mockResolvedValue(undefined),
      scrollIntoView: vi.fn().mockResolvedValue({ timingMs: 1 }),
      domGetHtml: vi.fn().mockResolvedValue({ outerHTML: "<div></div>", truncated: false }),
      domGetText: vi.fn().mockResolvedValue({ text: "text", truncated: false }),
      domGetAttr: vi.fn().mockResolvedValue({ value: "attr" }),
      domGetValue: vi.fn().mockResolvedValue({ value: "value" }),
      domIsVisible: vi.fn().mockResolvedValue({ value: true }),
      domIsEnabled: vi.fn().mockResolvedValue({ value: true }),
      domIsChecked: vi.fn().mockResolvedValue({ value: false }),
      clonePage: vi.fn().mockResolvedValue({ component: "component", css: "" }),
      cloneComponent: vi.fn().mockResolvedValue({ component: "component", css: "" }),
      perfMetrics: vi.fn().mockResolvedValue({ metrics: [] }),
      screenshot: vi.fn().mockResolvedValue({ path: "/tmp/base.png" }),
      consolePoll: vi.fn().mockResolvedValue({ events: [], nextSeq: 0 }),
      networkPoll: vi.fn().mockResolvedValue({ events: [], nextSeq: 0 }),
      listTargets: vi.fn().mockResolvedValue({ activeTargetId: null, targets: [] }),
      useTarget: vi.fn().mockResolvedValue({ activeTargetId: "tab-1", url: "https://example.com", title: "Example" }),
      newTarget: vi.fn().mockResolvedValue({ targetId: "tab-2" }),
      closeTarget: vi.fn().mockResolvedValue(undefined),
      page: vi.fn().mockResolvedValue({ targetId: "tab-3", created: true, url: "https://example.com", title: "Example" }),
      listPages: vi.fn().mockResolvedValue({ pages: [] }),
      closePage: vi.fn().mockResolvedValue(undefined)
    };
    const manager = new OpsBrowserManager(base as never, makeConfig());

    await manager.launch({} as never);
    await manager.connect({} as never);
    await manager.connectRelay("ws://127.0.0.1:8787/cdp");
    await manager.disconnect("base-session", false);
    await manager.status("base-session");
    await manager.withPage("base-session", null, async () => "ok");
    await manager.goto("base-session", "https://example.com", "load", 1000);
    await manager.waitForLoad("base-session", "load", 1000);
    await manager.waitForRef("base-session", "ref-1", "attached", 1000);
    await manager.snapshot("base-session", "outline", 1000, "cursor-1");
    await manager.click("base-session", "ref-1");
    await manager.hover("base-session", "ref-1");
    await manager.press("base-session", "Enter", "ref-1");
    await manager.check("base-session", "ref-1");
    await manager.uncheck("base-session", "ref-1");
    await manager.type("base-session", "ref-1", "text", true, true);
    await manager.select("base-session", "ref-1", ["a"]);
    await manager.scroll("base-session", 10, "ref-1");
    await manager.scrollIntoView("base-session", "ref-1");
    await manager.domGetHtml("base-session", "ref-1", 1000);
    await manager.domGetText("base-session", "ref-1", 1000);
    await manager.domGetAttr("base-session", "ref-1", "id");
    await manager.domGetValue("base-session", "ref-1");
    await manager.domIsVisible("base-session", "ref-1");
    await manager.domIsEnabled("base-session", "ref-1");
    await manager.domIsChecked("base-session", "ref-1");
    await manager.clonePage("base-session");
    await manager.cloneComponent("base-session", "ref-1");
    await manager.perfMetrics("base-session");
    await manager.screenshot("base-session", "/tmp/base.png");
    await manager.consolePoll("base-session", 0, 10);
    await manager.networkPoll("base-session", 0, 10);
    await manager.listTargets("base-session", true);
    await manager.useTarget("base-session", "tab-1");
    await manager.newTarget("base-session", "https://example.com");
    await manager.closeTarget("base-session", "tab-1");
    await manager.page("base-session", "main", "https://example.com");
    await manager.listPages("base-session");
    await manager.closePage("base-session", "main");

    expect(base.connectRelay).toHaveBeenCalledWith("ws://127.0.0.1:8787/cdp");
    expect(base.goto).toHaveBeenCalled();
  });

  it("routes ops sessions through ops client and tracks sessions", async () => {
    requestMock.mockImplementation(async (...args: unknown[]) => {
      const command = args[0] as string;
      if (command === "session.connect") {
        return { opsSessionId: "ops-1", activeTargetId: "tab-1", url: "https://example.com", title: "Example", leaseId: "lease-1" };
      }
      if (command === "session.status") {
        return { mode: "extension", activeTargetId: "tab-1" };
      }
      if (command === "session.disconnect") {
        return { ok: true };
      }
      return { ok: true };
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ relayPort: 8787, pairingRequired: false, instanceId: "relay-1", epoch: 1 })
    }));

    const base = {
      connectRelay: vi.fn()
    };
    const manager = new OpsBrowserManager(base as never, makeConfig());

    const result = await manager.connectRelay("ws://127.0.0.1:8787/ops");
    expect(result.sessionId).toBe("ops-1");
    expect(result.mode).toBe("extension");
    expect(requestMock).toHaveBeenCalledWith("session.connect", {}, undefined, 30000, expect.any(String));

    const status = await manager.status("ops-1");
    expect(status.mode).toBe("extension");
    expect(requestMock).toHaveBeenCalledWith("session.status", {}, "ops-1", 30000, "lease-1");

    await manager.disconnect("ops-1");
    expect(requestMock).toHaveBeenCalledWith("session.disconnect", { closeBrowser: false }, "ops-1", 30000, "lease-1");
  });

  it("tracks ops session close events", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const opsSessions = (manager as { opsSessions: Set<string> }).opsSessions;
    const opsLeases = (manager as { opsLeases: Map<string, string> }).opsLeases;
    const closedOpsSessions = (manager as { closedOpsSessions: Map<string, number> }).closedOpsSessions;

    opsSessions.add("ops-1");
    opsLeases.set("ops-1", "lease-1");

    (manager as unknown as { handleOpsEvent: (event: { event?: string; opsSessionId?: string }) => void })
      .handleOpsEvent({ opsSessionId: "ops-1", event: "ops_session_closed" });

    expect(opsSessions.has("ops-1")).toBe(false);
    expect(opsLeases.has("ops-1")).toBe(false);
    expect(closedOpsSessions.has("ops-1")).toBe(true);
  });

  it("tracks ops session expired events", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const opsSessions = (manager as { opsSessions: Set<string> }).opsSessions;
    const opsLeases = (manager as { opsLeases: Map<string, string> }).opsLeases;
    const closedOpsSessions = (manager as { closedOpsSessions: Map<string, number> }).closedOpsSessions;

    opsSessions.add("ops-expired");
    opsLeases.set("ops-expired", "lease-expired");

    (manager as unknown as { handleOpsEvent: (event: { event?: string; opsSessionId?: string }) => void })
      .handleOpsEvent({ opsSessionId: "ops-expired", event: "ops_session_expired" });

    expect(opsSessions.has("ops-expired")).toBe(false);
    expect(opsLeases.has("ops-expired")).toBe(false);
    expect(closedOpsSessions.has("ops-expired")).toBe(true);
  });

  it("ignores ops events without session ids", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const opsSessions = (manager as { opsSessions: Set<string> }).opsSessions;
    const closedOpsSessions = (manager as { closedOpsSessions: Map<string, number> }).closedOpsSessions;

    opsSessions.add("ops-1");

    (manager as unknown as { handleOpsEvent: (event: { event?: string; opsSessionId?: string }) => void })
      .handleOpsEvent({ event: "ops_session_closed" });

    expect(opsSessions.has("ops-1")).toBe(true);
    expect(closedOpsSessions.size).toBe(0);
  });

  it("ignores non-close ops events", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const opsSessions = (manager as { opsSessions: Set<string> }).opsSessions;
    const closedOpsSessions = (manager as { closedOpsSessions: Map<string, number> }).closedOpsSessions;

    opsSessions.add("ops-2");

    (manager as unknown as { handleOpsEvent: (event: { event?: string; opsSessionId?: string }) => void })
      .handleOpsEvent({ opsSessionId: "ops-2", event: "ops_session_opened" });

    expect(opsSessions.has("ops-2")).toBe(true);
    expect(closedOpsSessions.size).toBe(0);
  });

  it("handles closed sessions on disconnect and status checks", async () => {
    const base = {
      disconnect: vi.fn().mockResolvedValue(undefined),
      status: vi.fn().mockResolvedValue({ mode: "managed", activeTargetId: null })
    };
    const manager = new OpsBrowserManager(base as never, makeConfig());
    const closedOpsSessions = (manager as { closedOpsSessions: Map<string, number> }).closedOpsSessions;

    closedOpsSessions.set("ops-closed", Date.now());
    await manager.disconnect("ops-closed", false);
    await expect(manager.status("ops-closed")).rejects.toThrow("Session already closed");
    expect(base.disconnect).not.toHaveBeenCalled();
  });

  it("clears ops sessions when ops client closes", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const opsSessions = (manager as { opsSessions: Set<string> }).opsSessions;
    const opsLeases = (manager as { opsLeases: Map<string, string> }).opsLeases;
    const closedOpsSessions = (manager as { closedOpsSessions: Map<string, number> }).closedOpsSessions;

    opsSessions.add("ops-1");
    opsSessions.add("ops-2");
    opsLeases.set("ops-1", "lease-1");
    opsLeases.set("ops-2", "lease-2");

    (manager as unknown as { handleOpsClientClosed: () => void }).handleOpsClientClosed();

    expect(opsSessions.size).toBe(0);
    expect(opsLeases.size).toBe(0);
    expect(closedOpsSessions.has("ops-1")).toBe(true);
    expect(closedOpsSessions.has("ops-2")).toBe(true);
  });

  it("no-ops when ops client closes without sessions", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const closedOpsSessions = (manager as { closedOpsSessions: Map<string, number> }).closedOpsSessions;

    (manager as unknown as { handleOpsClientClosed: () => void }).handleOpsClientClosed();

    expect(closedOpsSessions.size).toBe(0);
  });

  it("throws when ops lease is missing", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    (manager as { opsClient: { request: () => Promise<unknown> } | null }).opsClient = {
      request: vi.fn().mockResolvedValue({})
    };
    const opsSessions = (manager as { opsSessions: Set<string> }).opsSessions;
    opsSessions.add("ops-lease-missing");

    await expect(manager.goto("ops-lease-missing", "https://example.com")).rejects.toThrow("Ops lease not found");
  });

  it("invokes ops client event handlers", async () => {
    requestMock.mockImplementation(async (...args: unknown[]) => {
      const command = args[0] as string;
      if (command === "session.connect") {
        return { opsSessionId: "ops-evt", activeTargetId: "tab-1", url: "https://example.com", title: "Example", leaseId: "lease-evt" };
      }
      return {};
    });
    const manager = new OpsBrowserManager({} as never, makeConfig());
    await manager.connectRelay("ws://127.0.0.1:8787/ops");

    const opsClient = (manager as { opsClient: { emitEvent: (event: { event?: string; opsSessionId?: string }) => void; emitClose: () => void } | null }).opsClient;
    const opsSessions = (manager as { opsSessions: Set<string> }).opsSessions;

    opsClient?.emitEvent({ opsSessionId: "ops-evt", event: "ops_tab_closed" });
    expect(opsSessions.has("ops-evt")).toBe(false);

    opsSessions.add("ops-evt");
    opsClient?.emitClose();
    expect(opsSessions.size).toBe(0);
  });

  it("prunes closed ops sessions beyond 100", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const closedOpsSessions = (manager as { closedOpsSessions: Map<string, number> }).closedOpsSessions;

    for (let i = 0; i < 105; i += 1) {
      closedOpsSessions.set(`ops-${i}`, i);
    }

    (manager as unknown as { trackClosedSessionCleanup: () => void }).trackClosedSessionCleanup();

    expect(closedOpsSessions.size).toBe(100);
    expect(closedOpsSessions.has("ops-0")).toBe(false);
  });

  it("skips cleanup when closed ops sessions are under the limit", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const closedOpsSessions = (manager as { closedOpsSessions: Map<string, number> }).closedOpsSessions;

    for (let i = 0; i < 100; i += 1) {
      closedOpsSessions.set(`ops-${i}`, i);
    }

    (manager as unknown as { trackClosedSessionCleanup: () => void }).trackClosedSessionCleanup();

    expect(closedOpsSessions.size).toBe(100);
    expect(closedOpsSessions.has("ops-0")).toBe(true);
  });

  it("preserves falsy session ids during cleanup", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    const closedOpsSessions = (manager as { closedOpsSessions: Map<string, number> }).closedOpsSessions;

    closedOpsSessions.set("", -1);
    for (let i = 0; i < 101; i += 1) {
      closedOpsSessions.set(`ops-${i}`, i);
    }

    (manager as unknown as { trackClosedSessionCleanup: () => void }).trackClosedSessionCleanup();

    expect(closedOpsSessions.has("")).toBe(true);
    expect(closedOpsSessions.size).toBe(101);
  });

  it("recreates ops client when endpoint changes", async () => {
    requestMock.mockImplementation(async (command: string) => {
      if (command === "session.connect") {
        return { opsSessionId: "ops-3", activeTargetId: "tab-1" };
      }
      return { ok: true };
    });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ relayPort: 8787, pairingRequired: false, instanceId: "relay-1", epoch: 1 })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ relayPort: 9999, pairingRequired: false, instanceId: "relay-1", epoch: 1 })
      });
    vi.stubGlobal("fetch", fetchMock as never);

    const base = { connectRelay: vi.fn() };
    const manager = new OpsBrowserManager(base as never, makeConfig());

    await manager.connectRelay("ws://127.0.0.1:8787/ops");
    await manager.connectRelay("ws://127.0.0.1:9999/ops");

    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });

  it("executes ops commands for an active ops session", async () => {
    const domCapture = { html: "<div></div>", styles: {}, warnings: [], inlineStyles: true };
    requestMock.mockImplementation(async (...args: unknown[]) => {
      const command = args[0] as string;
      switch (command) {
        case "session.connect":
          return { opsSessionId: "ops-2", activeTargetId: "tab-1", leaseId: "lease-ops" };
        case "nav.goto":
          return { finalUrl: "https://example.com", status: 200, timingMs: 1 };
        case "nav.wait":
          return { timingMs: 1 };
        case "nav.snapshot":
          return { snapshotId: "snap", content: "", truncated: false, refCount: 0, timingMs: 1 };
        case "interact.click":
          return { timingMs: 1, navigated: false };
        case "interact.hover":
        case "interact.press":
        case "interact.check":
        case "interact.uncheck":
        case "interact.type":
          return { timingMs: 1 };
        case "interact.select":
        case "interact.scroll":
          return undefined;
        case "interact.scrollIntoView":
          return { timingMs: 1 };
        case "dom.getHtml":
          return { outerHTML: "<div></div>", truncated: false };
        case "dom.getText":
          return { text: "hello", truncated: false };
        case "dom.getAttr":
          return { value: "attr" };
        case "dom.getValue":
          return { value: "value" };
        case "dom.isVisible":
          return { value: true };
        case "dom.isEnabled":
          return { value: true };
        case "dom.isChecked":
          return { value: false };
        case "export.clonePage":
        case "export.cloneComponent":
          return { capture: domCapture };
        case "devtools.perf":
          return { metrics: [] };
        case "page.screenshot":
          return { base64: Buffer.from("image").toString("base64") };
        case "devtools.consolePoll":
        case "devtools.networkPoll":
          return { events: [], nextSeq: 0 };
        case "targets.list":
          return { activeTargetId: null, targets: [] };
        case "targets.use":
          return { activeTargetId: "tab-1", url: "https://example.com", title: "Example" };
        case "targets.new":
          return { targetId: "tab-2" };
        case "targets.close":
          return { ok: true };
        case "page.open":
          return { targetId: "tab-3", created: true, url: "https://example.com", title: "Example" };
        case "page.list":
          return { pages: [] };
        case "page.close":
          return { ok: true };
        default:
          return { ok: true };
      }
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ relayPort: 8787, pairingRequired: false, instanceId: "relay-1", epoch: 1 })
    }));

    const base = {
      connectRelay: vi.fn()
    };
    const manager = new OpsBrowserManager(base as never, makeConfig());

    const connected = await manager.connectRelay("ws://127.0.0.1:8787/ops");
    expect(connected.sessionId).toBe("ops-2");
    await manager.connectRelay("ws://127.0.0.1:8787/ops");
    expect(connectMock).toHaveBeenCalled();

    await manager.goto("ops-2", "https://example.com", "load", 1000);
    await manager.waitForLoad("ops-2", "load", 1000);
    await manager.waitForRef("ops-2", "ref-1", "visible", 1000);
    await manager.snapshot("ops-2", "outline", 1000, "cursor-1");
    await manager.click("ops-2", "ref-1");
    await manager.hover("ops-2", "ref-1");
    await manager.press("ops-2", "Enter", "ref-1");
    await manager.check("ops-2", "ref-1");
    await manager.uncheck("ops-2", "ref-1");
    await manager.type("ops-2", "ref-1", "text", true, true);
    await manager.select("ops-2", "ref-1", ["a"]);
    await manager.scroll("ops-2", 10, "ref-1");
    await manager.scrollIntoView("ops-2", "ref-1");
    await manager.domGetHtml("ops-2", "ref-1", 1000);
    await manager.domGetText("ops-2", "ref-1", 1000);
    await manager.domGetAttr("ops-2", "ref-1", "id");
    await manager.domGetValue("ops-2", "ref-1");
    await manager.domIsVisible("ops-2", "ref-1");
    await manager.domIsEnabled("ops-2", "ref-1");
    await manager.domIsChecked("ops-2", "ref-1");
    await manager.clonePage("ops-2");
    await manager.cloneComponent("ops-2", "ref-1");
    await manager.perfMetrics("ops-2");
    await manager.screenshot("ops-2");
    await manager.screenshot("ops-2", "/tmp/ops-screenshot.png");
    await manager.consolePoll("ops-2", 0, 10);
    await manager.networkPoll("ops-2", 0, 10);
    await manager.listTargets("ops-2", true);
    await manager.useTarget("ops-2", "tab-1");
    await manager.newTarget("ops-2", "https://example.com");
    await manager.closeTarget("ops-2", "tab-1");
    await manager.page("ops-2", "main", "https://example.com");
    await manager.listPages("ops-2");
    await manager.closePage("ops-2", "main");

    const nonConnectCalls = requestMock.mock.calls.filter((call) => call[0] !== "session.connect");
    for (const call of nonConnectCalls) {
      expect(call[4]).toBe("lease-ops");
    }
    await expect(manager.withPage("ops-2", null, async () => "ok")).rejects.toThrow("Direct annotate is unavailable");
  });

  it("propagates ops screenshot warnings", async () => {
    requestMock.mockImplementation(async (...args: unknown[]) => {
      const command = args[0] as string;
      if (command === "session.connect") {
        return { opsSessionId: "ops-9", activeTargetId: "tab-1", leaseId: "lease-9" };
      }
      if (command === "page.screenshot") {
        return { base64: Buffer.from("image").toString("base64"), warning: "visible_only_fallback" };
      }
      return { ok: true };
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ relayPort: 8787, pairingRequired: false, instanceId: "relay-1", epoch: 1 })
    }));

    const manager = new OpsBrowserManager({ connectRelay: vi.fn() } as never, makeConfig());
    await manager.connectRelay("ws://127.0.0.1:8787/ops");

    const result = await manager.screenshot("ops-9");
    expect(result).toEqual({
      base64: Buffer.from("image").toString("base64"),
      warnings: ["visible_only_fallback"]
    });
  });

  it("throws when ops screenshot payload is missing", async () => {
    requestMock.mockImplementation(async (command: string) => {
      if (command === "session.connect") {
        return { opsSessionId: "ops-4", activeTargetId: "tab-1" };
      }
      if (command === "page.screenshot") {
        return {};
      }
      return { ok: true };
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ relayPort: 8787, pairingRequired: false, instanceId: "relay-1", epoch: 1 })
    }));

    const manager = new OpsBrowserManager({ connectRelay: vi.fn() } as never, makeConfig());
    await manager.connectRelay("ws://127.0.0.1:8787/ops");

    await expect(manager.screenshot("ops-4")).rejects.toThrow("Screenshot failed");
  });

  it("errors when an ops session has no connected client", async () => {
    const manager = new OpsBrowserManager({} as never, makeConfig());
    (manager as unknown as { opsSessions: Set<string> }).opsSessions.add("ops-missing");
    await expect(manager.goto("ops-missing", "https://example.com", "load", 1000)).rejects.toThrow("Ops client not connected");
  });
});
