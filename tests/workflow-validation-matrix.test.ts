import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  classifyLaneRecords,
  runCli,
  runNode,
  ensureCliBuilt,
  normalizedCodesFromFailures,
  parseShellOnlyFailureDetail,
  sleep,
  startConfiguredDaemon,
  stopDaemon,
  withConfiguredDaemon
} = vi.hoisted(() => ({
  classifyLaneRecords: vi.fn(() => ({ status: "fail", detail: null })),
  runCli: vi.fn(),
  runNode: vi.fn(),
  ensureCliBuilt: vi.fn(),
  normalizedCodesFromFailures: vi.fn(() => []),
  parseShellOnlyFailureDetail: vi.fn(() => null),
  sleep: vi.fn(async () => {}),
  startConfiguredDaemon: vi.fn(async () => ({ pid: 1234 })),
  stopDaemon: vi.fn(async () => {}),
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
  startConfiguredDaemon,
  stopDaemon,
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
    },
    {
      id: "feature.canvas.extension",
      label: "Canvas extension surface",
      entryPath: "node scripts/canvas-live-workflow.mjs --surface extension",
      executionPolicy: "automated",
      runner: "node",
      primaryArgs: ["scripts/canvas-live-workflow.mjs", "--surface", "extension"],
      secondaryArgs: ["scripts/canvas-live-workflow.mjs", "--surface", "extension"],
      primaryTask: "Run the extension canvas workflow.",
      secondaryTask: "Run the extension canvas workflow again.",
      allowedStatuses: ["pass", "env_limited"],
      ownerFiles: ["scripts/canvas-live-workflow.mjs"],
      timeoutMs: 60_000,
      requiresExtension: true
    }
  ]
}));

