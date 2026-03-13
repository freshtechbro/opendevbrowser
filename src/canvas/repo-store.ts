import { access, mkdir, readFile } from "fs/promises";
import { join, dirname, isAbsolute, resolve } from "path";
import { writeFileAtomic } from "../utils/fs";
import type { CanvasDocument } from "./types";
import type { CodeSyncManifest } from "./code-sync/types";
import { parseCodeSyncManifest } from "./code-sync/manifest";

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => stableValue(entry));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, stableValue(entryValue)])
  );
}

export function resolveCanvasRepoPath(worktree: string, documentId: string, repoPath?: string | null): string {
  if (repoPath && repoPath.trim()) {
    return isAbsolute(repoPath) ? repoPath : resolve(worktree, repoPath);
  }
  return join(worktree, ".opendevbrowser", "canvas", `${documentId}.canvas.json`);
}

export function resolveCanvasCodeSyncManifestPath(
  worktree: string,
  documentId: string,
  bindingId: string,
  repoPath?: string | null
): string {
  if (repoPath && repoPath.trim()) {
    return isAbsolute(repoPath) ? repoPath : resolve(worktree, repoPath);
  }
  return join(worktree, ".opendevbrowser", "canvas", "code-sync", documentId, `${bindingId}.json`);
}

export async function saveCanvasDocument(worktree: string, document: CanvasDocument, repoPath?: string | null): Promise<string> {
  const resolvedPath = resolveCanvasRepoPath(worktree, document.documentId, repoPath);
  await mkdir(dirname(resolvedPath), { recursive: true });
  writeFileAtomic(resolvedPath, `${JSON.stringify(stableValue(document), null, 2)}\n`, { encoding: "utf-8" });
  return resolvedPath;
}

export async function loadCanvasDocument(worktree: string, repoPath: string): Promise<CanvasDocument> {
  const resolvedPath = isAbsolute(repoPath) ? repoPath : resolve(worktree, repoPath);
  const raw = await readFile(resolvedPath, "utf-8");
  const parsed = JSON.parse(raw) as CanvasDocument;
  return parsed;
}

export async function loadCanvasDocumentById(worktree: string, documentId: string): Promise<CanvasDocument | null> {
  const resolvedPath = resolveCanvasRepoPath(worktree, documentId);
  try {
    await access(resolvedPath);
  } catch {
    return null;
  }
  return await loadCanvasDocument(worktree, resolvedPath);
}

export async function saveCanvasCodeSyncManifest(
  worktree: string,
  manifest: CodeSyncManifest,
  repoPath?: string | null
): Promise<string> {
  const resolvedPath = resolveCanvasCodeSyncManifestPath(worktree, manifest.documentId, manifest.bindingId, repoPath);
  await mkdir(dirname(resolvedPath), { recursive: true });
  writeFileAtomic(resolvedPath, `${JSON.stringify(stableValue(manifest), null, 2)}\n`, { encoding: "utf-8" });
  return resolvedPath;
}

export async function loadCanvasCodeSyncManifest(
  worktree: string,
  documentId: string,
  bindingId: string,
  repoPath?: string | null
): Promise<CodeSyncManifest | null> {
  const resolvedPath = resolveCanvasCodeSyncManifestPath(worktree, documentId, bindingId, repoPath);
  try {
    const raw = await readFile(resolvedPath, "utf-8");
    return parseCodeSyncManifest(JSON.parse(raw));
  } catch {
    return null;
  }
}
