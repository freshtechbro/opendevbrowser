import { createSocialPlatformProvider, type SocialProviderOptions } from "./platform";

export const createTikTokProvider = (options: SocialProviderOptions = {}) => {
  return createSocialPlatformProvider({
    platform: "tiktok",
    displayName: "TikTok",
    baseUrl: "https://www.tiktok.com",
    maxPostLength: 2200,
    supportsMedia: true,
    supportsThreads: false
  }, options);
};
