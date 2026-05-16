import { resolve } from "path";
import { createUsageError } from "../errors";
import { WORKFLOW_ARTIFACT_DIRECTORY } from "../../providers/workflow-output-root";

export const resolveWorkflowOutputDirFlag = (
  value = WORKFLOW_ARTIFACT_DIRECTORY,
  flag = "--output-dir"
): string => {
  if (value.trim() === "") {
    throw createUsageError(`Missing value for ${flag}`);
  }
  return resolve(value);
};
