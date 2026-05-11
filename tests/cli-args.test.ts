import { describe, it, expect } from "vitest";
import { parseArgs } from "../src/cli/args";
import { parseAnnotateArgs } from "../src/cli/commands/annotate";
import { __test__ as macroResolveTest } from "../src/cli/commands/macro-resolve";
import { parseNumberFlag } from "../src/cli/utils/parse";

describe("parseNumberFlag", () => {
  it("parses positive integers", () => {
    expect(parseNumberFlag("1500", "--timeout-ms", { min: 1 })).toBe(1500);
  });

  it("rejects non-integers", () => {
    expect(() => parseNumberFlag("1.2", "--timeout-ms", { min: 1 })).toThrow("Invalid --timeout-ms");
  });

  it("rejects out-of-range values", () => {
    expect(() => parseNumberFlag("0", "--timeout-ms", { min: 1 })).toThrow("Invalid --timeout-ms");
  });

  it("rejects empty values", () => {
    expect(() => parseNumberFlag("", "--timeout-ms")).toThrow("Invalid --timeout-ms");
    expect(() => parseNumberFlag("   ", "--timeout-ms")).toThrow("Invalid --timeout-ms");
  });

  it("rejects non-decimal numeric spellings", () => {
    for (const value of ["1e3", "0x10", "+10", " 10 "]) {
      expect(() => parseNumberFlag(value, "--timeout-ms", { min: 1 })).toThrow("Invalid --timeout-ms");
    }
  });

  it("accepts negative decimal integers when no lower bound is set", () => {
    expect(parseNumberFlag("-240", "--dy")).toBe(-240);
  });
});

