import { createBlueskyProvider } from "./bluesky";
import { createInstagramProvider } from "./instagram";
import { createLinkedInProvider } from "./linkedin";
import { createRedditProvider } from "./reddit";
import { createThreadsProvider } from "./threads";
import { createTikTokProvider } from "./tiktok";
import { createXProvider } from "./x";
import type { ProviderAdapter } from "../types";
import type { SocialProviderOptions } from "./platform";

export { createXProvider } from "./x";
export { createRedditProvider } from "./reddit";
export { createBlueskyProvider } from "./bluesky";
export { createLinkedInProvider } from "./linkedin";
export { createInstagramProvider } from "./instagram";
export { createTikTokProvider } from "./tiktok";
export { createThreadsProvider } from "./threads";
export type { SocialProviderOptions, SocialPlatformProfile } from "./platform";

export type SocialPlatform = "x" | "reddit" | "bluesky" | "linkedin" | "instagram" | "tiktok" | "threads";

export interface SocialProvidersOptions {
  x?: SocialProviderOptions;
  reddit?: SocialProviderOptions;
  bluesky?: SocialProviderOptions;
  linkedin?: SocialProviderOptions;
  instagram?: SocialProviderOptions;
  tiktok?: SocialProviderOptions;
  threads?: SocialProviderOptions;
}

export const createSocialProviders = (options: SocialProvidersOptions = {}): ProviderAdapter[] => {
  return [
    createXProvider(options.x),
    createRedditProvider(options.reddit),
    createBlueskyProvider(options.bluesky),
    createLinkedInProvider(options.linkedin),
    createInstagramProvider(options.instagram),
    createTikTokProvider(options.tiktok),
    createThreadsProvider(options.threads)
  ];
};

export const createSocialProvider = (
  platform: SocialPlatform,
  options: SocialProviderOptions = {}
): ProviderAdapter => {
  switch (platform) {
    case "x":
      return createXProvider(options);
    case "reddit":
      return createRedditProvider(options);
    case "bluesky":
      return createBlueskyProvider(options);
    case "linkedin":
      return createLinkedInProvider(options);
    case "instagram":
      return createInstagramProvider(options);
    case "tiktok":
      return createTikTokProvider(options);
    case "threads":
      return createThreadsProvider(options);
  }
};
