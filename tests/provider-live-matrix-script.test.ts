import { describe, expect, it } from "vitest";
import {
  buildLiveRegressionEnv,
  classifyMatrixRecords,
  parseArgs,
  REQUIRED_PLAYWRIGHT_CORE_FILES
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

  it("treats Playwright server registry files as integrity sentinels", () => {
    expect(REQUIRED_PLAYWRIGHT_CORE_FILES).toContain("lib/server/index.js");
    expect(REQUIRED_PLAYWRIGHT_CORE_FILES).toContain("lib/server/registry/index.js");
  });

  it("keeps timeout env-limited for matrix classification and preserves the shared target timeout bucket", () => {
    expect(MATRIX_ENV_LIMITED_CODES.has("timeout")).toBe(true);
    expect(MATRIX_SHOPPING_PROVIDER_TIMEOUT_MS.get("shopping/target")).toBe("120000");
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
});
