import { createBlueskyProvider } from "./bluesky";
import { createFacebookProvider } from "./facebook";
import { createInstagramProvider } from "./instagram";
import { createLinkedInProvider } from "./linkedin";
import { createRedditProvider } from "./reddit";
import { createThreadsProvider } from "./threads";
import { createTikTokProvider } from "./tiktok";
import { createXProvider } from "./x";
import { createYouTubeProvider, type YouTubeProviderOptions } from "./youtube";
import type { ProviderAdapter } from "../types";
import type { SocialProviderOptions } from "./platform";

export { createXProvider } from "./x";
export { createRedditProvider } from "./reddit";
export { createBlueskyProvider } from "./bluesky";
export { createFacebookProvider } from "./facebook";
export { createLinkedInProvider } from "./linkedin";
export { createInstagramProvider } from "./instagram";
export { createTikTokProvider } from "./tiktok";
export { createThreadsProvider } from "./threads";
export { createYouTubeProvider } from "./youtube";
export { withDefaultYouTubeOptions } from "./youtube";
export { validateYouTubeLegalReviewChecklist, YOUTUBE_LEGAL_REVIEW_CHECKLIST } from "./youtube";
export type { YouTubeProviderOptions } from "./youtube";
export type { SocialProviderOptions, SocialPlatformProfile } from "./platform";

export type SocialPlatform =
  | "x"
  | "reddit"
  | "bluesky"
  | "facebook"
  | "linkedin"
  | "instagram"
  | "tiktok"
  | "threads"
  | "youtube";

export interface SocialProvidersOptions {
  x?: SocialProviderOptions;
  reddit?: SocialProviderOptions;
  bluesky?: SocialProviderOptions;
  facebook?: SocialProviderOptions;
  linkedin?: SocialProviderOptions;
  instagram?: SocialProviderOptions;
  tiktok?: SocialProviderOptions;
  threads?: SocialProviderOptions;
  youtube?: YouTubeProviderOptions;
}

export const createSocialProviders = (options: SocialProvidersOptions = {}): ProviderAdapter[] => {
  return [
    createXProvider(options.x),
    createRedditProvider(options.reddit),
    createBlueskyProvider(options.bluesky),
    createFacebookProvider(options.facebook),
    createLinkedInProvider(options.linkedin),
    createInstagramProvider(options.instagram),
    createTikTokProvider(options.tiktok),
    createThreadsProvider(options.threads),
    createYouTubeProvider(options.youtube)
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
    case "facebook":
      return createFacebookProvider(options);
    case "linkedin":
      return createLinkedInProvider(options);
    case "instagram":
      return createInstagramProvider(options);
    case "tiktok":
      return createTikTokProvider(options);
    case "threads":
      return createThreadsProvider(options);
    case "youtube":
      return createYouTubeProvider(options);
  }
};
