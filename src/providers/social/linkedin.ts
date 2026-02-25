import { createSocialPlatformProvider, type SocialProviderOptions } from "./platform";

export const createLinkedInProvider = (options: SocialProviderOptions = {}) => {
  return createSocialPlatformProvider({
    platform: "linkedin",
    displayName: "LinkedIn",
    baseUrl: "https://www.linkedin.com",
    maxPostLength: 3000,
    supportsMedia: true,
    supportsThreads: false
  }, options);
};
