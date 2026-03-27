import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedArgs } from "../src/cli/args";
import { runPerf } from "../src/cli/commands/devtools/perf";
import { runDomAttr } from "../src/cli/commands/dom/attr";
import { runDomChecked } from "../src/cli/commands/dom/checked";
import { runDomEnabled } from "../src/cli/commands/dom/enabled";
import { runDomHtml } from "../src/cli/commands/dom/html";
import { runDomText } from "../src/cli/commands/dom/text";
import { runDomValue } from "../src/cli/commands/dom/value";
import { runDomVisible } from "../src/cli/commands/dom/visible";
import { runCheck } from "../src/cli/commands/interact/check";
import { runClick } from "../src/cli/commands/interact/click";
import { runHover } from "../src/cli/commands/interact/hover";
import { runPress } from "../src/cli/commands/interact/press";
import { runScrollIntoView } from "../src/cli/commands/interact/scroll-into-view";
import { runScroll } from "../src/cli/commands/interact/scroll";
import { runSelect } from "../src/cli/commands/interact/select";
import { runType } from "../src/cli/commands/interact/type";
import { runUncheck } from "../src/cli/commands/interact/uncheck";
import { runGoto } from "../src/cli/commands/nav/goto";
import { runReview } from "../src/cli/commands/nav/review";
import { runSnapshot } from "../src/cli/commands/nav/snapshot";
import { runWait } from "../src/cli/commands/nav/wait";

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

type RunFn = (args: ParsedArgs) => Promise<unknown>;

