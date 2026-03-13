import { mkdir } from "fs/promises";
import { dirname } from "path";
import { writeFileAtomic } from "../../utils/fs";
import type { CodeSyncManifest } from "./types";

export async function writeCodeSyncSource(repoPath: string, sourceText: string): Promise<void> {
  await mkdir(dirname(repoPath), { recursive: true });
  writeFileAtomic(repoPath, sourceText, { encoding: "utf-8" });
}

export function finalizeCodeSyncManifest(
  manifest: CodeSyncManifest,
  updates: {
    sourceHash: string;
    documentRevision: number;
    lastImportedAt?: string;
    lastPushedAt?: string;
  }
): CodeSyncManifest {
  return {
    ...manifest,
    sourceHash: updates.sourceHash,
    documentRevision: updates.documentRevision,
    lastImportedAt: updates.lastImportedAt ?? manifest.lastImportedAt,
    lastPushedAt: updates.lastPushedAt ?? manifest.lastPushedAt
  };
}
