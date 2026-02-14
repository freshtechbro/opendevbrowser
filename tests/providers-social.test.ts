import { describe, expect, it } from "vitest";
import { createSocialProvider } from "../src/providers/social";

const context = (requestId: string) => ({
  trace: { requestId, ts: new Date().toISOString() },
  timeoutMs: 50,
  attempt: 1 as const
});

describe("social provider", () => {
  it("normalizes search/fetch/post paths", async () => {
    const provider = createSocialProvider("x", {
      search: async () => [{
        url: "https://x.com/p/1",
        title: "post",
        content: "hello"
      }],
      fetch: async () => ({
        title: "fetched",
        content: "details"
      }),
      post: async () => ({
        attributes: { mapper: "custom-post" }
      })
    });

    const search = await provider.search?.({ query: "hello" }, context("r1"));
    expect(search?.[0]?.provider).toBe("social/x");

    const fetched = await provider.fetch?.({ url: "https://x.com/p/1" }, context("r2"));
    expect(fetched?.[0]?.attributes.platform).toBe("x");

    const posted = await provider.post?.({
      target: "handle",
      content: "hello",
      confirm: true,
      riskAccepted: true
    }, context("r3"));
    expect(posted?.[0]?.attributes.decision).toBe("allow");
    expect(posted?.[0]?.attributes.mapper).toBe("custom-post");
  });

  it("runs post-policy hooks and blocks unsafe payloads", async () => {
    const provider = createSocialProvider("threads", {
      postPolicyHooks: [
        (context) => context.payload.target === "blocked"
          ? { allow: false, reason: "platform gate" }
          : { allow: true }
      ]
    });

    await expect(provider.post?.({
      target: "blocked",
      content: "hello",
      confirm: true,
      riskAccepted: true
    }, {
      trace: { requestId: "r4", ts: new Date().toISOString() },
      timeoutMs: 50,
      attempt: 1
    })).rejects.toMatchObject({ code: "policy_blocked" });

    await expect(provider.post?.({
      target: "ok",
      content: "hello",
      confirm: false,
      riskAccepted: true
    }, {
      trace: { requestId: "r5", ts: new Date().toISOString() },
      timeoutMs: 50,
      attempt: 1
    })).rejects.toMatchObject({ code: "policy_blocked" });
  });

  it("exposes degraded health and capability metadata when not configured", async () => {
    const provider = createSocialProvider("linkedin");
    const health = await provider.health?.({
      trace: { requestId: "r6", ts: new Date().toISOString() },
      timeoutMs: 50
    });

    expect(health).toMatchObject({
      status: "degraded",
      reason: "Retrieval not configured"
    });

    const capabilities = provider.capabilities();
    expect(capabilities.source).toBe("social");
    expect(capabilities.operations.search.supported).toBe(true);
    expect(capabilities.operations.post.supported).toBe(true);
    expect(capabilities.operations.crawl.supported).toBe(false);
    expect(capabilities.policy.confirmationRequired).toBe(true);
  });

  it("returns unavailable for unconfigured social retrieval and posting", async () => {
    const provider = createSocialProvider("reddit");
    await expect(provider.search?.({ query: "release" }, context("r6-search")))
      .rejects.toMatchObject({ code: "unavailable" });
    await expect(provider.fetch?.({ url: "https://reddit.com/r/example" }, context("r6-fetch")))
      .rejects.toMatchObject({ code: "unavailable" });
    await expect(provider.post?.({
      target: "example",
      content: "hello",
      confirm: true,
      riskAccepted: true
    }, context("r6-post"))).rejects.toMatchObject({ code: "unavailable" });
  });

  it("rejects empty social search queries", async () => {
    const provider = createSocialProvider("reddit");
    await expect(provider.search?.({ query: "   " }, context("r7"))).rejects.toMatchObject({
      code: "invalid_input"
    });
  });
});
