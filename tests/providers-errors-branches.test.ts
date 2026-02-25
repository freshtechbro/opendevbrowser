import { describe, expect, it } from "vitest";
import {
  ProviderRuntimeError,
  createProviderError,
  normalizeProviderReasonCode,
  providerErrorCodeFromReasonCode,
  toProviderError
} from "../src/providers/errors";

describe("provider error reason-code branches", () => {
  it("normalizes anti-bot and transcript reason codes from status/message/details", () => {
    expect(normalizeProviderReasonCode({
      code: "unavailable",
      details: { reasonCode: "rate_limited" }
    })).toBe("rate_limited");

    expect(normalizeProviderReasonCode({
      code: "unavailable",
      message: "captcha challenge required"
    })).toBe("challenge_detected");

    expect(normalizeProviderReasonCode({
      code: "upstream",
      message: "access denied from your ip"
    })).toBe("ip_blocked");

    expect(normalizeProviderReasonCode({
      code: "unavailable",
      message: "No captions found"
    })).toBe("caption_missing");

    expect(normalizeProviderReasonCode({
      code: "unavailable",
      message: "transcript unavailable"
    })).toBe("transcript_unavailable");

    expect(normalizeProviderReasonCode({
      code: "unavailable",
      message: "not available in this environment"
    })).toBe("env_limited");

    expect(normalizeProviderReasonCode({
      code: "auth",
      status: 401
    })).toBe("token_required");
  });

  it("maps provider reason codes to execution error codes", () => {
    expect(providerErrorCodeFromReasonCode("rate_limited")).toBe("rate_limited");
    expect(providerErrorCodeFromReasonCode("token_required")).toBe("auth");
    expect(providerErrorCodeFromReasonCode("auth_required")).toBe("auth");
    expect(providerErrorCodeFromReasonCode("policy_blocked")).toBe("policy_blocked");
    expect(providerErrorCodeFromReasonCode("strategy_unapproved")).toBe("policy_blocked");
    expect(providerErrorCodeFromReasonCode("ip_blocked")).toBe("upstream");
    expect(providerErrorCodeFromReasonCode("challenge_detected")).toBe("unavailable");
    expect(providerErrorCodeFromReasonCode("caption_missing")).toBe("unavailable");
    expect(providerErrorCodeFromReasonCode("transcript_unavailable")).toBe("unavailable");
    expect(providerErrorCodeFromReasonCode("env_limited")).toBe("unavailable");
    expect(providerErrorCodeFromReasonCode("cooldown_active")).toBe("unavailable");
    expect(providerErrorCodeFromReasonCode(undefined)).toBe("unavailable");
  });

  it("preserves existing details.reasonCode strings while still setting top-level reasonCode", () => {
    const created = createProviderError("unavailable", "fallback", {
      reasonCode: "env_limited",
      details: { reasonCode: "custom_reason" }
    });

    expect(created.reasonCode).toBe("env_limited");
    expect(created.details).toEqual({
      reasonCode: "custom_reason"
    });
  });

  it("infers missing runtime reason codes and keeps explicit reason codes", () => {
    const inferred = toProviderError(new ProviderRuntimeError("unavailable", "captcha challenge"));
    expect(inferred.reasonCode).toBe("challenge_detected");

    const explicit = toProviderError(new ProviderRuntimeError("policy_blocked", "blocked", {
      reasonCode: "policy_blocked",
      details: { reason: "legal" }
    }));
    expect(explicit.reasonCode).toBe("policy_blocked");
    expect(explicit.details).toEqual({
      reason: "legal",
      reasonCode: "policy_blocked"
    });

    const mapped = toProviderError(new Error("service down"));
    expect(mapped.code).toBe("unavailable");
  });
});
