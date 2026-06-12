import {
  INSPIREDESIGN_MEDIA_ANALYSIS_MAX_LAYOUT_ZONES,
  INSPIREDESIGN_MEDIA_ANALYSIS_MAX_PALETTE_SWATCHES,
  type InspiredesignMediaFrameToneSummary,
  type InspiredesignMediaLayoutFacts,
  type InspiredesignMediaLayoutZone,
  type InspiredesignMediaMotionFacts,
  type InspiredesignMediaPaletteSwatch,
  type InspiredesignMediaToneFacts,
  type InspiredesignRgbFrame
} from "./types";

const RGB_CHANNEL_COUNT = 3;
const LUMINANCE_RED_WEIGHT = 0.2126;
const LUMINANCE_GREEN_WEIGHT = 0.7152;
const LUMINANCE_BLUE_WEIGHT = 0.0722;
const DARK_LUMINANCE_THRESHOLD = 64;
const BRIGHT_LUMINANCE_THRESHOLD = 192;
const HIGH_CONTRAST_STDDEV_THRESHOLD = 54;
const LOW_CONTRAST_STDDEV_THRESHOLD = 24;
const DENSE_EDGE_THRESHOLD = 0.11;
const SPARSE_EDGE_THRESHOLD = 0.035;
const EDGE_DELTA_THRESHOLD = 42;
const RGB_QUANTIZATION_STEP = 64;
const RGB_QUANTIZATION_CENTER_OFFSET = 32;
const RGB_MAX_CHANNEL_VALUE = 255;
const ROUND_DECIMAL_FACTOR = 10_000;
const LAYOUT_GRID_COLUMNS = 3;
const LAYOUT_GRID_ROWS = 3;
const FOCAL_COVERAGE_THRESHOLD = 0.18;
const WHITESPACE_LUMINANCE_DISTANCE = 18;
const SPLIT_BALANCE_DELTA = 0.12;
const GRID_ROW_COVERAGE_THRESHOLD = 0.34;
const SLOW_MOTION_DELTA = 0.08;
const MODERATE_MOTION_DELTA = 0.18;
const FAST_MOTION_FPS = 48;

export type InspiredesignFramePixelAnalysis = {
  tone: InspiredesignMediaToneFacts;
  palette: InspiredesignMediaPaletteSwatch[];
  layout: InspiredesignMediaLayoutFacts;
};

export const analyzeInspiredesignRgbFrame = (frame: InspiredesignRgbFrame): InspiredesignFramePixelAnalysis => {
  const luminanceValues = collectLuminance(frame);
  const tone = analyzeTone(frame, luminanceValues);
  return {
    tone,
    palette: buildPalette(frame),
    layout: analyzeLayout(frame, luminanceValues, tone.meanLuminance)
  };
};

export const buildInspiredesignMotionFacts = (
  frames: readonly InspiredesignRgbFrame[],
  fps?: number
): InspiredesignMediaMotionFacts => {
  const frameToneSummaries = frames.map((frame) => summarizeFrameTone(frame));
  const frameDeltas = collectFrameDeltas(frames);
  const averageFrameDelta = average(frameDeltas);
  return {
    sampledFrameCount: frames.length,
    sampledFrameIndexes: frames.map((frame) => frame.frameIndex),
    frameDeltas,
    averageFrameDelta,
    cadence: chooseCadence(averageFrameDelta, fps),
    posture: chooseMotionPosture(averageFrameDelta, frames.length),
    frameToneSummaries
  };
};

const analyzeTone = (frame: InspiredesignRgbFrame, luminanceValues: readonly number[]): InspiredesignMediaToneFacts => {
  const meanLuminance = average(luminanceValues);
  const luminanceStandardDeviation = standardDeviation(luminanceValues, meanLuminance);
  const darkCoverage = coverage(luminanceValues, (value) => value < DARK_LUMINANCE_THRESHOLD);
  const brightCoverage = coverage(luminanceValues, (value) => value > BRIGHT_LUMINANCE_THRESHOLD);
  const edgeDensity = calculateEdgeDensity(frame, luminanceValues);
  return {
    meanLuminance: round(meanLuminance),
    luminanceStandardDeviation: round(luminanceStandardDeviation),
    darkCoverage: round(darkCoverage),
    brightCoverage: round(brightCoverage),
    midtoneCoverage: round(Math.max(0, 1 - darkCoverage - brightCoverage)),
    contrastPosture: chooseContrastPosture(luminanceStandardDeviation),
    densityPosture: chooseDensityPosture(edgeDensity),
    edgeDensity: round(edgeDensity)
  };
};

