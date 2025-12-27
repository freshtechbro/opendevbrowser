import { describe, it, expect, vi } from "vitest";
import { ConfigStore, resolveConfig } from "../src/config";

vi.mock("@opencode-ai/plugin", async () => {
  const { z } = await import("zod");
  const toolFn = (input: { description: string; args: unknown; execute: (...args: unknown[]) => unknown }) => input;
  toolFn.schema = z;
  return { tool: toolFn };
});

const createDeps = () => {
  const manager = {
    launch: vi.fn().mockResolvedValue({ sessionId: "s1", mode: "A", activeTargetId: "t1", warnings: [], wsEndpoint: "ws://" }),
    connect: vi.fn().mockResolvedValue({ sessionId: "s1", mode: "B", activeTargetId: "t1", warnings: [], wsEndpoint: "ws://" }),
    connectRelay: vi.fn().mockResolvedValue({ sessionId: "s1", mode: "C", activeTargetId: "t1", warnings: [], wsEndpoint: "ws://relay" }),
    disconnect: vi.fn().mockResolvedValue(undefined),
    status: vi.fn().mockResolvedValue({ mode: "A", activeTargetId: "t1", url: "https://", title: "Title" }),
    listTargets: vi.fn().mockResolvedValue({ activeTargetId: "t1", targets: [] }),
    useTarget: vi.fn().mockResolvedValue({ activeTargetId: "t2", url: "https://", title: "Title" }),
    newTarget: vi.fn().mockResolvedValue({ targetId: "t3" }),
    closeTarget: vi.fn().mockResolvedValue(undefined),
    page: vi.fn().mockResolvedValue({ targetId: "t1", created: true, url: "https://", title: "Title" }),
    listPages: vi.fn().mockResolvedValue({ pages: [{ name: "main", targetId: "t1", url: "https://", title: "Title" }] }),
    closePage: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue({ finalUrl: "https://", status: 200, timingMs: 1 }),
    waitForRef: vi.fn().mockResolvedValue({ timingMs: 1 }),
    waitForLoad: vi.fn().mockResolvedValue({ timingMs: 1 }),
    snapshot: vi.fn().mockResolvedValue({ snapshotId: "snap", content: "", truncated: false, refCount: 0, timingMs: 1 }),
    click: vi.fn().mockResolvedValue({ timingMs: 1, navigated: false }),
    type: vi.fn().mockResolvedValue({ timingMs: 1 }),
    select: vi.fn().mockResolvedValue(undefined),
    scroll: vi.fn().mockResolvedValue(undefined),
    domGetHtml: vi.fn().mockResolvedValue({ outerHTML: "<div></div>", truncated: false }),
    domGetText: vi.fn().mockResolvedValue({ text: "hi", truncated: false }),
    clonePage: vi.fn().mockResolvedValue({ component: "<Component />", css: ".css{}" }),
    cloneComponent: vi.fn().mockResolvedValue({ component: "<Component />", css: ".css{}" }),
    perfMetrics: vi.fn().mockResolvedValue({ metrics: [{ name: "Nodes", value: 1 }] }),
    screenshot: vi.fn().mockResolvedValue({ base64: "image" }),
    consolePoll: vi.fn().mockReturnValue({ events: [], nextSeq: 0 }),
    networkPoll: vi.fn().mockReturnValue({ events: [], nextSeq: 0 })
  };

  const runner = {
    run: vi.fn().mockResolvedValue({ results: [], timingMs: 1 })
  };

  const config = new ConfigStore(resolveConfig({}));
  const skills = { loadBestPractices: vi.fn().mockResolvedValue("guide") };

  return { manager, runner, config, skills };
};

const parse = (value: string) => JSON.parse(value) as { ok: boolean } & Record<string, unknown>;

