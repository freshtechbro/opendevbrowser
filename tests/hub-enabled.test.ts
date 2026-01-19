import { describe, expect, it } from "vitest";
import { isHubEnabled } from "../src/utils/hub-enabled";
import type { OpenDevBrowserConfig } from "../src/config";

const baseConfig: OpenDevBrowserConfig = {
  headless: false,
  profile: "default",
  snapshot: { maxChars: 16000, maxNodes: 1000 },
  security: { allowRawCDP: false, allowNonLocalCdp: false, allowUnsafeExport: false },
  devtools: { showFullUrls: false, showFullConsole: false },
  export: { maxNodes: 1000, inlineStyles: true },
  skills: { nudge: { enabled: true, keywords: [], maxAgeMs: 60000 } },
  continuity: { enabled: true, filePath: "continuity.md", nudge: { enabled: true, keywords: [], maxAgeMs: 60000 } },
  relayPort: 8787,
  relayToken: "token",
  daemonPort: 8788,
  daemonToken: "daemon-token",
  flags: [],
  checkForUpdates: false,
  persistProfile: true,
  skillPaths: []
};

describe("isHubEnabled", () => {
  it("returns true when relayPort > 0 and relayToken is set", () => {
    expect(isHubEnabled(baseConfig)).toBe(true);
  });

  it("returns false when relayPort is 0", () => {
    expect(isHubEnabled({ ...baseConfig, relayPort: 0 })).toBe(false);
  });

  it("returns false when relayToken is false", () => {
    expect(isHubEnabled({ ...baseConfig, relayToken: false })).toBe(false);
  });
});
