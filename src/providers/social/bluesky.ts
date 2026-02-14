import { createSocialPlatformProvider, type SocialProviderOptions } from "./platform";

export const createBlueskyProvider = (options: SocialProviderOptions = {}) => {
  return createSocialPlatformProvider({
    platform: "bluesky",
    displayName: "Bluesky",
    baseUrl: "https://bsky.app",
    maxPostLength: 300,
    supportsMedia: true,
    supportsThreads: true
  }, options);
};
