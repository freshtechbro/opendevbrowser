import { describe, expect, it } from "vitest";
import { createDefaultMacroRegistry, resolveMacro } from "../src/macros";
import { executeMacroResolution, shapeExecutionPayload } from "../src/macros/execute";
import { MacroRegistry, parseMacro, type ParsedMacro } from "../src/macros/registry";
import { createCoreMacroPack } from "../src/macros/packs/core";

describe("macro parser + registry", () => {
  it("parses positional and named arguments", () => {
    const parsed = parseMacro("@social.post('x', target='timeline', \"hello, world\", confirm=true, riskAccepted=false)");

    expect(parsed.name).toBe("social.post");
    expect(parsed.positional).toEqual(["x", "hello, world"]);
    expect(parsed.named).toEqual({
      target: "timeline",
      confirm: true,
      riskAccepted: false
    });
  });

  it("handles simple macro syntax and validation", () => {
    expect(parseMacro("@web.search")).toEqual({
      raw: "@web.search",
      name: "web.search",
      positional: [],
      named: {}
    });

    expect(() => parseMacro("web.search(query=test)")).toThrow("must start");
    expect(() => parseMacro("@web.search(query='oops'")).toThrow("unbalanced");
    expect(() => parseMacro("@bad token()"))
      .toThrow("Invalid macro token");
  });

  it("handles escaping and validates argument structure", () => {
    const parsed = parseMacro("@web.search(\"a\\\\\\\"b\", raw=plain, quoted='x\\\\\\'y', eq='a=b')");
    expect(parsed.positional).toEqual(["a\\\\\"b"]);
    expect(parsed.named).toEqual({
      raw: "plain",
      quoted: "x\\\\'y",
      eq: "a=b"
    });

    expect(() => parseMacro("@web.search(\"unterminated)"))
      .toThrow("Unterminated macro string argument");
    expect(() => parseMacro("@web.search(1bad='x')"))
      .toThrow("Invalid macro argument name");
  });

  it("registers and resolves macros with provenance", async () => {
    const registry = new MacroRegistry();
    registry.register({
      name: "custom.echo",
      pack: "custom",
      resolve: (parsed) => ({
        source: "web",
        operation: "search",
        input: {
          query: String(parsed.positional[0] ?? "")
        }
      })
    });

    expect(() => registry.register({
      name: "custom.echo",
      resolve: () => ({ source: "web", operation: "search", input: { query: "x" } })
    })).toThrow("already registered");

    const resolution = await registry.resolve("@custom.echo('hello')");
    expect(resolution.action.operation).toBe("search");
    expect(resolution.provenance.macro).toBe("custom.echo");
    expect(resolution.provenance.provider).toBe("web");
    expect(resolution.provenance.resolvedQuery).toBe("hello");

    await expect(registry.resolve("@unknown.macro()"))
      .rejects.toThrow("Unknown macro");
  });

  it("resolves parsed input and inference fallbacks", async () => {
    const registry = new MacroRegistry();
    registry.registerMany([
      {
        name: "custom.url",
        pack: "custom",
        resolve: () => ({
          source: "web",
          operation: "fetch",
          input: {
            url: "https://example.com/path"
          }
        })
      },
      {
        name: "custom.platform",
        pack: "custom",
        resolve: () => ({
          source: "social",
          operation: "search",
          input: {
            platform: "threads",
            query: "release notes"
          }
        })
      },
      {
        name: "custom.auto",
        pack: "custom",
        resolve: () => ({
          source: "auto",
          operation: "search",
          input: {}
        })
      }
    ]);

    expect(registry.has("custom.url")).toBe(true);
    expect(registry.has("custom.none")).toBe(false);

    const parsed = parseMacro("@custom.url()");
    const urlResolution = await registry.resolve(parsed);
    expect(urlResolution.provenance.resolvedQuery).toBe("https://example.com/path");
    expect(urlResolution.provenance.provider).toBe("web");

    const platformResolution = await registry.resolve("@custom.platform()");
    expect(platformResolution.provenance.provider).toBe("social/threads");

    const autoResolution = await registry.resolve("@custom.auto()", {
      preferredSource: "community"
    });
    expect(autoResolution.provenance.provider).toBe("community");
    expect(autoResolution.provenance.resolvedQuery).toBe("{}");
  });

  it("loads and resolves core macro pack actions", async () => {
    const registry = createDefaultMacroRegistry();

    const webSearch = await registry.resolve("@web.search(query='playwright', limit=5)");
    expect(webSearch.action.source).toBe("web");
    expect(webSearch.action.operation).toBe("search");
    expect(webSearch.action.input).toMatchObject({ query: "playwright", limit: 5, providerId: "web/default" });
    expect(webSearch.provenance).toMatchObject({
      macro: "web.search",
      provider: "web/default",
      resolvedQuery: "playwright"
    });

    const socialPost = await registry.resolve("@social.post('x','timeline','ship it',confirm=true,riskAccepted=true)");
    expect(socialPost.action.source).toBe("social");
    expect(socialPost.action.operation).toBe("post");
    expect(socialPost.action.input).toMatchObject({
      providerId: "social/x",
      target: "timeline",
      content: "ship it",
      confirm: true,
      riskAccepted: true
    });
    expect(socialPost.provenance.pack).toBe("core:media");

    const docs = await registry.resolve("@developer.docs(topic='url api', limit=3)");
    expect(docs.action.input).toMatchObject({
      query: "site:developer.mozilla.org url api",
      limit: 3
    });
  });

  it("resolves additional core pack macros and default args", async () => {
    const registry = createDefaultMacroRegistry();

    const fetchResult = await registry.resolve("@web.fetch('https://example.com')");
    expect(fetchResult.action).toMatchObject({
      source: "web",
      operation: "fetch",
      input: {
        url: "https://example.com",
        providerId: "web/default"
      }
    });

    const communitySearch = await registry.resolve("@community.search('playwright')");
    expect(communitySearch.action.input).toMatchObject({
      query: "playwright",
      providerId: "community/default"
    });

    const mediaSearch = await registry.resolve("@media.search('agent runtime')");
    expect(mediaSearch.action.input).toMatchObject({
      platform: "x",
      providerId: "social/x"
    });

    const mediaTrend = await registry.resolve("@media.trend()");
    expect(mediaTrend.action.input).toMatchObject({
      platform: "x",
      query: "trending",
      providerId: "social/x"
    });

    const communityPost = await registry.resolve("@community.post('timeline','ship',confirm='true',riskAccepted='false')");
    expect(communityPost.action.input).toMatchObject({
      confirm: true,
      riskAccepted: false
    });
  });

  it("rejects invalid numeric and boolean core macro args", async () => {
    const registry = createDefaultMacroRegistry();

    await expect(registry.resolve("@web.fetch()"))
      .rejects.toThrow("requires argument: url");

    await expect(registry.resolve("@web.search(query='agent', limit='nope')"))
      .rejects.toThrow("expects numeric argument");

    await expect(registry.resolve("@community.post('timeline','ship',confirm='yes')"))
      .rejects.toThrow("expects boolean argument");
  });

  it("applies optional empty-string defaults and boolean fallbacks", async () => {
    const registry = createDefaultMacroRegistry();

    const mediaSearch = await registry.resolve("@media.search('agent runtime', platform='')");
    expect(mediaSearch.action.input).toMatchObject({
      platform: "x",
      providerId: "social/x"
    });

    const mediaTrend = await registry.resolve("@media.trend(platform='')");
    expect(mediaTrend.action.input).toMatchObject({
      platform: "x",
      query: "trending",
      providerId: "social/x"
    });

    const socialPost = await registry.resolve("@social.post('x','timeline','ship it')");
    expect(socialPost.action.input).toMatchObject({
      confirm: true,
      riskAccepted: true
    });
  });

  it("resolves string boolean args directly from the core pack definition", () => {
    const socialPost = createCoreMacroPack().find((macro) => macro.name === "social.post");
    if (!socialPost) throw new Error("social.post macro missing");

    const parsed: ParsedMacro = {
      raw: "@social.post('x','timeline','ship',confirm='true',riskAccepted='false')",
      name: "social.post",
      positional: ["x", "timeline", "ship"],
      named: {
        confirm: "true",
        riskAccepted: "false"
      }
    };

    const resolved = socialPost.resolve(parsed);
    expect(resolved.input).toMatchObject({
      confirm: true,
      riskAccepted: false
    });
  });

  it("can register a full core pack manually", () => {
    const registry = new MacroRegistry();
    const pack = createCoreMacroPack();
    registry.registerPack(pack);

    expect(registry.list().length).toBe(pack.length);
    expect(registry.list().map((item) => item.name)).toContain("media.trend");
  });

  it("resolves macros via entrypoint helper", async () => {
    const resolution = await resolveMacro("@web.search('open dev browser')");
    expect(resolution.action.operation).toBe("search");
    expect(resolution.provenance.macro).toBe("web.search");
  });

  it("normalizes execute inputs and shape payload with optional metadata omitted", async () => {
    const runtime = {
      search: async (input: { query: string; filters?: Record<string, unknown> }, options?: { providerIds?: string[] }) => ({
        ok: true,
        records: [{ url: "https://example.com", provider: "web/default", source: "web", id: "1", timestamp: "2026-01-01T00:00:00.000Z", confidence: 0.5, attributes: {} }],
        trace: { requestId: "req", ts: "2026-01-01T00:00:00.000Z" },
        partial: false,
        failures: [],
        metrics: { attempted: 1, succeeded: 1, failed: 0, retries: 0, latencyMs: 1 },
        sourceSelection: "web",
        providerOrder: options?.providerIds ?? ["web/default"],
        ...(input.filters ? { diagnostics: { fromFilters: true } } : {})
      }),
      fetch: async () => {
        throw new Error("unused");
      },
      crawl: async () => {
        throw new Error("unused");
      },
      post: async () => {
        throw new Error("unused");
      }
    };

    const result = await executeMacroResolution({
      action: {
        source: "web",
        operation: "search",
        input: {
          query: "macro",
          filters: "not-an-object",
          providerId: "web/custom"
        }
      },
      provenance: {
        macro: "web.search",
        provider: "web/custom",
        resolvedQuery: "macro",
        pack: "core:web",
        args: { positional: [], named: {} }
      }
    }, runtime);

    expect(result.providerOrder).toEqual(["web/custom"]);
    const shaped = shapeExecutionPayload({
      ...result,
      meta: undefined,
      diagnostics: undefined
    });
    expect(shaped.meta.tier).toBeUndefined();
    expect(shaped.meta.provenance).toBeUndefined();
    expect(shaped.diagnostics).toBeUndefined();
  });

  it("rejects crawl execution when seed urls are absent after normalization", async () => {
    await expect(executeMacroResolution({
      action: {
        source: "web",
        operation: "crawl",
        input: {
          seedUrls: "not-an-array"
        }
      },
      provenance: {
        macro: "web.crawl",
        provider: "web/default",
        resolvedQuery: "crawl",
        pack: "core:web",
        args: { positional: [], named: {} }
      }
    }, {
      search: async () => {
        throw new Error("unused");
      },
      fetch: async () => {
        throw new Error("unused");
      },
      crawl: async () => {
        throw new Error("unused");
      },
      post: async () => {
        throw new Error("unused");
      }
    })).rejects.toThrow("Macro action missing crawl.seedUrls");
  });
});
