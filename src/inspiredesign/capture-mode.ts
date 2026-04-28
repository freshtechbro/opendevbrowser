import type { InspiredesignCaptureMode } from "../providers/types";

const hasInspiredesignUrls = (urls?: readonly string[]): boolean => {
  return Array.isArray(urls) && urls.some((url) => url.trim().length > 0);
};

export function resolveInspiredesignCaptureMode(
  requested: InspiredesignCaptureMode | undefined,
  urls?: readonly string[]
): InspiredesignCaptureMode {
  return hasInspiredesignUrls(urls) ? "deep" : requested ?? "off";
}
