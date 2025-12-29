import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";

let testHomeDir: string;
let originalEnv: NodeJS.ProcessEnv;

vi.mock("os", async () => {
  const actual = await vi.importActual("os");
  return {
    ...actual,
    homedir: () => testHomeDir
  };
});

function getTestConfigDir(): string {
  return join(testHomeDir, ".config", "opencode", "opendevbrowser", "extension");
}

describe("extension-extractor", () => {
  beforeEach(() => {
    testHomeDir = mkdtempSync(join(tmpdir(), "ext-test-"));
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    vi.resetModules();
    process.env = originalEnv;
    if (existsSync(testHomeDir)) {
      rmSync(testHomeDir, { recursive: true, force: true });
    }
  });

  it("returns cached dest when version matches and install is complete", async () => {
    const destDir = getTestConfigDir();
    mkdirSync(destDir, { recursive: true });
    writeFileSync(join(destDir, "manifest.json"), "{}");
    writeFileSync(join(destDir, ".version"), "1.0.0");

    const { getExtensionPath } = await import("../src/extension-extractor");
    const result = getExtensionPath();

    expect(result).toBe(destDir);
  });

  it("falls back when install is incomplete (missing .version)", async () => {
    const destDir = getTestConfigDir();
    mkdirSync(destDir, { recursive: true });
    writeFileSync(join(destDir, "manifest.json"), "{}");

    const { getExtensionPath } = await import("../src/extension-extractor");
    const result = getExtensionPath();

    expect(result).not.toBe(destDir);
  });

  it("falls back when manifest.json is missing", async () => {
    const destDir = getTestConfigDir();
    mkdirSync(destDir, { recursive: true });
    writeFileSync(join(destDir, ".version"), "1.0.0");

    const { getExtensionPath } = await import("../src/extension-extractor");
    const result = getExtensionPath();

    expect(result).not.toBe(destDir);
  });

  it("extracts to destDir and creates .version file", async () => {
    const destDir = getTestConfigDir();
    const parentDir = dirname(destDir);
    mkdirSync(parentDir, { recursive: true });

    const { extractExtension } = await import("../src/extension-extractor");
    const result = await extractExtension();

    if (result) {
      expect(result).toBe(destDir);
      expect(existsSync(join(destDir, ".version"))).toBe(true);
      expect(existsSync(join(destDir, "manifest.json"))).toBe(true);
    }
  });

  it("cleans up staging directory on success", async () => {
    const destDir = getTestConfigDir();
    const parentDir = dirname(destDir);
    mkdirSync(parentDir, { recursive: true });

    const { extractExtension } = await import("../src/extension-extractor");
    const result = await extractExtension();

    if (result) {
      const parentContents = readdirSync(parentDir);
      const stagingDirs = parentContents.filter(f => f.startsWith(".opendevbrowser-staging-"));
      expect(stagingDirs).toHaveLength(0);
    }
  });

  it("cleans up backup directory on success", async () => {
    const destDir = getTestConfigDir();
    const parentDir = dirname(destDir);
    mkdirSync(destDir, { recursive: true });
    writeFileSync(join(destDir, "manifest.json"), "{}");
    writeFileSync(join(destDir, ".version"), "0.0.1");

    const { extractExtension } = await import("../src/extension-extractor");
    const result = await extractExtension();

    if (result) {
      const parentContents = readdirSync(parentDir);
      const backupDirs = parentContents.filter(f => f.startsWith(".opendevbrowser-backup-"));
      expect(backupDirs).toHaveLength(0);
    }
  });

  it("re-extracts when version differs", async () => {
    const destDir = getTestConfigDir();
    mkdirSync(destDir, { recursive: true });
    writeFileSync(join(destDir, "manifest.json"), "{}");
    writeFileSync(join(destDir, ".version"), "0.0.0-old");
    writeFileSync(join(destDir, "old-file.txt"), "should be removed");

    const { extractExtension } = await import("../src/extension-extractor");
    const result = await extractExtension();

    if (result) {
      expect(existsSync(join(destDir, ".version"))).toBe(true);
      expect(existsSync(join(destDir, "old-file.txt"))).toBe(false);
    }
  });
});
