import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, stat } from "fs/promises";
import { homedir, tmpdir } from "os";
import { join } from "path";
import { ensureFileAbsent, resolveCachePaths } from "../src/cache/paths";

let tempRoot = "";
const originalCache = process.env.OPENCODE_CACHE_DIR;
const originalXdg = process.env.XDG_CACHE_HOME;
const originalHome = process.env.HOME;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "odb-cache-"));
  process.env.OPENCODE_CACHE_DIR = tempRoot;
});

afterEach(() => {
  if (originalCache === undefined) {
    delete process.env.OPENCODE_CACHE_DIR;
  } else {
    process.env.OPENCODE_CACHE_DIR = originalCache;
  }
  if (originalXdg === undefined) {
    delete process.env.XDG_CACHE_HOME;
  } else {
    process.env.XDG_CACHE_HOME = originalXdg;
  }
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
});

describe("resolveCachePaths", () => {
  it("creates cache directories", async () => {
    const paths = await resolveCachePaths("/tmp/project", "default");
    const rootStat = await stat(paths.root);
    const projectStat = await stat(paths.projectRoot);
    const profileStat = await stat(paths.profileDir);
    const chromeStat = await stat(paths.chromeDir);

    expect(rootStat.isDirectory()).toBe(true);
    expect(projectStat.isDirectory()).toBe(true);
    expect(profileStat.isDirectory()).toBe(true);
    expect(chromeStat.isDirectory()).toBe(true);
  });

  it("uses XDG cache when opencode cache is unset", async () => {
    delete process.env.OPENCODE_CACHE_DIR;
    process.env.XDG_CACHE_HOME = tempRoot;

    const paths = await resolveCachePaths("/tmp/project", "default");
    expect(paths.root.startsWith(tempRoot)).toBe(true);
  });

  it("uses homedir when envs are unset", async () => {
    delete process.env.OPENCODE_CACHE_DIR;
    delete process.env.XDG_CACHE_HOME;
    process.env.HOME = tempRoot;

    const paths = await resolveCachePaths("/tmp/project", "default");
    expect(paths.root.startsWith(join(homedir(), ".cache"))).toBe(true);
  });
});

describe("ensureFileAbsent", () => {
  it("throws when path exists", async () => {
    const target = join(tempRoot, "existing");
    await writeFile(target, "data");
    await expect(ensureFileAbsent(target)).rejects.toThrow("Path already exists");
  });

  it("does nothing when path does not exist", async () => {
    const target = join(tempRoot, "missing");
    await expect(ensureFileAbsent(target)).resolves.toBeUndefined();
  });
});
