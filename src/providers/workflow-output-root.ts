import { join } from "path";

export const WORKFLOW_ARTIFACT_DIRECTORY = ".opendevbrowser";

export type WorkflowArtifactRootOptions = {
  workspaceRoot?: string;
};

export const resolveWorkflowArtifactRoot = (
  outputDir?: string,
  options: WorkflowArtifactRootOptions = {}
): string => {
  if (outputDir === undefined) {
    return join(options.workspaceRoot ?? process.cwd(), WORKFLOW_ARTIFACT_DIRECTORY);
  }
  if (outputDir.trim() === "") {
    throw new Error("outputDir cannot be empty");
  }
  return outputDir;
};
