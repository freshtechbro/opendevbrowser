import { describe, expect, it } from "vitest";
import { CANVAS_LIVE_TIMEOUTS_MS, parseJsonFromStdout } from "../scripts/live-direct-utils.mjs";
import {
  buildChildArgs,
  buildScenarioCases,
  classifyScenarioPreflight,
  parseCliOptions,
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
      "feature.canvas.cdp",
      "feature.annotate.relay",
      "feature.annotate.direct",
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
