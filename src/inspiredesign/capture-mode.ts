import type { InspiredesignCaptureMode } from "../providers/types";

type ResolveInspiredesignHarvestCaptureModeInput = {
  requested: InspiredesignCaptureMode | undefined;
  urls?: readonly string[];
  harvest: boolean;
  providers?: readonly string[];
};

const hasInspiredesignUrls = (urls?: readonly string[]): boolean => {
  return Array.isArray(urls) && urls.some((url) => url.trim().length > 0);
};

const isPinterestProvider = (provider: string): boolean => provider === "social/pinterest" || provider === "pinterest";

const hasOnlyPinterestProvider = (providers?: readonly string[]): boolean => (
  Array.isArray(providers)
  && providers.length > 0
  && providers.every(isPinterestProvider)
);

const isPinterestUrl = (value: string): boolean => {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "pinterest.com" || hostname.endsWith(".pinterest.com");
  } catch {
    return false;
  }
};

const hasOnlyPinterestUrls = (urls?: readonly string[]): boolean => (
  Array.isArray(urls)
  && urls.length > 0
  && urls.every((url) => isPinterestUrl(url.trim()))
);

const isCanonicalPinterestPinUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const pathSegments = url.pathname.split("/").filter(Boolean);
    const pinId = pathSegments[1];
    return (hostname === "pinterest.com" || hostname.endsWith(".pinterest.com"))
      && pathSegments.length === 2
      && pathSegments[0] === "pin"
      && typeof pinId === "string"
      && /^\d+$/.test(pinId);
  } catch {
    return false;
  }
};

const hasOnlyCanonicalPinterestPinUrls = (urls?: readonly string[]): boolean => (
  Array.isArray(urls)
  && urls.length > 0
  && urls.every((url) => isCanonicalPinterestPinUrl(url.trim()))
);

export function resolveInspiredesignCaptureMode(
  requested: InspiredesignCaptureMode | undefined,
  urls?: readonly string[]
): InspiredesignCaptureMode {
  return hasInspiredesignUrls(urls) ? "deep" : requested ?? "off";
}

export function resolveInspiredesignHarvestCaptureMode(
  input: ResolveInspiredesignHarvestCaptureModeInput
): InspiredesignCaptureMode {
  const hasUrls = hasInspiredesignUrls(input.urls);
  const hasProviders = Array.isArray(input.providers) && input.providers.length > 0;
  const pinterestOnlyProviders = hasOnlyPinterestProvider(input.providers);
  const pinterestOnlyProviderDiscovery = pinterestOnlyProviders && !hasUrls;
  const pinterestOnlyUrlRecovery = hasOnlyPinterestUrls(input.urls) && (!hasProviders || pinterestOnlyProviders);
  const pinterestOnlyDirectPinRun = !input.harvest && !hasProviders && hasOnlyCanonicalPinterestPinUrls(input.urls);
  if (input.harvest && (pinterestOnlyProviderDiscovery || pinterestOnlyUrlRecovery)) {
    return "off";
  }
  if (pinterestOnlyDirectPinRun && input.requested !== "deep") {
    return "off";
  }
  if (input.requested === "deep") return "deep";
  return resolveInspiredesignCaptureMode(input.requested, input.urls);
}
