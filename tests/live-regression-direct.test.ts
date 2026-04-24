import { describe, expect, it } from "vitest";
import { CANVAS_LIVE_TIMEOUTS_MS, parseJsonFromStdout } from "../scripts/live-direct-utils.mjs";
import {
  buildChildArgs,
  buildScenarioCases,
  buildScenarioDaemonRecoveryStep,
  classifyDaemonLossStep,
  classifyInitialDaemonStep,
  classifyScenarioPreflight,
  daemonStatusDetail,
  isCurrentDaemonStatus,
  parseCliOptions,
  resolveChildStep,
  resolveInitialDaemonStatus,
  waitForExtensionReconnect
} from "../scripts/live-regression-direct.mjs";

describe("live-regression-direct", () => {
  it("parses --release-gate", () => {
    const parsed = parseCliOptions(["--release-gate"]);
    expect(parsed.releaseGate).toBe(true);
  });

  it("builds explicit direct scenario cases", () => {
    const scenarios = buildScenarioCases();
    const ids = scenarios.map((entry) => entry.id);
    const cdp = scenarios.find((entry) => entry.id === "feature.canvas.cdp");

    expect(ids).toEqual([
      "feature.canvas.managed_headless",
      "feature.canvas.managed_headed",
      "feature.canvas.extension",
      "feature.annotate.relay",
      "feature.annotate.direct",
      "feature.canvas.cdp",
      "feature.cli.smoke"
    ]);
    expect(cdp?.requiresOpsDisconnect).toBeUndefined();
    expect(cdp?.timeoutMs).toBe(CANVAS_LIVE_TIMEOUTS_MS.cdp);
  });

  it("only forwards --release-gate to child scripts that support it", () => {
    const scenarios = buildScenarioCases();
    const canvas = scenarios.find((entry) => entry.id === "feature.canvas.extension");
    const annotate = scenarios.find((entry) => entry.id === "feature.annotate.relay");

    expect(buildChildArgs(canvas, true)).toEqual(["--surface", "extension"]);
    expect(buildChildArgs(annotate, true)).toEqual(["--transport", "relay", "--release-gate"]);
  });

  it("fails extension scenarios when the relay disconnects after a healthy initial preflight", () => {
    const result = classifyScenarioPreflight({
      scenario: { id: "feature.canvas.cdp", requiresExtension: true },
      initialDaemonOk: true,
      initialExtensionReady: true,
      currentDaemonStatus: {
        status: 0,
        json: {
          data: {
            relay: {
              extensionHandshakeComplete: false
            }
          }
        }
      }
    });

    expect(result).toEqual({
      status: "fail",
      detail: "extension_disconnected_after_start",
      data: {
        relay: {
          extensionHandshakeComplete: false
        }
      }
    });
  });

  it("waits through transient extension reconnects before classifying later scenarios", async () => {
    const statuses = [
      {
        status: 0,
        json: {
          data: {
            relay: {
              extensionHandshakeComplete: false
            }
          }
        }
      },
      {
        status: 0,
        json: {
          data: {
            relay: {
              extensionHandshakeComplete: true
            }
          }
        }
      }
    ];

    const result = await waitForExtensionReconnect({
      scenario: { id: "feature.canvas.cdp", requiresExtension: true },
      initialExtensionReady: true,
      reconnectGraceMs: 5,
      pollMs: 0,
      statusReader: () => statuses.shift() ?? statuses.at(-1)
    });

    expect(result).toEqual({
      status: 0,
      json: {
        data: {
          relay: {
            extensionHandshakeComplete: true
          }
        }
      }
    });
  });

  it("recovers the daemon before the run starts when the initial probe is down", async () => {
    const initialStatus = {
      status: 1,
      json: null,
      detail: "Daemon not running. Start with `opendevbrowser serve`."
    };
    const recoveredStatus = {
      status: 0,
      json: {
        data: {
          relay: {
            extensionHandshakeComplete: true
          }
        }
      }
    };

    const result = await resolveInitialDaemonStatus({
      statusReader: () => initialStatus,
      recoverStatus: async ({ statusReader }) => {
        expect(statusReader()).toEqual(initialStatus);
        return recoveredStatus;
      }
    });

    expect(result).toEqual({
      initialStatus,
      currentStatus: recoveredStatus,
      recovered: true
    });
  });

  it("keeps daemon recovery as a release-gate failure", () => {
    expect(classifyInitialDaemonStep({
      initialDaemonOk: true,
      initialDaemonRecovered: true,
      releaseGate: true,
      detail: null
    })).toEqual({
      status: "fail",
      detail: "daemon_recovered_before_run"
    });

    expect(classifyInitialDaemonStep({
      initialDaemonOk: true,
      initialDaemonRecovered: true,
      releaseGate: false,
      detail: null
    })).toEqual({
      status: "pass",
      detail: "daemon_recovered_before_run"
    });
  });

  it("classifies reachable stale daemons as not current", () => {
    const staleStatus = {
      status: 0,
      json: {
        data: {
          fingerprintCurrent: false
        }
      }
    };

    expect(isCurrentDaemonStatus(staleStatus)).toBe(false);
    expect(daemonStatusDetail(staleStatus)).toBe("daemon_fingerprint_mismatch");
    expect(classifyInitialDaemonStep({
      initialDaemonOk: isCurrentDaemonStatus(staleStatus),
      initialDaemonRecovered: false,
      releaseGate: true,
      detail: daemonStatusDetail(staleStatus)
    })).toEqual({
      status: "fail",
      detail: "daemon_fingerprint_mismatch"
    });
  });

  it("does not retry daemon-loss child failures under release gate", () => {
    const step = {
      id: "feature.canvas.cdp",
      status: "pass",
      detail: "Daemon not running. Start with `opendevbrowser serve`.",
      data: { artifactPath: "/tmp/odb-canvas-cdp.json" }
    };

    expect(classifyDaemonLossStep(step, true)).toEqual({
      id: "feature.canvas.cdp",
      status: "fail",
      detail: "Daemon not running. Start with `opendevbrowser serve`.",
      data: {
        artifactPath: "/tmp/odb-canvas-cdp.json",
        releaseGateDaemonLoss: true
      }
    });
    expect(classifyDaemonLossStep(step, false)).toBe(step);
  });

  it("does not let stale child summaries override failed child exits", () => {
    const step = resolveChildStep({ id: "feature.canvas.cdp" }, {
      status: 1,
      detail: "child exited with status 1",
      json: {
        summary: {
          status: "pass",
          artifactPath: "/tmp/stale.json"
        }
      }
    });

    expect(step).toEqual({
      id: "feature.canvas.cdp",
      status: "fail",
      detail: "child exited with status 1",
      data: {
        artifactPath: "/tmp/stale.json",
        childStatus: 1,
        childOk: false,
        summaryStatus: "pass",
        stepCount: null
      }
    });
  });

  it("marks per-scenario daemon recovery as a release-gate failure", () => {
    const result = buildScenarioDaemonRecoveryStep({
      id: "feature.canvas.cdp"
    }, {
      recovered: true,
      initialStatus: {
        detail: "Daemon not running. Start with `opendevbrowser serve`."
      }
    });

    expect(result).toEqual({
      id: "feature.canvas.cdp",
      status: "fail",
      detail: "daemon_recovered_before_scenario",
      data: {
        recoveredBeforeScenario: true,
        initialProbeDetail: "Daemon not running. Start with `opendevbrowser serve`."
      }
    });
  });

  it("marks per-scenario stale daemon status as a release-gate failure", () => {
    const result = buildScenarioDaemonRecoveryStep({
      id: "feature.canvas.managed_headless"
    }, {
      recovered: false,
      currentStatus: {
        status: 0,
        json: {
          data: {
            fingerprintCurrent: false
          }
        }
      }
    });

    expect(result).toEqual({
      id: "feature.canvas.managed_headless",
      status: "fail",
      detail: "daemon_fingerprint_mismatch",
      data: {
        currentDaemonStatus: 0,
        recoveredBeforeScenario: false
      }
    });
  });

  it("waits through one transient daemon-status failure before classifying extension loss", async () => {
    const statuses = [
      {
        status: 1,
        json: null,
        detail: "Daemon not running. Start with `opendevbrowser serve`."
      },
      {
        status: 0,
        json: {
          data: {
            relay: {
              extensionHandshakeComplete: true
            }
          }
        }
      }
    ];

    const result = await waitForExtensionReconnect({
      scenario: { id: "feature.annotate.relay", requiresExtension: true },
      initialExtensionReady: true,
      reconnectGraceMs: 5,
      pollMs: 0,
      statusReader: () => statuses.shift() ?? statuses.at(-1)
    });

    expect(result).toEqual({
      status: 0,
      json: {
        data: {
          relay: {
            extensionHandshakeComplete: true
          }
        }
      }
    });
  });

  it("parses trailing pretty-printed child JSON blocks", () => {
    const parsed = parseJsonFromStdout([
      "/tmp/example-artifact.json",
      "{",
      '  "ok": true,',
      '  "summary": {',
      '    "status": "pass"',
      "  }",
      "}"
    ].join("\n"));

    expect(parsed).toEqual({
      ok: true,
      summary: {
        status: "pass"
      }
    });
  });
});
