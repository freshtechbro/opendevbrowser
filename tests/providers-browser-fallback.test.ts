import { describe, expect, it, vi } from "vitest";
import {
  browserFallbackObservationDetails,
  fallbackDispositionMessage,
  readFallbackString,
  resolveProviderBrowserFallback,
  resolveProviderFallbackModes,
  toCompletedFallbackOutputError,
  toProviderFallbackError
} from "../src/providers/browser-fallback";
import { resolveProviderRuntimePolicy } from "../src/providers/runtime-policy";
import type { BrowserFallbackPort, BrowserFallbackResponse, ProviderContext } from "../src/providers/types";

describe("provider browser fallback helpers", () => {
  it("reads fallback strings and prefers explicit detail messages", () => {
    expect(readFallbackString({ html: "<html />", url: "https://example.com" }, "html")).toBe("<html />");
    expect(readFallbackString({ html: "<html />", url: "https://example.com" }, "url")).toBe("https://example.com");
    expect(readFallbackString({ html: "" }, "html")).toBeUndefined();
    expect(readFallbackString({ html: "   ", url: " https://example.com/path " }, "html")).toBeUndefined();
    expect(readFallbackString({ url: " https://example.com/path " }, "url")).toBe("https://example.com/path");
    expect(readFallbackString(undefined, "url")).toBeUndefined();

    expect(fallbackDispositionMessage({
      ok: false,
      reasonCode: "challenge_detected",
      disposition: "challenge_preserved",
      details: {
        message: "Complete the checkpoint"
      }
    }, "https://example.com")).toBe("Complete the checkpoint");

    expect(fallbackDispositionMessage({
      ok: false,
      reasonCode: "challenge_detected",
      disposition: "challenge_preserved"
    }, "https://example.com")).toBe("Browser fallback preserved a challenge session for https://example.com");

    expect(fallbackDispositionMessage({
      ok: false,
      reasonCode: "env_limited",
      disposition: "deferred"
    }, "https://example.com")).toBe("Browser fallback deferred recovery for https://example.com");

    expect(fallbackDispositionMessage({
      ok: false,
      reasonCode: "ip_blocked",
      disposition: "failed"
    }, "https://example.com")).toBe("Browser fallback failed for https://example.com");
  });

  it("converts preserved fallback results into normalized provider errors", () => {
    const fallback: BrowserFallbackResponse = {
      ok: false,
      reasonCode: "rate_limited",
      disposition: "challenge_preserved",
      mode: "extension",
      preservedSessionId: "session-1",
      preservedTargetId: "target-1",
      challenge: {
        challengeId: "challenge-1",
        blockerType: "anti_bot_challenge",
        ownerSurface: "provider_fallback",
        resumeMode: "auto",
        status: "active",
        updatedAt: "2026-03-22T00:00:00.000Z",
        timeline: [
          {
            at: "2026-03-22T00:00:00.000Z",
            event: "claimed",
            status: "active"
          }
        ]
      },
      details: {
        message: " ",
        nested: {
          keep: true,
          drop: undefined,
          symbol: Symbol("ignored")
        } as never,
        entries: [1, undefined, { okay: "yes" }, Symbol("ignored")] as never
      }
    };

    const error = toProviderFallbackError({
      provider: "shopping/amazon",
      source: "shopping",
      url: "https://example.com/item",
      fallback
    });

    expect(error.code).toBe("rate_limited");
    expect(error.retryable).toBe(true);
    expect(error.message).toBe("Browser fallback preserved a challenge session for https://example.com/item");
    expect(error.reasonCode).toBe("rate_limited");
    expect(error.details).toMatchObject({
      url: "https://example.com/item",
      disposition: "challenge_preserved",
      browserFallbackMode: "extension",
      preservedSessionId: "session-1",
      preservedTargetId: "target-1",
      challenge: {
        challengeId: "challenge-1"
      },
      nested: {
        keep: true
      },
      entries: [1, { okay: "yes" }],
      reasonCode: "rate_limited",
      guidance: {
        reason: "Amazon preserved browser state that can complete the current challenge.",
        recommendedNextCommands: [
          "Finish the login or anti-bot challenge in the preserved browser session.",
          "Rerun the same provider or workflow after the page unlocks."
        ]
      }
    });
  });

  it("keeps non-rate-limited fallback errors non-retryable", () => {
    const error = toProviderFallbackError({
      provider: "social/youtube",
      source: "social",
      url: "https://example.com/video",
      fallback: {
        ok: false,
        reasonCode: "auth_required",
        disposition: "failed",
        mode: "managed_headed",
        details: {}
      }
    });

    expect(error.retryable).toBe(false);
    expect(error.reasonCode).toBe("auth_required");
    expect(error.details).toMatchObject({
      disposition: "failed",
      browserFallbackMode: "managed_headed",
      url: "https://example.com/video",
      guidance: {
        reason: "Youtube needs an authenticated session before retrying.",
        recommendedNextCommands: [
          "Reuse a user-authorized signed-in browser session, load cookies only from that authorized session, or use the provider sign-in flow.",
          "Rerun the same provider or workflow once the session is active."
        ]
      }
    });
  });

  it("uses public sanitized request URLs in provider fallback errors", () => {
    const rawUrl = "https://accounts.google.com/o/oauth2/v2/auth?login_hint=alice@example.com&state=private-state";
    const error = toProviderFallbackError({
      provider: "web/google-oauth",
      source: "web",
      url: rawUrl,
      fallback: {
        ok: false,
        reasonCode: "auth_required",
        disposition: "failed",
        output: {
          url: "https://accounts.google.com/"
        },
        details: {
          url: rawUrl
        }
      }
    });

    expect(error.message).toBe("Browser fallback failed for https://accounts.google.com/");
    expect(error.details).toMatchObject({
      url: "https://accounts.google.com/",
      disposition: "failed"
    });
    const serialized = JSON.stringify(error);
    expect(serialized).not.toContain("alice@example.com");
    expect(serialized).not.toContain("private-state");
    expect(serialized).not.toContain("login_hint=");
  });

  it("redacts raw Google fallback detail messages without fallback output URLs", () => {
    const rawUrl = "https://accounts.google.com/o/oauth2/v2/auth?login_hint=alice@example.com&state=private-state";
    const error = toProviderFallbackError({
      provider: "web/google-oauth",
      source: "web",
      url: rawUrl,
      fallback: {
        ok: false,
        reasonCode: "auth_required",
        disposition: "challenge_preserved",
        challenge: {
          challengeId: "google-challenge",
          blockerType: "auth_required",
          ownerSurface: "provider_fallback",
          resumeMode: "auto",
          suspendedIntent: {
            kind: "provider.fetch",
            input: {
              url: rawUrl,
              query: "alice@example.com private-state",
              accessToken: "secret-access-token"
            }
          },
          status: "active",
          updatedAt: "2026-06-26T00:00:00.000Z"
        },
        details: {
          message: `Browser fallback stopped at ${rawUrl} for alice@example.com with state private-state`,
          access_token: "secret-access-token",
          idToken: "secret-id-token",
          tokenMessage: "failed with access_token=free-secret access_token: colon-secret \"id_token\":\"json-secret\" refreshToken=camel-refresh clientSecret: \"camel-client\" Authorization: Bearer bearer-secret",
          authorization: {
            header: "Bearer nested-bearer-secret",
            nested: {
              label: "nested-label"
            }
          },
          token: {
            value: "parent-token-secret"
          },
          nested: {
            requestedUrl: rawUrl,
            state: "private-state",
            contact: "alice@example.com"
          }
        }
      }
    });

    expect(error.message).toBe("Browser fallback stopped at https://accounts.google.com/ for [REDACTED] with state [REDACTED]");
    expect(error.details).toMatchObject({
      url: "https://accounts.google.com/",
      message: "Browser fallback stopped at https://accounts.google.com/ for [REDACTED] with state [REDACTED]",
      access_token: "[REDACTED]",
      idToken: "[REDACTED]",
      tokenMessage: "failed with access_token=[REDACTED] access_token: [REDACTED] \"id_token\":\"[REDACTED]\" refreshToken=[REDACTED] clientSecret: \"[REDACTED]\" Authorization: Bearer [REDACTED]",
      authorization: {
        header: "[REDACTED]",
        nested: {
          label: "[REDACTED]"
        }
      },
      token: {
        value: "[REDACTED]"
      },
      nested: {
        requestedUrl: "https://accounts.google.com/",
        state: "[REDACTED]",
        contact: "[REDACTED]"
      },
      challenge: {
        suspendedIntent: {
          input: {
            url: "https://accounts.google.com/",
            query: "[REDACTED] [REDACTED]",
            accessToken: "[REDACTED]"
          }
        }
      }
    });
    const serialized = JSON.stringify(error);
    expect(serialized).not.toContain("alice@example.com");
    expect(serialized).not.toContain("private-state");
    expect(serialized).not.toContain("secret-access-token");
    expect(serialized).not.toContain("secret-id-token");
    expect(serialized).not.toContain("free-secret");
    expect(serialized).not.toContain("free-refresh");
    expect(serialized).not.toContain("colon-secret");
    expect(serialized).not.toContain("json-secret");
    expect(serialized).not.toContain("camel-refresh");
    expect(serialized).not.toContain("camel-client");
    expect(serialized).not.toContain("bearer-secret");
    expect(serialized).not.toContain("parent-token-secret");
    expect(serialized).not.toContain("login_hint=");
  });

  it("redacts email-bearing fallback URLs without OAuth parameter names", () => {
    const rawUrl = "https://example.com/callback?email=alice@example.com";
    const error = toProviderFallbackError({
      provider: "web/default",
      source: "web",
      url: rawUrl,
      fallback: {
        ok: false,
        reasonCode: "auth_required",
        disposition: "failed",
        details: {
          message: `Browser fallback failed for ${rawUrl}`
        }
      }
    });

    expect(error.message).toBe("Browser fallback failed for https://example.com/callback");
    expect(error.details).toMatchObject({
      url: "https://example.com/callback",
      message: "Browser fallback failed for https://example.com/callback"
    });
    expect(JSON.stringify(error)).not.toContain("alice@example.com");
    expect(JSON.stringify(error)).not.toContain("email=");
  });

  it("redacts malformed email-bearing fallback URL strings", () => {
    const rawUrl = "not a url alice@example.com";
    const error = toProviderFallbackError({
      provider: "web/default",
      source: "web",
      url: rawUrl,
      fallback: {
        ok: false,
        reasonCode: "auth_required",
        disposition: "failed"
      }
    });

    expect(error.message).toBe("Browser fallback failed for not a url [REDACTED]");
    expect(error.details).toMatchObject({
      url: "not a url [REDACTED]"
    });
    expect(JSON.stringify(error)).not.toContain("alice@example.com");
  });

  it("redacts sensitive non-http fallback URL schemes", () => {
    const rawUrl = "chrome-extension://abc/callback?access_token=scheme-secret";
    const error = toProviderFallbackError({
      provider: "web/default",
      source: "web",
      url: rawUrl,
      fallback: {
        ok: false,
        reasonCode: "auth_required",
        disposition: "failed"
      }
    });

    expect(error.message).toBe("Browser fallback failed for chrome-extension:redacted_url");
    expect(error.details).toMatchObject({
      url: "chrome-extension:redacted_url"
    });
    expect(JSON.stringify(error)).not.toContain("scheme-secret");
  });

  it("redacts sensitive about fallback URLs", () => {
    const rawUrl = "about:blank?access_token=about-secret";
    const error = toProviderFallbackError({
      provider: "web/default",
      source: "web",
      url: rawUrl,
      fallback: {
        ok: false,
        reasonCode: "auth_required",
        disposition: "failed"
      }
    });

    expect(error.message).toBe("Browser fallback failed for about:redacted_url");
    expect(error.details).toMatchObject({
      url: "about:redacted_url"
    });
    expect(JSON.stringify(error)).not.toContain("about-secret");
  });

  it("preserves malformed non-sensitive fallback URL strings", () => {
    const rawUrl = "not a url without secrets";
    const error = toProviderFallbackError({
      provider: "web/default",
      source: "web",
      url: rawUrl,
      fallback: {
        ok: false,
        reasonCode: "env_limited",
        disposition: "failed"
      }
    });

    expect(error.message).toBe(`Browser fallback failed for ${rawUrl}`);
    expect(error.details).toMatchObject({
      url: rawUrl
    });
  });

  it("uses nested OAuth URLs as sensitive-value context for fallback details", () => {
    const nestedUrl = "https://login.example.com/oauth/authorize?client_id=client-1&state=nested-state&code=nested-code";
    const error = toProviderFallbackError({
      provider: "web/default",
      source: "web",
      url: "https://example.com/start",
      fallback: {
        ok: false,
        reasonCode: "auth_required",
        disposition: "failed",
        details: {
          message: `OAuth failed with state nested-state and code nested-code after ${nestedUrl}`,
          nestedUrl
        }
      }
    });

    expect(error.message).toBe("OAuth failed with state [REDACTED] and code [REDACTED] after https://login.example.com/oauth/authorize");
    expect(error.details).toMatchObject({
      url: "https://example.com/start",
      nestedUrl: "https://login.example.com/oauth/authorize",
      message: "OAuth failed with state [REDACTED] and code [REDACTED] after https://login.example.com/oauth/authorize"
    });
    const serialized = JSON.stringify(error);
    expect(serialized).not.toContain("nested-state");
    expect(serialized).not.toContain("nested-code");
    expect(serialized).not.toContain("client_id=");
  });

  it("preserves ordinary non-OAuth code and state query parameters", () => {
    const rawUrl = "https://example.com/docs?code=typescript&state=CA";
    const error = toProviderFallbackError({
      provider: "web/default",
      source: "web",
      url: rawUrl,
      fallback: {
        ok: false,
        reasonCode: "env_limited",
        disposition: "failed",
        details: {
          message: `Browser fallback failed for ${rawUrl}`
        }
      }
    });

    expect(error.message).toBe(`Browser fallback failed for ${rawUrl}`);
    expect(error.details).toMatchObject({
      url: rawUrl,
      message: `Browser fallback failed for ${rawUrl}`
    });
  });

  it("leaves guidance absent when a completed fallback failure has no actionable issue hint", () => {
    const error = toProviderFallbackError({
      provider: "web/default",
      source: "web",
      url: "https://example.com/search",
      fallback: {
        ok: false,
        reasonCode: "caption_missing",
        disposition: "completed",
        mode: "managed_headed",
        details: {}
      }
    });

    expect(error.details?.guidance).toBeUndefined();
    expect(error.details).toMatchObject({
      disposition: "completed",
      browserFallbackMode: "managed_headed"
    });
  });

  it("converts completed fallback output gaps into normalized provider errors", () => {
    const error = toCompletedFallbackOutputError({
      provider: "web/default",
      source: "web",
      url: "https://example.com/search",
      outputReason: "missing_or_empty_html",
      fallback: {
        ok: true,
        reasonCode: "env_limited",
        disposition: "completed",
        mode: "managed_headed",
        details: {
          captureDiagnostics: {
            finalHtmlLength: 0,
            finalTextLength: 0
          }
        }
      }
    });

    expect(error.code).toBe("unavailable");
    expect(error.message).toBe("Browser fallback completed for https://example.com/search without usable HTML content.");
    expect(error.details).toMatchObject({
      url: "https://example.com/search",
      disposition: "completed",
      browserFallbackMode: "managed_headed",
      fallbackOutputReason: "missing_or_empty_html",
      captureDiagnostics: {
        finalHtmlLength: 0,
        finalTextLength: 0
      },
      reasonCode: "env_limited"
    });
  });

  it("uses public sanitized request URLs in completed fallback output errors", () => {
    const rawUrl = "https://accounts.google.com/o/oauth2/v2/auth?login_hint=alice@example.com&state=private-state";
    const error = toCompletedFallbackOutputError({
      provider: "web/google-oauth",
      source: "web",
      url: rawUrl,
      outputReason: "missing_or_empty_html",
      fallback: {
        ok: true,
        reasonCode: "auth_required",
        disposition: "completed",
        details: {
          url: rawUrl,
          message: `Browser fallback captured ${rawUrl} for alice@example.com and private-state`,
          state: "private-state",
          nested: {
            requestedUrl: rawUrl,
            refresh_token: "secret-refresh-token"
          }
        }
      }
    });

    expect(error.message).toBe("Browser fallback completed for https://accounts.google.com/ without usable HTML content.");
    expect(error.details).toMatchObject({
      url: "https://accounts.google.com/",
      disposition: "completed",
      fallbackOutputReason: "missing_or_empty_html",
      message: "Browser fallback captured https://accounts.google.com/ for [REDACTED] and [REDACTED]",
      state: "[REDACTED]",
      nested: {
        requestedUrl: "https://accounts.google.com/",
        refresh_token: "[REDACTED]"
      }
    });
    const serialized = JSON.stringify(error);
    expect(serialized).not.toContain("alice@example.com");
    expect(serialized).not.toContain("private-state");
    expect(serialized).not.toContain("secret-refresh-token");
    expect(serialized).not.toContain("login_hint=");
  });

  it("keeps completed fallback output gaps retryable for rate-limited responses without optional metadata", () => {
    const error = toCompletedFallbackOutputError({
      provider: "web/default",
      source: "web",
      url: "https://example.com/limited",
      outputReason: "empty_extracted_content",
      fallback: {
        ok: true,
        reasonCode: "rate_limited",
        disposition: "completed"
      }
    });

    expect(error.retryable).toBe(true);
    expect(error.details).toEqual({
      url: "https://example.com/limited",
      disposition: "completed",
      fallbackOutputReason: "empty_extracted_content",
      reasonCode: "rate_limited"
    });
  });

  it("preserves challenge metadata when completed fallback output is unusable", () => {
    const error = toCompletedFallbackOutputError({
      provider: "social/youtube",
      source: "social",
      url: "https://example.com/checkpoint",
      outputReason: "missing_or_empty_html",
      fallback: {
        ok: true,
        reasonCode: "challenge_detected",
        disposition: "completed",
        mode: "extension",
        preservedSessionId: "session-1",
        preservedTargetId: "target-1",
        challenge: {
          challengeId: "challenge-1",
          blockerType: "anti_bot_challenge",
          ownerSurface: "provider_fallback",
          resumeMode: "manual",
          status: "active",
          updatedAt: "2026-03-22T00:00:00.000Z"
        }
      }
    });

    expect(error.details).toMatchObject({
      url: "https://example.com/checkpoint",
      disposition: "completed",
      browserFallbackMode: "extension",
      preservedSessionId: "session-1",
      preservedTargetId: "target-1",
      fallbackOutputReason: "missing_or_empty_html",
      challenge: {
        challengeId: "challenge-1"
      },
      guidance: {
        reason: "Youtube preserved browser state that can complete the current challenge."
      }
    });
  });

  it("drops non-record challenge and detail payloads when normalizing fallback errors", () => {
    const error = toProviderFallbackError({
      provider: "social/youtube",
      source: "social",
      url: "https://example.com/array-shape",
      fallback: {
        ok: false,
        reasonCode: "challenge_detected",
        disposition: "failed",
        challenge: [] as never,
        details: [] as never
      }
    });

    expect(error.details).toEqual({
      challenge: {},
      disposition: "failed",
      guidance: {
        reason: "Youtube hit a challenge that still needs browser-assisted follow-up.",
        recommendedNextCommands: [
          "Retry with browser assistance so the challenge can be completed interactively.",
          "Only ask for manual credentials if browser-assisted recovery still cannot unlock the page."
        ]
      },
      reasonCode: "challenge_detected",
      url: "https://example.com/array-shape"
    });
  });

  it("omits browser fallback mode details when the observation has no mode", () => {
    expect(browserFallbackObservationDetails({
      reasonCode: "env_limited"
    })).toEqual({
      browserFallbackReasonCode: "env_limited"
    });
  });

  it("resolves fallback modes and normalizes explicit dispositions", async () => {
    expect(resolveProviderFallbackModes({
      source: "web",
      preferredModes: ["extension", "extension", "managed_headed"]
    })).toEqual(["extension", "managed_headed"]);

    expect(resolveProviderFallbackModes({
      source: "social",
      recoveryHints: {
        preferredFallbackModes: ["extension", "managed_headed", "extension"]
      }
    })).toEqual(["extension", "managed_headed"]);

    expect(resolveProviderFallbackModes({
      source: "community"
    })).toEqual(["managed_headed"]);

    expect(resolveProviderFallbackModes({
      source: "shopping"
    })).toEqual(["extension", "managed_headed"]);

    const context: ProviderContext = {
      trace: {
        requestId: "req-1",
        provider: "social/youtube",
        ts: "2026-03-22T00:00:00.000Z"
      },
      timeoutMs: 321,
      attempt: 1,
      runtimePolicy: resolveProviderRuntimePolicy({
        source: "social",
        runtimePolicy: {
          useCookies: true,
          cookiePolicyOverride: "required"
        }
      })
    };

    const port: BrowserFallbackPort = {
      resolve: vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          reasonCode: "auth_required",
          output: {
            html: "<html />"
          }
        })
        .mockResolvedValueOnce({
          ok: false,
          reasonCode: "env_limited",
          output: {}
        })
        .mockResolvedValueOnce({
          ok: false,
          reasonCode: "challenge_detected",
          output: {}
        })
    };

    expect(await resolveProviderBrowserFallback({
      provider: "web/no-port",
      source: "web",
      operation: "search",
      reasonCode: "auth_required"
    })).toBeNull();

    expect(await resolveProviderBrowserFallback({
      browserFallbackPort: port,
      allowEscalation: false,
      provider: "web/disabled",
      source: "web",
      operation: "search",
      reasonCode: "auth_required"
    })).toBeNull();

    const completed = await resolveProviderBrowserFallback({
      browserFallbackPort: port,
      provider: "social/youtube",
      source: "social",
      operation: "fetch",
      reasonCode: "auth_required",
      url: "https://example.com/video",
      context,
      details: {
        state: "blocked"
      },
      preferredModes: ["extension", "extension"],
      recoveryHints: {
        preferredFallbackModes: ["managed_headed"],
        settleTimeoutMs: 111,
        captureDelayMs: 222
      },
      suspendedIntent: {
        kind: "youtube.transcript",
        note: "resume transcript"
      }
    });

    expect(completed?.disposition).toBe("completed");
    expect(port.resolve).toHaveBeenNthCalledWith(1, expect.objectContaining({
      provider: "social/youtube",
      source: "social",
      operation: "fetch",
      reasonCode: "auth_required",
      url: "https://example.com/video",
      timeoutMs: 321,
      preferredModes: ["extension"],
      runtimePolicy: expect.objectContaining({
        cookies: {
          requested: true,
          policy: "required"
        }
      }),
      ownerSurface: "provider_fallback",
      resumeMode: "auto",
      suspendedIntent: {
        kind: "youtube.transcript",
        note: "resume transcript"
      },
      settleTimeoutMs: 111,
      captureDelayMs: 222
    }));

    const deferred = await resolveProviderBrowserFallback({
      browserFallbackPort: port,
      provider: "web/default",
      source: "web",
      operation: "search",
      reasonCode: "challenge_detected",
      url: "https://example.com/search"
    });
    expect(deferred?.disposition).toBe("deferred");
    expect(port.resolve).toHaveBeenNthCalledWith(2, expect.objectContaining({
      runtimePolicy: expect.objectContaining({
        browser: {
          preferredModes: ["managed_headed"],
          forceTransport: false
        }
      }),
      suspendedIntent: {
        kind: "provider.search",
        provider: "web/default",
        source: "web",
        operation: "search"
      }
    }));
    expect(port.resolve.mock.calls[1]?.[0]).not.toHaveProperty("useCookies");
    expect(port.resolve.mock.calls[1]?.[0]).not.toHaveProperty("cookiePolicyOverride");

    const failed = await resolveProviderBrowserFallback({
      browserFallbackPort: port,
      provider: "community/default",
      source: "community",
      operation: "post",
      reasonCode: "challenge_detected"
    });
    expect(failed?.disposition).toBe("failed");
    expect(port.resolve).toHaveBeenNthCalledWith(3, expect.objectContaining({
      suspendedIntent: {
        kind: "provider.post",
        provider: "community/default",
        source: "community",
        operation: "post"
      }
    }));
  });

  it("merges suspended intent input and forwards challenge automation mode into fallback requests", async () => {
    const port: BrowserFallbackPort = {
      resolve: vi.fn(async () => ({
        ok: true,
        reasonCode: "challenge_detected",
        disposition: "completed",
        output: {}
      }))
    };

    await resolveProviderBrowserFallback({
      browserFallbackPort: port,
      provider: "shopping/target",
      source: "shopping",
      operation: "search",
      reasonCode: "challenge_detected",
      context: {
        trace: {
          requestId: "req-merge",
          provider: "shopping/target",
          ts: "2026-03-23T00:00:00.000Z"
        },
        attempt: 1,
        runtimePolicy: resolveProviderRuntimePolicy({
          source: "shopping",
          runtimePolicy: {
            challengeAutomationMode: "browser_with_helper"
          }
        })
      },
      suspendedIntent: {
        kind: "provider.search",
        note: "resume target"
      },
      intentInput: {
        query: "portable monitor"
      }
    });

    await resolveProviderBrowserFallback({
      browserFallbackPort: port,
      provider: "shopping/amazon",
      source: "shopping",
      operation: "fetch",
      reasonCode: "env_limited",
      intentInput: {
        url: "https://example.com/item"
      }
    });

    expect(port.resolve).toHaveBeenNthCalledWith(1, expect.objectContaining({
      runtimePolicy: expect.objectContaining({
        challenge: expect.objectContaining({
          mode: "browser_with_helper"
        })
      }),
      suspendedIntent: {
        kind: "provider.search",
        note: "resume target",
        input: {
          query: "portable monitor"
        }
      }
    }));
    expect(port.resolve.mock.calls[0]?.[0]).not.toHaveProperty("challengeAutomationMode");
    expect(port.resolve).toHaveBeenNthCalledWith(2, expect.objectContaining({
      suspendedIntent: {
        kind: "provider.fetch",
        provider: "shopping/amazon",
        source: "shopping",
        operation: "fetch",
        input: {
          url: "https://example.com/item"
        }
      }
    }));
  });
});
