import {
  INSPIREDESIGN_MEDIA_ANALYSIS_MAX_TEXT_REGIONS,
  type InspiredesignMediaTextRegion,
  type InspiredesignMediaTextRegionRole,
  type InspiredesignMediaTypographyStructureFacts,
  type InspiredesignRgbFrame
} from "./types";

const RGB_CHANNEL_COUNT = 3;
const LUMINANCE_RED_WEIGHT = 0.2126;
const LUMINANCE_GREEN_WEIGHT = 0.7152;
const LUMINANCE_BLUE_WEIGHT = 0.0722;
const TEXT_LUMINANCE_DELTA_THRESHOLD = 58;
const MIN_TEXT_REGION_WIDTH_RATIO = 0.025;
const MIN_TEXT_REGION_HEIGHT_RATIO = 0.01;
const MIN_TEXT_REGION_AREA_RATIO = 0.0005;
const SMALL_SCALE_HEIGHT_RATIO = 0.045;
const LARGE_SCALE_HEIGHT_RATIO = 0.11;
const HIGH_CONTRAST_REGION_DELTA = 96;
const TOP_REGION_Y_RATIO = 0.16;
const HERO_REGION_Y_RATIO = 0.5;
const LOWER_REGION_Y_RATIO = 0.62;
const LEFT_ALIGNMENT_RATIO = 0.38;
const RIGHT_ALIGNMENT_RATIO = 0.62;
const REPETITION_ROW_DELTA = 0.08;
const POSTURE_DENSE_REGION_COUNT = 7;
const POSTURE_SPARSE_REGION_COUNT = 3;
const ROUND_DECIMAL_FACTOR = 10_000;

type RegionBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  pixelCount: number;
  meanDelta: number;
};

export const analyzeInspiredesignTypographyStructure = (
  frame: InspiredesignRgbFrame
): InspiredesignMediaTypographyStructureFacts => {
  const backgroundLuminance = estimateBackgroundLuminance(frame);
  const regions = detectTextRegions(frame, backgroundLuminance)
    .map((bounds) => toTextRegion(bounds, frame))
    .sort((left, right) => left.bboxNorm[1] - right.bboxNorm[1] || left.bboxNorm[0] - right.bboxNorm[0])
    .slice(0, INSPIREDESIGN_MEDIA_ANALYSIS_MAX_TEXT_REGIONS);
  return {
    readableTextAvailable: false,
    posture: summarizePosture(regions),
    regions,
    textRegionLayout: {
      summary: summarizeTextRegionLayout(regions),
      regionCount: regions.length,
      repeatedRegionCount: countRepeatedRegions(regions),
      dominantAlignment: dominantAlignment(regions)
    }
  };
};

const detectTextRegions = (frame: InspiredesignRgbFrame, backgroundLuminance: number): RegionBounds[] => {
  const mask = buildContrastMask(frame, backgroundLuminance);
  const visited = new Uint8Array(mask.length);
  const regions: RegionBounds[] = [];
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] !== 1 || visited[index] === 1) {
      continue;
    }
    const bounds = collectRegion(index, frame, mask, visited, backgroundLuminance);
    if (isPlausibleTextRegion(bounds, frame)) {
      regions.push(bounds);
    }
  }
  return regions;
};

const collectRegion = (
  startIndex: number,
  frame: InspiredesignRgbFrame,
  mask: Uint8Array,
  visited: Uint8Array,
  backgroundLuminance: number
): RegionBounds => {
  const queue = [startIndex];
  const bounds = createInitialBounds(startIndex, frame);
  visited[startIndex] = 1;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const pixelIndex = queue[cursor] ?? 0;
    updateBounds(bounds, pixelIndex, frame, backgroundLuminance);
    for (const neighbor of collectNeighbors(pixelIndex, frame)) {
      if (mask[neighbor] === 1 && visited[neighbor] !== 1) {
        visited[neighbor] = 1;
        queue.push(neighbor);
      }
    }
  }
  bounds.meanDelta = bounds.pixelCount > 0 ? bounds.meanDelta / bounds.pixelCount : 0;
  return bounds;
};

