import * as fs from "fs";
import * as os from "os";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import onboardingMetadata from "../src/cli/onboarding-metadata.json";
import { ConfigStore, resolveConfig } from "../src/config";
import { createMockProviderRuntime } from "./provider-runtime-mock";

vi.mock("@opencode-ai/plugin", async () => {
  const { z } = await import("zod");
  const toolFn = (input: { description: string; args: unknown; execute: (...args: unknown[]) => unknown }) => input;
  toolFn.schema = z;
  return { tool: toolFn };
});

vi.mock("fs");
vi.mock("os");

beforeEach(() => {
  vi.mocked(os.homedir).mockReturnValue("/home/testuser");
  vi.mocked(fs.existsSync).mockReturnValue(false);
  vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ version: "0.1.0" }));
  delete process.env.OPENCODE_CONFIG_DIR;
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
      text: async () => `<html><body><main>tools content ${url}</main><a href="https://example.com/result">result</a></body></html>`,
      json: async () => ({})
    };
  }) as unknown as typeof fetch);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const createDeps = () => {
  const manager = {
    launch: vi.fn().mockResolvedValue({ sessionId: "s1", mode: "managed", activeTargetId: "t1", warnings: [], wsEndpoint: "ws://" }),
    connect: vi.fn().mockResolvedValue({ sessionId: "s1", mode: "cdpConnect", activeTargetId: "t1", warnings: [], wsEndpoint: "ws://" }),
    connectRelay: vi.fn().mockResolvedValue({ sessionId: "s1", mode: "extension", activeTargetId: "t1", warnings: [], wsEndpoint: "ws://relay" }),
    disconnect: vi.fn().mockResolvedValue(undefined),
    status: vi.fn().mockResolvedValue({ mode: "managed", activeTargetId: "t1", url: "https://", title: "Title" }),
    listTargets: vi.fn().mockResolvedValue({ activeTargetId: "t1", targets: [] }),
    useTarget: vi.fn().mockResolvedValue({ activeTargetId: "t2", url: "https://", title: "Title" }),
    newTarget: vi.fn().mockResolvedValue({ targetId: "t3" }),
    closeTarget: vi.fn().mockResolvedValue(undefined),
    page: vi.fn().mockResolvedValue({ targetId: "t1", created: true, url: "https://", title: "Title" }),
    listPages: vi.fn().mockResolvedValue({ pages: [{ name: "main", targetId: "t1", url: "https://", title: "Title" }] }),
    closePage: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue({
      finalUrl: "https://",
      status: 200,
      timingMs: 1,
      meta: {
        blockerState: "active",
        blocker: {
          schemaVersion: "1.0",
          type: "auth_required",
          source: "navigation",
          confidence: 0.95,
          retryable: false,
          detectedAt: "2026-02-14T00:00:00.000Z",
          evidence: { matchedPatterns: ["redirect_login_flow"], networkHosts: [] },
          actionHints: [{ id: "manual_login", reason: "login", priority: 1 }]
        }
      }
    }),
    waitForRef: vi.fn().mockResolvedValue({ timingMs: 1, meta: { blockerState: "clear" } }),
    waitForLoad: vi.fn().mockResolvedValue({ timingMs: 1, meta: { blockerState: "clear" } }),
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
    upload: vi.fn().mockResolvedValue({ fileCount: 1, mode: "direct_input" }),
    domGetHtml: vi.fn().mockResolvedValue({ outerHTML: "<div></div>", truncated: false }),
    domGetText: vi.fn().mockResolvedValue({ text: "hi", truncated: false }),
    domGetAttr: vi.fn().mockResolvedValue({ value: "attr" }),
    domGetValue: vi.fn().mockResolvedValue({ value: "value" }),
    domIsVisible: vi.fn().mockResolvedValue({ value: true }),
    domIsEnabled: vi.fn().mockResolvedValue({ value: true }),
    domIsChecked: vi.fn().mockResolvedValue({ value: false }),
    clonePage: vi.fn().mockResolvedValue({ component: "<Component />", css: ".css{}" }),
    cloneComponent: vi.fn().mockResolvedValue({ component: "<Component />", css: ".css{}" }),
    perfMetrics: vi.fn().mockResolvedValue({ metrics: [{ name: "Nodes", value: 1 }] }),
    screenshot: vi.fn().mockResolvedValue({ base64: "image" }),
    startScreencast: vi.fn().mockResolvedValue({
      screencastId: "cast-1",
      sessionId: "s1",
      targetId: "t1",
      outputDir: "/tmp/cast",
      startedAt: "2026-04-10T00:00:00.000Z",
      intervalMs: 1000,
      maxFrames: 300
    }),
    stopScreencast: vi.fn().mockResolvedValue({
      screencastId: "cast-1",
      sessionId: "s1",
      targetId: "t1",
      outputDir: "/tmp/cast",
      startedAt: "2026-04-10T00:00:00.000Z",
      endedAt: "2026-04-10T00:01:00.000Z",
      endedReason: "stopped",
      frameCount: 5,
      manifestPath: "/tmp/cast/replay.json",
      replayHtmlPath: "/tmp/cast/replay.html"
    }),
    dialog: vi.fn().mockResolvedValue({ dialog: { open: false } }),
    consolePoll: vi.fn().mockReturnValue({ events: [], nextSeq: 0 }),
    exceptionPoll: vi.fn().mockReturnValue({ events: [], nextSeq: 0 }),
    networkPoll: vi.fn().mockReturnValue({ events: [], nextSeq: 0 }),
    debugTraceSnapshot: vi.fn().mockResolvedValue({
      requestId: "req-1",
      generatedAt: "2026-02-01T00:00:00.000Z",
      page: { mode: "managed", activeTargetId: "t1", url: "https://", title: "Title" },
      channels: {
        console: { events: [], nextSeq: 0 },
        network: { events: [], nextSeq: 0 },
        exception: { events: [], nextSeq: 0 }
      },
      meta: {
        blockerState: "clear"
      },
      fingerprint: {
        tier1: { ok: true, warnings: [], issues: [] },
        tier2: { enabled: false, mode: "off", profileId: "fp", healthScore: 100, challengeCount: 0, rotationCount: 0, lastRotationTs: 0, recentChallenges: [] },
        tier3: { enabled: false, status: "active", adapterName: "deterministic", fallbackTier: "tier2", canary: { level: 0, averageScore: 100, lastAction: "none", sampleCount: 0 } }
      }
    }),
    cookieImport: vi.fn().mockResolvedValue({ requestId: "req-1", imported: 1, rejected: [] }),
    cookieList: vi.fn().mockResolvedValue({ requestId: "req-2", cookies: [], count: 0 })
  };

  const runner = {
    run: vi.fn().mockResolvedValue({ results: [], timingMs: 1 })
  };
  const canvasManager = {
    execute: vi.fn().mockResolvedValue({ canvasSessionId: "canvas-1", leaseId: "lease-1" })
  };

  const baseConfig = resolveConfig({});
  const config = new ConfigStore({ ...baseConfig, relayToken: false });
  const skills = {
    loadBestPractices: vi.fn().mockResolvedValue("guide"),
    listSkills: vi.fn().mockResolvedValue([
      {
        name: "opendevbrowser-best-practices",
        description: "Best practices",
        version: "1.0.0",
        path: "/tmp/opendevbrowser-best-practices/SKILL.md"
      }
    ]),
    loadSkill: vi.fn().mockResolvedValue("# Skill")
  };
  const getExtensionPath = vi.fn().mockReturnValue("/path/to/extension");
  const providerRuntime = createMockProviderRuntime();
  const desktopAudit = {
    auditId: "desktop-audit-1",
    at: "2026-04-10T00:00:00.000Z",
    recordPath: "/tmp/desktop-audit.json",
    artifactPaths: []
  };
  const desktopWindow = {
    id: "window-1",
    ownerName: "Codex",
    ownerPid: 123,
    title: "Codex",
    bounds: { x: 0, y: 0, width: 1200, height: 800 },
    layer: 0,
    alpha: 1,
    isOnscreen: true
  };
  const desktopRuntime = {
    status: vi.fn().mockResolvedValue({
      platform: "darwin",
      permissionLevel: "observe",
      available: true,
      capabilities: ["observe.windows"],
      auditArtifactsDir: "/tmp/desktop-audit"
    }),
    listWindows: vi.fn().mockResolvedValue({
      ok: true,
      value: { windows: [desktopWindow] },
      audit: desktopAudit
    }),
    activeWindow: vi.fn().mockResolvedValue({
      ok: true,
      value: null,
      audit: desktopAudit
    }),
    captureDesktop: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        capture: {
          path: "/tmp/desktop.png",
          mimeType: "image/png"
        }
      },
      audit: desktopAudit
    }),
    captureWindow: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        capture: {
          path: "/tmp/window.png",
          mimeType: "image/png"
        },
        window: desktopWindow
      },
      audit: desktopAudit
    }),
    accessibilitySnapshot: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        window: desktopWindow,
        tree: {
          role: "AXWindow",
          children: []
        }
      },
      audit: desktopAudit
    })
  };

  return { manager, canvasManager, runner, config, skills, getExtensionPath, providerRuntime, desktopRuntime };
};

type ExecutableTool = {
  execute: (args: never) => Promise<string>;
};

const parse = (value: string) => JSON.parse(value) as { ok: boolean } & Record<string, unknown>;

const loadTools = async () => {
  const deps = createDeps();
  const { createTools } = await import("../src/tools");
  return {
    deps,
    tools: createTools(deps as never) as Record<string, ExecutableTool>
  };
};

const runTool = async (
  tools: Record<string, ExecutableTool>,
  name: string,
  args: Record<string, unknown>
) => parse(await tools[name].execute(args as never));

const expectToolCases = async (
  tools: Record<string, ExecutableTool>,
  cases: Array<[string, Record<string, unknown>, Record<string, unknown>]>
) => {
  for (const [name, args, expected] of cases) {
    expect(await runTool(tools, name, args)).toMatchObject(expected);
  }
};

