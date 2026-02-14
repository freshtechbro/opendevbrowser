import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { parseArgs } from "../src/cli/args";
import { ConfigStore, resolveConfig } from "../src/config";

vi.mock("@opencode-ai/plugin", async () => {
  const { z } = await import("zod");
  const toolFn = (input: { description: string; args: unknown; execute: (...args: unknown[]) => unknown }) => input;
  toolFn.schema = z;
  return { tool: toolFn };
});

const CLI_TO_TOOL_PAIRS = [
  ["launch", "opendevbrowser_launch"],
  ["connect", "opendevbrowser_connect"],
  ["disconnect", "opendevbrowser_disconnect"],
  ["status", "opendevbrowser_status"],
  ["targets-list", "opendevbrowser_targets_list"],
  ["target-use", "opendevbrowser_target_use"],
  ["target-new", "opendevbrowser_target_new"],
  ["target-close", "opendevbrowser_target_close"],
  ["page", "opendevbrowser_page"],
  ["pages", "opendevbrowser_list"],
  ["page-close", "opendevbrowser_close"],
  ["goto", "opendevbrowser_goto"],
  ["wait", "opendevbrowser_wait"],
  ["snapshot", "opendevbrowser_snapshot"],
  ["click", "opendevbrowser_click"],
  ["hover", "opendevbrowser_hover"],
  ["press", "opendevbrowser_press"],
  ["check", "opendevbrowser_check"],
  ["uncheck", "opendevbrowser_uncheck"],
  ["type", "opendevbrowser_type"],
  ["select", "opendevbrowser_select"],
  ["scroll", "opendevbrowser_scroll"],
  ["scroll-into-view", "opendevbrowser_scroll_into_view"],
  ["dom-html", "opendevbrowser_dom_get_html"],
  ["dom-text", "opendevbrowser_dom_get_text"],
  ["dom-attr", "opendevbrowser_get_attr"],
  ["dom-value", "opendevbrowser_get_value"],
  ["dom-visible", "opendevbrowser_is_visible"],
  ["dom-enabled", "opendevbrowser_is_enabled"],
  ["dom-checked", "opendevbrowser_is_checked"],
  ["run", "opendevbrowser_run"],
  ["console-poll", "opendevbrowser_console_poll"],
  ["network-poll", "opendevbrowser_network_poll"],
  ["clone-page", "opendevbrowser_clone_page"],
  ["clone-component", "opendevbrowser_clone_component"],
  ["perf", "opendevbrowser_perf"],
  ["screenshot", "opendevbrowser_screenshot"],
  ["debug-trace-snapshot", "opendevbrowser_debug_trace_snapshot"],
  ["cookie-import", "opendevbrowser_cookie_import"],
  ["macro-resolve", "opendevbrowser_macro_resolve"],
  ["annotate", "opendevbrowser_annotate"]
] as const;

const parseToolResponse = (value: string): Record<string, unknown> => JSON.parse(value) as Record<string, unknown>;