const buildContrastMask = (frame: InspiredesignRgbFrame, backgroundLuminance: number): Uint8Array => {
  const mask = new Uint8Array(frame.width * frame.height);
  for (let pixelIndex = 0; pixelIndex < mask.length; pixelIndex += 1) {
    const value = pixelLuminance(frame, pixelIndex);
    if (Math.abs(value - backgroundLuminance) >= TEXT_LUMINANCE_DELTA_THRESHOLD) {
      mask[pixelIndex] = 1;
    }
  }
  return mask;
};

const estimateBackgroundLuminance = (frame: InspiredesignRgbFrame): number => {
  const samples = [0, frame.width - 1, (frame.height - 1) * frame.width, frame.height * frame.width - 1]
    .filter((index) => index >= 0 && index < frame.width * frame.height)
    .map((index) => pixelLuminance(frame, index));
  return average(samples);
};

const toTextRegion = (bounds: RegionBounds, frame: InspiredesignRgbFrame): InspiredesignMediaTextRegion => {
  const bboxNorm = normalizeBounds(bounds, frame);
  return {
    role: chooseRegionRole(bboxNorm),
    bboxNorm,
    scale: chooseScale(bboxNorm[3]),
    contrast: bounds.meanDelta >= HIGH_CONTRAST_REGION_DELTA ? "high" : "muted",
    alignment: chooseAlignment(bboxNorm[0] + bboxNorm[2] / 2),
    confidence: round(Math.min(0.9, 0.48 + bounds.pixelCount / (frame.width * frame.height)))
  };
};

const isPlausibleTextRegion = (bounds: RegionBounds, frame: InspiredesignRgbFrame): boolean => {
  const widthRatio = (bounds.maxX - bounds.minX + 1) / frame.width;
  const heightRatio = (bounds.maxY - bounds.minY + 1) / frame.height;
  const areaRatio = bounds.pixelCount / (frame.width * frame.height);
  return widthRatio >= MIN_TEXT_REGION_WIDTH_RATIO && heightRatio >= MIN_TEXT_REGION_HEIGHT_RATIO && areaRatio >= MIN_TEXT_REGION_AREA_RATIO;
};

const chooseRegionRole = (bboxNorm: [number, number, number, number]): InspiredesignMediaTextRegionRole => {
  if (bboxNorm[1] <= TOP_REGION_Y_RATIO && bboxNorm[3] <= SMALL_SCALE_HEIGHT_RATIO) {
    return "nav_row_candidate";
  }
  if (bboxNorm[1] <= HERO_REGION_Y_RATIO && bboxNorm[3] >= LARGE_SCALE_HEIGHT_RATIO) {
    return "hero_headline_candidate";
  }
  if (bboxNorm[1] <= HERO_REGION_Y_RATIO && bboxNorm[2] <= 0.26) {
    return "cta_cluster_candidate";
  }
  if (bboxNorm[1] <= HERO_REGION_Y_RATIO) {
    return "support_copy_candidate";
  }
  if (bboxNorm[1] >= LOWER_REGION_Y_RATIO) {
    return "portfolio_caption_repetition";
  }
  return "text_region_candidate";
};

const summarizePosture = (regions: readonly InspiredesignMediaTextRegion[]): string => {
  let density = "balanced";
  if (regions.length >= POSTURE_DENSE_REGION_COUNT) {
    density = "dense";
  } else if (regions.length <= POSTURE_SPARSE_REGION_COUNT) {
    density = "sparse";
  }
  const contrast = regions.some((region) => region.contrast === "high") ? "high-contrast" : "muted-contrast";
  const alignment = dominantAlignment(regions);
  return `${density}, ${contrast}, ${alignment}-weighted, OCR-free typography structure`;
};

const summarizeTextRegionLayout = (regions: readonly InspiredesignMediaTextRegion[]): string => {
  if (regions.length === 0) {
    return "No OCR-free text-like regions detected.";
  }
  const roles = new Set(regions.map((region) => region.role));
  const roleList = [...roles].join(", ");
  return `OCR-free text-region geometry suggests ${roleList}. Exact readable text was not extracted.`;
};

