import * as fs from "fs";
import * as os from "os";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ConfigStore, resolveConfig } from "../src/config";

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
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
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
  const getExtensionPath = vi.fn().mockReturnValue("/path/to/extension");

  return { manager, runner, config, skills, getExtensionPath };
};

const parse = (value: string) => JSON.parse(value) as { ok: boolean } & Record<string, unknown>;

describe("tools", () => {
  it("executes tool handlers", async () => {
    const deps = createDeps();
    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    expect(parse(await tools.opendevbrowser_launch.execute({ profile: "default", noExtension: true } as never))).toMatchObject({ ok: true });
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

    const connectResult = parse(await tools.opendevbrowser_connect.execute({} as never));
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
      getCdpUrl: () => "ws://relay"
    };
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...deps, relay } as never);

    const launchResult = parse(await tools.opendevbrowser_launch.execute({} as never));
    expect(launchResult.mode).toBe("extension");
    expect(deps.manager.connectRelay).toHaveBeenCalledWith("ws://relay");
  });

  it("uses observed status when local relay is disconnected", async () => {
    const deps = createDeps();
    const relay = {
      status: () => ({ extensionConnected: false }),
      getCdpUrl: () => "ws://relay"
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        instanceId: "observed-12345678",
        running: true,
        port: 8787,
        extensionConnected: true,
        extensionHandshakeComplete: true,
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
      getCdpUrl: () => "ws://relay"
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
      getCdpUrl: () => "ws://relay"
    };
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...deps, relay } as never);

    const launchResult = parse(await tools.opendevbrowser_launch.execute({ extensionOnly: true } as never));
    expect(launchResult.ok).toBe(false);
    expect(String(launchResult.error?.message)).toContain("relay failed");
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
      getCdpUrl: () => null
    };
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...deps, relay } as never);

    const launchResult = parse(await tools.opendevbrowser_launch.execute({} as never));
    expect(launchResult.ok).toBe(false);
    expect(String(launchResult.error?.message)).toContain("relayUrl=ws://127.0.0.1:8787/cdp");
  });

  it("adds relayUrl_null hint when relay URL cannot be resolved", async () => {
    const deps = createDeps();
    deps.config.set({ ...deps.config.get(), relayPort: 0 });
    const relay = {
      status: () => ({ extensionConnected: false }),
      getCdpUrl: () => null
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
      getCdpUrl: () => "ws://relay"
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        instanceId: "observed-12345678",
        running: true,
        port: 8787,
        extensionConnected: true,
        extensionHandshakeComplete: true,
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
      getCdpUrl: () => "ws://relay"
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        instanceId: "observed-bbbbbbbb",
        running: true,
        port: 8787,
        extensionConnected: true,
        extensionHandshakeComplete: true,
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

  it("handles observed status fetch failures gracefully", async () => {
    const deps = createDeps();
    const relay = {
      status: () => ({ extensionConnected: false }),
      getCdpUrl: () => "ws://relay"
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
      getCdpUrl: () => "ws://relay"
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
      getCdpUrl: () => "ws://relay"
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
      getCdpUrl: () => "ws://relay"
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        instanceId: "observed-12345678",
        running: true,
        extensionConnected: true,
        extensionHandshakeComplete: true,
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
      getCdpUrl: () => "ws://relay"
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
      getCdpUrl: () => "ws://relay"
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
      getCdpUrl: () => "ws://relay"
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
      getCdpUrl: () => "ws://relay"
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
      getCdpUrl: () => currentRelayUrl
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

  it("waits for extension using observed status", async () => {
    const deps = createDeps();
    const relay = {
      status: () => ({ extensionConnected: false, port: 8787 }),
      getCdpUrl: () => "ws://relay"
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        instanceId: "observed-12345678",
        running: true,
        port: 8787,
        extensionConnected: true,
        extensionHandshakeComplete: true,
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

  it("falls back to relayUrl after wait when relay URL remains null", async () => {
    vi.useFakeTimers();
    try {
      const deps = createDeps();
      let connected = false;
      const relay = {
        status: () => ({ extensionConnected: connected, extensionHandshakeComplete: connected, port: 8787 }),
        getCdpUrl: () => null
      };
      const { createTools } = await import("../src/tools");
      const tools = createTools({ ...deps, relay } as never);

      const launchPromise = tools.opendevbrowser_launch.execute({ waitForExtension: true, waitTimeoutMs: 1000 } as never);
      connected = true;
      await vi.advanceTimersByTimeAsync(500);

      const launchResult = parse(await launchPromise);
      expect(launchResult.mode).toBe("extension");
      expect(deps.manager.connectRelay).toHaveBeenCalledWith("ws://127.0.0.1:8787/cdp");
    } finally {
      vi.useRealTimers();
    }
  });

  it("clamps wait timeout when non-finite", async () => {
    const deps = createDeps();
    const relay = {
      status: () => ({ extensionConnected: true, extensionHandshakeComplete: true, port: 8787 }),
      getCdpUrl: () => "ws://relay"
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
      getCdpUrl: () => "ws://relay"
    };
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...deps, relay } as never);

    const launchPromise = tools.opendevbrowser_launch.execute({ waitForExtension: true, waitTimeoutMs: 500, extensionOnly: true } as never);
    await vi.advanceTimersByTimeAsync(4000);
    const launchResult = parse(await launchPromise);
    expect(launchResult.ok).toBe(false);
    vi.useRealTimers();
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
    expect(connectResult.mode).toBe("extension");
    expect(deps.manager.connectRelay).toHaveBeenCalledWith("ws://relay");
  });

  it("routes connect to relay for local /cdp wsEndpoint", async () => {
    const deps = createDeps();
    const relay = {
      status: () => ({ extensionConnected: true }),
      getCdpUrl: () => null
    };
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...deps, relay } as never);

    const connectResult = parse(await tools.opendevbrowser_connect.execute({ wsEndpoint: "ws://127.0.0.1:8787/cdp" } as never));
    expect(connectResult.mode).toBe("extension");
    expect(deps.manager.connectRelay).toHaveBeenCalledWith("ws://127.0.0.1:8787/cdp");
    expect(deps.manager.connect).not.toHaveBeenCalled();
  });

  it("routes connect to relay for local base wsEndpoint", async () => {
    const deps = createDeps();
    const relay = {
      status: () => ({ extensionConnected: true }),
      getCdpUrl: () => null
    };
    const { createTools } = await import("../src/tools");
    const tools = createTools({ ...deps, relay } as never);

    const connectResult = parse(await tools.opendevbrowser_connect.execute({ wsEndpoint: "ws://127.0.0.1:8787" } as never));
    expect(connectResult.mode).toBe("extension");
    expect(deps.manager.connectRelay).toHaveBeenCalledWith("ws://127.0.0.1:8787/cdp");
    expect(deps.manager.connect).not.toHaveBeenCalled();
  });

  it("routes connect to relay for localhost /cdp", async () => {
    const deps = createDeps();
    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    const connectResult = parse(await tools.opendevbrowser_connect.execute({ wsEndpoint: "ws://localhost:8787/cdp" } as never));
    expect(connectResult.mode).toBe("extension");
    expect(deps.manager.connectRelay).toHaveBeenCalledWith("ws://localhost:8787/cdp");
    expect(deps.manager.connect).not.toHaveBeenCalled();
  });

  it("routes connect to relay for localhost base wsEndpoint", async () => {
    const deps = createDeps();
    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    const connectResult = parse(await tools.opendevbrowser_connect.execute({ wsEndpoint: "ws://localhost:8787" } as never));
    expect(connectResult.mode).toBe("extension");
    expect(deps.manager.connectRelay).toHaveBeenCalledWith("ws://localhost:8787/cdp");
    expect(deps.manager.connect).not.toHaveBeenCalled();
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
      getCdpUrl: () => "ws://relay"
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

  it("status tool handles null extensionPath", async () => {
    const deps = createDeps();
    deps.getExtensionPath.mockReturnValue(null);
    const { createTools } = await import("../src/tools");
    const tools = createTools(deps as never);

    const result = parse(await tools.opendevbrowser_status.execute({ sessionId: "s1" } as never));
    expect(result.ok).toBe(true);
    expect(result.extensionPath).toBeUndefined();
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
