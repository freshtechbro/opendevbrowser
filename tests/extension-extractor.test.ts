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
    const result = extractExtension();

    if (result) {
      expect(result).toBe(destDir);
      expect(existsSync(join(destDir, ".version"))).toBe(true);
      expect(existsSync(join(destDir, "manifest.json"))).toBe(true);
    }
  }, 20000);

  it("cleans up staging directory on success", async () => {
    const destDir = getTestConfigDir();
    const parentDir = dirname(destDir);
    mkdirSync(parentDir, { recursive: true });

    const { extractExtension } = await import("../src/extension-extractor");
    const result = extractExtension();

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
    const result = extractExtension();

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
    const result = extractExtension();

    if (result) {
      expect(existsSync(join(destDir, ".version"))).toBe(true);
      expect(existsSync(join(destDir, "old-file.txt"))).toBe(false);
    }
  });

  it("warns when version reads fail and remains synchronous", async () => {
    const destDir = getTestConfigDir();
    const parentDir = dirname(destDir);
    mkdirSync(parentDir, { recursive: true });
    mkdirSync(destDir, { recursive: true });
    writeFileSync(join(destDir, ".version"), "1.0.0");

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      vi.resetModules();
      vi.doMock("fs", async () => {
        const actual = await vi.importActual<typeof import("fs")>("fs");
        return {
          ...actual,
          readFileSync: (...args: Parameters<typeof actual.readFileSync>) => {
            const [path] = args;
            if (typeof path === "string" && (path.endsWith("package.json") || path.endsWith(".version"))) {
              throw new Error("boom");
            }
            return actual.readFileSync(...args);
          }
        };
      });

      const { extractExtension } = await import("../src/extension-extractor");
      const result = extractExtension();

      expect(result).not.toBeInstanceOf(Promise);
      expect(warnSpy).toHaveBeenCalledWith(
        "[opendevbrowser] Failed to read package.json for extension version:",
        expect.any(Error)
      );
      expect(warnSpy).toHaveBeenCalledWith(
        "[opendevbrowser] Failed to read installed extension version:",
        expect.any(Error)
      );
    } finally {
      vi.doUnmock("fs");
      vi.resetModules();
      warnSpy.mockRestore();
    }
  });
});
