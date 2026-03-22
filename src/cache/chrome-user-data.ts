import * as fs from "fs";
import * as path from "path";
import { homedir } from "os";

const PROFILE_PREFERENCES_FILES = ["Preferences", "Secure Preferences"] as const;

export type ChromeUserDataSource = {
  browserName: "chrome" | "chromium" | "brave";
  userDataDir: string;
  profileDirectory: string;
  profilePath: string;
};

type ChromeUserDataRoot = {
  browserName: ChromeUserDataSource["browserName"];
  userDataDir: string;
};

const getChromeUserDataRootCandidates = (): ChromeUserDataRoot[] => {
  if (process.platform === "darwin") {
    return [
      {
        browserName: "chrome",
        userDataDir: path.join(homedir(), "Library", "Application Support", "Google", "Chrome")
      },
      {
        browserName: "chromium",
        userDataDir: path.join(homedir(), "Library", "Application Support", "Chromium")
      },
      {
        browserName: "brave",
        userDataDir: path.join(homedir(), "Library", "Application Support", "BraveSoftware", "Brave-Browser")
      }
    ];
  }

  if (process.platform === "linux") {
    return [
      {
        browserName: "chrome",
        userDataDir: path.join(homedir(), ".config", "google-chrome")
      },
      {
        browserName: "chromium",
        userDataDir: path.join(homedir(), ".config", "chromium")
      },
      {
        browserName: "brave",
        userDataDir: path.join(homedir(), ".config", "BraveSoftware", "Brave-Browser")
      }
    ];
  }

  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA
      || (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "AppData", "Local") : "");
    if (!localAppData) {
      return [];
    }
    return [
      {
        browserName: "chrome",
        userDataDir: path.join(localAppData, "Google", "Chrome", "User Data")
      },
      {
        browserName: "chromium",
        userDataDir: path.join(localAppData, "Chromium", "User Data")
      },
      {
        browserName: "brave",
        userDataDir: path.join(localAppData, "BraveSoftware", "Brave-Browser", "User Data")
      }
    ];
  }

  return [];
};

export const getChromeUserDataRoots = (): string[] => {
  return getChromeUserDataRootCandidates().map((candidate) => candidate.userDataDir);
};

export const getProfileDirs = (root: string): string[] => {
  try {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && (entry.name === "Default" || entry.name.startsWith("Profile ")))
      .map((entry) => path.join(root, entry.name))
      .filter((dir) => PROFILE_PREFERENCES_FILES.some((filename) => fs.existsSync(path.join(dir, filename))));
  } catch {
    return [];
  }
};

export const readProfilePreferences = (profileDir: string): Record<string, unknown>[] => {
  const records: Record<string, unknown>[] = [];
  for (const filename of PROFILE_PREFERENCES_FILES) {
    try {
      const raw = fs.readFileSync(path.join(profileDir, filename), "utf8");
      records.push(JSON.parse(raw) as Record<string, unknown>);
    } catch {
      // Missing or invalid preference files are ignored; other sources may still be valid.
    }
  }
  return records;
};

const readLocalState = (root: string): Record<string, unknown> | null => {
  try {
    const raw = fs.readFileSync(path.join(root, "Local State"), "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const pickPreferredProfileDirectory = (root: string, profileDirs: string[]): string | null => {
  if (profileDirs.length === 0) {
    return null;
  }
  const available = new Set(profileDirs.map((profileDir) => path.basename(profileDir)));
  const localState = readLocalState(root);
  const profileState = localState?.profile;
  const lastUsed = typeof profileState === "object" && profileState !== null
    ? typeof (profileState as { last_used?: unknown }).last_used === "string"
      ? (profileState as { last_used: string }).last_used
      : null
    : null;
  if (lastUsed && available.has(lastUsed)) {
    return lastUsed;
  }
  if (available.has("Default")) {
    return "Default";
  }
  const firstProfile = profileDirs[0]!;
  return path.basename(firstProfile);
};

export const discoverSystemChromeProfileSource = (): ChromeUserDataSource | null => {
  for (const candidate of getChromeUserDataRootCandidates()) {
    const profileDirs = getProfileDirs(candidate.userDataDir);
    const profileDirectory = pickPreferredProfileDirectory(candidate.userDataDir, profileDirs);
    if (!profileDirectory) {
      continue;
    }
    return {
      browserName: candidate.browserName,
      userDataDir: candidate.userDataDir,
      profileDirectory,
      profilePath: path.join(candidate.userDataDir, profileDirectory)
    };
  }
  return null;
};

export const __test__ = {
  getChromeUserDataRoots,
  getProfileDirs,
  readProfilePreferences,
  discoverSystemChromeProfileSource
};
