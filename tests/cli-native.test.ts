import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { ParsedArgs } from "../src/cli/args";
import { runNativeCommand, __test__ } from "../src/cli/commands/native";

const makeArgs = (rawArgs: string[]): ParsedArgs => ({
  command: "native",
  mode: undefined,
  withConfig: false,
  noPrompt: false,
  noInteractive: false,
  quiet: false,
  outputFormat: "text",
  transport: "relay",
  skillsMode: "global",
  fullInstall: false,
  rawArgs
});

describe("native CLI command", () => {
  it("resolves host script path within repository scripts/native directory", () => {
    const hostScriptPath = __test__.getHostScriptPath();
    const expectedSuffix = path.join("scripts", "native", "host.cjs");
    expect(hostScriptPath.endsWith(expectedSuffix)).toBe(true);
    const repoName = path.basename(process.cwd());
    expect(hostScriptPath).toContain(`${path.sep}${repoName}${path.sep}scripts${path.sep}native${path.sep}`);
  });

  it("rejects invalid extension ids", async () => {
    expect(() => __test__.parseNativeArgs(["install", "not-valid"]))
      .toThrow("Invalid extension ID format");
  });

  it("reports native status based on current host installation state", async () => {
    if (process.platform !== "darwin" && process.platform !== "linux" && process.platform !== "win32") {
      return;
    }
    const result = await runNativeCommand(makeArgs(["status"]));
    if (result.success) {
      expect(result.message).toContain("Native host installed");
    } else {
      expect(result.message).toMatch(/not installed|current extension|reinstall/i);
    }
  });

  it("includes profiles that only have Secure Preferences", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "odb-native-profiles-"));
    const profileDir = path.join(root, "Default");
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(path.join(profileDir, "Secure Preferences"), "{}", "utf8");

    const profiles = __test__.getProfileDirs(root);
    expect(profiles).toEqual([profileDir]);
  });

  it("reads extension entries from Secure Preferences for discovery", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "odb-native-secure-"));
    const profileDir = path.join(root, "Default");
    fs.mkdirSync(profileDir, { recursive: true });

    const extensionId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const extensionPath = path.join(root, "extension");
    const securePreferences = {
      extensions: {
        settings: {
          [extensionId]: {
            path: extensionPath,
            manifest: { name: "OpenDevBrowser Relay" }
          }
        }
      }
    };
    fs.writeFileSync(path.join(profileDir, "Secure Preferences"), JSON.stringify(securePreferences), "utf8");

    const records = __test__.readProfilePreferences(profileDir);
    const match = records
      .map((record) => __test__.findExtensionIdInPreferences(record, extensionPath))
      .find((value) => value !== null);

    expect(match).toEqual({ id: extensionId, matchedBy: "path" });
  });

  it("extracts extension id from command maps when settings do not include manifest data", () => {
    const extensionId = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const preferences = {
      extensions: {
        commands: {
          "mac:Command+Shift+P": {
            command_name: "toggle-annotation",
            extension: extensionId
          }
        }
      }
    };

    expect(__test__.findExtensionIdInCommands(preferences)).toBe(extensionId);
  });

  it("prefers configured native extension id over discovered profile id", () => {
    const oldConfigDir = process.env.OPENCODE_CONFIG_DIR;
    const oldHome = process.env.HOME;
    const oldLocalAppData = process.env.LOCALAPPDATA;
    const oldUserProfile = process.env.USERPROFILE;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "odb-native-expected-"));
    const configDir = path.join(root, "config");
    const home = path.join(root, "home");
    const configuredId = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const discoveredId = "cccccccccccccccccccccccccccccccc";
    try {
      process.env.OPENCODE_CONFIG_DIR = configDir;
      process.env.HOME = home;
      const localAppData = path.join(home, "AppData", "Local");
      process.env.LOCALAPPDATA = localAppData;
      process.env.USERPROFILE = home;
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, "opendevbrowser.jsonc"),
        JSON.stringify({ nativeExtensionId: configuredId }),
        "utf8"
      );

      let chromeRoot = path.join(home, ".config", "google-chrome");
      if (process.platform === "darwin") {
        chromeRoot = path.join(home, "Library", "Application Support", "Google", "Chrome");
      } else if (process.platform === "win32") {
        chromeRoot = path.join(localAppData, "Google", "Chrome", "User Data");
      }
      const profileDir = path.join(chromeRoot, "Default");
      fs.mkdirSync(profileDir, { recursive: true });
      fs.writeFileSync(
        path.join(profileDir, "Preferences"),
        JSON.stringify({
          extensions: {
            settings: {
              [discoveredId]: {
                path: path.join(process.cwd(), "extension"),
                manifest: { name: "OpenDevBrowser Relay" }
              }
            }
          }
        }),
        "utf8"
      );

      expect(__test__.resolveExpectedExtension()).toMatchObject({
        discoveredExtensionId: discoveredId,
        discoveredMatchedBy: "path",
        expectedExtensionId: configuredId,
        expectedExtensionSource: "config"
      });
    } finally {
      if (oldConfigDir === undefined) delete process.env.OPENCODE_CONFIG_DIR;
      else process.env.OPENCODE_CONFIG_DIR = oldConfigDir;
      if (oldHome === undefined) delete process.env.HOME;
      else process.env.HOME = oldHome;
      if (oldLocalAppData === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = oldLocalAppData;
      if (oldUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = oldUserProfile;
    }
  });

  it("keeps native scripts in npm package files list", () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
      files?: string[];
    };
    expect(Array.isArray(packageJson.files)).toBe(true);
    expect(packageJson.files).toContain("scripts/native");
  });
});
