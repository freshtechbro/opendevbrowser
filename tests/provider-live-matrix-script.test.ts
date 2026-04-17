import { describe, expect, it, vi } from "vitest";
import {
  buildLiveRegressionEnv,
  classifyMatrixRecords,
  isEnvLimitedDetail,
  NESTED_LIVE_REGRESSION_TIMEOUT_MS,
  parseArgs,
  REQUIRED_PLAYWRIGHT_CORE_FILES,
  restoreDaemonAfterNestedLiveRegression,
  WORKFLOW_RESEARCH_PROBE_ARGS,
  WORKFLOW_YOUTUBE_TRANSCRIPT_PROBE_ARGS
} from "../scripts/provider-live-matrix.mjs";
import {
  MATRIX_ENV_LIMITED_CODES,
  MATRIX_SHOPPING_PROVIDER_TIMEOUT_MS
} from "../scripts/shared/workflow-lane-constants.mjs";

describe("provider-live-matrix parseArgs", () => {
  it("enables strict release defaults with --release-gate", () => {
    const parsed = parseArgs(["--release-gate"]);

    expect(parsed.strictGate).toBe(true);
    expect(parsed.runAuthGated).toBe(true);
    expect(parsed.runHighFriction).toBe(true);
    expect(parsed.runSocialPostCases).toBe(true);
    expect(parsed.runLiveRegression).toBe(false);
    expect(parsed.runBrowserProbes).toBe(true);
    expect(parsed.runWorkflows).toBe(true);
  });

  it("allows opting into nested live-regression in release-gate mode", () => {
    const parsed = parseArgs(["--release-gate", "--include-live-regression"]);
    expect(parsed.runLiveRegression).toBe(true);
  });

  it("rejects --release-gate combined with --smoke", () => {
    expect(() => parseArgs(["--release-gate", "--smoke"])).toThrow(
      "--release-gate cannot be combined with --smoke."
    );
  });

  it("keeps nested live-regression from stopping daemon by default", () => {
    const env = buildLiveRegressionEnv(
      { PATH: "/tmp", OPENCODE_CONFIG_DIR: "/tmp/config" },
      { useGlobalEnv: false }
    );

    expect(env.LIVE_MATRIX_USE_GLOBAL).toBe("0");
    expect(env.LIVE_MATRIX_STOP_DAEMON).toBe("0");
  });

  it("restarts the matrix daemon when nested live-regression leaves it unavailable", async () => {
    const statusReader = vi.fn(() => ({
      status: 1,
      detail: "Daemon not running. Start with `opendevbrowser serve`."
    }));
    const starter = vi.fn();
    const waiter = vi.fn(async () => ({
      status: 0,
      json: { data: { relay: { running: true } } }
    }));

    const result = await restoreDaemonAfterNestedLiveRegression(
      { OPENCODE_CONFIG_DIR: "/tmp/provider-live" },
      { statusReader, starter, waiter }
    );

    expect(starter).toHaveBeenCalledTimes(1);
    expect(waiter).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      restarted: true,
      status: {
        status: 0,
        json: { data: { relay: { running: true } } }
      }
    });
  });

  it("reuses the existing matrix daemon when nested live-regression keeps it alive", async () => {
    const healthyStatus = {
      status: 0,
      json: { data: { relay: { running: true } } }
    };
    const statusReader = vi.fn(() => healthyStatus);
    const starter = vi.fn();
    const waiter = vi.fn();

    const result = await restoreDaemonAfterNestedLiveRegression(
      { OPENCODE_CONFIG_DIR: "/tmp/provider-live" },
      { statusReader, starter, waiter }
    );

    expect(starter).not.toHaveBeenCalled();
    expect(waiter).not.toHaveBeenCalled();
    expect(result).toEqual({
      restarted: false,
      status: healthyStatus
    });
  });

  it("treats Playwright server registry files as integrity sentinels", () => {
    expect(REQUIRED_PLAYWRIGHT_CORE_FILES).toContain("lib/server/index.js");
    expect(REQUIRED_PLAYWRIGHT_CORE_FILES).toContain("lib/server/registry/index.js");
  });

  it("keeps timeout env-limited for matrix classification and preserves the shared target timeout bucket", () => {
    expect(NESTED_LIVE_REGRESSION_TIMEOUT_MS).toBe(1_500_000);
    expect(MATRIX_ENV_LIMITED_CODES.has("timeout")).toBe(true);
    expect(MATRIX_SHOPPING_PROVIDER_TIMEOUT_MS.get("shopping/target")).toBe("120000");
    expect(WORKFLOW_RESEARCH_PROBE_ARGS).toContain("--source-selection");
    expect(WORKFLOW_RESEARCH_PROBE_ARGS).toContain("auto");
    expect(WORKFLOW_RESEARCH_PROBE_ARGS).not.toContain("all");
    expect(WORKFLOW_RESEARCH_PROBE_ARGS).toContain("--timeout-ms");
    expect(WORKFLOW_RESEARCH_PROBE_ARGS).toContain("120000");
    expect(WORKFLOW_YOUTUBE_TRANSCRIPT_PROBE_ARGS).toContain("scripts/youtube-transcript-live-probe.mjs");
    expect(WORKFLOW_YOUTUBE_TRANSCRIPT_PROBE_ARGS).toContain("--youtube-mode");
    expect(classifyMatrixRecords(0, [
      {
        error: {
          code: "timeout",
          message: "Provider request timed out after 120000ms"
        }
      }
    ])).toEqual({
      status: "env_limited",
      reason: "reason_codes=timeout"
    });
  });

  it("treats ops-client disconnects as env-limited extension probe failures", () => {
    expect(isEnvLimitedDetail("Ops client not connected")).toBe(true);
    expect(isEnvLimitedDetail("[ops_unavailable] Extension not connected to relay.")).toBe(true);
  });
});
