const ALLOWED_PROTOCOLS = new Set([
  "http:",
  "https:"
]);

const DEFAULT_SCHEME_MESSAGE = "Active tab uses a restricted URL scheme. Focus a normal http(s) tab and retry.";
const DEFAULT_WEB_STORE_MESSAGE = "Chrome Web Store tabs cannot be debugged. Open a normal tab and retry.";

const isWebStoreUrl = (url: URL): boolean => {
  if (url.hostname === "chromewebstore.google.com") {
    return true;
  }
  if (url.hostname === "chrome.google.com" && url.pathname.startsWith("/webstore")) {
    return true;
  }
  return false;
};

export const getRestrictionMessage = (
  url: URL,
  options?: {
    restrictedSchemeMessage?: string;
    webStoreMessage?: string;
  }
): string | null => {
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return options?.restrictedSchemeMessage ?? DEFAULT_SCHEME_MESSAGE;
  }
  if (isWebStoreUrl(url)) {
    return options?.webStoreMessage ?? DEFAULT_WEB_STORE_MESSAGE;
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