const countRepeatedRegions = (regions: readonly InspiredesignMediaTextRegion[]): number =>
  regions.filter((region, index) => regions.some((candidate, candidateIndex) => {
    if (candidateIndex === index) {
      return false;
    }
    return Math.abs(candidate.bboxNorm[1] - region.bboxNorm[1]) <= REPETITION_ROW_DELTA && candidate.scale === region.scale;
  })).length;

const dominantAlignment = (regions: readonly InspiredesignMediaTextRegion[]): "left" | "center" | "right" => {
  const counts = { left: 0, center: 0, right: 0 };
  regions.forEach((region) => {
    counts[region.alignment] += 1;
  });
  if (counts.left >= counts.center && counts.left >= counts.right) {
    return "left";
  }
  return counts.right > counts.center ? "right" : "center";
};

const collectNeighbors = (pixelIndex: number, frame: InspiredesignRgbFrame): number[] => {
  const x = pixelIndex % frame.width;
  const y = Math.floor(pixelIndex / frame.width);
  const neighbors: number[] = [];
  if (x > 0) {
    neighbors.push(pixelIndex - 1);
  }
  if (x + 1 < frame.width) {
    neighbors.push(pixelIndex + 1);
  }
  if (y > 0) {
    neighbors.push(pixelIndex - frame.width);
  }
  if (y + 1 < frame.height) {
    neighbors.push(pixelIndex + frame.width);
  }
  return neighbors;
};

const createInitialBounds = (pixelIndex: number, frame: InspiredesignRgbFrame): RegionBounds => {
  const x = pixelIndex % frame.width;
  const y = Math.floor(pixelIndex / frame.width);
  return { minX: x, minY: y, maxX: x, maxY: y, pixelCount: 0, meanDelta: 0 };
};

const updateBounds = (
  bounds: RegionBounds,
  pixelIndex: number,
  frame: InspiredesignRgbFrame,
  backgroundLuminance: number
): void => {
  const x = pixelIndex % frame.width;
  const y = Math.floor(pixelIndex / frame.width);
  bounds.minX = Math.min(bounds.minX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.maxY = Math.max(bounds.maxY, y);
  bounds.pixelCount += 1;
  bounds.meanDelta += Math.abs(pixelLuminance(frame, pixelIndex) - backgroundLuminance);
};

const normalizeBounds = (bounds: RegionBounds, frame: InspiredesignRgbFrame): [number, number, number, number] => [
  round(bounds.minX / frame.width),
  round(bounds.minY / frame.height),
  round((bounds.maxX - bounds.minX + 1) / frame.width),
  round((bounds.maxY - bounds.minY + 1) / frame.height)
];

const chooseScale = (heightRatio: number): InspiredesignMediaTextRegion["scale"] => {
  if (heightRatio >= LARGE_SCALE_HEIGHT_RATIO) {
    return "large";
  }
  return heightRatio <= SMALL_SCALE_HEIGHT_RATIO ? "small" : "medium";
};

const chooseAlignment = (centerX: number): InspiredesignMediaTextRegion["alignment"] => {
  if (centerX <= LEFT_ALIGNMENT_RATIO) {
    return "left";
  }
  return centerX >= RIGHT_ALIGNMENT_RATIO ? "right" : "center";
};

const pixelLuminance = (frame: InspiredesignRgbFrame, pixelIndex: number): number => {
  const offset = pixelIndex * RGB_CHANNEL_COUNT;
  const red = frame.data[offset] ?? 0;
  const green = frame.data[offset + 1] ?? 0;
  const blue = frame.data[offset + 2] ?? 0;
  return red * LUMINANCE_RED_WEIGHT + green * LUMINANCE_GREEN_WEIGHT + blue * LUMINANCE_BLUE_WEIGHT;
};

const average = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;

const round = (value: number): number => Math.round(value * ROUND_DECIMAL_FACTOR) / ROUND_DECIMAL_FACTOR;
