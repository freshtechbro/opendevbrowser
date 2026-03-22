import { readdirSync } from "fs";
import { access } from "fs/promises";
import { homedir } from "os";
import { delimiter, join } from "path";

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function pathCandidatesByPlatform(): string[] {
  const platform = process.platform;

  if (platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      ...chromeForTestingCandidatesByPlatform()
    ];
  }

  if (platform === "win32") {
    const programFiles = process.env.PROGRAMFILES || "C:\\Program Files";
    const programFilesX86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
    const localAppData = process.env.LOCALAPPDATA || "";

    return [
      join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
      ...chromeForTestingCandidatesByPlatform()
    ];
  }

  return chromeForTestingCandidatesByPlatform();
}

function chromeForTestingSuffixes(platform: NodeJS.Platform): string[] {
  if (platform === "darwin") {
    return [
      join("chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
      join("chrome-mac", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
      join("chrome-mac-arm64", "Chromium.app", "Contents", "MacOS", "Chromium"),
      join("chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium")
    ];
  }
  if (platform === "linux") {
    return [
      join("chrome-linux", "chrome"),
      join("chromium-linux", "chrome")
    ];
  }
  if (platform === "win32") {
    return [
      join("chrome-win", "chrome.exe"),
      join("chromium-win64", "chrome.exe"),
      join("chromium-win32", "chrome.exe")
    ];
  }
  return [];
}

function chromeForTestingRoot(): string | null {
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Caches", "ms-playwright");
  }
  if (process.platform === "linux") {
    return join(homedir(), ".cache", "ms-playwright");
  }
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    return localAppData ? join(localAppData, "ms-playwright") : null;
  }
  return null;
}

function chromeForTestingCandidatesByPlatform(): string[] {
  const root = chromeForTestingRoot();
  if (!root) return [];
  let entries: string[] = [];
  try {
    entries = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && (entry.name.startsWith("chromium-") || entry.name.startsWith("chrome-")))
      .map((entry) => entry.name)
      .sort()
      .reverse();
  } catch {
    return [];
  }
  const suffixes = chromeForTestingSuffixes(process.platform);
  return entries.flatMap((entry) => suffixes.map((suffix) => join(root, entry, suffix)));
}

function binaryCandidatesInPath(): string[] {
  return [
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser"
  ];
}

async function findInPath(binary: string): Promise<string | null> {
  const pathValue = process.env.PATH;
  if (!pathValue) return null;

  const candidates = process.platform === "win32" ? [binary, `${binary}.exe`] : [binary];
  for (const dir of pathValue.split(delimiter)) {
    for (const name of candidates) {
      const fullPath = join(dir, name);
      if (await pathExists(fullPath)) return fullPath;
    }
  }

  return null;
}

export async function findChromeExecutable(overridePath?: string): Promise<string | null> {
  if (overridePath && await pathExists(overridePath)) {
    return overridePath;
  }

  for (const candidate of pathCandidatesByPlatform()) {
    if (await pathExists(candidate)) return candidate;
  }

  for (const binary of binaryCandidatesInPath()) {
    const found = await findInPath(binary);
    if (found) return found;
  }

  return null;
}
