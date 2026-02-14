import { createSocialPlatformProvider, type SocialProviderOptions } from "./platform";

export const createThreadsProvider = (options: SocialProviderOptions = {}) => {
  return createSocialPlatformProvider({
    platform: "threads",
    displayName: "Threads",
    baseUrl: "https://www.threads.net",
    maxPostLength: 500,
    supportsMedia: true,
    supportsThreads: true
  }, options);
};
