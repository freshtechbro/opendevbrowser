#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import path from "node:path";

export const ZOMBIE_BASENAME_PATTERNS = [
  /\s2\.[^/]+$/i,
  /\s\([0-9]+\)\.[^/]+$/i,
  /\s-copy\.[^/]+$/i,
  /\scopy\.[^/]+$/i,
  /-copy\.[^/]+$/i,
  /_copy\.[^/]+$/i,
  /\.bak$/i,
  /\.orig$/i,
  /\.old$/i
];

export function isZombieDuplicatePath(filePath) {
  const basename = path.basename(String(filePath ?? "")).trim();
  if (!basename) return false;
  return ZOMBIE_BASENAME_PATTERNS.some((pattern) => pattern.test(basename));
}

export function auditZombiePaths(paths) {
  const flagged = [];
  for (const candidate of paths) {
    const normalized = String(candidate ?? "").trim();
    if (!normalized) continue;
    if (isZombieDuplicatePath(normalized)) {
      flagged.push(normalized);
    }
  }
  return flagged.sort((a, b) => a.localeCompare(b));
}

function listRepoFiles(cwd = process.cwd()) {
  const output = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd,
    encoding: "utf8"
  });

  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function main() {
  const files = listRepoFiles();
  const flagged = auditZombiePaths(files);

  const payload = {
    ok: flagged.length === 0,
    scanned: files.length,
    flagged
  };

  console.log(JSON.stringify(payload, null, 2));

  if (!payload.ok) {
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
