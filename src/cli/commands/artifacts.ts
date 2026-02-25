import { join, resolve } from "path";
import { tmpdir } from "os";
import type { ParsedArgs } from "../args";
import { createUsageError } from "../errors";
import { cleanupExpiredArtifacts } from "../../providers/artifacts";

type ArtifactsSubcommand = "cleanup";

interface CleanupArgs {
  subcommand: ArtifactsSubcommand;
  expiredOnly: boolean;
  outputDir?: string;
}

const usageError = (): never => {
  throw createUsageError("Usage: opendevbrowser artifacts cleanup --expired-only [--output-dir <path>]");
};

const requireValue = (rawArgs: string[], index: number, flag: string): string => {
  const value = rawArgs[index + 1];
  if (!value) {
    throw createUsageError(`Missing value for ${flag}`);
  }
  return value;
};

const parseArtifactsArgs = (rawArgs: string[]): CleanupArgs => {
  const [candidate, ...rest] = rawArgs;
  if (candidate !== "cleanup") {
    usageError();
  }
  const subcommand: ArtifactsSubcommand = "cleanup";

  let expiredOnly = false;
  let outputDir: string | undefined;

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--expired-only") {
      expiredOnly = true;
      continue;
    }

    if (arg === "--output-dir") {
      outputDir = requireValue(rest, index, "--output-dir");
      index += 1;
      continue;
    }

    if (arg?.startsWith("--output-dir=")) {
      const value = arg.split("=", 2)[1];
      if (!value) {
        throw createUsageError("Missing value for --output-dir");
      }
      outputDir = value;
      continue;
    }

    throw createUsageError(`Unknown artifacts flag: ${arg}`);
  }

  if (!expiredOnly) {
    usageError();
  }

  return {
    subcommand,
    expiredOnly,
    outputDir
  };
};

export async function runArtifactsCommand(args: ParsedArgs) {
  const parsed = parseArtifactsArgs(args.rawArgs);
  const rootDir = parsed.outputDir ? resolve(parsed.outputDir) : join(tmpdir(), "opendevbrowser");
  const cleaned = await cleanupExpiredArtifacts(rootDir);

  return {
    success: true,
    message: `Artifact cleanup completed. Removed ${cleaned.removed.length} expired run(s).`,
    data: {
      rootDir,
      expiredOnly: parsed.expiredOnly,
      removed: cleaned.removed,
      skipped: cleaned.skipped,
      removedCount: cleaned.removed.length,
      skippedCount: cleaned.skipped.length
    }
  };
}

export const __test__ = {
  parseArtifactsArgs
};
