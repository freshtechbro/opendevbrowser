import type { ToolDeps } from "./deps";
import { resolveWorkflowArtifactRoot } from "../providers/workflow-output-root";

export const resolveWorkflowToolOutputDir = (
  deps: Pick<ToolDeps, "workspaceRoot">,
  outputDir?: string
): string | undefined => {
  if (outputDir !== undefined) {
    return outputDir;
  }
  if (!deps.workspaceRoot) {
    return undefined;
  }
  return resolveWorkflowArtifactRoot(undefined, { workspaceRoot: deps.workspaceRoot });
};
