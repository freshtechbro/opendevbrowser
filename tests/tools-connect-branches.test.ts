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
      warnings: [],
      diagnostics: {
        authProvenance: {
          googleAuthIntent: "user_owned_google",
          profileSource: "live_extension_profile",
          cookieBootstrap: {
            attempted: false,
            disabled: false,
            importedCount: 0,
            rejectedCount: 0
          }
        }
      }
    })),
    connect: vi.fn(async () => ({
      sessionId: "session-2",
      mode: "cdpConnect",
      wsEndpoint: "ws://127.0.0.1:9222/devtools/browser/mock",
      activeTargetId: "target-2",
      warnings: [],
      diagnostics: {
        authProvenance: {
          googleAuthIntent: "none",
          profileSource: "cdp_connected_profile",
          cookieBootstrap: {
            attempted: false,
            disabled: true,
            importedCount: 0,
            rejectedCount: 0
          }
        }
      }
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

  it("uses the legacy /cdp endpoint directly when extensionLegacy is enabled", async () => {
    const deps = createDeps();
    const tool = createConnectTool(deps as never);

    const result = parse(await tool.execute({
      wsEndpoint: "ws://127.0.0.1:8787/cdp",
      extensionLegacy: true
    } as never));

    expect(result).toMatchObject({ ok: true });
    expect(deps.manager.connectRelay).toHaveBeenCalledWith("ws://127.0.0.1:8787/cdp");
    expect(deps.manager.connect).not.toHaveBeenCalled();
  });

  it("normalizes local base relay endpoints to /ops by default", async () => {
    const deps = createDeps();
    const tool = createConnectTool(deps as never);

    const result = parse(await tool.execute({
      wsEndpoint: "ws://127.0.0.1:8787"
    } as never));

    expect(result).toMatchObject({ ok: true });
    expect(deps.manager.connectRelay).toHaveBeenCalledWith("ws://127.0.0.1:8787/ops");
    expect(deps.manager.connect).not.toHaveBeenCalled();
  });

  it("rejects explicit legacy /cdp endpoints without extensionLegacy", async () => {
    const deps = createDeps();
    const tool = createConnectTool(deps as never);

    const result = parse(await tool.execute({
      wsEndpoint: "ws://127.0.0.1:8787/cdp"
    } as never));

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "extension_legacy_required"
      }
    });
    expect(deps.manager.connectRelay).not.toHaveBeenCalled();
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

  it("forwards startUrl to relay connect requests", async () => {
    const deps = createDeps({
      opsUrl: "ws://127.0.0.1:8787/ops"
    });
    const tool = createConnectTool(deps as never);

    const result = parse(await tool.execute({
      startUrl: "http://127.0.0.1:41731/"
    } as never));

    expect(result).toMatchObject({ ok: true });
    expect(deps.manager.connectRelay).toHaveBeenCalledWith("ws://127.0.0.1:8787/ops", {
      startUrl: "http://127.0.0.1:41731/"
    });
  });

  it("forwards user-owned Google intent and diagnostics on ops relay connect", async () => {
    const deps = createDeps({
      opsUrl: "ws://127.0.0.1:8787/ops"
    });
    const tool = createConnectTool(deps as never);

    const result = parse(await tool.execute({
      googleAuthIntent: "user-owned",
      startUrl: "https://accounts.google.com/signin"
    } as never));

    expect(result).toMatchObject({
      ok: true,
      diagnostics: {
        authProvenance: {
          googleAuthIntent: "user_owned_google",
          profileSource: "live_extension_profile"
        }
      }
    });
    expect(deps.manager.connectRelay).toHaveBeenCalledWith("ws://127.0.0.1:8787/ops", {
      startUrl: "https://accounts.google.com/signin",
      googleAuthIntent: "user_owned_google"
    });
    expect(deps.manager.connect).not.toHaveBeenCalled();
  });

  it("rejects user-owned Google intent for direct CDP connect", async () => {
    const deps = createDeps();
    const tool = createConnectTool(deps as never);

    const result = parse(await tool.execute({
      host: "127.0.0.1",
      port: 9222,
      googleAuthIntent: "user-owned"
    } as never));

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "unsupported_mode"
      }
    });
    expect(deps.manager.connectRelay).not.toHaveBeenCalled();
    expect(deps.manager.connect).not.toHaveBeenCalled();
  });

  it("rejects user-owned Google intent for legacy /cdp relay connect", async () => {
    const deps = createDeps();
    const tool = createConnectTool(deps as never);

    const result = parse(await tool.execute({
      wsEndpoint: "ws://127.0.0.1:8787/cdp",
      extensionLegacy: true,
      googleAuthIntent: "user-owned"
    } as never));

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "unsupported_mode"
      }
    });
    expect(deps.manager.connectRelay).not.toHaveBeenCalled();
    expect(deps.manager.connect).not.toHaveBeenCalled();
  });

  it("passes direct CDP diagnostics through connect response", async () => {
    const deps = createDeps();
    const tool = createConnectTool(deps as never);

    const result = parse(await tool.execute({
      host: "127.0.0.1",
      port: 9222,
      disableSystemCookieBootstrap: true
    } as never));

    expect(result).toMatchObject({
      ok: true,
      diagnostics: {
        authProvenance: {
          googleAuthIntent: "none",
          profileSource: "cdp_connected_profile",
          cookieBootstrap: {
            disabled: true
          }
        }
      }
    });
    expect(deps.manager.connect).toHaveBeenCalledWith({
      host: "127.0.0.1",
      port: 9222,
      startUrl: undefined,
      wsEndpoint: undefined,
      googleAuthIntent: "none",
      disableSystemCookieBootstrap: true
    });
  });

  it("forwards startUrl to direct CDP connect requests", async () => {
    const deps = createDeps();
    const tool = createConnectTool(deps as never);

    const result = parse(await tool.execute({
      host: "127.0.0.1",
      port: 9222,
      startUrl: "http://127.0.0.1:41731/"
    } as never));

    expect(result).toMatchObject({ ok: true });
    expect(deps.manager.connect).toHaveBeenCalledWith({
      host: "127.0.0.1",
      port: 9222,
      startUrl: "http://127.0.0.1:41731/",
      wsEndpoint: undefined,
      googleAuthIntent: "none",
      disableSystemCookieBootstrap: undefined
    });
  });
});