describe("tools", () => {
  it("executes lifecycle and navigation tool handlers", async () => {
    const { tools } = await loadTools();
    const cases: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
      ["opendevbrowser_launch", { profile: "default", noExtension: true }, { ok: true }],
      ["opendevbrowser_connect", { host: "127.0.0.1" }, { ok: true }],
      ["opendevbrowser_disconnect", { sessionId: "s1" }, { ok: true }],
      ["opendevbrowser_status", { sessionId: "s1" }, { ok: true }],
      ["opendevbrowser_targets_list", { sessionId: "s1", includeUrls: true }, { ok: true }],
      ["opendevbrowser_target_use", { sessionId: "s1", targetId: "t1" }, { ok: true }],
      ["opendevbrowser_target_new", { sessionId: "s1" }, { ok: true }],
      ["opendevbrowser_target_close", { sessionId: "s1", targetId: "t1" }, { ok: true }],
      ["opendevbrowser_page", { sessionId: "s1", name: "main" }, { ok: true }],
      ["opendevbrowser_list", { sessionId: "s1" }, { ok: true }],
      ["opendevbrowser_close", { sessionId: "s1", name: "main" }, { ok: true }],
      ["opendevbrowser_goto", { sessionId: "s1", url: "https://" }, { ok: true, meta: { blockerState: "active", blocker: { type: "auth_required" } } }],
      ["opendevbrowser_wait", { sessionId: "s1", until: "load" }, { ok: true, meta: { blockerState: "clear" } }],
      ["opendevbrowser_wait", { sessionId: "s1", ref: "r1" }, { ok: true, meta: { blockerState: "clear" } }],
      ["opendevbrowser_snapshot", { sessionId: "s1" }, { ok: true }],
      ["opendevbrowser_review", { sessionId: "s1" }, { ok: true }]
    ];

    await expectToolCases(tools, cases);
  }, 30000);

  it("executes interaction tool handlers", async () => {
    const { tools } = await loadTools();
    const cases: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
      ["opendevbrowser_click", { sessionId: "s1", ref: "r1" }, { ok: true }],
      ["opendevbrowser_hover", { sessionId: "s1", ref: "r1" }, { ok: true }],
      ["opendevbrowser_press", { sessionId: "s1", key: "Enter" }, { ok: true }],
      ["opendevbrowser_check", { sessionId: "s1", ref: "r1" }, { ok: true }],
      ["opendevbrowser_uncheck", { sessionId: "s1", ref: "r1" }, { ok: true }],
      ["opendevbrowser_type", { sessionId: "s1", ref: "r1", text: "hi" }, { ok: true }],
      ["opendevbrowser_select", { sessionId: "s1", ref: "r1", values: ["v"] }, { ok: true }],
      ["opendevbrowser_scroll", { sessionId: "s1", dy: 10 }, { ok: true }],
      ["opendevbrowser_scroll_into_view", { sessionId: "s1", ref: "r1" }, { ok: true }],
      ["opendevbrowser_upload", { sessionId: "s1", ref: "r1", files: ["/tmp/a.txt"] }, { ok: true }]
    ];

    await expectToolCases(tools, cases);
  }, 30000);

  it("executes DOM, diagnostics, and storage tool handlers", async () => {
    const { tools } = await loadTools();
    const cases: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
      ["opendevbrowser_dom_get_html", { sessionId: "s1", ref: "r1" }, { ok: true }],
      ["opendevbrowser_dom_get_text", { sessionId: "s1", ref: "r1" }, { ok: true }],
      ["opendevbrowser_get_attr", { sessionId: "s1", ref: "r1", name: "id" }, { ok: true }],
      ["opendevbrowser_get_value", { sessionId: "s1", ref: "r1" }, { ok: true }],
      ["opendevbrowser_is_visible", { sessionId: "s1", ref: "r1" }, { ok: true }],
      ["opendevbrowser_is_enabled", { sessionId: "s1", ref: "r1" }, { ok: true }],
      ["opendevbrowser_is_checked", { sessionId: "s1", ref: "r1" }, { ok: true }],
      ["opendevbrowser_run", { sessionId: "s1", steps: [] }, { ok: true }],
      ["opendevbrowser_prompting_guide", {}, { ok: true }],
      ["opendevbrowser_skill_list", {}, { ok: true }],
      ["opendevbrowser_skill_load", { name: "opendevbrowser-best-practices" }, { ok: true }],
      ["opendevbrowser_console_poll", { sessionId: "s1" }, { ok: true }],
      ["opendevbrowser_network_poll", { sessionId: "s1" }, { ok: true }],
      ["opendevbrowser_debug_trace_snapshot", { sessionId: "s1" }, { ok: true, meta: { blockerState: "clear" } }],
      ["opendevbrowser_cookie_import", { sessionId: "s1", cookies: [{ name: "session", value: "abc123", url: "https://example.com" }] }, { ok: true }],
      ["opendevbrowser_cookie_list", { sessionId: "s1", urls: ["https://example.com"] }, { ok: true }],
      ["opendevbrowser_dialog", { sessionId: "s1" }, { ok: true }]
    ];

    for (const [name, args, expected] of cases) {
      expect(await runTool(tools, name, args)).toMatchObject(expected);
    }
  }, 30000);

  it("executes macro, canvas, and export tool handlers", async () => {
    const { tools } = await loadTools();

    expect(await runTool(tools, "opendevbrowser_macro_resolve", {
      expression: "@web.search(\"openai\")"
    })).toMatchObject({ ok: true });

    const macroExecution = await runTool(tools, "opendevbrowser_macro_resolve", {
      expression: "@community.search(\"openai\")",
      execute: true
    });
    expect(macroExecution).toMatchObject({
      ok: true,
      execution: {
        records: expect.any(Array),
        metrics: {
          attempted: expect.any(Number),
          succeeded: expect.any(Number),
          failed: expect.any(Number)
        },
        meta: {
          ok: expect.any(Boolean),
          sourceSelection: expect.any(String)
        }
      }
    });
    expect(((macroExecution.execution as { records: unknown[] } | undefined)?.records.length ?? 0)).toBeGreaterThan(0);
    expect((macroExecution.execution as { meta?: { ok?: boolean } } | undefined)?.meta?.ok).toBe(true);

    expect(await runTool(tools, "opendevbrowser_canvas", {
      command: "canvas.session.open",
      params: { browserSessionId: "s1" }
    })).toMatchObject({ ok: true, canvasSessionId: "canvas-1" });

    for (const [name, args] of [
      ["opendevbrowser_clone_page", { sessionId: "s1" }],
      ["opendevbrowser_clone_component", { sessionId: "s1", ref: "r1" }],
      ["opendevbrowser_perf", { sessionId: "s1" }],
      ["opendevbrowser_screenshot", { sessionId: "s1" }]
    ] as Array<[string, Record<string, unknown>]>) {
      expect(await runTool(tools, name, args)).toMatchObject({ ok: true });
    }

    expect(await runTool(tools, "opendevbrowser_screencast_start", {
      sessionId: "s1",
      targetId: "tab-9",
      outputDir: "/tmp/cast",
      intervalMs: 750,
      maxFrames: 5
    })).toMatchObject({ ok: true, screencastId: "cast-1" });
    expect(await runTool(tools, "opendevbrowser_screencast_stop", {
      sessionId: "s1",
      screencastId: "cast-1"
    })).toMatchObject({ ok: true, endedReason: "stopped" });
    expect(await runTool(tools, "opendevbrowser_desktop_status", {})).toMatchObject({
      ok: true,
      available: true
    });
    expect(await runTool(tools, "opendevbrowser_desktop_windows", {
      reason: "inventory"
    })).toMatchObject({
      ok: true,
      windows: [expect.objectContaining({ id: "window-1" })],
      audit: expect.objectContaining({ auditId: "desktop-audit-1" })
    });
    expect(await runTool(tools, "opendevbrowser_desktop_active_window", {
      reason: "active"
    })).toMatchObject({
      ok: true,
      value: null,
      audit: expect.objectContaining({ auditId: "desktop-audit-1" })
    });
    expect(await runTool(tools, "opendevbrowser_desktop_capture_desktop", {
      reason: "capture-desktop"
    })).toMatchObject({
      ok: true,
      capture: expect.objectContaining({ path: "/tmp/desktop.png" })
    });
    expect(await runTool(tools, "opendevbrowser_desktop_capture_window", {
      windowId: "window-1",
      reason: "capture-window"
    })).toMatchObject({
      ok: true,
      window: expect.objectContaining({ id: "window-1" })
    });
    expect(await runTool(tools, "opendevbrowser_desktop_accessibility_snapshot", {
      reason: "accessibility",
      windowId: "window-1"
    })).toMatchObject({
      ok: true,
      tree: expect.objectContaining({ role: "AXWindow" })
    });
  }, 30000);

  it("forwards targetId across target-aware tool handlers", async () => {
    const { deps, tools } = await loadTools();
    const defaultMaxChars = deps.config.get().snapshot.maxChars;

    await runTool(tools, "opendevbrowser_goto", { sessionId: "s1", url: "https://example.com", targetId: "tab-9" });
    expect(deps.manager.goto).toHaveBeenLastCalledWith("s1", "https://example.com", "load", 30000, undefined, "tab-9");

    await runTool(tools, "opendevbrowser_wait", { sessionId: "s1", until: "load", targetId: "tab-9" });
    expect(deps.manager.waitForLoad).toHaveBeenLastCalledWith("s1", "load", 30000, "tab-9");

    await runTool(tools, "opendevbrowser_wait", { sessionId: "s1", ref: "r1", targetId: "tab-9" });
    expect(deps.manager.waitForRef).toHaveBeenLastCalledWith("s1", "r1", "attached", 30000, "tab-9");

    await runTool(tools, "opendevbrowser_snapshot", { sessionId: "s1", targetId: "tab-9" });
    expect(deps.manager.snapshot).toHaveBeenLastCalledWith("s1", "outline", defaultMaxChars, undefined, "tab-9");

    await runTool(tools, "opendevbrowser_review", { sessionId: "s1", targetId: "tab-9" });
    expect(deps.manager.snapshot).toHaveBeenLastCalledWith("s1", "actionables", defaultMaxChars, undefined, "tab-9");

    await runTool(tools, "opendevbrowser_click", { sessionId: "s1", ref: "r1", targetId: "tab-9" });
    expect(deps.manager.click).toHaveBeenLastCalledWith("s1", "r1", "tab-9");

    await runTool(tools, "opendevbrowser_hover", { sessionId: "s1", ref: "r1", targetId: "tab-9" });
    expect(deps.manager.hover).toHaveBeenLastCalledWith("s1", "r1", "tab-9");

    await runTool(tools, "opendevbrowser_press", { sessionId: "s1", key: "Enter", ref: "r1", targetId: "tab-9" });
    expect(deps.manager.press).toHaveBeenLastCalledWith("s1", "Enter", "r1", "tab-9");

    await runTool(tools, "opendevbrowser_check", { sessionId: "s1", ref: "r1", targetId: "tab-9" });
    expect(deps.manager.check).toHaveBeenLastCalledWith("s1", "r1", "tab-9");

    await runTool(tools, "opendevbrowser_uncheck", { sessionId: "s1", ref: "r1", targetId: "tab-9" });
    expect(deps.manager.uncheck).toHaveBeenLastCalledWith("s1", "r1", "tab-9");

    await runTool(tools, "opendevbrowser_type", { sessionId: "s1", ref: "r1", text: "hello", targetId: "tab-9" });
    expect(deps.manager.type).toHaveBeenLastCalledWith("s1", "r1", "hello", false, false, "tab-9");

    await runTool(tools, "opendevbrowser_select", { sessionId: "s1", ref: "r1", values: ["one"], targetId: "tab-9" });
    expect(deps.manager.select).toHaveBeenLastCalledWith("s1", "r1", ["one"], "tab-9");

    await runTool(tools, "opendevbrowser_scroll", { sessionId: "s1", dy: 80, ref: "r1", targetId: "tab-9" });
    expect(deps.manager.scroll).toHaveBeenLastCalledWith("s1", 80, "r1", "tab-9");

    await runTool(tools, "opendevbrowser_scroll_into_view", { sessionId: "s1", ref: "r1", targetId: "tab-9" });
    expect(deps.manager.scrollIntoView).toHaveBeenLastCalledWith("s1", "r1", "tab-9");

    await runTool(tools, "opendevbrowser_upload", {
      sessionId: "s1",
      ref: "r1",
      files: ["/tmp/a.txt"],
      targetId: "tab-9"
    });
    expect(deps.manager.upload).toHaveBeenLastCalledWith("s1", expect.objectContaining({
      ref: "r1",
      files: ["/tmp/a.txt"],
      targetId: "tab-9"
    }));

    await runTool(tools, "opendevbrowser_dom_get_html", { sessionId: "s1", ref: "r1", targetId: "tab-9" });
    expect(deps.manager.domGetHtml).toHaveBeenLastCalledWith("s1", "r1", 8000, "tab-9");

    await runTool(tools, "opendevbrowser_dom_get_text", { sessionId: "s1", ref: "r1", targetId: "tab-9" });
    expect(deps.manager.domGetText).toHaveBeenLastCalledWith("s1", "r1", 8000, "tab-9");

    await runTool(tools, "opendevbrowser_get_attr", { sessionId: "s1", ref: "r1", name: "href", targetId: "tab-9" });
    expect(deps.manager.domGetAttr).toHaveBeenLastCalledWith("s1", "r1", "href", "tab-9");

    await runTool(tools, "opendevbrowser_get_value", { sessionId: "s1", ref: "r1", targetId: "tab-9" });
    expect(deps.manager.domGetValue).toHaveBeenLastCalledWith("s1", "r1", "tab-9");

    await runTool(tools, "opendevbrowser_is_visible", { sessionId: "s1", ref: "r1", targetId: "tab-9" });
    expect(deps.manager.domIsVisible).toHaveBeenLastCalledWith("s1", "r1", "tab-9");

    await runTool(tools, "opendevbrowser_is_enabled", { sessionId: "s1", ref: "r1", targetId: "tab-9" });
    expect(deps.manager.domIsEnabled).toHaveBeenLastCalledWith("s1", "r1", "tab-9");

    await runTool(tools, "opendevbrowser_is_checked", { sessionId: "s1", ref: "r1", targetId: "tab-9" });
    expect(deps.manager.domIsChecked).toHaveBeenLastCalledWith("s1", "r1", "tab-9");

    await runTool(tools, "opendevbrowser_clone_page", { sessionId: "s1", targetId: "tab-9" });
    expect(deps.manager.clonePage).toHaveBeenLastCalledWith("s1", "tab-9");

    await runTool(tools, "opendevbrowser_clone_component", { sessionId: "s1", ref: "r1", targetId: "tab-9" });
    expect(deps.manager.cloneComponent).toHaveBeenLastCalledWith("s1", "r1", "tab-9");

    await runTool(tools, "opendevbrowser_perf", { sessionId: "s1", targetId: "tab-9" });
    expect(deps.manager.perfMetrics).toHaveBeenLastCalledWith("s1", "tab-9");

    await runTool(tools, "opendevbrowser_screenshot", { sessionId: "s1", targetId: "tab-9" });
    expect(deps.manager.screenshot).toHaveBeenLastCalledWith("s1", expect.objectContaining({ targetId: "tab-9" }));

    await runTool(tools, "opendevbrowser_screenshot", {
      sessionId: "s1",
      path: "/tmp/example.png",
      ref: "r1"
    });
    expect(deps.manager.screenshot).toHaveBeenLastCalledWith("s1", expect.objectContaining({
      path: "/tmp/example.png",
      ref: "r1"
    }));

    await runTool(tools, "opendevbrowser_screenshot", {
      sessionId: "s1",
      fullPage: true
    });
    expect(deps.manager.screenshot).toHaveBeenLastCalledWith("s1", expect.objectContaining({ fullPage: true }));

    await runTool(tools, "opendevbrowser_screencast_start", {
      sessionId: "s1",
      targetId: "tab-9",
      outputDir: "/tmp/cast",
      intervalMs: 750,
      maxFrames: 5
    });
    expect(deps.manager.startScreencast).toHaveBeenLastCalledWith("s1", {
      targetId: "tab-9",
      outputDir: "/tmp/cast",
      intervalMs: 750,
      maxFrames: 5
    });

    await runTool(tools, "opendevbrowser_screencast_stop", {
      sessionId: "s1",
      screencastId: "cast-1"
    });
    expect(deps.manager.stopScreencast).toHaveBeenLastCalledWith("s1", "cast-1");

    await runTool(tools, "opendevbrowser_dialog", { sessionId: "s1", targetId: "tab-9", action: "dismiss" });
    expect(deps.manager.dialog).toHaveBeenLastCalledWith("s1", expect.objectContaining({ targetId: "tab-9", action: "dismiss" }));

    await runTool(tools, "opendevbrowser_dialog", {
      sessionId: "s1",
      action: "accept",
      promptText: "hello"
    });
    expect(deps.manager.dialog).toHaveBeenLastCalledWith("s1", expect.objectContaining({
      action: "accept",
      promptText: "hello"
    }));
  }, 30000);

  it("builds review output from status and actionables snapshots", async () => {
    const { deps, tools } = await loadTools();
    deps.manager.status.mockResolvedValueOnce({
      mode: "extension",
      activeTargetId: "tab-9",
      url: "https://example.com/status",
      title: "Status Title",
      meta: {
        blockerState: "active",
        blocker: {
          schemaVersion: "1.0",
          type: "anti_bot_challenge",
          source: "navigation",
          reasonCode: "challenge_detected",
          confidence: 0.9,
          retryable: true,
          detectedAt: "2026-03-26T00:00:00.000Z",
          evidence: { matchedPatterns: [], networkHosts: [] },
          actionHints: []
        }
      }
    });
    deps.manager.snapshot.mockResolvedValueOnce({
      snapshotId: "snap-review",
      url: "https://example.com/review",
      title: "Review Title",
      content: "[r1] button \"Continue\"",
      truncated: true,
      nextCursor: "1",
      refCount: 1,
      timingMs: 12,
      warnings: ["review warning"]
    });

    const result = parse(await tools.opendevbrowser_review.execute({
      sessionId: "s1",
      targetId: "tab-9",
      maxChars: 1200,
      cursor: "0"
    } as never));

    expect(deps.manager.snapshot).toHaveBeenLastCalledWith("s1", "actionables", 1200, "0", "tab-9");
    expect(result).toMatchObject({
      ok: true,
      sessionId: "s1",
      targetId: "tab-9",
      mode: "extension",
      snapshotId: "snap-review",
      url: "https://example.com/review",
      title: "Review Title",
      content: "[r1] button \"Continue\"",
      truncated: true,
      nextCursor: "1",
      refCount: 1,
      timingMs: 12,
      warnings: ["review warning"],
      meta: {
        blockerState: "active",
        blocker: {
          type: "anti_bot_challenge"
        }
      }
    });
  });

  it("builds review output without a dialog when no review target is active", async () => {
    const { deps, tools } = await loadTools();
    deps.manager.status.mockResolvedValueOnce({
      mode: "managed",
      activeTargetId: null,
      url: "https://example.com/status",
      title: "Status Title",
      meta: {
        blockerState: "clear"
      }
    });
    deps.manager.snapshot.mockResolvedValueOnce({
      snapshotId: "snap-review-empty",
      content: "",
      truncated: false,
      refCount: 0,
      timingMs: 7
    });

    const result = parse(await tools.opendevbrowser_review.execute({
      sessionId: "s1"
    } as never));

    expect(deps.manager.dialog).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      sessionId: "s1",
      targetId: null,
      meta: {
        blockerState: "clear"
      }
    });
  });

  it("wraps tool execution with ensureHub when provided", async () => {
    const deps = createDeps();
    const ensureHub = vi.fn().mockResolvedValue(undefined);
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...deps, ensureHub } as never);

    const statusResult = parse(await tools.opendevbrowser_status.execute({ sessionId: "s1" } as never));
    expect(statusResult.ok).toBe(true);
    expect(ensureHub).toHaveBeenCalledTimes(1);
    expect(deps.manager.status).toHaveBeenCalled();
  });

  it("continues tool execution when ensureHub fails", async () => {
    const deps = createDeps();
    const ensureHub = vi.fn().mockRejectedValue(new Error("hub down"));
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...deps, ensureHub } as never);

    const statusResult = parse(await tools.opendevbrowser_status.execute({ sessionId: "s1" } as never));
    expect(statusResult.ok).toBe(true);
    expect(ensureHub).toHaveBeenCalledTimes(1);
    expect(deps.manager.status).toHaveBeenCalled();
  });

  it("does not wrap local skill tools with ensureHub", async () => {
    const deps = createDeps();
    const ensureHub = vi.fn().mockResolvedValue(undefined);
    const { createTools, LOCAL_ONLY_TOOL_NAMES } = await import("../src/tools");
    const tools = createTools({ ...deps, ensureHub } as never);

    expect(new Set(onboardingMetadata.localOnlyToolNames)).toEqual(LOCAL_ONLY_TOOL_NAMES);
    expect(parse(await tools.opendevbrowser_prompting_guide.execute({} as never))).toMatchObject({ ok: true });
    expect(parse(await tools.opendevbrowser_skill_list.execute({} as never))).toMatchObject({ ok: true });
    expect(parse(await tools.opendevbrowser_skill_load.execute({ name: "opendevbrowser-best-practices" } as never))).toMatchObject({ ok: true });
    expect(ensureHub).not.toHaveBeenCalled();
  });

  it("rejects invalid canvas command prefixes", async () => {
    const deps = createDeps();
    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    expect(parse(await tools.opendevbrowser_canvas.execute({
      command: "session.open"
    } as never))).toMatchObject({
      ok: false,
      error: { code: "canvas_invalid_command" }
    });
  });

  it("covers canvas tool unavailable, scalar, and failure branches", async () => {
    const { createTools } = await import("../src/tools");
    const deps = createDeps();

    const unavailableTools = createTools({ ...deps, canvasManager: undefined } as never);
    expect(parse(await unavailableTools.opendevbrowser_canvas.execute({
      command: "canvas.session.open"
    } as never))).toMatchObject({
      ok: false,
      error: { code: "canvas_unavailable" }
    });

    deps.canvasManager.execute.mockResolvedValueOnce("scalar-value");
    const tools = createTools(deps as never);
    expect(parse(await tools.opendevbrowser_canvas.execute({
      command: "canvas.capabilities.get"
    } as never))).toMatchObject({
      ok: true,
      result: "scalar-value"
    });

    deps.canvasManager.execute.mockRejectedValueOnce(new Error("canvas boom"));
    expect(parse(await tools.opendevbrowser_canvas.execute({
      command: "canvas.plan.set"
    } as never))).toMatchObject({
      ok: false,
      error: {
        code: "canvas_failed",
        message: "canvas boom"
      }
    });

    const blockerError = Object.assign(new Error("plan missing"), {
      code: "plan_required",
      details: { auditId: "CANVAS-01" }
    });
    deps.canvasManager.execute.mockRejectedValueOnce(blockerError);
    expect(parse(await tools.opendevbrowser_canvas.execute({
      command: "canvas.document.patch"
    } as never))).toMatchObject({
      ok: false,
      error: {
        code: "plan_required",
        message: "plan missing",
        details: { auditId: "CANVAS-01" }
      }
    });
  });

  it("passes through the public canvas feedback pull-stream commands", async () => {
    const deps = createDeps();
    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    deps.canvasManager.execute
      .mockResolvedValueOnce({
        subscriptionId: "canvas_sub_1",
        cursor: "fb_1",
        heartbeatMs: 15000,
        expiresAt: null,
        initialItems: [{ id: "fb_1", cursor: "fb_1", category: "render" }],
        activeTargetIds: ["target_1"]
      })
      .mockResolvedValueOnce({
        eventType: "feedback.item",
        item: { id: "fb_2", cursor: "fb_2", category: "render" }
      })
      .mockResolvedValueOnce({
        ok: true,
        subscriptionId: "canvas_sub_1"
      });

    expect(parse(await tools.opendevbrowser_canvas.execute({
      command: "canvas.feedback.subscribe",
      params: { canvasSessionId: "canvas_1", categories: ["render"] }
    } as never))).toMatchObject({
      ok: true,
      subscriptionId: "canvas_sub_1",
      initialItems: [{ id: "fb_1", cursor: "fb_1", category: "render" }]
    });
    expect(parse(await tools.opendevbrowser_canvas.execute({
      command: "canvas.feedback.next",
      params: { canvasSessionId: "canvas_1", subscriptionId: "canvas_sub_1", timeoutMs: 5000 }
    } as never))).toMatchObject({
      ok: true,
      eventType: "feedback.item",
      item: { id: "fb_2", cursor: "fb_2", category: "render" }
    });
    expect(parse(await tools.opendevbrowser_canvas.execute({
      command: "canvas.feedback.unsubscribe",
      params: { canvasSessionId: "canvas_1", subscriptionId: "canvas_sub_1" }
    } as never))).toMatchObject({
      ok: true,
      subscriptionId: "canvas_sub_1"
    });

    expect(deps.canvasManager.execute).toHaveBeenNthCalledWith(
      1,
      "canvas.feedback.subscribe",
      { canvasSessionId: "canvas_1", categories: ["render"] }
    );
    expect(deps.canvasManager.execute).toHaveBeenNthCalledWith(
      2,
      "canvas.feedback.next",
      { canvasSessionId: "canvas_1", subscriptionId: "canvas_sub_1", timeoutMs: 5000 }
    );
    expect(deps.canvasManager.execute).toHaveBeenNthCalledWith(
      3,
      "canvas.feedback.unsubscribe",
      { canvasSessionId: "canvas_1", subscriptionId: "canvas_sub_1" }
    );
  });

  it("falls back to composed trace snapshot when manager capability is missing", async () => {
    const deps = createDeps();
    delete (deps.manager as { debugTraceSnapshot?: unknown }).debugTraceSnapshot;
    deps.manager.consolePoll.mockReturnValue({
      events: [{ seq: 1, level: "log", category: "log", text: "hello", argsPreview: "hello", ts: 1 }],
      nextSeq: 1,
      truncated: false
    });

    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    const result = parse(await tools.opendevbrowser_debug_trace_snapshot.execute({ sessionId: "s1" } as never));
    expect(result.ok).toBe(true);
    expect(deps.manager.status).toHaveBeenCalledWith("s1");
    expect(deps.manager.consolePoll).toHaveBeenCalledWith("s1", undefined, 500);
    expect(deps.manager.networkPoll).toHaveBeenCalledWith("s1", undefined, 500);
    expect(deps.manager.exceptionPoll).toHaveBeenCalledWith("s1", undefined, 500);
    expect(result.channels).toMatchObject({
      console: {
        truncated: false,
        events: [{ sessionId: "s1", requestId: expect.any(String), text: "hello" }]
      }
    });
  });

  it("uses default exception channel when exception polling capability is missing", async () => {
    const deps = createDeps();
    delete (deps.manager as { debugTraceSnapshot?: unknown }).debugTraceSnapshot;
    delete (deps.manager as { exceptionPoll?: unknown }).exceptionPoll;

    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    const defaultCursor = parse(await tools.opendevbrowser_debug_trace_snapshot.execute({ sessionId: "s1" } as never));
    expect(defaultCursor.ok).toBe(true);
    expect(defaultCursor.channels).toMatchObject({
      exception: { events: [], nextSeq: 0 }
    });

    const resumedCursor = parse(await tools.opendevbrowser_debug_trace_snapshot.execute({
      sessionId: "s1",
      sinceExceptionSeq: 7
    } as never));
    expect(resumedCursor.ok).toBe(true);
    expect(resumedCursor.channels).toMatchObject({
      exception: { events: [], nextSeq: 7 }
    });
  });

  it("derives blocker fallback status and deduped hosts from mixed network events", async () => {
    const deps = createDeps();
    delete (deps.manager as { debugTraceSnapshot?: unknown }).debugTraceSnapshot;
    deps.manager.status.mockResolvedValue({
      mode: "managed",
      activeTargetId: "t1",
      url: "https://x.com/i/flow/login",
      title: "Log in to X"
    });
    deps.manager.networkPoll.mockReturnValue({
      events: [
        { status: "bad", url: "not a url" },
        { url: "https://x.com/a" },
        { status: 403, url: "https://x.com/b" }
      ],
      nextSeq: 3,
      truncated: false
    });

    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    const result = parse(await tools.opendevbrowser_debug_trace_snapshot.execute({ sessionId: "s1" } as never));
    expect(result.ok).toBe(true);
    expect(result.meta).toMatchObject({
      blockerState: "active",
      blocker: {
        type: "auth_required",
        evidence: {
          status: 403,
          networkHosts: ["x.com"]
        }
      },
      blockerArtifacts: {
        hosts: ["x.com"]
      }
    });
  });

  it("uses fallback config defaults when prompt guard settings are unset", async () => {
    const deps = createDeps();
    delete (deps.manager as { debugTraceSnapshot?: unknown }).debugTraceSnapshot;
    const baseConfig = resolveConfig({});
    deps.config = {
      get: () => ({
        ...baseConfig,
        security: {},
        blockerDetectionThreshold: 0.7,
        blockerArtifactCaps: baseConfig.blockerArtifactCaps
      })
    } as unknown as ConfigStore;
    deps.manager.status.mockResolvedValue({
      mode: "managed",
      activeTargetId: "t1",
      url: 101 as unknown as string,
      title: null as unknown as string
    });
    deps.manager.networkPoll.mockReturnValue({
      events: [
        { status: "bad" },
        { url: 42 },
        { status: 403, url: "https://x.com/i/flow/login" }
      ],
      nextSeq: 3,
      truncated: false
    });

    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    const result = parse(await tools.opendevbrowser_debug_trace_snapshot.execute({ sessionId: "s1" } as never));
    expect(result.ok).toBe(true);
    expect(result.meta).toMatchObject({
      blockerState: "active",
      blocker: { type: "auth_required" },
      blockerArtifacts: { hosts: ["x.com"] }
    });
  });

  it("walks backward to the latest numeric network status in fallback debug traces", async () => {
    const deps = createDeps();
    delete (deps.manager as { debugTraceSnapshot?: unknown }).debugTraceSnapshot;
    deps.manager.status.mockResolvedValue({
      mode: "managed",
      activeTargetId: "t1",
      url: "https://x.com/i/flow/login",
      title: "Log in to X"
    });
    deps.manager.networkPoll.mockReturnValue({
      events: [
        { status: 401, url: "https://x.com/i/flow/login" },
        { status: "not-a-number", url: "https://x.com/trailing" }
      ],
      nextSeq: 2,
      truncated: false
    });

    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    const result = parse(await tools.opendevbrowser_debug_trace_snapshot.execute({ sessionId: "s1" } as never));
    expect(result.ok).toBe(true);
    expect(result.meta).toMatchObject({
      blockerState: "active",
      blocker: {
        evidence: {
          status: 401
        }
      }
    });
  });

  it("returns debug snapshot failure when fallback channels throw", async () => {
    const deps = createDeps();
    delete (deps.manager as { debugTraceSnapshot?: unknown }).debugTraceSnapshot;
    deps.manager.status.mockRejectedValueOnce(new Error("status boom"));

    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    const result = parse(await tools.opendevbrowser_debug_trace_snapshot.execute({ sessionId: "s1" } as never));
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({
      code: "debug_trace_snapshot_failed",
      message: "status boom"
    });
  });

  it("includes warnings when present", async () => {
    const deps = createDeps();
    deps.manager.launch.mockResolvedValue({
      sessionId: "s1",
      mode: "managed",
      activeTargetId: "t1",
      warnings: ["warn"],
      wsEndpoint: "ws://"
    });
    deps.manager.connect.mockResolvedValue({
      sessionId: "s1",
      mode: "cdpConnect",
      activeTargetId: "t1",
      warnings: ["warn"],
      wsEndpoint: "ws://"
    });

    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    const launchResult = parse(await tools.opendevbrowser_launch.execute({ noExtension: true } as never));
    expect(launchResult.warnings).toEqual(["warn"]);

    const connectResult = parse(await tools.opendevbrowser_connect.execute({ host: "127.0.0.1" } as never));
    expect(connectResult.warnings).toEqual(["warn"]);
  });

  it("omits warnings when launch returns none", async () => {
    const deps = createDeps();
    deps.manager.launch.mockResolvedValue({
      sessionId: "s1",
      mode: "managed",
      activeTargetId: "t1",
      wsEndpoint: "ws://"
    });
    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    const launchResult = parse(await tools.opendevbrowser_launch.execute({ noExtension: true } as never));
    expect(launchResult.warnings).toBeUndefined();
  });

  it("uses relay when available", async () => {
    const deps = createDeps();
    const relay = {
      status: () => ({ extensionConnected: true }),
      getOpsUrl: () => "ws://relay"
    };
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...deps, relay } as never);

    const launchResult = parse(await tools.opendevbrowser_launch.execute({} as never));
    expect(launchResult.mode).toBe("extension");
    expect(deps.manager.connectRelay).toHaveBeenCalledWith("ws://relay");
  });

  it("uses legacy relay when extensionLegacy is set", async () => {
    const deps = createDeps();
    const relay = {
      status: () => ({ extensionConnected: true }),
      getCdpUrl: () => "ws://relay-legacy"
    };
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...deps, relay } as never);

    const launchResult = parse(await tools.opendevbrowser_launch.execute({ extensionLegacy: true } as never));
    expect(launchResult.mode).toBe("extension");
    expect(deps.manager.connectRelay).toHaveBeenCalledWith("ws://relay-legacy");
  });

  it("uses observed status when local relay is disconnected", async () => {
    const deps = createDeps();
    const relay = {
      status: () => ({ extensionConnected: false }),
      getOpsUrl: () => "ws://relay"
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        instanceId: "observed-12345678",
        running: true,
        port: 8787,
        extensionConnected: true,
        extensionHandshakeComplete: true,
        opsConnected: false,
        cdpConnected: false,
        pairingRequired: false
      })
    }));
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...deps, relay } as never);

    const launchResult = parse(await tools.opendevbrowser_launch.execute({} as never));
    expect(launchResult.mode).toBe("extension");
    expect(deps.manager.connectRelay).toHaveBeenCalledWith("ws://relay");
  });

  it("fails when extension-only is requested without a relay", async () => {
    const deps = createDeps();
    const relay = {
      status: () => ({ extensionConnected: false }),
      getOpsUrl: () => "ws://relay"
    };
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...deps, relay } as never);

    const launchResult = parse(await tools.opendevbrowser_launch.execute({ extensionOnly: true } as never));
    expect(launchResult.ok).toBe(false);
  });

  it("fails when extension-only relay connection errors", async () => {
    const deps = createDeps();
    deps.manager.connectRelay.mockRejectedValue(new Error("relay failed"));
    const relay = {
      status: () => ({ extensionConnected: true }),
      getOpsUrl: () => "ws://relay"
    };
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...deps, relay } as never);

    const launchResult = parse(await tools.opendevbrowser_launch.execute({ extensionOnly: true } as never));
    expect(launchResult.ok).toBe(false);
    expect(String(launchResult.error?.message)).toContain("relay failed");
  });

  it("surfaces unauthorized relay connection errors", async () => {
    const deps = createDeps();
    deps.manager.connectRelay.mockRejectedValue(new Error("401 Unauthorized"));
    const relay = {
      status: () => ({ extensionConnected: true }),
      getOpsUrl: () => "ws://relay"
    };
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...deps, relay } as never);

    const launchResult = parse(await tools.opendevbrowser_launch.execute({ extensionOnly: true } as never));
    expect(launchResult.ok).toBe(false);
    expect(String(launchResult.error?.message)).toContain("relay /ops unauthorized");
  });

  it("falls back when relay connect fails", async () => {
    const deps = createDeps();
    deps.manager.connectRelay.mockRejectedValue(new Error("relay failed"));
    const relay = {
      status: () => ({ extensionConnected: true }),
      getOpsUrl: () => "ws://relay"
    };
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...deps, relay } as never);

    const launchResult = parse(await tools.opendevbrowser_launch.execute({} as never));
    expect(launchResult.ok).toBe(false);
    expect(deps.manager.launch).not.toHaveBeenCalled();
  });

  it("launches managed headless when requested", async () => {
    const deps = createDeps();
    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    await tools.opendevbrowser_launch.execute({ noExtension: true, headless: true } as never);
    expect(deps.manager.launch).toHaveBeenCalledWith(expect.objectContaining({ headless: true }));
  });

  it("rejects extension-mode headless launch attempts with unsupported_mode", async () => {
    const deps = createDeps();
    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    const launchResult = parse(await tools.opendevbrowser_launch.execute({ headless: true } as never));
    expect(launchResult.ok).toBe(false);
    expect(launchResult.error).toMatchObject({
      code: "unsupported_mode"
    });
    expect(deps.manager.connectRelay).not.toHaveBeenCalled();
    expect(deps.manager.launch).not.toHaveBeenCalled();
  });

  it("returns managed failure message when managed launch fails", async () => {
    const deps = createDeps();
    deps.manager.launch.mockRejectedValue(new Error("managed failed"));
    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    const launchResult = parse(await tools.opendevbrowser_launch.execute({ noExtension: true } as never));
    expect(launchResult.ok).toBe(false);
    expect(String(launchResult.error?.message)).toContain("Managed session failed");
  });

  it("includes relayUrl fallback in diagnostics when relay URL is missing", async () => {
    const deps = createDeps();
    const relay = {
      status: () => ({ extensionConnected: false }),
      getOpsUrl: () => null
    };
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...deps, relay } as never);

    const launchResult = parse(await tools.opendevbrowser_launch.execute({} as never));
    expect(launchResult.ok).toBe(false);
    expect(String(launchResult.error?.message)).toContain("relayUrl=ws://127.0.0.1:8787/ops");
  });

  it("adds relayUrl_null hint when relay URL cannot be resolved", async () => {
    const deps = createDeps();
    deps.config.set({ ...deps.config.get(), relayPort: 0 });
    const relay = {
      status: () => ({ extensionConnected: false }),
      getOpsUrl: () => null
    };
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...deps, relay } as never);

    const launchResult = parse(await tools.opendevbrowser_launch.execute({ extensionOnly: true } as never));
    expect(launchResult.ok).toBe(false);
    expect(String(launchResult.error?.message)).toContain("relayUrl=null");
    expect(String(launchResult.error?.message)).toContain("hint=relayUrl_null");
    expect(String(launchResult.error?.message)).toContain("observed@?=none");
  });

  it("adds mismatch hint when observed status disagrees", async () => {
    const deps = createDeps();
    deps.manager.connectRelay.mockRejectedValue(new Error("relay failed"));
    const relay = {
      status: () => ({ extensionConnected: false, instanceId: "local-12345678" }),
      getOpsUrl: () => "ws://relay"
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        instanceId: "observed-12345678",
        running: true,
        port: 8787,
        extensionConnected: true,
        extensionHandshakeComplete: true,
        opsConnected: false,
        cdpConnected: false,
        pairingRequired: true
      })
    }));
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...deps, relay } as never);

    const launchResult = parse(await tools.opendevbrowser_launch.execute({ extensionOnly: true } as never));
    expect(launchResult.ok).toBe(false);
    expect(String(launchResult.error?.message)).toContain("hint=possible_mismatch");
    expect(String(launchResult.error?.message)).toContain("observed@");
  });

  it("adds mismatch hint when instance ids differ", async () => {
    const deps = createDeps();
    deps.manager.connectRelay.mockRejectedValue(new Error("relay failed"));
    const relay = {
      status: () => ({ extensionConnected: true, instanceId: "local-aaaaaaaa" }),
      getOpsUrl: () => "ws://relay"
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        instanceId: "observed-bbbbbbbb",
        running: true,
        port: 8787,
        extensionConnected: true,
        extensionHandshakeComplete: true,
        opsConnected: false,
        cdpConnected: false,
        pairingRequired: true
      })
    }));
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...deps, relay } as never);

    const launchResult = parse(await tools.opendevbrowser_launch.execute({ extensionOnly: true } as never));
    expect(launchResult.ok).toBe(false);
    expect(String(launchResult.error?.message)).toContain("hint=possible_mismatch");
  });

  it("retries mismatch once when extension-only is missing and ids differ", async () => {
    const deps = createDeps();
    const ensureHub = vi.fn().mockResolvedValue(undefined);
    const relay = {
      status: vi.fn().mockReturnValue({
        extensionConnected: false,
        extensionHandshakeComplete: false,
        instanceId: "local-12345678",
        port: 8787
      }),
      getOpsUrl: () => "ws://relay",
      refresh: vi.fn().mockResolvedValue(undefined)
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        instanceId: "observed-12345678",
        running: true,
        port: 8787,
        extensionConnected: false,
        extensionHandshakeComplete: false,
        opsConnected: false,
        cdpConnected: false,
        pairingRequired: false
      })
    }));
    const { createLaunchTool } = await import("../src/tools/launch");
    const tool = createLaunchTool({ ...deps, relay, ensureHub } as never);

    const launchResult = parse(await tool.execute({ extensionOnly: true } as never));
    expect(launchResult.ok).toBe(false);
    expect(ensureHub).toHaveBeenCalledTimes(1);
  });

  it("retries mismatch once when relay is not ready without extension-only", async () => {
    const deps = createDeps();
    const ensureHub = vi.fn().mockResolvedValue(undefined);
    const relay = {
      status: vi.fn().mockReturnValue({
        extensionConnected: false,
        extensionHandshakeComplete: false,
        instanceId: "local-aaaaaaaa",
        port: 8787
      }),
      getOpsUrl: () => "ws://relay",
      refresh: vi.fn().mockResolvedValue(undefined)
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        instanceId: "observed-bbbbbbbb",
        running: true,
        port: 8787,
        extensionConnected: false,
        extensionHandshakeComplete: false,
        opsConnected: false,
        cdpConnected: false,
        pairingRequired: false
      })
    }));
    const { createLaunchTool } = await import("../src/tools/launch");
    const tool = createLaunchTool({ ...deps, relay, ensureHub } as never);

    const launchResult = parse(await tool.execute({} as never));
    expect(launchResult.ok).toBe(false);
    expect(ensureHub).toHaveBeenCalledTimes(1);
  });

  it("retries hub mismatch once when ensureHub is available", async () => {
    const deps = createDeps();
    deps.manager.connectRelay.mockRejectedValue(new Error("relay failed"));
    const ensureHub = vi.fn().mockResolvedValue(undefined);
    const relay = {
      status: vi.fn().mockReturnValue({ extensionConnected: false, instanceId: "local-12345678" }),
      getOpsUrl: () => "ws://relay",
      refresh: vi.fn().mockResolvedValue(undefined)
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        instanceId: "observed-12345678",
        running: true,
        port: 8787,
        extensionConnected: true,
        extensionHandshakeComplete: true,
        opsConnected: false,
        cdpConnected: false,
        pairingRequired: false
      })
    }));
    const { createLaunchTool } = await import("../src/tools/launch");
    const tool = createLaunchTool({ ...deps, relay, ensureHub } as never);

    const launchResult = parse(await tool.execute({ extensionOnly: true } as never));
    expect(launchResult.ok).toBe(false);
    expect(ensureHub).toHaveBeenCalledTimes(1);
    expect(relay.refresh).toHaveBeenCalled();
  });

  it("handles observed status fetch failures gracefully", async () => {
    const deps = createDeps();
    const relay = {
      status: () => ({ extensionConnected: false }),
      getOpsUrl: () => "ws://relay"
    };
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fetch failed")));
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...deps, relay } as never);

    const launchResult = parse(await tools.opendevbrowser_launch.execute({ extensionOnly: true } as never));
    expect(launchResult.ok).toBe(false);
    expect(String(launchResult.error?.message)).toContain("observed@");
  });

  it("handles missing fetch during observed status lookup", async () => {
    const deps = createDeps();
    const relay = {
      status: () => ({ extensionConnected: false }),
      getOpsUrl: () => "ws://relay"
    };
    vi.stubGlobal("fetch", undefined as unknown as typeof fetch);
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...deps, relay } as never);

    const launchResult = parse(await tools.opendevbrowser_launch.execute({ extensionOnly: true } as never));
    expect(launchResult.ok).toBe(false);
    expect(String(launchResult.error?.message)).toContain("observed@");
  });

  it("handles observed status payload without instanceId", async () => {
    const deps = createDeps();
    const relay = {
      status: () => ({ extensionConnected: false }),
      getOpsUrl: () => "ws://relay"
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({})
    }));
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...deps, relay } as never);

    const launchResult = parse(await tools.opendevbrowser_launch.execute({ extensionOnly: true } as never));
    expect(launchResult.ok).toBe(false);
    expect(String(launchResult.error?.message)).toContain("observed@");
  });

  it("handles observed status payload without port", async () => {
    const deps = createDeps();
    const relay = {
      status: () => ({ extensionConnected: false }),
      getOpsUrl: () => "ws://relay"
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        instanceId: "observed-12345678",
        running: true,
        extensionConnected: true,
        extensionHandshakeComplete: true,
        opsConnected: false,
        cdpConnected: false,
        pairingRequired: true
      })
    }));
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...deps, relay } as never);

    const launchResult = parse(await tools.opendevbrowser_launch.execute({ extensionOnly: true } as never));
    expect(launchResult.mode).toBe("extension");
    expect(deps.manager.connectRelay).toHaveBeenCalledWith("ws://relay");
  });

  it("skips observed status when relay port is invalid", async () => {
    const deps = createDeps();
    deps.config.set({ ...deps.config.get(), relayPort: 0 });
    const relay = {
      status: () => ({ extensionConnected: false }),
      getOpsUrl: () => "ws://relay"
    };
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...deps, relay } as never);

    const launchResult = parse(await tools.opendevbrowser_launch.execute({ extensionOnly: true } as never));
    expect(launchResult.ok).toBe(false);
    expect(String(launchResult.error?.message)).toContain("observed@?=none");
  });

  it("uses relay status port when available", async () => {
    const deps = createDeps();
    const relay = {
      status: () => ({ extensionConnected: false, port: 5555 }),
      getOpsUrl: () => "ws://relay"
    };
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...deps, relay } as never);

    const launchResult = parse(await tools.opendevbrowser_launch.execute({ extensionOnly: true } as never));
    expect(launchResult.ok).toBe(false);
    expect(String(launchResult.error?.message)).toContain("observed@5555");
  });

  it("warns when extension is not connected", async () => {
    const deps = createDeps();
    const relay = {
      status: () => ({ extensionConnected: false }),
      getOpsUrl: () => "ws://relay"
    };
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...deps, relay } as never);

    const launchResult = parse(await tools.opendevbrowser_launch.execute({} as never));
    expect(launchResult.ok).toBe(false);
  });

  it("returns guidance commands when extension is missing", async () => {
    const deps = createDeps();
    const relay = {
      status: () => ({ extensionConnected: false }),
      getOpsUrl: () => "ws://relay"
    };
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...deps, relay } as never);

    const launchResult = parse(await tools.opendevbrowser_launch.execute({} as never));
    expect(launchResult.ok).toBe(false);
    expect(String(launchResult.error?.message)).toContain("npx opendevbrowser launch --no-extension");
    expect(String(launchResult.error?.message)).toContain("opendevbrowser connect");
  });

  it("waits for extension when requested", async () => {
    vi.useFakeTimers();
    const deps = createDeps();
    let connected = false;
    let currentRelayUrl: string | null = null;
    const relay = {
      status: () => ({ extensionConnected: connected, extensionHandshakeComplete: connected, port: 8787 }),
      getOpsUrl: () => currentRelayUrl
    };
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...deps, relay } as never);

    const launchPromise = tools.opendevbrowser_launch.execute({ waitForExtension: true, waitTimeoutMs: 1000 } as never);
    connected = true;
    currentRelayUrl = "ws://relay";
    await vi.advanceTimersByTimeAsync(500);

    const launchResult = parse(await launchPromise);
    expect(launchResult.mode).toBe("extension");
    vi.useRealTimers();
  });

  it("refreshes relay status after wait when handshake is already complete", async () => {
    const deps = createDeps();
    const relay = {
      status: vi.fn().mockReturnValue({ extensionConnected: true, extensionHandshakeComplete: true, port: 8787 }),
      getOpsUrl: vi.fn().mockReturnValue("ws://relay")
    };
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...deps, relay } as never);

    const launchResult = parse(await tools.opendevbrowser_launch.execute({ waitForExtension: true } as never));
    expect(launchResult.mode).toBe("extension");
    expect(relay.status).toHaveBeenCalled();
    expect(relay.getOpsUrl).toHaveBeenCalled();
  });

  it("waits for extension using observed status", async () => {
    const deps = createDeps();
    const relay = {
      status: () => ({ extensionConnected: false, port: 8787 }),
      getOpsUrl: () => "ws://relay"
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        instanceId: "observed-12345678",
        running: true,
        port: 8787,
        extensionConnected: true,
        extensionHandshakeComplete: true,
        opsConnected: false,
        cdpConnected: false,
        pairingRequired: false
      })
    }));
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...deps, relay } as never);

    const launchResult = parse(await tools.opendevbrowser_launch.execute({ waitForExtension: true, waitTimeoutMs: 500 } as never));
    expect(launchResult.mode).toBe("extension");
    expect(deps.manager.connectRelay).toHaveBeenCalledWith("ws://relay");
  });

  it("uses observed status port when relay URL is missing", async () => {
    const deps = createDeps();
    deps.config.set({ ...deps.config.get(), relayPort: 8787 });
    const relay = {
      status: () => ({ extensionConnected: false, extensionHandshakeComplete: false }),
      getOpsUrl: () => null
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        instanceId: "observed-9999",
        running: true,
        port: 9999,
        extensionConnected: true,
        extensionHandshakeComplete: true,
        opsConnected: false,
        cdpConnected: false,
        pairingRequired: false
      })
    }));
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...deps, relay } as never);

    const launchResult = parse(await tools.opendevbrowser_launch.execute({} as never));
    expect(launchResult.mode).toBe("extension");
    expect(deps.manager.connectRelay).toHaveBeenCalledWith("ws://127.0.0.1:9999/ops");
  });

  it("uses relay status port for legacy /cdp launches when the relay omits a cdp url", async () => {
    const deps = createDeps();
    const relay = {
      status: () => ({ extensionConnected: true, extensionHandshakeComplete: true, port: 8787 }),
      getCdpUrl: () => null
    };
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...deps, relay } as never);

    const launchResult = parse(await tools.opendevbrowser_launch.execute({ extensionLegacy: true } as never));
    expect(launchResult.mode).toBe("extension");
    expect(deps.manager.connectRelay).toHaveBeenCalledWith("ws://127.0.0.1:8787/cdp");
  });

  it("uses observed status port for legacy /cdp launches when the relay urls stay unavailable", async () => {
    const deps = createDeps();
    deps.config.set({ ...deps.config.get(), relayPort: 8787 });
    const relay = {
      status: () => ({ extensionConnected: false, extensionHandshakeComplete: false }),
      getCdpUrl: () => null
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        instanceId: "observed-legacy-9999",
        running: true,
        port: 9999,
        extensionConnected: true,
        extensionHandshakeComplete: true,
        opsConnected: false,
        cdpConnected: false,
        pairingRequired: false
      })
    }));
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...deps, relay } as never);

    const launchResult = parse(await tools.opendevbrowser_launch.execute({ extensionLegacy: true } as never));
    expect(launchResult.mode).toBe("extension");
    expect(deps.manager.connectRelay).toHaveBeenCalledWith("ws://127.0.0.1:9999/cdp");
  });

  it("keeps the legacy fallback /cdp url after wait when a status refresh returns undefined", async () => {
    const deps = createDeps();
    const relay = {
      status: vi.fn()
        .mockReturnValueOnce({ extensionConnected: false, extensionHandshakeComplete: false, port: 8787 })
        .mockReturnValueOnce({ extensionConnected: false, extensionHandshakeComplete: false, port: 8787 })
        .mockReturnValueOnce(undefined),
      getCdpUrl: () => null
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        instanceId: "observed-legacy-wait",
        running: true,
        port: 8787,
        extensionConnected: true,
        extensionHandshakeComplete: true,
        opsConnected: false,
        cdpConnected: false,
        pairingRequired: false
      })
    }));
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...deps, relay } as never);

    const launchResult = parse(await tools.opendevbrowser_launch.execute({
      extensionLegacy: true,
      waitForExtension: true,
      waitTimeoutMs: 1000
    } as never));

    expect(launchResult.mode).toBe("extension");
    expect(deps.manager.connectRelay).toHaveBeenCalledWith("ws://127.0.0.1:8787/cdp");
  });

  it("surfaces legacy relay authorization failures against /cdp", async () => {
    const deps = createDeps();
    deps.manager.connectRelay.mockRejectedValue(new Error("401 unauthorized"));
    const relay = {
      status: () => ({ extensionConnected: true, extensionHandshakeComplete: true, port: 8787 }),
      getCdpUrl: () => "ws://relay-cdp"
    };
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...deps, relay } as never);

    const launchResult = parse(await tools.opendevbrowser_launch.execute({ extensionLegacy: true } as never));
    expect(launchResult.ok).toBe(false);
    expect(String(launchResult.error?.message)).toContain("relay /cdp unauthorized");
  });

  it("falls back to relayUrl after wait when relay URL remains null", async () => {
    vi.useFakeTimers();
    try {
      const deps = createDeps();
      let connected = false;
      const relay = {
        status: () => ({ extensionConnected: connected, extensionHandshakeComplete: connected, port: 8787 }),
        getOpsUrl: () => null
      };
      const { createTools } = await import("../src/tools");
      const tools = createTools({ ...deps, relay } as never);

      const launchPromise = tools.opendevbrowser_launch.execute({ waitForExtension: true, waitTimeoutMs: 1000 } as never);
      connected = true;
      await vi.advanceTimersByTimeAsync(500);

      const launchResult = parse(await launchPromise);
      expect(launchResult.mode).toBe("extension");
      expect(deps.manager.connectRelay).toHaveBeenCalledWith("ws://127.0.0.1:8787/ops");
    } finally {
      vi.useRealTimers();
    }
  });

  it("clamps wait timeout when non-finite", async () => {
    const deps = createDeps();
    const relay = {
      status: () => ({ extensionConnected: true, extensionHandshakeComplete: true, port: 8787 }),
      getOpsUrl: () => "ws://relay"
    };
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...deps, relay } as never);

    const launchResult = parse(await tools.opendevbrowser_launch.execute({ waitForExtension: true, waitTimeoutMs: Number.NaN } as never));
    expect(launchResult.mode).toBe("extension");
  });

  it("times out waiting for extension when it never connects", async () => {
    vi.useFakeTimers();
    const deps = createDeps();
    const relay = {
      status: () => ({ extensionConnected: false, extensionHandshakeComplete: false }),
      getOpsUrl: () => "ws://relay"
    };
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...deps, relay } as never);

    const launchPromise = tools.opendevbrowser_launch.execute({ waitForExtension: true, waitTimeoutMs: 500, extensionOnly: true } as never);
    await vi.advanceTimersByTimeAsync(4000);
    const launchResult = parse(await launchPromise);
    expect(launchResult.ok).toBe(false);
    vi.useRealTimers();
  });

  it("passes startUrl into relay connect launches", async () => {
    const deps = createDeps();
    const relay = {
      status: () => ({ extensionConnected: true }),
      getOpsUrl: () => "ws://relay"
    };
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...deps, relay } as never);

    await tools.opendevbrowser_launch.execute({ startUrl: "https://example.com" } as never);
    expect(deps.manager.connectRelay).toHaveBeenCalledWith("ws://relay", {
      startUrl: "https://example.com"
    });
    expect(deps.manager.goto).not.toHaveBeenCalled();
  });

  it("routes connect to relay when wsEndpoint matches", async () => {
    const deps = createDeps();
    const relay = {
      status: () => ({ extensionConnected: true }),
      getOpsUrl: () => "ws://relay"
    };
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...deps, relay } as never);

    const connectResult = parse(await tools.opendevbrowser_connect.execute({ wsEndpoint: "ws://relay" } as never));
    expect(connectResult.mode).toBe("extension");
    expect(deps.manager.connectRelay).toHaveBeenCalledWith("ws://relay");
  });

  it("routes connect to relay for local /ops wsEndpoint", async () => {
    const deps = createDeps();
    const relay = {
      status: () => ({ extensionConnected: true }),
      getOpsUrl: () => null
    };
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...deps, relay } as never);

    const connectResult = parse(await tools.opendevbrowser_connect.execute({ wsEndpoint: "ws://127.0.0.1:8787/ops" } as never));
    expect(connectResult.mode).toBe("extension");
    expect(deps.manager.connectRelay).toHaveBeenCalledWith("ws://127.0.0.1:8787/ops");
    expect(deps.manager.connect).not.toHaveBeenCalled();
  });

  it("routes connect to relay for local base wsEndpoint", async () => {
    const deps = createDeps();
    const relay = {
      status: () => ({ extensionConnected: true }),
      getOpsUrl: () => null
    };
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...deps, relay } as never);

    const connectResult = parse(await tools.opendevbrowser_connect.execute({ wsEndpoint: "ws://127.0.0.1:8787" } as never));
    expect(connectResult.mode).toBe("extension");
    expect(deps.manager.connectRelay).toHaveBeenCalledWith("ws://127.0.0.1:8787/ops");
    expect(deps.manager.connect).not.toHaveBeenCalled();
  });

  it("routes connect to relay for localhost /ops", async () => {
    const deps = createDeps();
    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    const connectResult = parse(await tools.opendevbrowser_connect.execute({ wsEndpoint: "ws://localhost:8787/ops" } as never));
    expect(connectResult.mode).toBe("extension");
    expect(deps.manager.connectRelay).toHaveBeenCalledWith("ws://localhost:8787/ops");
    expect(deps.manager.connect).not.toHaveBeenCalled();
  });

  it("routes connect to relay for localhost base wsEndpoint", async () => {
    const deps = createDeps();
    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    const connectResult = parse(await tools.opendevbrowser_connect.execute({ wsEndpoint: "ws://localhost:8787" } as never));
    expect(connectResult.mode).toBe("extension");
    expect(deps.manager.connectRelay).toHaveBeenCalledWith("ws://localhost:8787/ops");
    expect(deps.manager.connect).not.toHaveBeenCalled();
  });

  it("routes connect to /cdp when extensionLegacy is set for local base wsEndpoint", async () => {
    const deps = createDeps();
    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    const connectResult = parse(await tools.opendevbrowser_connect.execute({
      wsEndpoint: "ws://127.0.0.1:8787",
      extensionLegacy: true
    } as never));
    expect(connectResult.mode).toBe("extension");
    expect(deps.manager.connectRelay).toHaveBeenCalledWith("ws://127.0.0.1:8787/cdp");
    expect(deps.manager.connect).not.toHaveBeenCalled();
  });

  it("rejects local /cdp wsEndpoint without legacy opt-in", async () => {
    const deps = createDeps();
    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    const connectResult = parse(await tools.opendevbrowser_connect.execute({ wsEndpoint: "ws://127.0.0.1:8787/cdp" } as never));
    expect(connectResult.ok).toBe(false);
    expect(String(connectResult.error?.message)).toContain("extensionLegacy");
  });

  it("routes connect to relay for local /cdp with legacy opt-in", async () => {
    const deps = createDeps();
    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    const connectResult = parse(await tools.opendevbrowser_connect.execute({ wsEndpoint: "ws://127.0.0.1:8787/cdp", extensionLegacy: true } as never));
    expect(connectResult.mode).toBe("extension");
    expect(deps.manager.connectRelay).toHaveBeenCalledWith("ws://127.0.0.1:8787/cdp");
  });

  it("does not route connect to relay for non-local /cdp", async () => {
    const deps = createDeps();
    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    const connectResult = parse(await tools.opendevbrowser_connect.execute({ wsEndpoint: "ws://192.168.1.10:8787/cdp" } as never));
    expect(connectResult.mode).toBe("cdpConnect");
    expect(deps.manager.connect).toHaveBeenCalledWith(expect.objectContaining({ wsEndpoint: "ws://192.168.1.10:8787/cdp" }));
    expect(deps.manager.connectRelay).not.toHaveBeenCalled();
  });

  it("does not route connect to relay for invalid wsEndpoint URLs", async () => {
    const deps = createDeps();
    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    const connectResult = parse(await tools.opendevbrowser_connect.execute({ wsEndpoint: "not-a-url" } as never));
    expect(connectResult.mode).toBe("cdpConnect");
    expect(deps.manager.connect).toHaveBeenCalledWith(expect.objectContaining({ wsEndpoint: "not-a-url" }));
    expect(deps.manager.connectRelay).not.toHaveBeenCalled();
  });

  it("does not route connect to relay for non-ws protocols", async () => {
    const deps = createDeps();
    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    const connectResult = parse(await tools.opendevbrowser_connect.execute({ wsEndpoint: "http://localhost:8787/cdp" } as never));
    expect(connectResult.mode).toBe("cdpConnect");
    expect(deps.manager.connect).toHaveBeenCalledWith(expect.objectContaining({ wsEndpoint: "http://localhost:8787/cdp" }));
    expect(deps.manager.connectRelay).not.toHaveBeenCalled();
  });

  it("does not route connect to relay when wsEndpoint has no port", async () => {
    const deps = createDeps();
    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    const connectResult = parse(await tools.opendevbrowser_connect.execute({ wsEndpoint: "ws://localhost/cdp" } as never));
    expect(connectResult.mode).toBe("cdpConnect");
    expect(deps.manager.connect).toHaveBeenCalledWith(expect.objectContaining({ wsEndpoint: "ws://localhost/cdp" }));
    expect(deps.manager.connectRelay).not.toHaveBeenCalled();
  });

  it("does not route connect to relay for non-cdp paths", async () => {
    const deps = createDeps();
    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    const connectResult = parse(await tools.opendevbrowser_connect.execute({ wsEndpoint: "ws://127.0.0.1:8787/devtools" } as never));
    expect(connectResult.mode).toBe("cdpConnect");
    expect(deps.manager.connect).toHaveBeenCalledWith(expect.objectContaining({ wsEndpoint: "ws://127.0.0.1:8787/devtools" }));
    expect(deps.manager.connectRelay).not.toHaveBeenCalled();
  });

  it("handles tool failures", async () => {
    const deps = createDeps();
    deps.manager.click.mockRejectedValue(new Error("boom"));
    deps.manager.launch.mockRejectedValue(new Error("boom"));
    deps.skills.loadBestPractices.mockRejectedValue(new Error("boom"));
    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    const result = parse(await tools.opendevbrowser_click.execute({ sessionId: "s1", ref: "r1" } as never));
    expect(result.ok).toBe(false);

    const launchResult = parse(await tools.opendevbrowser_launch.execute({} as never));
    expect(launchResult.ok).toBe(false);

    const waitResult = parse(await tools.opendevbrowser_wait.execute({ sessionId: "s1" } as never));
    expect(waitResult.ok).toBe(false);

    const guideResult = parse(await tools.opendevbrowser_prompting_guide.execute({} as never));
    expect(guideResult.ok).toBe(false);
  });

  it("returns launch_failed when launch throws unexpectedly", async () => {
    const deps = createDeps();
    const relay = {
      status: () => { throw new Error("boom"); },
      getOpsUrl: () => "ws://relay"
    };
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...deps, relay } as never);

    const launchResult = parse(await tools.opendevbrowser_launch.execute({} as never));
    expect(launchResult.ok).toBe(false);
    expect(String(launchResult.error?.message)).toContain("boom");
  });

  it("handles manager failures across tools", async () => {
    const deps = createDeps();
    deps.manager.connect.mockRejectedValue(new Error("boom"));
    deps.manager.disconnect.mockRejectedValue(new Error("boom"));
    deps.manager.status.mockRejectedValue(new Error("boom"));
    deps.manager.listTargets.mockRejectedValue(new Error("boom"));
    deps.manager.useTarget.mockRejectedValue(new Error("boom"));
    deps.manager.newTarget.mockRejectedValue(new Error("boom"));
    deps.manager.closeTarget.mockRejectedValue(new Error("boom"));
    deps.manager.page.mockRejectedValue(new Error("boom"));
    deps.manager.listPages.mockRejectedValue(new Error("boom"));
    deps.manager.closePage.mockRejectedValue(new Error("boom"));
    deps.manager.goto.mockRejectedValue(new Error("boom"));
    deps.manager.waitForLoad.mockRejectedValue(new Error("boom"));
    deps.manager.snapshot.mockRejectedValue(new Error("boom"));
    deps.manager.hover.mockRejectedValue(new Error("boom"));
    deps.manager.press.mockRejectedValue(new Error("boom"));
    deps.manager.check.mockRejectedValue(new Error("boom"));
    deps.manager.uncheck.mockRejectedValue(new Error("boom"));
    deps.manager.type.mockRejectedValue(new Error("boom"));
    deps.manager.select.mockRejectedValue(new Error("boom"));
    deps.manager.scroll.mockRejectedValue(new Error("boom"));
    deps.manager.scrollIntoView.mockRejectedValue(new Error("boom"));
    deps.manager.domGetHtml.mockRejectedValue(new Error("boom"));
    deps.manager.domGetText.mockRejectedValue(new Error("boom"));
    deps.manager.domGetAttr.mockRejectedValue(new Error("boom"));
    deps.manager.domGetValue.mockRejectedValue(new Error("boom"));
    deps.manager.domIsVisible.mockRejectedValue(new Error("boom"));
    deps.manager.domIsEnabled.mockRejectedValue(new Error("boom"));
    deps.manager.domIsChecked.mockRejectedValue(new Error("boom"));
    deps.manager.clonePage.mockRejectedValue(new Error("boom"));
    deps.manager.cloneComponent.mockRejectedValue(new Error("boom"));
    deps.manager.perfMetrics.mockRejectedValue(new Error("boom"));
    deps.manager.screenshot.mockRejectedValue(new Error("boom"));
    deps.manager.startScreencast.mockRejectedValue(new Error("boom"));
    deps.manager.stopScreencast.mockRejectedValue(new Error("boom"));
    deps.manager.upload.mockRejectedValue(new Error("boom"));
    deps.manager.dialog.mockRejectedValue(new Error("boom"));
    deps.manager.consolePoll.mockImplementation(() => {
      throw new Error("boom");
    });
    deps.manager.networkPoll.mockImplementation(() => {
      throw new Error("boom");
    });
    deps.runner.run.mockRejectedValue(new Error("boom"));

    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    expect(parse(await tools.opendevbrowser_connect.execute({} as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_disconnect.execute({ sessionId: "s1" } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_status.execute({ sessionId: "s1" } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_targets_list.execute({ sessionId: "s1" } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_target_use.execute({ sessionId: "s1", targetId: "t1" } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_target_new.execute({ sessionId: "s1" } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_target_close.execute({ sessionId: "s1", targetId: "t1" } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_page.execute({ sessionId: "s1", name: "main" } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_list.execute({ sessionId: "s1" } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_close.execute({ sessionId: "s1", name: "main" } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_goto.execute({ sessionId: "s1", url: "https://" } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_wait.execute({ sessionId: "s1", until: "load" } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_snapshot.execute({ sessionId: "s1" } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_hover.execute({ sessionId: "s1", ref: "r1" } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_press.execute({ sessionId: "s1", key: "Enter" } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_check.execute({ sessionId: "s1", ref: "r1" } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_uncheck.execute({ sessionId: "s1", ref: "r1" } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_type.execute({ sessionId: "s1", ref: "r1", text: "hi" } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_select.execute({ sessionId: "s1", ref: "r1", values: ["v"] } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_scroll.execute({ sessionId: "s1", dy: 10 } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_scroll_into_view.execute({ sessionId: "s1", ref: "r1" } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_dom_get_html.execute({ sessionId: "s1", ref: "r1" } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_dom_get_text.execute({ sessionId: "s1", ref: "r1" } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_get_attr.execute({ sessionId: "s1", ref: "r1", name: "id" } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_get_value.execute({ sessionId: "s1", ref: "r1" } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_is_visible.execute({ sessionId: "s1", ref: "r1" } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_is_enabled.execute({ sessionId: "s1", ref: "r1" } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_is_checked.execute({ sessionId: "s1", ref: "r1" } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_run.execute({ sessionId: "s1", steps: [] } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_console_poll.execute({ sessionId: "s1" } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_network_poll.execute({ sessionId: "s1" } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_clone_page.execute({ sessionId: "s1" } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_clone_component.execute({ sessionId: "s1", ref: "r1" } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_perf.execute({ sessionId: "s1" } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_screenshot.execute({ sessionId: "s1" } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_screencast_start.execute({ sessionId: "s1" } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_screencast_stop.execute({ screencastId: "cast-1" } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_screencast_stop.execute({ sessionId: "s1", screencastId: "cast-1" } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_upload.execute({ sessionId: "s1", ref: "r1", files: ["/tmp/a.txt"] } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_dialog.execute({ sessionId: "s1" } as never)).ok).toBe(false);
  });

  it("preserves desktop result failures and reports unavailable desktop runtime", async () => {
    const deps = createDeps();
    deps.desktopRuntime.captureWindow.mockResolvedValueOnce({
      ok: false,
      code: "desktop_window_not_found",
      message: "missing window",
      audit: {
        auditId: "desktop-audit-2",
        at: "2026-04-10T01:00:00.000Z",
        recordPath: "/tmp/desktop-audit-2.json",
        artifactPaths: []
      }
    });
    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    expect(await runTool(tools, "opendevbrowser_desktop_capture_window", {
      windowId: "missing",
      reason: "capture-window"
    })).toEqual({
      ok: false,
      code: "desktop_window_not_found",
      message: "missing window",
      audit: {
        auditId: "desktop-audit-2",
        at: "2026-04-10T01:00:00.000Z",
        recordPath: "/tmp/desktop-audit-2.json",
        artifactPaths: []
      }
    });

    const unavailableTools = createTools({ ...deps, desktopRuntime: undefined } as never);
    expect(parse(await unavailableTools.opendevbrowser_desktop_status.execute({} as never))).toMatchObject({
      ok: false,
      error: { code: "desktop_runtime_unavailable" }
    });
  });

  it("reports unavailable desktop runtime for non-status desktop tools", async () => {
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...createDeps(), desktopRuntime: undefined } as never) as Record<string, ExecutableTool>;

    await expectToolCases(tools, [
      ["opendevbrowser_desktop_windows", { reason: "inventory" }, { ok: false, error: { code: "desktop_runtime_unavailable" } }],
      ["opendevbrowser_desktop_active_window", { reason: "active" }, { ok: false, error: { code: "desktop_runtime_unavailable" } }],
      ["opendevbrowser_desktop_capture_desktop", { reason: "capture-desktop" }, { ok: false, error: { code: "desktop_runtime_unavailable" } }],
      ["opendevbrowser_desktop_capture_window", { windowId: "window-1", reason: "capture-window" }, { ok: false, error: { code: "desktop_runtime_unavailable" } }],
      ["opendevbrowser_desktop_accessibility_snapshot", { reason: "accessibility", windowId: "window-1" }, { ok: false, error: { code: "desktop_runtime_unavailable" } }]
    ]);
  });

  it("reports desktop wrapper failures when runtime methods throw", async () => {
    const deps = createDeps();
    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never) as Record<string, ExecutableTool>;
    const cases = [
      {
        trigger: () => deps.desktopRuntime.status.mockRejectedValueOnce(new Error("status boom")),
        name: "opendevbrowser_desktop_status",
        args: {},
        code: "desktop_status_failed"
      },
      {
        trigger: () => deps.desktopRuntime.listWindows.mockRejectedValueOnce(new Error("windows boom")),
        name: "opendevbrowser_desktop_windows",
        args: { reason: "inventory" },
        code: "desktop_windows_failed"
      },
      {
        trigger: () => deps.desktopRuntime.activeWindow.mockRejectedValueOnce(new Error("active boom")),
        name: "opendevbrowser_desktop_active_window",
        args: { reason: "active" },
        code: "desktop_active_window_failed"
      },
      {
        trigger: () => deps.desktopRuntime.captureDesktop.mockRejectedValueOnce(new Error("capture desktop boom")),
        name: "opendevbrowser_desktop_capture_desktop",
        args: { reason: "capture-desktop" },
        code: "desktop_capture_desktop_failed"
      },
      {
        trigger: () => deps.desktopRuntime.captureWindow.mockRejectedValueOnce(new Error("capture window boom")),
        name: "opendevbrowser_desktop_capture_window",
        args: { windowId: "window-1", reason: "capture-window" },
        code: "desktop_capture_window_failed"
      },
      {
        trigger: () => deps.desktopRuntime.accessibilitySnapshot.mockRejectedValueOnce(new Error("accessibility boom")),
        name: "opendevbrowser_desktop_accessibility_snapshot",
        args: { reason: "accessibility", windowId: "window-1" },
        code: "desktop_accessibility_snapshot_failed"
      }
    ] as const;

    for (const testCase of cases) {
      testCase.trigger();
      expect(await runTool(tools, testCase.name, testCase.args)).toMatchObject({
        ok: false,
        error: { code: testCase.code }
      });
    }
  });

  it("status tool handles null extensionPath", async () => {
    const deps = createDeps();
    deps.getExtensionPath.mockReturnValue(null);
    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    const result = parse(await tools.opendevbrowser_status.execute({ sessionId: "s1" } as never));
    expect(result.ok).toBe(true);
    expect(result.extensionPath).toBeUndefined();
  });

  it("status tool returns daemon status in hub mode", async () => {
    const deps = createDeps();
    deps.config.set({ ...deps.config.get(), relayToken: "token", relayPort: 8787 });
    vi.resetModules();
    const daemonStatus = {
      ok: true,
      pid: 123,
      hub: { instanceId: "hub-1" },
      relay: {
        running: true,
        port: 8787,
        extensionConnected: true,
        extensionHandshakeComplete: true,
        cdpConnected: false,
        pairingRequired: true,
        instanceId: "relay-1",
        epoch: 1
      },
      binding: null
    };
    vi.doMock("../src/cli/daemon-status", () => ({
      fetchDaemonStatusFromMetadata: vi.fn().mockResolvedValue(daemonStatus)
    }));
    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    const result = parse(await tools.opendevbrowser_status.execute({} as never));
    expect(result.ok).toBe(true);
    expect(result.hubEnabled).toBe(true);
    expect(result.daemon).toEqual(daemonStatus);

    vi.doUnmock("../src/cli/daemon-status");
  });

  it("status tool fails in hub mode when daemon is missing", async () => {
    const deps = createDeps();
    deps.config.set({ ...deps.config.get(), relayToken: "token", relayPort: 8787 });
    vi.resetModules();
    vi.doMock("../src/cli/daemon-status", () => ({
      fetchDaemonStatusFromMetadata: vi.fn().mockResolvedValue(null)
    }));
    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    const result = parse(await tools.opendevbrowser_status.execute({} as never));
    expect(result.ok).toBe(false);
    expect(String(result.error?.message)).toContain("Daemon not running");

    vi.doUnmock("../src/cli/daemon-status");
  });

  it("status tool returns session fields and update hint in hub mode", async () => {
    const deps = createDeps();
    deps.config.set({ ...deps.config.get(), relayToken: "token", relayPort: 8787, checkForUpdates: true });
    vi.resetModules();
    const daemonStatus = {
      ok: true,
      pid: 123,
      hub: { instanceId: "hub-1" },
      relay: {
        running: true,
        port: 8787,
        extensionConnected: true,
        extensionHandshakeComplete: true,
        cdpConnected: false,
        pairingRequired: true,
        instanceId: "relay-1",
        epoch: 1
      },
      binding: null
    };
    vi.doMock("../src/cli/daemon-status", () => ({
      fetchDaemonStatusFromMetadata: vi.fn().mockResolvedValue(daemonStatus)
    }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: "9.9.9" })
    }));

    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    const result = parse(await tools.opendevbrowser_status.execute({ sessionId: "s1" } as never));
    expect(result.mode).toBe("managed");
    expect(result.updateHint).toContain("Update available");

    vi.doUnmock("../src/cli/daemon-status");
  });

  it("status tool omits update hint and extension path in hub mode when latest matches", async () => {
    const deps = createDeps();
    deps.config.set({ ...deps.config.get(), relayToken: "token", relayPort: 8787, checkForUpdates: true });
    deps.getExtensionPath.mockReturnValue(null);
    vi.resetModules();
    const daemonStatus = {
      ok: true,
      pid: 123,
      hub: { instanceId: "hub-1" },
      relay: {
        running: true,
        port: 8787,
        extensionConnected: true,
        extensionHandshakeComplete: true,
        cdpConnected: false,
        pairingRequired: true,
        instanceId: "relay-1",
        epoch: 1
      },
      binding: null
    };
    vi.doMock("../src/cli/daemon-status", () => ({
      fetchDaemonStatusFromMetadata: vi.fn().mockResolvedValue(daemonStatus)
    }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: "0.1.0" })
    }));

    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    const result = parse(await tools.opendevbrowser_status.execute({} as never));
    expect(result.ok).toBe(true);
    expect(result.updateHint).toBeUndefined();
    expect(result.extensionPath).toBeUndefined();

    vi.doUnmock("../src/cli/daemon-status");
  });

  it("status tool fails without sessionId when hub is disabled", async () => {
    const deps = createDeps();
    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    const result = parse(await tools.opendevbrowser_status.execute({} as never));
    expect(result.ok).toBe(false);
    expect(String(result.error?.message)).toContain("Missing sessionId");
  });

  it("status tool skips update check when disabled", async () => {
    const deps = createDeps();
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: "9.9.9" })
    });
    globalThis.fetch = fetchMock as never;

    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    const result = parse(await tools.opendevbrowser_status.execute({ sessionId: "s1" } as never));
    expect(result.updateHint).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();

    globalThis.fetch = originalFetch;
  });

  it("status tool includes update hint when enabled", async () => {
    const deps = createDeps();
    deps.config.set({ ...deps.config.get(), checkForUpdates: true });
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: "9.9.9" })
    });
    globalThis.fetch = fetchMock as never;

    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    const result = parse(await tools.opendevbrowser_status.execute({ sessionId: "s1" } as never));
    expect(result.version).toBeDefined();
    expect(result.updateHint).toContain("Update available");
    expect(fetchMock).toHaveBeenCalled();

    globalThis.fetch = originalFetch;
  });

  it("status tool omits update hint when latest matches installed", async () => {
    const deps = createDeps();
    deps.config.set({ ...deps.config.get(), checkForUpdates: true });
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: "0.1.0" })
    });
    globalThis.fetch = fetchMock as never;

    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    const result = parse(await tools.opendevbrowser_status.execute({ sessionId: "s1" } as never));
    expect(result.updateHint).toBeUndefined();
    expect(fetchMock).toHaveBeenCalled();

    globalThis.fetch = originalFetch;
  });

  it("status tool handles update check fetch failures", async () => {
    const deps = createDeps();
    deps.config.set({ ...deps.config.get(), checkForUpdates: true });
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    globalThis.fetch = fetchMock as never;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    const result = parse(await tools.opendevbrowser_status.execute({ sessionId: "s1" } as never));
    expect(result.updateHint).toBeUndefined();
    expect(fetchMock).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      "[opendevbrowser] Update check failed:",
      expect.any(Error)
    );

    warnSpy.mockRestore();
    globalThis.fetch = originalFetch;
  });

  it("status tool handles non-ok registry responses", async () => {
    const deps = createDeps();
    deps.config.set({ ...deps.config.get(), checkForUpdates: true });
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    globalThis.fetch = fetchMock as never;

    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    const result = parse(await tools.opendevbrowser_status.execute({ sessionId: "s1" } as never));
    expect(result.updateHint).toBeUndefined();
    expect(fetchMock).toHaveBeenCalled();

    globalThis.fetch = originalFetch;
  });

  it("status tool ignores non-string registry versions", async () => {
    const deps = createDeps();
    deps.config.set({ ...deps.config.get(), checkForUpdates: true });
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: 123 })
    });
    globalThis.fetch = fetchMock as never;

    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    const result = parse(await tools.opendevbrowser_status.execute({ sessionId: "s1" } as never));
    expect(result.updateHint).toBeUndefined();
    expect(fetchMock).toHaveBeenCalled();

    globalThis.fetch = originalFetch;
  });

  it("status tool handles path resolution failures", async () => {
    const deps = createDeps();
    deps.config.set({ ...deps.config.get(), checkForUpdates: true });
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as never;

    vi.resetModules();
    vi.doMock("url", async () => {
      const actual = await vi.importActual<typeof import("url")>("url");
      return {
        ...actual,
        fileURLToPath: () => {
          throw new Error("boom");
        }
      };
    });

    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    const result = parse(await tools.opendevbrowser_status.execute({ sessionId: "s1" } as never));
    expect(result.version).toBeUndefined();
    expect(result.updateHint).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();

    vi.doUnmock("url");
    vi.resetModules();
    globalThis.fetch = originalFetch;
  });

  it("status tool handles version lookup failures", async () => {
    const deps = createDeps();
    deps.config.set({ ...deps.config.get(), checkForUpdates: true });
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as never;
    vi.resetModules();
    vi.doMock("fs", async () => {
      const actual = await vi.importActual<typeof import("fs")>("fs");
      return {
        ...actual,
        readFileSync: () => {
          throw new Error("boom");
        }
      };
    });

    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    const result = parse(await tools.opendevbrowser_status.execute({ sessionId: "s1" } as never));
    expect(result.version).toBeUndefined();
    expect(result.updateHint).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();

    vi.doUnmock("fs");
    vi.resetModules();
    globalThis.fetch = originalFetch;
  });

  it("normalizes run steps", async () => {
    const deps = createDeps();
    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    await tools.opendevbrowser_run.execute({
      sessionId: "s1",
      steps: [{ action: "snapshot" }],
      maxSnapshotChars: 123
    } as never);

    let call = deps.runner.run.mock.calls[0];
    let steps = call[1] as Array<{ action: string; args?: Record<string, unknown> }>;
    expect(steps[0].args?.maxChars).toBe(123);

    deps.runner.run.mockClear();
    await tools.opendevbrowser_run.execute({
      sessionId: "s1",
      steps: [{ action: "snapshot", args: { maxChars: 10 } }],
      maxSnapshotChars: 123
    } as never);
    call = deps.runner.run.mock.calls[0];
    steps = call[1] as Array<{ action: string; args?: Record<string, unknown> }>;
    expect(steps[0].args?.maxChars).toBe(10);

    deps.runner.run.mockClear();
    await tools.opendevbrowser_run.execute({
      sessionId: "s1",
      steps: [{ action: "goto", args: { url: "https://" } }],
      maxSnapshotChars: 123
    } as never);
    call = deps.runner.run.mock.calls[0];
    steps = call[1] as Array<{ action: string; args?: Record<string, unknown> }>;
    expect(steps[0].action).toBe("goto");

    deps.runner.run.mockClear();
    await tools.opendevbrowser_run.execute({
      sessionId: "s1",
      steps: [{ action: "snapshot" }]
    } as never);
    call = deps.runner.run.mock.calls[0];
    steps = call[1] as Array<{ action: string; args?: Record<string, unknown> }>;
    expect(steps[0].args).toBeUndefined();
  });
});