import {
  classifyScenarioPreflight,
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
          opsOwnedTargetCount: 0,
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
    startConfiguredDaemon.mockReset();
    stopDaemon.mockReset();
    withConfiguredDaemon.mockReset();
    startConfiguredDaemon.mockResolvedValue({ pid: 1234 });
    stopDaemon.mockResolvedValue(undefined);
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

  it("does not classify an active ops client as dirty during ownership recycle", async () => {
    runCli.mockImplementation((args: string[], options: { env: typeof envToken }) => {
      expect(options.env).toBe(envToken);
      if (args[0] === "status") {
        return currentRelayStatus;
      }
      if (args[0] === "serve" && args[1] === "--stop") {
        currentRelayStatus = {
          status: 0,
          json: {
            success: true,
            data: {
              relay: {
                extensionHandshakeComplete: true,
                opsConnected: false,
                opsOwnedTargetCount: 0,
                canvasConnected: false,
                annotationConnected: false,
                cdpConnected: false
              }
            }
          }
        };
        return { status: 0, json: { success: true } };
      }
      throw new Error(`Unexpected CLI call: ${args.join(" ")}`);
    });
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
      detail: "recycled configured daemon to own matrix lifecycle",
      data: {
        mode: "owned_recycled",
        relayWasDirty: false,
        previousRelayWasDirty: false,
        recycledForOwnership: true,
        startedDaemon: true
      }
    });
    expect(report.steps[0]).toMatchObject({
      id: "feature.annotate.relay",
      status: "pass",
      ok: true
    });
    expect(startConfiguredDaemon).toHaveBeenCalledTimes(1);
    expect(stopDaemon).toHaveBeenCalledTimes(1);
    expect(runNode).toHaveBeenCalledTimes(1);
  });

  it("recycles a reused relay with active non-default clients before extension-required scenarios", async () => {
    const dirtyRelayStatus = {
      status: 0,
      json: {
        success: true,
        data: {
          relay: {
            extensionHandshakeComplete: true,
            opsConnected: true,
            opsOwnedTargetCount: 0,
            canvasConnected: false,
            annotationConnected: true,
            cdpConnected: false
          }
        }
      }
    };
    currentRelayStatus = {
      status: 0,
      json: {
        success: true,
        data: {
            relay: {
              extensionHandshakeComplete: true,
              opsConnected: false,
              opsOwnedTargetCount: 0,
              canvasConnected: false,
              annotationConnected: false,
              cdpConnected: false
          }
        }
      }
    };
    let statusCalls = 0;
    runCli.mockImplementation((args: string[], options: { env: typeof envToken }) => {
      expect(options.env).toBe(envToken);
      if (args[0] === "status") {
        statusCalls += 1;
        return statusCalls === 1 ? dirtyRelayStatus : currentRelayStatus;
      }
      if (args[0] === "serve" && args[1] === "--stop") {
        return { status: 0, json: { success: true } };
      }
      throw new Error(`Unexpected CLI call: ${args.join(" ")}`);
    });
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
      detail: "recycled configured daemon to own matrix lifecycle and clear dirty relay clients",
      data: {
        mode: "owned_recycled",
        relayWasDirty: false,
        previousRelayWasDirty: true,
        recycledForOwnership: true,
        recycledDirtyRelay: true,
        startedDaemon: true
      }
    });
    expect(report.steps[0]).toMatchObject({
      id: "feature.annotate.relay",
      status: "pass",
      ok: true
    });
    expect(startConfiguredDaemon).toHaveBeenCalledTimes(1);
    expect(stopDaemon).toHaveBeenCalledTimes(1);
    expect(runNode).toHaveBeenCalledTimes(1);
  });

  it("recycles a reused relay when ops ownership count is unknown", async () => {
    currentRelayStatus = {
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
    let statusCalls = 0;
    runCli.mockImplementation((args: string[], options: { env: typeof envToken }) => {
      expect(options.env).toBe(envToken);
      if (args[0] === "status") {
        statusCalls += 1;
        if (statusCalls === 1) {
          return currentRelayStatus;
        }
        return {
          status: 0,
          json: {
            success: true,
            data: {
              relay: {
                extensionHandshakeComplete: true,
                opsConnected: false,
                opsOwnedTargetCount: 0,
                canvasConnected: false,
                annotationConnected: false,
                cdpConnected: false
              }
            }
          }
        };
      }
      if (args[0] === "serve" && args[1] === "--stop") {
        return { status: 0, json: { success: true } };
      }
      throw new Error(`Unexpected CLI call: ${args.join(" ")}`);
    });
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

    expect(report.infraSteps[0]).toMatchObject({
      id: "infra.daemon.recycle",
      status: "pass",
      data: {
        previousRelayWasDirty: true,
        recycledDirtyRelay: true,
        startedDaemon: true
      }
    });
    expect(stopDaemon).toHaveBeenCalledTimes(1);
    expect(startConfiguredDaemon).toHaveBeenCalledTimes(1);
  });

  it("recycles a reused relay when ops ownership count is malformed even without an active ops client", async () => {
    currentRelayStatus = {
      status: 0,
      json: {
        success: true,
        data: {
          relay: {
            extensionHandshakeComplete: true,
            opsConnected: false,
            opsOwnedTargetCount: "0",
            canvasConnected: false,
            annotationConnected: false,
            cdpConnected: false
          }
        }
      }
    };
    let statusCalls = 0;
    runCli.mockImplementation((args: string[], options: { env: typeof envToken }) => {
      expect(options.env).toBe(envToken);
      if (args[0] === "status") {
        statusCalls += 1;
        if (statusCalls === 1) {
          return currentRelayStatus;
        }
        return {
          status: 0,
          json: {
            success: true,
            data: {
              relay: {
                extensionHandshakeComplete: true,
                opsConnected: false,
                opsOwnedTargetCount: 0,
                canvasConnected: false,
                annotationConnected: false,
                cdpConnected: false
              }
            }
          }
        };
      }
      if (args[0] === "serve" && args[1] === "--stop") {
        return { status: 0, json: { success: true } };
      }
      throw new Error(`Unexpected CLI call: ${args.join(" ")}`);
    });
    runNode.mockReturnValue({
      status: 0,
      timedOut: false,
      json: { success: true }
    });

    const report = await runWorkflowValidationMatrix({
      variant: "primary",
      scenarioIds: ["feature.annotate.relay"]
    });

    expect(report.infraSteps[0]).toMatchObject({
      id: "infra.daemon.recycle",
      status: "pass",
      data: {
        previousRelayWasDirty: true,
        recycledDirtyRelay: true,
        startedDaemon: true
      }
    });
    expect(stopDaemon).toHaveBeenCalledTimes(1);
    expect(startConfiguredDaemon).toHaveBeenCalledTimes(1);
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
            opsOwnedTargetCount: 0,
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

  it("classifies extension loss after dirty relay recycle as a harness failure when the extension was previously ready", () => {
    expect(classifyScenarioPreflight({
      scenario: {
        requiresExtension: true
      },
      startedDaemon: true,
      relayWasDirty: false,
      recycledDirtyRelay: true,
      initialDaemonOk: true,
      initialExtensionReady: true,
      currentDaemonStatus: {
        status: 0,
        json: {
          success: true,
          data: {
            relay: {
              extensionConnected: false,
              extensionHandshakeComplete: false
            }
          }
        }
      }
    })).toEqual({
      status: "fail",
      detail: "extension_disconnected_after_recycle",
      data: {
        relay: {
          extensionConnected: false,
          extensionHandshakeComplete: false
        }
      }
    });
  });

  it("recycles a clean reused configured daemon so the matrix owns daemon lifetime", async () => {
    currentRelayStatus = {
      status: 0,
      json: {
        success: true,
        data: {
          relay: {
            extensionHandshakeComplete: true,
            opsConnected: false,
            opsOwnedTargetCount: 0,
            canvasConnected: false,
            annotationConnected: false,
            cdpConnected: false
          }
        }
      }
    };
    runCli.mockImplementation((args: string[], options: { env: typeof envToken }) => {
      expect(options.env).toBe(envToken);
      if (args[0] === "status") {
        return currentRelayStatus;
      }
      if (args[0] === "serve" && args[1] === "--stop") {
        return { status: 0, json: { success: true } };
      }
      throw new Error(`Unexpected CLI call: ${args.join(" ")}`);
    });
    runNode.mockReturnValue({
      status: 0,
      timedOut: false,
      json: { success: true }
    });

    const report = await runWorkflowValidationMatrix({
      variant: "primary",
      scenarioIds: ["feature.annotate.relay"]
    });

    expect(startConfiguredDaemon).toHaveBeenCalledTimes(1);
    expect(stopDaemon).toHaveBeenCalledTimes(1);
    expect(report.infraSteps[0]).toMatchObject({
      id: "infra.daemon.recycle",
      status: "pass",
      detail: "recycled configured daemon to own matrix lifecycle",
      data: {
        mode: "owned_recycled",
        previousRelayWasDirty: false,
        recycledForOwnership: true,
        recycledDirtyRelay: false,
        startedDaemon: true
      }
    });
    expect(report.steps[0]).toMatchObject({
      id: "feature.annotate.relay",
      status: "pass",
      ok: true
    });
  });

  it("fails infra before scenario execution when configured daemon stop fails", async () => {
    currentRelayStatus = {
      status: 0,
      json: {
        success: true,
        data: {
          relay: {
            extensionHandshakeComplete: true,
            opsConnected: false,
            opsOwnedTargetCount: 0,
            canvasConnected: false,
            annotationConnected: false,
            cdpConnected: false
          }
        }
      }
    };
    runCli.mockImplementation((args: string[], options: { env: typeof envToken }) => {
      expect(options.env).toBe(envToken);
      if (args[0] === "status") {
        return currentRelayStatus;
      }
      if (args[0] === "serve" && args[1] === "--stop") {
        return { status: 2, detail: "stale daemon rejected stop" };
      }
      throw new Error(`Unexpected CLI call: ${args.join(" ")}`);
    });

    const report = await runWorkflowValidationMatrix({
      variant: "primary",
      scenarioIds: ["feature.annotate.relay"]
    });

    expect(report.infraSteps).toEqual([
      expect.objectContaining({
        id: "infra.daemon.recycle",
        status: "fail",
        detail: "configured_daemon_stop_failed: stale daemon rejected stop"
      })
    ]);
    expect(report.steps).toEqual([]);
    expect(startConfiguredDaemon).not.toHaveBeenCalled();
    expect(runNode).not.toHaveBeenCalled();
  });

  it("fails infra when configured daemon stop omits success JSON", async () => {
    currentRelayStatus = {
      status: 0,
      json: {
        success: true,
        data: {
          relay: {
            extensionHandshakeComplete: true,
            opsConnected: false,
            opsOwnedTargetCount: 0,
            canvasConnected: false,
            annotationConnected: false,
            cdpConnected: false
          }
        }
      }
    };
    runCli.mockImplementation((args: string[], options: { env: typeof envToken }) => {
      expect(options.env).toBe(envToken);
      if (args[0] === "status") {
        return currentRelayStatus;
      }
      if (args[0] === "serve" && args[1] === "--stop") {
        return { status: 0, detail: "unparseable stop output" };
      }
      throw new Error(`Unexpected CLI call: ${args.join(" ")}`);
    });

    const report = await runWorkflowValidationMatrix({
      variant: "primary",
      scenarioIds: ["feature.annotate.relay"]
    });

    expect(report.infraSteps).toEqual([
      expect.objectContaining({
        id: "infra.daemon.recycle",
        status: "fail",
        detail: "configured_daemon_stop_failed: unparseable stop output"
      })
    ]);
    expect(report.steps).toEqual([]);
    expect(startConfiguredDaemon).not.toHaveBeenCalled();
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
    currentRelayStatus = {
      status: 0,
      json: {
        success: true,
        data: {
          relay: {
            extensionHandshakeComplete: true,
            opsConnected: false,
            opsOwnedTargetCount: 0,
            canvasConnected: false,
            annotationConnected: false,
            cdpConnected: false
          }
        }
      }
    };
    runCli.mockImplementation((args: string[], options: { env: typeof envToken }) => {
      expect(options.env).toBe(envToken);
      if (args[0] === "status") {
        return currentRelayStatus;
      }
      if (args[0] === "serve" && args[1] === "--stop") {
        return { status: 0, json: { success: true } };
      }
      throw new Error(`Unexpected CLI call: ${args.join(" ")}`);
    });
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
    expect(startConfiguredDaemon).toHaveBeenCalledTimes(1);
    expect(stopDaemon).toHaveBeenCalledTimes(1);
    expect(runNode).toHaveBeenCalledTimes(2);
    expect(report.steps).toMatchObject([
      { id: "feature.annotate.relay", status: "pass", ok: true },
      { id: "feature.cli.smoke", status: "pass", ok: true }
    ]);
  });

  it("keeps the shared daemon between extension-required scenarios when only ops remains connected", async () => {
    currentRelayStatus = {
      status: 0,
      json: {
        success: true,
        data: {
          relay: {
            extensionHandshakeComplete: true,
            opsConnected: false,
            canvasConnected: false,
            annotationConnected: false,
            cdpConnected: false
          }
        }
      }
    };
    runCli.mockImplementation((args: string[], options: { env: typeof envToken }) => {
      expect(options.env).toBe(envToken);
      if (args[0] === "status") {
        return currentRelayStatus;
      }
      if (args[0] === "serve" && args[1] === "--stop") {
        currentRelayStatus = {
          status: 0,
          json: {
            success: true,
            data: {
              relay: {
                extensionHandshakeComplete: true,
                opsConnected: false,
                opsOwnedTargetCount: 0,
                canvasConnected: false,
                annotationConnected: false,
                cdpConnected: false
              }
            }
          }
        };
        return { status: 0, json: { success: true } };
      }
      throw new Error(`Unexpected CLI call: ${args.join(" ")}`);
    });
    runNode.mockImplementation((args: string[], options: { env: typeof envToken }) => {
      expect(options.env).toBe(envToken);
      if (args[0] === "scripts/annotate-live-probe.mjs") {
        currentRelayStatus = {
          status: 0,
          json: {
            success: true,
            data: {
              relay: {
                extensionHandshakeComplete: true,
                opsConnected: true,
                opsOwnedTargetCount: 0,
                canvasConnected: false,
                annotationConnected: false,
                cdpConnected: false
              }
            }
          }
        };
      }
      return {
        status: 0,
        timedOut: false,
        json: { success: true }
      };
    });

    const report = await runWorkflowValidationMatrix({
      variant: "primary",
      scenarioIds: ["feature.annotate.relay", "feature.canvas.extension"]
    });

    expect(startConfiguredDaemon).toHaveBeenCalledTimes(1);
    expect(stopDaemon).toHaveBeenCalledTimes(1);
    expect(report.infraSteps).not.toContainEqual(expect.objectContaining({
      id: "infra.daemon.recycle.feature.canvas.extension",
    }));
    expect(report.steps).toMatchObject([
      { id: "feature.annotate.relay", status: "pass", ok: true },
      { id: "feature.canvas.extension", status: "pass", ok: true }
    ]);
  });

  it("waits for extension reconnection after starting a configured daemon", async () => {
    let statusCalls = 0;
    withConfiguredDaemon.mockImplementation(async (task: (context: { env: typeof envToken; daemon: { pid: number }; startedDaemon: true }) => Promise<unknown>) => (
      task({ env: envToken, daemon: { pid: 1234 }, startedDaemon: true })
    ));
    runCli.mockImplementation((args: string[], options: { env: typeof envToken }) => {
      expect(options.env).toBe(envToken);
      if (args[0] === "status") {
        statusCalls += 1;
        return {
          status: 0,
          json: {
            success: true,
            data: {
              relay: {
                extensionHandshakeComplete: statusCalls >= 4,
                opsConnected: false,
                opsOwnedTargetCount: 0,
                canvasConnected: false,
                annotationConnected: false,
                cdpConnected: false
              }
            }
          }
        };
      }
      throw new Error(`Unexpected CLI call: ${args.join(" ")}`);
    });
    runNode.mockReturnValue({
      status: 0,
      timedOut: false,
      json: { success: true }
    });

    const report = await runWorkflowValidationMatrix({
      variant: "primary",
      scenarioIds: ["feature.annotate.relay"]
    });

    expect(sleep).toHaveBeenCalled();
    expect(runNode).toHaveBeenCalledTimes(1);
    expect(report.steps[0]).toMatchObject({
      id: "feature.annotate.relay",
      status: "pass",
      ok: true
    });
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
