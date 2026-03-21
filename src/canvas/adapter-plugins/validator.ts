import { realpath } from "fs/promises";
import { resolve } from "path";
import type { CanvasAdapterPluginManifest } from "./types";

const REMOTE_SPECIFIER_RE = /^(?:https?:|npm:|git\+|github:)/i;

export function isRemotePluginSpecifier(ref: string): boolean {
  return REMOTE_SPECIFIER_RE.test(ref);
}

export async function validatePluginTrust(params: {
  ref: string;
  packageRoot: string;
  manifest: CanvasAdapterPluginManifest;
  worktree: string;
  source: "package" | "repo" | "config";
}): Promise<void> {
  if (isRemotePluginSpecifier(params.ref)) {
    throw new Error("trust_denied");
  }
  const packageRootRealpath = await realpath(params.packageRoot);
  const worktreeRealpath = await realpath(params.worktree);
  const allowedRoots = new Set<string>([
    worktreeRealpath,
    resolve(worktreeRealpath, "node_modules"),
    ...(params.source === "config" ? [packageRootRealpath] : [])
  ]);
  if (![...allowedRoots].some((root) => packageRootRealpath === root || packageRootRealpath.startsWith(`${root}/`))) {
    throw new Error("trust_denied");
  }
}
