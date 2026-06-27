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

  it("covers extension auth routing helper edge cases without launching browsers", () => {
    expect(runtimeFactoryTest.didShoppingAttachReachEquivalentPath("not a url", "https://example.com/search?q=desk"))
      .toBe(false);
    expect(runtimeFactoryTest.isRestrictedExtensionAttachUrl("not a url")).toBe(true);

    const challengeHandle = {} as ChallengeRuntimeHandle;
    expect(runtimeFactoryTest.createFallbackChallengeRuntimeHandle({
      createChallengeRuntimeHandle: () => challengeHandle
    } as BrowserManagerLike)).toBe(challengeHandle);
    expect(() => runtimeFactoryTest.createFallbackChallengeRuntimeHandle({} as BrowserManagerLike))
      .toThrow("Challenge runtime handle is unavailable for browser fallback orchestration.");
  });
});
