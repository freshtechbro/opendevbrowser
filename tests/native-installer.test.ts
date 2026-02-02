import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";

const extensionId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const getManifestDir = (homeDir: string): string => {
  if (process.platform === "darwin") {
    return path.join(homeDir, "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts");
  }
  if (process.platform === "linux") {
    return path.join(homeDir, ".config", "google-chrome", "NativeMessagingHosts");
  }
  if (process.platform === "win32") {
    return path.join(homeDir, "Google", "Chrome", "User Data", "NativeMessagingHosts");
  }
  throw new Error("Unsupported platform");
};

describe("native installer scripts", () => {
  it("installs and uninstalls native host manifest", () => {
    if (process.platform !== "darwin" && process.platform !== "linux" && process.platform !== "win32") {
      return;
    }

    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "odb-native-home-"));
    const env = { ...process.env };
    if (process.platform === "win32") {
      env.LOCALAPPDATA = tempHome;
    } else {
      env.HOME = tempHome;
    }
    const manifestDir = getManifestDir(tempHome);
    const manifestPath = path.join(manifestDir, "com.opendevbrowser.native.json");

    if (process.platform === "win32") {
      execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/native/install.ps1", extensionId], { env });
    } else {
      execFileSync("bash", ["scripts/native/install.sh", extensionId], { env });
    }
    expect(fs.existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { allowed_origins?: string[] };
    expect(manifest.allowed_origins?.[0]).toBe(`chrome-extension://${extensionId}/`);

    if (process.platform === "win32") {
      execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/native/uninstall.ps1"], { env });
    } else {
      execFileSync("bash", ["scripts/native/uninstall.sh"], { env });
    }
    expect(fs.existsSync(manifestPath)).toBe(false);
  });
});
