#!/usr/bin/env node

import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SYNC_PATHS = [
  "docs",
  "skills",
  "assets",
  "CHANGELOG.md",
  "src/tools/index.ts"
];

const GENERATED_JSON_FILES = [
  "frontend/src/content/docs-generated/pages.json",
  "frontend/src/content/docs-manifest.json",
  "frontend/src/content/metrics.json",
  "frontend/src/content/roadmap.json"
];

const PRESERVE_PATHS = [
  "docs/DEPLOYMENT_RUNBOOK.md",
  "docs/HOSTING_CONFIGURATION.md",
  "docs/CUTOVER_CHECKLIST.md"
];

const PRIVATE_REPO_SENTINELS = [
  ".github/workflows/sync-from-public.yml",
  ".github/workflows/promote-website-production.yml",
  "frontend/package.json"
];

function parseArgs(argv) {
  const options = {
    publicRepo: process.env.PUBLIC_REPO_URL ?? "https://github.com/freshtechbro/opendevbrowser.git",
    publicRef: process.env.PUBLIC_REF ?? "main",
    publicSha: process.env.PUBLIC_SHA ?? "",
    retain: Number(process.env.UPSTREAM_RETENTION ?? "20"),
    normalizeGenerated: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--public-repo") {
      options.publicRepo = readArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--public-ref") {
      options.publicRef = readArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--public-sha") {
      options.publicSha = readArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--retain") {
      options.retain = Number(readArgValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--normalize-generated") {
      options.normalizeGenerated = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(options.retain) || options.retain < 1) {
    throw new Error("--retain must be a positive integer");
  }

  return options;
}

function readArgValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value === undefined) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function printUsage() {
  console.log(`Usage: node scripts/sync-from-public.mjs [options]\n\nOptions:\n  --public-repo <url>       Source public repository URL\n  --public-ref <ref>        Source ref (default: main)\n  --public-sha <sha>        Optional upstream SHA for traceability\n  --retain <count>          Number of upstream snapshots to keep (default: 20)\n  --normalize-generated     Normalize generatedAt fields for deterministic diffs\n  --help                    Show this help`);
}

async function run(command, args, cwd) {
  try {
    const { stdout } = await execFileAsync(command, args, {
      cwd,
      env: process.env,
      maxBuffer: 10 * 1024 * 1024
    });
    return stdout.trim();
  } catch (error) {
    const stderr = error?.stderr ? `\n${String(error.stderr).trim()}` : "";
    throw new Error(`Command failed: ${command} ${args.join(" ")}${stderr}`);
  }
}

async function pathExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function ensurePrivateRepoContext(repoRoot) {
  const missing = [];

  for (const relativePath of PRIVATE_REPO_SENTINELS) {
    const absolutePath = path.join(repoRoot, relativePath);
    if (!(await pathExists(absolutePath))) {
      missing.push(relativePath);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `sync-from-public.mjs must run from private website repo root; missing: ${missing.join(", ")}`
    );
  }
}

async function copyPath(sourcePath, destinationPath) {
  const sourceStats = await stat(sourcePath);
  await mkdir(path.dirname(destinationPath), { recursive: true });

  if (sourceStats.isDirectory()) {
    await rm(destinationPath, { recursive: true, force: true });
    await cp(sourcePath, destinationPath, { recursive: true });
    return;
  }

  await rm(destinationPath, { force: true });
  await cp(sourcePath, destinationPath);
}

async function backupPreservedPaths(repoRoot, preserveRoot) {
  const backedUp = [];

  for (const relativePath of PRESERVE_PATHS) {
    const sourcePath = path.join(repoRoot, relativePath);
    if (!(await pathExists(sourcePath))) {
      continue;
    }

    const backupPath = path.join(preserveRoot, relativePath);
    await mkdir(path.dirname(backupPath), { recursive: true });
    await cp(sourcePath, backupPath);
    backedUp.push(relativePath);
  }

  return backedUp;
}

async function restorePreservedPaths(repoRoot, preserveRoot, preservedPaths) {
  for (const relativePath of preservedPaths) {
    const backupPath = path.join(preserveRoot, relativePath);
    if (!(await pathExists(backupPath))) {
      continue;
    }

    const destinationPath = path.join(repoRoot, relativePath);
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await cp(backupPath, destinationPath);
  }
}