describe("parseArgs", () => {
  it("accepts daemon command with subcommand", () => {
    const parsed = parseArgs(["node", "cli", "daemon", "status"]);
    expect(parsed.command).toBe("daemon");
    expect(parsed.rawArgs[0]).toBe("status");
  });

  it("accepts native command with subcommand", () => {
    const parsed = parseArgs(["node", "cli", "native", "status"]);
    expect(parsed.command).toBe("native");
    expect(parsed.rawArgs[0]).toBe("status");
  });

  it("parses transport flag", () => {
    const parsed = parseArgs(["node", "cli", "--transport", "native"]);
    expect(parsed.transport).toBe("native");
  });

  it("accepts output-format in equals form", () => {
    const parsed = parseArgs(["node", "cli", "--output-format=json"]);
    expect(parsed.outputFormat).toBe("json");
  });

  it("accepts annotate command", () => {
    const parsed = parseArgs(["node", "cli", "annotate"]);
    expect(parsed.command).toBe("annotate");
    expect(parsed.rawArgs).toEqual([]);
  });

  it("accepts rpc command with internal flags", () => {
    const parsed = parseArgs([
      "node",
      "cli",
      "rpc",
      "--unsafe-internal",
      "--name",
      "nav.snapshot",
      "--params",
      "{\"sessionId\":\"s1\"}",
      "--timeout-ms",
      "45000"
    ]);
    expect(parsed.command).toBe("rpc");
    expect(parsed.rawArgs).toEqual([
      "--unsafe-internal",
      "--name",
      "nav.snapshot",
      "--params",
      "{\"sessionId\":\"s1\"}",
      "--timeout-ms",
      "45000"
    ]);
  });

  it("accepts debug-trace-snapshot command", () => {
    const parsed = parseArgs([
      "node",
      "cli",
      "debug-trace-snapshot",
      "--session-id",
      "s1",
      "--since-console-seq=1",
      "--since-network-seq=2",
      "--since-exception-seq=3",
      "--max=20",
      "--request-id=req-1"
    ]);
    expect(parsed.command).toBe("debug-trace-snapshot");
  });

  it("accepts session-inspector command", () => {
    const parsed = parseArgs([
      "node",
      "cli",
      "session-inspector",
      "--session-id",
      "s1",
      "--max=20"
    ]);
    expect(parsed.command).toBe("session-inspector");
  });

  it("accepts scroll dy in equals form", () => {
    const parsed = parseArgs(["node", "cli", "scroll", "--session-id=s1", "--dy=-240"]);

    expect(parsed.command).toBe("scroll");
    expect(parsed.rawArgs).toEqual(["--session-id=s1", "--dy=-240"]);
  });

  it("accepts scroll dy in space-separated signed form", () => {
    const parsed = parseArgs(["node", "cli", "scroll", "--session-id", "s1", "--dy", "-240"]);

    expect(parsed.command).toBe("scroll");
    expect(parsed.rawArgs).toEqual(["--session-id", "s1", "--dy", "-240"]);
  });

  it("rejects unknown flags after a value flag", () => {
    expect(() => parseArgs(["node", "cli", "snapshot", "--session-id", "--bad-flag"])).toThrow("Unknown flag: --bad-flag");
  });

  it("rejects unknown single-dash flags after non-signed value flags", () => {
    expect(() => parseArgs(["node", "cli", "snapshot", "--session-id", "-bad-flag"])).toThrow("Unknown flag: -bad-flag");
  });

  it("accepts screencast and desktop commands", () => {
    const screencastStart = parseArgs([
      "node",
      "cli",
      "screencast-start",
      "--session-id",
      "s1",
      "--interval-ms=750"
    ]);
    expect(screencastStart.command).toBe("screencast-start");
    expect(screencastStart.rawArgs).toEqual(["--session-id", "s1", "--interval-ms=750"]);

    const screencastStop = parseArgs([
      "node",
      "cli",
      "screencast-stop",
      "--session-id=s1",
      "--screencast-id=cast-1"
    ]);
    expect(screencastStop.command).toBe("screencast-stop");

    const desktopStatus = parseArgs(["node", "cli", "desktop-status"]);
    expect(desktopStatus.command).toBe("desktop-status");

    const desktopWindow = parseArgs([
      "node",
      "cli",
      "desktop-capture-window",
      "--window-id",
      "window-1",
      "--reason=capture"
    ]);
    expect(desktopWindow.command).toBe("desktop-capture-window");
  });

  it("accepts review command", () => {
    const parsed = parseArgs([
      "node",
      "cli",
      "review",
      "--session-id",
      "s1",
      "--target-id",
      "tab-9",
      "--max-chars=1200"
    ]);
    expect(parsed.command).toBe("review");
  });

  it("accepts cookie-import command", () => {
    const parsed = parseArgs([
      "node",
      "cli",
      "cookie-import",
      "--session-id",
      "s1",
      "--cookies",
      "[]",
      "--strict=false"
    ]);
    expect(parsed.command).toBe("cookie-import");
  });

  it("accepts cookie-list command", () => {
    const parsed = parseArgs([
      "node",
      "cli",
      "cookie-list",
      "--session-id",
      "s1",
      "--url",
      "https://example.com"
    ]);
    expect(parsed.command).toBe("cookie-list");
  });

  it("accepts macro-resolve command", () => {
    const parsed = parseArgs([
      "node",
      "cli",
      "macro-resolve",
      "--expression=@web.search(\"openai\")",
      "--default-provider=web/default",
      "--include-catalog",
      "--execute"
    ]);
    expect(parsed.command).toBe("macro-resolve");
    expect(parsed.rawArgs).toContain("--execute");
  });

  it("accepts research/shopping/product-video commands", () => {
    const research = parseArgs(["node", "cli", "research", "run", "--topic=agent workflows", "--days=30", "--mode=context"]);
    expect(research.command).toBe("research");
    expect(research.rawArgs).toEqual(["run", "--topic=agent workflows", "--days=30", "--mode=context"]);

    const shopping = parseArgs(["node", "cli", "shopping", "run", "--query=usb hub", "--providers=shopping/amazon,shopping/others"]);
    expect(shopping.command).toBe("shopping");
    expect(shopping.rawArgs).toEqual(["run", "--query=usb hub", "--providers=shopping/amazon,shopping/others"]);

    const productVideo = parseArgs(["node", "cli", "product-video", "run", "--product-url=https://example.com/p/1"]);
    expect(productVideo.command).toBe("product-video");
    expect(productVideo.rawArgs).toEqual(["run", "--product-url=https://example.com/p/1"]);

    const artifacts = parseArgs(["node", "cli", "artifacts", "cleanup", "--expired-only", "--output-dir=/tmp/odb"]);
    expect(artifacts.command).toBe("artifacts");
    expect(artifacts.rawArgs).toEqual(["cleanup", "--expired-only", "--output-dir=/tmp/odb"]);
  });

  it("accepts workflow cookie flags through top-level CLI parsing", () => {
    const research = parseArgs([
      "node",
      "cli",
      "research",
      "run",
      "--topic=agent workflows",
      "--use-cookies=false",
      "--cookie-policy=auto"
    ]);
    expect(research.command).toBe("research");
    expect(research.rawArgs).toEqual([
      "run",
      "--topic=agent workflows",
      "--use-cookies=false",
      "--cookie-policy=auto"
    ]);

    const shopping = parseArgs([
      "node",
      "cli",
      "shopping",
      "run",
      "--query=usb hub",
      "--use-cookies",
      "--cookie-policy-override=required"
    ]);
    expect(shopping.command).toBe("shopping");
    expect(shopping.rawArgs).toEqual([
      "run",
      "--query=usb hub",
      "--use-cookies",
      "--cookie-policy-override=required"
    ]);

    const productVideo = parseArgs([
      "node",
      "cli",
      "product-video",
      "run",
      "--product-url=https://example.com/p/1",
      "--use-cookies=true",
      "--cookie-policy",
      "off"
    ]);
    expect(productVideo.command).toBe("product-video");
    expect(productVideo.rawArgs).toEqual([
      "run",
      "--product-url=https://example.com/p/1",
      "--use-cookies=true",
      "--cookie-policy",
      "off"
    ]);
  });

  it("accepts workflow challenge automation flags through top-level CLI parsing", () => {
    const research = parseArgs([
      "node",
      "cli",
      "research",
      "run",
      "--topic=agent workflows",
      "--challenge-automation-mode=browser_with_helper"
    ]);
    expect(research.command).toBe("research");
    expect(research.rawArgs).toEqual([
      "run",
      "--topic=agent workflows",
      "--challenge-automation-mode=browser_with_helper"
    ]);

    const shopping = parseArgs([
      "node",
      "cli",
      "shopping",
      "run",
      "--query=usb hub",
      "--challenge-automation-mode",
      "browser"
    ]);
    expect(shopping.command).toBe("shopping");
    expect(shopping.rawArgs).toEqual([
      "run",
      "--query=usb hub",
      "--challenge-automation-mode",
      "browser"
    ]);

    const productVideo = parseArgs([
      "node",
      "cli",
      "product-video",
      "run",
      "--product-url=https://example.com/p/1",
      "--challenge-automation-mode",
      "off"
    ]);
    expect(productVideo.command).toBe("product-video");
    expect(productVideo.rawArgs).toEqual([
      "run",
      "--product-url=https://example.com/p/1",
      "--challenge-automation-mode",
      "off"
    ]);
  });

  it("accepts --extension-legacy for launch/connect command parsing", () => {
    const launchParsed = parseArgs(["node", "cli", "launch", "--extension-only", "--extension-legacy"]);
    expect(launchParsed.command).toBe("launch");
    expect(launchParsed.rawArgs).toEqual(["--extension-only", "--extension-legacy"]);

    const connectParsed = parseArgs([
      "node",
      "cli",
      "connect",
      "--ws-endpoint",
      "ws://127.0.0.1:8787",
      "--extension-legacy",
      "--start-url",
      "http://127.0.0.1:41731/"
    ]);
    expect(connectParsed.command).toBe("connect");
    expect(connectParsed.rawArgs).toEqual([
      "--ws-endpoint",
      "ws://127.0.0.1:8787",
      "--extension-legacy",
      "--start-url",
      "http://127.0.0.1:41731/"
    ]);
  });

  it("accepts --persist-profile in equals form for launch parsing", () => {
    const parsed = parseArgs(["node", "cli", "launch", "--persist-profile=false"]);
    expect(parsed.command).toBe("launch");
    expect(parsed.rawArgs).toEqual(["--persist-profile=false"]);
  });

  it("accepts annotate flags (space-separated)", () => {
    const parsed = parseArgs([
      "node",
      "cli",
      "annotate",
      "--session-id",
      "s1",
      "--transport",
      "direct",
      "--target-id",
      "target-1",
      "--tab-id",
      "123",
      "--url",
      "https://example.com",
      "--screenshot-mode",
      "full",
      "--context",
      "Review",
      "--timeout-ms",
      "90000",
      "--debug"
    ]);
    expect(parsed.command).toBe("annotate");
    expect(parsed.rawArgs).toEqual([
      "--session-id",
      "s1",
      "--transport",
      "direct",
      "--target-id",
      "target-1",
      "--tab-id",
      "123",
      "--url",
      "https://example.com",
      "--screenshot-mode",
      "full",
      "--context",
      "Review",
      "--timeout-ms",
      "90000",
      "--debug"
    ]);
  });

  it("accepts annotate flags (equals form)", () => {
    const parsed = parseArgs([
      "node",
      "cli",
      "annotate",
      "--session-id=s1",
      "--transport=direct",
      "--target-id=target-1",
      "--tab-id=123",
      "--url=https://example.com",
      "--screenshot-mode=visible",
      "--context=Review",
      "--timeout-ms=90000",
      "--debug"
    ]);
    expect(parsed.command).toBe("annotate");
  });

  it("accepts annotate --stored retrieval", () => {
    const parsed = parseArgs([
      "node",
      "cli",
      "annotate",
      "--session-id",
      "s1",
      "--stored"
    ]);
    expect(parsed.command).toBe("annotate");
    expect(parsed.rawArgs).toEqual([
      "--session-id",
      "s1",
      "--stored"
    ]);
  });

  it("rejects unknown flags for annotate", () => {
    expect(() => parseArgs(["node", "cli", "annotate", "--not-a-real-flag"]))
      .toThrow("Unknown flag: --not-a-real-flag");
  });

  it("rejects boolean flags with equals form", () => {
    expect(() => parseArgs(["node", "cli", "annotate", "--debug=true"]))
      .toThrow("Unknown flag: --debug=true");
  });

  it("rejects conflicting install modes", () => {
    expect(() => parseArgs(["node", "cli", "--global", "--local"]))
      .toThrow("Choose either --global or --local.");
  });

  it("rejects conflicting skills flags", () => {
    expect(() => parseArgs(["node", "cli", "--skills-global", "--skills-local"]))
      .toThrow("Choose either --skills-local or --skills-global.");
  });
});

