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
    expect(result.message).toBe("Macro resolved and executed.");
    expect(result.data).toMatchObject({
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
    const executionMeta = (result.data as { execution?: { meta?: Record<string, unknown> } }).execution?.meta;
    expect(executionMeta?.ok).toBe(true);
    expect(executionMeta).not.toHaveProperty("blocker");
  });

  it("passes timeout-ms through daemon call options", async () => {
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
        execute: true
      },
      { timeoutMs: 120000 }
    );
  });
});
