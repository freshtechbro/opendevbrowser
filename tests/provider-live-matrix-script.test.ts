import { describe, expect, it } from "vitest";
import { buildLiveRegressionEnv, parseArgs } from "../scripts/provider-live-matrix.mjs";

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
});
