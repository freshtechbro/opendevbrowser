import { describe, expect, it } from "vitest";
import { sanitizeProviderCookieImportProvenance } from "../src/browser/auth-provenance";
import type {
  BrowserManagerLike,
  BrowserProviderCookieImportProvenance,
  ChallengeRuntimeHandle
} from "../src/browser/manager-types";
import { parseGoogleAuthIntent, serializeGoogleAuthIntent } from "../src/core/auth-intent";
import { __test__ as runtimeFactoryTest } from "../src/providers/runtime-factory";

const baseProvenance = (
  overrides: Partial<BrowserProviderCookieImportProvenance> = {}
): BrowserProviderCookieImportProvenance => ({
  policy: "required",
  source: "file",
  attempted: false,
  available: true,
  loadedCount: 1,
  importedCount: 1,
  rejectedCount: 0,
  verifiedCount: 1,
  strict: true,
  sessionEvidence: "cookies_observable",
  authStateVerified: true,
  ...overrides
});

describe("auth provenance sanitization", () => {
  it("maps raw provider cookie source messages to bounded reason labels", () => {
    expect(sanitizeProviderCookieImportProvenance(baseProvenance()).message).toBeUndefined();
    expect(sanitizeProviderCookieImportProvenance(baseProvenance({
      message: "raw file path /private/tmp/cookies.json",
      reasonCode: "auth_required"
    }))).toMatchObject({
      reasonCode: "auth_required",
      message: "auth_required"
    });
    expect(sanitizeProviderCookieImportProvenance(baseProvenance({
      message: "Cookie file /private/tmp/cookies.json is missing",
      available: false,
      loadedCount: 0,
      importedCount: 0,
      verifiedCount: 0,
      sessionEvidence: "not_checked",
      authStateVerified: false
    }))).toMatchObject({
      message: "cookie_source_unavailable"
    });
    expect(sanitizeProviderCookieImportProvenance(baseProvenance({
      message: "Inline cookie source is empty.",
      loadedCount: 0,
      importedCount: 0,
      verifiedCount: 0,
      sessionEvidence: "cookies_missing",
      authStateVerified: false
    }))).toMatchObject({
      message: "cookie_source_empty"
    });
    expect(sanitizeProviderCookieImportProvenance(baseProvenance({
      message: "Provider cookie injection imported 0 entries.",
      attempted: true,
      importedCount: 0,
      verifiedCount: 0,
      sessionEvidence: "cookies_missing",
      authStateVerified: false
    }))).toMatchObject({
      message: "cookie_import_empty"
    });
    expect(sanitizeProviderCookieImportProvenance(baseProvenance({
      message: "Provider cookies were not observable after injection.",
      verifiedCount: 0,
      sessionEvidence: "cookies_missing",
      authStateVerified: false
    }))).toMatchObject({
      message: "cookies_not_observable"
    });
    expect(sanitizeProviderCookieImportProvenance(baseProvenance({
      message: "Provider cookie import completed with an informational notice.",
      attempted: false,
      importedCount: 0,
      verifiedCount: 0,
      sessionEvidence: "not_checked",
      authStateVerified: false
    }))).toMatchObject({
      message: "cookie_import_notice"
    });
  });

  it("normalizes public Google auth intent values", () => {
    expect(parseGoogleAuthIntent(undefined)).toBe("none");
    expect(parseGoogleAuthIntent("none")).toBe("none");
    expect(parseGoogleAuthIntent(" user-owned ")).toBe("user_owned_google");
    expect(parseGoogleAuthIntent("USER_OWNED_GOOGLE")).toBe("user_owned_google");
    expect(() => parseGoogleAuthIntent("google")).toThrow("Unsupported Google auth intent: google");
    expect(serializeGoogleAuthIntent("none")).toBe("none");
    expect(serializeGoogleAuthIntent("user_owned_google")).toBe("user-owned");
  });

  it("keeps provider fallback cookie diagnostics privacy-safe", () => {
    const fileDiagnostics = runtimeFactoryTest.baseCookieDiagnostics("required", {
      type: "file",
      value: "/private/tmp/provider-cookies.json"
    });
    expect(runtimeFactoryTest.cookieDiagnosticsMessage(fileDiagnostics)).toBeUndefined();
    expect(runtimeFactoryTest.cookieDiagnosticsMessage({
      ...fileDiagnostics,
      message: "Inline cookie source is empty."
    })).toBe("Inline cookie source is empty.");
    expect(runtimeFactoryTest.cookieDiagnosticsMessage({
      ...fileDiagnostics,
      message: "Cookie file /private/tmp/provider-cookies.json could not be read.",
      loaded: 0
    })).toBe("cookie_source_unavailable");
    expect(runtimeFactoryTest.cookieDiagnosticsMessage({
      ...fileDiagnostics,
      message: "Cookie file /private/tmp/provider-cookies.json had warnings.",
      loaded: 2
    })).toBe("cookie_import_notice");

    const envDiagnostics = runtimeFactoryTest.baseCookieDiagnostics("required", {
      type: "env",
      value: "PRIVATE_COOKIE_JSON"
    });
    expect(runtimeFactoryTest.cookieDiagnosticsMessage({
      ...envDiagnostics,
      message: "Cookie env PRIVATE_COOKIE_JSON is missing.",
      available: false
    })).toBe("cookie_source_unavailable");
    expect(runtimeFactoryTest.cookieDiagnosticsMessage({
      ...envDiagnostics,
      message: "Raw provider message should not escape.",
      available: true,
      reasonCode: "auth_required"
    })).toBe("auth_required");
    expect(runtimeFactoryTest.cookieDiagnosticsMessage({
      ...envDiagnostics,
      message: "Raw provider message should map through provenance.",
      attempted: true,
      available: true,
      loaded: 1,
      injected: 0
    })).toBe("cookie_import_empty");

    const details = runtimeFactoryTest.cookieDiagnosticsDetails({
      ...fileDiagnostics,
      message: "Cookie file /private/tmp/provider-cookies.json could not be read.",
      loaded: 0
    });
    expect(details.sourceRef).toBe("file");
    expect(JSON.stringify(details)).not.toContain("/private/tmp/provider-cookies.json");
    expect(runtimeFactoryTest.fallbackDetailsMessage(
      "Cookie file /private/tmp/provider-cookies.json could not be read.",
      {
        ...fileDiagnostics,
        message: "Cookie file /private/tmp/provider-cookies.json could not be read.",
        loaded: 0
      }
    )).toBe("cookie_source_unavailable");
    expect(runtimeFactoryTest.fallbackDetailsMessage("Regular fallback error.", fileDiagnostics))
      .toBe("Regular fallback error.");
  });

  it("covers extension auth routing helper edge cases without launching browsers", async () => {
    expect(runtimeFactoryTest.didShoppingAttachReachEquivalentPath("not a url", "https://example.com/search?q=desk"))
      .toBe(false);
    expect(runtimeFactoryTest.didShoppingAttachReachEquivalentPath(
      "https://shop.example.com/search?q=desk%20lamp",
      "https://shop.example.com/s?q=desk+lamp"
    )).toBe(true);
    expect(runtimeFactoryTest.didShoppingAttachReachEquivalentPath(
      "https://shop.example.com/products/123",
      "https://shop.example.com/products/123"
    )).toBe(false);
    expect(runtimeFactoryTest.didShoppingAttachReachEquivalentPath(
      "https://shop.example.com/search?q=desk",
      "https://other.example.com/search?q=desk"
    )).toBe(false);
    expect(runtimeFactoryTest.isRestrictedExtensionAttachUrl("not a url")).toBe(true);
    expect(runtimeFactoryTest.isRestrictedExtensionAttachUrl("   ")).toBe(true);
    expect(runtimeFactoryTest.isRestrictedExtensionAttachUrl("about:blank")).toBe(true);
    expect(runtimeFactoryTest.isRestrictedExtensionAttachUrl("chrome://settings")).toBe(true);
    expect(runtimeFactoryTest.isRestrictedExtensionAttachUrl("ftp://example.com/file")).toBe(true);
    expect(runtimeFactoryTest.isRestrictedExtensionAttachUrl("https://example.com/search?q=desk")).toBe(false);
    expect(runtimeFactoryTest.fallbackPublicUrl(
      "https://accounts.google.com/o/oauth2/v2/auth?client_id=secret",
      "none"
    )).toBe("https://accounts.google.com/o/oauth2/v2/auth?client_id=secret");
    expect(runtimeFactoryTest.fallbackPublicUrl("   ", "user_owned_google")).toBe("redacted_url");
    expect(runtimeFactoryTest.fallbackPublicUrl(
      "https://accounts.google.com/o/oauth2/v2/auth?client_id=secret",
      "user_owned_google"
    )).toBe("https://accounts.google.com/");
    expect(runtimeFactoryTest.fallbackPublicUrl("about:blank", "user_owned_google")).toBe("about:blank");
    expect(runtimeFactoryTest.fallbackPublicUrl("chrome-extension://abc/page.html", "user_owned_google"))
      .toBe("chrome-extension://abc/");
    expect(runtimeFactoryTest.fallbackPublicUrl("data:text/plain,secret", "user_owned_google"))
      .toBe("data:redacted_url");
    expect(runtimeFactoryTest.fallbackPublicUrl("not a url", "user_owned_google")).toBe("redacted_url");
    expect(runtimeFactoryTest.readClonePageHtml(
      `return { props: { dangerouslySetInnerHTML: { __html: ${JSON.stringify("<main>ok</main>")} }}}`
    )).toBe("<main>ok</main>");
    expect(runtimeFactoryTest.readClonePageHtml("return null")).toBeNull();
    expect(runtimeFactoryTest.readClonePageHtml("return { props: { dangerouslySetInnerHTML: { __html: 42 }}}"))
      .toBeNull();
    expect(runtimeFactoryTest.readClonePageHtml("return { props: { dangerouslySetInnerHTML: { __html: \"unterminated }}}"))
      .toBeNull();
    expect(runtimeFactoryTest.isTransientFallbackCaptureError(
      new Error("Execution context was destroyed, most likely because of a navigation.")
    )).toBe(true);
    expect(runtimeFactoryTest.isTransientFallbackCaptureError("Cannot find context with specified id"))
      .toBe(true);
    expect(runtimeFactoryTest.isTransientFallbackCaptureError(new Error("Permanent provider failure")))
      .toBe(false);
    const firstSnapshot = { html: "<main>hello</main>", htmlLength: 18, textLength: 5, linkCount: 1 };
    expect(runtimeFactoryTest.isFallbackCaptureStable(null, firstSnapshot)).toBe(false);
    expect(runtimeFactoryTest.isFallbackCaptureStable(firstSnapshot, {
      html: "<main>hello</main>",
      htmlLength: 18,
      textLength: 5,
      linkCount: 1
    })).toBe(true);
    expect(runtimeFactoryTest.isFallbackCaptureStable(firstSnapshot, {
      html: "<main>hello world</main>",
      htmlLength: 24,
      textLength: 11,
      linkCount: 1
    })).toBe(true);
    expect(runtimeFactoryTest.isFallbackCaptureStable(firstSnapshot, {
      html: "<main>hello world</main>",
      htmlLength: 24,
      textLength: 11,
      linkCount: 2
    })).toBe(false);

    const challengeHandle = {} as ChallengeRuntimeHandle;
    expect(runtimeFactoryTest.createFallbackChallengeRuntimeHandle({
      createChallengeRuntimeHandle: () => challengeHandle
    } as BrowserManagerLike)).toBe(challengeHandle);
    const resolveRefPoint = async () => ({ x: 10, y: 20 });
    const fallbackManager = {} as BrowserManagerLike & { resolveRefPoint: typeof resolveRefPoint };
    Object.assign(fallbackManager, {
      status: async () => ({}),
      goto: async () => ({}),
      waitForLoad: async () => ({}),
      snapshot: async () => ({}),
      click: async () => ({}),
      hover: async () => ({}),
      press: async () => ({}),
      type: async () => ({}),
      select: async () => ({}),
      scroll: async () => ({}),
      pointerMove: async () => ({}),
      pointerDown: async () => ({}),
      pointerUp: async () => ({}),
      drag: async () => ({}),
      cookieList: async () => ({}),
      cookieImport: async () => ({}),
      debugTraceSnapshot: async () => ({}),
      resolveRefPoint
    });
    await expect(runtimeFactoryTest.createFallbackChallengeRuntimeHandle(fallbackManager)
      .resolveRefPoint("session-1", "target-1", "ref-1")).resolves.toEqual({ x: 10, y: 20 });
    expect(() => runtimeFactoryTest.createFallbackChallengeRuntimeHandle({} as BrowserManagerLike))
      .toThrow("Challenge runtime handle is unavailable for browser fallback orchestration.");
  });
});