describe("tools", () => {
  it("executes tool handlers", async () => {
    const deps = createDeps();
    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    expect(parse(await tools.opendevbrowser_launch.execute({ profile: "default" } as never))).toMatchObject({ ok: true });
    expect(parse(await tools.opendevbrowser_connect.execute({ host: "127.0.0.1" } as never))).toMatchObject({ ok: true });
    expect(parse(await tools.opendevbrowser_disconnect.execute({ sessionId: "s1" } as never))).toMatchObject({ ok: true });
    expect(parse(await tools.opendevbrowser_status.execute({ sessionId: "s1" } as never))).toMatchObject({ ok: true });
    expect(parse(await tools.opendevbrowser_targets_list.execute({ sessionId: "s1", includeUrls: true } as never))).toMatchObject({ ok: true });
    expect(parse(await tools.opendevbrowser_target_use.execute({ sessionId: "s1", targetId: "t1" } as never))).toMatchObject({ ok: true });
    expect(parse(await tools.opendevbrowser_target_new.execute({ sessionId: "s1" } as never))).toMatchObject({ ok: true });
    expect(parse(await tools.opendevbrowser_target_close.execute({ sessionId: "s1", targetId: "t1" } as never))).toMatchObject({ ok: true });
    expect(parse(await tools.opendevbrowser_page.execute({ sessionId: "s1", name: "main" } as never))).toMatchObject({ ok: true });
    expect(parse(await tools.opendevbrowser_list.execute({ sessionId: "s1" } as never))).toMatchObject({ ok: true });
    expect(parse(await tools.opendevbrowser_close.execute({ sessionId: "s1", name: "main" } as never))).toMatchObject({ ok: true });
    expect(parse(await tools.opendevbrowser_goto.execute({ sessionId: "s1", url: "https://" } as never))).toMatchObject({ ok: true });
    expect(parse(await tools.opendevbrowser_wait.execute({ sessionId: "s1", until: "load" } as never))).toMatchObject({ ok: true });
    expect(parse(await tools.opendevbrowser_wait.execute({ sessionId: "s1", ref: "r1" } as never))).toMatchObject({ ok: true });
    expect(parse(await tools.opendevbrowser_snapshot.execute({ sessionId: "s1" } as never))).toMatchObject({ ok: true });
    expect(parse(await tools.opendevbrowser_click.execute({ sessionId: "s1", ref: "r1" } as never))).toMatchObject({ ok: true });
    expect(parse(await tools.opendevbrowser_type.execute({ sessionId: "s1", ref: "r1", text: "hi" } as never))).toMatchObject({ ok: true });
    expect(parse(await tools.opendevbrowser_select.execute({ sessionId: "s1", ref: "r1", values: ["v"] } as never))).toMatchObject({ ok: true });
    expect(parse(await tools.opendevbrowser_scroll.execute({ sessionId: "s1", dy: 10 } as never))).toMatchObject({ ok: true });
    expect(parse(await tools.opendevbrowser_dom_get_html.execute({ sessionId: "s1", ref: "r1" } as never))).toMatchObject({ ok: true });
    expect(parse(await tools.opendevbrowser_dom_get_text.execute({ sessionId: "s1", ref: "r1" } as never))).toMatchObject({ ok: true });
    expect(parse(await tools.opendevbrowser_run.execute({ sessionId: "s1", steps: [] } as never))).toMatchObject({ ok: true });
    expect(parse(await tools.opendevbrowser_prompting_guide.execute({} as never))).toMatchObject({ ok: true });
    expect(parse(await tools.opendevbrowser_console_poll.execute({ sessionId: "s1" } as never))).toMatchObject({ ok: true });
    expect(parse(await tools.opendevbrowser_network_poll.execute({ sessionId: "s1" } as never))).toMatchObject({ ok: true });
    expect(parse(await tools.opendevbrowser_clone_page.execute({ sessionId: "s1" } as never))).toMatchObject({ ok: true });
    expect(parse(await tools.opendevbrowser_clone_component.execute({ sessionId: "s1", ref: "r1" } as never))).toMatchObject({ ok: true });
    expect(parse(await tools.opendevbrowser_perf.execute({ sessionId: "s1" } as never))).toMatchObject({ ok: true });
    expect(parse(await tools.opendevbrowser_screenshot.execute({ sessionId: "s1" } as never))).toMatchObject({ ok: true });
  });

  it("includes warnings when present", async () => {
    const deps = createDeps();
    deps.manager.launch.mockResolvedValue({
      sessionId: "s1",
      mode: "A",
      activeTargetId: "t1",
      warnings: ["warn"],
      wsEndpoint: "ws://"
    });
    deps.manager.connect.mockResolvedValue({
      sessionId: "s1",
      mode: "B",
      activeTargetId: "t1",
      warnings: ["warn"],
      wsEndpoint: "ws://"
    });

    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    const launchResult = parse(await tools.opendevbrowser_launch.execute({} as never));
    expect(launchResult.warnings).toEqual(["warn"]);

    const connectResult = parse(await tools.opendevbrowser_connect.execute({} as never));
    expect(connectResult.warnings).toEqual(["warn"]);
  });

  it("uses relay when available", async () => {
    const deps = createDeps();
    const relay = {
      status: () => ({ extensionConnected: true }),
      getCdpUrl: () => "ws://relay"
    };
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...deps, relay } as never);

    const launchResult = parse(await tools.opendevbrowser_launch.execute({} as never));
    expect(launchResult.mode).toBe("C");
    expect(deps.manager.connectRelay).toHaveBeenCalledWith("ws://relay");
  });

  it("falls back when relay connect fails", async () => {
    const deps = createDeps();
    deps.manager.connectRelay.mockRejectedValue(new Error("relay failed"));
    const relay = {
      status: () => ({ extensionConnected: true }),
      getCdpUrl: () => "ws://relay"
    };
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...deps, relay } as never);

    const launchResult = parse(await tools.opendevbrowser_launch.execute({} as never));
    expect(deps.manager.launch).toHaveBeenCalled();
    expect(launchResult.warnings).toContain("Relay connection failed; falling back to managed Chrome.");
  });

  it("navigates startUrl after relay connect", async () => {
    const deps = createDeps();
    const relay = {
      status: () => ({ extensionConnected: true }),
      getCdpUrl: () => "ws://relay"
    };
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...deps, relay } as never);

    await tools.opendevbrowser_launch.execute({ startUrl: "https://example.com" } as never);
    expect(deps.manager.goto).toHaveBeenCalledWith("s1", "https://example.com", "load", 30000);
  });

  it("routes connect to relay when wsEndpoint matches", async () => {
    const deps = createDeps();
    const relay = {
      status: () => ({ extensionConnected: true }),
      getCdpUrl: () => "ws://relay"
    };
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...deps, relay } as never);

    const connectResult = parse(await tools.opendevbrowser_connect.execute({ wsEndpoint: "ws://relay" } as never));
    expect(connectResult.mode).toBe("C");
    expect(deps.manager.connectRelay).toHaveBeenCalledWith("ws://relay");
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
    deps.manager.type.mockRejectedValue(new Error("boom"));
    deps.manager.select.mockRejectedValue(new Error("boom"));
    deps.manager.scroll.mockRejectedValue(new Error("boom"));
    deps.manager.domGetHtml.mockRejectedValue(new Error("boom"));
    deps.manager.domGetText.mockRejectedValue(new Error("boom"));
    deps.manager.clonePage.mockRejectedValue(new Error("boom"));
    deps.manager.cloneComponent.mockRejectedValue(new Error("boom"));
    deps.manager.perfMetrics.mockRejectedValue(new Error("boom"));
    deps.manager.screenshot.mockRejectedValue(new Error("boom"));
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
    expect(parse(await tools.opendevbrowser_type.execute({ sessionId: "s1", ref: "r1", text: "hi" } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_select.execute({ sessionId: "s1", ref: "r1", values: ["v"] } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_scroll.execute({ sessionId: "s1", dy: 10 } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_dom_get_html.execute({ sessionId: "s1", ref: "r1" } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_dom_get_text.execute({ sessionId: "s1", ref: "r1" } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_run.execute({ sessionId: "s1", steps: [] } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_console_poll.execute({ sessionId: "s1" } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_network_poll.execute({ sessionId: "s1" } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_clone_page.execute({ sessionId: "s1" } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_clone_component.execute({ sessionId: "s1", ref: "r1" } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_perf.execute({ sessionId: "s1" } as never)).ok).toBe(false);
    expect(parse(await tools.opendevbrowser_screenshot.execute({ sessionId: "s1" } as never)).ok).toBe(false);
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
