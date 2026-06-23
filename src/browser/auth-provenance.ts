import type { BrowserProviderCookieImportProvenance } from "./manager-types";

const resolveProviderCookieImportMessage = (
  input: BrowserProviderCookieImportProvenance
): string | undefined => {
  if (!input.message) {
    return undefined;
  }
  if (input.reasonCode) {
    return input.reasonCode;
  }
  if (!input.available) {
    return "cookie_source_unavailable";
  }
  if (input.loadedCount === 0) {
    return "cookie_source_empty";
  }
  if (input.attempted && input.importedCount === 0) {
    return "cookie_import_empty";
  }
  if (input.importedCount > 0 && input.verifiedCount === 0) {
    return "cookies_not_observable";
  }
  return "cookie_import_notice";
};

export const sanitizeProviderCookieImportProvenance = (
  input: BrowserProviderCookieImportProvenance
): BrowserProviderCookieImportProvenance => {
  const base = {
    policy: input.policy,
    source: input.source,
    attempted: input.attempted,
    available: input.available,
    loadedCount: input.loadedCount,
    importedCount: input.importedCount,
    rejectedCount: input.rejectedCount,
    verifiedCount: input.verifiedCount,
    strict: input.strict,
    sessionEvidence: input.sessionEvidence,
    authStateVerified: input.authStateVerified,
    ...(input.reasonCode ? { reasonCode: input.reasonCode } : {})
  };
  const message = resolveProviderCookieImportMessage(input);
  return message ? { ...base, message } : base;
};
