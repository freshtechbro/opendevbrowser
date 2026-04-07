import type { Browser, BrowserType } from "playwright-core";

let chromiumPromise: Promise<BrowserType<Browser>> | null = null;

export function createPlaywrightIntegrityError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error ?? "unknown error");
  return new Error(
    `Failed to load playwright-core. The local install appears incomplete or corrupted (${message}). Repair with \`npm install\`, \`npm ci\`, or by reinstalling \`playwright-core\`.`,
    { cause: error instanceof Error ? error : undefined }
  );
}

export async function loadChromium(): Promise<BrowserType<Browser>> {
  if (!chromiumPromise) {
    chromiumPromise = import("playwright-core")
      .then((module) => module.chromium)
      .catch((error) => {
        chromiumPromise = null;
        throw createPlaywrightIntegrityError(error);
      });
  }
  return chromiumPromise;
}
