import { mkdir, readFile } from "fs/promises";
import { join, dirname, isAbsolute, resolve } from "path";
import { writeFileAtomic } from "../utils/fs";
import type { CanvasDocument } from "./types";

function stableStringify(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  /* v8 ignore next -- persisted CanvasDocument data is JSON-shaped and should not contain non-object fallbacks here */
  if (!value || typeof value !== "object") {
    return JSON.stringify(value);
  }
  const entries = Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(",")}}`;
}

export function resolveCanvasRepoPath(worktree: string, documentId: string, repoPath?: string | null): string {
  if (repoPath && repoPath.trim()) {
    return isAbsolute(repoPath) ? repoPath : resolve(worktree, repoPath);
  }
  return join(worktree, ".opendevbrowser", "canvas", `${documentId}.canvas.json`);
}

export async function saveCanvasDocument(worktree: string, document: CanvasDocument, repoPath?: string | null): Promise<string> {
  const resolvedPath = resolveCanvasRepoPath(worktree, document.documentId, repoPath);
  await mkdir(dirname(resolvedPath), { recursive: true });
  writeFileAtomic(resolvedPath, `${stableStringify(document)}\n`, { encoding: "utf-8" });
  return resolvedPath;
}

export async function loadCanvasDocument(worktree: string, repoPath: string): Promise<CanvasDocument> {
  const resolvedPath = isAbsolute(repoPath) ? repoPath : resolve(worktree, repoPath);
  const raw = await readFile(resolvedPath, "utf-8");
  const parsed = JSON.parse(raw) as CanvasDocument;
  return parsed;
}
