import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { createDefaultCanvasDocument } from "../src/canvas/document-store";
import type { CodeSyncManifest } from "../src/canvas/code-sync/types";
import {
  loadCanvasCodeSyncManifest,
  loadCanvasDocument,
  resolveCanvasFigmaAssetPath,
  resolveCanvasCodeSyncManifestPath,
  resolveCanvasRepoPath,
  saveCanvasCodeSyncManifest,
  saveCanvasDocument
} from "../src/canvas/repo-store";

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
    const figmaSvgPath = resolveCanvasFigmaAssetPath(worktree, "figma-file", "asset-one", "svg");
    const figmaPngPath = resolveCanvasFigmaAssetPath(worktree, "figma-file", "asset-two", ".png");

    expect(defaultPath).toBe(resolve(worktree, ".opendevbrowser", "canvas", "dc_repo_store.canvas.json"));
    expect(relativePath).toBe(resolve(worktree, "custom/document.canvas.json"));
    expect(absolutePath).toBe(join(worktree, "absolute.canvas.json"));
    expect(figmaSvgPath).toBe(resolve(worktree, ".opendevbrowser", "canvas", "assets", "figma", "figma-file", "asset-one.svg"));
    expect(figmaPngPath).toBe(resolve(worktree, ".opendevbrowser", "canvas", "assets", "figma", "figma-file", "asset-two.png"));

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

  it("resolves default, relative, and absolute code-sync manifest paths and round-trips manifests", async () => {
    const manifest: CodeSyncManifest = {
      bindingId: "binding_hero",
      documentId: "dc_repo_store",
      repoPath: "src/components/Hero.tsx",
      adapter: "tsx-react-v1",
      rootLocator: { exportName: "Hero" },
      sourceHash: "sha256-hero",
      documentRevision: 7,
      nodeMappings: [],
      lastImportedAt: "2026-03-12T00:00:00.000Z"
    };

    const defaultPath = resolveCanvasCodeSyncManifestPath(worktree, manifest.documentId, manifest.bindingId);
    const relativePath = resolveCanvasCodeSyncManifestPath(worktree, manifest.documentId, manifest.bindingId, "custom/code-sync/hero.json");
    const absolutePath = resolveCanvasCodeSyncManifestPath(worktree, manifest.documentId, manifest.bindingId, join(worktree, "absolute-hero.json"));

    expect(defaultPath).toBe(resolve(worktree, ".opendevbrowser", "canvas", "code-sync", "dc_repo_store", "binding_hero.json"));
    expect(relativePath).toBe(resolve(worktree, "custom/code-sync/hero.json"));
    expect(absolutePath).toBe(join(worktree, "absolute-hero.json"));

    const savedRelative = await saveCanvasCodeSyncManifest(worktree, manifest, "custom/code-sync/hero.json");
    const relativeRaw = await readFile(savedRelative, "utf-8");
    expect(relativeRaw.endsWith("\n")).toBe(true);
    await expect(loadCanvasCodeSyncManifest(worktree, manifest.documentId, manifest.bindingId, "custom/code-sync/hero.json")).resolves.toMatchObject({
      bindingId: "binding_hero",
      repoPath: "src/components/Hero.tsx",
      rootLocator: { exportName: "Hero" }
    });

    const savedAbsolute = await saveCanvasCodeSyncManifest(worktree, manifest, absolutePath);
    await expect(loadCanvasCodeSyncManifest(worktree, manifest.documentId, manifest.bindingId, savedAbsolute)).resolves.toMatchObject({
      bindingId: "binding_hero",
      sourceHash: "sha256-hero",
      documentRevision: 7
    });
  });
});
