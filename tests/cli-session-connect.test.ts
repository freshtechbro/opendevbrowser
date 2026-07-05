import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedArgs } from "../src/cli/args";
import { __test__, runSessionConnect } from "../src/cli/commands/session/connect";

const { callDaemon } = vi.hoisted(() => ({
  callDaemon: vi.fn()
}));

vi.mock("../src/cli/client", () => ({
  callDaemon
}));

const makeArgs = (rawArgs: string[]): ParsedArgs => ({
  command: "connect",
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

describe("connect CLI command", () => {
  beforeEach(() => {
    callDaemon.mockReset();
  });

  it("uses an extended daemon transport timeout for session.connect", async () => {
    callDaemon.mockResolvedValue({ sessionId: "session-1", mode: "extension" });

    const result = await runSessionConnect(makeArgs([
      "--ws-endpoint",
      "ws://127.0.0.1:8787/cdp",
      "--extension-legacy"
    ]));

    expect(callDaemon).toHaveBeenCalledWith(
      "session.connect",
      {
        wsEndpoint: "ws://127.0.0.1:8787/cdp",
        extensionLegacy: true
      },
      { timeoutMs: 30000 }
    );
    expect(result).toEqual({
      success: true,
      message: "Session connected: session-1",
      data: {
        sessionId: "session-1",
        mode: "extension"
      }
    });
  });

  it("parses Google auth intent, disabled bootstrap, and explicit Google cookie bootstrap override", () => {
    expect(__test__.parseConnectArgs([
      "--google-auth-intent",
      "user-owned",
      "--disable-system-cookie-bootstrap",
      "--allow-google-cookie-bootstrap"
    ])).toEqual({
      googleAuthIntent: "user_owned_google",
      disableSystemCookieBootstrap: true,
      allowGoogleCookieBootstrap: true
    });
    expect(__test__.parseConnectArgs(["--google-auth-intent=user-owned"]).googleAuthIntent).toBe(
      "user_owned_google"
    );
  });

  it("rejects invalid Google auth intent", () => {
    expect(() => __test__.parseConnectArgs(["--google-auth-intent", "personal"])).toThrow(
      "Unsupported Google auth intent"
    );
  });

  it("forwards normalized Google auth intent and bootstrap options to daemon connect", async () => {
    callDaemon.mockResolvedValue({ sessionId: "session-google", mode: "extension" });

    await runSessionConnect(makeArgs([
      "--google-auth-intent",
      "user-owned",
      "--disable-system-cookie-bootstrap",
      "--allow-google-cookie-bootstrap"
    ]));

    expect(callDaemon).toHaveBeenCalledWith(
      "session.connect",
      expect.objectContaining({
        googleAuthIntent: "user_owned_google",
        disableSystemCookieBootstrap: true,
        allowGoogleCookieBootstrap: true
      }),
      { timeoutMs: 30000 }
    );
  });

  it("rejects direct CDP connect for user-owned Google auth before daemon calls", async () => {
    await expect(runSessionConnect(makeArgs([
      "--google-auth-intent",
      "user-owned",
      "--cdp-port",
      "9222"
    ]))).rejects.toThrow("requires the extension /ops relay");

    expect(callDaemon).not.toHaveBeenCalled();
  });

  it("rejects registry profiles for user-owned Google auth before daemon calls", async () => {
    await expect(runSessionConnect(makeArgs([
      "--google-auth-intent",
      "user-owned",
      "--profile",
      "work-google"
    ]))).rejects.toThrow("requires the extension /ops relay");

    expect(callDaemon).not.toHaveBeenCalled();
  });

  it("forwards registry-backed CDP profile connects without raw endpoint fields", async () => {
    callDaemon.mockResolvedValue({
      sessionId: "session-profile",
      mode: "cdpConnect",
      wsEndpoint: "ws://127.0.0.1:9339/devtools/browser/private-id"
    });

    const result = await runSessionConnect(makeArgs([
      "--profile",
      "pinterest-design",
      "--start-url",
      "https://www.pinterest.com"
    ]));

    expect(callDaemon).toHaveBeenCalledWith(
      "session.connect",
      {
        profile: "pinterest-design",
        startUrl: "https://www.pinterest.com"
      },
      { timeoutMs: 30000 }
    );
    expect(JSON.stringify(result)).not.toContain("private-id");
    expect(result).toEqual({
      success: true,
      message: "Session connected: session-profile",
      data: {
        sessionId: "session-profile",
        mode: "cdpConnect"
      }
    });
  });

  it("redacts raw CDP connect endpoint fields from CLI output", async () => {
    callDaemon.mockResolvedValue({
      sessionId: "session-raw-cdp",
      mode: "cdpConnect",
      wsEndpoint: "ws://127.0.0.1:9339/devtools/browser/private-id"
    });

    const result = await runSessionConnect(makeArgs([
      "--ws-endpoint",
      "ws://127.0.0.1:9339/devtools/browser/private-id"
    ]));

    expect(callDaemon).toHaveBeenCalledWith(
      "session.connect",
      {
        wsEndpoint: "ws://127.0.0.1:9339/devtools/browser/private-id"
      },
      { timeoutMs: 30000 }
    );
    expect(result.data).toEqual({
      sessionId: "session-raw-cdp",
      mode: "cdpConnect"
    });
    expect(JSON.stringify(result)).not.toContain("private-id");
    expect(JSON.stringify(result)).not.toContain("wsEndpoint");
  });

  it("rejects mixing registry-backed CDP profile with raw CDP endpoint inputs", async () => {
    await expect(runSessionConnect(makeArgs([
      "--profile",
      "pinterest-design",
      "--cdp-port",
      "9222"
    ]))).rejects.toThrow("Use either --profile");

    expect(callDaemon).not.toHaveBeenCalled();
  });

  it("preserves extension legacy forwarding without Google auth intent", async () => {
    callDaemon.mockResolvedValue({ sessionId: "session-legacy", mode: "extension" });

    await runSessionConnect(makeArgs([
      "--ws-endpoint=ws://127.0.0.1:8787/cdp",
      "--extension-legacy"
    ]));

    expect(callDaemon).toHaveBeenCalledWith(
      "session.connect",
      {
        wsEndpoint: "ws://127.0.0.1:8787/cdp",
        extensionLegacy: true
      },
      { timeoutMs: 30000 }
    );
  });
});
