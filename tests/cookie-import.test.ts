import { describe, expect, it, vi } from "vitest";

vi.mock("@opencode-ai/plugin", async () => {
  const { z } = await import("zod");
  const toolFn = (input: { description: string; args: unknown; execute: (...args: unknown[]) => unknown }) => input;
  toolFn.schema = z;
  return { tool: toolFn };
});

vi.mock("../src/cli/client", () => ({
  callDaemon: vi.fn(async () => ({ requestId: "req-1", imported: 1, rejected: [] }))
}));

const parse = (value: string): unknown => JSON.parse(value);

describe("cookie import", () => {
  it("validates cookie records", async () => {
    const { __test__: cookieToolTest } = await import("../src/tools/cookie_import");
    const valid = cookieToolTest.validateCookieRecord({
      name: "session",
      value: "abc123",
      url: "https://example.com",
      sameSite: "Lax"
    });
    expect(valid.valid).toBe(true);
    expect(valid.cookie).toEqual({
      name: "session",
      value: "abc123",
      url: "https://example.com/",
      sameSite: "Lax"
    });

    const invalid = cookieToolTest.validateCookieRecord({
      name: "session",
      value: "abc123",
      url: "https://example.com",
      sameSite: "None",
      secure: false
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.reason).toContain("SameSite=None");
  });

  it("covers cookie validation edge cases", async () => {
    const { __test__: cookieToolTest } = await import("../src/tools/cookie_import");
    const { validateCookieRecord } = cookieToolTest;

    expect(validateCookieRecord({ name: "", value: "x", url: "https://example.com" })).toMatchObject({
      valid: false,
      reason: "Cookie name is required."
    });
    expect(validateCookieRecord({ name: "bad name", value: "x", url: "https://example.com" })).toMatchObject({
      valid: false
    });
    expect(validateCookieRecord({ name: "session", value: 123 as unknown as string, url: "https://example.com" })).toMatchObject({
      valid: false
    });
    expect(validateCookieRecord({ name: "session", value: "x;y", url: "https://example.com" })).toMatchObject({
      valid: false
    });
    expect(validateCookieRecord({ name: "session", value: "x", url: "ftp://example.com" })).toMatchObject({
      valid: false
    });
    expect(validateCookieRecord({ name: "session", value: "x", url: "not-a-url" })).toMatchObject({
      valid: false
    });
    expect(validateCookieRecord({ name: "session", value: "x" })).toMatchObject({
      valid: false
    });
    expect(validateCookieRecord({ name: "session", value: "x", domain: "exa$mple.com" })).toMatchObject({
      valid: false
    });
    expect(validateCookieRecord({ name: "session", value: "x", domain: "example..com" })).toMatchObject({
      valid: false
    });
    expect(validateCookieRecord({ name: "session", value: "x", domain: "example.com", path: "bad" })).toMatchObject({
      valid: false
    });
    expect(validateCookieRecord({ name: "session", value: "x", domain: "example.com", expires: Number.NaN })).toMatchObject({
      valid: false
    });
    expect(validateCookieRecord({ name: "session", value: "x", domain: "example.com", expires: -2 })).toMatchObject({
      valid: false
    });

    const normalized = validateCookieRecord({
      name: "session",
      value: "abc",
      domain: "EXAMPLE.COM",
      path: "/app",
      secure: true,
      httpOnly: true,
      expires: 123,
      sameSite: "Lax"
    });
    expect(normalized).toEqual({
      valid: true,
      reason: "",
      cookie: {
        name: "session",
        value: "abc",
        domain: "example.com",
        path: "/app",
        secure: true,
        httpOnly: true,
        expires: 123,
        sameSite: "Lax"
      }
    });
  });

  it("prefers manager cookieImport when available", async () => {
    const { createCookieImportTool } = await import("../src/tools/cookie_import");
    const cookieImport = vi.fn(async () => ({ requestId: "req-managed", imported: 1, rejected: [] }));
    const withPage = vi.fn();
    const tool = createCookieImportTool({
      manager: {
        cookieImport,
        withPage
      }
    } as never);

    const output = parse(await tool.execute({
      sessionId: "s1",
      cookies: [{ name: "session", value: "abc", url: "https://example.com" }],
      strict: false,
      requestId: "req-1"
    })) as { ok: boolean; requestId?: string; imported?: number; rejected?: unknown[] };

    expect(output).toEqual({
      ok: true,
      requestId: "req-managed",
      imported: 1,
      rejected: []
    });
    expect(cookieImport).toHaveBeenCalledWith(
      "s1",
      [expect.objectContaining({ name: "session", url: "https://example.com/" })],
      false,
      "req-1"
    );
    const forwarded = cookieImport.mock.calls[0]?.[1]?.[0] as { path?: string } | undefined;
    expect(forwarded?.path).toBeUndefined();
    expect(withPage).not.toHaveBeenCalled();
  });

  it("normalizes URL-form fallback cookies without forcing path", async () => {
    const { createCookieImportTool } = await import("../src/tools/cookie_import");
    const addCookies = vi.fn(async () => undefined);
    const withPage = vi.fn(async (_sessionId: string, _targetId: string | null, fn: (page: { context: () => { addCookies: (cookies: unknown[]) => Promise<void> } }) => Promise<unknown>) => {
      return fn({
        context: () => ({ addCookies })
      });
    });

    const tool = createCookieImportTool({
      manager: {
        withPage
      }
    } as never);

    const output = parse(await tool.execute({
      sessionId: "s1",
      cookies: [{ name: "session", value: "abc", url: "https://example.com" }],
      strict: true,
      requestId: "req-url"
    })) as { ok: boolean; imported: number };

    expect(output.ok).toBe(true);
    expect(output.imported).toBe(1);
    expect(addCookies).toHaveBeenCalledWith([
      {
        name: "session",
        value: "abc",
        url: "https://example.com/"
      }
    ]);
  });

  it("falls back to withPage import for normalized cookies", async () => {
    const { createCookieImportTool } = await import("../src/tools/cookie_import");
    const addCookies = vi.fn(async () => undefined);
    const withPage = vi.fn(async (_sessionId: string, _targetId: string | null, fn: (page: { context: () => { addCookies: (cookies: unknown[]) => Promise<void> } }) => Promise<unknown>) => {
      return fn({
        context: () => ({ addCookies })
      });
    });

    const tool = createCookieImportTool({
      manager: {
        withPage
      }
    } as never);

    const output = parse(await tool.execute({
      sessionId: "s1",
      cookies: [
        { name: "session", value: "abc", domain: ".example.com" },
        { name: "bad", value: "x", sameSite: "None", secure: false }
      ],
      strict: false,
      requestId: "req-2"
    })) as { ok: boolean; imported: number; rejected: Array<{ index: number; reason: string }>; requestId: string };

    expect(output.ok).toBe(true);
    expect(output.requestId).toBe("req-2");
    expect(output.imported).toBe(1);
    expect(output.rejected).toEqual([
      {
        index: 1,
        reason: "Cookie bad requires url or domain."
      }
    ]);
    expect(withPage).toHaveBeenCalledWith("s1", null, expect.any(Function));
    expect(addCookies).toHaveBeenCalledWith([
      {
        name: "session",
        value: "abc",
        domain: ".example.com",
        path: "/"
      }
    ]);
  });

  it("handles strict rejection, empty normalized set, and execution failure", async () => {
    const { createCookieImportTool } = await import("../src/tools/cookie_import");
    const withPage = vi.fn(async () => undefined);
    const tool = createCookieImportTool({
      manager: { withPage }
    } as never);

    const strictRejected = parse(await tool.execute({
      sessionId: "s1",
      cookies: [{ name: "bad", value: "x", sameSite: "None", secure: false }],
      strict: true
    })) as { ok: boolean; error: { code: string; message: string } };
    expect(strictRejected).toEqual({
      ok: false,
      error: {
        code: "cookie_import_failed",
        message: "Cookie import rejected 1 entries."
      }
    });
    expect(withPage).not.toHaveBeenCalled();

    const emptyAccepted = parse(await tool.execute({
      sessionId: "s1",
      cookies: [{ name: "bad", value: "x", sameSite: "None", secure: false }],
      strict: false
    })) as { ok: boolean; imported: number };
    expect(emptyAccepted.ok).toBe(true);
    expect(emptyAccepted.imported).toBe(0);
    expect(withPage).not.toHaveBeenCalled();

    const failingTool = createCookieImportTool({
      manager: {
        withPage: vi.fn(async () => {
          throw new Error("page unavailable");
        })
      }
    } as never);
    const failed = parse(await failingTool.execute({
      sessionId: "s1",
      cookies: [{ name: "session", value: "abc", url: "https://example.com" }]
    })) as { ok: boolean; error: { code: string; message: string } };
    expect(failed).toEqual({
      ok: false,
      error: {
        code: "cookie_import_failed",
        message: "page unavailable"
      }
    });
  });

  it("parses CLI cookie import arguments", async () => {
    const { __test__: cookieCliTest } = await import("../src/cli/commands/session/cookie-import");
    const parsed = cookieCliTest.parseCookieImportArgs([
      "--session-id", "s1",
      "--cookies", "[]",
      "--strict=false",
      "--request-id", "req-1"
    ]);

    expect(parsed).toEqual({
      sessionId: "s1",
      cookies: "[]",
      strict: false,
      requestId: "req-1"
    });
  });

  it("parses cookies JSON and enforces shape", async () => {
    const { __test__: cookieCliTest } = await import("../src/cli/commands/session/cookie-import");
    const parsed = cookieCliTest.parseCookiesJson(
      JSON.stringify([{ name: "session", value: "abc", domain: ".example.com" }]),
      "--cookies"
    );

    expect(parsed).toEqual([
      { name: "session", value: "abc", domain: ".example.com" }
    ]);

    expect(() => cookieCliTest.parseCookiesJson("{}", "--cookies"))
      .toThrow("expected array");
  });

  it("rejects conflicting cookie sources", async () => {
    const { __test__: cookieCliTest } = await import("../src/cli/commands/session/cookie-import");
    expect(() => cookieCliTest.resolveCookies({
      sessionId: "s1",
      cookies: "[]",
      cookiesFile: "/tmp/cookies.json"
    })).toThrow("Provide only one cookies source");
  });

  it("normalizes cookie-list tool URL filters", async () => {
    const { __test__: cookieListToolTest } = await import("../src/tools/cookie_list");
    expect(cookieListToolTest.normalizeCookieUrls([
      "https://example.com",
      "https://example.com/",
      "https://example.com/path"
    ])).toEqual([
      "https://example.com/",
      "https://example.com/path"
    ]);
    expect(cookieListToolTest.normalizeCookieUrls()).toBeUndefined();

    expect(() => cookieListToolTest.normalizeCookieUrls(["  "]))
      .toThrow("non-empty");
    expect(() => cookieListToolTest.normalizeCookieUrls(["not-a-url"]))
      .toThrow("invalid");

    expect(() => cookieListToolTest.normalizeCookieUrls(["ftp://example.com"]))
      .toThrow("http(s)");
  });

  it("prefers manager cookieList capability and falls back to withPage when needed", async () => {
    const { createCookieListTool } = await import("../src/tools/cookie_list");
    const cookieList = vi.fn(async () => ({
      requestId: "req-managed-list",
      cookies: [],
      count: 0
    }));
    const listCookies = vi.fn(async (_urls?: string[]) => [{
      name: "session",
      value: "abc",
      domain: "example.com",
      path: "/",
      expires: -1,
      httpOnly: true,
      secure: true
    }, {
      name: "refresh",
      value: "xyz",
      domain: "example.com",
      path: "/",
      expires: -1,
      httpOnly: false,
      secure: true,
      sameSite: "Lax" as const
    }]);
    const withPage = vi.fn(async (_sessionId: string, _targetId: string | null, fn: (page: {
      context: () => {
        cookies: (urls?: string[]) => Promise<Array<{
          name: string;
          value: string;
          domain: string;
          path: string;
          expires: number;
          httpOnly: boolean;
          secure: boolean;
        }>>;
      };
    }) => Promise<unknown>) => {
      return fn({
        context: () => ({
          cookies: listCookies
        })
      });
    });

    const managedTool = createCookieListTool({
      manager: {
        cookieList,
        withPage
      }
    } as never);

    const managedOutput = parse(await managedTool.execute({
      sessionId: "s1",
      urls: ["https://example.com"]
    })) as { ok: boolean; requestId?: string; count?: number };
    expect(managedOutput).toEqual({
      ok: true,
      requestId: "req-managed-list",
      cookies: [],
      count: 0
    });
    expect(cookieList).toHaveBeenCalledWith("s1", ["https://example.com/"], expect.any(String));

    const fallbackTool = createCookieListTool({
      manager: {
        withPage
      }
    } as never);
    const fallbackOutput = parse(await fallbackTool.execute({
      sessionId: "s1"
    })) as { ok: boolean; count?: number };
    expect(fallbackOutput).toMatchObject({ ok: true, count: 2 });
    expect(listCookies.mock.calls[0]?.length).toBe(0);

    const filteredFallback = parse(await fallbackTool.execute({
      sessionId: "s1",
      urls: ["https://example.com"]
    })) as { ok: boolean; count?: number };
    expect(filteredFallback).toMatchObject({ ok: true, count: 2 });
    expect(listCookies).toHaveBeenLastCalledWith(["https://example.com/"]);

    const invalid = parse(await fallbackTool.execute({
      sessionId: "s1",
      urls: ["ftp://example.com"]
    })) as { ok: boolean; error?: { code?: string; message?: string } };
    expect(invalid).toEqual({
      ok: false,
      error: {
        code: "cookie_list_failed",
        message: "Cookie list url must be http(s): ftp://example.com"
      }
    });
  });

  it("parses CLI cookie-list arguments and executes daemon call", async () => {
    const { __test__: cookieListCliTest, runCookieList } = await import("../src/cli/commands/session/cookie-list");
    const { callDaemon } = await import("../src/cli/client");
    const callDaemonMock = vi.mocked(callDaemon);
    callDaemonMock.mockResolvedValueOnce({
      requestId: "req-list",
      cookies: [],
      count: 0
    });

    const parsed = cookieListCliTest.parseCookieListArgs([
      "--session-id", "s1",
      "--url", "https://example.com,https://example.com/path",
      "--request-id", "req-list"
    ]);
    expect(parsed).toEqual({
      sessionId: "s1",
      urls: ["https://example.com/", "https://example.com/path"],
      requestId: "req-list"
    });

    const result = await runCookieList({
      command: "cookie-list",
      mode: undefined,
      withConfig: false,
      noPrompt: false,
      noInteractive: false,
      quiet: false,
      outputFormat: "json",
      transport: "relay",
      skillsMode: "global",
      fullInstall: false,
      rawArgs: ["--session-id", "s1", "--url", "https://example.com"]
    });

    expect(result).toEqual({
      success: true,
      message: "Cookies listed: 0",
      data: { requestId: "req-list", cookies: [], count: 0 }
    });
    expect(callDaemonMock).toHaveBeenCalledWith("session.cookieList", {
      sessionId: "s1",
      urls: ["https://example.com/"],
      requestId: undefined
    });
  });
});
