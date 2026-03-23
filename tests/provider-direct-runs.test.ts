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

  it("requests helper-capable challenge mode for macro execute cases", () => {
    const cases = buildProviderCases(parseArgs(["--include-social-posts"]));
    const communitySearch = cases.find((entry) => entry.id === "provider.community.search.keyword");
    const linkedinSearch = cases.find((entry) => entry.id === "provider.social.linkedin.search");
    const socialPost = cases.find((entry) => entry.id === "provider.social.x.post");

    expect(communitySearch?.args).toContain("--challenge-automation-mode");
    expect(communitySearch?.args).toContain("browser_with_helper");
    expect(linkedinSearch?.args).toContain("--challenge-automation-mode");
    expect(linkedinSearch?.args).toContain("browser_with_helper");
    expect(socialPost?.args).toContain("--challenge-automation-mode");
    expect(socialPost?.args).toContain("browser_with_helper");
  });

  it("requests helper-capable challenge mode for shopping cases", () => {
    const cases = buildProviderCases(parseArgs(["--include-high-friction", "--include-auth-gated"]));
    const target = cases.find((entry) => entry.id === "provider.shopping.target.search");

    expect(target?.args).toContain("--challenge-automation-mode");
    expect(target?.args).toContain("browser_with_helper");
  });

  it("marks gated shopping providers as skipped outside release mode", () => {
    const cases = buildProviderCases(parseArgs([]));
    const costco = cases.find((entry) => entry.id === "provider.shopping.costco.search");
    const bestbuy = cases.find((entry) => entry.id === "provider.shopping.bestbuy.search");

    expect(costco?.skipped).toBe(true);
    expect(bestbuy?.skipped).toBe(true);
  });

  it("uses the Target-specific timeout without widening other slow shopping providers", () => {
    const cases = buildProviderCases(parseArgs(["--include-high-friction", "--include-auth-gated"]));
    const ebay = cases.find((entry) => entry.id === "provider.shopping.ebay.search");
    const costco = cases.find((entry) => entry.id === "provider.shopping.costco.search");
    const walmart = cases.find((entry) => entry.id === "provider.shopping.walmart.search");
    const target = cases.find((entry) => entry.id === "provider.shopping.target.search");
    const temu = cases.find((entry) => entry.id === "provider.shopping.temu.search");

    expect(ebay?.args).toContain("120000");
    expect(costco?.args).toContain("120000");
    expect(walmart?.args).toContain("120000");
    expect(target?.args).toContain("180000");
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
      id: "provider.shopping.target.search",
      providerId: "shopping/target",
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
                    constraint: {
                      kind: "render_required",
                      evidenceCode: "target_shell_page"
                    },
                    providerShell: "target_shell_page",
                    blockerReason: "render_required"
                  }
                }
              }
            ]
          }
        }
      }
    });

    expect(step.data.providerShell).toBe("target_shell_page");
    expect(step.data.constraintKind).toBe("render_required");
    expect(step.data.blockerReason).toBe("render_required");
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
      failures: 0,
      requestedChallengeAutomationMode: null,
      helperCapableRequested: false
    });
  });

  it("surfaces requested helper-capable macro metadata in evaluated macro steps", () => {
    const step = evaluateMacroCase({
      id: "provider.community.search.keyword",
      providerId: "community/default",
      args: [
        "macro-resolve",
        "--execute",
        "--expression",
        '@community.search("browser automation failures", 4)',
        "--challenge-automation-mode",
        "browser_with_helper"
      ]
    }, {
      status: 0,
      detail: "Macro resolved and executed.",
      json: {
        data: {
          execution: {
            records: [{ id: "1" }],
            failures: [],
            meta: {
              providerOrder: ["community/default"]
            }
          }
        }
      }
    });

    expect(step.status).toBe("pass");
    expect(step.data).toMatchObject({
      requestedChallengeAutomationMode: "browser_with_helper",
      helperCapableRequested: true
    });
  });

  it("surfaces helper execution metadata from macro record attributes", () => {
    const step = evaluateMacroCase({
      id: "provider.social.reddit.search",
      providerId: "social/reddit",
      args: [
        "macro-resolve",
        "--execute",
        "--expression",
        '@media.search("browser automation reddit", "reddit", 5)',
        "--challenge-automation-mode",
        "browser_with_helper"
      ]
    }, {
      status: 0,
      detail: "Macro resolved and executed.",
      json: {
        data: {
          execution: {
            records: [{
              id: "reddit-1",
              attributes: {
                browser_fallback_mode: "extension",
                browser_fallback_reason_code: "challenge_detected",
                browser_fallback_challenge_orchestration: {
                  mode: "browser_with_helper",
                  source: "config",
                  status: "resolved"
                }
              }
            }],
            failures: [],
            meta: {
              providerOrder: ["social/reddit"]
            }
          }
        }
      }
    });

    expect(step.status).toBe("pass");
    expect(step.data.challengeOrchestration).toMatchObject({
      mode: "browser_with_helper",
      source: "config",
      status: "resolved"
    });
    expect(step.data.browserFallbackMode).toBe("extension");
    expect(step.data.browserFallbackReasonCode).toBe("challenge_detected");
  });

  it("surfaces helper-capable shopping metadata and orchestration summaries", () => {
    const step = evaluateShoppingCase({
      id: "provider.shopping.target.search",
      providerId: "shopping/target",
      args: [
        "shopping",
        "run",
        "--query",
        "portable monitor",
        "--challenge-automation-mode",
        "browser_with_helper"
      ]
    }, {
      status: 0,
      json: {
        data: {
          offers: [],
          meta: {
            metrics: {
              challenge_orchestration: [{
                provider: "shopping/target",
                browserFallbackMode: "extension",
                mode: "browser_with_helper",
                source: "config",
                status: "resolved"
              }]
            },
            failures: [{
              error: {
                code: "unavailable",
                reasonCode: "env_limited",
                details: {
                  browserFallbackMode: "extension",
                  browserFallbackReasonCode: "env_limited",
                  constraint: {
                    kind: "render_required",
                    evidenceCode: "target_shell_page"
                  },
                  providerShell: "target_shell_page",
                  blockerReason: "render_required"
                }
              }
            }]
          }
        }
      }
    });

    expect(step.data).toMatchObject({
      requestedChallengeAutomationMode: "browser_with_helper",
      helperCapableRequested: true,
      browserFallbackMode: "extension",
      browserFallbackReasonCode: "env_limited",
      challengeOrchestration: {
        mode: "browser_with_helper",
        source: "config",
        status: "resolved"
      }
    });
  });
});
