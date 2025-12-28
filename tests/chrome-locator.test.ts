import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { findChromeExecutable } from "../src/cache/chrome-locator";

let tempRoot = "";
const originalPath = process.env.PATH;
const originalPlatform = process.platform;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "odb-path-"));
});

afterEach(() => {
  process.env.PATH = originalPath;
  Object.defineProperty(process, "platform", { value: originalPlatform });
});

describe("findChromeExecutable", () => {
  it("returns override path when present", async () => {
    const overridePath = join(tempRoot, "chrome-bin");
    await writeFile(overridePath, "");

    const result = await findChromeExecutable(overridePath);
    expect(result).toBe(overridePath);
  });

  it("searches PATH for known binaries", async () => {
    const binPath = join(tempRoot, "google-chrome");
    await writeFile(binPath, "");
    process.env.PATH = tempRoot;

    const result = await findChromeExecutable();
    expect(result).toBeTruthy();
    expect([binPath, result]).toContain(result);
  });

  it("returns null when PATH is not set", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    process.env.PATH = "";

    const result = await findChromeExecutable();
    expect(result).toBeNull();
  });

  it("handles win32 platform with .exe suffix", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    const binPath = join(tempRoot, "google-chrome.exe");
    await writeFile(binPath, "");
    process.env.PATH = tempRoot;

    const result = await findChromeExecutable();
    expect(result).toBe(binPath);
  });

  it("checks win32 program files candidates", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    process.env.PATH = "";
    process.env.PROGRAMFILES = tempRoot;
    
    const chromePath = join(tempRoot, "Google", "Chrome", "Application");
    await import("fs/promises").then(fs => fs.mkdir(chromePath, { recursive: true }));
    const exePath = join(chromePath, "chrome.exe");
    await writeFile(exePath, "");

    const result = await findChromeExecutable();
    expect(result).toBe(exePath);
  });
});
