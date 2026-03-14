import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { syncExtensionVersion } from "../scripts/sync-extension-version.mjs";

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

describe("sync-extension-version", () => {
  const tempDirs = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("syncs both extension manifest files to the root package version", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "odb-sync-version-"));
    tempDirs.push(repoRoot);

    mkdirSync(path.join(repoRoot, "extension"), { recursive: true });
    writeJson(path.join(repoRoot, "package.json"), { name: "opendevbrowser", version: "0.0.17" });
    writeJson(path.join(repoRoot, "extension", "manifest.json"), { version: "0.0.16" });
    writeJson(path.join(repoRoot, "extension", "package.json"), { name: "opendevbrowser-extension", version: "0.0.15" });

    const result = syncExtensionVersion(repoRoot);

    expect(result.version).toBe("0.0.17");
    expect(result.changedFiles).toEqual(["extension/manifest.json", "extension/package.json"]);

    const manifest = JSON.parse(readFileSync(path.join(repoRoot, "extension", "manifest.json"), "utf8"));
    const extensionPackage = JSON.parse(readFileSync(path.join(repoRoot, "extension", "package.json"), "utf8"));

    expect(manifest.version).toBe("0.0.17");
    expect(extensionPackage.version).toBe("0.0.17");
  });
});