const buildPalette = (frame: InspiredesignRgbFrame): InspiredesignMediaPaletteSwatch[] => {
  const counts = new Map<string, number>();
  const totalPixels = frame.width * frame.height;
  for (let offset = 0; offset < frame.data.length; offset += RGB_CHANNEL_COUNT) {
    const hex = quantizedHex(frame.data[offset] ?? 0, frame.data[offset + 1] ?? 0, frame.data[offset + 2] ?? 0);
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, INSPIREDESIGN_MEDIA_ANALYSIS_MAX_PALETTE_SWATCHES)
    .map(([hex, count], index) => ({ hex, coverage: round(count / totalPixels), roleHint: chooseRoleHint(hex, index) }));
};

const analyzeLayout = (
  frame: InspiredesignRgbFrame,
  luminanceValues: readonly number[],
  meanLuminance: number
): InspiredesignMediaLayoutFacts => {
  const zones = buildLayoutZones(frame, luminanceValues, meanLuminance);
  const whitespaceCoverage = coverage(luminanceValues, (value) => Math.abs(value - meanLuminance) <= WHITESPACE_LUMINANCE_DISTANCE);
  return {
    composition: chooseComposition(frame, zones),
    whitespaceCoverage: round(whitespaceCoverage),
    focalRegions: zones.filter((zone) => zone.role === "focal_region").slice(0, INSPIREDESIGN_MEDIA_ANALYSIS_MAX_LAYOUT_ZONES),
    zones
  };
};

const buildLayoutZones = (
  frame: InspiredesignRgbFrame,
  luminanceValues: readonly number[],
  meanLuminance: number
): InspiredesignMediaLayoutZone[] => {
  const cells = collectGridCells(frame, luminanceValues, meanLuminance);
  const zones = cells
    .filter((cell) => cell.coverage >= FOCAL_COVERAGE_THRESHOLD)
    .map((cell): InspiredesignMediaLayoutZone => ({
      role: chooseZoneRole(cell.column, cell.row),
      bboxNorm: normalizeCell(cell.column, cell.row),
      confidence: round(Math.min(0.95, 0.45 + cell.coverage))
    }));
  return zones.slice(0, INSPIREDESIGN_MEDIA_ANALYSIS_MAX_LAYOUT_ZONES);
};

const collectGridCells = (frame: InspiredesignRgbFrame, luminanceValues: readonly number[], meanLuminance: number) => {
  const cells = Array.from({ length: LAYOUT_GRID_COLUMNS * LAYOUT_GRID_ROWS }, (_, index) => ({
    column: index % LAYOUT_GRID_COLUMNS,
    row: Math.floor(index / LAYOUT_GRID_COLUMNS),
    activePixels: 0,
    totalPixels: 0,
    coverage: 0
  }));
  luminanceValues.forEach((value, index) => {
    const x = index % frame.width;
    const y = Math.floor(index / frame.width);
    const column = Math.min(LAYOUT_GRID_COLUMNS - 1, Math.floor((x / frame.width) * LAYOUT_GRID_COLUMNS));
    const row = Math.min(LAYOUT_GRID_ROWS - 1, Math.floor((y / frame.height) * LAYOUT_GRID_ROWS));
    const cell = cells[row * LAYOUT_GRID_COLUMNS + column];
    if (!cell) {
      return;
    }
    cell.totalPixels += 1;
    if (Math.abs(value - meanLuminance) > WHITESPACE_LUMINANCE_DISTANCE) {
      cell.activePixels += 1;
    }
  });
  return cells.map((cell) => ({ ...cell, coverage: cell.totalPixels > 0 ? cell.activePixels / cell.totalPixels : 0 }));
};