describe("parseAnnotateArgs", () => {
  it("parses session id (space-separated)", () => {
    const parsed = parseAnnotateArgs(["--session-id", "s1"]);
    expect(parsed.sessionId).toBe("s1");
  });

  it("parses session id (equals)", () => {
    const parsed = parseAnnotateArgs(["--session-id=s1"]);
    expect(parsed.sessionId).toBe("s1");
  });

  it("rejects missing session id value", () => {
    expect(() => parseAnnotateArgs(["--session-id"]))
      .toThrow("Missing value for --session-id");
  });

  it("parses url", () => {
    const parsed = parseAnnotateArgs(["--url", "https://example.com"]);
    expect(parsed.url).toBe("https://example.com");
  });

  it("rejects empty url in equals form", () => {
    expect(() => parseAnnotateArgs(["--url="]))
      .toThrow("Missing value for --url");
  });

  it("parses context", () => {
    const parsed = parseAnnotateArgs(["--context", "Review the hero"]);
    expect(parsed.context).toBe("Review the hero");
  });

  it("parses debug flag", () => {
    const parsed = parseAnnotateArgs(["--debug"]);
    expect(parsed.debug).toBe(true);
  });

  it("parses timeout-ms", () => {
    const parsed = parseAnnotateArgs(["--timeout-ms", "90000"]);
    expect(parsed.timeoutMs).toBe(90000);
  });

  it("parses stored flag", () => {
    const parsed = parseAnnotateArgs(["--stored"]);
    expect(parsed.stored).toBe(true);
  });

  it("rejects invalid timeout-ms", () => {
    expect(() => parseAnnotateArgs(["--timeout-ms", "nope"]))
      .toThrow("Invalid --timeout-ms");
  });

  it("parses screenshot mode", () => {
    const parsed = parseAnnotateArgs(["--screenshot-mode", "full"]);
    expect(parsed.screenshotMode).toBe("full");
  });

  it("rejects invalid screenshot mode", () => {
    expect(() => parseAnnotateArgs(["--screenshot-mode", "nope"]))
      .toThrow("Invalid --screenshot-mode");
  });

  it("parses transport", () => {
    const parsed = parseAnnotateArgs(["--transport", "direct"]);
    expect(parsed.transport).toBe("direct");
  });

  it("rejects invalid transport", () => {
    expect(() => parseAnnotateArgs(["--transport", "nope"]))
      .toThrow("Invalid --transport");
  });

  it("parses target-id", () => {
    const parsed = parseAnnotateArgs(["--target-id", "target-1"]);
    expect(parsed.targetId).toBe("target-1");
  });

  it("parses tab-id", () => {
    const parsed = parseAnnotateArgs(["--tab-id", "123"]);
    expect(parsed.tabId).toBe(123);
  });
});

