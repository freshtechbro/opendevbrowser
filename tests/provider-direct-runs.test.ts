import { describe, expect, it } from "vitest";
import { classifyRecords } from "../scripts/live-direct-utils.mjs";
import {
  buildProviderCases,
  classifyDaemonPreflight,
  evaluateMacroCase,
  evaluateShoppingCase,
  parseArgs
} from "../scripts/provider-direct-runs.mjs";

describe("provider-direct-runs", () => {
  it("enables strict release defaults with --release-gate", () => {
    const parsed = parseArgs(["--release-gate"]);

    expect(parsed.releaseGate).toBe(true);
    expect(parsed.runAuthGated).toBe(true);
    expect(parsed.runHighFriction).toBe(true);
    expect(parsed.runSocialPostCases).toBe(true);
  });

  it("rejects --release-gate combined with --smoke", () => {
    expect(() => parseArgs(["--release-gate", "--smoke"])).toThrow(
      "--release-gate cannot be combined with --smoke."
    );
  });

  it("builds release-gate coverage with gated provider cases included", () => {
    const cases = buildProviderCases(parseArgs(["--release-gate"]));
    const ids = cases.map((entry) => entry.id);

    expect(ids).toContain("provider.shopping.bestbuy.search");
    expect(ids).toContain("provider.shopping.costco.search");
    expect(ids).toContain("provider.social.x.post");
    expect(ids).toContain("provider.social.linkedin.search");
  });

  it("marks gated shopping providers as skipped outside release mode", () => {
    const cases = buildProviderCases(parseArgs([]));
    const costco = cases.find((entry) => entry.id === "provider.shopping.costco.search");
    const bestbuy = cases.find((entry) => entry.id === "provider.shopping.bestbuy.search");

    expect(costco?.skipped).toBe(true);
    expect(bestbuy?.skipped).toBe(true);
  });

  it("uses extended shopping timeouts for the slow and high-friction shopping providers", () => {
    const cases = buildProviderCases(parseArgs(["--include-high-friction", "--include-auth-gated"]));
    const ebay = cases.find((entry) => entry.id === "provider.shopping.ebay.search");
    const costco = cases.find((entry) => entry.id === "provider.shopping.costco.search");
    const walmart = cases.find((entry) => entry.id === "provider.shopping.walmart.search");
    const target = cases.find((entry) => entry.id === "provider.shopping.target.search");
    const temu = cases.find((entry) => entry.id === "provider.shopping.temu.search");

    expect(ebay?.args).toContain("120000");
    expect(costco?.args).toContain("120000");
    expect(walmart?.args).toContain("120000");
    expect(target?.args).toContain("120000");
    expect(temu?.args).toContain("120000");
  });

  it("classifies daemon preflight failures before provider cases run", () => {
    const step = classifyDaemonPreflight({
      status: 1,
      detail: "Daemon not running. Start with `opendevbrowser serve`."
    });

    expect(step).toEqual({
      id: "infra.daemon_status",
      status: "fail",
      detail: "Daemon not running. Start with `opendevbrowser serve`.",
      data: null
    });
  });

  it("preserves nested shopping provider shell diagnostics", () => {
    const step = evaluateShoppingCase({
      id: "provider.shopping.temu.search",
      providerId: "shopping/temu",
      args: ["shopping", "run"]
    }, {
      status: 0,
      json: {
        data: {
          offers: [],
          meta: {
            failures: [
              {
                error: {
                  code: "unavailable",
                  reasonCode: "env_limited",
                  details: {
                    providerShell: "temu_challenge_shell",
                    blockerReason: "challenge"
                  }
                }
              }
            ]
          }
        }
      }
    });

    expect(step.data.providerShell).toBe("temu_challenge_shell");
    expect(step.data.blockerReason).toBe("challenge");
  });

  it("treats timeout-only provider failures as fail instead of env-limited", () => {
    expect(classifyRecords(0, [
      {
        error: {
          code: "timeout",
          message: "Provider request timed out after 120000ms"
        }
      }
    ])).toEqual({
      status: "fail",
      detail: "unexpected_reason_codes=timeout"
    });
  });

  it("does not downgrade a non-zero CLI timeout detail to env-limited", () => {
    const step = evaluateShoppingCase({
      id: "provider.shopping.target.search",
      providerId: "shopping/target",
      args: ["shopping", "run"]
    }, {
      status: 1,
      detail: "Request timed out after 120000ms",
      json: null
    });

    expect(step.status).toBe("fail");
    expect(step.detail).toBe("Request timed out after 120000ms");
  });

  it("fails macro cases when the CLI exits zero without an execution payload", () => {
    const step = evaluateMacroCase({
      id: "provider.community.search.url",
      providerId: "community/default",
      args: ["macro-resolve", "--execute"]
    }, {
      status: 0,
      detail: "truncated stdout",
      json: null
    });

    expect(step.status).toBe("fail");
    expect(step.detail).toBe("missing_execution_payload");
    expect(step.data).toMatchObject({
      hasExecutionPayload: false,
      records: 0,
      failures: 0
    });
  });
});
