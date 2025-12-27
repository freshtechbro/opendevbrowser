import { Browser, detectBrowserPlatform, install, resolveBuildId } from "@puppeteer/browsers";

export type DownloadResult = {
  executablePath: string;
  buildId: string;
};

export async function downloadChromeForTesting(cacheDir: string): Promise<DownloadResult> {
  const platform = detectBrowserPlatform();
  if (!platform) {
    throw new Error("Unsupported platform for Chrome download");
  }

  const buildId = await resolveBuildId(Browser.CHROME, platform, "latest");
  const result = await install({
    browser: Browser.CHROME,
    buildId,
    cacheDir,
    downloadProgressCallback: () => undefined
  });

  return {
    executablePath: result.executablePath,
    buildId
  };
}
