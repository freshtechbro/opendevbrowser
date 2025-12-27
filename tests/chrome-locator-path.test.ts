import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

let tempRoot = "";
const originalPath = process.env.PATH;
const originalPlatform = process.platform;
const originalProgramFiles = process.env.PROGRAMFILES;
const originalProgramFilesX86 = process.env["PROGRAMFILES(X86)"];
const originalLocalAppData = process.env.LOCALAPPDATA;

const setPlatform = (value: NodeJS.Platform) => {
  Object.defineProperty(process, "platform", { value, configurable: true });
};

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "odb-path-mock-"));
});

afterEach(() => {
  process.env.PATH = originalPath;
  if (originalProgramFiles === undefined) {
    delete process.env.PROGRAMFILES;
  } else {
    process.env.PROGRAMFILES = originalProgramFiles;
  }
  if (originalProgramFilesX86 === undefined) {
    delete process.env["PROGRAMFILES(X86)"];
  } else {
    process.env["PROGRAMFILES(X86)"] = originalProgramFilesX86;
  }
  if (originalLocalAppData === undefined) {
    delete process.env.LOCALAPPDATA;
  } else {
    process.env.LOCALAPPDATA = originalLocalAppData;
  }
  setPlatform(originalPlatform);
  vi.resetModules();
  vi.doUnmock("fs/promises");
});

describe("findChromeExecutable path scanning", () => {
  it("falls back to PATH when system candidates are missing", async () => {
    const binPath = join(tempRoot, "google-chrome");
    process.env.PATH = tempRoot;

    vi.doMock("fs/promises", () => ({
      access: async (path: string) => {
        if (path === binPath) return;
        throw new Error("missing");
      }
    }));

    const { findChromeExecutable } = await import("../src/cache/chrome-locator");
    const result = await findChromeExecutable();

    expect(result).toBe(binPath);
  });

  it("uses Windows install candidates when present", async () => {
    setPlatform("win32");
    process.env.PROGRAMFILES = tempRoot;
    const expected = join(tempRoot, "Google", "Chrome", "Application", "chrome.exe");

    vi.doMock("fs/promises", () => ({
      access: async (path: string) => {
        if (path === expected) return;
        throw new Error("missing");
      }
    }));

    const { findChromeExecutable } = await import("../src/cache/chrome-locator");
    const result = await findChromeExecutable();

    expect(result).toBe(expected);
  });

  it("returns null when no PATH candidates exist", async () => {
    setPlatform("linux");
    process.env.PATH = tempRoot;

    vi.doMock("fs/promises", () => ({
      access: async () => {
        throw new Error("missing");
      }
    }));

    const { findChromeExecutable } = await import("../src/cache/chrome-locator");
    const result = await findChromeExecutable();

    expect(result).toBeNull();
  });
});
