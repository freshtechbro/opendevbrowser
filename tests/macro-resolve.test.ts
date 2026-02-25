import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderAggregateResult } from "../src/providers/types";

vi.mock("@opencode-ai/plugin", async () => {
  const { z } = await import("zod");
  const toolFn = (input: { description: string; args: unknown; execute: (...args: unknown[]) => unknown }) => input;
  toolFn.schema = z;
  return { tool: toolFn };
});

type ToolOutput = {
  ok: boolean;
  error?: { message: string; code?: string };
  runtime?: string;
  resolution?: {
    action: { source: string; operation: string; input: Record<string, unknown> };
    provenance: { macro: string; provider: string; resolvedQuery: string; pack: string };
  };
  catalog?: Array<{ name: string; pack?: string; description?: string }>;
  execution?: {
    records: unknown[];
    failures: unknown[];
    metrics: {
      attempted: number;
      succeeded: number;
      failed: number;
      retries: number;
      latencyMs: number;
    };
    meta: {
      ok: boolean;
      partial: boolean;
      sourceSelection: string;
      providerOrder: string[];
      trace: Record<string, unknown>;
      tier?: {
        selected: string;
        reasonCode: string;
      };
      provenance?: {
        provider: string;
        retrievalPath: string;
        retrievedAt: string;
      };
      error?: Record<string, unknown>;
      blocker?: {
        schemaVersion: string;
        type: string;
        confidence: number;
      };
    };
    diagnostics?: Record<string, unknown>;
  };
};

const parse = (value: string): ToolOutput => JSON.parse(value) as ToolOutput;

const makeAggregate = (
  overrides: Partial<ProviderAggregateResult> = {}
): ProviderAggregateResult => ({
  ok: true,
  records: [],
  trace: {
    requestId: "macro-resolve-test",
    ts: "2026-01-01T00:00:00.000Z"
  },
  partial: false,
  failures: [],
  metrics: {
    attempted: 1,
    succeeded: 1,
    failed: 0,
    retries: 0,
    latencyMs: 1
  },
  sourceSelection: "web",
  providerOrder: ["web/default"],
  meta: {
    tier: {
      selected: "A",
      reasonCode: "default_tier"
    },
    provenance: {
      provider: "web/default",
      retrievalPath: "search:web/default",
      retrievedAt: "2026-01-01T00:00:00.000Z"
    }
  },
  diagnostics: {
    adaptiveConcurrency: {
      enabled: true,
      scope: "web/default",
      global: { limit: 4, min: 1, max: 8 },
      scoped: { limit: 2, min: 1, max: 4 }
    },
    promptGuard: {
      enabled: true,
      quarantinedSegments: 1,
      entries: 1
    },
    realism: {
      violations: 0,
      patterns: []
    }
  },
  ...overrides
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.doUnmock("../src/macros");
});

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
    const url = String(input);
    return {
      status: 200,
      url,
      text: async () => `<html><body><main>macro content ${url}</main><a href="https://example.com/result">result</a></body></html>`
    };
  }) as unknown as typeof fetch);
});

