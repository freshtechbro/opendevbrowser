import { writeFile } from "fs/promises";
import type { InspiredesignMediaAnalysis } from "./types";

export const INSPIREDESIGN_MEDIA_ANALYSIS_ARTIFACT_FILE = "media-analysis.json";

export type InspiredesignMediaAnalysisWriter = (path: string, content: string) => Promise<void>;

export const serializeInspiredesignMediaAnalysis = (analysis: InspiredesignMediaAnalysis): string =>
  `${JSON.stringify(analysis, null, 2)}\n`;

export const persistInspiredesignMediaAnalysis = async (
  path: string,
  analysis: InspiredesignMediaAnalysis,
  writer: InspiredesignMediaAnalysisWriter = writeFile
): Promise<void> => {
  await writer(path, serializeInspiredesignMediaAnalysis(analysis));
};
