import { afterEach, describe, expect, it, vi } from "vitest";
import { join } from "path";

const originalPlatform = process.platform;
const originalHome = process.env.HOME;
const originalLocalAppData = process.env.LOCALAPPDATA;
const originalUserProfile = process.env.USERPROFILE;

const setPlatform = (value: NodeJS.Platform) => {
  Object.defineProperty(process, "platform", { value, configurable: true });
};

const createDirent = (name: string, isDirectory = true) => ({
  name,
  isDirectory: () => isDirectory
});

const loadModule = async (fsMock: Record<string, unknown> = {}) => {
  vi.resetModules();
  vi.doMock("fs", () => fsMock);
  return await import("../src/cache/chrome-user-data");
};

afterEach(() => {
  setPlatform(originalPlatform);
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  if (originalLocalAppData === undefined) {
    delete process.env.LOCALAPPDATA;
  } else {
    process.env.LOCALAPPDATA = originalLocalAppData;
  }
  if (originalUserProfile === undefined) {
    delete process.env.USERPROFILE;
  } else {
    process.env.USERPROFILE = originalUserProfile;
  }
  vi.doUnmock("fs");
  vi.resetModules();
});

describe("chrome user data discovery", () => {
  it("returns darwin root candidates from the home directory", async () => {
    setPlatform("darwin");
    process.env.HOME = "/Users/tester";

    const { getChromeUserDataRoots } = await loadModule();

    expect(getChromeUserDataRoots()).toEqual([
      "/Users/tester/Library/Application Support/Google/Chrome",
      "/Users/tester/Library/Application Support/Chromium",
      "/Users/tester/Library/Application Support/BraveSoftware/Brave-Browser"
    ]);
  });

  it("returns linux, win32 fallback, and unsupported platform roots correctly", async () => {
    setPlatform("linux");
    process.env.HOME = "/home/tester";
    let module = await loadModule();
    expect(module.getChromeUserDataRoots()).toEqual([
      "/home/tester/.config/google-chrome",
      "/home/tester/.config/chromium",
      "/home/tester/.config/BraveSoftware/Brave-Browser"
    ]);

    setPlatform("win32");
    delete process.env.LOCALAPPDATA;
    process.env.USERPROFILE = "/Users/win";
    module = await loadModule();
    expect(module.getChromeUserDataRoots()).toEqual([
      "/Users/win/AppData/Local/Google/Chrome/User Data",
      "/Users/win/AppData/Local/Chromium/User Data",
      "/Users/win/AppData/Local/BraveSoftware/Brave-Browser/User Data"
    ]);

    delete process.env.USERPROFILE;
    module = await loadModule();
    expect(module.getChromeUserDataRoots()).toEqual([]);

    setPlatform("freebsd");
    module = await loadModule();
    expect(module.getChromeUserDataRoots()).toEqual([]);
  });

  it("filters profile directories to Default/Profile folders with readable preference files", async () => {
    const root = "/profiles";
    const allowed = new Set([
      join(root, "Default", "Preferences"),
      join(root, "Profile 2", "Secure Preferences")
    ]);
    const { getProfileDirs } = await loadModule({
      readdirSync: vi.fn(() => [
        createDirent("Default"),
        createDirent("Profile 2"),
        createDirent("Guest Profile"),
        createDirent("Downloads", false)
      ]),
      existsSync: vi.fn((filePath: string) => allowed.has(filePath))
    });

    expect(getProfileDirs(root)).toEqual([
      join(root, "Default"),
      join(root, "Profile 2")
    ]);
  });

  it("returns [] when profile directory enumeration fails", async () => {
    const { getProfileDirs } = await loadModule({
      readdirSync: vi.fn(() => {
        throw new Error("permission denied");
      })
    });

    expect(getProfileDirs("/missing")).toEqual([]);
  });

  it("reads available profile preference files and ignores invalid or missing entries", async () => {
    const profileDir = "/profiles/Default";
    const { readProfilePreferences } = await loadModule({
      readFileSync: vi.fn((filePath: string) => {
        if (filePath === join(profileDir, "Preferences")) {
          return JSON.stringify({ profile: { name: "Default" } });
        }
        if (filePath === join(profileDir, "Secure Preferences")) {
          throw new Error("missing");
        }
        throw new Error(`unexpected path ${filePath}`);
      })
    });

    expect(readProfilePreferences(profileDir)).toEqual([{ profile: { name: "Default" } }]);
  });

  it("skips empty root candidates and picks the last-used profile from Local State", async () => {
    setPlatform("linux");
    process.env.HOME = "/home/tester";

    const chromeRoot = "/home/tester/.config/google-chrome";
    const chromiumRoot = "/home/tester/.config/chromium";
    const profile2 = join(chromiumRoot, "Profile 2");
    const allowed = new Set([join(profile2, "Preferences")]);
    const { discoverSystemChromeProfileSource } = await loadModule({
      readdirSync: vi.fn((root: string) => {
        if (root === chromeRoot) {
          return [];
        }
        if (root === chromiumRoot) {
          return [createDirent("Profile 2")];
        }
        throw new Error(`unexpected root ${root}`);
      }),
      existsSync: vi.fn((filePath: string) => allowed.has(filePath)),
      readFileSync: vi.fn((filePath: string) => {
        if (filePath === join(chromiumRoot, "Local State")) {
          return JSON.stringify({ profile: { last_used: "Profile 2" } });
        }
        throw new Error(`unexpected file ${filePath}`);
      })
    });

    expect(discoverSystemChromeProfileSource()).toEqual({
      browserName: "chromium",
      userDataDir: chromiumRoot,
      profileDirectory: "Profile 2",
      profilePath: profile2
    });
  });

  it("falls back to Default when Local State is invalid or last_used is unavailable", async () => {
    setPlatform("darwin");
    process.env.HOME = "/Users/tester";

    const chromeRoot = "/Users/tester/Library/Application Support/Google/Chrome";
    const defaultProfile = join(chromeRoot, "Default");
    const allowed = new Set([join(defaultProfile, "Preferences")]);
    const { discoverSystemChromeProfileSource } = await loadModule({
      readdirSync: vi.fn((root: string) => {
        if (root === chromeRoot) {
          return [createDirent("Default"), createDirent("Profile 5")];
        }
        return [];
      }),
      existsSync: vi.fn((filePath: string) => allowed.has(filePath)),
      readFileSync: vi.fn((filePath: string) => {
        if (filePath === join(chromeRoot, "Local State")) {
          return "{invalid-json";
        }
        throw new Error(`unexpected file ${filePath}`);
      })
    });

    expect(discoverSystemChromeProfileSource()).toEqual({
      browserName: "chrome",
      userDataDir: chromeRoot,
      profileDirectory: "Default",
      profilePath: defaultProfile
    });
  });

  it("falls back to Default when Local State last_used is not a string", async () => {
    setPlatform("darwin");
    process.env.HOME = "/Users/tester";

    const chromeRoot = "/Users/tester/Library/Application Support/Google/Chrome";
    const defaultProfile = join(chromeRoot, "Default");
    const allowed = new Set([join(defaultProfile, "Preferences")]);
    const { discoverSystemChromeProfileSource } = await loadModule({
      readdirSync: vi.fn((root: string) => {
        if (root === chromeRoot) {
          return [createDirent("Default"), createDirent("Profile 5")];
        }
        return [];
      }),
      existsSync: vi.fn((filePath: string) => allowed.has(filePath)),
      readFileSync: vi.fn((filePath: string) => {
        if (filePath === join(chromeRoot, "Local State")) {
          return JSON.stringify({ profile: { last_used: 42 } });
        }
        throw new Error(`unexpected file ${filePath}`);
      })
    });

    expect(discoverSystemChromeProfileSource()).toEqual({
      browserName: "chrome",
      userDataDir: chromeRoot,
      profileDirectory: "Default",
      profilePath: defaultProfile
    });
  });

  it("falls back to the first available non-Default profile when needed", async () => {
    setPlatform("linux");
    process.env.HOME = "/home/tester";

    const chromeRoot = "/home/tester/.config/google-chrome";
    const firstProfile = join(chromeRoot, "Profile 7");
    const allowed = new Set([join(firstProfile, "Secure Preferences")]);
    const { discoverSystemChromeProfileSource } = await loadModule({
      readdirSync: vi.fn((root: string) => {
        if (root === chromeRoot) {
          return [createDirent("Profile 7")];
        }
        return [];
      }),
      existsSync: vi.fn((filePath: string) => allowed.has(filePath)),
      readFileSync: vi.fn((filePath: string) => {
        if (filePath === join(chromeRoot, "Local State")) {
          return JSON.stringify({ profile: { last_used: "Profile 9" } });
        }
        throw new Error(`unexpected file ${filePath}`);
      })
    });

    expect(discoverSystemChromeProfileSource()).toEqual({
      browserName: "chrome",
      userDataDir: chromeRoot,
      profileDirectory: "Profile 7",
      profilePath: firstProfile
    });
  });
});
