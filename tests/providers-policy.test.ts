import { describe, expect, it } from "vitest";
import { createProviderError } from "../src/providers/errors";
import { selectProviders, shouldFallbackToNextProvider } from "../src/providers/policy";
import { ProviderRegistry } from "../src/providers/registry";
import { fallbackTierMetadata, selectTierRoute, shouldFallbackToTierA } from "../src/providers/tier-router";
import { assertPostPolicy, evaluatePostPolicy, hashPostPayload } from "../src/providers/shared/post-policy";
import type { ProviderAdapter, ProviderOperation, ProviderSource } from "../src/providers/types";

const makeProvider = (
  id: string,
  source: ProviderSource,
  ops: Partial<Record<ProviderOperation, true>>
): ProviderAdapter => ({
  id,
  source,
  ...(ops.search ? { search: async () => [] } : {}),
  ...(ops.fetch ? { fetch: async () => [] } : {}),
  ...(ops.crawl ? { crawl: async () => [] } : {}),
  ...(ops.post ? { post: async () => [] } : {}),
  capabilities: () => ({
    providerId: id,
    source,
    operations: {
      search: { op: "search", supported: Boolean(ops.search) },
      fetch: { op: "fetch", supported: Boolean(ops.fetch) },
      crawl: { op: "crawl", supported: Boolean(ops.crawl) },
      post: { op: "post", supported: Boolean(ops.post) }
    },
    policy: {
      posting: ops.post ? "gated" : "unsupported",
      riskNoticeRequired: false,
      confirmationRequired: false
    },
    metadata: {}
  })
});

