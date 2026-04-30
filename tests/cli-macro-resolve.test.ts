import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedArgs } from "../src/cli/args";
import { runMacroResolve } from "../src/cli/commands/macro-resolve";

const { callDaemon } = vi.hoisted(() => ({
  callDaemon: vi.fn()
}));

vi.mock("../src/cli/client", () => ({
  callDaemon
}));

const makeArgs = (rawArgs: string[]): ParsedArgs => ({
  command: "macro-resolve",
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

describe("macro-resolve CLI command", () => {
  beforeEach(() => {
    callDaemon.mockReset();
  });

  it("passes execute mode through and preserves blocker metadata in response data", async () => {
    callDaemon.mockResolvedValue({
      runtime: "macros",
      resolution: { action: { source: "web", operation: "fetch", input: { url: "https://x.com/i/flow/login" } } },
      followthroughSummary: "Review execution.meta.blocker and failures before retrying the macro.",
      suggestedNextAction: "Run npx opendevbrowser macro-resolve --expression='@web.fetch(\"https://x.com/i/flow/login\")' --execute --challenge-automation-mode browser_with_helper --output-format json after reviewing execution.meta.blocker.",
      suggestedSteps: [
        {
          title: "Retry the macro with browser automation",
          command: "npx opendevbrowser macro-resolve --expression='@web.fetch(\"https://x.com/i/flow/login\")' --execute --challenge-automation-mode browser_with_helper --output-format json",
          reason: "Use browser automation to satisfy the login challenge before retrying the fetch."
        }
      ],
      execution: {
        records: [],
        failures: [{ error: { code: "auth", message: "login required" } }],
        metrics: { attempted: 1, succeeded: 0, failed: 1, retries: 0, latencyMs: 1 },
        meta: {
          ok: false,
          partial: false,
          sourceSelection: "web",
          providerOrder: ["web/default"],
          trace: { requestId: "req-1" },
          blocker: {
            schemaVersion: "1.0",
            type: "auth_required",
            confidence: 0.97
          }
        }
      }
    });

    const result = await runMacroResolve(makeArgs([
      "--expression=@web.fetch(\"https://x.com/i/flow/login\")",
      "--execute"
    ]));

    expect(callDaemon).toHaveBeenCalledWith("macro.resolve", {
      expression: "@web.fetch(\"https://x.com/i/flow/login\")",
      defaultProvider: undefined,
      includeCatalog: false,
      execute: true
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("Review execution.meta.blocker and failures before retrying the macro.");
    expect(result.message).toContain("Next step:");
    expect(result.message).toContain("--challenge-automation-mode browser_with_helper");
    expect(result.data).toMatchObject({
      followthroughSummary: "Review execution.meta.blocker and failures before retrying the macro.",
      suggestedNextAction: expect.stringContaining("--challenge-automation-mode browser_with_helper"),
      execution: {
        meta: {
          blocker: { type: "auth_required" }
        }
      }
    });
  });

  it("keeps non-blocker success payloads unchanged", async () => {
    callDaemon.mockResolvedValue({
      runtime: "macros",
      resolution: { action: { source: "community", operation: "search", input: { query: "openai" } } },
      followthroughSummary: "Review execution.records and trace metadata before widening the macro or changing providers.",
      suggestedNextAction: "Inspect execution.records and execution.meta, then rerun npx opendevbrowser macro-resolve --expression='@community.search(\"openai\")' --execute --output-format json if you need to refine the query.",
      suggestedSteps: [
        {
          title: "Inspect the returned records",
          command: "npx opendevbrowser macro-resolve --expression='@community.search(\"openai\")' --execute --output-format json",
          reason: "Review execution.records before changing providers or widening the macro."
        }
      ],
      execution: {
        records: [{ id: "1" }],
        failures: [],
        metrics: { attempted: 1, succeeded: 1, failed: 0, retries: 0, latencyMs: 1 },
        meta: {
          ok: true,
          partial: false,
          sourceSelection: "community",
          providerOrder: ["community/default"],
          trace: { requestId: "req-2" }
        }
      }
    });

    const result = await runMacroResolve(makeArgs([
      "--expression=@community.search(\"openai\")",
      "--execute"
    ]));

    expect(result.success).toBe(true);
    expect(result.message).toContain("Review execution.records and trace metadata before widening the macro or changing providers.");
    expect(result.message).toContain("Next step:");
    expect(result.data).toMatchObject({
      followthroughSummary: "Review execution.records and trace metadata before widening the macro or changing providers.",
      suggestedNextAction: expect.stringContaining("npx opendevbrowser macro-resolve")
    });
    const executionMeta = (result.data as { execution?: { meta?: Record<string, unknown> } }).execution?.meta;
    expect(executionMeta?.ok).toBe(true);
    expect(executionMeta).not.toHaveProperty("blocker");
  });

  it("uses the shared runnable next-step reader when explicit macro next action is absent", async () => {
    callDaemon.mockResolvedValue({
      runtime: "macros",
      followthroughSummary: "Review the resolved macro before rerunning.",
      suggestedSteps: [
        {
          command: "npx opendevbrowser macro-resolve --expression '@community.search(\"openai\")' --execute <provider>",
          reason: "Placeholder command should not be presented as the next step."
        },
        {
          command: "npx opendevbrowser macro-resolve --expression '@community.search(\"openai\")' --execute --output-format json",
          reason: "Runnable command should be used as the next step."
        }
      ],
      resolution: { action: { source: "community", operation: "search", input: { query: "openai" } } }
    });

    const result = await runMacroResolve(makeArgs([
      "--expression=@community.search(\"openai\")"
    ]));

    expect(result.message).toBe(
      "Review the resolved macro before rerunning. Next step: npx opendevbrowser macro-resolve --expression '@community.search(\"openai\")' --execute --output-format json"
    );
  });

  it("buffers transport timeout above the workflow payload timeout", async () => {
    callDaemon.mockResolvedValue({
      runtime: "macros",
      resolution: { action: { source: "web", operation: "search", input: { query: "openai" } } },
      execution: {
        records: [],
        failures: [],
        metrics: { attempted: 1, succeeded: 1, failed: 0, retries: 0, latencyMs: 1 },
        meta: {
          ok: true,
          partial: false,
          sourceSelection: "web",
          providerOrder: ["web/default"],
          trace: { requestId: "req-timeout" }
        }
      }
    });

    await runMacroResolve(makeArgs([
      "--expression=@web.search(\"openai\")",
      "--execute",
      "--timeout-ms=120000"
    ]));

    expect(callDaemon).toHaveBeenCalledWith(
      "macro.resolve",
      {
        expression: "@web.search(\"openai\")",
        defaultProvider: undefined,
        includeCatalog: false,
        execute: true,
        timeoutMs: 120000
      },
      { timeoutMs: 180000 }
    );
  });

  it("preserves long workflow timeouts while extending daemon transport headroom", async () => {
    callDaemon.mockResolvedValue({
      runtime: "macros",
      resolution: { action: { source: "social", operation: "search", input: { query: "browser automation x" } } },
      execution: {
        records: [],
        failures: [],
        metrics: { attempted: 1, succeeded: 1, failed: 0, retries: 0, latencyMs: 1 },
        meta: {
          ok: true,
          partial: false,
          sourceSelection: "social",
          providerOrder: ["social/x"],
          trace: { requestId: "req-long-timeout" }
        }
      }
    });

    await runMacroResolve(makeArgs([
      "--expression=@media.search(\"browser automation x\", \"x\", 5)",
      "--execute",
      "--timeout-ms=180000"
    ]));

    expect(callDaemon).toHaveBeenCalledWith(
      "macro.resolve",
      {
        expression: "@media.search(\"browser automation x\", \"x\", 5)",
        defaultProvider: undefined,
        includeCatalog: false,
        execute: true,
        timeoutMs: 180000
      },
      { timeoutMs: 240000 }
    );
  });

  it("passes challenge automation mode through the daemon payload", async () => {
    callDaemon.mockResolvedValue({
      runtime: "macros",
      resolution: { action: { source: "community", operation: "search", input: { query: "openai" } } }
    });

    await runMacroResolve(makeArgs([
      "--expression=@community.search(\"openai\")",
      "--execute",
      "--challenge-automation-mode=browser_with_helper"
    ]));

    expect(callDaemon).toHaveBeenCalledWith("macro.resolve", {
      expression: "@community.search(\"openai\")",
      defaultProvider: undefined,
      includeCatalog: false,
      execute: true,
      challengeAutomationMode: "browser_with_helper"
    });
  });
});
