import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedArgs } from "../src/cli/args";
import { DEFAULT_REVIEW_TRANSPORT_TIMEOUT_MS } from "../src/cli/transport-timeouts";
import { runSessionInspector } from "../src/cli/commands/session/inspector";
import { runSessionInspectorPlan } from "../src/cli/commands/session/inspector-plan";
import { runSessionInspectorAudit } from "../src/cli/commands/session/inspector-audit";

const { callDaemon } = vi.hoisted(() => ({
  callDaemon: vi.fn()
}));

vi.mock("../src/cli/client", () => ({
  callDaemon
}));

function makeArgs(command: ParsedArgs["command"], rawArgs: string[]): ParsedArgs {
  return {
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
  };
}

describe("CLI next-step guidance", () => {
  beforeEach(() => {
    callDaemon.mockReset();
  });

  it("appends suggestedNextAction for session-inspector", async () => {
    const payload = {
      session: { sessionId: "s1" },
      suggestedNextAction: "Run session-inspector-plan --session-id s1"
    };
    callDaemon.mockResolvedValue(payload);

    const result = await runSessionInspector(makeArgs("session-inspector", ["--session-id", "s1"]));

    expect(callDaemon).toHaveBeenCalledWith("session.inspect", {
      sessionId: "s1"
    });
    expect(result).toEqual({
      success: true,
      message: "Session inspector snapshot captured. Next step: Run session-inspector-plan --session-id s1",
      data: payload
    });
  });

  it("appends the first suggested step reason for session-inspector-plan", async () => {
    const payload = {
      suggestedSteps: [
        { reason: "Run session-inspector-audit --session-id s1 to capture a correlated bundle." },
        { reason: "Ignored second step." }
      ]
    };
    callDaemon.mockResolvedValue(payload);

    const result = await runSessionInspectorPlan(makeArgs("session-inspector-plan", ["--session-id", "s1"]));

    expect(callDaemon).toHaveBeenCalledWith("session.inspectPlan", {
      sessionId: "s1"
    }, {
      timeoutMs: DEFAULT_REVIEW_TRANSPORT_TIMEOUT_MS
    });
    expect(result).toEqual({
      success: true,
      message: "Challenge inspect plan captured. Next step: Run session-inspector-audit --session-id s1 to capture a correlated bundle.",
      data: payload
    });
  });

  it("prefers session inspector guidance over challenge-plan fallback in session-inspector-audit", async () => {
    const payload = {
      sessionInspector: {
        suggestedNextAction: "Run review --session-id s1 for focused browser evidence."
      },
      challengePlan: {
        suggestedSteps: [
          { reason: "Fallback challenge-plan reason." }
        ]
      }
    };
    callDaemon.mockResolvedValue(payload);

    const result = await runSessionInspectorAudit(makeArgs("session-inspector-audit", ["--session-id", "s1"]));

    expect(callDaemon).toHaveBeenCalledWith("session.inspectAudit", {
      sessionId: "s1"
    }, {
      timeoutMs: DEFAULT_REVIEW_TRANSPORT_TIMEOUT_MS
    });
    expect(result).toEqual({
      success: true,
      message: "Correlated audit bundle captured. Next step: Run review --session-id s1 for focused browser evidence.",
      data: payload
    });
  });

  it("falls back to challenge plan guidance when audit session guidance is absent", async () => {
    const payload = {
      sessionInspector: {},
      challengePlan: {
        suggestedSteps: [
          { reason: "Run review-desktop --session-id s1 if browser-only evidence is insufficient." }
        ]
      }
    };
    callDaemon.mockResolvedValue(payload);

    const result = await runSessionInspectorAudit(makeArgs("session-inspector-audit", ["--session-id", "s1"]));

    expect(result).toEqual({
      success: true,
      message: "Correlated audit bundle captured. Next step: Run review-desktop --session-id s1 if browser-only evidence is insufficient.",
      data: payload
    });
  });
});