describe("provider policy + registry branches", () => {
  it("filters by operation and selection, then sorts by health/source/id", () => {
    const registry = new ProviderRegistry();
    registry.register(makeProvider("web/a", "web", { search: true, fetch: true }));
    registry.register(makeProvider("web/b", "web", { search: true, fetch: true }));
    registry.register(makeProvider("community/a", "community", { search: true, crawl: true, post: true }));
    registry.register(makeProvider("social/a", "social", { search: true, post: true }));

    registry.setHealth("web/b", { status: "degraded", updatedAt: new Date().toISOString() });
    registry.setHealth("social/a", { status: "unhealthy", updatedAt: new Date().toISOString() });

    expect(selectProviders(registry, "search", "auto").map((provider) => provider.id)).toEqual([
      "web/a",
      "community/a",
      "web/b",
      "social/a"
    ]);

    expect(selectProviders(registry, "fetch", "all").map((provider) => provider.id)).toEqual([
      "web/a",
      "web/b"
    ]);

    expect(selectProviders(registry, "crawl", "auto").map((provider) => provider.id)).toEqual([
      "community/a"
    ]);

    expect(selectProviders(registry, "post", "community").map((provider) => provider.id)).toEqual([
      "community/a"
    ]);
  });

  it("maps fallback policy by selection mode", () => {
    expect(shouldFallbackToNextProvider("auto")).toBe(true);
    expect(shouldFallbackToNextProvider("all")).toBe(true);
    expect(shouldFallbackToNextProvider("web")).toBe(false);
    expect(shouldFallbackToNextProvider("community")).toBe(false);
    expect(shouldFallbackToNextProvider("social")).toBe(false);
  });

  it("selects tiers deterministically with reason codes and deterministic fallback target", () => {
    const routeC = selectTierRoute(
      { defaultTier: "A", enableHybrid: true, enableRestrictedSafe: true },
      { hybridEligible: true, challengePressure: 0.9 }
    );
    expect(routeC.tier).toEqual({ selected: "C", reasonCode: "challenge_pressure" });
    expect(routeC.fallbackTier).toBe("A");

    const routeB = selectTierRoute(
      { defaultTier: "A", enableHybrid: true, enableRestrictedSafe: false },
      { hybridEligible: true, challengePressure: 0.1 }
    );
    expect(routeB.tier).toEqual({ selected: "B", reasonCode: "hybrid_eligible" });

    const routeA = selectTierRoute(
      { defaultTier: "A", enableHybrid: false, enableRestrictedSafe: false },
      { hybridEligible: true, challengePressure: 0.1 }
    );
    expect(routeA.tier).toEqual({ selected: "A", reasonCode: "default_tier" });

    expect(shouldFallbackToTierA("B")).toBe(true);
    expect(shouldFallbackToTierA("C")).toBe(true);
    expect(shouldFallbackToTierA("A")).toBe(false);
    expect(fallbackTierMetadata()).toEqual({ selected: "A", reasonCode: "fallback_to_tier_a" });
  });

  it("tracks registry health transitions, circuit state, and reset behavior", () => {
    const registry = new ProviderRegistry();
    registry.register(makeProvider("web/state", "web", { search: true }));

    registry.markFailure("web/state", createProviderError("timeout", "slow upstream"), {
      failureThreshold: 2,
      cooldownMs: 50
    });
    expect(registry.getHealth("web/state").status).toBe("degraded");
    expect(registry.isCircuitOpen("web/state")).toBe(false);

    registry.markFailure("web/state", createProviderError("network", "network down"), {
      failureThreshold: 2,
      cooldownMs: 50
    });
    expect(registry.getHealth("web/state").status).toBe("unhealthy");
    expect(registry.isCircuitOpen("web/state")).toBe(true);

    const error = registry.getCircuitError("web/state");
    expect(error.code).toBe("circuit_open");
    expect(error.details?.lastErrorCode).toBe("network");
    expect(error.details?.failures).toBe(2);

    expect(registry.isCircuitOpen("web/state", Date.now() + 60)).toBe(false);
    expect(registry.getHealth("web/state")).toMatchObject({
      status: "degraded",
      reason: "Circuit cooldown elapsed"
    });

    registry.markSuccess("web/state", 37);
    expect(registry.getHealth("web/state")).toMatchObject({
      status: "healthy",
      latencyMs: 37
    });

    registry.setHealth("web/state", {
      status: "degraded",
      updatedAt: "",
      reason: "manual"
    });
    expect(registry.getHealth("web/state").updatedAt).not.toBe("");
    expect(registry.getHealth("web/state").reason).toBe("manual");

    registry.reset("web/state");
    expect(registry.getHealth("web/state").status).toBe("healthy");
    expect(registry.getHealth("web/state").reason).toBeUndefined();
  });

  it("handles lookup errors and source grouping in registry", () => {
    const registry = new ProviderRegistry();
    registry.register(makeProvider("web/one", "web", { search: true }));
    registry.register(makeProvider("community/one", "community", { search: true }));

    expect(registry.get("web/one").id).toBe("web/one");
    expect(registry.listBySource("web").map((provider) => provider.id)).toEqual(["web/one"]);
    expect(registry.listBySource("community").map((provider) => provider.id)).toEqual(["community/one"]);

    expect(() => registry.get("missing/provider")).toThrow("Unknown provider");
    expect(() => registry.getHealth("missing/provider")).toThrow("Unknown provider state");
  });

  it("covers default post-policy deny/allow branches and payload hashing defaults", async () => {
    const trace = { requestId: "post-policy-default", ts: "2026-01-01T00:00:00.000Z" };

    const deniedRisk = await evaluatePostPolicy({
      providerId: "community/a",
      source: "community",
      trace,
      payload: { target: "general", content: "hello" }
    });
    expect(deniedRisk.allowed).toBe(false);
    expect(deniedRisk.reason).toBe("Posting requires risk acknowledgement");

    const deniedConfirm = await evaluatePostPolicy({
      providerId: "community/a",
      source: "community",
      trace,
      payload: { target: "general", content: "hello", riskAccepted: true }
    });
    expect(deniedConfirm.allowed).toBe(false);
    expect(deniedConfirm.reason).toBe("Posting requires explicit confirmation");

    const allowed = await evaluatePostPolicy({
      providerId: "community/a",
      source: "community",
      trace,
      payload: { target: "general", content: "hello", riskAccepted: true, confirm: true }
    });
    expect(allowed.allowed).toBe(true);
    expect(allowed.audit.decision).toBe("allow");

    const allowedAudit = await assertPostPolicy({
      providerId: "community/a",
      source: "community",
      trace,
      payload: { target: "general", content: "hello", riskAccepted: true, confirm: true }
    });
    expect(allowedAudit.decision).toBe("allow");

    expect(hashPostPayload({ target: "general", content: "hello" })).toBe(
      hashPostPayload({ target: "general", content: "hello", mediaUrls: [], metadata: {} })
    );
  });

  it("carries hook metadata through evaluate/throw policy paths", async () => {
    const context = {
      providerId: "community/a",
      source: "community" as const,
      trace: { requestId: "post-policy-metadata", ts: "2026-01-01T00:00:00.000Z" },
      payload: { target: "general", content: "hello", riskAccepted: true, confirm: true }
    };

    const evaluated = await evaluatePostPolicy(context, [
      () => ({ allow: false, reason: "blocked by hook", metadata: { rule: "manual" } })
    ]);
    expect(evaluated.allowed).toBe(false);
    expect(evaluated.metadata).toEqual({ rule: "manual" });
    expect(evaluated.audit.decision).toBe("deny");

    await expect(assertPostPolicy(context, [
      () => ({ allow: false, reason: "blocked by hook", metadata: { rule: "manual" } })
    ])).rejects.toMatchObject({
      code: "policy_blocked",
      details: {
        reason: "blocked by hook",
        metadata: { rule: "manual" }
      }
    });
  });

  it("uses assertPostPolicy default message when denied reason is missing", async () => {
    const context = {
      providerId: "social/a",
      source: "social" as const,
      trace: { requestId: "post-policy-missing-reason", ts: "2026-01-01T00:00:00.000Z" },
      payload: { target: "timeline", content: "hello", riskAccepted: true, confirm: true }
    };

    await expect(assertPostPolicy(context, [
      () => ({ allow: false })
    ])).rejects.toMatchObject({
      code: "policy_blocked",
      message: "Post policy blocked the request",
      details: { reason: null }
    });
  });
});
