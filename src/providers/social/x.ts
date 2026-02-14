import { createSocialPlatformProvider, type SocialProviderOptions } from "./platform";

export const createXProvider = (options: SocialProviderOptions = {}) => {
  return createSocialPlatformProvider({
    platform: "x",
    displayName: "X",
    baseUrl: "https://x.com",
    maxPostLength: 280,
    supportsMedia: true,
    supportsThreads: true
  }, options);
};
