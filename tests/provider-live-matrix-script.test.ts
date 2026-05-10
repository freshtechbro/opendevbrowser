import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildDefaultSkippedStep,
  buildLiveShoppingRunArgs,
  classifySuccessfulResearchWorkflow,
  classifyNestedLiveRegressionStatus,
  classifyProductVideoAmazonStatus,
  buildLiveRegressionEnv,
  classifyMatrixRecords,
  isEnvLimitedDetail,
  NESTED_LIVE_REGRESSION_TIMEOUT_MS,
  parseArgs,
  REQUIRED_PLAYWRIGHT_CORE_FILES,
  resolveMatrixSocialPostStatus,
  resolveMatrixSocialSearchStatus,
  resolveSocialFallbackRetry,
  restoreDaemonAfterNestedLiveRegression,
  runNestedLiveRegressionMode,
  validateSuccessfulWorkflowArtifact,
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
    const stopper = vi.fn();
    const starter = vi.fn();
    const waiter = vi.fn(async () => ({
      status: 0,
      json: { data: { relay: { running: true } } }
    }));

    const result = await restoreDaemonAfterNestedLiveRegression(
      { OPENCODE_CONFIG_DIR: "/tmp/provider-live" },
      { statusReader, stopper, starter, waiter }
    );

    expect(stopper).not.toHaveBeenCalled();
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
    const stopper = vi.fn();
    const starter = vi.fn();
    const waiter = vi.fn();

    const result = await restoreDaemonAfterNestedLiveRegression(
      { OPENCODE_CONFIG_DIR: "/tmp/provider-live" },
      { statusReader, stopper, starter, waiter }
    );

    expect(stopper).not.toHaveBeenCalled();
    expect(starter).not.toHaveBeenCalled();
    expect(waiter).not.toHaveBeenCalled();
    expect(result).toEqual({
      restarted: false,
      status: healthyStatus
    });
  });

  it("reuses the existing matrix daemon when only a healthy extension relay remains", async () => {
    const healthyExtensionRelay = {
      status: 0,
      json: {
        data: {
          relay: {
            running: true,
            opsConnected: true,
            canvasConnected: false,
            annotationConnected: false,
            cdpConnected: false,
            extensionConnected: true,
            extensionHandshakeComplete: true
          }
        }
      }
    };
    const statusReader = vi.fn(() => healthyExtensionRelay);
    const stopper = vi.fn();
    const starter = vi.fn();
    const waiter = vi.fn();

    const result = await restoreDaemonAfterNestedLiveRegression(
      { OPENCODE_CONFIG_DIR: "/tmp/provider-live" },
      { statusReader, stopper, starter, waiter }
    );

    expect(stopper).not.toHaveBeenCalled();
    expect(starter).not.toHaveBeenCalled();
    expect(waiter).not.toHaveBeenCalled();
    expect(result).toEqual({
      restarted: false,
      status: healthyExtensionRelay
    });
  });

  it("restarts the matrix daemon when nested live-regression leaves dirty relay clients behind", async () => {
    const statusReader = vi.fn(() => ({
      status: 0,
      json: {
        data: {
          relay: {
            running: true,
            opsConnected: true,
            canvasConnected: false,
            annotationConnected: false,
            cdpConnected: false,
            extensionConnected: false,
            extensionHandshakeComplete: true
          }
        }
      }
    }));
    const stopper = vi.fn();
    const starter = vi.fn();
    const waiter = vi.fn(async () => ({
      status: 0,
      json: { data: { relay: { running: true } } }
    }));

    const result = await restoreDaemonAfterNestedLiveRegression(
      { OPENCODE_CONFIG_DIR: "/tmp/provider-live" },
      { statusReader, stopper, starter, waiter }
    );

    expect(stopper).toHaveBeenCalledTimes(1);
    expect(starter).toHaveBeenCalledTimes(1);
    expect(waiter).toHaveBeenCalledTimes(1);
    expect(result.restarted).toBe(true);
  });

  it("fails restart recovery when the replacement daemon still reports dirty relay state", async () => {
    const dirtyStatus = {
      status: 0,
      json: {
        data: {
          relay: {
            running: true,
            opsConnected: true,
            canvasConnected: false,
            annotationConnected: false,
            cdpConnected: false,
            extensionConnected: false,
            extensionHandshakeComplete: true
          }
        }
      }
    };
    const statusReader = vi.fn(() => dirtyStatus);
    const stopper = vi.fn();
    const starter = vi.fn();
    const waiter = vi.fn(async () => dirtyStatus);

    await expect(restoreDaemonAfterNestedLiveRegression(
      { OPENCODE_CONFIG_DIR: "/tmp/provider-live" },
      { statusReader, stopper, starter, waiter }
    )).rejects.toThrow("daemon not ready after nested live regression");

    expect(stopper).toHaveBeenCalledTimes(1);
    expect(starter).toHaveBeenCalledTimes(1);
    expect(waiter).toHaveBeenCalledTimes(1);
  });

  it("treats Playwright server registry files as integrity sentinels", () => {
    expect(REQUIRED_PLAYWRIGHT_CORE_FILES).toContain("lib/server/index.js");
    expect(REQUIRED_PLAYWRIGHT_CORE_FILES).toContain("lib/server/registry/index.js");
  });

  it("fails timeout by default, skips default-gated lanes, and only downgrades approved product-video details", () => {
    expect(NESTED_LIVE_REGRESSION_TIMEOUT_MS).toBe(1_500_000);
    expect(MATRIX_ENV_LIMITED_CODES.has("timeout")).toBe(false);
    expect(MATRIX_SHOPPING_PROVIDER_TIMEOUT_MS.get("shopping/target")).toBe("120000");
    expect(WORKFLOW_RESEARCH_PROBE_ARGS).toContain("--sources");
    expect(WORKFLOW_RESEARCH_PROBE_ARGS).toContain("web,community");
    expect(WORKFLOW_RESEARCH_PROBE_ARGS).not.toContain("--source-selection");
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
      status: "fail",
      reason: "unexpected_reason_codes=timeout"
    });
    expect(buildDefaultSkippedStep(
      "provider.shopping.bestbuy.search",
      "skipped_high_friction_by_default",
      { highFriction: true, includeHighFriction: false }
    )).toEqual({
      id: "provider.shopping.bestbuy.search",
      status: "skipped",
      detail: "skipped_high_friction_by_default",
      data: {
        skipped: true,
        highFriction: true,
        includeHighFriction: false
      }
    });
    expect(classifyProductVideoAmazonStatus(0, null)).toBe("pass");
    expect(classifyProductVideoAmazonStatus(
      1,
      "Amazon requires manual browser follow-up before capture."
    )).toBe("env_limited");
    expect(classifyProductVideoAmazonStatus(
      1,
      "Provider request timed out after 300000ms"
    )).toBe("fail");
    expect(classifyNestedLiveRegressionStatus(0, {
      counts: {
        fail: 0,
        env_limited: 1
      }
    })).toBe("env_limited");
    expect(classifyNestedLiveRegressionStatus(0, {
      counts: {
        fail: 0,
        env_limited: 1
      }
    }, { strictGate: true })).toBe("fail");
  });

  it("treats ops-client disconnects as env-limited extension probe failures", () => {
    expect(isEnvLimitedDetail("Ops client not connected")).toBe(true);
    expect(isEnvLimitedDetail("[ops_unavailable] Extension not connected to relay.")).toBe(true);
  });

  it("keeps live social recovery signals diagnostic instead of promoting status", () => {
    expect(resolveMatrixSocialSearchStatus({
      platform: "x",
      strictGate: true,
      resultStatus: 0,
      resultDetail: null,
      execution: {
        records: [],
        failures: [],
        hasExecutionPayload: false
      },
      reportSteps: [{ id: "browser.extension.x.search", status: "pass" }]
    })).toMatchObject({
      status: "fail",
      detail: "missing_execution_payload",
      extensionProbeParity: true,
      probeParitySource: "browser.extension.x.search"
    });

    expect(resolveMatrixSocialSearchStatus({
      platform: "threads",
      strictGate: true,
      resultStatus: 0,
      resultDetail: null,
      execution: {
        records: [],
        failures: [],
        hasExecutionPayload: true
      },
      reportSteps: [{ id: "browser.managed.threads.search", status: "pass" }]
    })).toMatchObject({
      status: "fail",
      detail: "no_records_no_failures",
      extensionProbeParity: true,
      probeParitySource: "browser.managed.threads.search"
    });

    expect(resolveMatrixSocialSearchStatus({
      platform: "facebook",
      strictGate: true,
      resultStatus: 1,
      resultDetail: "Authentication required before continuing.",
      execution: {
        records: [],
        failures: [],
        hasExecutionPayload: false
      },
      reportSteps: []
    })).toMatchObject({
      status: "fail",
      detail: "Authentication required before continuing."
    });
  });

  it("keeps expected tiktok timeout gate diagnostic only", () => {
    expect(resolveMatrixSocialSearchStatus({
      platform: "tiktok",
      strictGate: true,
      resultStatus: 0,
      resultDetail: null,
      execution: {
        records: [],
        failures: [{
          error: {
            code: "timeout",
            message: "Provider request timed out after 120000ms"
          }
        }],
        hasExecutionPayload: true
      },
      reportSteps: []
    })).toMatchObject({
      status: "fail",
      detail: "unexpected_reason_codes=timeout",
      expectedTiktokTimeoutGate: false
    });
  });

  it("keeps social post expected gates diagnostic instead of pass-promoting", () => {
    expect(resolveMatrixSocialPostStatus({
      strictGate: true,
      resultStatus: 0,
      resultDetail: null,
      verdict: {
        status: "env_limited",
        reason: "expected_gating_post_transport_not_configured"
      },
      reasonCodes: ["unavailable"]
    })).toEqual({
      status: "env_limited",
      detail: "expected_gating_post_transport_not_configured",
      expectedGateVerified: true,
      expectedTransportGateVerified: true,
      expectedPolicyGateVerified: false
    });

    expect(resolveMatrixSocialPostStatus({
      strictGate: true,
      resultStatus: 1,
      resultDetail: "Challenge detected before posting.",
      verdict: {
        status: "env_limited",
        reason: "reason_codes=challenge_detected"
      },
      reasonCodes: ["challenge_detected"]
    })).toMatchObject({
      status: "fail",
      detail: "Challenge detected before posting.",
      expectedGateVerified: true,
      expectedPolicyGateVerified: true
    });
  });

  it("builds live shopping probes with helper challenge automation and cookies", () => {
    expect(buildLiveShoppingRunArgs("shopping/target", "120000")).toEqual([
      "shopping",
      "run",
      "--query",
      "ergonomic wireless mouse",
      "--providers",
      "shopping/target",
      "--sort",
      "best_deal",
      "--mode",
      "json",
      "--timeout-ms",
      "120000",
      "--challenge-automation-mode",
      "browser_with_helper",
      "--use-cookies"
    ]);
  });

  it("fails nested live-regression crashes when no structured counts were produced", () => {
    expect(classifyNestedLiveRegressionStatus(1, null)).toBe("fail");
    expect(classifyNestedLiveRegressionStatus(1, { counts: {} })).toBe("fail");
  });

  it("emits a single failed nested live-regression step when daemon restore fails", async () => {
    const nodeRunner = vi.fn(() => ({
      status: 0,
      stdout: "",
      stderr: "",
      json: { counts: { env_limited: 1 } }
    }));
    const daemonRestorer = vi.fn(async () => {
      throw new Error("daemon restore failed");
    });

    const result = await runNestedLiveRegressionMode(
      { OPENCODE_CONFIG_DIR: "/tmp/provider-live" },
      { strictGate: false, useGlobalEnv: true },
      { nodeRunner, daemonRestorer }
    );

    expect(result).toEqual({
      restarted: false,
      step: {
        id: "matrix.live_regression_modes",
        status: "fail",
        data: { counts: { env_limited: 1 } },
        detail: "Error: daemon restore failed"
      }
    });
  });

  it("preserves the classified nested live-regression step when daemon restore succeeds", async () => {
    const nodeRunner = vi.fn(() => ({
      status: 1,
      stdout: "",
      stderr: "ops unavailable",
      json: { counts: { env_limited: 1 } }
    }));
    const daemonRestorer = vi.fn(async () => ({ restarted: true }));

    const result = await runNestedLiveRegressionMode(
      { OPENCODE_CONFIG_DIR: "/tmp/provider-live" },
      { strictGate: false, useGlobalEnv: false },
      { nodeRunner, daemonRestorer }
    );

    expect(result).toEqual({
      restarted: true,
      step: {
        id: "matrix.live_regression_modes",
        status: "env_limited",
        data: { counts: { env_limited: 1 } },
        detail: "ops unavailable"
      }
    });
  });

  it("prefers structured product-video amazon constraints before free-form detail fallback", () => {
    expect(classifyProductVideoAmazonStatus(1, "", {
      meta: {
        primaryConstraintSummary: "Amazon requires manual browser follow-up; this run did not determine a reliable PDP price.",
        reasonCodeDistribution: {
          unavailable: 1
        }
      }
    })).toBe("env_limited");
  });

  it("fails successful workflow probes when required artifact evidence is missing", () => {
    const missingArtifact = validateSuccessfulWorkflowArtifact({}, "research");

    expect(missingArtifact).toEqual({
      artifactPath: null,
      detail: "successful_research_workflow_missing_artifact_path"
    });
    expect(classifySuccessfulResearchWorkflow(0, { artifactPath: "/tmp/run", detail: null })).toEqual({
      status: "fail",
      detail: "successful_research_workflow_returned_no_records"
    });
    expect(classifySuccessfulResearchWorkflow(1, missingArtifact)).toEqual({
      status: "fail",
      detail: "successful_research_workflow_missing_artifact_path"
    });
  });

  it("validates successful workflow artifact namespace and required files", () => {
    const root = mkdtempSync(join(tmpdir(), "odb-live-artifact-"));
    try {
      const researchRun = join(root, "research", "run-1");
      const researchDirectoryReportRun = join(root, "research", "run-2");
      const shoppingRun = join(root, "shopping", "run-1");
      const productVideoRun = join(root, "product-video", "run-1");
      const productVideoDirectoryManifestRun = join(root, "product-video", "run-2");
      mkdirSync(researchRun, { recursive: true });
      mkdirSync(researchDirectoryReportRun, { recursive: true });
      mkdirSync(shoppingRun, { recursive: true });
      mkdirSync(productVideoRun, { recursive: true });
      mkdirSync(productVideoDirectoryManifestRun, { recursive: true });
      writeFileSync(join(researchRun, "bundle-manifest.json"), "{}\n");
      writeFileSync(join(researchDirectoryReportRun, "bundle-manifest.json"), "{}\n");
      mkdirSync(join(researchDirectoryReportRun, "report.md"));
      writeFileSync(join(shoppingRun, "bundle-manifest.json"), "{}\n");
      writeFileSync(join(productVideoRun, "bundle-manifest.json"), "{}\n");
      mkdirSync(join(productVideoDirectoryManifestRun, "bundle-manifest.json"));

      expect(validateSuccessfulWorkflowArtifact({ artifact_path: researchRun }, "research")).toEqual({
        artifactPath: researchRun,
        detail: "successful_research_workflow_report_missing"
      });
      expect(validateSuccessfulWorkflowArtifact(
        { artifact_path: researchDirectoryReportRun },
        "research"
      )).toEqual({
        artifactPath: researchDirectoryReportRun,
        detail: "successful_research_workflow_report_missing"
      });
      writeFileSync(join(researchRun, "report.md"), "# Report\n");
      expect(validateSuccessfulWorkflowArtifact({ artifact_path: researchRun }, "research")).toEqual({
        artifactPath: researchRun,
        detail: null
      });
      expect(validateSuccessfulWorkflowArtifact({ artifact_path: productVideoRun }, "product-video")).toEqual({
        artifactPath: productVideoRun,
        detail: null
      });
      expect(validateSuccessfulWorkflowArtifact(
        { artifact_path: productVideoDirectoryManifestRun },
        "product-video"
      )).toEqual({
        artifactPath: productVideoDirectoryManifestRun,
        detail: "successful_product-video_workflow_bundle_manifest_missing"
      });
      expect(validateSuccessfulWorkflowArtifact({ artifact_path: shoppingRun }, "product-video")).toEqual({
        artifactPath: shoppingRun,
        detail: "successful_product-video_workflow_artifact_namespace_mismatch"
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("adopts social fallback retries that return records or failures", () => {
    const currentResult = { status: 0, detail: null, json: { data: { execution: { records: [], failures: [] } } } };
    const currentExecution = {
      records: [],
      failures: [],
      providerOrder: ["social/x"],
      meta: null,
      raw: null,
      hasExecutionPayload: true
    };
    const retryResult = {
      status: 0,
      detail: "retry ok",
      json: {
        data: {
          execution: {
            records: [{ id: "x-status", url: "https://x.com/opendevbrowser/status/1" }],
            failures: [],
            meta: { providerOrder: ["social/x"] }
          }
        }
      }
    };

    expect(resolveSocialFallbackRetry(currentResult, currentExecution, retryResult)).toMatchObject({
      result: retryResult,
      execution: {
        records: retryResult.json.data.execution.records,
        failures: [],
        providerOrder: ["social/x"],
        hasExecutionPayload: true
      },
      usedFallbackQuery: true,
      fallbackQueryStatus: 0
    });
  });

  it("keeps current social result when fallback retry has no executable signal", () => {
    const currentResult = { status: 0, detail: null, json: { data: { execution: { records: [], failures: [] } } } };
    const currentExecution = {
      records: [],
      failures: [],
      providerOrder: ["social/x"],
      meta: null,
      raw: null,
      hasExecutionPayload: true
    };
    const retryResult = { status: 0, detail: null, json: { data: { execution: { records: [], failures: [] } } } };

    expect(resolveSocialFallbackRetry(currentResult, currentExecution, retryResult)).toEqual({
      result: currentResult,
      execution: currentExecution,
      usedFallbackQuery: false,
      fallbackQueryStatus: 0
    });
  });
});
