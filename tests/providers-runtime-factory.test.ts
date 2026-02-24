import { describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { BrowserManagerLike } from "../src/browser/manager-types";
import {
  buildRuntimeInitFromConfig,
  createBrowserFallbackPort,
  createConfiguredProviderRuntime
} from "../src/providers/runtime-factory";

describe("provider runtime factory", () => {
  it("returns undefined fallback port when manager is missing", () => {
    expect(createBrowserFallbackPort(undefined)).toBeUndefined();
  });

  it("returns env_limited when fallback request has no URL", async () => {
    const manager = {
      launch: vi.fn(),
      withPage: vi.fn(),
      goto: vi.fn(),
      status: vi.fn(),
      disconnect: vi.fn()
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager);
    const response = await port?.resolve({
      provider: "social/youtube",
      source: "social",
      operation: "fetch",
      reasonCode: "transcript_unavailable",
      trace: { requestId: "rf-1", ts: "2026-02-16T00:00:00.000Z" }
    });

    expect(response).toMatchObject({
      ok: false,
      reasonCode: "env_limited"
    });
    expect(manager.launch).not.toHaveBeenCalled();
  });

  it("captures fallback HTML and disconnects temporary session", async () => {
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "fallback-session" })),
      goto: vi.fn(async () => ({ ok: true })),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
        return callback({ content: async () => "<html><body>fallback</body></html>" });
      }),
      status: vi.fn(async () => ({ mode: "extension", url: "https://example.com/watch" })),
      disconnect: vi.fn(async () => undefined)
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager);
    const response = await port?.resolve({
      provider: "social/youtube",
      source: "social",
      operation: "fetch",
      reasonCode: "challenge_detected",
      trace: { requestId: "rf-2", ts: "2026-02-16T00:00:00.000Z" },
      url: "https://example.com/watch"
    });

    expect(response).toMatchObject({
      ok: true,
      reasonCode: "challenge_detected",
      mode: "extension",
      output: {
        html: "<html><body>fallback</body></html>",
        url: "https://example.com/watch"
      },
      details: {
        provider: "social/youtube",
        operation: "fetch"
      }
    });
    expect(manager.launch).toHaveBeenCalledWith(expect.objectContaining({
      noExtension: true,
      headless: false,
      startUrl: "about:blank",
      persistProfile: false
    }));
    expect(manager.goto).toHaveBeenCalledWith("fallback-session", "https://example.com/watch", "load", 45000);
    expect(manager.disconnect).toHaveBeenCalledWith("fallback-session", true);
  });

  it("falls back to managed_headed mode and request URL when status metadata is sparse", async () => {
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "fallback-session" })),
      goto: vi.fn(async () => ({ ok: true })),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
        return callback({});
      }),
      status: vi.fn(async () => ({ mode: "managed" })),
      disconnect: vi.fn(async () => undefined)
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager);
    const response = await port?.resolve({
      provider: "social/youtube",
      source: "social",
      operation: "fetch",
      reasonCode: "transcript_unavailable",
      trace: { requestId: "rf-2b", ts: "2026-02-16T00:00:00.000Z" },
      url: "https://example.com/watch?v=fallback"
    });

    expect(response).toMatchObject({
      ok: true,
      mode: "managed_headed",
      output: {
        html: "",
        url: "https://example.com/watch?v=fallback"
      }
    });
  });

  it("returns env_limited on fallback manager errors and still disconnects", async () => {
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "fallback-session" })),
      goto: vi.fn(async () => ({ ok: true })),
      withPage: vi.fn(async () => {
        throw new Error("browser unavailable");
      }),
      status: vi.fn(),
      disconnect: vi.fn(async () => undefined)
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager);
    const response = await port?.resolve({
      provider: "social/youtube",
      source: "social",
      operation: "fetch",
      reasonCode: "transcript_unavailable",
      trace: { requestId: "rf-3", ts: "2026-02-16T00:00:00.000Z" },
      url: "https://example.com/watch"
    });

    expect(response).toMatchObject({
      ok: false,
      reasonCode: "env_limited",
      details: {
        message: "browser unavailable"
      }
    });
    expect(manager.disconnect).toHaveBeenCalledWith("fallback-session", true);
  });

  it("maps non-Error fallback failures and tolerates disconnect cleanup failures", async () => {
    const manager = {
      launch: vi.fn(async () => {
        return await Promise.reject("launch-failed");
      }),
      goto: vi.fn(),
      withPage: vi.fn(),
      status: vi.fn(),
      disconnect: vi.fn(async () => {
        throw new Error("disconnect failed");
      })
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager);
    const response = await port?.resolve({
      provider: "social/youtube",
      source: "social",
      operation: "fetch",
      reasonCode: "transcript_unavailable",
      trace: { requestId: "rf-3b", ts: "2026-02-16T00:00:00.000Z" },
      url: "https://example.com/watch"
    });

    expect(response).toMatchObject({
      ok: false,
      reasonCode: "env_limited",
      details: {
        message: "launch-failed"
      }
    });
    expect(manager.disconnect).not.toHaveBeenCalled();
  });

  it("fails fast with auth_required when required cookie policy has no cookies", async () => {
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "required-cookie-miss" })),
      goto: vi.fn(async () => ({ ok: true })),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
        return callback({ content: async () => "<html><body>fallback</body></html>" });
      }),
      status: vi.fn(async () => ({ mode: "managed", url: "https://example.com/protected" })),
      disconnect: vi.fn(async () => undefined),
      cookieImport: vi.fn(async () => ({ requestId: "import", imported: 0, rejected: [] })),
      cookieList: vi.fn(async () => ({ requestId: "list", cookies: [], count: 0 }))
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager, {
      policy: "required",
      source: {
        type: "inline",
        value: []
      }
    });
    const response = await port?.resolve({
      provider: "social/youtube",
      source: "social",
      operation: "fetch",
      reasonCode: "transcript_unavailable",
      trace: { requestId: "rf-required-1", ts: "2026-02-16T00:00:00.000Z" },
      url: "https://example.com/protected"
    });

    expect(response).toMatchObject({
      ok: false,
      reasonCode: "auth_required"
    });
    expect(manager.cookieImport).not.toHaveBeenCalled();
    expect(manager.goto).not.toHaveBeenCalled();
    expect(manager.disconnect).toHaveBeenCalledWith("required-cookie-miss", true);
  });

  it("injects and verifies cookies before fallback navigation when available", async () => {
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "cookie-inject-ok" })),
      goto: vi.fn(async () => ({ ok: true })),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
        return callback({ content: async () => "<html><body>ok</body></html>" });
      }),
      status: vi.fn(async () => ({ mode: "managed", url: "https://example.com/protected" })),
      disconnect: vi.fn(async () => undefined),
      cookieImport: vi.fn(async () => ({ requestId: "import", imported: 1, rejected: [] })),
      cookieList: vi.fn(async () => ({
        requestId: "list",
        cookies: [
          {
            name: "sid",
            value: "value",
            domain: "example.com",
            path: "/",
            expires: -1,
            httpOnly: true,
            secure: true
          }
        ],
        count: 1
      }))
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager, {
      policy: "required",
      source: {
        type: "inline",
        value: [{
          name: "sid",
          value: "value",
          domain: ".example.com",
          path: "/",
          secure: true,
          httpOnly: true
        }]
      }
    });
    const response = await port?.resolve({
      provider: "social/youtube",
      source: "social",
      operation: "fetch",
      reasonCode: "transcript_unavailable",
      trace: { requestId: "rf-required-2", ts: "2026-02-16T00:00:00.000Z" },
      url: "https://example.com/protected"
    });

    expect(response).toMatchObject({
      ok: true,
      details: {
        cookieDiagnostics: {
          policy: "required",
          source: "inline",
          injected: 1,
          rejected: 0,
          verifiedCount: 1
        }
      }
    });
    expect(manager.cookieImport).toHaveBeenCalledTimes(1);
    expect(manager.cookieList).toHaveBeenCalledWith("cookie-inject-ok", ["https://example.com/protected"]);
    expect(manager.goto).toHaveBeenCalledWith("cookie-inject-ok", "https://example.com/protected", "load", 45000);
  });

  it("supports deterministic cookie policy overrides per fallback request", async () => {
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "cookie-policy-override" })),
      goto: vi.fn(async () => ({ ok: true })),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
        return callback({ content: async () => "<html><body>ok</body></html>" });
      }),
      status: vi.fn(async () => ({ mode: "managed", url: "https://example.com/protected" })),
      disconnect: vi.fn(async () => undefined),
      cookieImport: vi.fn(async () => ({ requestId: "import", imported: 1, rejected: [] })),
      cookieList: vi.fn(async () => ({ requestId: "list", cookies: [], count: 1 }))
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager, {
      policy: "off",
      source: {
        type: "inline",
        value: [{
          name: "sid",
          value: "value",
          domain: ".example.com",
          path: "/",
          secure: true
        }]
      }
    });

    const withUseCookies = await port?.resolve({
      provider: "social/youtube",
      source: "social",
      operation: "fetch",
      reasonCode: "transcript_unavailable",
      trace: { requestId: "rf-cookie-policy-1", ts: "2026-02-16T00:00:00.000Z" },
      url: "https://example.com/protected",
      useCookies: true
    });
    expect(withUseCookies).toMatchObject({
      ok: true,
      details: {
        cookieDiagnostics: {
          policy: "auto",
          attempted: true
        }
      }
    });

    const withDisable = await port?.resolve({
      provider: "social/youtube",
      source: "social",
      operation: "fetch",
      reasonCode: "transcript_unavailable",
      trace: { requestId: "rf-cookie-policy-2", ts: "2026-02-16T00:00:00.000Z" },
      url: "https://example.com/protected",
      useCookies: false
    });
    expect(withDisable).toMatchObject({
      ok: true,
      details: {
        cookieDiagnostics: {
          policy: "off",
          attempted: false
        }
      }
    });

    const withRequiredOverride = await port?.resolve({
      provider: "social/youtube",
      source: "social",
      operation: "fetch",
      reasonCode: "transcript_unavailable",
      trace: { requestId: "rf-cookie-policy-3", ts: "2026-02-16T00:00:00.000Z" },
      url: "https://example.com/protected",
      useCookies: false,
      cookiePolicyOverride: "required"
    });
    expect(withRequiredOverride).toMatchObject({
      ok: true,
      details: {
        cookieDiagnostics: {
          policy: "required"
        }
      }
    });
  });

  it("continues in auto mode when cookie file read fails for non-ENOENT errors", async () => {
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "cookie-file-eisdir" })),
      goto: vi.fn(async () => ({ ok: true })),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
        return callback({ content: async () => "<html><body>ok</body></html>" });
      }),
      status: vi.fn(async () => ({ mode: "managed", url: "https://example.com/protected" })),
      disconnect: vi.fn(async () => undefined),
      cookieImport: vi.fn(async () => ({ requestId: "import", imported: 0, rejected: [] })),
      cookieList: vi.fn(async () => ({ requestId: "list", cookies: [], count: 0 }))
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager, {
      policy: "auto",
      source: {
        type: "file",
        value: "/"
      }
    });
    const response = await port?.resolve({
      provider: "social/youtube",
      source: "social",
      operation: "fetch",
      reasonCode: "transcript_unavailable",
      trace: { requestId: "rf-cookie-file-1", ts: "2026-02-16T00:00:00.000Z" },
      url: "https://example.com/protected"
    });

    expect(response).toMatchObject({
      ok: true,
      details: {
        cookieDiagnostics: {
          policy: "auto",
          attempted: false,
          message: expect.stringContaining("Cookie file read failed")
        }
      }
    });
    expect(manager.cookieImport).not.toHaveBeenCalled();
    expect(manager.cookieList).not.toHaveBeenCalled();
  });

  it("supports env cookie source for required policy across missing, invalid, and valid payloads", async () => {
    const envKey = "ODB_PROVIDER_COOKIES_TEST";
    const original = process.env[envKey];
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "cookie-env-flow" })),
      goto: vi.fn(async () => ({ ok: true })),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
        return callback({ content: async () => "<html><body>env</body></html>" });
      }),
      status: vi.fn(async () => ({ mode: "managed", url: "https://example.com/protected" })),
      disconnect: vi.fn(async () => undefined),
      cookieImport: vi.fn(async () => ({ requestId: "import", imported: 1, rejected: [] })),
      cookieList: vi.fn(async () => ({ requestId: "list", cookies: [], count: 1 }))
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager, {
      policy: "required",
      source: {
        type: "env",
        value: envKey
      }
    });

    try {
      delete process.env[envKey];
      const missing = await port?.resolve({
        provider: "social/youtube",
        source: "social",
        operation: "fetch",
        reasonCode: "transcript_unavailable",
        trace: { requestId: "rf-cookie-env-1", ts: "2026-02-16T00:00:00.000Z" },
        url: "https://example.com/protected"
      });
      expect(missing).toMatchObject({
        ok: false,
        reasonCode: "auth_required"
      });

      process.env[envKey] = "{broken json";
      const invalid = await port?.resolve({
        provider: "social/youtube",
        source: "social",
        operation: "fetch",
        reasonCode: "transcript_unavailable",
        trace: { requestId: "rf-cookie-env-2", ts: "2026-02-16T00:00:00.000Z" },
        url: "https://example.com/protected"
      });
      expect(invalid).toMatchObject({
        ok: false,
        reasonCode: "auth_required"
      });

      process.env[envKey] = JSON.stringify([{
        name: "sid",
        value: "env",
        domain: ".example.com",
        path: "/",
        secure: true
      }]);
      const valid = await port?.resolve({
        provider: "social/youtube",
        source: "social",
        operation: "fetch",
        reasonCode: "transcript_unavailable",
        trace: { requestId: "rf-cookie-env-3", ts: "2026-02-16T00:00:00.000Z" },
        url: "https://example.com/protected"
      });
      expect(valid).toMatchObject({
        ok: true,
        details: {
          cookieDiagnostics: {
            source: "env",
            loaded: 1,
            injected: 1,
            verifiedCount: 1
          }
        }
      });
    } finally {
      if (typeof original === "undefined") {
        delete process.env[envKey];
      } else {
        process.env[envKey] = original;
      }
    }
  });

  it("expands home-only cookie file source refs in diagnostics", async () => {
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "cookie-home-ref" })),
      goto: vi.fn(async () => ({ ok: true })),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
        return callback({ content: async () => "<html><body>home-ref</body></html>" });
      }),
      status: vi.fn(async () => ({ mode: "managed", url: "https://example.com" })),
      disconnect: vi.fn(async () => undefined)
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager, {
      policy: "off",
      source: {
        type: "file",
        value: "~"
      }
    });

    const response = await port?.resolve({
      provider: "social/youtube",
      source: "social",
      operation: "fetch",
      reasonCode: "transcript_unavailable",
      trace: { requestId: "rf-cookie-home-ref", ts: "2026-02-16T00:00:00.000Z" },
      url: "https://example.com/watch"
    });

    expect(response).toMatchObject({
      ok: true,
      details: {
        cookieDiagnostics: {
          sourceRef: os.homedir(),
          policy: "off"
        }
      }
    });
  });

  it("surfaces non-Error env cookie parse failures deterministically", async () => {
    const envKey = "ODB_PROVIDER_COOKIES_STRING_THROW";
    const original = process.env[envKey];
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "cookie-env-string-throw" })),
      goto: vi.fn(async () => ({ ok: true })),
      withPage: vi.fn(async () => "<html></html>"),
      status: vi.fn(async () => ({ mode: "managed", url: "https://example.com/protected" })),
      disconnect: vi.fn(async () => undefined),
      cookieImport: vi.fn(async () => ({ requestId: "import", imported: 0, rejected: [] })),
      cookieList: vi.fn(async () => ({ requestId: "list", cookies: [], count: 0 }))
    } as unknown as BrowserManagerLike;

    const parseSpy = vi.spyOn(JSON, "parse").mockImplementation(() => {
      throw "json-parse-threw-string";
    });
    process.env[envKey] = "[{\"name\":\"sid\"}]";

    try {
      const port = createBrowserFallbackPort(manager, {
        policy: "required",
        source: {
          type: "env",
          value: envKey
        }
      });
      const response = await port?.resolve({
        provider: "social/youtube",
        source: "social",
        operation: "fetch",
        reasonCode: "transcript_unavailable",
        trace: { requestId: "rf-cookie-env-string-throw", ts: "2026-02-16T00:00:00.000Z" },
        url: "https://example.com/protected"
      });

      expect(response).toMatchObject({
        ok: false,
        reasonCode: "auth_required",
        details: {
          cookieDiagnostics: {
            message: expect.stringContaining("json-parse-threw-string")
          }
        }
      });
    } finally {
      parseSpy.mockRestore();
      if (typeof original === "undefined") {
        delete process.env[envKey];
      } else {
        process.env[envKey] = original;
      }
    }
  });

  it("surfaces non-Error file cookie parse failures deterministically", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "odb-cookie-source-non-error-file-"));
    const filePath = path.join(tmpDir, "cookies.json");
    fs.writeFileSync(filePath, "[]", "utf8");

    const manager = {
      launch: vi.fn(async () => ({ sessionId: "cookie-file-string-parse" })),
      goto: vi.fn(async () => ({ ok: true })),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
        return callback({ content: async () => "<html><body>ok</body></html>" });
      }),
      status: vi.fn(async () => ({ mode: "managed", url: "https://example.com/protected" })),
      disconnect: vi.fn(async () => undefined),
      cookieImport: vi.fn(async () => ({ requestId: "import", imported: 0, rejected: [] })),
      cookieList: vi.fn(async () => ({ requestId: "list", cookies: [], count: 0 }))
    } as unknown as BrowserManagerLike;

    const parseSpy = vi.spyOn(JSON, "parse").mockImplementation(() => {
      throw "file-json-string-error";
    });

    try {
      const port = createBrowserFallbackPort(manager, {
        policy: "auto",
        source: {
          type: "file",
          value: filePath
        }
      });
      const response = await port?.resolve({
        provider: "social/youtube",
        source: "social",
        operation: "fetch",
        reasonCode: "transcript_unavailable",
        trace: { requestId: "rf-cookie-file-string-parse", ts: "2026-02-16T00:00:00.000Z" },
        url: "https://example.com/protected"
      });

      expect(response).toMatchObject({
        ok: true,
        details: {
          cookieDiagnostics: {
            message: expect.stringContaining("file-json-string-error")
          }
        }
      });
    } finally {
      parseSpy.mockRestore();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("fails with required policy and explicit missing-cookie message when file source contains an empty array", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "odb-cookie-source-empty-file-"));
    const filePath = path.join(tmpDir, "cookies.json");
    fs.writeFileSync(filePath, "[]", "utf8");

    const manager = {
      launch: vi.fn(async () => ({ sessionId: "cookie-file-empty-required" })),
      goto: vi.fn(async () => ({ ok: true })),
      withPage: vi.fn(async () => "<html></html>"),
      status: vi.fn(async () => ({ mode: "managed", url: "https://example.com/protected" })),
      disconnect: vi.fn(async () => undefined),
      cookieImport: vi.fn(async () => ({ requestId: "import", imported: 0, rejected: [] })),
      cookieList: vi.fn(async () => ({ requestId: "list", cookies: [], count: 0 }))
    } as unknown as BrowserManagerLike;

    try {
      const port = createBrowserFallbackPort(manager, {
        policy: "required",
        source: {
          type: "file",
          value: filePath
        }
      });
      const response = await port?.resolve({
        provider: "social/youtube",
        source: "social",
        operation: "fetch",
        reasonCode: "transcript_unavailable",
        trace: { requestId: "rf-cookie-file-empty-required", ts: "2026-02-16T00:00:00.000Z" },
        url: "https://example.com/protected"
      });

      expect(response).toMatchObject({
        ok: false,
        reasonCode: "auth_required",
        details: {
          cookieDiagnostics: {
            loaded: 0,
            message: "Required provider cookies are missing."
          }
        }
      });
      expect(manager.cookieImport).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("fails required policy when cookies load but import yields zero injected entries", async () => {
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "cookie-import-zero" })),
      goto: vi.fn(async () => ({ ok: true })),
      withPage: vi.fn(async () => "<html></html>"),
      status: vi.fn(async () => ({ mode: "managed", url: "https://example.com/protected" })),
      disconnect: vi.fn(async () => undefined),
      cookieImport: vi.fn(async () => ({ requestId: "import", imported: 0, rejected: [{ name: "sid", reason: "domain_mismatch" }] })),
      cookieList: vi.fn(async () => ({ requestId: "list", cookies: [], count: 0 }))
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager, {
      policy: "required",
      source: {
        type: "inline",
        value: [{
          name: "sid",
          value: "value",
          domain: ".example.com",
          path: "/",
          secure: true
        }]
      }
    });

    const response = await port?.resolve({
      provider: "social/youtube",
      source: "social",
      operation: "fetch",
      reasonCode: "transcript_unavailable",
      trace: { requestId: "rf-cookie-import-zero", ts: "2026-02-16T00:00:00.000Z" },
      url: "https://example.com/protected"
    });

    expect(response).toMatchObject({
      ok: false,
      reasonCode: "auth_required",
      details: {
        cookieDiagnostics: {
          loaded: 1,
          injected: 0,
          message: "Provider cookie injection imported 0 entries."
        }
      }
    });
  });

  it("fails required policy when cookies inject but cannot be observed after import", async () => {
    const manager = {
      launch: vi.fn(async () => ({ sessionId: "cookie-verify-zero" })),
      goto: vi.fn(async () => ({ ok: true })),
      withPage: vi.fn(async () => "<html></html>"),
      status: vi.fn(async () => ({ mode: "managed", url: "https://example.com/protected" })),
      disconnect: vi.fn(async () => undefined),
      cookieImport: vi.fn(async () => ({ requestId: "import", imported: 1, rejected: [] })),
      cookieList: vi.fn(async () => ({ requestId: "list", cookies: [], count: 0 }))
    } as unknown as BrowserManagerLike;

    const port = createBrowserFallbackPort(manager, {
      policy: "required",
      source: {
        type: "inline",
        value: [{
          name: "sid",
          value: "value",
          domain: ".example.com",
          path: "/",
          secure: true
        }]
      }
    });

    const response = await port?.resolve({
      provider: "social/youtube",
      source: "social",
      operation: "fetch",
      reasonCode: "transcript_unavailable",
      trace: { requestId: "rf-cookie-verify-zero", ts: "2026-02-16T00:00:00.000Z" },
      url: "https://example.com/protected"
    });

    expect(response).toMatchObject({
      ok: false,
      reasonCode: "auth_required",
      details: {
        cookieDiagnostics: {
          injected: 1,
          verifiedCount: 0,
          message: "Provider cookies were not observable after injection."
        }
      }
    });
  });

  it("supports file cookie source with both invalid and valid JSON payloads", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "odb-cookie-source-"));
    const invalidPath = path.join(tmpDir, "cookies-invalid.json");
    const validPath = path.join(tmpDir, "cookies-valid.json");
    fs.writeFileSync(invalidPath, JSON.stringify({ sid: "bad-shape" }), "utf8");
    fs.writeFileSync(validPath, JSON.stringify([{
      name: "sid",
      value: "file",
      domain: ".example.com",
      path: "/",
      secure: true
    }]), "utf8");

    const manager = {
      launch: vi.fn(async () => ({ sessionId: "cookie-file-source" })),
      goto: vi.fn(async () => ({ ok: true })),
      withPage: vi.fn(async (_sessionId: string, _targetId: string | null, callback: (page: unknown) => Promise<string>) => {
        return callback({ content: async () => "<html><body>file</body></html>" });
      }),
      status: vi.fn(async () => ({ mode: "managed", url: "https://example.com/protected" })),
      disconnect: vi.fn(async () => undefined),
      cookieImport: vi.fn(async () => ({ requestId: "import", imported: 1, rejected: [] })),
      cookieList: vi.fn(async () => ({ requestId: "list", cookies: [], count: 1 }))
    } as unknown as BrowserManagerLike;

    try {
      const invalidPort = createBrowserFallbackPort(manager, {
        policy: "required",
        source: {
          type: "file",
          value: invalidPath
        }
      });
      const invalid = await invalidPort?.resolve({
        provider: "social/youtube",
        source: "social",
        operation: "fetch",
        reasonCode: "transcript_unavailable",
        trace: { requestId: "rf-cookie-file-2", ts: "2026-02-16T00:00:00.000Z" },
        url: "https://example.com/protected"
      });
      expect(invalid).toMatchObject({
        ok: false,
        reasonCode: "auth_required"
      });

      const validPort = createBrowserFallbackPort(manager, {
        policy: "required",
        source: {
          type: "file",
          value: validPath
        }
      });
      const valid = await validPort?.resolve({
        provider: "social/youtube",
        source: "social",
        operation: "fetch",
        reasonCode: "transcript_unavailable",
        trace: { requestId: "rf-cookie-file-3", ts: "2026-02-16T00:00:00.000Z" },
        url: "https://example.com/protected"
      });
      expect(valid).toMatchObject({
        ok: true,
        details: {
          cookieDiagnostics: {
            source: "file",
            loaded: 1,
            injected: 1,
            verifiedCount: 1
          }
        }
      });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("maps config provider knobs into runtime init", () => {
    const browserFallbackPort = {
      resolve: vi.fn(async () => ({
        ok: false as const,
        reasonCode: "env_limited" as const
      }))
    };

    const runtimeInit = buildRuntimeInitFromConfig({
      blockerDetectionThreshold: 0.83,
      security: {
        allowRawCDP: false,
        allowNonLocalCdp: false,
        allowUnsafeExport: false,
        promptInjectionGuard: { enabled: false }
      },
      providers: {
        tiers: {
          default: "B",
          enableHybrid: true,
          enableRestrictedSafe: true,
          hybridRiskThreshold: 0.4,
          restrictedSafeRecoveryIntervalMs: 120000
        },
        adaptiveConcurrency: {
          enabled: true,
          maxGlobal: 10,
          maxPerDomain: 5
        },
        crawler: {
          workerThreads: 8,
          queueMax: 5000
        },
        antiBotPolicy: {
          enabled: true,
          cooldownMs: 45000,
          maxChallengeRetries: 2,
          proxyHint: "proxy://residential",
          sessionHint: "session:warm",
          allowBrowserEscalation: true
        },
        transcript: {
          modeDefault: "auto",
          strategyOrder: ["native_caption_parse", "optional_asr"],
          enableYtdlp: true,
          enableAsr: true,
          enableYtdlpAudioAsr: true,
          enableApify: true,
          apifyActorId: "streamers/youtube-scraper",
          enableBrowserFallback: true,
          ytdlpTimeoutMs: 20000
        },
        cookiePolicy: "required",
        cookieSource: {
          type: "env",
          value: "OPENDEVBROWSER_PROVIDER_COOKIES"
        }
      }
    }, browserFallbackPort);

    expect(runtimeInit).toMatchObject({
      blockerDetectionThreshold: 0.83,
      promptInjectionGuard: {
        enabled: false
      },
      tiers: {
        defaultTier: "B",
        enableHybrid: true,
        enableRestrictedSafe: true,
        hybridRiskThreshold: 0.4,
        restrictedSafeRecoveryIntervalMs: 120000
      },
      adaptiveConcurrency: {
        enabled: true,
        maxGlobal: 10,
        maxPerDomain: 5
      },
      antiBotPolicy: {
        enabled: true,
        cooldownMs: 45000,
        maxChallengeRetries: 2,
        proxyHint: "proxy://residential",
        sessionHint: "session:warm",
        allowBrowserEscalation: true
      },
      transcript: {
        modeDefault: "auto",
        strategyOrder: ["native_caption_parse", "optional_asr"],
        enableYtdlp: true,
        enableAsr: true,
        enableYtdlpAudioAsr: true,
        enableApify: true,
        apifyActorId: "streamers/youtube-scraper",
        enableBrowserFallback: true,
        ytdlpTimeoutMs: 20000
      },
      cookies: {
        policy: "required",
        source: {
          type: "env",
          value: "OPENDEVBROWSER_PROVIDER_COOKIES"
        }
      },
      browserFallbackPort
    });
  });

  it("maps transcript settings without rollout canary gates", () => {
    const runtimeInit = buildRuntimeInitFromConfig({
      blockerDetectionThreshold: 0.75,
      security: {
        allowRawCDP: false,
        allowNonLocalCdp: false,
        allowUnsafeExport: false,
        promptInjectionGuard: { enabled: true }
      },
      providers: {
        tiers: {
          default: "A",
          enableHybrid: false,
          enableRestrictedSafe: false,
          hybridRiskThreshold: 0.6,
          restrictedSafeRecoveryIntervalMs: 60000
        },
        adaptiveConcurrency: {
          enabled: false,
          maxGlobal: 8,
          maxPerDomain: 4
        },
        crawler: {
          workerThreads: 4,
          queueMax: 2000
        },
        antiBotPolicy: {
          enabled: true,
          cooldownMs: 30000,
          maxChallengeRetries: 1,
          allowBrowserEscalation: false
        },
        transcript: {
          modeDefault: "auto",
          strategyOrder: ["native_caption_parse", "ytdlp_subtitle"],
          enableYtdlp: true,
          enableAsr: false,
          enableYtdlpAudioAsr: false,
          enableApify: false,
          apifyActorId: "streamers/youtube-scraper",
          enableBrowserFallback: true,
          ytdlpTimeoutMs: 12000
        },
        cookiePolicy: "auto",
        cookieSource: {
          type: "file",
          value: "~/.config/opencode/opendevbrowser.provider-cookies.json"
        }
      }
    });

    expect(runtimeInit).toMatchObject({
      transcript: {
        modeDefault: "auto",
        strategyOrder: ["native_caption_parse", "ytdlp_subtitle"],
        enableYtdlp: true,
        enableAsr: false,
        enableYtdlpAudioAsr: false,
        enableApify: false,
        apifyActorId: "streamers/youtube-scraper",
        enableBrowserFallback: true,
        ytdlpTimeoutMs: 12000
      },
      cookies: {
        policy: "auto",
        source: {
          type: "file",
          value: "~/.config/opencode/opendevbrowser.provider-cookies.json"
        }
      }
    });
  });

  it("maps cookie runtime init fields independently when only one knob is configured", () => {
    const cookiePolicyOnly = buildRuntimeInitFromConfig({
      blockerDetectionThreshold: 0.75,
      security: {
        allowRawCDP: false,
        allowNonLocalCdp: false,
        allowUnsafeExport: false,
        promptInjectionGuard: { enabled: true }
      },
      providers: {
        tiers: {
          default: "A",
          enableHybrid: false,
          enableRestrictedSafe: false,
          hybridRiskThreshold: 0.6,
          restrictedSafeRecoveryIntervalMs: 60000
        },
        adaptiveConcurrency: {
          enabled: false,
          maxGlobal: 8,
          maxPerDomain: 4
        },
        crawler: {
          workerThreads: 4,
          queueMax: 2000
        },
        antiBotPolicy: {
          enabled: true,
          cooldownMs: 30000,
          maxChallengeRetries: 1,
          allowBrowserEscalation: false
        },
        transcript: {
          modeDefault: "auto",
          strategyOrder: ["native_caption_parse"],
          enableYtdlp: false,
          enableAsr: false,
          enableYtdlpAudioAsr: false,
          enableApify: false,
          apifyActorId: "streamers/youtube-scraper",
          enableBrowserFallback: false,
          ytdlpTimeoutMs: 10000
        },
        cookiePolicy: "required"
      }
    });

    expect(cookiePolicyOnly).toMatchObject({
      cookies: {
        policy: "required"
      }
    });
    expect((cookiePolicyOnly.cookies as { source?: unknown } | undefined)?.source).toBeUndefined();

    const cookieSourceOnly = buildRuntimeInitFromConfig({
      blockerDetectionThreshold: 0.75,
      security: {
        allowRawCDP: false,
        allowNonLocalCdp: false,
        allowUnsafeExport: false,
        promptInjectionGuard: { enabled: true }
      },
      providers: {
        tiers: {
          default: "A",
          enableHybrid: false,
          enableRestrictedSafe: false,
          hybridRiskThreshold: 0.6,
          restrictedSafeRecoveryIntervalMs: 60000
        },
        adaptiveConcurrency: {
          enabled: false,
          maxGlobal: 8,
          maxPerDomain: 4
        },
        crawler: {
          workerThreads: 4,
          queueMax: 2000
        },
        antiBotPolicy: {
          enabled: true,
          cooldownMs: 30000,
          maxChallengeRetries: 1,
          allowBrowserEscalation: false
        },
        transcript: {
          modeDefault: "auto",
          strategyOrder: ["native_caption_parse"],
          enableYtdlp: false,
          enableAsr: false,
          enableYtdlpAudioAsr: false,
          enableApify: false,
          apifyActorId: "streamers/youtube-scraper",
          enableBrowserFallback: false,
          ytdlpTimeoutMs: 10000
        },
        cookieSource: {
          type: "env",
          value: "OPENDEVBROWSER_PROVIDER_COOKIES"
        }
      }
    });

    expect(cookieSourceOnly).toMatchObject({
      cookies: {
        source: {
          type: "env",
          value: "OPENDEVBROWSER_PROVIDER_COOKIES"
        }
      }
    });
    expect((cookieSourceOnly.cookies as { policy?: unknown } | undefined)?.policy).toBeUndefined();
  });

  it("creates a runtime with default provider set", () => {
    const runtime = createConfiguredProviderRuntime({
      config: {
        blockerDetectionThreshold: 0.7,
        security: {
          allowRawCDP: false,
          allowNonLocalCdp: false,
          allowUnsafeExport: false,
          promptInjectionGuard: { enabled: true }
        },
        providers: {
          tiers: {
            default: "A",
            enableHybrid: false,
            enableRestrictedSafe: false,
            hybridRiskThreshold: 0.6,
            restrictedSafeRecoveryIntervalMs: 60000
          },
          adaptiveConcurrency: {
            enabled: false,
            maxGlobal: 8,
            maxPerDomain: 4
          },
          crawler: {
            workerThreads: 4,
            queueMax: 2000
          },
          antiBotPolicy: {
            enabled: true,
            cooldownMs: 30000,
            maxChallengeRetries: 1,
            allowBrowserEscalation: false
          },
          transcript: {
            modeDefault: "auto",
            strategyOrder: ["native_caption_parse"],
            enableYtdlp: false,
            enableAsr: false,
            enableYtdlpAudioAsr: false,
            enableApify: false,
            apifyActorId: "streamers/youtube-scraper",
            enableBrowserFallback: false,
            ytdlpTimeoutMs: 10000
          },
          cookiePolicy: "auto",
          cookieSource: {
            type: "file",
            value: "~/.config/opencode/opendevbrowser.provider-cookies.json"
          }
        }
      }
    });

    const providerIds = runtime.listProviders().map((provider) => provider.id);
    expect(providerIds).toContain("web/default");
    expect(providerIds).toContain("social/youtube");
    expect(providerIds).toContain("shopping/amazon");
  });
});
