import { describe, expect, it, vi } from "vitest";
import {
  fallbackDispositionMessage,
  readFallbackString,
  resolveProviderBrowserFallback,
  resolveProviderFallbackModes,
  toProviderFallbackError
} from "../src/providers/browser-fallback";
import type { BrowserFallbackPort, BrowserFallbackResponse, ProviderContext } from "../src/providers/types";

describe("provider browser fallback helpers", () => {
  it("reads fallback strings and prefers explicit detail messages", () => {
    expect(readFallbackString({ html: "<html />", url: "https://example.com" }, "html")).toBe("<html />");
    expect(readFallbackString({ html: "<html />", url: "https://example.com" }, "url")).toBe("https://example.com");
    expect(readFallbackString({ html: "" }, "html")).toBeUndefined();
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
      preservedSessionId: "session-1",
      preservedTargetId: "target-1",
      challenge: {
        challengeId: "challenge-1"
      },
      nested: {
        keep: true
      },
      entries: [1, { okay: "yes" }],
      reasonCode: "rate_limited"
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
        details: {}
      }
    });

    expect(error.retryable).toBe(false);
    expect(error.reasonCode).toBe("auth_required");
    expect(error.details).toMatchObject({
      disposition: "failed",
      url: "https://example.com/video"
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
      reasonCode: "challenge_detected",
      url: "https://example.com/array-shape"
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

    const context: ProviderContext = {
      trace: {
        requestId: "req-1",
        provider: "social/youtube",
        ts: "2026-03-22T00:00:00.000Z"
      },
      timeoutMs: 321,
      attempt: 1,
      useCookies: true,
      cookiePolicyOverride: "required"
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
      useCookies: true,
      cookiePolicyOverride: "required",
      preferredModes: ["extension"],
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
      preferredModes: ["managed_headed"],
      suspendedIntent: {
        kind: "provider.search",
        provider: "web/default",
        source: "web",
        operation: "search"
      }
    }));

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
        challengeAutomationMode: "browser_with_helper"
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
      challengeAutomationMode: "browser_with_helper",
      suspendedIntent: {
        kind: "provider.search",
        note: "resume target",
        input: {
          query: "portable monitor"
        }
      }
    }));
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
