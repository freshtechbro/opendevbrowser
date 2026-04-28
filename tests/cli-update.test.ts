import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runUpdate } from "../src/cli/commands/update";

interface CacheManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

let cacheDir: string;
let previousCacheDir: string | undefined;

function makePath(...segments: string[]): string {
  return join(cacheDir, ...segments);
}

function writeManifest(manifest: CacheManifest): void {
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(makePath("package.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function readManifest(): CacheManifest {
  return JSON.parse(readFileSync(makePath("package.json"), "utf8")) as CacheManifest;
}

beforeEach(() => {
  previousCacheDir = process.env.OPENCODE_CACHE_DIR;
  cacheDir = mkdtempSync(join(tmpdir(), "odb-opencode-cache-"));
  process.env.OPENCODE_CACHE_DIR = cacheDir;
});

afterEach(() => {
  if (previousCacheDir === undefined) {
    delete process.env.OPENCODE_CACHE_DIR;
  } else {
    process.env.OPENCODE_CACHE_DIR = previousCacheDir;
  }
  rmSync(cacheDir, { recursive: true, force: true });
});

describe("runUpdate", () => {
  it("removes stale OpenCode package pins while preserving unrelated cache packages", () => {
    writeManifest({
      dependencies: {
        "oh-my-opencode": "3.15.1",
        opendevbrowser: "0.0.24"
      },
      devDependencies: {
        opendevbrowser: "0.0.24"
      }
    });
    mkdirSync(makePath("node_modules", "opendevbrowser"), { recursive: true });
    mkdirSync(makePath("node_modules", "oh-my-opencode"), { recursive: true });
    writeFileSync(makePath("package-lock.json"), "{\"lockfileVersion\":3}\n", "utf8");

    const result = runUpdate();

    expect(result).toEqual({
      success: true,
      message: "Cache repaired. OpenCode will install the latest version on next run.",
      cleared: true
    });
    expect(existsSync(makePath("node_modules", "opendevbrowser"))).toBe(false);
    expect(existsSync(makePath("node_modules", "oh-my-opencode"))).toBe(true);
    expect(existsSync(makePath("package-lock.json"))).toBe(false);
    expect(readManifest()).toEqual({
      dependencies: {
        "oh-my-opencode": "3.15.1"
      }
    });
  });

  it("repairs manifest-only stale pins", () => {
    writeManifest({
      optionalDependencies: {
        opendevbrowser: "0.0.24"
      },
      peerDependencies: {
        opendevbrowser: "0.0.24"
      }
    });

    const result = runUpdate();

    expect(result.cleared).toBe(true);
    expect(readManifest()).toEqual({});
  });

  it("repairs lockfile-only cache state", () => {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(makePath("package-lock.json"), "{\"lockfileVersion\":3}\n", "utf8");

    const result = runUpdate();

    expect(result).toEqual({
      success: true,
      message: "Cache repaired. OpenCode will install the latest version on next run.",
      cleared: true
    });
    expect(existsSync(makePath("package-lock.json"))).toBe(false);
  });

  it("refuses to mutate cache state while another update lock is held", () => {
    writeManifest({ dependencies: { opendevbrowser: "0.0.24" } });
    mkdirSync(makePath("node_modules", "opendevbrowser"), { recursive: true });
    writeFileSync(makePath("package-lock.json"), "{\"lockfileVersion\":3}\n", "utf8");
    writeFileSync(makePath(".opendevbrowser-update.lock"), "locked\n", "utf8");

    const result = runUpdate();

    expect(result.success).toBe(false);
    expect(result.cleared).toBe(false);
    expect(result.message).toContain("another update is already running");
    expect(readManifest()).toEqual({ dependencies: { opendevbrowser: "0.0.24" } });
    expect(existsSync(makePath("node_modules", "opendevbrowser"))).toBe(true);
    expect(existsSync(makePath("package-lock.json"))).toBe(true);
  });

  it("reports no-op when no cache entries exist", () => {
    mkdirSync(cacheDir, { recursive: true });

    const result = runUpdate();

    expect(result).toEqual({
      success: true,
      message: "No cached plugin found. OpenCode will install the latest version on next run.",
      cleared: false
    });
  });

  it("fails clearly when the OpenCode cache manifest is malformed", () => {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(makePath("package.json"), "{bad-json}", "utf8");

    const result = runUpdate();

    expect(result.success).toBe(false);
    expect(result.cleared).toBe(false);
    expect(result.message).toContain("Failed to clear cache:");
  });

  it("does not delete package cache before validating a malformed manifest", () => {
    mkdirSync(makePath("node_modules", "opendevbrowser"), { recursive: true });
    writeFileSync(makePath("package.json"), "{bad-json}", "utf8");

    const result = runUpdate();

    expect(result.success).toBe(false);
    expect(result.cleared).toBe(false);
    expect(existsSync(makePath("node_modules", "opendevbrowser"))).toBe(true);
  });

  it("refuses to rewrite symlinked cache manifests", () => {
    const outsideManifest = join(cacheDir, "..", "outside-package.json");
    writeFileSync(outsideManifest, JSON.stringify({ dependencies: { opendevbrowser: "0.0.24" } }), "utf8");
    symlinkSync(outsideManifest, makePath("package.json"));

    const result = runUpdate();

    expect(result.success).toBe(false);
    expect(result.cleared).toBe(false);
    expect(result.message).toContain("refusing to modify symlinked cache path");
    expect(readFileSync(outsideManifest, "utf8")).toContain("opendevbrowser");
  });

  it("refuses to mutate a symlinked cache root", () => {
    const realCache = makePath("real-cache");
    const linkedCache = makePath("linked-cache");
    mkdirSync(realCache, { recursive: true });
    symlinkSync(realCache, linkedCache);
    process.env.OPENCODE_CACHE_DIR = linkedCache;

    const result = runUpdate();

    expect(result.success).toBe(false);
    expect(result.message).toContain("refusing to modify symlinked cache path");
  });

  it("refuses to delete through a symlinked node_modules parent", () => {
    const outsideModules = join(cacheDir, "..", "outside-node-modules");
    mkdirSync(outsideModules, { recursive: true });
    symlinkSync(outsideModules, makePath("node_modules"));

    const result = runUpdate();

    expect(result.success).toBe(false);
    expect(result.message).toContain("refusing to modify symlinked cache path");
  });

  it("preflights symlinked cache paths before rewriting stale manifest pins", () => {
    const outsideModules = join(cacheDir, "..", "outside-node-modules-with-manifest");
    mkdirSync(outsideModules, { recursive: true });
    symlinkSync(outsideModules, makePath("node_modules"));
    writeManifest({ dependencies: { opendevbrowser: "0.0.24" } });

    const result = runUpdate();

    expect(result.success).toBe(false);
    expect(result.message).toContain("refusing to modify symlinked cache path");
    expect(readManifest()).toEqual({ dependencies: { opendevbrowser: "0.0.24" } });
  });
});
