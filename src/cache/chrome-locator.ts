import { access } from "fs/promises";
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
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"
    ];
  }

  if (platform === "win32") {
    const programFiles = process.env.PROGRAMFILES || "C:\\Program Files";
    const programFilesX86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
    const localAppData = process.env.LOCALAPPDATA || "";

    return [
      join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      join(localAppData, "Google", "Chrome", "Application", "chrome.exe")
    ];
  }

  return [];
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
