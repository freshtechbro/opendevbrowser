import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedArgs } from "../src/cli/args";
import { runStatusCapabilities } from "../src/cli/commands/status-capabilities";
import { runReviewDesktop } from "../src/cli/commands/nav/review-desktop";
import { runSessionInspectorPlan } from "../src/cli/commands/session/inspector-plan";
import { runSessionInspectorAudit } from "../src/cli/commands/session/inspector-audit";

const { callDaemon } = vi.hoisted(() => ({
  callDaemon: vi.fn()
}));

vi.mock("../src/cli/client", () => ({
  callDaemon
}));

const makeArgs = (command: ParsedArgs["command"], rawArgs: string[]): ParsedArgs => ({
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

describe("review surface CLI wrappers", () => {
  beforeEach(() => {
    callDaemon.mockReset();
  });

  it("forwards timeout and challenge mode through status-capabilities", async () => {
    callDaemon.mockResolvedValue({ host: { desktopObservationAvailable: true } });

    const result = await runStatusCapabilities(makeArgs("status-capabilities", [
      "--session-id",
      "s1",
      "--target-id",
      "t1",
      "--challenge-automation-mode=browser",
      "--timeout-ms=4500"
    ]));

    expect(callDaemon).toHaveBeenCalledWith("status.capabilities", {
      sessionId: "s1",
      targetId: "t1",
      challengeAutomationMode: "browser"
    }, {
      timeoutMs: 4500
    });
    expect(result).toEqual({
      success: true,
      message: "Capability discovery captured.",
      data: { host: { desktopObservationAvailable: true } }
    });
  });

  it("forwards review-desktop arguments and timeout", async () => {
    callDaemon.mockResolvedValue({ observation: { observationId: "obs-1" } });

    const result = await runReviewDesktop(makeArgs("review-desktop", [
      "--session-id",
      "s2",
      "--target-id",
      "t2",
      "--reason",
      "qa",
      "--max-chars",
      "120",
      "--cursor",
      "cursor-1",
      "--timeout-ms",
      "4600"
    ]));

    expect(callDaemon).toHaveBeenCalledWith("nav.reviewDesktop", {
      sessionId: "s2",
      targetId: "t2",
      reason: "qa",
      maxChars: 120,
      cursor: "cursor-1"
    }, {
      timeoutMs: 4600
    });
    expect(result).toEqual({
      success: true,
      message: "Desktop-assisted review captured.",
      data: { observation: { observationId: "obs-1" } }
    });
  });

  it("requires --session-id for review-desktop", async () => {
    await expect(runReviewDesktop(makeArgs("review-desktop", []))).rejects.toThrow("Missing --session-id");
    expect(callDaemon).not.toHaveBeenCalled();
  });

  it("forwards timeout and challenge mode through session-inspector-plan", async () => {
    callDaemon.mockResolvedValue({ suggestedSteps: [] });

    await runSessionInspectorPlan(makeArgs("session-inspector-plan", [
      "--session-id",
      "s3",
      "--target-id",
      "t3",
      "--challenge-automation-mode",
      "browser_with_helper",
      "--timeout-ms",
      "4700"
    ]));

    expect(callDaemon).toHaveBeenCalledWith("session.inspectPlan", {
      sessionId: "s3",
      targetId: "t3",
      challengeAutomationMode: "browser_with_helper"
    }, {
      timeoutMs: 4700
    });
  });

  it("forwards merged review and inspector args through session-inspector-audit", async () => {
    callDaemon.mockResolvedValue({ sessionInspector: {}, challengePlan: {} });

    await runSessionInspectorAudit(makeArgs("session-inspector-audit", [
      "--session-id",
      "s4",
      "--target-id",
      "t4",
      "--reason",
      "audit",
      "--max-chars",
      "200",
      "--cursor",
      "cursor-2",
      "--include-urls",
      "--since-console-seq",
      "1",
      "--since-network-seq",
      "2",
      "--since-exception-seq",
      "3",
      "--max",
      "25",
      "--request-id",
      "req-4",
      "--challenge-automation-mode=browser",
      "--timeout-ms=4800"
    ]));

    expect(callDaemon).toHaveBeenCalledWith("session.inspectAudit", {
      sessionId: "s4",
      targetId: "t4",
      reason: "audit",
      maxChars: 200,
      cursor: "cursor-2",
      includeUrls: true,
      sinceConsoleSeq: 1,
      sinceNetworkSeq: 2,
      sinceExceptionSeq: 3,
      max: 25,
      requestId: "req-4",
      challengeAutomationMode: "browser"
    }, {
      timeoutMs: 4800
    });
  });
});
