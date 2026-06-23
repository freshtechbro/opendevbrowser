import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const GUIDANCE_FILES = [
  "docs/CLI.md",
  "docs/TROUBLESHOOTING.md",
  "docs/ARCHITECTURE.md",
  "docs/FIRST_RUN_ONBOARDING.md",
  "docs/SURFACE_REFERENCE.md",
  "skills/opendevbrowser-best-practices/SKILL.md"
] as const;

const readGuidance = (path: string): string => (
  readFileSync(resolve(process.cwd(), path), "utf8")
);

describe("Google OAuth session continuity guidance", () => {
  it("documents extension ops routing, cookie-bootstrap limits, target recovery, and sanitized diagnostics", () => {
    const combined = GUIDANCE_FILES.map(readGuidance).join("\n");
    const oauthSentences = combined
      .split("\n")
      .filter((line) => (
        line.includes("Google")
        || line.includes("google-auth-intent")
        || line.includes("disable-system-cookie-bootstrap")
        || line.includes("authProvenance")
        || line.includes("best-effort")
        || line.includes("targets-list --include-urls")
        || line.includes("target-use --target-id")
        || line.includes("copied cookies")
        || line.includes("extension /ops")
      ))
      .join("\n");

    expect(combined).toContain("--google-auth-intent user-owned");
    expect(combined).toContain("--disable-system-cookie-bootstrap");
    expect(combined).toContain("extension /ops");
    expect(combined).toContain("copied cookies are not Google auth proof");
    expect(combined).toContain("best-effort");
    expect(combined).toContain("diagnostics.authProvenance");
    expect(combined).toContain("targets-list --include-urls");
    expect(combined).toContain("target-use --target-id <target-id>");
    expect(combined).toContain("perceived logout");

    for (const forbidden of ["stealth", "captcha bypass", "ua spoofing", "cookie theft"]) {
      expect(oauthSentences.toLowerCase()).not.toContain(forbidden);
    }
  });
});