describe("parseMacroResolveArgs", () => {
  it("parses execute flag", () => {
    const parsed = macroResolveTest.parseMacroResolveArgs([
      "--expression",
      "@community.search(\"openai\")",
      "--execute"
    ]);
    expect(parsed.execute).toBe(true);
  });

  it("parses timeout-ms", () => {
    const parsed = macroResolveTest.parseMacroResolveArgs([
      "--expression",
      "@community.search(\"openai\")",
      "--timeout-ms",
      "120000"
    ]);
    expect(parsed.timeoutMs).toBe(120000);
  });

  it("parses challenge automation mode flags", () => {
    const spaced = macroResolveTest.parseMacroResolveArgs([
      "--expression",
      "@community.search(\"openai\")",
      "--challenge-automation-mode",
      "browser_with_helper"
    ]);
    expect(spaced.challengeAutomationMode).toBe("browser_with_helper");

    const equalsForm = macroResolveTest.parseMacroResolveArgs([
      "--expression",
      "@community.search(\"openai\")",
      "--challenge-automation-mode=browser"
    ]);
    expect(equalsForm.challengeAutomationMode).toBe("browser");
  });

  it("parses cookie reuse flags", () => {
    const parsed = macroResolveTest.parseMacroResolveArgs([
      "--expression",
      "@community.search(\"openai\")",
      "--use-cookies",
      "--cookie-policy",
      "required"
    ]);
    expect(parsed.useCookies).toBe(true);
    expect(parsed.cookiePolicyOverride).toBe("required");

    const spacedFalse = macroResolveTest.parseMacroResolveArgs([
      "--expression",
      "@community.search(\"openai\")",
      "--use-cookies",
      "false",
      "--cookie-policy",
      "auto"
    ]);
    expect(spacedFalse.useCookies).toBe(false);
    expect(spacedFalse.cookiePolicyOverride).toBe("auto");

    const equalsForm = macroResolveTest.parseMacroResolveArgs([
      "--expression",
      "@community.search(\"openai\")",
      "--use-cookies=false",
      "--cookie-policy-override=off"
    ]);
    expect(equalsForm.useCookies).toBe(false);
    expect(equalsForm.cookiePolicyOverride).toBe("off");
  });

  it("rejects invalid challenge automation mode", () => {
    expect(() => macroResolveTest.parseMacroResolveArgs([
      "--expression",
      "@community.search(\"openai\")",
      "--challenge-automation-mode",
      "invalid"
    ])).toThrow("Invalid --challenge-automation-mode: invalid");
  });

  it("rejects invalid cookie reuse flags", () => {
    expect(() => macroResolveTest.parseMacroResolveArgs([
      "--expression",
      "@community.search(\"openai\")",
      "--use-cookies=maybe"
    ])).toThrow("Invalid --use-cookies: maybe");

    expect(() => macroResolveTest.parseMacroResolveArgs([
      "--expression",
      "@community.search(\"openai\")",
      "--use-cookies",
      "maybe"
    ])).toThrow("Invalid --use-cookies: maybe");

    expect(() => macroResolveTest.parseMacroResolveArgs([
      "--expression",
      "@community.search(\"openai\")",
      "--cookie-policy=invalid"
    ])).toThrow("Invalid --cookie-policy: invalid");

    expect(() => macroResolveTest.parseMacroResolveArgs([
      "--expression",
      "@community.search(\"openai\")",
      "--cookie-policy",
      "invalid"
    ])).toThrow("Invalid --cookie-policy: invalid");
  });

  it("rejects invalid timeout-ms", () => {
    expect(() => macroResolveTest.parseMacroResolveArgs([
      "--expression",
      "@community.search(\"openai\")",
      "--timeout-ms",
      "nope"
    ])).toThrow("Invalid --timeout-ms");
  });
});
