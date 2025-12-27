import { describe, it, expect, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  detectBrowserPlatform: vi.fn(),
  resolveBuildId: vi.fn(),
  install: vi.fn()
}));

vi.mock("@puppeteer/browsers", () => ({
  Browser: { CHROME: "chrome" },
  detectBrowserPlatform: mocks.detectBrowserPlatform,
  resolveBuildId: mocks.resolveBuildId,
  install: mocks.install
}));

import { downloadChromeForTesting } from "../src/cache/downloader";

describe("downloadChromeForTesting", () => {
  it("throws when platform unsupported", async () => {
    mocks.detectBrowserPlatform.mockReturnValue(null);
    await expect(downloadChromeForTesting("/tmp"))
      .rejects
      .toThrow("Unsupported platform");
  });

  it("downloads chrome for testing", async () => {
    mocks.detectBrowserPlatform.mockReturnValue("linux");
    mocks.resolveBuildId.mockResolvedValue("build");
    mocks.install.mockImplementation(async (options: { downloadProgressCallback?: () => void }) => {
      options.downloadProgressCallback?.();
      return { executablePath: "/tmp/chrome" };
    });

    const result = await downloadChromeForTesting("/tmp/cache");
    expect(result.executablePath).toBe("/tmp/chrome");
    expect(result.buildId).toBe("build");
  });
});
