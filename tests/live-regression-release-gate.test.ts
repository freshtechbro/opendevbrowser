import { describe, expect, it } from "vitest";
import {
  buildExtensionLegacyLaunchArgs,
  buildExtensionOpsLaunchArgs,
  evaluateRealWorldScenarioPack,
  hasDirtyRelayClients,
  isAnnotationPendingCompletion,
  parseCliOptions,
  resolveExtensionLegacyFailure,
  resolveMacroFailureOutcome,
  resolveRpcFailureOutcome,
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
    expect(hasDirtyRelayClients({
      opsConnected: true,
      extensionConnected: false,
      extensionHandshakeComplete: false
    })).toBe(true);
    expect(hasDirtyRelayClients({ canvasConnected: true })).toBe(true);
    expect(hasDirtyRelayClients({ annotationConnected: true })).toBe(true);
    expect(hasDirtyRelayClients({ cdpConnected: true })).toBe(true);
  });

  it("keeps a clean extension-only relay reusable", () => {
    expect(hasDirtyRelayClients({
      extensionConnected: true,
      extensionHandshakeComplete: true,
      opsConnected: true,
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

  it("downgrades shell-only macro challenge boundaries to env_limited", () => {
    expect(resolveMacroFailureOutcome(
      "Macro execution returned only shell records (challenge_shell)."
    )).toEqual({
      status: "env_limited",
      detail: "shell_only_records=challenge_shell"
    });
    expect(resolveMacroFailureOutcome(
      "Macro execution returned only shell records (social_js_required_shell)."
    )).toEqual({
      status: "env_limited",
      detail: "shell_only_records=social_js_required_shell"
    });
    expect(resolveMacroFailureOutcome(
      "CLI failed (macro-resolve --execute --expression @web.search(\"openai\", 3) --timeout-ms 120000): Macro execution returned only shell records (challenge_shell)."
    )).toEqual({
      status: "env_limited",
      detail: "shell_only_records=challenge_shell"
    });
  });

  it("keeps truncated fetch shell-only failures blocking", () => {
    expect(resolveMacroFailureOutcome(
      "Macro execution returned only shell records (truncated_fetch_shell)."
    )).toEqual({
      status: "fail",
      detail: "shell_only_records=truncated_fetch_shell"
    });
  });

  it("downgrades rpc macro shell-only boundaries to env_limited", () => {
    expect(resolveRpcFailureOutcome(
      "feature.rpc.macro_resolve_execute",
      "CLI failed (rpc --unsafe-internal --name macro.resolve --params {\"expression\":\"@web.search(\\\"openai\\\", 3)\",\"execute\":true}): Macro execution returned only shell records (challenge_shell)."
    )).toEqual({
      status: "env_limited",
      detail: "shell_only_records=challenge_shell"
    });
    expect(resolveRpcFailureOutcome(
      "feature.rpc.relay_status",
      "CLI failed (rpc --unsafe-internal --name relay.status): transport down"
    )).toEqual({
      status: "fail",
      detail: "CLI failed (rpc --unsafe-internal --name relay.status): transport down"
    });
  });

  it("recognizes annotate manual-completion waits as expected timeout state", () => {
    expect(isAnnotationPendingCompletion("Annotation UI started and is waiting for manual completion.")).toBe(true);
    expect(isAnnotationPendingCompletion("Timed out waiting for annotation completion.")).toBe(false);
  });

  it("treats missing extension legacy targets as env-limited outside release gate", () => {
    expect(resolveExtensionLegacyFailure("No active target")).toEqual({
      status: "env_limited",
      detail: "No active target"
    });
  });
});
