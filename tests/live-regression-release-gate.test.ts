import { describe, expect, it } from "vitest";
import {
  buildExtensionLegacyLaunchArgs,
  buildExtensionOpsLaunchArgs,
  evaluateRealWorldScenarioPack,
  hasDirtyRelayClients,
  parseCliOptions,
  shouldStopDaemonAfterRun,
  shouldUseGlobalEnv,
  summarize
} from "../scripts/live-regression-matrix.mjs";

describe("live-regression release-gate options", () => {
  it("parses --release-gate", () => {
    const parsed = parseCliOptions(["--release-gate"]);
    expect(parsed.releaseGate).toBe(true);
  });

  it("keeps legacy summary semantics outside release gate", () => {
    const summary = summarize([
      { id: "x", status: "pass" },
      { id: "y", status: "env_limited" },
      { id: "z", status: "expected_timeout" }
    ], Date.now() - 10, { releaseGate: false });

    expect(summary.counts.fail).toBe(0);
    expect(summary.ok).toBe(true);
  });

  it("fails summary when env_limited or expected_timeout exist in release gate", () => {
    const summary = summarize([
      { id: "x", status: "pass" },
      { id: "y", status: "env_limited" },
      { id: "z", status: "expected_timeout" }
    ], Date.now() - 10, { releaseGate: true });

    expect(summary.ok).toBe(false);
  });

  it("accepts a successful real-world artifact even if the child process exited non-zero", () => {
    const evaluation = evaluateRealWorldScenarioPack({
      runStatus: 143,
      releaseGate: false,
      artifact: {
        ok: true,
        counts: {
          pass: 48,
          env_limited: 4,
          fail: 0
        }
      }
    });

    expect(evaluation.m23Pass).toBe(true);
    expect(evaluation.failCount).toBe(0);
    expect(evaluation.envLimitedCount).toBe(4);
  });

  it("keeps release mode strict about env-limited real-world artifacts", () => {
    const evaluation = evaluateRealWorldScenarioPack({
      runStatus: 0,
      releaseGate: true,
      artifact: {
        ok: true,
        counts: {
          pass: 48,
          env_limited: 1,
          fail: 0
        }
      }
    });

    expect(evaluation.m23Pass).toBe(false);
    expect(evaluation.requireZeroEnvLimited).toBe(true);
  });

  it("allows explicit daemon preservation override in isolated mode", () => {
    expect(shouldStopDaemonAfterRun({ useGlobalEnv: false, stopDaemonEnv: "0" })).toBe(false);
  });

  it("stops daemon by default in isolated mode", () => {
    expect(shouldStopDaemonAfterRun({ useGlobalEnv: false })).toBe(true);
  });

  it("uses the global daemon/runtime by default", () => {
    expect(shouldUseGlobalEnv(undefined)).toBe(true);
  });

  it("allows explicit isolated runtime opt-out", () => {
    expect(shouldUseGlobalEnv("0")).toBe(false);
  });

  it("recycles when relay already has dirty non-extension clients", () => {
    expect(hasDirtyRelayClients({ opsConnected: true })).toBe(true);
    expect(hasDirtyRelayClients({ canvasConnected: true })).toBe(true);
    expect(hasDirtyRelayClients({ annotationConnected: true })).toBe(true);
    expect(hasDirtyRelayClients({ cdpConnected: true })).toBe(true);
  });

  it("keeps a clean extension-only relay reusable", () => {
    expect(hasDirtyRelayClients({
      extensionConnected: true,
      extensionHandshakeComplete: true,
      opsConnected: false,
      canvasConnected: false,
      annotationConnected: false,
      cdpConnected: false
    })).toBe(false);
  });

  it("launches extension ops mode directly into the scenario url", () => {
    expect(buildExtensionOpsLaunchArgs()).toEqual([
      "launch",
      "--extension-only",
      "--wait-for-extension",
      "--wait-timeout-ms",
      expect.any(String),
      "--start-url",
      "https://example.com/?extension-ops=matrix"
    ]);
  });

  it("launches extension legacy mode directly into the scenario url", () => {
    expect(buildExtensionLegacyLaunchArgs()).toEqual([
      "launch",
      "--extension-only",
      "--extension-legacy",
      "--wait-for-extension",
      "--wait-timeout-ms",
      expect.any(String),
      "--start-url",
      "https://example.com/?extension-legacy=matrix"
    ]);
  });
});
