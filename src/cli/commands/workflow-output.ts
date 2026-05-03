import { resolve } from "path";
import { createUsageError } from "../errors";

export const resolveWorkflowOutputDirFlag = (value = ".opendevbrowser", flag = "--output-dir"): string => {
  if (value.trim() === "") {
    throw createUsageError(`Missing value for ${flag}`);
  }
  return resolve(value);
};
