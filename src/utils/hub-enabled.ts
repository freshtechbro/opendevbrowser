import type { OpenDevBrowserConfig } from "../config";

export const isHubEnabled = (config: OpenDevBrowserConfig): boolean => {
  return config.relayToken !== false && config.relayPort > 0;
};