const createDeps = () => {
  const manager = {
    launch: vi.fn().mockResolvedValue({ sessionId: "s1", mode: "managed", activeTargetId: "t1", warnings: [], wsEndpoint: "ws://managed" }),
    connect: vi.fn().mockResolvedValue({ sessionId: "s2", mode: "cdpConnect", activeTargetId: "t2", warnings: [], wsEndpoint: "ws://cdp" }),
    connectRelay: vi.fn().mockResolvedValue({ sessionId: "s3", mode: "extension", activeTargetId: "t3", warnings: [], wsEndpoint: "ws://relay" }),
    disconnect: vi.fn().mockResolvedValue(undefined),
    status: vi.fn().mockResolvedValue({ mode: "managed", activeTargetId: "t1", url: "https://example.com", title: "Example" }),
    listTargets: vi.fn().mockResolvedValue({ activeTargetId: "t1", targets: [] }),
    useTarget: vi.fn().mockResolvedValue({ activeTargetId: "t2", url: "https://example.com", title: "Example" }),
    newTarget: vi.fn().mockResolvedValue({ targetId: "t3" }),
    closeTarget: vi.fn().mockResolvedValue(undefined),
    page: vi.fn().mockResolvedValue({ targetId: "t1", created: true, url: "https://example.com", title: "Example" }),
    listPages: vi.fn().mockResolvedValue({ pages: [] }),
    closePage: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue({ finalUrl: "https://example.com", status: 200, timingMs: 1, meta: { blockerState: "clear" } }),
    waitForRef: vi.fn().mockResolvedValue({ timingMs: 1, meta: { blockerState: "clear" } }),
    waitForLoad: vi.fn().mockResolvedValue({ timingMs: 1, meta: { blockerState: "clear" } }),
    snapshot: vi.fn().mockResolvedValue({ snapshotId: "snap-1", content: "", truncated: false, refCount: 0, timingMs: 1 }),
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
    clonePage: vi.fn().mockResolvedValue({ component: "<Component />", css: ".root{}" }),
    cloneComponent: vi.fn().mockResolvedValue({ component: "<Component />", css: ".root{}" }),
    perfMetrics: vi.fn().mockResolvedValue({ metrics: [] }),
    screenshot: vi.fn().mockResolvedValue({ base64: "image" }),
    consolePoll: vi.fn().mockReturnValue({ events: [], nextSeq: 0 }),
    networkPoll: vi.fn().mockReturnValue({ events: [], nextSeq: 0 }),
    debugTraceSnapshot: vi.fn().mockResolvedValue({ requestId: "req-1", channels: {}, page: {}, meta: { blockerState: "clear" } }),
    cookieImport: vi.fn().mockResolvedValue({ requestId: "req-1", imported: 0, rejected: [] })
  };

  const runner = { run: vi.fn().mockResolvedValue({ results: [], timingMs: 1 }) };
  const annotationManager = { requestAnnotation: vi.fn().mockResolvedValue({ status: "ok", payload: null }) };
  const skills = {
    loadBestPractices: vi.fn().mockResolvedValue("guide"),
    listSkills: vi.fn().mockResolvedValue([]),
    loadSkill: vi.fn().mockResolvedValue("guide")
  };

  const baseConfig = resolveConfig({});
  const config = new ConfigStore({ ...baseConfig, relayToken: false });

  return { manager, runner, annotationManager, config, skills };
};