const chooseComposition = (frame: InspiredesignRgbFrame, zones: readonly InspiredesignMediaLayoutZone[]): InspiredesignMediaLayoutFacts["composition"] => {
  const leftConfidence = sumConfidence(zones.filter((zone) => zone.bboxNorm[0] < 0.34));
  const rightConfidence = sumConfidence(zones.filter((zone) => zone.bboxNorm[0] > 0.34));
  const bottomZones = zones.filter((zone) => zone.bboxNorm[1] > 0.55).length;
  if (bottomZones >= 2) {
    return "upper hero with lower grid";
  }
  if (leftConfidence - rightConfidence > SPLIT_BALANCE_DELTA) {
    return "left-weighted split hero";
  }
  if (rightConfidence - leftConfidence > SPLIT_BALANCE_DELTA) {
    return "right-weighted split hero";
  }
  if (zones.length >= GRID_ROW_COVERAGE_THRESHOLD * LAYOUT_GRID_ROWS * LAYOUT_GRID_COLUMNS) {
    return "dense grid composition";
  }
  return frame.width > frame.height ? "centered editorial composition" : "balanced poster composition";
};

const chooseZoneRole = (column: number, row: number): InspiredesignMediaLayoutZone["role"] => {
  if (row === 0 && column === 0) {
    return "navigation";
  }
  if (row === 1 && column === 0) {
    return "hero_copy";
  }
  if (row <= 1 && column >= 1) {
    return "hero_media";
  }
  if (row === 2) {
    return "portfolio_grid";
  }
  return "focal_region";
};

const normalizeCell = (column: number, row: number): [number, number, number, number] => [
  round(column / LAYOUT_GRID_COLUMNS),
  round(row / LAYOUT_GRID_ROWS),
  round(1 / LAYOUT_GRID_COLUMNS),
  round(1 / LAYOUT_GRID_ROWS)
];

const collectFrameDeltas = (frames: readonly InspiredesignRgbFrame[]): number[] => {
  const deltas: number[] = [];
  for (let index = 1; index < frames.length; index += 1) {
    const previousFrame = frames[index - 1];
    const currentFrame = frames[index];
    if (previousFrame && currentFrame) {
      deltas.push(round(calculateFrameDelta(previousFrame, currentFrame)));
    }
  }
  return deltas;
};

const calculateFrameDelta = (left: InspiredesignRgbFrame, right: InspiredesignRgbFrame): number => {
  const byteLength = Math.min(left.data.length, right.data.length);
  let totalDelta = 0;
  for (let index = 0; index < byteLength; index += RGB_CHANNEL_COUNT) {
    totalDelta += Math.abs((left.data[index] ?? 0) - (right.data[index] ?? 0));
    totalDelta += Math.abs((left.data[index + 1] ?? 0) - (right.data[index + 1] ?? 0));
    totalDelta += Math.abs((left.data[index + 2] ?? 0) - (right.data[index + 2] ?? 0));
  }
  return totalDelta / (byteLength * RGB_MAX_CHANNEL_VALUE);
};

const summarizeFrameTone = (frame: InspiredesignRgbFrame): InspiredesignMediaFrameToneSummary => {
  const tone = analyzeTone(frame, collectLuminance(frame));
  return {
    frameIndex: frame.frameIndex,
    meanLuminance: tone.meanLuminance,
    darkCoverage: tone.darkCoverage,
    brightCoverage: tone.brightCoverage
  };
};

const collectLuminance = (frame: InspiredesignRgbFrame): number[] => {
  const luminanceValues: number[] = [];
  for (let offset = 0; offset < frame.data.length; offset += RGB_CHANNEL_COUNT) {
    luminanceValues.push(luminance(frame.data[offset] ?? 0, frame.data[offset + 1] ?? 0, frame.data[offset + 2] ?? 0));
  }
  return luminanceValues;
};

const calculateEdgeDensity = (frame: InspiredesignRgbFrame, luminanceValues: readonly number[]): number => {
  let edgeCount = 0;
  let comparisonCount = 0;
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const current = luminanceValues[y * frame.width + x] ?? 0;
      const right = x + 1 < frame.width ? luminanceValues[y * frame.width + x + 1] : undefined;
      const below = y + 1 < frame.height ? luminanceValues[(y + 1) * frame.width + x] : undefined;
      if (right !== undefined) {
        comparisonCount += 1;
        edgeCount += Math.abs(current - right) >= EDGE_DELTA_THRESHOLD ? 1 : 0;
      }
      if (below !== undefined) {
        comparisonCount += 1;
        edgeCount += Math.abs(current - below) >= EDGE_DELTA_THRESHOLD ? 1 : 0;
      }
    }
  }
  return comparisonCount > 0 ? edgeCount / comparisonCount : 0;
};

