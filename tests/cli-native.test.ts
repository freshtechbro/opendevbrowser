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
      expect(result.message).toContain("not installed");
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
});
