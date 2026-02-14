import { createSocialPlatformProvider, type SocialProviderOptions } from "./platform";

export const createRedditProvider = (options: SocialProviderOptions = {}) => {
  return createSocialPlatformProvider({
    platform: "reddit",
    displayName: "Reddit",
    baseUrl: "https://www.reddit.com",
    maxPostLength: 40000,
    supportsMedia: true,
    supportsThreads: true
  }, options);
};
