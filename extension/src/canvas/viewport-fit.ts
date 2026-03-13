import type { CanvasEditorViewport, CanvasNode } from "./model.js";

export const DEFAULT_EDITOR_VIEWPORT: CanvasEditorViewport = {
  x: 120,
  y: 96,
  zoom: 1
};

const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2.4;
const DEFAULT_STAGE_WIDTH = 960;
const DEFAULT_STAGE_HEIGHT = 640;
const FIT_PADDING = 48;

type NodeBounds = {
  minX: number;
  minY: number;
  width: number;
  height: number;
};

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), max);
};

const roundZoom = (value: number): number => {
  return Math.round(value * 100) / 100;
};

const resolveStageSize = (value: number | undefined, fallback: number): number => {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
};

export const isDefaultEditorViewport = (viewport: CanvasEditorViewport): boolean => {
  return viewport.x === DEFAULT_EDITOR_VIEWPORT.x
    && viewport.y === DEFAULT_EDITOR_VIEWPORT.y
    && viewport.zoom === DEFAULT_EDITOR_VIEWPORT.zoom;
};

export const computeViewportCanvasCenter = (
  viewport: CanvasEditorViewport,
  stageWidth?: number,
  stageHeight?: number
): { x: number; y: number } => {
  const safeStageWidth = resolveStageSize(stageWidth, DEFAULT_STAGE_WIDTH);
  const safeStageHeight = resolveStageSize(stageHeight, DEFAULT_STAGE_HEIGHT);
  return {
    x: (safeStageWidth / 2 - viewport.x) / viewport.zoom,
    y: (safeStageHeight / 2 - viewport.y) / viewport.zoom
  };
};

const computeNodeBounds = (nodes: CanvasNode[]): NodeBounds | null => {
  if (nodes.length === 0) {
    return null;
  }
  const minX = Math.min(...nodes.map((node) => node.rect.x));
  const minY = Math.min(...nodes.map((node) => node.rect.y));
  const maxX = Math.max(...nodes.map((node) => node.rect.x + node.rect.width));
  const maxY = Math.max(...nodes.map((node) => node.rect.y + node.rect.height));
  return {
    minX,
    minY,
    width: Math.max(maxX - minX, 1),
    height: Math.max(maxY - minY, 1)
  };
};

export const computeFittedViewport = (
  nodes: CanvasNode[],
  stageWidth?: number,
  stageHeight?: number
): CanvasEditorViewport => {
  const bounds = computeNodeBounds(nodes);
  if (!bounds) {
    return { ...DEFAULT_EDITOR_VIEWPORT };
  }
  const safeStageWidth = resolveStageSize(stageWidth, DEFAULT_STAGE_WIDTH);
  const safeStageHeight = resolveStageSize(stageHeight, DEFAULT_STAGE_HEIGHT);
  const availableWidth = Math.max(safeStageWidth - FIT_PADDING * 2, 160);
  const availableHeight = Math.max(safeStageHeight - FIT_PADDING * 2, 160);
  const nextZoom = clamp(
    Math.min(availableWidth / bounds.width, availableHeight / bounds.height, 1),
    MIN_ZOOM,
    MAX_ZOOM
  );
  const zoom = roundZoom(nextZoom);
  const centeredX = (safeStageWidth - bounds.width * zoom) / 2 - bounds.minX * zoom;
  const centeredY = (safeStageHeight - bounds.height * zoom) / 2 - bounds.minY * zoom;
  const anchoredY = DEFAULT_EDITOR_VIEWPORT.y - bounds.minY * zoom;
  return {
    x: Math.round(centeredX),
    y: Math.round(Math.min(centeredY, anchoredY)),
    zoom
  };
};