describe("parity matrix", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/status")) {
        return {
          ok: false,
          status: 503,
          url,
          json: async () => ({})
        };
      }
      return {
        ok: true,
        status: 200,
        url,
        text: async () => `<html><body><main>parity content ${url}</main><a href="https://example.com/result">result</a></body></html>`,
        json: async () => ({})
      };
    }) as unknown as typeof fetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps parity-critical CLI commands parseable", () => {
    for (const [cliCommand] of CLI_TO_TOOL_PAIRS) {
      const parsed = parseArgs(["node", "opendevbrowser", cliCommand]);
      expect(parsed.command).toBe(cliCommand);
    }
    expect(parseArgs(["node", "opendevbrowser", "rpc"]).command).toBe("rpc");
  });

  it("keeps tool registry parity surface present", async () => {
    const { createTools } = await import("../src/tools");
    const tools = createTools(createDeps() as never);
    const toolNames = Object.keys(tools);

    expect(toolNames.length).toBeGreaterThanOrEqual(CLI_TO_TOOL_PAIRS.length);
    for (const [, toolName] of CLI_TO_TOOL_PAIRS) {
      expect(toolNames).toContain(toolName);
    }
    expect(toolNames).toContain("opendevbrowser_prompting_guide");
    expect(toolNames).toContain("opendevbrowser_skill_list");
    expect(toolNames).toContain("opendevbrowser_skill_load");
    expect(toolNames).not.toContain("opendevbrowser_rpc");
  }, 15000);

  it("keeps macro resolve parity for resolve and execute modes", async () => {
    const parsed = parseArgs([
      "node",
      "opendevbrowser",
      "macro-resolve",
      "--expression=@community.search(\"openai\")",
      "--execute"
    ]);
    expect(parsed.command).toBe("macro-resolve");
    expect(parsed.rawArgs).toContain("--execute");

    const { createTools } = await import("../src/tools");
    const tools = createTools(createDeps() as never);

    const resolveOnly = parseToolResponse(await tools.opendevbrowser_macro_resolve.execute({
      expression: "@community.search(\"openai\")"
    } as never));
    expect(resolveOnly.ok).toBe(true);
    expect(resolveOnly.execution).toBeUndefined();

    const executeMode = parseToolResponse(await tools.opendevbrowser_macro_resolve.execute({
      expression: "@community.search(\"openai\")",
      execute: true
    } as never));
    expect(executeMode.ok).toBe(true);
    expect(executeMode.execution).toMatchObject({
      records: expect.any(Array),
      failures: expect.any(Array),
      metrics: {
        attempted: expect.any(Number),
        succeeded: expect.any(Number),
        failed: expect.any(Number),
        retries: expect.any(Number),
        latencyMs: expect.any(Number)
      },
      meta: {
        ok: expect.any(Boolean),
        partial: expect.any(Boolean),
        sourceSelection: expect.any(String),
        providerOrder: expect.any(Array),
        trace: expect.any(Object),
        tier: expect.objectContaining({
          selected: expect.any(String),
          reasonCode: expect.any(String)
        }),
        provenance: expect.objectContaining({
          provider: expect.any(String),
          retrievalPath: expect.any(String),
          retrievedAt: expect.any(String)
        })
      }
    });
    expect((executeMode.execution as { meta: { ok: boolean } }).meta.ok).toBe(true);
    expect((executeMode.execution as { records: unknown[] }).records.length).toBeGreaterThan(0);
  }, 15000);

  it("keeps blocker metadata placement for execute-mode failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("x.com/i/flow/login")) {
        return {
          ok: true,
          status: 403,
          url,
          text: async () => "<html><body>login</body></html>",
          json: async () => ({})
        };
      }
      return {
        ok: true,
        status: 200,
        url,
        text: async () => "<html><body>ok</body></html>",
        json: async () => ({})
      };
    }) as unknown as typeof fetch);

    const { createTools } = await import("../src/tools");
    const tools = createTools(createDeps() as never);
    const executeMode = parseToolResponse(await tools.opendevbrowser_macro_resolve.execute({
      expression: "@web.fetch(\"https://x.com/i/flow/login\")",
      execute: true
    } as never));

    expect(executeMode.ok).toBe(true);
    expect(executeMode.execution).toMatchObject({
      meta: {
        ok: false,
        blocker: {
          type: "auth_required"
        }
      }
    });
  }, 15000);

  it("keeps mode parity across managed, extension, and cdpConnect surfaces", async () => {
    const { createTools } = await import("../src/tools");

    const managedDeps = createDeps();
    const managedTools = createTools(managedDeps as never);
    const managed = parseToolResponse(await managedTools.opendevbrowser_launch.execute({ noExtension: true } as never));
    const cdpConnect = parseToolResponse(await managedTools.opendevbrowser_connect.execute({ host: "127.0.0.1" } as never));

    const extensionDeps = createDeps();
    const relay = {
      status: () => ({ extensionConnected: true }),
      getOpsUrl: () => "ws://127.0.0.1:8787/ops"
    };
    const extensionTools = createTools({ ...extensionDeps, relay } as never);
    const extension = parseToolResponse(await extensionTools.opendevbrowser_launch.execute({} as never));

    expect(new Set([managed.mode, extension.mode, cdpConnect.mode])).toEqual(
      new Set(["managed", "extension", "cdpConnect"])
    );
  });

  it("keeps failure-mode parity across managed, extension, and cdpConnect", async () => {
    const { createTools } = await import("../src/tools");

    const managedDeps = createDeps();
    managedDeps.manager.launch.mockRejectedValueOnce(new Error("managed launch timeout"));
    const managedTools = createTools(managedDeps as never);
    const managedFailure = parseToolResponse(
      await managedTools.opendevbrowser_launch.execute({ noExtension: true } as never)
    );
    expect(managedFailure.ok).toBe(false);
    expect((managedFailure.error as { code?: string }).code).toBe("launch_failed");

    const extensionDeps = createDeps();
    extensionDeps.manager.connectRelay.mockRejectedValueOnce(new Error("extension relay timeout"));
    const extensionRelay = {
      refresh: async () => undefined,
      status: () => ({
        extensionConnected: true,
        extensionHandshakeComplete: true,
        cdpConnected: false,
        opsConnected: false,
        pairingRequired: true,
        instanceId: "relay-instance",
        running: true,
        port: 8787
      }),
      getOpsUrl: () => "ws://127.0.0.1:8787/ops",
      getCdpUrl: () => "ws://127.0.0.1:8787/cdp"
    };
    const extensionTools = createTools({ ...extensionDeps, relay: extensionRelay } as never);
    const extensionFailure = parseToolResponse(await extensionTools.opendevbrowser_launch.execute({} as never));
    expect(extensionFailure.ok).toBe(false);
    expect((extensionFailure.error as { code?: string }).code).toBe("extension_connect_failed");

    const cdpDeps = createDeps();
    cdpDeps.manager.connect.mockRejectedValueOnce(new Error("cdp connect timeout"));
    const cdpTools = createTools(cdpDeps as never);
    const cdpFailure = parseToolResponse(await cdpTools.opendevbrowser_connect.execute({
      host: "127.0.0.1",
      port: 9222
    } as never));
    expect(cdpFailure.ok).toBe(false);
    expect((cdpFailure.error as { code?: string }).code).toBe("connect_failed");
  });
});
