import { describe, expect, it } from "vitest";
import {
  buildFixtureGotoArgs,
  buildFixtureLoadWaitArgs,
  FIXTURE_NAVIGATION_TIMEOUT_MS,
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

  it("builds explicit goto arguments for fixture navigations", () => {
    expect(buildFixtureGotoArgs("session-1", "http://127.0.0.1:4000/login")).toEqual([
      "goto",
      "--session-id",
      "session-1",
      "--url",
      "http://127.0.0.1:4000/login",
      "--wait-until",
      "load",
      "--timeout-ms",
      String(FIXTURE_NAVIGATION_TIMEOUT_MS)
    ]);
    expect(FIXTURE_NAVIGATION_TIMEOUT_MS).toBeGreaterThan(5000);
  });

  it("builds explicit wait arguments for fixture submit navigations", () => {
    expect(buildFixtureLoadWaitArgs("session-1")).toEqual([
      "wait",
      "--session-id",
      "session-1",
      "--until",
      "load",
      "--timeout-ms",
      String(FIXTURE_NAVIGATION_TIMEOUT_MS)
    ]);
  });
});
