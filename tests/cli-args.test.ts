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

  it("accepts --extension-legacy for launch/connect command parsing", () => {
    const launchParsed = parseArgs(["node", "cli", "launch", "--extension-only", "--extension-legacy"]);
    expect(launchParsed.command).toBe("launch");
    expect(launchParsed.rawArgs).toEqual(["--extension-only", "--extension-legacy"]);

    const connectParsed = parseArgs(["node", "cli", "connect", "--ws-endpoint", "ws://127.0.0.1:8787", "--extension-legacy"]);
    expect(connectParsed.command).toBe("connect");
    expect(connectParsed.rawArgs).toEqual(["--ws-endpoint", "ws://127.0.0.1:8787", "--extension-legacy"]);
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
});
