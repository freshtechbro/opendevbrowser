import { createSocialPlatformProvider, type SocialProviderOptions } from "./platform";

export const createFacebookProvider = (options: SocialProviderOptions = {}) => {
  return createSocialPlatformProvider({
    platform: "facebook",
    displayName: "Facebook",
    baseUrl: "https://www.facebook.com",
    maxPostLength: 63206,
    supportsMedia: true,
    supportsThreads: false
  }, options);
};