describe("macro resolve tool", () => {
  it("parses fallback macros with and without args", async () => {
    const { __test__ } = await import("../src/tools/macro_resolve");

    const parsed = __test__.parseFallbackMacro("@web.search('open dev browser', 'ignored')", "community/custom");
    expect(parsed).toMatchObject({
      action: {
        source: "web",
        operation: "search",
        input: { query: "open dev browser", providerId: "community/custom", limit: 10 }
      },
      provenance: {
        macro: "web.search",
        provider: "community/custom",
        resolvedQuery: "open dev browser",
        pack: "fallback"
      }
    });

    const noArgs = __test__.parseFallbackMacro("@media.trend");
    expect(noArgs.provenance.resolvedQuery).toBe("media.trend");

    expect(() => __test__.parseFallbackMacro("web.search('x')"))
      .toThrow("must start with '@'");
    expect(() => __test__.parseFallbackMacro("@"))
      .toThrow("Macro name is required");
  }, 15000);

  it("uses runtime registry and returns optional catalog", async () => {
    const resolve = vi.fn(async () => ({
      action: {
        source: "web",
        operation: "search",
        input: { query: "runtime query", providerId: "web/default", limit: 5 }
      },
      provenance: {
        macro: "web.search",
        provider: "web/default",
        resolvedQuery: "runtime query",
        pack: "core:web"
      }
    }));
    const list = vi.fn(() => [{ name: "web.search", pack: "core:web", description: "search web" }]);

    vi.doMock("../src/macros", () => ({
      createDefaultMacroRegistry: () => ({ resolve, list })
    }));

    const { createMacroResolveTool } = await import("../src/tools/macro_resolve");
    const tool = createMacroResolveTool({} as never);

    const result = parse(await tool.execute({
      expression: "@web.search('runtime query')",
      includeCatalog: true
    }));
    expect(result.ok).toBe(true);
    expect(result.runtime).toBe("macros");
    expect(result.resolution?.provenance.macro).toBe("web.search");
    expect(result.catalog).toEqual([{ name: "web.search", pack: "core:web", description: "search web" }]);
    expect(resolve).toHaveBeenCalledWith("@web.search('runtime query')", { defaultProvider: undefined });

    const noCatalog = parse(await tool.execute({
      expression: "@web.search('runtime query')",
      includeCatalog: false
    }));
    expect(noCatalog.ok).toBe(true);
    expect(noCatalog.catalog).toBeUndefined();
    expect(noCatalog.execution).toBeUndefined();
  });

  it("returns additive execution payload when execute is enabled", async () => {
    const resolve = vi.fn(async () => ({
      action: {
        source: "community",
        operation: "search",
        input: { query: "runtime execute", providerId: "community/default", limit: 3 }
      },
      provenance: {
        macro: "community.search",
        provider: "community/default",
        resolvedQuery: "runtime execute",
        pack: "core:community",
        args: {
          positional: [],
          named: {}
        }
      }
    }));

    vi.doMock("../src/macros", () => ({
      createDefaultMacroRegistry: () => ({
        resolve,
        list: () => []
      })
    }));

    const { createMacroResolveTool } = await import("../src/tools/macro_resolve");
    const tool = createMacroResolveTool({} as never);

    const result = parse(await tool.execute({
      expression: "@community.search('runtime execute')",
      execute: true
    }));

    expect(result.ok).toBe(true);
    expect(result.runtime).toBe("macros");
    expect(result.resolution?.provenance.macro).toBe("community.search");
    expect(result.execution).toMatchObject({
      metrics: {
        attempted: 1,
        retries: expect.any(Number),
        latencyMs: expect.any(Number)
      },
      meta: {
        sourceSelection: "community",
        tier: {
          selected: expect.any(String),
          reasonCode: expect.any(String)
        },
        provenance: {
          provider: expect.any(String),
          retrievalPath: expect.any(String),
          retrievedAt: expect.any(String)
        }
      }
    });
    expect(typeof result.execution?.meta.ok).toBe("boolean");
    expect(Array.isArray(result.execution?.records)).toBe(true);
    expect(Array.isArray(result.execution?.failures)).toBe(true);
    expect(result.execution?.meta.ok).toBe(true);
    expect(result.execution?.records.length ?? 0).toBeGreaterThan(0);
  });

  it("surfaces blocker metadata in execution meta for blocked runtime fetch", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("x.com/i/flow/login")) {
        return {
          status: 403,
          url,
          text: async () => "<html><body>login</body></html>"
        };
      }
      return {
        status: 200,
        url,
        text: async () => "<html><body>ok</body></html>"
      };
    }) as unknown as typeof fetch);

    vi.doMock("../src/macros", () => ({
      createDefaultMacroRegistry: () => ({
        resolve: async () => ({
          action: {
            source: "web",
            operation: "fetch",
            input: { url: "https://x.com/i/flow/login", providerId: "web/default" }
          },
          provenance: {
            macro: "web.fetch",
            provider: "web/default",
            resolvedQuery: "https://x.com/i/flow/login",
            pack: "core:web",
            args: { positional: [], named: {} }
          }
        }),
        list: () => []
      })
    }));

    const { createMacroResolveTool } = await import("../src/tools/macro_resolve");
    const tool = createMacroResolveTool({} as never);
    const result = parse(await tool.execute({
      expression: "@web.fetch(\"https://x.com/i/flow/login\")",
      execute: true
    }));

    expect(result.ok).toBe(true);
    expect(result.execution?.meta.ok).toBe(false);
    expect(result.execution?.meta.blocker?.type).toBe("auth_required");
  });

  it("falls back when runtime module cannot load", async () => {
    vi.doMock("../src/macros", () => {
      throw new Error("runtime unavailable");
    });

    const { createMacroResolveTool } = await import("../src/tools/macro_resolve");
    const tool = createMacroResolveTool({} as never);

    const result = parse(await tool.execute({
      expression: "@community.search('fallback query')",
      defaultProvider: "web/custom"
    }));

    expect(result.ok).toBe(true);
    expect(result.runtime).toBe("fallback");
    expect(result.resolution).toMatchObject({
      action: {
        source: "web",
        operation: "search",
        input: { query: "fallback query", providerId: "web/custom", limit: 10 }
      },
      provenance: {
        macro: "community.search",
        provider: "web/custom",
        resolvedQuery: "fallback query",
        pack: "fallback"
      }
    });
  });

  it("returns structured failures for invalid expression and runtime errors", async () => {
    vi.doMock("../src/macros", () => {
      throw new Error("runtime unavailable");
    });

    const { createMacroResolveTool } = await import("../src/tools/macro_resolve");
    const tool = createMacroResolveTool({} as never);

    const invalid = parse(await tool.execute({
      expression: "web.search('invalid')"
    }));
    expect(invalid).toEqual({
      ok: false,
      error: {
        message: "Macro expressions must start with '@'",
        code: "macro_resolve_failed"
      }
    });

    vi.resetModules();
    vi.doMock("../src/macros", () => ({
      createDefaultMacroRegistry: () => ({
        resolve: async () => {
          throw new Error("runtime exploded");
        },
        list: () => []
      })
    }));

    const { createMacroResolveTool: createFailingTool } = await import("../src/tools/macro_resolve");
    const failingTool = createFailingTool({} as never);

    const failed = parse(await failingTool.execute({
      expression: "@web.search('x')"
    }));
    expect(failed).toEqual({
      ok: false,
      error: {
        message: "runtime exploded",
        code: "macro_resolve_failed"
      }
    });
  });

  it("executes fetch/crawl/post actions with normalized input and provider options", async () => {
    const resolve = vi.fn()
      .mockResolvedValueOnce({
        action: {
          source: "web",
          operation: "fetch",
          input: {
            url: "https://example.com/article",
            filters: { locale: "en" },
            providerId: " web/custom "
          }
        },
        provenance: {
          macro: "web.fetch",
          provider: "web/custom",
          resolvedQuery: "https://example.com/article",
          pack: "core:web",
          args: { positional: [], named: {} }
        }
      })
      .mockResolvedValueOnce({
        action: {
          source: "web",
          operation: "crawl",
          input: {
            seedUrls: [" https://example.com/start ", "", "https://example.com/next"],
            strategy: "dfs",
            maxDepth: 2,
            maxPages: 4,
            maxPerDomain: 1,
            filters: { section: "docs" },
            providerId: "   "
          }
        },
        provenance: {
          macro: "web.crawl",
          provider: "web/default",
          resolvedQuery: "crawl",
          pack: "core:web",
          args: { positional: [], named: {} }
        }
      })
      .mockResolvedValueOnce({
        action: {
          source: "community",
          operation: "post",
          input: {
            target: "updates",
            content: "hello world",
            mediaUrls: [" https://cdn.local/1.png ", "", "https://cdn.local/2.png"],
            confirm: true,
            riskAccepted: false,
            metadata: { campaign: "launch" },
            providerId: "community/custom"
          }
        },
        provenance: {
          macro: "community.post",
          provider: "community/custom",
          resolvedQuery: "hello world",
          pack: "core:community",
          args: { positional: [], named: {} }
        }
      });

    vi.doMock("../src/macros", () => ({
      createDefaultMacroRegistry: () => ({
        resolve,
        list: () => []
      })
    }));

    const providerRuntime = {
      search: vi.fn(async () => makeAggregate()),
      fetch: vi.fn(async () => makeAggregate({
        error: {
          code: "upstream",
          message: "soft failure metadata",
          retryable: false
        },
        sourceSelection: "web",
        providerOrder: ["web/custom"]
      })),
      crawl: vi.fn(async () => makeAggregate({
        sourceSelection: "web",
        providerOrder: ["web/default"]
      })),
      post: vi.fn(async () => makeAggregate({
        sourceSelection: "community",
        providerOrder: ["community/custom"]
      }))
    };

    const { createMacroResolveTool } = await import("../src/tools/macro_resolve");
    const tool = createMacroResolveTool({ providerRuntime } as never);

    const fetchResult = parse(await tool.execute({ expression: "@web.fetch('x')", execute: true }));
    expect(fetchResult.ok).toBe(true);
    expect(providerRuntime.fetch).toHaveBeenCalledWith(
      {
        url: "https://example.com/article",
        filters: { locale: "en" }
      },
      {
        source: "web",
        providerIds: ["web/custom"]
      }
    );
    expect(fetchResult.execution?.meta.error).toEqual({
      code: "upstream",
      message: "soft failure metadata",
      retryable: false
    });
    expect(fetchResult.execution?.meta.tier).toEqual({
      selected: "A",
      reasonCode: "default_tier"
    });
    expect(fetchResult.execution?.meta.provenance).toEqual({
      provider: "web/default",
      retrievalPath: "search:web/default",
      retrievedAt: "2026-01-01T00:00:00.000Z"
    });
    expect(fetchResult.execution?.diagnostics).toMatchObject({
      promptGuard: {
        enabled: true,
        quarantinedSegments: 1,
        entries: 1
      }
    });

    const crawlResult = parse(await tool.execute({ expression: "@web.crawl('x')", execute: true }));
    expect(crawlResult.ok).toBe(true);
    expect(providerRuntime.crawl).toHaveBeenCalledWith(
      {
        seedUrls: ["https://example.com/start", "https://example.com/next"],
        strategy: "dfs",
        maxDepth: 2,
        maxPages: 4,
        maxPerDomain: 1,
        filters: { section: "docs" }
      },
      {
        source: "web"
      }
    );

    const postResult = parse(await tool.execute({ expression: "@community.post('x')", execute: true }));
    expect(postResult.ok).toBe(true);
    expect(providerRuntime.post).toHaveBeenCalledWith(
      {
        target: "updates",
        content: "hello world",
        mediaUrls: ["https://cdn.local/1.png", "https://cdn.local/2.png"],
        confirm: true,
        riskAccepted: false,
        metadata: { campaign: "launch" }
      },
      {
        source: "community",
        providerIds: ["community/custom"]
      }
    );
    expect(providerRuntime.search).not.toHaveBeenCalled();
  });

  it("returns execution failures for invalid action payloads and unsupported operations", async () => {
    const resolve = vi.fn()
      .mockResolvedValueOnce({
        action: {
          source: "web",
          operation: "fetch",
          input: []
        },
        provenance: {
          macro: "web.fetch",
          provider: "web/default",
          resolvedQuery: "fetch",
          pack: "core:web",
          args: { positional: [], named: {} }
        }
      })
      .mockResolvedValueOnce({
        action: {
          source: "web",
          operation: "broadcast",
          input: {
            query: "hello"
          }
        },
        provenance: {
          macro: "web.broadcast",
          provider: "web/default",
          resolvedQuery: "broadcast",
          pack: "core:web",
          args: { positional: [], named: {} }
        }
      })
      .mockResolvedValueOnce({
        action: {
          source: "web",
          operation: "fetch",
          input: {
            url: "  "
          }
        },
        provenance: {
          macro: "web.fetch",
          provider: "web/default",
          resolvedQuery: "fetch",
          pack: "core:web",
          args: { positional: [], named: {} }
        }
      })
      .mockResolvedValueOnce({
        action: {
          source: "web",
          operation: "crawl",
          input: {
            seedUrls: ["", 3]
          }
        },
        provenance: {
          macro: "web.crawl",
          provider: "web/default",
          resolvedQuery: "crawl",
          pack: "core:web",
          args: { positional: [], named: {} }
        }
      })
      .mockResolvedValueOnce({
        action: {
          source: "community",
          operation: "post",
          input: {
            target: "updates",
            content: ""
          }
        },
        provenance: {
          macro: "community.post",
          provider: "community/default",
          resolvedQuery: "post",
          pack: "core:community",
          args: { positional: [], named: {} }
        }
      });

    vi.doMock("../src/macros", () => ({
      createDefaultMacroRegistry: () => ({
        resolve,
        list: () => []
      })
    }));

    const providerRuntime = {
      search: vi.fn(async () => makeAggregate()),
      fetch: vi.fn(async () => makeAggregate()),
      crawl: vi.fn(async () => makeAggregate()),
      post: vi.fn(async () => makeAggregate())
    };

    const { createMacroResolveTool } = await import("../src/tools/macro_resolve");
    const tool = createMacroResolveTool({ providerRuntime } as never);

    const invalidInput = parse(await tool.execute({ expression: "@web.fetch('x')", execute: true }));
    expect(invalidInput).toEqual({
      ok: false,
      error: {
        message: "Macro action input is invalid",
        code: "macro_resolve_failed"
      }
    });

    const unsupported = parse(await tool.execute({ expression: "@web.broadcast('x')", execute: true }));
    expect(unsupported).toEqual({
      ok: false,
      error: {
        message: "Macro operation is not supported: broadcast",
        code: "macro_resolve_failed"
      }
    });

    const missingFetchUrl = parse(await tool.execute({ expression: "@web.fetch('missing')", execute: true }));
    expect(missingFetchUrl.error?.message).toBe("Macro action missing fetch.url");

    const missingCrawlSeeds = parse(await tool.execute({ expression: "@web.crawl('missing')", execute: true }));
    expect(missingCrawlSeeds.error?.message).toBe("Macro action missing crawl.seedUrls");

    const missingPostContent = parse(await tool.execute({ expression: "@community.post('missing')", execute: true }));
    expect(missingPostContent.error?.message).toBe("Macro action missing post.content");
  });

  it("drops invalid optional fields while preserving valid execute payload + catalog output", async () => {
    const resolve = vi.fn()
      .mockResolvedValueOnce({
        action: {
          source: "web",
          operation: "search",
          input: {
            query: "search-text",
            limit: 0,
            filters: []
          }
        },
        provenance: {
          macro: "web.search",
          provider: "web/default",
          resolvedQuery: "search-text",
          pack: "core:web",
          args: { positional: [], named: {} }
        }
      })
      .mockResolvedValueOnce({
        action: {
          source: "web",
          operation: "fetch",
          input: {
            url: "https://example.com/post",
            filters: "invalid"
          }
        },
        provenance: {
          macro: "web.fetch",
          provider: "web/default",
          resolvedQuery: "fetch",
          pack: "core:web",
          args: { positional: [], named: {} }
        }
      })
      .mockResolvedValueOnce({
        action: {
          source: "web",
          operation: "crawl",
          input: {
            seedUrls: ["https://example.com/start", "", 10],
            strategy: "invalid",
            maxDepth: 0,
            maxPages: -1,
            maxPerDomain: 1.2,
            filters: "invalid"
          }
        },
        provenance: {
          macro: "web.crawl",
          provider: "web/default",
          resolvedQuery: "crawl",
          pack: "core:web",
          args: { positional: [], named: {} }
        }
      })
      .mockResolvedValueOnce({
        action: {
          source: "community",
          operation: "post",
          input: {
            target: "updates",
            content: "ship",
            mediaUrls: ["", 1],
            confirm: "true",
            riskAccepted: 1,
            metadata: "invalid"
          }
        },
        provenance: {
          macro: "community.post",
          provider: "community/default",
          resolvedQuery: "post",
          pack: "core:community",
          args: { positional: [], named: {} }
        }
      });
    const list = vi.fn(() => [{ name: "web.search", pack: "core:web", description: "search" }]);

    vi.doMock("../src/macros", () => ({
      createDefaultMacroRegistry: () => ({ resolve, list })
    }));

    const providerRuntime = {
      search: vi.fn(async () => makeAggregate({ sourceSelection: "web" })),
      fetch: vi.fn(async () => makeAggregate({ sourceSelection: "web" })),
      crawl: vi.fn(async () => makeAggregate({ sourceSelection: "web" })),
      post: vi.fn(async () => makeAggregate({ sourceSelection: "community" }))
    };

    const { createMacroResolveTool } = await import("../src/tools/macro_resolve");
    const tool = createMacroResolveTool({ providerRuntime } as never);

    const searchResult = parse(await tool.execute({
      expression: "@web.search('x')",
      execute: true,
      includeCatalog: true
    }));
    expect(searchResult.ok).toBe(true);
    expect(searchResult.catalog).toEqual([{ name: "web.search", pack: "core:web", description: "search" }]);
    expect(providerRuntime.search).toHaveBeenCalledWith(
      { query: "search-text" },
      { source: "web" }
    );

    await tool.execute({ expression: "@web.fetch('x')", execute: true });
    expect(providerRuntime.fetch).toHaveBeenCalledWith(
      { url: "https://example.com/post" },
      { source: "web" }
    );

    await tool.execute({ expression: "@web.crawl('x')", execute: true });
    expect(providerRuntime.crawl).toHaveBeenCalledWith(
      { seedUrls: ["https://example.com/start"] },
      { source: "web" }
    );

    await tool.execute({ expression: "@community.post('x')", execute: true });
    expect(providerRuntime.post).toHaveBeenCalledWith(
      {
        target: "updates",
        content: "ship"
      },
      { source: "community" }
    );
  });
});
