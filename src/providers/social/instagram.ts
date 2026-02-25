import { createSocialPlatformProvider, type SocialProviderOptions } from "./platform";

export const createInstagramProvider = (options: SocialProviderOptions = {}) => {
  return createSocialPlatformProvider({
    platform: "instagram",
    displayName: "Instagram",
    baseUrl: "https://www.instagram.com",
    maxPostLength: 2200,
    supportsMedia: true,
    supportsThreads: false
  }, options);
};
