import { describe, expect, it } from "vitest";
import { parseCliOptions, shouldStopDaemonAfterRun, summarize } from "../scripts/live-regression-matrix.mjs";

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

  it("allows explicit daemon preservation override in isolated mode", () => {
    expect(shouldStopDaemonAfterRun({ useGlobalEnv: false, stopDaemonEnv: "0" })).toBe(false);
  });

  it("stops daemon by default in isolated mode", () => {
    expect(shouldStopDaemonAfterRun({ useGlobalEnv: false })).toBe(true);
  });
});
