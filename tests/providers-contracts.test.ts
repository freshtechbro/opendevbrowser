import { describe, expect, it } from "vitest";
import {
  clampConfidence,
  createExecutionMetadata,
  createStableRecordId,
  createTraceContext,
  normalizeFailure,
  normalizeRecord,
  normalizeSuccess
} from "../src/providers/normalize";
import {
  ProviderRuntimeError,
  createProviderError,
  isRetryableByCode,
  toProviderError
} from "../src/providers/errors";

describe("provider contracts + normalization", () => {
  it("creates trace context defaults and respects overrides", () => {
    const trace = createTraceContext({ requestId: "req-1", sessionId: "s1" }, "web/default");

    expect(trace.requestId).toBe("req-1");
    expect(trace.sessionId).toBe("s1");
    expect(trace.provider).toBe("web/default");
    expect(typeof trace.ts).toBe("string");
  });

  it("keeps seed provider/targetId when explicit provider is absent", () => {
    const trace = createTraceContext({
      requestId: "req-seeded",
      targetId: "target-1",
      provider: "seed/provider",
      ts: "2026-01-01T00:00:00.000Z"
    });

    expect(trace.provider).toBe("seed/provider");
    expect(trace.targetId).toBe("target-1");
    expect(trace.ts).toBe("2026-01-01T00:00:00.000Z");
  });

  it("creates stable normalized records", () => {
    const base = {
      url: "https://example.com/a",
      title: "Title",
      content: "Hello"
    };

    const first = normalizeRecord("web/default", "web", base);
    const second = normalizeRecord("web/default", "web", base);
    const explicit = createStableRecordId("web/default", "web", base);

    expect(first.id).toBe(second.id);
    expect(first.id).toBe(explicit);
    expect(first.confidence).toBe(0.5);
    expect(first.attributes).toEqual({});
  });

  it("stabilizes ids with null attributes and preserves optional-field omissions", () => {
    const id = createStableRecordId("web/default", "web", {
      title: "No URL",
      attributes: {
        nested: {
          nil: null
        }
      }
    });

    const record = normalizeRecord("web/default", "web", {
      title: "No URL",
      confidence: Number.NaN
    });

    expect(id).toHaveLength(16);
    expect(record.url).toBeUndefined();
    expect(record.content).toBeUndefined();
    expect(record.confidence).toBe(0.5);
  });

  it("clamps confidence correctly", () => {
    expect(clampConfidence(undefined)).toBe(0.5);
    expect(clampConfidence(-3)).toBe(0);
    expect(clampConfidence(1.5)).toBe(1);
    expect(clampConfidence(0.25)).toBe(0.25);
  });

  it("normalizes success + failure results", () => {
    const success = normalizeSuccess("social/x", "social", [
      { url: "https://x.com/p/1", content: "hi", confidence: 0.9 }
    ], {
      trace: { requestId: "req-2" },
      attempts: 2,
      retries: 1,
      meta: createExecutionMetadata({
        tier: { selected: "B", reasonCode: "hybrid_eligible" },
        provider: "social/x",
        retrievalPath: "search:social/x"
      }),
      provenance: { macro: "media.search" }
    });

    expect(success.ok).toBe(true);
    expect(success.records).toHaveLength(1);
    expect(success.trace.provider).toBe("social/x");
    expect(success.attempts).toBe(2);
    expect(success.retries).toBe(1);
    expect(success.provenance).toEqual({ macro: "media.search" });
    expect(success.meta?.tier.selected).toBe("B");
    expect(success.meta?.tier.reasonCode).toBe("hybrid_eligible");
    expect(success.meta?.provenance.provider).toBe("social/x");
    expect(success.meta?.provenance.retrievalPath).toBe("search:social/x");
    expect(typeof success.meta?.provenance.retrievedAt).toBe("string");

    const failure = normalizeFailure("social/x", "social", new Error("timed out"), {
      trace: { requestId: "req-3" },
      attempts: 2,
      retries: 1
    });

    expect(failure.ok).toBe(false);
    expect(failure.error.code).toBe("timeout");
    expect(failure.error.retryable).toBe(true);
    expect(failure.trace.provider).toBe("social/x");
  });

  it("applies normalize success/failure defaults for retries and blank provider errors", () => {
    const withDefaults = normalizeSuccess("web/default", "web", [
      { url: "https://example.com/defaults" }
    ], {
      attempts: 3
    });
    expect(withDefaults.attempts).toBe(3);
    expect(withDefaults.retries).toBe(2);
    expect(withDefaults.provenance).toBeUndefined();

    const implicitAttempts = normalizeSuccess("web/default", "web", [
      { title: "implicit-attempts" }
    ]);
    expect(implicitAttempts.attempts).toBe(1);
    expect(implicitAttempts.retries).toBe(0);

    const normalized = normalizeFailure("web/default", "web", {
      code: "upstream",
      message: "",
      retryable: true
    }, {
      defaultMessage: "fallback provider failure"
    });
    expect(normalized.error.code).toBe("upstream");
    expect(normalized.error.message).toBe("fallback provider failure");

    const normalizedDefaultMessage = normalizeFailure("web/default", "web", {
      code: "upstream",
      message: "",
      retryable: true
    });
    expect(normalizedDefaultMessage.error.message).toBe("Provider request failed");

    const primitiveFailure = normalizeFailure("web/default", "web", "");
    expect(primitiveFailure.error.message).toBe("Unknown provider failure");
  });

  it("normalizes failure with explicit metadata", () => {
    const failure = normalizeFailure("web/default", "web", new Error("boom"), {
      meta: createExecutionMetadata({
        tier: { selected: "C", reasonCode: "restricted_safe_forced" },
        provider: "web/default",
        retrievalPath: "fetch:web/default:failure",
        retrievedAt: "2026-01-01T00:00:00.000Z"
      })
    });

    expect(failure.meta).toEqual({
      tier: { selected: "C", reasonCode: "restricted_safe_forced" },
      provenance: {
        provider: "web/default",
        retrievalPath: "fetch:web/default:failure",
        retrievedAt: "2026-01-01T00:00:00.000Z"
      }
    });
  });

  it("maps unknown errors to taxonomy", () => {
    const timeout = toProviderError(new Error("request timeout"));
    expect(timeout.code).toBe("timeout");

    const network = toProviderError(new Error("ECONNRESET"));
    expect(network.code).toBe("network");

    const auth = toProviderError(new Error("401 unauthorized"));
    expect(auth.code).toBe("auth");

    const unsupported = toProviderError(new Error("not supported"));
    expect(unsupported.code).toBe("not_supported");

    const fallback = toProviderError("strange", { defaultCode: "upstream" });
    expect(fallback.code).toBe("upstream");
  });

  it("preserves ProviderRuntimeError fields", () => {
    const runtimeError = new ProviderRuntimeError("policy_blocked", "blocked", {
      provider: "social/x",
      source: "social",
      retryable: false,
      details: { reason: "confirmation required" }
    });

    const mapped = toProviderError(runtimeError);
    expect(mapped).toEqual({
      code: "policy_blocked",
      message: "blocked",
      retryable: false,
      provider: "social/x",
      source: "social",
      details: { reason: "confirmation required" }
    });

    const created = createProviderError("rate_limited", "slow down", { provider: "web/default" });
    expect(created.retryable).toBe(true);
    expect(isRetryableByCode("internal")).toBe(false);
  });
});
