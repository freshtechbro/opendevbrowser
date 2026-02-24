const DEFAULT_PROVIDER_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const DEFAULT_PROVIDER_ACCEPT_LANGUAGE = "en-US,en;q=0.9";

const normalizeHeaderValue = (value: string | undefined, fallback: string): string => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
};

export const providerRequestHeaders = {
  "user-agent": normalizeHeaderValue(process.env.OPDEVBROWSER_PROVIDER_USER_AGENT, DEFAULT_PROVIDER_USER_AGENT),
  "accept-language": normalizeHeaderValue(process.env.OPDEVBROWSER_PROVIDER_ACCEPT_LANGUAGE, DEFAULT_PROVIDER_ACCEPT_LANGUAGE)
} as const;

