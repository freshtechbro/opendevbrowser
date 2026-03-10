import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { createDefaultCanvasDocument } from "../src/canvas/document-store";
import { loadCanvasDocument, resolveCanvasRepoPath, saveCanvasDocument } from "../src/canvas/repo-store";

describe("canvas repo store", () => {
  let worktree = "";

  beforeEach(async () => {
    worktree = await mkdtemp(join(tmpdir(), "odb-canvas-repo-"));
  });

  afterEach(async () => {
    await rm(worktree, { recursive: true, force: true });
  });

  it("resolves default, relative, and absolute paths and round-trips documents", async () => {
    const document = createDefaultCanvasDocument("dc_repo_store");
    const defaultPath = resolveCanvasRepoPath(worktree, document.documentId);
    const relativePath = resolveCanvasRepoPath(worktree, document.documentId, "custom/document.canvas.json");
    const absolutePath = resolveCanvasRepoPath(worktree, document.documentId, join(worktree, "absolute.canvas.json"));

    expect(defaultPath).toBe(resolve(worktree, ".opendevbrowser", "canvas", "dc_repo_store.canvas.json"));
    expect(relativePath).toBe(resolve(worktree, "custom/document.canvas.json"));
    expect(absolutePath).toBe(join(worktree, "absolute.canvas.json"));

    const savedRelative = await saveCanvasDocument(worktree, document, "custom/document.canvas.json");
    const relativeRaw = await readFile(savedRelative, "utf-8");
    expect(relativeRaw.endsWith("\n")).toBe(true);
    await expect(loadCanvasDocument(worktree, "custom/document.canvas.json")).resolves.toMatchObject({
      documentId: "dc_repo_store"
    });

    const savedAbsolute = await saveCanvasDocument(worktree, document, absolutePath);
    await expect(loadCanvasDocument(worktree, savedAbsolute)).resolves.toMatchObject({
      documentId: "dc_repo_store"
    });
  });
});
