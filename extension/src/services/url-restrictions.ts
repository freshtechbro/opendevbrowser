const RESTRICTED_PROTOCOLS = new Set([
  "chrome:",
  "chrome-extension:",
  "chrome-search:",
  "chrome-untrusted:",
  "devtools:",
  "chrome-devtools:",
  "edge:",
  "brave:"
]);

const isWebStoreUrl = (url: URL): boolean => {
  if (url.hostname === "chromewebstore.google.com") {
    return true;
  }
  if (url.hostname === "chrome.google.com" && url.pathname.startsWith("/webstore")) {
    return true;
  }
  return false;
};

export const getRestrictionMessage = (url: URL): string | null => {
  if (RESTRICTED_PROTOCOLS.has(url.protocol)) {
    return "Active tab uses a restricted URL scheme. Focus a normal http(s) tab and retry.";
  }
  if (isWebStoreUrl(url)) {
    return "Chrome Web Store tabs cannot be debugged. Open a normal tab and retry.";
  }
  return null;
};

export const isRestrictedUrl = (rawUrl: string): { restricted: boolean; message?: string } => {
  try {
    const url = new URL(rawUrl);
    const message = getRestrictionMessage(url);
    if (message) {
      return { restricted: true, message };
    }
    return { restricted: false };
  } catch {
    return { restricted: true, message: "Unable to parse tab URL." };
  }
};
