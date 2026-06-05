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

export function resolveInspiredesignCaptureMode(
  requested: InspiredesignCaptureMode | undefined,
  urls?: readonly string[]
): InspiredesignCaptureMode {
  return hasInspiredesignUrls(urls) ? "deep" : requested ?? "off";
}

export function resolveInspiredesignHarvestCaptureMode(
  input: ResolveInspiredesignHarvestCaptureModeInput
): InspiredesignCaptureMode {
  if (input.requested === "deep") return "deep";
  const hasUrls = hasInspiredesignUrls(input.urls);
  const pinterestOnlyProviderDiscovery = hasOnlyPinterestProvider(input.providers) && !hasUrls;
  if (input.harvest && (pinterestOnlyProviderDiscovery || hasOnlyPinterestUrls(input.urls))) {
    return input.requested ?? "off";
  }
  return resolveInspiredesignCaptureMode(input.requested, input.urls);
}
