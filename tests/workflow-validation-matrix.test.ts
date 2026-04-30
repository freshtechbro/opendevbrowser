import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  classifyLaneRecords,
  runCli,
  runNode,
  ensureCliBuilt,
  normalizedCodesFromFailures,
  parseShellOnlyFailureDetail,
  sleep,
  withConfiguredDaemon
} = vi.hoisted(() => ({
  classifyLaneRecords: vi.fn(() => ({ status: "fail", detail: null })),
  runCli: vi.fn(),
  runNode: vi.fn(),
  ensureCliBuilt: vi.fn(),
  normalizedCodesFromFailures: vi.fn(() => []),
  parseShellOnlyFailureDetail: vi.fn(() => null),
  sleep: vi.fn(async () => {}),
  withConfiguredDaemon: vi.fn()
}));

vi.mock("../scripts/live-direct-utils.mjs", () => ({
  countStatuses: (steps: Array<{ status?: string }>) => {
    const counts = {
      pass: 0,
      expected_timeout: 0,
      env_limited: 0,
      fail: 0,
      skipped: 0
    };
    for (const step of steps) {
      const status = step.status;
      if (status && status in counts) {
        counts[status as keyof typeof counts] += 1;
      }
    }
    return counts;
  },
  ensureCliBuilt,
  runCli,
  runNode,
  sleep
}));

vi.mock("../scripts/skill-runtime-probe-utils.mjs", () => ({
  currentHarnessDaemonStatusDetail: (status: { status?: number; detail?: string; json?: { data?: { fingerprintCurrent?: boolean } } }) => {
    if (status?.status === 0 && status.json?.data?.fingerprintCurrent !== false) {
      return null;
    }
    if (status?.status === 0 && status.json?.data?.fingerprintCurrent === false) {
      return "daemon_fingerprint_mismatch";
    }
    return status?.detail ?? "daemon_status_unavailable";
  },
  isCurrentHarnessDaemonStatus: (status: { status?: number; json?: { success?: boolean; data?: { fingerprintCurrent?: boolean } } }) => (
    status?.status === 0
    && status.json?.success === true
    && status.json?.data?.fingerprintCurrent !== false
  ),
  withConfiguredDaemon
}));

vi.mock("../scripts/shared/workflow-lane-constants.mjs", () => ({
  MATRIX_ENV_LIMITED_CODES: []
}));

vi.mock("../scripts/shared/workflow-lane-verdicts.mjs", () => ({
  classifyLaneRecords,
  normalizedCodesFromFailures,
  parseShellOnlyFailureDetail
}));

vi.mock("../scripts/shared/workflow-inventory.mjs", () => ({
  VALIDATION_SCENARIOS: [
    {
      id: "feature.annotate.relay",
      label: "Annotation relay probe",
      entryPath: "node scripts/annotate-live-probe.mjs --transport relay",
      executionPolicy: "automated",
      runner: "node",
      primaryArgs: ["scripts/annotate-live-probe.mjs", "--transport", "relay"],
      secondaryArgs: ["scripts/annotate-live-probe.mjs", "--transport", "relay", "--secondary"],
      primaryTask: "Run the relay annotation probe.",
      secondaryTask: "Run the relay annotation probe with a second task.",
      allowedStatuses: ["pass", "env_limited", "expected_timeout"],
      ownerFiles: ["scripts/annotate-live-probe.mjs"],
      timeoutMs: 60_000,
      requiresExtension: true
    },
    {
      id: "feature.cli.smoke",
      label: "CLI smoke command matrix",
      entryPath: "node scripts/cli-smoke-test.mjs",
      executionPolicy: "automated",
      runner: "node",
      isolatedDaemonHarness: true,
      primaryArgs: ["scripts/cli-smoke-test.mjs"],
      secondaryArgs: ["scripts/cli-smoke-test.mjs", "--secondary"],
      primaryTask: "Run the smoke matrix.",
      secondaryTask: "Run the smoke matrix again.",
      allowedStatuses: ["pass"],
      ownerFiles: ["scripts/cli-smoke-test.mjs"],
      timeoutMs: 60_000,
      requiresExtension: false
    }
  ]
}));

