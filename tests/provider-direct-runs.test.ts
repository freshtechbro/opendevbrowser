import { describe, expect, it, vi } from "vitest";
import { classifyRecords } from "../scripts/live-direct-utils.mjs";
import {
  DIRECT_ENV_LIMITED_CODES,
  DIRECT_SHOPPING_PROVIDER_TIMEOUT_MS,
  SOCIAL_POST_CASES
} from "../scripts/shared/workflow-lane-constants.mjs";
import {
  buildProviderCoverageStep,
  buildProviderCases,
  classifyDaemonPreflight,
  ensureProviderDaemon,
  evaluateMacroCase,
  evaluateShoppingCase,
  mergeRetriedMacroStep,
  mergeRetriedShoppingStep,
  parseArgs,
  shouldAbortForDaemonPreflight,
  shouldRetryShoppingTimeoutCase,
  shouldRetryMacroTimeoutCase
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

  it("rejects the removed global-env compatibility flag", () => {
    expect(() => parseArgs(["--use-global-env"])).toThrow(
      "Unknown option: --use-global-env"
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

  it("builds social post probes from the shared governance inventory", () => {
    const cases = buildProviderCases(parseArgs(["--include-social-posts"]));
    const ids = cases
      .filter((entry) => entry.id.startsWith("provider.social.") && entry.id.endsWith(".post"))
      .map((entry) => entry.id);

    expect(ids).toEqual(SOCIAL_POST_CASES.map((entry) => entry.id));
  });

  it("requests helper-capable challenge mode for shopping cases", () => {
    const cases = buildProviderCases(parseArgs(["--include-high-friction", "--include-auth-gated"]));
    const target = cases.find((entry) => entry.id === "provider.shopping.target.search");

    expect(target?.args).toContain("--challenge-automation-mode");
    expect(target?.args).toContain("browser_with_helper");
    expect(target?.args).toContain("--use-cookies");
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

    expect(ebay?.args).toContain(DIRECT_SHOPPING_PROVIDER_TIMEOUT_MS.get("shopping/ebay"));
    expect(costco?.args).toContain(DIRECT_SHOPPING_PROVIDER_TIMEOUT_MS.get("shopping/costco"));
    expect(walmart?.args).toContain(DIRECT_SHOPPING_PROVIDER_TIMEOUT_MS.get("shopping/walmart"));
    expect(target?.args).toContain(DIRECT_SHOPPING_PROVIDER_TIMEOUT_MS.get("shopping/target"));
    expect(temu?.args).toContain(DIRECT_SHOPPING_PROVIDER_TIMEOUT_MS.get("shopping/temu"));
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

  it("classifies stale daemon fingerprints as unusable", () => {
    const step = classifyDaemonPreflight({
      status: 0,
      json: { success: true, data: { fingerprintCurrent: false } }
    });

    expect(step).toEqual({
      id: "infra.daemon_status",
      status: "fail",
      detail: "daemon_fingerprint_mismatch",
      data: { fingerprintCurrent: false }
    });
  });

  it("aborts provider cases when daemon preflight sees a stale status-0 fingerprint", () => {
    expect(shouldAbortForDaemonPreflight({
      status: 0,
      json: { success: true, data: { fingerprintCurrent: false } }
    })).toBe(true);
    expect(shouldAbortForDaemonPreflight({
      status: 0,
      json: { success: true, data: { fingerprintCurrent: true } }
    })).toBe(false);
  });

  it("starts a fresh daemon when preflight sees a stale fingerprint", async () => {
    const stale = { status: 0, json: { success: true, data: { fingerprintCurrent: false } } };
    const fresh = { status: 0, json: { success: true, data: { fingerprintCurrent: true } } };
    const state = { ownedDaemon: null };
    const started = { pid: 1234 };
    const readDaemonStatusImpl = vi.fn()
      .mockReturnValueOnce(stale)
      .mockReturnValueOnce(fresh);
    const startConfiguredDaemonImpl = vi.fn(async () => started);

    await expect(ensureProviderDaemon(state, {
      readDaemonStatusImpl,
      startConfiguredDaemonImpl
    })).resolves.toEqual({
      daemonStatus: fresh,
      startedDaemon: true
    });
    expect(state.ownedDaemon).toBe(started);
  });

  it("downgrades non-release provider coverage gaps into explicit skipped advisories", () => {
    const step = buildProviderCoverageStep({
      expected: { all: Array.from({ length: 22 }, (_, index) => `provider-${index}`) },
      scenarios: { all: Array.from({ length: 8 }, (_, index) => `provider-${index}`) },
      missingProviderIds: ["provider-8", "provider-9"],
      extraScenarioProviderIds: [],
      ok: false
    }, { releaseGate: false });

    expect(step).toEqual({
      id: "infra.provider_scenario_coverage",
      status: "skipped",
      detail: "missing=provider-8,provider-9 extra=none",
      data: {
        expectedCount: 22,
        scenarioCount: 8,
        missingProviderIds: ["provider-8", "provider-9"],
        extraScenarioProviderIds: [],
        coverageGap: true
      }
    });
  });

  it("keeps release-gate provider coverage gaps blocking", () => {
    const step = buildProviderCoverageStep({
      expected: { all: ["provider-a", "provider-b"] },
      scenarios: { all: ["provider-a"] },
      missingProviderIds: ["provider-b"],
      extraScenarioProviderIds: [],
      ok: false
    }, { releaseGate: true });

    expect(step.status).toBe("fail");
    expect(step.detail).toBe("missing=provider-b extra=none");
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
                    blockerReason: "render_required",
                    guidance: {
                      reason: "Target needs a live browser-rendered page before retrying.",
                      recommendedNextCommands: [
                        "Retry with browser assistance or a headed browser session.",
                        "Rerun the same provider or workflow after the rendered page is ready."
                      ]
                    }
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
    expect(step.data.guidanceReason).toBe("Target needs a live browser-rendered page before retrying.");
    expect(step.data.recommendedNextCommand).toBe("Retry with browser assistance or a headed browser session.");
  });

  it("surfaces macro guidance from failure details before workflow meta", () => {
    const step = evaluateMacroCase({
      id: "provider.social.linkedin.search",
      providerId: "social/linkedin",
      args: ["macro-resolve", "--execute"]
    }, {
      status: 0,
      json: {
        data: {
          execution: {
            records: [],
            failures: [
              {
                provider: "social/linkedin",
                error: {
                  code: "auth",
                  reasonCode: "token_required",
                  details: {
                    guidance: {
                      reason: "Linkedin needs an authenticated session before retrying.",
                      recommendedNextCommands: [
                        "Reuse an authenticated browser session, import logged-in cookies, or use the provider sign-in flow."
                      ]
                    }
                  }
                }
              }
            ],
            meta: {
              providerOrder: ["social/linkedin"],
              primaryConstraint: {
                guidance: {
                  reason: "stale meta guidance",
                  recommendedNextCommands: ["should not be used"]
                }
              }
            }
          }
        }
      }
    });

    expect(step.data.guidanceReason).toBe("Linkedin needs an authenticated session before retrying.");
    expect(step.data.recommendedNextCommand).toBe(
      "Reuse an authenticated browser session, import logged-in cookies, or use the provider sign-in flow."
    );
  });

  it("treats timeout-only provider failures as fail instead of env-limited", () => {
    expect(DIRECT_ENV_LIMITED_CODES.has("timeout")).toBe(false);
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

  it("treats a raw Temu timeout boundary as a retryable failure", () => {
    const step = evaluateShoppingCase({
      id: "provider.shopping.temu.search",
      providerId: "shopping/temu",
      args: ["shopping", "run"]
    }, {
      status: 1,
      detail: "Request timed out after 125000ms",
      json: null
    });

    expect(step.status).toBe("fail");
    expect(step.detail).toBe("Request timed out after 125000ms");
    expect(shouldRetryShoppingTimeoutCase({
      providerId: "shopping/temu"
    }, step)).toBe(true);
  });

  it("keeps non-zero raw macro detail ahead of structured payload classification", () => {
    const step = evaluateMacroCase({
      id: "provider.community.search.keyword",
      providerId: "community/default",
      args: ["macro-resolve", "--execute"]
    }, {
      status: 1,
      detail: "Challenge detected while resolving provider output.",
      json: {
        data: {
          execution: {
            records: [],
            failures: [
              {
                error: {
                  code: "timeout",
                  message: "Provider request timed out after 120000ms"
                }
              }
            ],
            meta: {
              providerOrder: ["community/default"]
            }
          }
        }
      }
    });

    expect(step.status).toBe("fail");
    expect(step.detail).toBe("Challenge detected while resolving provider output.");
    expect(step.data).toMatchObject({
      hasExecutionPayload: true,
      reasonCodes: ["timeout"],
      shellOnlyReasons: []
    });
  });

  it("keeps non-zero raw shopping detail ahead of structured payload classification", () => {
    const step = evaluateShoppingCase({
      id: "provider.shopping.target.search",
      providerId: "shopping/target",
      args: ["shopping", "run"]
    }, {
      status: 1,
      detail: "Authentication required before continuing.",
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

    expect(step.status).toBe("fail");
    expect(step.detail).toBe("Authentication required before continuing.");
    expect(step.data).toMatchObject({
      reasonCodes: ["env_limited"],
      providerShell: "target_shell_page",
      constraintKind: "render_required"
    });
  });

  it("keeps non-zero raw auth detail blocking when macro execution payload is missing", () => {
    const step = evaluateMacroCase({
      id: "provider.community.search.keyword",
      providerId: "community/default",
      args: ["macro-resolve", "--execute"]
    }, {
      status: 1,
      detail: "Authentication required before continuing.",
      json: null
    });

    expect(step.status).toBe("fail");
    expect(step.detail).toBe("Authentication required before continuing.");
    expect(step.data).toMatchObject({
      hasExecutionPayload: false,
      shellOnlyReasons: []
    });
  });

  it("keeps non-zero raw challenge detail blocking when shopping payload is missing", () => {
    const step = evaluateShoppingCase({
      id: "provider.shopping.target.search",
      providerId: "shopping/target",
      args: ["shopping", "run"]
    }, {
      status: 1,
      detail: "Challenge detected while loading provider page.",
      json: null
    });

    expect(step.status).toBe("fail");
    expect(step.detail).toBe("Challenge detected while loading provider page.");
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

  it("fails social macro cases that return no records and no failures", () => {
    const step = evaluateMacroCase({
      id: "provider.social.threads.search",
      providerId: "social/threads",
      args: ["macro-resolve", "--execute"]
    }, {
      status: 0,
      detail: "Macro resolved and executed.",
      json: {
        data: {
          execution: {
            records: [],
            failures: [],
            meta: {
              providerOrder: ["social/threads"]
            }
          }
        }
      }
    });

    expect(step.status).toBe("fail");
    expect(step.detail).toBe("no_records_no_failures");
    expect(step.data).toMatchObject({
      hasExecutionPayload: true,
      records: 0,
      failures: 0
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

  it("retries linkedin timeout rows only when the first pass has no execution payload", () => {
    expect(shouldRetryMacroTimeoutCase({
      providerId: "social/linkedin"
    }, {
      status: "fail",
      detail: "Request timed out after 120000ms",
      data: {
        hasExecutionPayload: false
      }
    })).toBe(true);

    expect(shouldRetryMacroTimeoutCase({
      providerId: "social/linkedin"
    }, {
      status: "fail",
      detail: "Request timed out after 120000ms",
      data: {
        hasExecutionPayload: true
      }
    })).toBe(false);

    expect(shouldRetryMacroTimeoutCase({
      providerId: "social/facebook"
    }, {
      status: "fail",
      detail: "Request timed out after 120000ms",
      data: {
        hasExecutionPayload: false
      }
    })).toBe(false);

    expect(shouldRetryMacroTimeoutCase({
      providerId: "social/youtube"
    }, {
      status: "fail",
      detail: "shell_only_records=youtube_site_chrome_shell",
      data: {
        hasExecutionPayload: false
      }
    })).toBe(true);
  });

  it("promotes a recovered linkedin retry result while preserving retry metadata", () => {
    const merged = mergeRetriedMacroStep({
      id: "provider.social.linkedin.search",
      status: "fail",
      detail: "Request timed out after 120000ms",
      data: {
        hasExecutionPayload: false
      }
    }, {
      id: "provider.social.linkedin.search",
      status: "pass",
      detail: null,
      data: {
        hasExecutionPayload: true,
        records: 1
      }
    });

    expect(merged.status).toBe("pass");
    expect(merged.data).toMatchObject({
      hasExecutionPayload: true,
      records: 1,
      retryAttempted: true,
      retryRecovered: true,
      retryInitialStatus: "fail",
      retryInitialDetail: "Request timed out after 120000ms"
    });
  });

  it("keeps the original linkedin timeout row when the isolated retry still fails", () => {
    const merged = mergeRetriedMacroStep({
      id: "provider.social.linkedin.search",
      status: "fail",
      detail: "Request timed out after 120000ms",
      data: {
        hasExecutionPayload: false
      }
    }, {
      id: "provider.social.linkedin.search",
      status: "fail",
      detail: "Request timed out after 120000ms",
      data: {
        hasExecutionPayload: false
      }
    });

    expect(merged.status).toBe("fail");
    expect(merged.detail).toBe("Request timed out after 120000ms");
    expect(merged.data).toMatchObject({
      hasExecutionPayload: false,
      retryAttempted: true,
      retryRecovered: false,
      retryFinalStatus: "fail",
      retryFinalDetail: "Request timed out after 120000ms"
    });
  });

  it("keeps the original linkedin timeout row when retry is only env-limited", () => {
    const merged = mergeRetriedMacroStep({
      id: "provider.social.linkedin.search",
      status: "fail",
      detail: "Request timed out after 120000ms",
      data: {
        hasExecutionPayload: false
      }
    }, {
      id: "provider.social.linkedin.search",
      status: "env_limited",
      detail: "reason_codes=auth",
      data: {
        records: 0
      }
    });

    expect(merged.status).toBe("fail");
    expect(merged.detail).toBe("Request timed out after 120000ms");
    expect(merged.data).toMatchObject({
      retryRecovered: false,
      retryFinalStatus: "env_limited"
    });
  });


  it("keeps the original YouTube chrome-shell row when retry lacks usable records", () => {
    const initial = {
      id: "provider.social.youtube.search",
      status: "fail",
      detail: "shell_only_records=youtube_site_chrome_shell",
      data: {
        hasExecutionPayload: false
      }
    };

    expect(mergeRetriedMacroStep(initial, {
      id: "provider.social.youtube.search",
      status: "env_limited",
      detail: "reason_codes=env_limited",
      data: {
        records: 0
      }
    })).toMatchObject({
      status: "fail",
      detail: "shell_only_records=youtube_site_chrome_shell",
      data: {
        retryRecovered: false,
        retryFinalStatus: "env_limited"
      }
    });

    expect(mergeRetriedMacroStep(initial, {
      id: "provider.social.youtube.search",
      status: "pass",
      detail: null,
      data: {
        records: 0
      }
    })).toMatchObject({
      status: "fail",
      detail: "shell_only_records=youtube_site_chrome_shell",
      data: {
        retryRecovered: false,
        retryFinalStatus: "pass"
      }
    });
  });

  it("promotes a YouTube chrome-shell retry only when usable records are returned", () => {
    const merged = mergeRetriedMacroStep({
      id: "provider.social.youtube.search",
      status: "fail",
      detail: "shell_only_records=youtube_site_chrome_shell",
      data: {
        hasExecutionPayload: false
      }
    }, {
      id: "provider.social.youtube.search",
      status: "pass",
      detail: null,
      data: {
        hasExecutionPayload: true,
        records: 1
      }
    });

    expect(merged.status).toBe("pass");
    expect(merged.data).toMatchObject({
      records: 1,
      retryRecovered: true
    });
  });

  it("retries Temu timeout rows when the first pass fails with provider timeout reason codes", () => {
    expect(shouldRetryShoppingTimeoutCase({
      providerId: "shopping/temu"
    }, {
      status: "fail",
      detail: "unexpected_reason_codes=timeout",
      data: {
        reasonCodes: ["timeout"]
      }
    })).toBe(true);

    expect(shouldRetryShoppingTimeoutCase({
      providerId: "shopping/walmart"
    }, {
      status: "fail",
      detail: "unexpected_reason_codes=timeout",
      data: {
        reasonCodes: ["timeout"]
      }
    })).toBe(false);
  });

  it("keeps the original Temu timeout row when retry is only env-limited", () => {
    const merged = mergeRetriedShoppingStep({
      id: "provider.shopping.temu.search",
      status: "fail",
      detail: "unexpected_reason_codes=timeout",
      data: {
        reasonCodes: ["timeout"]
      }
    }, {
      id: "provider.shopping.temu.search",
      status: "env_limited",
      detail: "reason_codes=env_limited",
      data: {
        reasonCodes: ["env_limited"],
        offers: 0
      }
    });

    expect(merged.status).toBe("fail");
    expect(merged.detail).toBe("unexpected_reason_codes=timeout");
    expect(merged.data).toMatchObject({
      retryAttempted: true,
      retryRecovered: false,
      retryInitialStatus: "fail",
      retryInitialDetail: "unexpected_reason_codes=timeout",
      retryFinalStatus: "env_limited"
    });
  });

  it("classifies duckduckgo challenge and index shells as env-limited macro results", () => {
    const step = evaluateMacroCase({
      id: "provider.web.search.keyword",
      providerId: "web/default",
      args: ["macro-resolve", "--execute"]
    }, {
      status: 0,
      detail: "Macro resolved and executed.",
      json: {
        data: {
          execution: {
            records: [
              {
                id: "duckduckgo-challenge",
                url: "https://duckduckgo.com",
                title: "https://duckduckgo.com",
                content: "Unfortunately, bots use DuckDuckGo too. Please complete the following challenge.",
                attributes: {
                  retrievalPath: "web:search:index",
                  extractionQuality: {
                    contentChars: 78
                  }
                }
              },
              {
                id: "duckduckgo-index",
                url: "https://html.duckduckgo.com/html",
                title: "https://html.duckduckgo.com/html",
                content: "",
                attributes: {
                  retrievalPath: "web:search:index",
                  extractionQuality: {
                    contentChars: 0
                  }
                }
              }
            ],
            failures: [],
            meta: {
              providerOrder: ["web/default"]
            }
          }
        }
      }
    });

    expect(step.status).toBe("env_limited");
    expect(step.detail).toBe("shell_only_records=challenge_shell,search_shell");
    expect(step.data.shellOnlyReasons).toEqual(["challenge_shell", "search_shell"]);
  });

  it("classifies Reddit verification walls as env-limited community macro results", () => {
    const step = evaluateMacroCase({
      id: "provider.community.search.url",
      providerId: "community/default",
      args: ["macro-resolve", "--execute"]
    }, {
      status: 0,
      detail: "Macro resolved and executed.",
      json: {
        data: {
          execution: {
            records: [
              {
                id: "reddit-verification-wall",
                url: "https://www.reddit.com/answers/example?q=browser+automation",
                title: "https://www.reddit.com/answers/example?q=browser+automation",
                content: "Reddit - The heart of the internet. Please wait for verification. Skip to main content.",
                attributes: {
                  retrievalPath: "community:fetch:url"
                }
              }
            ],
            failures: [],
            meta: {
              providerOrder: ["community/default"]
            }
          }
        }
      }
    });

    expect(step.status).toBe("env_limited");
    expect(step.detail).toBe("shell_only_records=challenge_shell");
    expect(step.data.shellOnlyReasons).toEqual(["challenge_shell"]);
  });

  it("classifies X javascript-required shells as env-limited social macro results", () => {
    const step = evaluateMacroCase({
      id: "provider.social.x.search",
      providerId: "social/x",
      args: ["macro-resolve", "--execute"]
    }, {
      status: 0,
      detail: "Macro resolved and executed.",
      json: {
        data: {
          execution: {
            records: [
              {
                id: "x-js-shell",
                url: "https://x.com/search?q=browser+automation&f=live&page=1",
                title: "X search",
                content: "JavaScript is disabled in this browser. Please enable JavaScript.",
                attributes: {
                  retrievalPath: "social:search:index"
                }
              }
            ],
            failures: [],
            meta: {
              providerOrder: ["social/x"]
            }
          }
        }
      }
    });

    expect(step.status).toBe("env_limited");
    expect(step.detail).toBe("shell_only_records=social_js_required_shell");
    expect(step.data.shellOnlyReasons).toEqual(["social_js_required_shell"]);
  });

  it("keeps X macro rows as pass when warning text coexists with a usable X result link", () => {
    const step = evaluateMacroCase({
      id: "provider.social.x.search",
      providerId: "social/x",
      args: ["macro-resolve", "--execute"]
    }, {
      status: 0,
      detail: "Macro resolved and executed.",
      json: {
        data: {
          execution: {
            records: [
              {
                id: "x-mixed-search-record",
                url: "https://x.com/search?q=browser+automation&f=live&page=1",
                title: "X search",
                content: "JavaScript is disabled in this browser. Please enable JavaScript. Top Latest People Media Lists.",
                attributes: {
                  retrievalPath: "social:search:index",
                  links: [
                    "https://x.com/acct/status/1"
                  ]
                }
              }
            ],
            failures: [],
            meta: {
              providerOrder: ["social/x"]
            }
          }
        }
      }
    });

    expect(step.status).toBe("pass");
    expect(step.detail).toBeNull();
    expect(step.data.shellOnlyReasons).toEqual([]);
  });

  it("classifies live-like X policy and legal shells as env-limited macro results", () => {
    const step = evaluateMacroCase({
      id: "provider.social.x.search",
      providerId: "social/x",
      args: ["macro-resolve", "--execute"]
    }, {
      status: 0,
      detail: "Macro resolved and executed.",
      json: {
        data: {
          execution: {
            records: [
              {
                id: "x-search-shell",
                url: "https://x.com/search?q=browser+automation&f=live&page=1",
                title: "X search",
                content: "JavaScript is disabled in this browser. Please enable JavaScript. Something went wrong, but don't fret.",
                attributes: {
                  retrievalPath: "social:search:index",
                  links: [
                    "https://x.com/privacy",
                    "https://x.com/tos",
                    "https://t.co",
                    "https://help.x.com/using-x/x-supported-browsers"
                  ]
                }
              },
              {
                id: "x-legal-shell",
                url: "https://legal.x.com/de/imprint.html",
                title: "Legal",
                content: "Imprint",
                attributes: {
                  retrievalPath: "social:fetch:url"
                }
              }
            ],
            failures: [],
            meta: {
              providerOrder: ["social/x"]
            }
          }
        }
      }
    });

    expect(step.status).toBe("env_limited");
    expect(step.detail).toBe("shell_only_records=social_js_required_shell,social_first_party_help_shell");
    expect(step.data.shellOnlyReasons).toEqual(["social_js_required_shell", "social_first_party_help_shell"]);
  });

  it("classifies X metadata-only shells as env-limited macro results", () => {
    const step = evaluateMacroCase({
      id: "provider.social.x.search",
      providerId: "social/x",
      args: ["macro-resolve", "--execute"]
    }, {
      status: 0,
      detail: "Macro resolved and executed.",
      json: {
        data: {
          execution: {
            records: [
              {
                id: "x-search-shell",
                url: "https://x.com/search?q=browser+automation&f=live&page=1",
                title: "X search",
                content: "JavaScript is not available. We’ve detected that JavaScript is disabled in this browser.",
                attributes: {
                  retrievalPath: "social:search:index",
                  links: [
                    "https://x.com/os-x.xml",
                    "https://x.com/manifest.json",
                    "https://x.com/os-grok.xml",
                    "https://help.x.com/using-x/x-supported-browsers"
                  ]
                }
              }
            ],
            failures: [],
            meta: {
              providerOrder: ["social/x"]
            }
          }
        }
      }
    });

    expect(step.status).toBe("env_limited");
    expect(step.detail).toBe("shell_only_records=social_js_required_shell");
    expect(step.data.shellOnlyReasons).toEqual(["social_js_required_shell"]);
  });

  it("classifies Bluesky first-party docs shells as env-limited social macro results", () => {
    const step = evaluateMacroCase({
      id: "provider.social.bluesky.search",
      providerId: "social/bluesky",
      args: ["macro-resolve", "--execute"]
    }, {
      status: 0,
      detail: "Macro resolved and executed.",
      json: {
        data: {
          execution: {
            records: [
              {
                id: "bluesky-help-shell",
                url: "https://atproto.com/guides/overview",
                title: "AT Protocol",
                content: "Overview",
                attributes: {
                  retrievalPath: "social:fetch:url"
                }
              }
            ],
            failures: [],
            meta: {
              providerOrder: ["social/bluesky"]
            }
          }
        }
      }
    });

    expect(step.status).toBe("env_limited");
    expect(step.detail).toBe("shell_only_records=social_first_party_help_shell");
    expect(step.data.shellOnlyReasons).toEqual(["social_first_party_help_shell"]);
  });

  it("keeps Bluesky macro rows as pass when warning text coexists with a usable Bluesky result link", () => {
    const step = evaluateMacroCase({
      id: "provider.social.bluesky.search",
      providerId: "social/bluesky",
      args: ["macro-resolve", "--execute"]
    }, {
      status: 0,
      detail: "Macro resolved and executed.",
      json: {
        data: {
          execution: {
            records: [
              {
                id: "bluesky-mixed-search-record",
                url: "https://bsky.app/search?q=browser+automation&page=1",
                title: "Bluesky Search",
                content: "Bluesky JavaScript Required Top Latest.",
                attributes: {
                  retrievalPath: "social:search:index",
                  links: [
                    "https://bsky.app/profile/acct/post/1"
                  ]
                }
              }
            ],
            failures: [],
            meta: {
              providerOrder: ["social/bluesky"]
            }
          }
        }
      }
    });

    expect(step.status).toBe("pass");
    expect(step.detail).toBeNull();
    expect(step.data.shellOnlyReasons).toEqual([]);
  });

  it("classifies Bluesky feed-only js-required search shells as env-limited macro results", () => {
    const step = evaluateMacroCase({
      id: "provider.social.bluesky.search",
      providerId: "social/bluesky",
      args: ["macro-resolve", "--execute"]
    }, {
      status: 0,
      detail: "Macro resolved and executed.",
      json: {
        data: {
          execution: {
            records: [
              {
                id: "bluesky-feed-only-shell",
                url: "https://bsky.app/search?q=browser+automation&page=1",
                title: "Bluesky Search",
                content: "Bluesky JavaScript Required Top Latest.",
                attributes: {
                  retrievalPath: "social:search:index",
                  links: [
                    "https://bsky.app/profile/trending.bsky.app/feed/665497821"
                  ]
                }
              }
            ],
            failures: [],
            meta: {
              providerOrder: ["social/bluesky"]
            }
          }
        }
      }
    });

    expect(step.status).toBe("env_limited");
    expect(step.detail).toBe("shell_only_records=social_js_required_shell");
    expect(step.data.shellOnlyReasons).toEqual(["social_js_required_shell"]);
  });

  it("classifies logged-out Bluesky search and help shells as env-limited macro results", () => {
    const step = evaluateMacroCase({
      id: "provider.social.bluesky.search",
      providerId: "social/bluesky",
      args: ["macro-resolve", "--execute"]
    }, {
      status: 0,
      detail: "Macro resolved and executed.",
      json: {
        data: {
          execution: {
            records: [
              {
                id: "bluesky-search-shell",
                url: "https://bsky.app/search?q=browser+automation&page=1",
                title: "Explore - Bluesky",
                content: "Search is currently unavailable when logged out. Bluesky JavaScript Required.",
                attributes: {
                  retrievalPath: "social:search:index",
                  links: [
                    "https://bsky.app/profile/trending.bsky.app/feed/665497821",
                    "https://blueskyweb.zendesk.com/hc/en-us"
                  ]
                }
              },
              {
                id: "bluesky-help-shell",
                url: "https://blueskyweb.zendesk.com/hc/en-us",
                title: "Bluesky Help",
                content: "Help center",
                attributes: {
                  retrievalPath: "social:fetch:url"
                }
              }
            ],
            failures: [],
            meta: {
              providerOrder: ["social/bluesky"]
            }
          }
        }
      }
    });

    expect(step.status).toBe("env_limited");
    expect(step.detail).toBe("shell_only_records=social_js_required_shell,social_first_party_help_shell");
    expect(step.data.shellOnlyReasons).toEqual(["social_js_required_shell", "social_first_party_help_shell"]);
  });

  it("classifies signed-in Bluesky empty search shells with nav-only links as env-limited macro results", () => {
    const step = evaluateMacroCase({
      id: "provider.social.bluesky.search",
      providerId: "social/bluesky",
      args: ["macro-resolve", "--execute"]
    }, {
      status: 0,
      detail: "Macro resolved and executed.",
      json: {
        data: {
          execution: {
            records: [
              {
                id: "bluesky-empty-search-shell",
                url: "https://bsky.app/search?page=1&q=browser+automation+bluesky",
                title: "bluesky search: browser automation bluesky",
                content: "All languages Top Latest People Feeds Home Explore Notifications Chat Feeds Lists Saved Profile Settings New Post Discover Following Video More feeds Follow 10 people to get started Find people to follow Trending 1. 2. 3. 4. 5.",
                attributes: {
                  retrievalPath: "social:search:index",
                  links: [
                    "https://bsky.app/notifications",
                    "https://bsky.app/messages",
                    "https://bsky.app/feeds",
                    "https://bsky.app/lists",
                    "https://bsky.app/saved",
                    "https://bsky.app/profile/freshtechbro.bsky.social",
                    "https://bsky.app/settings"
                  ]
                }
              }
            ],
            failures: [],
            meta: {
              providerOrder: ["social/bluesky"]
            }
          }
        }
      }
    });

    expect(step.status).toBe("env_limited");
    expect(step.detail).toBe("shell_only_records=social_render_shell");
    expect(step.data.shellOnlyReasons).toEqual(["social_render_shell"]);
  });

  it("classifies signed-in Bluesky navigation-only search shells with only profile and shell links as env-limited macro results", () => {
    const step = evaluateMacroCase({
      id: "provider.social.bluesky.search",
      providerId: "social/bluesky",
      args: ["macro-resolve", "--execute"]
    }, {
      status: 0,
      detail: "Macro resolved and executed.",
      json: {
        data: {
          execution: {
            records: [
              {
                id: "bluesky-nav-shell",
                url: "https://bsky.app/search?page=1&q=browser+automation+bluesky",
                title: "bluesky search: browser automation bluesky",
                content: "All languages Top Latest People Feeds Home Explore Notifications Chat Feeds Lists Saved Profile Settings New Post Feedback Privacy Terms Help",
                attributes: {
                  retrievalPath: "social:search:index",
                  links: [
                    "https://bsky.app/notifications",
                    "https://bsky.app/messages",
                    "https://bsky.app/feeds",
                    "https://bsky.app/lists",
                    "https://bsky.app/saved",
                    "https://bsky.app/profile/freshtechbro.bsky.social",
                    "https://bsky.app/settings"
                  ]
                }
              }
            ],
            failures: [],
            meta: {
              providerOrder: ["social/bluesky"]
            }
          }
        }
      }
    });

    expect(step.status).toBe("env_limited");
    expect(step.detail).toBe("shell_only_records=social_render_shell");
    expect(step.data.shellOnlyReasons).toEqual(["social_render_shell"]);
  });

  it("classifies Reddit non-content route shells as env-limited social macro results", () => {
    const step = evaluateMacroCase({
      id: "provider.social.reddit.search",
      providerId: "social/reddit",
      args: ["macro-resolve", "--execute"]
    }, {
      status: 0,
      detail: "Macro resolved and executed.",
      json: {
        data: {
          execution: {
            records: [
              {
                id: "reddit-submit-shell",
                url: "https://www.reddit.com/submit",
                title: "Submit to Reddit",
                content: "Submit to Reddit",
                attributes: {
                  retrievalPath: "social:fetch:url"
                }
              }
            ],
            failures: [],
            meta: {
              providerOrder: ["social/reddit"]
            }
          }
        }
      }
    });

    expect(step.status).toBe("env_limited");
    expect(step.detail).toBe("shell_only_records=social_render_shell");
    expect(step.data.shellOnlyReasons).toEqual(["social_render_shell"]);
  });

  it("classifies Reddit trailing-slash search routes as env-limited social macro results", () => {
    const step = evaluateMacroCase({
      id: "provider.social.reddit.search",
      providerId: "social/reddit",
      args: ["macro-resolve", "--execute"]
    }, {
      status: 0,
      detail: "Macro resolved and executed.",
      json: {
        data: {
          execution: {
            records: [{
              id: "reddit-search-shell",
              url: "https://www.reddit.com/search/?q=browser+automation",
              title: "Reddit Search",
              content: "Search Reddit",
              attributes: {
                retrievalPath: "social:search:index"
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

    expect(step.status).toBe("env_limited");
    expect(step.detail).toBe("shell_only_records=social_render_shell");
    expect(step.data.shellOnlyReasons).toEqual(["social_render_shell"]);
  });

  it("classifies Facebook search-only shells as env-limited social macro results", () => {
    const step = evaluateMacroCase({
      id: "provider.social.facebook.search",
      providerId: "social/facebook",
      args: ["macro-resolve", "--execute"]
    }, {
      status: 0,
      detail: "Macro resolved and executed.",
      json: {
        data: {
          execution: {
            records: [
              {
                id: "facebook-search-shell",
                url: "https://www.facebook.com/watch/search/?q=browser+automation&page=1",
                title: "browser automation videos | Facebook",
                content: "Search results",
                attributes: {
                  links: [
                    "https://www.facebook.com/watch/search/?q=browser+automation",
                    "https://www.facebook.com/watch"
                  ],
                  retrievalPath: "social:search:index"
                }
              }
            ],
            failures: [],
            meta: {
              providerOrder: ["social/facebook"]
            }
          }
        }
      }
    });

    expect(step.status).toBe("env_limited");
    expect(step.detail).toBe("shell_only_records=social_render_shell");
    expect(step.data.shellOnlyReasons).toEqual(["social_render_shell"]);
  });

  it("classifies Facebook support-only search pages as env-limited social macro results", () => {
    const step = evaluateMacroCase({
      id: "provider.social.facebook.search",
      providerId: "social/facebook",
      args: ["macro-resolve", "--execute"]
    }, {
      status: 0,
      detail: "Macro resolved and executed.",
      json: {
        data: {
          execution: {
            records: [
              {
                id: "facebook-support-shell",
                url: "https://www.facebook.com/watch/search/?q=browser+automation&page=1",
                title: "browser automation videos | Facebook",
                content: "Search results Shared with Public",
                attributes: {
                  links: [
                    "https://www.facebook.com/browserautomation",
                    "https://m.facebook.com/opendevbrowser"
                  ],
                  retrievalPath: "social:search:index"
                }
              }
            ],
            failures: [],
            meta: {
              providerOrder: ["social/facebook"]
            }
          }
        }
      }
    });

    expect(step.status).toBe("env_limited");
    expect(step.detail).toBe("shell_only_records=social_render_shell");
    expect(step.data.shellOnlyReasons).toEqual(["social_render_shell"]);
  });

  it("classifies Threads trailing-slash search shells as env-limited social macro results", () => {
    const step = evaluateMacroCase({
      id: "provider.social.threads.search",
      providerId: "social/threads",
      args: ["macro-resolve", "--execute"]
    }, {
      status: 0,
      detail: "Macro resolved and executed.",
      json: {
        data: {
          execution: {
            records: [
              {
                id: "threads-search-shell",
                url: "https://www.threads.net/search/?q=browser+automation&page=1",
                title: "Threads search",
                content: "Search results",
                attributes: {
                  links: [
                    "https://www.threads.net/",
                    "https://www.threads.net/login/"
                  ],
                  retrievalPath: "social:search:index"
                }
              }
            ],
            failures: [],
            meta: {
              providerOrder: ["social/threads"]
            }
          }
        }
      }
    });

    expect(step.status).toBe("env_limited");
    expect(step.detail).toBe("shell_only_records=social_render_shell");
    expect(step.data.shellOnlyReasons).toEqual(["social_render_shell"]);
  });

  it("keeps Threads macro rows as pass when a usable post link survives shell detection", () => {
    const step = evaluateMacroCase({
      id: "provider.social.threads.search",
      providerId: "social/threads",
      args: ["macro-resolve", "--execute"]
    }, {
      status: 0,
      detail: "Macro resolved and executed.",
      json: {
        data: {
          execution: {
            records: [
              {
                id: "threads-search-with-post",
                url: "https://www.threads.net/search/?q=browser+automation&page=1",
                title: "Threads search",
                content: "Search results",
                attributes: {
                  links: ["https://www.threads.net/@opendevbrowser/post/ABC123"],
                  retrievalPath: "social:search:index"
                }
              }
            ],
            failures: [],
            meta: {
              providerOrder: ["social/threads"]
            }
          }
        }
      }
    });

    expect(step.status).toBe("pass");
    expect(step.detail).toBeNull();
    expect(step.data.shellOnlyReasons).toEqual([]);
  });

  it("classifies deferred auth walls as env-limited social macro results even when expansion returned records", () => {
    const step = evaluateMacroCase({
      id: "provider.social.facebook.search",
      providerId: "social/facebook",
      args: ["macro-resolve", "--execute"]
    }, {
      status: 0,
      detail: "Macro resolved and executed.",
      json: {
        data: {
          execution: {
            records: [
              {
                id: "facebook-search-shell",
                url: "https://www.facebook.com/watch/search/?q=browser+automation&page=1",
                title: "browser automation videos | Facebook",
                content: "Top results",
                attributes: {
                  retrievalPath: "social:search:index"
                }
              },
              {
                id: "facebook-content-record",
                url: "https://www.facebook.com/reel/123456789",
                title: "Browser automation reel",
                content: "Shared reel content.",
                attributes: {
                  retrievalPath: "social:fetch:url"
                }
              }
            ],
            failures: [],
            meta: {
              providerOrder: ["social/facebook"],
              challengeOrchestration: {
                status: "deferred",
                classification: "auth_required",
                verification: {
                  bundle: {
                    continuity: {
                      likelyLoginPage: true,
                      likelyHumanVerification: false,
                      loginRefs: ["r2"],
                      checkpointRefs: []
                    }
                  }
                }
              }
            }
          }
        }
      }
    });

    expect(step.status).toBe("env_limited");
    expect(step.detail).toBe("deferred_auth_wall_only");
    expect(step.data.shellOnlyReasons).toEqual([]);
  });

  it("keeps deferred social macro rows as pass when continuity does not show a preserved auth wall", () => {
    const step = evaluateMacroCase({
      id: "provider.social.facebook.search",
      providerId: "social/facebook",
      args: ["macro-resolve", "--execute"]
    }, {
      status: 0,
      detail: "Macro resolved and executed.",
      json: {
        data: {
          execution: {
            records: [
              {
                id: "facebook-content-record",
                url: "https://www.facebook.com/reel/123456789",
                title: "Browser automation reel",
                content: "Shared reel content.",
                attributes: {
                  retrievalPath: "social:fetch:url"
                }
              }
            ],
            failures: [],
            meta: {
              providerOrder: ["social/facebook"],
              challengeOrchestration: {
                status: "deferred",
                classification: "auth_required",
                verification: {
                  bundle: {
                    continuity: {
                      likelyLoginPage: false,
                      likelyHumanVerification: false,
                      loginRefs: [],
                      checkpointRefs: []
                    }
                  }
                }
              }
            }
          }
        }
      }
    });

    expect(step.status).toBe("pass");
    expect(step.detail).toBeNull();
    expect(step.data.shellOnlyReasons).toEqual([]);
  });

  it("keeps community macro passes when a Reddit verification wall appears with a usable record", () => {
    const step = evaluateMacroCase({
      id: "provider.community.search.keyword",
      providerId: "community/default",
      args: ["macro-resolve", "--execute"]
    }, {
      status: 0,
      detail: "Macro resolved and executed.",
      json: {
        data: {
          execution: {
            records: [
              {
                id: "reddit-verification-wall",
                url: "https://www.reddit.com/answers/example?q=browser+automation",
                title: "https://www.reddit.com/answers/example?q=browser+automation",
                content: "Reddit - The heart of the internet. Please wait for verification. Skip to main content.",
                attributes: {
                  retrievalPath: "community:fetch:url"
                }
              },
              {
                id: "usable-community-record",
                url: "https://forum.example.com/t/browser-automation-checklist",
                title: "Browser automation checklist",
                content: "A working checklist for diagnosing browser automation failures across real sites.",
                attributes: {
                  retrievalPath: "community:search:index",
                  extractionQuality: {
                    contentChars: 79
                  }
                }
              }
            ],
            failures: [],
            meta: {
              providerOrder: ["community/default"]
            }
          }
        }
      }
    });

    expect(step.status).toBe("pass");
    expect(step.data.shellOnlyReasons).toEqual([]);
  });

  it("fails fetch macros that only return truncated page chrome", () => {
    const step = evaluateMacroCase({
      id: "provider.web.fetch.url",
      providerId: "web/default",
      args: ["macro-resolve", "--execute"]
    }, {
      status: 0,
      detail: "Macro resolved and executed.",
      json: {
        data: {
          execution: {
            records: [
              {
                id: "mdn-fetch",
                url: "https://developer.mozilla.org/en-US/docs/Web/API/Document/querySelector",
                title: "Document: querySelector() method - Web APIs | MDN",
                content: "\"The",
                attributes: {
                  links: Array.from({ length: 32 }, (_, index) => `https://example.com/${index}`),
                  extractionQuality: {
                    contentChars: 4
                  }
                }
              }
            ],
            failures: [],
            meta: {
              providerOrder: ["web/default"],
              provenance: {
                retrievalPath: "fetch:developer.mozilla.org"
              }
            }
          }
        }
      }
    });

    expect(step.status).toBe("fail");
    expect(step.detail).toBe("shell_only_records=truncated_fetch_shell");
    expect(step.data.shellOnlyReasons).toEqual(["truncated_fetch_shell"]);
  });

  it("classifies non-zero challenge and search shell failures as env-limited", () => {
    const step = evaluateMacroCase({
      id: "provider.web.search.keyword",
      providerId: "web/default",
      args: ["macro-resolve", "--execute"]
    }, {
      status: 1,
      detail: "Macro execution returned only shell records (challenge_shell,search_shell).",
      json: null
    });

    expect(step.status).toBe("env_limited");
    expect(step.detail).toBe("shell_only_records=challenge_shell,search_shell");
    expect(step.data.shellOnlyReasons).toEqual(["challenge_shell", "search_shell"]);
  });

  it("classifies non-zero social verification shell failures as env-limited", () => {
    const step = evaluateMacroCase({
      id: "provider.social.reddit.search",
      providerId: "social/reddit",
      args: ["macro-resolve", "--execute"]
    }, {
      status: 1,
      detail: "Macro execution returned only shell records (social_verification_wall).",
      json: null
    });

    expect(step.status).toBe("env_limited");
    expect(step.detail).toBe("shell_only_records=social_verification_wall");
    expect(step.data.shellOnlyReasons).toEqual(["social_verification_wall"]);
  });

  it("keeps non-zero community challenge detail blocking despite structured payload", () => {
    const step = evaluateMacroCase({
      id: "provider.community.search.keyword",
      providerId: "community/default",
      args: ["macro-resolve", "--execute"]
    }, {
      status: 1,
      detail: "Detected anti-bot challenge while retrieving https://www.reddit.com/search/?q=browser+automation+failures",
      json: {
        data: {
          execution: {
            records: [],
            failures: [
              {
                error: {
                  code: "unavailable",
                  reasonCode: "challenge_detected",
                  details: {
                    browserFallbackReasonCode: "challenge_detected"
                  }
                }
              }
            ],
            meta: {
              providerOrder: ["community/default"]
            }
          }
        }
      }
    });

    expect(step.status).toBe("fail");
    expect(step.detail).toBe("Detected anti-bot challenge while retrieving https://www.reddit.com/search/?q=browser+automation+failures");
    expect(step.data).toMatchObject({
      reasonCodes: ["challenge_detected"],
      failureSamples: [
        {
          code: "unavailable",
          reasonCode: "challenge_detected"
        }
      ],
      browserFallbackReasonCode: "challenge_detected"
    });
  });

  it("keeps non-zero truncated fetch shell failures blocking", () => {
    const step = evaluateMacroCase({
      id: "provider.web.fetch.url",
      providerId: "web/default",
      args: ["macro-resolve", "--execute"]
    }, {
      status: 1,
      detail: "Macro execution returned only shell records (truncated_fetch_shell).",
      json: null
    });

    expect(step.status).toBe("fail");
    expect(step.detail).toBe("shell_only_records=truncated_fetch_shell");
    expect(step.data.shellOnlyReasons).toEqual(["truncated_fetch_shell"]);
  });

  it("keeps mixed non-zero shell failures blocking", () => {
    const step = evaluateMacroCase({
      id: "provider.web.fetch.url",
      providerId: "web/default",
      args: ["macro-resolve", "--execute"]
    }, {
      status: 1,
      detail: "Macro execution returned only shell records (challenge_shell,truncated_fetch_shell).",
      json: null
    });

    expect(step.status).toBe("fail");
    expect(step.detail).toBe("shell_only_records=challenge_shell,truncated_fetch_shell");
    expect(step.data.shellOnlyReasons).toEqual(["challenge_shell", "truncated_fetch_shell"]);
  });

  it("classifies youtube search chrome as env-limited when the provider emits a structured boundary failure", () => {
    const step = evaluateMacroCase({
      id: "provider.social.youtube.search",
      providerId: "social/youtube",
      args: ["macro-resolve", "--execute"]
    }, {
      status: 0,
      detail: "Macro resolved and executed.",
      json: {
        data: {
          execution: {
            records: [],
            failures: [
              {
                provider: "social/youtube",
                source: "social",
                error: {
                  code: "unavailable",
                  reasonCode: "env_limited",
                  details: {
                    providerShell: "youtube_search_shell",
                    browserRequired: true
                  }
                }
              }
            ],
            meta: {
              providerOrder: ["social/youtube"]
            }
          }
        }
      }
    });

    expect(step.status).toBe("env_limited");
    expect(step.detail).toBe("reason_codes=env_limited");
    expect(step.data.shellOnlyReasons).toEqual([]);
  });

  it("classifies YouTube site chrome shell records with a provider-specific reason", () => {
    const step = evaluateMacroCase({
      id: "provider.social.youtube.search",
      providerId: "social/youtube",
      args: ["macro-resolve", "--execute"]
    }, {
      status: 0,
      detail: "Macro resolved and executed.",
      json: {
        data: {
          execution: {
            records: [{
              id: "youtube-site-chrome",
              url: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
              title: "YouTube",
              content: "About Press Copyright Contact us Creators Advertise Developers Terms Privacy Policy",
              attributes: {
                retrievalPath: "social:fetch:url"
              }
            }],
            failures: [],
            meta: {
              providerOrder: ["social/youtube"]
            }
          }
        }
      }
    });

    expect(step.status).toBe("env_limited");
    expect(step.detail).toBe("shell_only_records=youtube_site_chrome_shell");
    expect(step.data.shellOnlyReasons).toEqual(["youtube_site_chrome_shell"]);
  });

  it("keeps macro passes when at least one usable record survives the shell gate", () => {
    const step = evaluateMacroCase({
      id: "provider.web.search.keyword",
      providerId: "web/default",
      args: ["macro-resolve", "--execute"]
    }, {
      status: 0,
      detail: "Macro resolved and executed.",
      json: {
        data: {
          execution: {
            records: [
              {
                id: "duckduckgo-shell",
                url: "https://html.duckduckgo.com/html",
                title: "https://html.duckduckgo.com/html",
                content: "",
                attributes: {
                  retrievalPath: "web:search:index",
                  extractionQuality: {
                    contentChars: 0
                  }
                }
              },
              {
                id: "usable-doc",
                url: "https://developer.mozilla.org/en-US/docs/Web/API/Document/querySelector",
                title: "Document: querySelector() method - Web APIs | MDN",
                content: "Returns the first matching element within the document using CSS selectors.",
                attributes: {
                  retrievalPath: "web:search:index",
                  extractionQuality: {
                    contentChars: 79
                  }
                }
              }
            ],
            failures: [],
            meta: {
              providerOrder: ["web/default"]
            }
          }
        }
      }
    });

    expect(step.status).toBe("pass");
    expect(step.data.shellOnlyReasons).toEqual([]);
  });

  it("keeps macro passes when surviving web search records use canonical urls as titles", () => {
    const step = evaluateMacroCase({
      id: "provider.web.search.keyword",
      providerId: "web/default",
      args: ["macro-resolve", "--execute"]
    }, {
      status: 0,
      detail: "Macro resolved and executed.",
      json: {
        data: {
          execution: {
            records: [
              {
                id: "duckduckgo-shell",
                url: "https://html.duckduckgo.com/html",
                title: "https://html.duckduckgo.com/html",
                content: "query at DuckDuckGo",
                attributes: {
                  retrievalPath: "web:search:index",
                  extractionQuality: {
                    contentChars: 700
                  }
                }
              },
              {
                id: "usable-doc",
                url: "https://developer.chrome.com/docs/extensions/reference/api/debugger",
                title: "https://developer.chrome.com/docs/extensions/reference/api/debugger",
                content: "",
                attributes: {
                  retrievalPath: "web:search:index",
                  extractionQuality: {
                    contentChars: 0
                  }
                }
              }
            ],
            failures: [],
            meta: {
              providerOrder: ["web/default"]
            }
          }
        }
      }
    });

    expect(step.status).toBe("pass");
    expect(step.data.shellOnlyReasons).toEqual([]);
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
