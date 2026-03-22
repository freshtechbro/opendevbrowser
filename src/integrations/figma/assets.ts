import { mkdir, writeFile } from "fs/promises";
import type { CanvasAsset, CanvasImportAssetReceipt } from "../../canvas/types";
import { resolveCanvasFigmaAssetDir, resolveCanvasFigmaAssetPath } from "../../canvas/repo-store";
import type { FigmaClient } from "./client";
import { isFigmaClientError } from "./client";
import type { NormalizedFigmaNode } from "./normalize";

type FigmaAssetRequest = {
  nodeId: string;
  format: "png" | "svg";
  sourceType: "image-fill" | "vector";
};

export async function materializeFigmaAssets(options: {
  worktree: string;
  fileKey: string;
  nodes: NormalizedFigmaNode[];
  client: FigmaClient;
}): Promise<{ assets: CanvasAsset[]; assetReceipts: CanvasImportAssetReceipt[] }> {
  const requests = collectAssetRequests(options.nodes);
  if (requests.length === 0) {
    return { assets: [], assetReceipts: [] };
  }
  await mkdir(resolveCanvasFigmaAssetDir(options.worktree, options.fileKey), { recursive: true });
  const assets: CanvasAsset[] = [];
  const assetReceipts: CanvasImportAssetReceipt[] = [];
  for (const format of ["png", "svg"] as const) {
    const formatRequests = requests.filter((request) => request.format === format);
    if (formatRequests.length === 0) {
      continue;
    }
    let urls: Record<string, string>;
    try {
      urls = await options.client.getImages(options.fileKey, formatRequests.map((request) => request.nodeId), format);
    } catch (error) {
      for (const request of formatRequests) {
        assetReceipts.push({
          assetId: buildAssetId(options.fileKey, request.nodeId, format),
          sourceType: request.sourceType,
          status: "asset_fetch_failed",
          metadata: {
            nodeId: request.nodeId,
            format,
            reason: isFigmaClientError(error) ? error.code : "asset_fetch_failed"
          }
        });
      }
      continue;
    }
    for (const request of formatRequests) {
      const assetId = buildAssetId(options.fileKey, request.nodeId, format);
      const url = urls[request.nodeId] ?? null;
      if (!url) {
        assetReceipts.push({
          assetId,
          sourceType: request.sourceType,
          status: "asset_fetch_failed",
          metadata: {
            nodeId: request.nodeId,
            format,
            reason: "missing_image_url"
          }
        });
        continue;
      }
      const repoPath = resolveCanvasFigmaAssetPath(options.worktree, options.fileKey, assetId, format);
      try {
        const download = await options.client.downloadAsset(url);
        await writeFile(repoPath, download.buffer);
        assets.push({
          id: assetId,
          sourceType: "remote",
          kind: format === "svg" ? "vector" : "image",
          repoPath,
          url,
          mime: download.contentType ?? (format === "svg" ? "image/svg+xml" : "image/png"),
          status: "cached",
          metadata: {
            fileKey: options.fileKey,
            nodeId: request.nodeId,
            format,
            sourceType: request.sourceType
          }
        });
        assetReceipts.push({
          assetId,
          sourceType: request.sourceType,
          repoPath,
          url,
          status: "cached",
          metadata: {
            nodeId: request.nodeId,
            format
          }
        });
      } catch (error) {
        assetReceipts.push({
          assetId,
          sourceType: request.sourceType,
          repoPath,
          url,
          status: "asset_fetch_failed",
          metadata: {
            nodeId: request.nodeId,
            format,
            reason: isFigmaClientError(error) ? error.code : "asset_fetch_failed"
          }
        });
      }
    }
  }
  return { assets, assetReceipts };
}

function collectAssetRequests(nodes: NormalizedFigmaNode[]): FigmaAssetRequest[] {
  const requests: FigmaAssetRequest[] = [];
  for (const node of traverseNodes(nodes)) {
    if (node.fills.some((fill) => fill.type === "IMAGE")) {
      requests.push({
        nodeId: node.id,
        format: "png",
        sourceType: "image-fill"
      });
    }
    if (node.vectorPaths.length > 0 || VECTOR_NODE_TYPES.has(node.type)) {
      requests.push({
        nodeId: node.id,
        format: "svg",
        sourceType: "vector"
      });
    }
  }
  return dedupeRequests(requests);
}

function* traverseNodes(nodes: NormalizedFigmaNode[]): Generator<NormalizedFigmaNode> {
  for (const node of nodes) {
    yield node;
    yield* traverseNodes(node.children);
  }
}

function dedupeRequests(requests: FigmaAssetRequest[]): FigmaAssetRequest[] {
  const seen = new Set<string>();
  return requests.filter((request) => {
    const key = `${request.nodeId}:${request.format}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function buildAssetId(fileKey: string, nodeId: string, format: "png" | "svg"): string {
  return `figma-${fileKey}-${nodeId}-${format}`.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

const VECTOR_NODE_TYPES = new Set([
  "VECTOR",
  "LINE",
  "ELLIPSE",
  "REGULAR_POLYGON",
  "RECTANGLE",
  "STAR",
  "BOOLEAN_OPERATION"
]);
