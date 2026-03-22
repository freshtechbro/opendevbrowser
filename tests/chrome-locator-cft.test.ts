import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp } from "fs/promises";
import { tmpdir, homedir } from "os";
import { join } from "path";

let tempRoot = "";
const originalPath = process.env.PATH;
const originalPlatform = process.platform;
const originalHome = process.env.HOME;

const setPlatform = (value: NodeJS.Platform) => {
  Object.defineProperty(process, "platform", { value, configurable: true });
};

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "odb-cft-path-"));
});

afterEach(() => {
  process.env.PATH = originalPath;
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  setPlatform(originalPlatform);
  vi.resetModules();
  vi.doUnmock("fs");
  vi.doUnmock("fs/promises");
});

describe("findChromeExecutable Chrome for Testing discovery", () => {
  it("finds a Playwright Chrome for Testing binary on darwin", async () => {
    setPlatform("darwin");
    process.env.HOME = tempRoot;
    process.env.PATH = "";

    const cacheRoot = join(tempRoot, "Library", "Caches", "ms-playwright");
    const installDir = "chromium-1208";
    const expected = join(
      cacheRoot,
      installDir,
      "chrome-mac-arm64",
      "Google Chrome for Testing.app",
      "Contents",
      "MacOS",
      "Google Chrome for Testing"
    );

    vi.doMock("fs", () => ({
      readdirSync: (target: string, options?: { withFileTypes?: boolean }) => {
        if (target !== cacheRoot || !options?.withFileTypes) {
          throw new Error("missing");
        }
        return [
          {
            name: installDir,
            isDirectory: () => true
          }
        ];
      }
    }));

    vi.doMock("fs/promises", () => ({
      access: async (target: string) => {
        if (target === expected) {
          return;
        }
        throw new Error("missing");
      }
    }));

    const { findChromeExecutable } = await import("../src/cache/chrome-locator");
    const result = await findChromeExecutable();

    expect(result).toBe(expected);
    expect(homedir()).toBe(tempRoot);
  });

  it("finds a Playwright Chrome for Testing binary on linux", async () => {
    setPlatform("linux");
    process.env.HOME = tempRoot;
    process.env.PATH = "";

    const cacheRoot = join(tempRoot, ".cache", "ms-playwright");
    const installDir = "chrome-1208";
    const expected = join(cacheRoot, installDir, "chrome-linux", "chrome");

    vi.doMock("fs", () => ({
      readdirSync: (target: string, options?: { withFileTypes?: boolean }) => {
        if (target !== cacheRoot || !options?.withFileTypes) {
          throw new Error("missing");
        }
        return [
          {
            name: installDir,
            isDirectory: () => true
          }
        ];
      }
    }));

    vi.doMock("fs/promises", () => ({
      access: async (target: string) => {
        if (target === expected) {
          return;
        }
        throw new Error("missing");
      }
    }));

    const { findChromeExecutable } = await import("../src/cache/chrome-locator");
    await expect(findChromeExecutable()).resolves.toBe(expected);
  });

  it("returns null on win32 when LocalAppData is missing and PATH is empty", async () => {
    setPlatform("win32");
    delete process.env.LOCALAPPDATA;
    process.env.PATH = "";

    vi.doMock("fs", () => ({
      readdirSync: () => {
        throw new Error("missing");
      }
    }));

    vi.doMock("fs/promises", () => ({
      access: async () => {
        throw new Error("missing");
      }
    }));

    const { findChromeExecutable } = await import("../src/cache/chrome-locator");
    await expect(findChromeExecutable()).resolves.toBeNull();
  });

  it("finds a Playwright Chrome for Testing binary on win32", async () => {
    setPlatform("win32");
    process.env.LOCALAPPDATA = tempRoot;
    process.env.PATH = "";

    const cacheRoot = join(tempRoot, "ms-playwright");
    const installDir = "chrome-1208";
    const expected = join(cacheRoot, installDir, "chrome-win", "chrome.exe");

    vi.doMock("fs", () => ({
      readdirSync: (target: string, options?: { withFileTypes?: boolean }) => {
        if (target !== cacheRoot || !options?.withFileTypes) {
          throw new Error("missing");
        }
        return [
          {
            name: installDir,
            isDirectory: () => true
          }
        ];
      }
    }));

    vi.doMock("fs/promises", () => ({
      access: async (target: string) => {
        if (target === expected) {
          return;
        }
        throw new Error("missing");
      }
    }));

    const { findChromeExecutable } = await import("../src/cache/chrome-locator");
    await expect(findChromeExecutable()).resolves.toBe(expected);
  });

  it("returns an override path immediately when it exists", async () => {
    setPlatform("linux");
    process.env.HOME = tempRoot;
    process.env.PATH = "";

    const overridePath = join(tempRoot, "custom-chrome");

    vi.doMock("fs", () => ({
      readdirSync: () => {
        throw new Error("missing");
      }
    }));

    vi.doMock("fs/promises", () => ({
      access: async (target: string) => {
        if (target === overridePath) {
          return;
        }
        throw new Error("missing");
      }
    }));

    const { findChromeExecutable } = await import("../src/cache/chrome-locator");
    await expect(findChromeExecutable(overridePath)).resolves.toBe(overridePath);
  });

  it("falls back to PATH binaries on linux and win32", async () => {
    setPlatform("linux");
    process.env.HOME = tempRoot;
    process.env.PATH = [join(tempRoot, "bin-a"), join(tempRoot, "bin-b")].join(":");

    const linuxPath = join(tempRoot, "bin-b", "google-chrome");
    vi.doMock("fs", () => ({
      readdirSync: () => {
        throw new Error("missing");
      }
    }));
    vi.doMock("fs/promises", () => ({
      access: async (target: string) => {
        if (target === linuxPath) {
          return;
        }
        throw new Error("missing");
      }
    }));

    let module = await import("../src/cache/chrome-locator");
    await expect(module.findChromeExecutable()).resolves.toBe(linuxPath);

    vi.resetModules();
    setPlatform("win32");
    process.env.LOCALAPPDATA = tempRoot;
    process.env.PATH = [join(tempRoot, "bin-c")].join(";");

    const winPath = join(tempRoot, "bin-c", "google-chrome.exe");
    vi.doMock("fs", () => ({
      readdirSync: () => {
        throw new Error("missing");
      }
    }));
    vi.doMock("fs/promises", () => ({
      access: async (target: string) => {
        if (target === winPath) {
          return;
        }
        throw new Error("missing");
      }
    }));

    module = await import("../src/cache/chrome-locator");
    await expect(module.findChromeExecutable()).resolves.toBe(winPath);
  });

  it("returns null when PATH is missing and no candidate exists", async () => {
    setPlatform("linux");
    process.env.HOME = tempRoot;
    delete process.env.PATH;

    vi.doMock("fs", () => ({
      readdirSync: () => {
        throw new Error("missing");
      }
    }));
    vi.doMock("fs/promises", () => ({
      access: async () => {
        throw new Error("missing");
      }
    }));

    const { findChromeExecutable } = await import("../src/cache/chrome-locator");
    await expect(findChromeExecutable("/missing/override")).resolves.toBeNull();
  });

  it("returns null on unsupported platforms after exhausting PATH lookups", async () => {
    setPlatform("freebsd");
    process.env.HOME = tempRoot;
    process.env.PATH = [join(tempRoot, "bin")].join(":");

    vi.doMock("fs", () => ({
      readdirSync: () => {
        throw new Error("missing");
      }
    }));
    vi.doMock("fs/promises", () => ({
      access: async () => {
        throw new Error("missing");
      }
    }));

    const { findChromeExecutable } = await import("../src/cache/chrome-locator");
    await expect(findChromeExecutable()).resolves.toBeNull();
  });
});