import {
  determineScenarioStatus,
  resolveScenarioProcessTimeoutMs,
  runWorkflowValidationMatrix
} from "../scripts/workflow-validation-matrix.mjs";

describe("workflow validation matrix daemon ownership", () => {
  const envToken = { OPDEVBROWSER_TEST: "1" };
  const reusedRelayStatus = {
    status: 0,
    json: {
      success: true,
      data: {
        relay: {
          extensionHandshakeComplete: true,
          opsConnected: true,
          canvasConnected: false,
          annotationConnected: false,
          cdpConnected: false
        }
      }
    }
  };
  let currentRelayStatus = reusedRelayStatus;

  beforeEach(() => {
    ensureCliBuilt.mockReset();
    runCli.mockReset();
    runNode.mockReset();
    classifyLaneRecords.mockReset();
    normalizedCodesFromFailures.mockReset();
    parseShellOnlyFailureDetail.mockReset();
    sleep.mockReset();
    withConfiguredDaemon.mockReset();
    classifyLaneRecords.mockReturnValue({ status: "fail", detail: null });
    normalizedCodesFromFailures.mockReturnValue([]);
    parseShellOnlyFailureDetail.mockReturnValue(null);
    currentRelayStatus = reusedRelayStatus;
    withConfiguredDaemon.mockImplementation(async (task: (context: { env: typeof envToken; daemon: null; startedDaemon: false }) => Promise<unknown>) => (
      task({ env: envToken, daemon: null, startedDaemon: false })
    ));
    runCli.mockImplementation((args: string[], options: { env: typeof envToken }) => {
      expect(options.env).toBe(envToken);
      if (args[0] === "status") {
        return currentRelayStatus;
      }
      throw new Error(`Unexpected CLI call: ${args.join(" ")}`);
    });
  });

  it("executes extension-required scenarios when reusing a healthy relay with only opsConnected", async () => {
    runNode.mockImplementation((args: string[], options: { env: typeof envToken }) => {
      expect(args).toEqual(["scripts/annotate-live-probe.mjs", "--transport", "relay"]);
      expect(options.env).toBe(envToken);
      return {
        status: 0,
        timedOut: false,
        json: { success: true }
      };
    });

    const report = await runWorkflowValidationMatrix({
      variant: "primary",
      scenarioIds: ["feature.annotate.relay"]
    });

    expect(withConfiguredDaemon).toHaveBeenCalledTimes(1);
    expect(report.infraSteps[0]).toMatchObject({
      id: "infra.daemon.recycle",
      status: "pass",
      detail: "reused configured daemon",
      data: {
        mode: "reused",
        relayWasDirty: false,
        startedDaemon: false
      }
    });
    expect(report.steps[0]).toMatchObject({
      id: "feature.annotate.relay",
      status: "pass",
      ok: true
    });
    expect(runNode).toHaveBeenCalledTimes(1);
  });

  it("marks extension-required scenarios env_limited when reusing a relay with active non-default clients", async () => {
    currentRelayStatus = {
      status: 0,
      json: {
        success: true,
        data: {
          relay: {
            extensionHandshakeComplete: true,
            opsConnected: true,
            canvasConnected: false,
            annotationConnected: true,
            cdpConnected: false
          }
        }
      }
    };

    const report = await runWorkflowValidationMatrix({
      variant: "primary",
      scenarioIds: ["feature.annotate.relay"]
    });

    expect(withConfiguredDaemon).toHaveBeenCalledTimes(1);
    expect(report.infraSteps[0]).toMatchObject({
      id: "infra.daemon.recycle",
      status: "pass",
      detail: "reused configured daemon; dirty relay gates extension scenarios",
      data: {
        mode: "reused",
        relayWasDirty: true,
        startedDaemon: false
      }
    });
    expect(report.steps[0]).toMatchObject({
      id: "feature.annotate.relay",
      status: "env_limited",
      detail: "relay_busy_existing_clients",
      ok: true
    });
    expect(runNode).not.toHaveBeenCalled();
  });

  it("fails infra before scenario execution when the configured daemon fingerprint is stale", async () => {
    currentRelayStatus = {
      status: 0,
      json: {
        success: true,
        data: {
          fingerprintCurrent: false,
          relay: {
            extensionHandshakeComplete: true,
            opsConnected: true,
            canvasConnected: false,
            annotationConnected: false,
            cdpConnected: false
          }
        }
      }
    };

    const report = await runWorkflowValidationMatrix({
      variant: "primary",
      scenarioIds: ["feature.annotate.relay"]
    });

    expect(report.infraSteps).toEqual([
      expect.objectContaining({
        id: "infra.daemon.recycle",
        status: "fail",
        detail: "daemon_fingerprint_mismatch"
      }),
      expect.objectContaining({
        id: "infra.daemon_status",
        status: "fail",
        detail: "daemon_fingerprint_mismatch"
      })
    ]);
    expect(report.steps).toEqual([]);
    expect(runNode).not.toHaveBeenCalled();
  });

  it("executes daemon-owning scenarios outside the shared configured-daemon helper", async () => {
    runNode.mockImplementation((args: string[], options: { env: NodeJS.ProcessEnv }) => {
      expect(args).toEqual(["scripts/cli-smoke-test.mjs"]);
      expect(options.env).toBe(process.env);
      return {
        status: 0,
        timedOut: false,
        json: { success: true }
      };
    });

    const report = await runWorkflowValidationMatrix({
      variant: "primary",
      scenarioIds: ["feature.cli.smoke"]
    });

    expect(withConfiguredDaemon).not.toHaveBeenCalled();
    expect(runNode).toHaveBeenCalledTimes(1);
    expect(report.steps[0]).toMatchObject({
      id: "feature.cli.smoke",
      status: "pass",
      ok: true
    });
  });

  it("keeps daemon-owning scenarios isolated from shared-daemon workflow scenarios", async () => {
    runNode.mockImplementation((args: string[], options: { env: NodeJS.ProcessEnv }) => {
      if (args[0] === "scripts/cli-smoke-test.mjs") {
        expect(options.env).toBe(process.env);
        return {
          status: 0,
          timedOut: false,
          json: { success: true }
        };
      }
      expect(args).toEqual(["scripts/annotate-live-probe.mjs", "--transport", "relay"]);
      expect(options.env).toBe(envToken);
      return {
        status: 0,
        timedOut: false,
        json: { success: true }
      };
    });

    const report = await runWorkflowValidationMatrix({
      variant: "primary",
      scenarioIds: ["feature.cli.smoke", "feature.annotate.relay"]
    });

    expect(withConfiguredDaemon).toHaveBeenCalledTimes(1);
    expect(runNode).toHaveBeenCalledTimes(2);
    expect(report.steps).toMatchObject([
      { id: "feature.annotate.relay", status: "pass", ok: true },
      { id: "feature.cli.smoke", status: "pass", ok: true }
    ]);
  });

  it("adds CLI timeout headroom beyond the inner workflow budget", () => {
    expect(resolveScenarioProcessTimeoutMs({
      runner: "cli",
      timeoutMs: 120_000
    })).toBe(135_000);
    expect(resolveScenarioProcessTimeoutMs({
      runner: "node",
      timeoutMs: 120_000
    })).toBe(120_000);
  });

  it("preserves structured next-step guidance on reason-code classified rows", () => {
    normalizedCodesFromFailures.mockReturnValue(["env_limited"]);
    classifyLaneRecords.mockReturnValue({
      status: "env_limited",
      detail: "reason_codes=env_limited"
    });

    const outcome = determineScenarioStatus({
      status: 0,
      timedOut: false,
      detail: null,
      json: {
        data: {
          suggestedNextAction: "Retry with browser assistance or a headed browser session.",
          meta: {
            failures: [
              {
                error: {
                  reasonCode: "env_limited"
                }
              }
            ]
          }
        }
      }
    }, {
      allowedStatuses: ["env_limited"]
    });

    expect(outcome).toEqual({
      status: "env_limited",
      ok: true,
      detail: "reason_codes=env_limited Next step: Retry with browser assistance or a headed browser session."
    });
  });
});
