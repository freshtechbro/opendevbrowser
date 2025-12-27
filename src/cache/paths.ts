import { createHash } from "crypto";
import { mkdir, stat } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

export type CachePaths = {
  root: string;
  projectRoot: string;
  profileDir: string;
  chromeDir: string;
};

function safeHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function resolveCachePaths(worktree: string, profile: string): Promise<CachePaths> {
  const base = process.env.OPENCODE_CACHE_DIR
    ?? process.env.XDG_CACHE_HOME
    ?? join(homedir(), ".cache");
  const root = join(base, "opendevbrowser");
  const projectRoot = join(root, "projects", safeHash(worktree));
  const profileDir = join(projectRoot, "profiles", profile);
  const chromeDir = join(root, "chrome");

  await ensureDir(root);
  await ensureDir(projectRoot);
  await ensureDir(profileDir);
  await ensureDir(chromeDir);

  return { root, projectRoot, profileDir, chromeDir };
}

export async function ensureFileAbsent(path: string): Promise<void> {
  if (await exists(path)) {
    throw new Error(`Path already exists: ${path}`);
  }
}