const CASES: Array<{
  title: string;
  command: string;
  run: RunFn;
  rawArgs: string[];
  method: string;
  payload: Record<string, unknown>;
}> = [
  {
    title: "goto",
    command: "goto",
    run: runGoto,
    rawArgs: ["--session-id", "s1", "--url", "https://example.com", "--target-id", "tab-11"],
    method: "nav.goto",
    payload: { sessionId: "s1", url: "https://example.com", waitUntil: undefined, timeoutMs: undefined, targetId: "tab-11" }
  },
  {
    title: "wait",
    command: "wait",
    run: runWait,
    rawArgs: ["--session-id", "s1", "--until", "load", "--target-id", "tab-11"],
    method: "nav.wait",
    payload: { sessionId: "s1", ref: undefined, state: undefined, until: "load", timeoutMs: undefined, targetId: "tab-11" }
  },
  {
    title: "snapshot",
    command: "snapshot",
    run: runSnapshot,
    rawArgs: ["--session-id", "s1", "--mode", "outline", "--target-id", "tab-11"],
    method: "nav.snapshot",
    payload: { sessionId: "s1", mode: "outline", maxChars: undefined, cursor: undefined, targetId: "tab-11" }
  },
  {
    title: "review",
    command: "review",
    run: runReview,
    rawArgs: ["--session-id", "s1", "--target-id", "tab-11"],
    method: "nav.review",
    payload: { sessionId: "s1", maxChars: undefined, cursor: undefined, targetId: "tab-11" }
  },
  {
    title: "click",
    command: "click",
    run: runClick,
    rawArgs: ["--session-id", "s1", "--ref", "r1", "--target-id", "tab-11"],
    method: "interact.click",
    payload: { sessionId: "s1", ref: "r1", targetId: "tab-11" }
  },
  {
    title: "hover",
    command: "hover",
    run: runHover,
    rawArgs: ["--session-id", "s1", "--ref", "r1", "--target-id", "tab-11"],
    method: "interact.hover",
    payload: { sessionId: "s1", ref: "r1", targetId: "tab-11" }
  },
  {
    title: "press",
    command: "press",
    run: runPress,
    rawArgs: ["--session-id", "s1", "--key", "Enter", "--ref", "r1", "--target-id", "tab-11"],
    method: "interact.press",
    payload: { sessionId: "s1", key: "Enter", ref: "r1", targetId: "tab-11" }
  },
  {
    title: "check",
    command: "check",
    run: runCheck,
    rawArgs: ["--session-id", "s1", "--ref", "r1", "--target-id", "tab-11"],
    method: "interact.check",
    payload: { sessionId: "s1", ref: "r1", targetId: "tab-11" }
  },
  {
    title: "uncheck",
    command: "uncheck",
    run: runUncheck,
    rawArgs: ["--session-id", "s1", "--ref", "r1", "--target-id", "tab-11"],
    method: "interact.uncheck",
    payload: { sessionId: "s1", ref: "r1", targetId: "tab-11" }
  },
  {
    title: "type",
    command: "type",
    run: runType,
    rawArgs: ["--session-id", "s1", "--ref", "r1", "--text", "hello", "--target-id", "tab-11"],
    method: "interact.type",
    payload: { sessionId: "s1", ref: "r1", text: "hello", clear: undefined, submit: undefined, targetId: "tab-11" }
  },
  {
    title: "select",
    command: "select",
    run: runSelect,
    rawArgs: ["--session-id", "s1", "--ref", "r1", "--values", "one,two", "--target-id", "tab-11"],
    method: "interact.select",
    payload: { sessionId: "s1", ref: "r1", values: ["one", "two"], targetId: "tab-11" }
  },
  {
    title: "scroll",
    command: "scroll",
    run: runScroll,
    rawArgs: ["--session-id", "s1", "--dy", "240", "--target-id", "tab-11"],
    method: "interact.scroll",
    payload: { sessionId: "s1", ref: undefined, dy: 240, targetId: "tab-11" }
  },
  {
    title: "scroll-into-view",
    command: "scroll-into-view",
    run: runScrollIntoView,
    rawArgs: ["--session-id", "s1", "--ref", "r1", "--target-id", "tab-11"],
    method: "interact.scrollIntoView",
    payload: { sessionId: "s1", ref: "r1", targetId: "tab-11" }
  },
  {
    title: "dom-html",
    command: "dom-html",
    run: runDomHtml,
    rawArgs: ["--session-id", "s1", "--ref", "r1", "--target-id", "tab-11"],
    method: "dom.getHtml",
    payload: { sessionId: "s1", ref: "r1", maxChars: undefined, targetId: "tab-11" }
  },
  {
    title: "dom-text",
    command: "dom-text",
    run: runDomText,
    rawArgs: ["--session-id", "s1", "--ref", "r1", "--target-id", "tab-11"],
    method: "dom.getText",
    payload: { sessionId: "s1", ref: "r1", maxChars: undefined, targetId: "tab-11" }
  },
  {
    title: "dom-attr",
    command: "dom-attr",
    run: runDomAttr,
    rawArgs: ["--session-id", "s1", "--ref", "r1", "--attr", "href", "--target-id", "tab-11"],
    method: "dom.getAttr",
    payload: { sessionId: "s1", ref: "r1", name: "href", targetId: "tab-11" }
  },
  {
    title: "dom-value",
    command: "dom-value",
    run: runDomValue,
    rawArgs: ["--session-id", "s1", "--ref", "r1", "--target-id", "tab-11"],
    method: "dom.getValue",
    payload: { sessionId: "s1", ref: "r1", targetId: "tab-11" }
  },
  {
    title: "dom-visible",
    command: "dom-visible",
    run: runDomVisible,
    rawArgs: ["--session-id", "s1", "--ref", "r1", "--target-id", "tab-11"],
    method: "dom.isVisible",
    payload: { sessionId: "s1", ref: "r1", targetId: "tab-11" }
  },
  {
    title: "dom-enabled",
    command: "dom-enabled",
    run: runDomEnabled,
    rawArgs: ["--session-id", "s1", "--ref", "r1", "--target-id", "tab-11"],
    method: "dom.isEnabled",
    payload: { sessionId: "s1", ref: "r1", targetId: "tab-11" }
  },
  {
    title: "dom-checked",
    command: "dom-checked",
    run: runDomChecked,
    rawArgs: ["--session-id", "s1", "--ref", "r1", "--target-id", "tab-11"],
    method: "dom.isChecked",
    payload: { sessionId: "s1", ref: "r1", targetId: "tab-11" }
  },
  {
    title: "perf",
    command: "perf",
    run: runPerf,
    rawArgs: ["--session-id", "s1", "--target-id", "tab-11"],
    method: "devtools.perf",
    payload: { sessionId: "s1", targetId: "tab-11" }
  }
];

describe("CLI target-id forwarding", () => {
  beforeEach(() => {
    callDaemon.mockReset();
    callDaemon.mockResolvedValue({});
  });

  it.each(CASES)("passes target-id through $title", async ({ command, run, rawArgs, method, payload }) => {
    await run(makeArgs(command, rawArgs));

    expect(callDaemon).toHaveBeenCalledWith(method, payload);
  });

  it("forwards snapshot timeout overrides to the daemon client", async () => {
    await runSnapshot(makeArgs("snapshot", [
      "--session-id", "s1",
      "--mode", "actionables",
      "--target-id", "tab-11",
      "--timeout-ms", "15000"
    ]));

    expect(callDaemon).toHaveBeenCalledWith(
      "nav.snapshot",
      {
        sessionId: "s1",
        mode: "actionables",
        maxChars: undefined,
        cursor: undefined,
        targetId: "tab-11"
      },
      { timeoutMs: 15000 }
    );
  });

  it("forwards review timeout overrides to the daemon client", async () => {
    await runReview(makeArgs("review", [
      "--session-id", "s1",
      "--target-id", "tab-11",
      "--timeout-ms", "15000"
    ]));

    expect(callDaemon).toHaveBeenCalledWith(
      "nav.review",
      {
        sessionId: "s1",
        maxChars: undefined,
        cursor: undefined,
        targetId: "tab-11"
      },
      { timeoutMs: 15000 }
    );
  });
});
