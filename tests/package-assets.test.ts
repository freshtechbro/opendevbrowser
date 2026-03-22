import * as path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

const modulePath = "../src/utils/package-assets";
const mockedPackageRoot = path.join(path.sep, "mock", "project");
const mockedModuleFile = path.join(mockedPackageRoot, "src", "utils", "package-assets.ts");
const mockedPackageJson = path.join(mockedPackageRoot, "package.json");
const mockedSkillsDir = path.join(mockedPackageRoot, "skills");

async function importPackageAssets(options?: {
  existingPaths?: Set<string>;
  packageJsonContents?: string;
}) {
  vi.resetModules();

  const existingPaths = options?.existingPaths ?? new Set<string>();
  const readFileSync = vi.fn((filePath: string) => {
    if (filePath === mockedPackageJson) {
      return options?.packageJsonContents ?? JSON.stringify({ name: "opendevbrowser" });
    }
    throw new Error(`Unexpected read: ${filePath}`);
  });

  vi.doMock("fs", () => ({
    existsSync: vi.fn((filePath: string) => existingPaths.has(filePath)),
    readFileSync
  }));
  vi.doMock("url", () => ({
    fileURLToPath: vi.fn(() => mockedModuleFile)
  }));

  const module = await import(modulePath);
  return { module, readFileSync };
}

afterEach(() => {
  vi.resetModules();
  vi.unmock("fs");
  vi.unmock("url");
});

describe("package-assets", () => {
  it("finds and caches the package root", async () => {
    const { module, readFileSync } = await importPackageAssets({
      existingPaths: new Set([mockedPackageJson])
    });

    expect(module.getPackageRoot()).toBe(mockedPackageRoot);
    expect(module.getPackageRoot()).toBe(mockedPackageRoot);
    expect(readFileSync).toHaveBeenCalledTimes(1);
  });

  it("throws when the package root cannot be found", async () => {
    const { module } = await importPackageAssets();
    expect(() => module.getPackageRoot()).toThrow("Unable to locate opendevbrowser package root.");
  });

  it("ignores package.json files that belong to other packages", async () => {
    const { module } = await importPackageAssets({
      existingPaths: new Set([mockedPackageJson]),
      packageJsonContents: JSON.stringify({ name: "other-package" })
    });

    expect(() => module.getPackageRoot()).toThrow("Unable to locate opendevbrowser package root.");
  });

  it("returns null when the bundled skills directory is missing", async () => {
    const { module } = await importPackageAssets({
      existingPaths: new Set([mockedPackageJson])
    });

    expect(module.findBundledSkillsDir()).toBeNull();
  });

  it("returns null from findBundledSkillsDir when package root lookup fails", async () => {
    const { module } = await importPackageAssets();
    expect(module.findBundledSkillsDir()).toBeNull();
  });

  it("returns the bundled skills directory when present", async () => {
    const { module } = await importPackageAssets({
      existingPaths: new Set([mockedPackageJson, mockedSkillsDir])
    });

    expect(module.getBundledSkillsDir()).toBe(mockedSkillsDir);
  });

  it("throws when getBundledSkillsDir cannot find the bundled skills directory", async () => {
    const { module } = await importPackageAssets({
      existingPaths: new Set([mockedPackageJson])
    });

    expect(() => module.getBundledSkillsDir()).toThrow("Bundled skills directory not found in opendevbrowser package.");
  });
});
