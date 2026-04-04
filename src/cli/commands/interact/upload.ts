import type { ParsedArgs } from "../../args";
import { callDaemon } from "../../client";
import { createUsageError } from "../../errors";
import { parseOptionalStringFlag, parseStringArrayFlag } from "../../utils/parse";

type UploadArgs = {
  sessionId?: string;
  targetId?: string;
  ref?: string;
  files?: string[];
};

function parseUploadArgs(rawArgs: string[]): UploadArgs {
  return {
    sessionId: parseOptionalStringFlag(rawArgs, "--session-id"),
    targetId: parseOptionalStringFlag(rawArgs, "--target-id"),
    ref: parseOptionalStringFlag(rawArgs, "--ref"),
    files: parseStringArrayFlag(rawArgs, "--files")
  };
}

export async function runUpload(args: ParsedArgs) {
  const { sessionId, targetId, ref, files } = parseUploadArgs(args.rawArgs);
  if (!sessionId) throw createUsageError("Missing --session-id");
  if (!ref) throw createUsageError("Missing --ref");
  if (!files) throw createUsageError("Missing --files");
  const result = await callDaemon("interact.upload", {
    sessionId,
    ref,
    files,
    ...(typeof targetId === "string" ? { targetId } : {})
  });
  return { success: true, message: "Upload complete.", data: result };
}

export const __test__ = {
  parseUploadArgs
};