async function clonePublicRepo({ tempDir, publicRepo, publicRef }) {
  const isSha = /^[a-f0-9]{7,40}$/iu.test(publicRef);

  if (isSha) {
    await run("git", ["clone", "--depth", "1", "--filter=blob:none", "--sparse", publicRepo, tempDir], process.cwd());
    await run("git", ["-C", tempDir, "fetch", "--depth", "1", "origin", publicRef], process.cwd());
    await run("git", ["-C", tempDir, "checkout", "FETCH_HEAD"], process.cwd());
  } else {
    await run(
      "git",
      ["clone", "--depth", "1", "--filter=blob:none", "--sparse", "--branch", publicRef, publicRepo, tempDir],
      process.cwd()
    );
  }

  await run("git", ["-C", tempDir, "sparse-checkout", "init", "--no-cone"], process.cwd());
  await run("git", ["-C", tempDir, "sparse-checkout", "set", ...SYNC_PATHS], process.cwd());
}

async function normalizeGeneratedFiles(repoRoot, publicSha) {
  const normalizedTimestamp = `upstream:${publicSha || "unknown"}`;
  let normalizedCount = 0;

  for (const relativePath of GENERATED_JSON_FILES) {
    const absolutePath = path.join(repoRoot, relativePath);
    if (!(await pathExists(absolutePath))) {
      continue;
    }

    const content = await readFile(absolutePath, "utf8");
    const payload = JSON.parse(content);

    if (payload.generatedAt === normalizedTimestamp) {
      continue;
    }

    payload.generatedAt = normalizedTimestamp;
    await writeFile(absolutePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    normalizedCount += 1;
  }

  console.log(`Normalized generatedAt for ${normalizedCount} file(s).`);
}

async function pruneSnapshots(repoRoot, retainCount) {
  const upstreamRoot = path.join(repoRoot, "upstream");
  if (!(await pathExists(upstreamRoot))) {
    return;
  }

  const entries = await readdir(upstreamRoot, { withFileTypes: true });
  const snapshots = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const fullPath = path.join(upstreamRoot, entry.name);
    const info = await stat(fullPath);
    snapshots.push({ fullPath, modifiedMs: info.mtimeMs });
  }

  snapshots.sort((a, b) => b.modifiedMs - a.modifiedMs);
  const stale = snapshots.slice(retainCount);

  for (const snapshot of stale) {
    await rm(snapshot.fullPath, { recursive: true, force: true });
  }

  if (stale.length > 0) {
    console.log(`Pruned ${stale.length} stale upstream snapshot(s).`);
  }
}

async function syncInputs(options) {
  const repoRoot = process.cwd();
  const cloneDir = await mkdtemp(path.join(os.tmpdir(), "opendevbrowser-public-sync-"));
  const preserveDir = await mkdtemp(path.join(os.tmpdir(), "opendevbrowser-private-preserve-"));

  try {
    const preservedPaths = await backupPreservedPaths(repoRoot, preserveDir);
    await clonePublicRepo({ tempDir: cloneDir, publicRepo: options.publicRepo, publicRef: options.publicRef });

    const resolvedSha = options.publicSha || await run("git", ["-C", cloneDir, "rev-parse", "HEAD"], process.cwd());
    const snapshotRoot = path.join(repoRoot, "upstream", resolvedSha);

    for (const relativePath of SYNC_PATHS) {
      const sourcePath = path.join(cloneDir, relativePath);
      if (!(await pathExists(sourcePath))) {
        throw new Error(`Missing required upstream path: ${relativePath}`);
      }

      await copyPath(sourcePath, path.join(snapshotRoot, relativePath));
      await copyPath(sourcePath, path.join(repoRoot, relativePath));
    }

    await restorePreservedPaths(repoRoot, preserveDir, preservedPaths);
    await pruneSnapshots(repoRoot, options.retain);
    console.log(`Synced upstream content from ${options.publicRepo}@${options.publicRef} (${resolvedSha}).`);
    if (preservedPaths.length > 0) {
      console.log(`Restored private files: ${preservedPaths.join(", ")}`);
    }
    return resolvedSha;
  } finally {
    await rm(cloneDir, { recursive: true, force: true });
    await rm(preserveDir, { recursive: true, force: true });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();
  await ensurePrivateRepoContext(repoRoot);

  if (options.normalizeGenerated) {
    await normalizeGeneratedFiles(repoRoot, options.publicSha);
    return;
  }

  const resolvedSha = await syncInputs(options);
  await normalizeGeneratedFiles(repoRoot, resolvedSha);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
