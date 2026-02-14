import { describe, expect, it } from "vitest";
import { __test__ } from "../src/cli/daemon-client";

describe("daemon-client timeout derivation", () => {
  it("prefers explicit transport timeout when provided", () => {
    expect(__test__.deriveTransportTimeoutMs({ timeoutMs: 60_000 }, 12_345)).toBe(12_345);
  });

  it("derives transport timeout from command timeoutMs with buffer", () => {
    expect(__test__.deriveTransportTimeoutMs({ timeoutMs: 45_000 }, undefined)).toBe(50_000);
  });

  it("derives transport timeout from waitTimeoutMs with buffer", () => {
    expect(__test__.deriveTransportTimeoutMs({ waitTimeoutMs: 30_000 }, undefined)).toBe(35_000);
  });

  it("caps derived timeout at the maximum bound", () => {
    expect(__test__.deriveTransportTimeoutMs({ timeoutMs: 600_000 }, undefined)).toBe(300_000);
  });

  it("returns undefined when no valid timeout hints are present", () => {
    expect(__test__.deriveTransportTimeoutMs({}, undefined)).toBeUndefined();
    expect(__test__.deriveTransportTimeoutMs({ timeoutMs: "5000" }, undefined)).toBeUndefined();
    expect(__test__.deriveTransportTimeoutMs({ waitTimeoutMs: 0 }, undefined)).toBeUndefined();
  });
});
