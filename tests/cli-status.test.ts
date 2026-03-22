import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedArgs } from "../src/cli/args";

const mocks = vi.hoisted(() => ({
  fetchDaemonStatusFromMetadata: vi.fn(),
  runSessionStatus: vi.fn(),
  getNativeStatusSnapshot: vi.fn()
}));

vi.mock("../src/cli/daemon-status", () => ({
  fetchDaemonStatusFromMetadata: mocks.fetchDaemonStatusFromMetadata
}));

vi.mock("../src/cli/commands/session/status", () => ({
  runSessionStatus: mocks.runSessionStatus
}));

vi.mock("../src/cli/commands/native", async () => {
  const actual = await vi.importActual<typeof import("../src/cli/commands/native")>("../src/cli/commands/native");
  return {
    ...actual,
    getNativeStatusSnapshot: mocks.getNativeStatusSnapshot
  };
});

import { runStatus } from "../src/cli/commands/status";

const makeArgs = (
  rawArgs: string[],
  overrides: Partial<ParsedArgs> = {}
): ParsedArgs => ({
  command: "status",
  mode: undefined,
  withConfig: false,
  noPrompt: true,
  noInteractive: true,
  quiet: false,
  outputFormat: "json",
  transport: "relay",
  skillsMode: "none",
  fullInstall: false,
  rawArgs,
  ...overrides
});

const mismatchStatus = {
  installed: true,
  manifestPath: "/tmp/manifest.json",
  wrapperPath: "/tmp/wrapper.sh",
  hostScriptPath: "/tmp/host.cjs",
  extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  registryPath: null,
  discoveredExtensionId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  discoveredMatchedBy: "path",
  expectedExtensionId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  expectedExtensionSource: "path",
  mismatch: true
};

describe("status command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runSessionStatus.mockResolvedValue({ success: true, message: "session ok" });
  });

  it("reuses native mismatch guidance for native transport status", async () => {
    mocks.getNativeStatusSnapshot.mockReturnValue(mismatchStatus);

    const result = await runStatus(makeArgs([], { transport: "native" }));

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(10);
    expect(result.message).toContain(
      "Native host targets aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, but the current extension is bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb."
    );
    expect(result.message).toContain("opendevbrowser native install bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    expect(result.message).toContain("opendevbrowser serve");
  });

  it("adds actionable native detail to daemon status output when mismatch exists", async () => {
    mocks.fetchDaemonStatusFromMetadata.mockResolvedValue({
      ok: true,
      pid: 1234,
      relay: {
        port: 8787,
        extensionConnected: true,
        extensionHandshakeComplete: true,
        cdpConnected: false,
        annotationConnected: false,
        opsConnected: false,
        canvasConnected: false,
        pairingRequired: false,
        health: { reason: "ok" }
      },
      binding: null
    });
    mocks.getNativeStatusSnapshot.mockReturnValue(mismatchStatus);

    const result = await runStatus(makeArgs(["--daemon"]));

    expect(result.success).toBe(true);
    expect(result.message).toContain("Native: mismatch (aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa != bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb)");
    expect(result.message).toContain(
      "Native detail: Native host targets aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, but the current extension is bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb."
    );
    expect(result.message).toContain("opendevbrowser native install bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    expect(result.message).toContain("opendevbrowser serve");
  });
});
