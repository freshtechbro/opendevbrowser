import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseArgs, type ParsedArgs } from "../src/cli/args";
import { __test__, runCdpProfile } from "../src/cli/commands/session/cdp-profile";

const { callDaemon } = vi.hoisted(() => ({
  callDaemon: vi.fn()
}));

vi.mock("../src/cli/client", () => ({
  callDaemon
}));

const makeArgs = (rawArgs: string[]): ParsedArgs => ({
  command: "cdp-profile",
  mode: undefined,
  withConfig: false,
  noPrompt: false,
  noInteractive: false,
  quiet: false,
  outputFormat: "json",
  transport: "relay",
  skillsMode: "global",
  fullInstall: false,
  rawArgs
});

describe("cdp-profile CLI command", () => {
  beforeEach(() => {
    callDaemon.mockReset();
  });

  it("parses start arguments for a named OpenDevBrowser CDP profile", () => {
    expect(__test__.parseCdpProfileArgs([
      "start",
      "--profile",
      "pinterest-design",
      "--cdp-port",
      "9333",
      "--start-url",
      "https://www.pinterest.com",
      "--flag",
      "--disable-features=Example"
    ])).toEqual({
      action: "start",
      profile: "pinterest-design",
      port: 9333,
      startUrl: "https://www.pinterest.com",
      flags: ["--disable-features=Example"]
    });
  });

  it("allows cdp-profile equals-form flags through the top-level parser", () => {
    const parsed = parseArgs([
      "node",
      "opendevbrowser",
      "cdp-profile",
      "start",
      "--profile=pinterest-design",
      "--cdp-port=9333",
      "--start-url=https://www.pinterest.com",
      "--chrome-path=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "--flag=--disable-features=Example"
    ]);

    expect(parsed.command).toBe("cdp-profile");
    expect(parsed.rawArgs).toEqual([
      "start",
      "--profile=pinterest-design",
      "--cdp-port=9333",
      "--start-url=https://www.pinterest.com",
      "--chrome-path=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "--flag=--disable-features=Example"
    ]);
  });

  it("rejects default profiles before daemon calls", async () => {
    await expect(runCdpProfile(makeArgs([
      "start",
      "--profile",
      "default"
    ]))).rejects.toThrow("named non-default");

    expect(callDaemon).not.toHaveBeenCalled();
  });

  it("rejects unsafe Chrome flags before daemon calls", async () => {
    await expect(runCdpProfile(makeArgs([
      "start",
      "--profile",
      "pinterest-design",
      "--flag",
      "--user-data-dir=/Users/test/Library/Application Support/Google/Chrome/Default"
    ]))).rejects.toThrow("Unsafe cdp-profile --flag --user-data-dir");

    await expect(runCdpProfile(makeArgs([
      "start",
      "--profile=pinterest-design",
      "--flag=--remote-debugging-address=0.0.0.0"
    ]))).rejects.toThrow("Unsafe cdp-profile --flag --remote-debugging-address");

    expect(callDaemon).not.toHaveBeenCalled();
  });

  it("forwards start to the daemon cdp-profile lifecycle command", async () => {
    callDaemon.mockResolvedValue({
      profile: { profileId: "pinterest-design" },
      port: 9333
    });

    const result = await runCdpProfile(makeArgs([
      "start",
      "--profile",
      "pinterest-design",
      "--cdp-port=9333"
    ]));

    expect(callDaemon).toHaveBeenCalledWith(
      "session.cdpProfile.start",
      {
        action: "start",
        profile: "pinterest-design",
        port: 9333,
        flags: []
      },
      { timeoutMs: 30000 }
    );
    expect(result).toEqual({
      success: true,
      message: "CDP profile start: pinterest-design",
      data: {
        profile: { profileId: "pinterest-design" },
        port: 9333
      }
    });
  });

  it("omits raw CDP websocket endpoints from lifecycle output", async () => {
    callDaemon.mockResolvedValue({
      profile: {
        profileId: "pinterest-design",
        endpoint: { host: "127.0.0.1", port: 9333 }
      },
      port: 9333,
      wsEndpoint: "ws://127.0.0.1:9333/devtools/browser/private-id"
    });

    const result = await runCdpProfile(makeArgs([
      "status",
      "--profile",
      "pinterest-design"
    ]));

    expect(JSON.stringify(result)).not.toContain("devtools/browser/private-id");
    expect(result.data).toEqual({
      profile: {
        profileId: "pinterest-design",
        endpoint: { host: "127.0.0.1", port: 9333 }
      },
      port: 9333
    });
  });

  it("keeps stop/status scoped to an existing profile name", () => {
    expect(__test__.parseCdpProfileArgs(["status", "--profile=pinterest-design"])).toEqual({
      action: "status",
      profile: "pinterest-design",
      flags: []
    });
    expect(() => __test__.parseCdpProfileArgs([
      "stop",
      "--profile",
      "pinterest-design",
      "--cdp-port",
      "9333"
    ])).toThrow("only supported by cdp-profile start");
  });
});
