import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

type AntiBotFixtureEntry = {
  id: string;
  provider: string;
  docUrl: string;
  scriptUrl: string;
  siteKey: string;
  fixturePath: string;
};

type AntiBotFixtureManifest = {
  fixtures: AntiBotFixtureEntry[];
};

const FIXTURE_DIR = path.join(process.cwd(), "tests/fixtures/anti-bot");
const MANIFEST_PATH = path.join(FIXTURE_DIR, "vendor-test-keys.json");

const EXPECTED_SITE_KEYS: Record<string, string> = {
  "cloudflare-turnstile": "1x00000000000000000000AA",
  "google-recaptcha-v2": "6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI"
};

const SITE_KEY_RE = /data-sitekey="([^"]+)"/g;

describe("anti-bot owned-environment fixtures", () => {
  it("pin official vendor test keys in the fixture manifest", () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) as AntiBotFixtureManifest;

    expect(manifest.fixtures).toHaveLength(2);

    for (const fixture of manifest.fixtures) {
      expect(fixture.siteKey).toBe(EXPECTED_SITE_KEYS[fixture.provider]);
      expect(fixture.docUrl.startsWith("https://")).toBe(true);
      expect(fixture.scriptUrl.startsWith("https://")).toBe(true);
    }
  });

  it("uses only approved vendor test site keys in HTML fixtures", () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) as AntiBotFixtureManifest;
    const approvedKeys = new Set(Object.values(EXPECTED_SITE_KEYS));

    for (const fixture of manifest.fixtures) {
      const html = fs.readFileSync(path.join(FIXTURE_DIR, fixture.fixturePath), "utf8");
      const matches = [...html.matchAll(SITE_KEY_RE)].map((match) => match[1]);

      expect(matches).toEqual([fixture.siteKey]);
      expect(matches.every((value) => approvedKeys.has(value))).toBe(true);
      expect(html.includes("secret")).toBe(false);
    }
  });
});
