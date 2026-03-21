import { describe, expect, it } from "vitest";
import {
  classifyProbeOutcome,
  getLaunchArgs,
  parseArgs
} from "../scripts/annotate-live-probe.mjs";

describe("annotate-live-probe script", () => {
  it("requires a supported transport", () => {
    expect(() => parseArgs(["--transport", "auto"])).toThrow(
      "Unknown --transport value: auto"
    );
  });

  it("parses relay transport and default artifact path", () => {
    const parsed = parseArgs(["--transport", "relay"]);

    expect(parsed.transport).toBe("relay");
    expect(parsed.out).toContain("/tmp/odb-annotate-relay-probe-");
  });

  it("parses --release-gate", () => {
    const parsed = parseArgs(["--transport", "direct", "--release-gate"]);

    expect(parsed.releaseGate).toBe(true);
  });

  it("uses a temporary managed profile for direct probes", () => {
    expect(getLaunchArgs("direct")).toContain("--persist-profile");
    expect(getLaunchArgs("direct")).toContain("false");
  });

  it("classifies direct manual timeouts as expected timeouts outside release mode", () => {
    expect(classifyProbeOutcome({
      transport: "direct",
      releaseGate: false,
      commandStatus: 2,
      success: false,
      detail: "Annotation request timed out."
    })).toEqual({
      status: "expected_timeout",
      detail: "Annotation request timed out."
    });
  });

  it("classifies relay manual timeouts as skipped in release mode", () => {
    expect(classifyProbeOutcome({
      transport: "relay",
      releaseGate: true,
      commandStatus: 2,
      success: false,
      detail: "Annotation request timed out."
    })).toEqual({
      status: "skipped",
      detail: "manual_probe_boundary_observed:relay_annotation_timeout"
    });
  });

  it("treats manual-completion timeout messages as the same probe boundary", () => {
    expect(classifyProbeOutcome({
      transport: "direct",
      releaseGate: true,
      commandStatus: 2,
      success: false,
      detail: "Annotation UI started and is waiting for manual completion."
    })).toEqual({
      status: "skipped",
      detail: "manual_probe_boundary_observed:direct_annotation_timeout"
    });
  });
});
