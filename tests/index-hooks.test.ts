import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const agentInbox = {
  registerScope: vi.fn(),
  buildSystemInjection: vi.fn(),
  acknowledge: vi.fn()
};

const config = {
  relayPort: 8787,
  relayToken: "token",
  skills: { nudge: { enabled: false, keywords: [], maxAgeMs: 60_000 } },
  continuity: { enabled: false, filePath: "CONTINUITY.md", nudge: { enabled: false, keywords: [], maxAgeMs: 60_000 } }
};

vi.mock("../src/core", () => ({
  createOpenDevBrowserCore: vi.fn(() => ({
    cacheRoot: "/tmp/opendevbrowser",
    config,
    configStore: { get: vi.fn(() => config) },
    manager: {},
    agentInbox,
    canvasManager: {},
    annotationManager: {
      setRelay: vi.fn(),
      setBrowserManager: vi.fn()
    },
    runner: {},
    skills: {},
    providerRuntime: {},
    relay: {
      status: vi.fn(() => ({ running: false, port: 8787 }))
    },
    ensureRelay: vi.fn(async () => undefined),
    cleanup: vi.fn(),
    getExtensionPath: vi.fn(() => null)
  }))
}));

vi.mock("../src/tools", () => ({
  createTools: vi.fn(() => ({}))
}));

vi.mock("../src/extension-extractor", () => ({
  extractExtension: vi.fn()
}));

vi.mock("../src/utils/hub-enabled", () => ({
  isHubEnabled: vi.fn(() => false)
}));

describe("plugin inbox hooks", () => {
  beforeEach(() => {
    vi.resetModules();
    agentInbox.registerScope.mockReset();
    agentInbox.buildSystemInjection.mockReset();
    agentInbox.acknowledge.mockReset();
    vi.spyOn(process, "on").mockImplementation((() => process) as typeof process.on);
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers chat scopes on user messages and injects scoped inbox blocks into system prompts", async () => {
    agentInbox.buildSystemInjection.mockReturnValue({
      systemBlock: "[opendevbrowser-agent-inbox]\n{}\n[opendevbrowser-agent-inbox]",
      receiptIds: ["receipt-1"]
    });

    const pluginFactory = (await import("../src/index")).default;
    const hooks = await pluginFactory({
      directory: "/tmp/opendevbrowser",
      worktree: "/tmp/opendevbrowser"
    } as never);

    await hooks["chat.message"]?.({
      sessionID: "session-1",
      messageID: "message-1",
      agent: "codex",
      model: { providerID: "openai", modelID: "gpt-5" },
      variant: "default"
    }, {
      message: { role: "user" },
      parts: [{ type: "text", text: "continue the task" }]
    } as never);

    expect(agentInbox.registerScope).toHaveBeenCalledWith("session-1", expect.objectContaining({
      messageId: "message-1",
      agent: "codex",
      model: { providerID: "openai", modelID: "gpt-5" },
      variant: "default"
    }));

    const output = { system: ["existing"] };
    await hooks["experimental.chat.system.transform"]?.({
      sessionID: "session-1",
      model: {} as never
    }, output as never);

    expect(agentInbox.buildSystemInjection).toHaveBeenCalledWith("session-1");
    expect(agentInbox.acknowledge).toHaveBeenCalledWith(["receipt-1"]);
    expect(output.system).toEqual([
      "existing",
      "[opendevbrowser-agent-inbox]\n{}\n[opendevbrowser-agent-inbox]"
    ]);
  });
});