const luminance = (red: number, green: number, blue: number): number =>
  red * LUMINANCE_RED_WEIGHT + green * LUMINANCE_GREEN_WEIGHT + blue * LUMINANCE_BLUE_WEIGHT;

const quantizedHex = (red: number, green: number, blue: number): string =>
  `#${toHex(quantizeChannel(red))}${toHex(quantizeChannel(green))}${toHex(quantizeChannel(blue))}`;

const quantizeChannel = (value: number): number =>
  Math.min(RGB_MAX_CHANNEL_VALUE, Math.floor(value / RGB_QUANTIZATION_STEP) * RGB_QUANTIZATION_STEP + RGB_QUANTIZATION_CENTER_OFFSET);

const toHex = (value: number): string => value.toString(16).padStart(2, "0").toUpperCase();

const chooseRoleHint = (hex: string, index: number): InspiredesignMediaPaletteSwatch["roleHint"] => {
  const brightness = hexBrightness(hex);
  if (index === 0) {
    return brightness < DARK_LUMINANCE_THRESHOLD ? "background" : "surface";
  }
  if (brightness > BRIGHT_LUMINANCE_THRESHOLD) {
    return "foreground";
  }
  return index <= 2 ? "muted foreground" : "accent";
};

const hexBrightness = (hex: string): number => {
  const red = Number.parseInt(hex.slice(1, 3), 16);
  const green = Number.parseInt(hex.slice(3, 5), 16);
  const blue = Number.parseInt(hex.slice(5, 7), 16);
  return luminance(red, green, blue);
};

const chooseContrastPosture = (standardDeviationValue: number): InspiredesignMediaToneFacts["contrastPosture"] => {
  if (standardDeviationValue >= HIGH_CONTRAST_STDDEV_THRESHOLD) {
    return "high";
  }
  if (standardDeviationValue <= LOW_CONTRAST_STDDEV_THRESHOLD) {
    return "low";
  }
  return "moderate";
};

const chooseDensityPosture = (edgeDensity: number): InspiredesignMediaToneFacts["densityPosture"] => {
  if (edgeDensity >= DENSE_EDGE_THRESHOLD) {
    return "dense";
  }
  if (edgeDensity <= SPARSE_EDGE_THRESHOLD) {
    return "sparse";
  }
  return "balanced";
};

const chooseCadence = (averageFrameDelta: number, fps?: number): InspiredesignMediaMotionFacts["cadence"] => {
  if (averageFrameDelta <= 0) {
    return "static";
  }
  if (fps && fps >= FAST_MOTION_FPS) {
    return "fast";
  }
  if (averageFrameDelta < SLOW_MOTION_DELTA) {
    return "slow";
  }
  return averageFrameDelta < MODERATE_MOTION_DELTA ? "moderate" : "fast";
};

const chooseMotionPosture = (averageFrameDelta: number, frameCount: number): InspiredesignMediaMotionFacts["posture"] => {
  if (frameCount <= 1) {
    return "static_source_adaptation";
  }
  if (averageFrameDelta < SLOW_MOTION_DELTA) {
    return "stable_loop";
  }
  return averageFrameDelta < MODERATE_MOTION_DELTA ? "subtle_motion" : "dynamic_motion";
};

const coverage = (values: readonly number[], predicate: (value: number) => boolean): number => {
  if (values.length === 0) {
    return 0;
  }
  return values.filter(predicate).length / values.length;
};

const average = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;

const standardDeviation = (values: readonly number[], mean: number): number => {
  const variance = average(values.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance);
};

const sumConfidence = (zones: readonly InspiredesignMediaLayoutZone[]): number =>
  zones.reduce((total, zone) => total + zone.confidence, 0);

const round = (value: number): number => Math.round(value * ROUND_DECIMAL_FACTOR) / ROUND_DECIMAL_FACTOR;
