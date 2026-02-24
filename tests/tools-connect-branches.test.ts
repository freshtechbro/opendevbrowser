import { describe, expect, it, vi } from "vitest";
import { createConnectTool } from "../src/tools/connect";

vi.mock("@opencode-ai/plugin", async () => {
  const { z } = await import("zod");
  const toolFn = (input: { description: string; args: unknown; execute: (...args: unknown[]) => unknown }) => input;
  toolFn.schema = z;
  return { tool: toolFn };
});

const parse = (value: string): Record<string, unknown> => JSON.parse(value) as Record<string, unknown>;

const createDeps = (options: {
  opsUrl?: string | null;
  cdpUrl?: string | null;
} = {}) => {
  const manager = {
    connectRelay: vi.fn(async () => ({
      sessionId: "session-1",
      mode: "extension",
      wsEndpoint: "ws://127.0.0.1:8787/ops",
      activeTargetId: "target-1",
      warnings: []
    })),
    connect: vi.fn(async () => ({
      sessionId: "session-2",
      mode: "cdpConnect",
      wsEndpoint: "ws://127.0.0.1:9222/devtools/browser/mock",
      activeTargetId: "target-2",
      warnings: []
    }))
  };

  const relay = {
    refresh: vi.fn(async () => undefined),
    getOpsUrl: vi.fn(() => options.opsUrl ?? null),
    getCdpUrl: vi.fn(() => options.cdpUrl ?? null)
  };

  return {
    manager,
    relay
  };
};

describe("connect tool branches", () => {
  it("uses ops endpoint fallback when extensionLegacy is enabled and wsEndpoint points to /ops", async () => {
    const deps = createDeps();
    const tool = createConnectTool(deps as never);

    const result = parse(await tool.execute({
      wsEndpoint: "ws://127.0.0.1:8787/ops",
      extensionLegacy: true
    } as never));

    expect(result).toMatchObject({ ok: true });
    expect(deps.manager.connectRelay).toHaveBeenCalledWith("ws://127.0.0.1:8787/ops");
    expect(deps.manager.connect).not.toHaveBeenCalled();
  });

  it("falls back to relay status endpoint when no explicit CDP target is provided", async () => {
    const deps = createDeps({
      opsUrl: "ws://127.0.0.1:8787/ops"
    });
    const tool = createConnectTool(deps as never);

    const result = parse(await tool.execute({} as never));

    expect(result).toMatchObject({ ok: true });
    expect(deps.manager.connectRelay).toHaveBeenCalledWith("ws://127.0.0.1:8787/ops");
    expect(deps.manager.connect).not.toHaveBeenCalled();
  });
});
