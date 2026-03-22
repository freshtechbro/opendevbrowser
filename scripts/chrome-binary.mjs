import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function existingDirEntries(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function chromeForTestingCandidates() {
  const cacheRoot = path.join(os.homedir(), "Library", "Caches", "ms-playwright");
  const installRoots = existingDirEntries(cacheRoot)
    .filter((entry) => entry.isDirectory() && (entry.name.startsWith("chromium-") || entry.name.startsWith("chrome-")))
    .map((entry) => path.join(cacheRoot, entry.name))
    .sort()
    .reverse();

  const suffixes = [
    path.join("chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
    path.join("chrome-mac", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
    path.join("chrome-mac-arm64", "Chromium.app", "Contents", "MacOS", "Chromium"),
    path.join("chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium")
  ];

  return installRoots.flatMap((root) => suffixes.map((suffix) => path.join(root, suffix)));
}

export function localChromeCandidates(extraCandidates = []) {
  return [
    ...extraCandidates,
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ...chromeForTestingCandidates()
  ].filter((candidate) => typeof candidate === "string" && candidate.length > 0);
}

export function findLocalChromeBinary(extraCandidates = []) {
  return localChromeCandidates(extraCandidates).find((candidate) => fs.existsSync(candidate)) ?? null;
}
