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

  it("passes object filters through search macro execution input", async () => {
    const runtime = {
      search: async (input: { query: string; filters?: Record<string, unknown> }) => ({
        ok: true,
        records: [],
        trace: { requestId: "req", ts: "2026-01-01T00:00:00.000Z" },
        partial: false,
        failures: [],
        metrics: { attempted: 1, succeeded: 1, failed: 0, retries: 0, latencyMs: 1 },
        sourceSelection: "web" as const,
        providerOrder: ["web/default"],
        diagnostics: {
          filters: input.filters ?? null
        }
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
          query: "macro filters",
          filters: {
            locale: "en-US",
            includeImages: true
          }
        }
      },
      provenance: {
        macro: "web.search",
        provider: "web/default",
        resolvedQuery: "macro filters",
        pack: "core:web",
        args: { positional: [], named: {} }
      }
    }, runtime);

    expect(result.diagnostics).toEqual({
      filters: {
        locale: "en-US",
        includeImages: true
      }
    });
  });

  it("rejects shell-only macro search results", async () => {
    const runtime = {
      search: async () => ({
        ok: true,
        records: [
          {
            id: "duckduckgo-challenge",
            source: "web" as const,
            provider: "web/default",
            url: "https://duckduckgo.com",
            title: "https://duckduckgo.com",
            content: "Unfortunately, bots use DuckDuckGo too. Please complete the following challenge.",
            timestamp: "2026-01-01T00:00:00.000Z",
            confidence: 0.5,
            attributes: {
              retrievalPath: "web:search:index",
              extractionQuality: {
                contentChars: 78
              }
            }
          },
          {
            id: "duckduckgo-index",
            source: "web" as const,
            provider: "web/default",
            url: "https://html.duckduckgo.com/html",
            title: "https://html.duckduckgo.com/html",
            content: "",
            timestamp: "2026-01-01T00:00:00.000Z",
            confidence: 0.5,
            attributes: {
              retrievalPath: "web:search:index",
              extractionQuality: {
                contentChars: 0
              }
            }
          }
        ],
        trace: { requestId: "req", ts: "2026-01-01T00:00:00.000Z" },
        partial: false,
        failures: [],
        metrics: { attempted: 1, succeeded: 1, failed: 0, retries: 0, latencyMs: 1 },
        sourceSelection: "web" as const,
        providerOrder: ["web/default"]
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

    await expect(executeMacroResolution({
      action: {
        source: "web",
        operation: "search",
        input: {
          query: "macro shell",
          providerId: "web/default"
        }
      },
      provenance: {
        macro: "web.search",
        provider: "web/default",
        resolvedQuery: "macro shell",
        pack: "core:web",
        args: { positional: [], named: {} }
      }
    }, runtime)).rejects.toThrow("Macro execution returned only shell records");
  });

  it("rejects shell-only community search results gated by Reddit verification walls", async () => {
    const runtime = {
      search: async () => ({
        ok: true,
        records: [
          {
            id: "reddit-verification-wall",
            source: "community" as const,
            provider: "community/default",
            url: "https://www.reddit.com/answers/example?q=browser+automation",
            title: "https://www.reddit.com/answers/example?q=browser+automation",
            content: "Reddit - The heart of the internet. Please wait for verification. Skip to main content.",
            timestamp: "2026-01-01T00:00:00.000Z",
            confidence: 0.5,
            attributes: {
              retrievalPath: "community:fetch:url"
            }
          }
        ],
        trace: { requestId: "req", ts: "2026-01-01T00:00:00.000Z" },
        partial: false,
        failures: [],
        metrics: { attempted: 1, succeeded: 1, failed: 0, retries: 0, latencyMs: 1 },
        sourceSelection: "community" as const,
        providerOrder: ["community/default"]
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

    await expect(executeMacroResolution({
      action: {
        source: "community",
        operation: "search",
        input: {
          query: "browser automation",
          providerId: "community/default"
        }
      },
      provenance: {
        macro: "community.search",
        provider: "community/default",
        resolvedQuery: "browser automation",
        pack: "core:community",
        args: { positional: [], named: {} }
      }
    }, runtime)).rejects.toThrow("Macro execution returned only shell records (challenge_shell).");
  });

  it("keeps web search results usable when a surviving document record uses the URL as its title", async () => {
    const runtime = {
      search: async () => ({
        ok: true,
        records: [
          {
            id: "duckduckgo-shell",
            source: "web" as const,
            provider: "web/default",
            url: "https://html.duckduckgo.com/html",
            title: "https://html.duckduckgo.com/html",
            content: "query at DuckDuckGo",
            timestamp: "2026-01-01T00:00:00.000Z",
            confidence: 0.75,
            attributes: {
              retrievalPath: "web:search:index",
              extractionQuality: {
                contentChars: 700
              }
            }
          },
          {
            id: "real-result",
            source: "web" as const,
            provider: "web/default",
            url: "https://developer.chrome.com/docs/extensions/reference/api/debugger",
            title: "https://developer.chrome.com/docs/extensions/reference/api/debugger",
            content: "",
            timestamp: "2026-01-01T00:00:00.000Z",
            confidence: 0.7,
            attributes: {
              retrievalPath: "web:search:index",
              extractionQuality: {
                contentChars: 0
              }
            }
          }
        ],
        trace: { requestId: "req", ts: "2026-01-01T00:00:00.000Z" },
        partial: false,
        failures: [],
        metrics: { attempted: 1, succeeded: 1, failed: 0, retries: 0, latencyMs: 1 },
        sourceSelection: "web" as const,
        providerOrder: ["web/default"]
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

    const output = await executeMacroResolution({
      action: {
        source: "web",
        operation: "search",
        input: {
          query: "chrome debugger attach",
          providerId: "web/default"
        }
      },
      provenance: {
        macro: "web.search",
        provider: "web/default",
        resolvedQuery: "chrome debugger attach",
        pack: "core:web",
        args: { positional: [], named: {} }
      }
    }, runtime);

    expect(output.records).toHaveLength(2);
    expect(output.records[0]?.url).toBe("https://developer.chrome.com/docs/extensions/reference/api/debugger");
    expect(output.records[1]?.url).toBe("https://html.duckduckgo.com/html");
  });

  it("keeps community search macro passes when a Reddit verification wall appears alongside a usable result", async () => {
    const runtime = {
      search: async () => ({
        ok: true,
        records: [
          {
            id: "reddit-verification-wall",
            source: "community" as const,
            provider: "community/default",
            url: "https://www.reddit.com/answers/example?q=browser+automation",
            title: "https://www.reddit.com/answers/example?q=browser+automation",
            content: "Reddit - The heart of the internet. Please wait for verification. Skip to main content.",
            timestamp: "2026-01-01T00:00:00.000Z",
            confidence: 0.5,
            attributes: {
              retrievalPath: "community:fetch:url"
            }
          },
          {
            id: "usable-community-record",
            source: "community" as const,
            provider: "community/default",
            url: "https://forum.example.com/t/browser-automation-checklist",
            title: "Browser automation checklist",
            content: "A working checklist for diagnosing browser automation failures across real sites.",
            timestamp: "2026-01-01T00:00:00.000Z",
            confidence: 0.8,
            attributes: {
              retrievalPath: "community:search:index"
            }
          }
        ],
        trace: { requestId: "req", ts: "2026-01-01T00:00:00.000Z" },
        partial: false,
        failures: [],
        metrics: { attempted: 1, succeeded: 1, failed: 0, retries: 0, latencyMs: 1 },
        sourceSelection: "community" as const,
        providerOrder: ["community/default"]
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
        source: "community",
        operation: "search",
        input: {
          query: "browser automation",
          providerId: "community/default"
        }
      },
      provenance: {
        macro: "community.search",
        provider: "community/default",
        resolvedQuery: "browser automation",
        pack: "core:community",
        args: { positional: [], named: {} }
      }
    }, runtime);

    expect(result.records).toHaveLength(2);
  });

  it("rejects shell-only X social search results gated by javascript-required shells", async () => {
    const runtime = {
      search: async () => ({
        ok: true,
        records: [
          {
            id: "x-js-shell",
            source: "social" as const,
            provider: "social/x",
            url: "https://x.com/search?q=browser+automation&f=live&page=1",
            title: "X search",
            content: "JavaScript is disabled in this browser. Please enable JavaScript.",
            timestamp: "2026-01-01T00:00:00.000Z",
            confidence: 0.5,
            attributes: {
              retrievalPath: "social:search:index"
            }
          }
        ],
        trace: { requestId: "req", ts: "2026-01-01T00:00:00.000Z" },
        partial: false,
        failures: [],
        metrics: { attempted: 1, succeeded: 1, failed: 0, retries: 0, latencyMs: 1 },
        sourceSelection: "social" as const,
        providerOrder: ["social/x"]
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

    await expect(executeMacroResolution({
      action: {
        source: "social",
        operation: "search",
        input: {
          query: "browser automation",
          providerId: "social/x"
        }
      },
      provenance: {
        macro: "media.search",
        provider: "social/x",
        resolvedQuery: "browser automation",
        pack: "core:media",
        args: { positional: [], named: {} }
      }
    }, runtime)).rejects.toThrow("Macro execution returned only shell records (social_js_required_shell).");
  });

  it("keeps single-record X social macro results when warning text coexists with a usable X link", async () => {
    const runtime = {
      search: async () => ({
        ok: true,
        records: [
          {
            id: "x-mixed-search-record",
            source: "social" as const,
            provider: "social/x",
            url: "https://x.com/search?q=browser+automation&f=live&page=1",
            title: "X search",
            content: "JavaScript is disabled in this browser. Please enable JavaScript. Top Latest People Media Lists.",
            timestamp: "2026-01-01T00:00:00.000Z",
            confidence: 0.8,
            attributes: {
              retrievalPath: "social:search:index",
              links: [
                "https://x.com/acct/status/1"
              ]
            }
          }
        ],
        trace: { requestId: "req", ts: "2026-01-01T00:00:00.000Z" },
        partial: false,
        failures: [],
        metrics: { attempted: 1, succeeded: 1, failed: 0, retries: 0, latencyMs: 1 },
        sourceSelection: "social" as const,
        providerOrder: ["social/x"]
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
        source: "social",
        operation: "search",
        input: {
          query: "browser automation",
          providerId: "social/x"
        }
      },
      provenance: {
        macro: "media.search",
        provider: "social/x",
        resolvedQuery: "browser automation",
        pack: "core:media",
        args: { positional: [], named: {} }
      }
    }, runtime);

    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.attributes.links).toContain("https://x.com/acct/status/1");
  });

  it("rejects concrete X post urls when expanded content is only a javascript shell", async () => {
    const runtime = {
      search: async () => ({
        ok: true,
        records: [
          {
            id: "x-fallback-post-record",
            source: "social" as const,
            provider: "social/x",
            url: "https://x.com/acct/status/1",
            title: "https://x.com/acct/status/1",
            content: "JavaScript is not available. Please enable JavaScript or switch to a supported browser. Something went wrong. Try again.",
            timestamp: "2026-01-01T00:00:00.000Z",
            confidence: 0.8,
            attributes: {
              retrievalPath: "social:search:index",
              links: [
                "https://x.com/acct/status/1"
              ]
            }
          }
        ],
        trace: { requestId: "req", ts: "2026-01-01T00:00:00.000Z" },
        partial: false,
        failures: [],
        metrics: { attempted: 1, succeeded: 1, failed: 0, retries: 0, latencyMs: 1 },
        sourceSelection: "social" as const,
        providerOrder: ["social/x"]
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

    await expect(executeMacroResolution({
      action: {
        source: "social",
        operation: "search",
        input: {
          query: "browser automation",
          providerId: "social/x"
        }
      },
      provenance: {
        macro: "media.search",
        provider: "social/x",
        resolvedQuery: "browser automation",
        pack: "core:media",
        args: { positional: [], named: {} }
      }
    }, runtime)).rejects.toThrow("Macro execution returned only shell records (social_js_required_shell).");
  });

  it("rejects shell-only X social macro results when only policy and help links are present", async () => {
    const runtime = {
      search: async () => ({
        ok: true,
        records: [
          {
            id: "x-search-shell",
            source: "social" as const,
            provider: "social/x",
            url: "https://x.com/search?q=browser+automation&f=live&page=1",
            title: "X search",
            content: "JavaScript is disabled in this browser. Please enable JavaScript. Something went wrong, but don't fret.",
            timestamp: "2026-01-01T00:00:00.000Z",
            confidence: 0.5,
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
            source: "social" as const,
            provider: "social/x",
            url: "https://legal.x.com/de/imprint.html",
            title: "Legal",
            content: "Imprint",
            timestamp: "2026-01-01T00:00:00.000Z",
            confidence: 0.5,
            attributes: {
              retrievalPath: "social:fetch:url"
            }
          }
        ],
        trace: { requestId: "req", ts: "2026-01-01T00:00:00.000Z" },
        partial: false,
        failures: [],
        metrics: { attempted: 1, succeeded: 1, failed: 0, retries: 0, latencyMs: 1 },
        sourceSelection: "social" as const,
        providerOrder: ["social/x"]
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

    await expect(executeMacroResolution({
      action: {
        source: "social",
        operation: "search",
        input: {
          query: "browser automation",
          providerId: "social/x"
        }
      },
      provenance: {
        macro: "media.search",
        provider: "social/x",
        resolvedQuery: "browser automation",
        pack: "core:media",
        args: { positional: [], named: {} }
      }
    }, runtime)).rejects.toThrow("Macro execution returned only shell records");
  });

  it("rejects shell-only X social macro results when only first-party metadata links are present", async () => {
    const runtime = {
      search: async () => ({
        ok: true,
        records: [
          {
            id: "x-search-shell",
            source: "social" as const,
            provider: "social/x",
            url: "https://x.com/search?q=browser+automation&f=live&page=1",
            title: "X search",
            content: "JavaScript is not available. We’ve detected that JavaScript is disabled in this browser.",
            timestamp: "2026-01-01T00:00:00.000Z",
            confidence: 0.5,
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
        trace: { requestId: "req", ts: "2026-01-01T00:00:00.000Z" },
        partial: false,
        failures: [],
        metrics: { attempted: 1, succeeded: 1, failed: 0, retries: 0, latencyMs: 1 },
        sourceSelection: "social" as const,
        providerOrder: ["social/x"]
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

    await expect(executeMacroResolution({
      action: {
        source: "social",
        operation: "search",
        input: {
          query: "browser automation",
          providerId: "social/x"
        }
      },
      provenance: {
        macro: "media.search",
        provider: "social/x",
        resolvedQuery: "browser automation",
        pack: "core:media",
        args: { positional: [], named: {} }
      }
    }, runtime)).rejects.toThrow("Macro execution returned only shell records (social_js_required_shell).");
  });

  it("rejects shell-only Reddit social search results gated by verification walls", async () => {
    const runtime = {
      search: async () => ({
        ok: true,
        records: [
          {
            id: "reddit-verification-wall",
            source: "social" as const,
            provider: "social/reddit",
            url: "https://www.reddit.com/search/?q=browser+automation",
            title: "Reddit search",
            content: "Please wait for verification.",
            timestamp: "2026-01-01T00:00:00.000Z",
            confidence: 0.5,
            attributes: {
              retrievalPath: "social:search:index"
            }
          }
        ],
        trace: { requestId: "req", ts: "2026-01-01T00:00:00.000Z" },
        partial: false,
        failures: [],
        metrics: { attempted: 1, succeeded: 1, failed: 0, retries: 0, latencyMs: 1 },
        sourceSelection: "social" as const,
        providerOrder: ["social/reddit"]
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

    await expect(executeMacroResolution({
      action: {
        source: "social",
        operation: "search",
        input: {
          query: "browser automation",
          providerId: "social/reddit"
        }
      },
      provenance: {
        macro: "media.search",
        provider: "social/reddit",
        resolvedQuery: "browser automation",
        pack: "core:media",
        args: { positional: [], named: {} }
      }
    }, runtime)).rejects.toThrow("Macro execution returned only shell records (social_verification_wall).");
  });

  it("rejects shell-only Reddit social search results that land on non-content routes", async () => {
    const runtime = {
      search: async () => ({
        ok: true,
        records: [
          {
            id: "reddit-submit-shell",
            source: "social" as const,
            provider: "social/reddit",
            url: "https://www.reddit.com/submit",
            title: "Submit to Reddit",
            content: "Submit to Reddit",
            timestamp: "2026-01-01T00:00:00.000Z",
            confidence: 0.5,
            attributes: {
              retrievalPath: "social:fetch:url"
            }
          }
        ],
        trace: { requestId: "req", ts: "2026-01-01T00:00:00.000Z" },
        partial: false,
        failures: [],
        metrics: { attempted: 1, succeeded: 1, failed: 0, retries: 0, latencyMs: 1 },
        sourceSelection: "social" as const,
        providerOrder: ["social/reddit"]
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

    await expect(executeMacroResolution({
      action: {
        source: "social",
        operation: "search",
        input: {
          query: "browser automation",
          providerId: "social/reddit"
        }
      },
      provenance: {
        macro: "media.search",
        provider: "social/reddit",
        resolvedQuery: "browser automation",
        pack: "core:media",
        args: { positional: [], named: {} }
      }
    }, runtime)).rejects.toThrow("Macro execution returned only shell records (social_render_shell).");
  });

  it("rejects shell-only Bluesky social search results that land on first-party docs", async () => {
    const runtime = {
      search: async () => ({
        ok: true,
        records: [
          {
            id: "bluesky-help-shell",
            source: "social" as const,
            provider: "social/bluesky",
            url: "https://atproto.com/guides/overview",
            title: "AT Protocol",
            content: "Overview",
            timestamp: "2026-01-01T00:00:00.000Z",
            confidence: 0.5,
            attributes: {
              retrievalPath: "social:fetch:url"
            }
          }
        ],
        trace: { requestId: "req", ts: "2026-01-01T00:00:00.000Z" },
        partial: false,
        failures: [],
        metrics: { attempted: 1, succeeded: 1, failed: 0, retries: 0, latencyMs: 1 },
        sourceSelection: "social" as const,
        providerOrder: ["social/bluesky"]
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

    await expect(executeMacroResolution({
      action: {
        source: "social",
        operation: "search",
        input: {
          query: "browser automation",
          providerId: "social/bluesky"
        }
      },
      provenance: {
        macro: "media.search",
        provider: "social/bluesky",
        resolvedQuery: "browser automation",
        pack: "core:media",
        args: { positional: [], named: {} }
      }
    }, runtime)).rejects.toThrow("Macro execution returned only shell records (social_first_party_help_shell).");
  });

  it("rejects logged-out Bluesky search results when only feed and help links are present", async () => {
    const runtime = {
      search: async () => ({
        ok: true,
        records: [
          {
            id: "bluesky-search-shell",
            source: "social" as const,
            provider: "social/bluesky",
            url: "https://bsky.app/search?q=browser+automation&page=1",
            title: "Explore - Bluesky",
            content: "Search is currently unavailable when logged out. Bluesky JavaScript Required.",
            timestamp: "2026-01-01T00:00:00.000Z",
            confidence: 0.5,
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
            source: "social" as const,
            provider: "social/bluesky",
            url: "https://blueskyweb.zendesk.com/hc/en-us",
            title: "Bluesky Help",
            content: "Help center",
            timestamp: "2026-01-01T00:00:00.000Z",
            confidence: 0.5,
            attributes: {
              retrievalPath: "social:fetch:url"
            }
          }
        ],
        trace: { requestId: "req", ts: "2026-01-01T00:00:00.000Z" },
        partial: false,
        failures: [],
        metrics: { attempted: 1, succeeded: 1, failed: 0, retries: 0, latencyMs: 1 },
        sourceSelection: "social" as const,
        providerOrder: ["social/bluesky"]
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

    await expect(executeMacroResolution({
      action: {
        source: "social",
        operation: "search",
        input: {
          query: "browser automation",
          providerId: "social/bluesky"
        }
      },
      provenance: {
        macro: "media.search",
        provider: "social/bluesky",
        resolvedQuery: "browser automation",
        pack: "core:media",
        args: { positional: [], named: {} }
      }
    }, runtime)).rejects.toThrow("Macro execution returned only shell records");
  });

  it("rejects feed-only Bluesky js-required search results", async () => {
    const runtime = {
      search: async () => ({
        ok: true,
        records: [
          {
            id: "bluesky-feed-only-shell",
            source: "social" as const,
            provider: "social/bluesky",
            url: "https://bsky.app/search?q=browser+automation&page=1",
            title: "Bluesky Search",
            content: "Bluesky JavaScript Required Top Latest.",
            timestamp: "2026-01-01T00:00:00.000Z",
            confidence: 0.5,
            attributes: {
              retrievalPath: "social:search:index",
              links: [
                "https://bsky.app/profile/trending.bsky.app/feed/665497821"
              ]
            }
          }
        ],
        trace: { requestId: "req", ts: "2026-01-01T00:00:00.000Z" },
        partial: false,
        failures: [],
        metrics: { attempted: 1, succeeded: 1, failed: 0, retries: 0, latencyMs: 1 },
        sourceSelection: "social" as const,
        providerOrder: ["social/bluesky"]
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

    await expect(executeMacroResolution({
      action: {
        source: "social",
        operation: "search",
        input: {
          query: "browser automation",
          providerId: "social/bluesky"
        }
      },
      provenance: {
        macro: "media.search",
        provider: "social/bluesky",
        resolvedQuery: "browser automation",
        pack: "core:media",
        args: { positional: [], named: {} }
      }
    }, runtime)).rejects.toThrow("Macro execution returned only shell records (social_js_required_shell).");
  });

  it("rejects signed-in Bluesky navigation-only search results when only profile and shell links are present", async () => {
    const runtime = {
      search: async () => ({
        ok: true,
        records: [
          {
            id: "bluesky-nav-shell",
            source: "social" as const,
            provider: "social/bluesky",
            url: "https://bsky.app/search?page=1&q=browser+automation+bluesky",
            title: "bluesky search: browser automation bluesky",
            content: "All languages Top Latest People Feeds Home Explore Notifications Chat Feeds Lists Saved Profile Settings New Post Feedback Privacy Terms Help",
            timestamp: "2026-01-01T00:00:00.000Z",
            confidence: 0.5,
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
        trace: { requestId: "req", ts: "2026-01-01T00:00:00.000Z" },
        partial: false,
        failures: [],
        metrics: { attempted: 1, succeeded: 1, failed: 0, retries: 0, latencyMs: 1 },
        sourceSelection: "social" as const,
        providerOrder: ["social/bluesky"]
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

    await expect(executeMacroResolution({
      action: {
        source: "social",
        operation: "search",
        input: {
          query: "browser automation",
          providerId: "social/bluesky"
        }
      },
      provenance: {
        macro: "media.search",
        provider: "social/bluesky",
        resolvedQuery: "browser automation",
        pack: "core:media",
        args: { positional: [], named: {} }
      }
    }, runtime)).rejects.toThrow("Macro execution returned only shell records (social_render_shell).");
  });

  it("keeps social search macro passes when a shell record appears alongside a usable X result", async () => {
    const runtime = {
      search: async () => ({
        ok: true,
        records: [
          {
            id: "x-js-shell",
            source: "social" as const,
            provider: "social/x",
            url: "https://x.com/search?q=browser+automation&f=live&page=1",
            title: "X search",
            content: "JavaScript is disabled in this browser. Please enable JavaScript.",
            timestamp: "2026-01-01T00:00:00.000Z",
            confidence: 0.5,
            attributes: {
              retrievalPath: "social:search:index"
            }
          },
          {
            id: "usable-x-post",
            source: "social" as const,
            provider: "social/x",
            url: "https://x.com/acct/status/1",
            title: "Browser automation on X",
            content: "A real X post about browser automation.",
            timestamp: "2026-01-01T00:00:00.000Z",
            confidence: 0.8,
            attributes: {
              retrievalPath: "social:fetch:url"
            }
          }
        ],
        trace: { requestId: "req", ts: "2026-01-01T00:00:00.000Z" },
        partial: false,
        failures: [],
        metrics: { attempted: 1, succeeded: 1, failed: 0, retries: 0, latencyMs: 1 },
        sourceSelection: "social" as const,
        providerOrder: ["social/x"]
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
        source: "social",
        operation: "search",
        input: {
          query: "browser automation",
          providerId: "social/x"
        }
      },
      provenance: {
        macro: "media.search",
        provider: "social/x",
        resolvedQuery: "browser automation",
        pack: "core:media",
        args: { positional: [], named: {} }
      }
    }, runtime);

    expect(result.records).toHaveLength(2);
  });

  it("rejects shell-only macro fetch results with truncated chrome bodies", async () => {
    const runtime = {
      search: async () => {
        throw new Error("unused");
      },
      fetch: async () => ({
        ok: true,
        records: [
          {
            id: "mdn-fetch",
            source: "web" as const,
            provider: "web/default",
            url: "https://developer.mozilla.org/en-US/docs/Web/API/Document/querySelector",
            title: "Document: querySelector() method - Web APIs | MDN",
            content: "\"The",
            timestamp: "2026-01-01T00:00:00.000Z",
            confidence: 0.5,
            attributes: {
              links: Array.from({ length: 30 }, (_, index) => `https://example.com/${index}`),
              extractionQuality: {
                contentChars: 4
              }
            }
          }
        ],
        trace: { requestId: "req", ts: "2026-01-01T00:00:00.000Z" },
        partial: false,
        failures: [],
        metrics: { attempted: 1, succeeded: 1, failed: 0, retries: 0, latencyMs: 1 },
        sourceSelection: "web" as const,
        providerOrder: ["web/default"],
        meta: {
          provenance: {
            retrievalPath: "fetch:developer.mozilla.org"
          }
        }
      }),
      crawl: async () => {
        throw new Error("unused");
      },
      post: async () => {
        throw new Error("unused");
      }
    };

    await expect(executeMacroResolution({
      action: {
        source: "web",
        operation: "fetch",
        input: {
          url: "https://developer.mozilla.org/en-US/docs/Web/API/Document/querySelector",
          providerId: "web/default"
        }
      },
      provenance: {
        macro: "web.fetch",
        provider: "web/default",
        resolvedQuery: "https://developer.mozilla.org/en-US/docs/Web/API/Document/querySelector",
        pack: "core:web",
        args: { positional: [], named: {} }
      }
    }, runtime)).rejects.toThrow("Macro execution returned only shell records");
  });

  it("forwards challenge automation mode into provider run options", async () => {
    let receivedOptions: Record<string, unknown> | undefined;
    const runtime = {
      search: async (_input: { query: string }, options?: Record<string, unknown>) => {
        receivedOptions = options;
        return {
          ok: true,
          records: [],
          trace: { requestId: "req", ts: "2026-01-01T00:00:00.000Z" },
          partial: false,
          failures: [],
          metrics: { attempted: 1, succeeded: 1, failed: 0, retries: 0, latencyMs: 1 },
          sourceSelection: "web" as const,
          providerOrder: ["web/default"]
        };
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
    };

    await executeMacroResolution({
      action: {
        source: "web",
        operation: "search",
        input: {
          query: "macro challenge mode"
        }
      },
      provenance: {
        macro: "web.search",
        provider: "web/default",
        resolvedQuery: "macro challenge mode",
        pack: "core:web",
        args: { positional: [], named: {} }
      }
    }, runtime, {
      useCookies: true,
      challengeAutomationMode: "browser_with_helper",
      cookiePolicyOverride: "required"
    });

    expect(receivedOptions).toMatchObject({
      source: "web",
      challengeAutomationMode: "browser_with_helper",
      runtimePolicy: {
        useCookies: true,
        cookiePolicyOverride: "required"
      }
    });
  });

  it("rejects numeric boolean arguments in core macros", async () => {
    const registry = createDefaultMacroRegistry();
    await expect(registry.resolve("@community.post('timeline','ship',confirm=1)"))
      .rejects.toThrow("expects boolean argument");
  });
});
