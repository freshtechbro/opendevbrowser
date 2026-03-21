import type { OpenDevBrowserConfig } from "../../config";

export function resolveFigmaAccessToken(
  config: Pick<OpenDevBrowserConfig, "integrations">,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const envToken = typeof env.FIGMA_ACCESS_TOKEN === "string" ? env.FIGMA_ACCESS_TOKEN.trim() : "";
  if (envToken.length > 0) {
    return envToken;
  }
  const configToken = typeof config.integrations?.figma?.accessToken === "string"
    ? config.integrations.figma.accessToken.trim()
    : "";
  return configToken.length > 0 ? configToken : null;
}
