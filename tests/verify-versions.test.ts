import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyVersionAlignment } from "../scripts/verify-versions.mjs";

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

describe("verify-versions", () => {
  const tempDirs = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("accepts aligned root, extension, and lockfile versions", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "odb-verify-version-"));
    tempDirs.push(repoRoot);

    mkdirSync(path.join(repoRoot, "extension"), { recursive: true });
    writeJson(path.join(repoRoot, "package.json"), { name: "opendevbrowser", version: "0.0.26" });
    writeJson(path.join(repoRoot, "extension", "manifest.json"), { version: "0.0.26" });
    writeJson(path.join(repoRoot, "extension", "package.json"), { name: "opendevbrowser-extension", version: "0.0.26" });
    writeJson(path.join(repoRoot, "package-lock.json"), {
      name: "opendevbrowser",
      version: "0.0.26",
      lockfileVersion: 3,
      packages: {
        "": {
          name: "opendevbrowser",
          version: "0.0.26"
        }
      }
    });

    expect(verifyVersionAlignment(repoRoot)).toBe("0.0.26");
  });

  it("rejects lockfile drift", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "odb-verify-version-"));
    tempDirs.push(repoRoot);

    mkdirSync(path.join(repoRoot, "extension"), { recursive: true });
    writeJson(path.join(repoRoot, "package.json"), { name: "opendevbrowser", version: "0.0.26" });
    writeJson(path.join(repoRoot, "extension", "manifest.json"), { version: "0.0.26" });
    writeJson(path.join(repoRoot, "extension", "package.json"), { name: "opendevbrowser-extension", version: "0.0.26" });
    writeJson(path.join(repoRoot, "package-lock.json"), {
      name: "opendevbrowser",
      version: "0.0.25",
      lockfileVersion: 3,
      packages: {
        "": {
          name: "opendevbrowser",
          version: "0.0.25"
        }
      }
    });

    expect(() => verifyVersionAlignment(repoRoot)).toThrow(
      "Version mismatch: package.json=0.0.26 package-lock.json=0.0.25"
    );
  });

  it("rejects root lockfile package drift when the top-level lockfile version matches", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "odb-verify-version-"));
    tempDirs.push(repoRoot);

    mkdirSync(path.join(repoRoot, "extension"), { recursive: true });
    writeJson(path.join(repoRoot, "package.json"), { name: "opendevbrowser", version: "0.0.26" });
    writeJson(path.join(repoRoot, "extension", "manifest.json"), { version: "0.0.26" });
    writeJson(path.join(repoRoot, "extension", "package.json"), { name: "opendevbrowser-extension", version: "0.0.26" });
    writeJson(path.join(repoRoot, "package-lock.json"), {
      name: "opendevbrowser",
      version: "0.0.26",
      lockfileVersion: 3,
      packages: {
        "": {
          name: "opendevbrowser",
          version: "0.0.25"
        }
      }
    });

    expect(() => verifyVersionAlignment(repoRoot)).toThrow(
      "Version mismatch: package.json=0.0.26 package-lock.json#packages[\"\"]=0.0.25"
    );
  });

  it("rejects a missing root lockfile package version", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "odb-verify-version-"));
    tempDirs.push(repoRoot);

    mkdirSync(path.join(repoRoot, "extension"), { recursive: true });
    writeJson(path.join(repoRoot, "package.json"), { name: "opendevbrowser", version: "0.0.26" });
    writeJson(path.join(repoRoot, "extension", "manifest.json"), { version: "0.0.26" });
    writeJson(path.join(repoRoot, "extension", "package.json"), { name: "opendevbrowser-extension", version: "0.0.26" });
    writeJson(path.join(repoRoot, "package-lock.json"), {
      name: "opendevbrowser",
      version: "0.0.26",
      lockfileVersion: 3,
      packages: {}
    });

    expect(() => verifyVersionAlignment(repoRoot)).toThrow(
      "package-lock.json root package version is missing."
    );
  });
});
