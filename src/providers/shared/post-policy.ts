import { createHash } from "crypto";
import { ProviderRuntimeError } from "../errors";
import type { JsonValue, ProviderPostInput, TraceContext } from "../types";

export interface PostPolicyContext {
  providerId: string;
  source: "community" | "social";
  payload: ProviderPostInput;
  trace: TraceContext;
}

export interface PostPolicyDecision {
  allow: boolean;
  reason?: string;
  metadata?: Record<string, JsonValue>;
}

export interface PostPolicyAuditEntry {
  providerId: string;
  source: "community" | "social";
  decision: "allow" | "deny";
  reason?: string;
  payloadHash: string;
  ts: string;
  requestId: string;
}

export type PostPolicyHook = (context: PostPolicyContext) => Promise<PostPolicyDecision> | PostPolicyDecision;

const defaultPolicy: PostPolicyHook = (context) => {
  if (!context.payload.riskAccepted) {
    return {
      allow: false,
      reason: "Posting requires risk acknowledgement"
    };
  }

  if (!context.payload.confirm) {
    return {
      allow: false,
      reason: "Posting requires explicit confirmation"
    };
  }

  return { allow: true };
};

export const hashPostPayload = (payload: ProviderPostInput): string => {
  const normalized = JSON.stringify({
    target: payload.target,
    content: payload.content,
    mediaUrls: payload.mediaUrls ?? [],
    metadata: payload.metadata ?? {}
  });
  return createHash("sha256").update(normalized).digest("hex");
};

export const evaluatePostPolicy = async (
  context: PostPolicyContext,
  hooks: PostPolicyHook[] = []
): Promise<{ allowed: boolean; reason?: string; audit: PostPolicyAuditEntry; metadata?: Record<string, JsonValue> }> => {
  const chain = [defaultPolicy, ...hooks];
  const payloadHash = hashPostPayload(context.payload);

  for (const hook of chain) {
    const decision = await hook(context);
    if (!decision.allow) {
      return {
        allowed: false,
        reason: decision.reason,
        ...(decision.metadata ? { metadata: decision.metadata } : {}),
        audit: {
          providerId: context.providerId,
          source: context.source,
          decision: "deny",
          reason: decision.reason,
          payloadHash,
          ts: new Date().toISOString(),
          requestId: context.trace.requestId
        }
      };
    }
  }

  return {
    allowed: true,
    audit: {
      providerId: context.providerId,
      source: context.source,
      decision: "allow",
      payloadHash,
      ts: new Date().toISOString(),
      requestId: context.trace.requestId
    }
  };
};

export const assertPostPolicy = async (
  context: PostPolicyContext,
  hooks: PostPolicyHook[] = []
): Promise<PostPolicyAuditEntry> => {
  const result = await evaluatePostPolicy(context, hooks);
  if (!result.allowed) {
    throw new ProviderRuntimeError("policy_blocked", result.reason ?? "Post policy blocked the request", {
      provider: context.providerId,
      source: context.source,
      retryable: false,
      details: {
        payloadHash: result.audit.payloadHash,
        reason: result.reason ?? null,
        ...(result.metadata ? { metadata: result.metadata } : {})
      }
    });
  }

  return result.audit;
};
