import type { ToolDeps } from "./deps";
import { resolveWorkflowArtifactRoot } from "../providers/workflow-output-root";

export const WORKFLOW_OUTPUT_DIR_ARGUMENT_DESCRIPTION = [
  "Optional workflow output root.",
  "Omit for the default workflow bundle; after execution, inspect the returned artifact_path first.",
  "Persisted default bundles use .opendevbrowser/<namespace>/<runId>.",
  "If an explicit root is required, prefer .opendevbrowser unless an intentional temp, release, debug, audit, screenshot, or screencast lane needs another root."
].join(" ");

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
