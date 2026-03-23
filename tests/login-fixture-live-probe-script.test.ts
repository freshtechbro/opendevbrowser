import { describe, expect, it } from "vitest";
import {
  INVALID_BRANCH_SETTLE_MS,
  parseArgs,
  shouldWaitForLoadAfterSubmit
} from "../scripts/login-fixture-live-probe.mjs";

describe("login-fixture-live-probe script", () => {
  it("parses default artifact output", () => {
    const parsed = parseArgs([]);

    expect(parsed.out).toContain("/tmp/odb-login-fixture-live-probe-");
    expect(parsed.quiet).toBe(false);
  });

  it("does not wait for a fresh load event on the invalid-credentials branch", () => {
    expect(shouldWaitForLoadAfterSubmit("invalid-credentials")).toBe(false);
    expect(shouldWaitForLoadAfterSubmit("mfa-login")).toBe(true);
    expect(INVALID_BRANCH_SETTLE_MS).toBeGreaterThan(0);
  });
});
