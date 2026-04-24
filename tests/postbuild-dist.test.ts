import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { getCurrentDaemonFingerprint } from "../src/cli/daemon";
import { postbuildDist } from "../scripts/postbuild-dist.mjs";

describe("postbuild-dist", () => {
  const tempDirs = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes one shared daemon fingerprint for both built entrypoints", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "odb-postbuild-dist-"));
    const distRoot = path.join(repoRoot, "dist");
    tempDirs.push(repoRoot);

    mkdirSync(path.join(distRoot, "cli"), { recursive: true });
    writeFileSync(path.join(distRoot, "index.js"), "export const tool = 'bundle';\n", "utf8");
    writeFileSync(path.join(distRoot, "cli", "index.js"), "export const cli = 'bundle';\n", "utf8");
    writeFileSync(path.join(distRoot, "chunk-shared.js"), "export const shared = 'one';\n", "utf8");
    writeFileSync(path.join(distRoot, "index.d.ts"), "export {};\n", "utf8");
    writeFileSync(path.join(distRoot, "index.d.ts.map"), "{}\n", "utf8");

    const fingerprint = postbuildDist(distRoot);
    const artifact = JSON.parse(readFileSync(path.join(distRoot, "daemon-fingerprint.json"), "utf8"));

    expect(fingerprint).toBe(artifact.fingerprint);
    expect(typeof artifact.fingerprint).toBe("string");
    expect(artifact.fingerprint.length).toBeGreaterThan(0);
    expect(getCurrentDaemonFingerprint({
      moduleUrl: pathToFileURL(path.join(distRoot, "cli", "index.js")).href
    })).toBe(getCurrentDaemonFingerprint({
      moduleUrl: pathToFileURL(path.join(distRoot, "index.js")).href
    }));

    writeFileSync(path.join(distRoot, "chunk-shared.js"), "export const shared = 'two';\n", "utf8");
    const updatedFingerprint = postbuildDist(distRoot);

    expect(updatedFingerprint).not.toBe(fingerprint);
  });
});
