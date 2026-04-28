import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedArgs } from "../src/cli/args";
import { runConsolePoll } from "../src/cli/commands/devtools/console-poll";
import { runNetworkPoll } from "../src/cli/commands/devtools/network-poll";
import { runDomHtml } from "../src/cli/commands/dom/html";
import { runDomText } from "../src/cli/commands/dom/text";
import { runScroll } from "../src/cli/commands/interact/scroll";
import { runSnapshot } from "../src/cli/commands/nav/snapshot";

const { callDaemon } = vi.hoisted(() => ({
  callDaemon: vi.fn()
}));

vi.mock("../src/cli/client", () => ({
  callDaemon
}));

const makeArgs = (command: string, rawArgs: string[]): ParsedArgs => ({
  command,
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

type RunCommand = (args: ParsedArgs) => Promise<unknown>;

const VALID_NUMERIC_CASES: Array<{
  command: string;
  rawArgs: string[];
  run: RunCommand;
  method: string;
  payload: Record<string, unknown>;
  options?: Record<string, unknown>;
}> = [
  {
    command: "console-poll",
    rawArgs: ["--session-id", "s1", "--since-seq", "2", "--max=50"],
    run: runConsolePoll,
    method: "devtools.consolePoll",
    payload: { sessionId: "s1", sinceSeq: 2, max: 50 }
  },
  {
    command: "console-poll",
    rawArgs: ["--session-id", "s1", "--since-seq=0", "--max=1"],
    run: runConsolePoll,
    method: "devtools.consolePoll",
    payload: { sessionId: "s1", sinceSeq: 0, max: 1 }
  },
  {
    command: "network-poll",
    rawArgs: ["--session-id", "s1", "--since-seq=2", "--max", "50"],
    run: runNetworkPoll,
    method: "devtools.networkPoll",
    payload: { sessionId: "s1", sinceSeq: 2, max: 50 }
  },
  {
    command: "network-poll",
    rawArgs: ["--session-id", "s1", "--since-seq", "0", "--max", "1"],
    run: runNetworkPoll,
    method: "devtools.networkPoll",
    payload: { sessionId: "s1", sinceSeq: 0, max: 1 }
  },
  {
    command: "dom-html",
    rawArgs: ["--session-id", "s1", "--ref", "r1", "--max-chars", "2000"],
    run: runDomHtml,
    method: "dom.getHtml",
    payload: { sessionId: "s1", ref: "r1", maxChars: 2000 }
  },
  {
    command: "dom-html",
    rawArgs: ["--session-id", "s1", "--ref", "r1", "--max-chars=1"],
    run: runDomHtml,
    method: "dom.getHtml",
    payload: { sessionId: "s1", ref: "r1", maxChars: 1 }
  },
  {
    command: "dom-text",
    rawArgs: ["--session-id", "s1", "--ref", "r1", "--max-chars=2000"],
    run: runDomText,
    method: "dom.getText",
    payload: { sessionId: "s1", ref: "r1", maxChars: 2000 }
  },
  {
    command: "dom-text",
    rawArgs: ["--session-id", "s1", "--ref", "r1", "--max-chars", "1"],
    run: runDomText,
    method: "dom.getText",
    payload: { sessionId: "s1", ref: "r1", maxChars: 1 }
  },
  {
    command: "scroll",
    rawArgs: ["--session-id", "s1", "--dy", "-240"],
    run: runScroll,
    method: "interact.scroll",
    payload: { sessionId: "s1", ref: undefined, dy: -240 }
  },
  {
    command: "snapshot",
    rawArgs: ["--session-id", "s1", "--max-chars=4000"],
    run: runSnapshot,
    method: "nav.snapshot",
    payload: { sessionId: "s1", mode: undefined, maxChars: 4000, cursor: undefined },
    options: { timeoutMs: 30000 }
  },
  {
    command: "snapshot",
    rawArgs: ["--session-id", "s1", "--max-chars=1"],
    run: runSnapshot,
    method: "nav.snapshot",
    payload: { sessionId: "s1", mode: undefined, maxChars: 1, cursor: undefined },
    options: { timeoutMs: 30000 }
  }
];

const INVALID_NUMERIC_CASES: Array<{
  command: string;
  flag: string;
  rawArgs: string[];
  run: RunCommand;
}> = [
  {
    command: "console-poll",
    flag: "--since-seq",
    rawArgs: ["--session-id", "s1", "--since-seq", "oops"],
    run: runConsolePoll
  },
  {
    command: "console-poll",
    flag: "--since-seq",
    rawArgs: ["--session-id", "s1", "--since-seq="],
    run: runConsolePoll
  },
  {
    command: "console-poll",
    flag: "--since-seq",
    rawArgs: ["--session-id", "s1", "--since-seq=-1"],
    run: runConsolePoll
  },
  {
    command: "console-poll",
    flag: "--max",
    rawArgs: ["--session-id", "s1", "--max=oops"],
    run: runConsolePoll
  },
  {
    command: "console-poll",
    flag: "--max",
    rawArgs: ["--session-id", "s1", "--max=0"],
    run: runConsolePoll
  },
  {
    command: "console-poll",
    flag: "--max",
    rawArgs: ["--session-id", "s1", "--max=10.5"],
    run: runConsolePoll
  },
  {
    command: "network-poll",
    flag: "--since-seq",
    rawArgs: ["--session-id", "s1", "--since-seq=oops"],
    run: runNetworkPoll
  },
  {
    command: "network-poll",
    flag: "--since-seq",
    rawArgs: ["--session-id", "s1", "--since-seq=-1"],
    run: runNetworkPoll
  },
  {
    command: "network-poll",
    flag: "--max",
    rawArgs: ["--session-id", "s1", "--max", "oops"],
    run: runNetworkPoll
  },
  {
    command: "network-poll",
    flag: "--max",
    rawArgs: ["--session-id", "s1", "--max", "0"],
    run: runNetworkPoll
  },
  {
    command: "dom-html",
    flag: "--max-chars",
    rawArgs: ["--session-id", "s1", "--ref", "r1", "--max-chars", "oops"],
    run: runDomHtml
  },
  {
    command: "dom-html",
    flag: "--max-chars",
    rawArgs: ["--session-id", "s1", "--ref", "r1", "--max-chars="],
    run: runDomHtml
  },
  {
    command: "dom-html",
    flag: "--max-chars",
    rawArgs: ["--session-id", "s1", "--ref", "r1", "--max-chars=0"],
    run: runDomHtml
  },
  {
    command: "dom-text",
    flag: "--max-chars",
    rawArgs: ["--session-id", "s1", "--ref", "r1", "--max-chars=oops"],
    run: runDomText
  },
  {
    command: "dom-text",
    flag: "--max-chars",
    rawArgs: ["--session-id", "s1", "--ref", "r1", "--max-chars=-1"],
    run: runDomText
  },
  {
    command: "scroll",
    flag: "--dy",
    rawArgs: ["--session-id", "s1", "--dy", "oops"],
    run: runScroll
  },
  {
    command: "scroll",
    flag: "--dy",
    rawArgs: ["--session-id", "s1", "--dy=1.5"],
    run: runScroll
  },
  {
    command: "snapshot",
    flag: "--max-chars",
    rawArgs: ["--session-id", "s1", "--max-chars=oops"],
    run: runSnapshot
  },
  {
    command: "snapshot",
    flag: "--max-chars",
    rawArgs: ["--session-id", "s1", "--max-chars=0"],
    run: runSnapshot
  }
];

describe("CLI numeric flag parsing", () => {
  beforeEach(() => {
    callDaemon.mockReset();
  });

  it.each(INVALID_NUMERIC_CASES)("rejects invalid $flag for $command before daemon calls", async ({ command, rawArgs, run, flag }) => {
    await expect(run(makeArgs(command, rawArgs))).rejects.toThrow(`Invalid ${flag}`);

    expect(callDaemon).not.toHaveBeenCalled();
  });

  it.each(VALID_NUMERIC_CASES)("forwards valid numeric flags for $command", async ({ command, rawArgs, run, method, payload, options }) => {
    await run(makeArgs(command, rawArgs));

    expect(callDaemon).toHaveBeenCalledWith(method, payload, ...(options ? [options] : []));
  });
});
