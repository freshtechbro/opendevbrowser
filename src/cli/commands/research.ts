import type { ParsedArgs } from "../args";
import { callDaemon } from "../client";
import { createUsageError } from "../errors";
import { parseNumberFlag } from "../utils/parse";

type ResearchCommandArgs = {
  topic?: string;
  days?: number;
  from?: string;
  to?: string;
  sourceSelection?: "auto" | "web" | "community" | "social" | "shopping" | "all";
  sources?: Array<"web" | "community" | "social" | "shopping">;
  mode?: "compact" | "json" | "md" | "context" | "path";
  includeEngagement?: boolean;
  limitPerSource?: number;
  outputDir?: string;
  ttlHours?: number;
};

const SOURCE_VALUES = new Set(["web", "community", "social", "shopping"]);
const SOURCE_SELECTION_VALUES = new Set(["auto", "web", "community", "social", "shopping", "all"]);
const MODE_VALUES = new Set(["compact", "json", "md", "context", "path"]);

const requireValue = (rawArgs: string[], index: number, flag: string): string => {
  const value = rawArgs[index + 1];
  if (!value) {
    throw createUsageError(`Missing value for ${flag}`);
  }
  return value;
};

const parseSources = (raw: string): Array<"web" | "community" | "social" | "shopping"> => {
  const parsed = raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  if (parsed.length === 0) {
    throw createUsageError("--sources requires at least one source");
  }

  const deduped = [...new Set(parsed)];
  for (const source of deduped) {
    if (!SOURCE_VALUES.has(source)) {
      throw createUsageError(`Invalid --sources value: ${source}`);
    }
  }
  return deduped as Array<"web" | "community" | "social" | "shopping">;
};

const parseResearchRunArgs = (rawArgs: string[]): ResearchCommandArgs => {
  const parsed: ResearchCommandArgs = {};

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--topic") {
      parsed.topic = requireValue(rawArgs, index, "--topic");
      index += 1;
      continue;
    }
    if (arg?.startsWith("--topic=")) {
      parsed.topic = arg.split("=", 2)[1];
      continue;
    }

    if (arg === "--days") {
      parsed.days = parseNumberFlag(requireValue(rawArgs, index, "--days"), "--days", { min: 1, max: 365 });
      index += 1;
      continue;
    }
    if (arg?.startsWith("--days=")) {
      parsed.days = parseNumberFlag(arg.split("=", 2)[1] ?? "", "--days", { min: 1, max: 365 });
      continue;
    }

    if (arg === "--from") {
      parsed.from = requireValue(rawArgs, index, "--from");
      index += 1;
      continue;
    }
    if (arg?.startsWith("--from=")) {
      parsed.from = arg.split("=", 2)[1];
      continue;
    }

    if (arg === "--to") {
      parsed.to = requireValue(rawArgs, index, "--to");
      index += 1;
      continue;
    }
    if (arg?.startsWith("--to=")) {
      parsed.to = arg.split("=", 2)[1];
      continue;
    }

    if (arg === "--source-selection") {
      const value = requireValue(rawArgs, index, "--source-selection").toLowerCase();
      if (!SOURCE_SELECTION_VALUES.has(value)) {
        throw createUsageError(`Invalid --source-selection: ${value}`);
      }
      parsed.sourceSelection = value as ResearchCommandArgs["sourceSelection"];
      index += 1;
      continue;
    }
    if (arg?.startsWith("--source-selection=")) {
      const value = (arg.split("=", 2)[1] ?? "").toLowerCase();
      if (!SOURCE_SELECTION_VALUES.has(value)) {
        throw createUsageError(`Invalid --source-selection: ${value}`);
      }
      parsed.sourceSelection = value as ResearchCommandArgs["sourceSelection"];
      continue;
    }

    if (arg === "--sources") {
      parsed.sources = parseSources(requireValue(rawArgs, index, "--sources"));
      index += 1;
      continue;
    }
    if (arg?.startsWith("--sources=")) {
      parsed.sources = parseSources(arg.split("=", 2)[1] ?? "");
      continue;
    }

    if (arg === "--mode") {
      const value = requireValue(rawArgs, index, "--mode").toLowerCase();
      if (!MODE_VALUES.has(value)) {
        throw createUsageError(`Invalid --mode: ${value}`);
      }
      parsed.mode = value as ResearchCommandArgs["mode"];
      index += 1;
      continue;
    }
    if (arg?.startsWith("--mode=")) {
      const value = (arg.split("=", 2)[1] ?? "").toLowerCase();
      if (!MODE_VALUES.has(value)) {
        throw createUsageError(`Invalid --mode: ${value}`);
      }
      parsed.mode = value as ResearchCommandArgs["mode"];
      continue;
    }

    if (arg === "--include-engagement") {
      parsed.includeEngagement = true;
      continue;
    }

    if (arg === "--limit-per-source") {
      parsed.limitPerSource = parseNumberFlag(requireValue(rawArgs, index, "--limit-per-source"), "--limit-per-source", { min: 1, max: 100 });
      index += 1;
      continue;
    }
    if (arg?.startsWith("--limit-per-source=")) {
      parsed.limitPerSource = parseNumberFlag(arg.split("=", 2)[1] ?? "", "--limit-per-source", { min: 1, max: 100 });
      continue;
    }

    if (arg === "--output-dir") {
      parsed.outputDir = requireValue(rawArgs, index, "--output-dir");
      index += 1;
      continue;
    }
    if (arg?.startsWith("--output-dir=")) {
      parsed.outputDir = arg.split("=", 2)[1];
      continue;
    }

    if (arg === "--ttl-hours") {
      parsed.ttlHours = parseNumberFlag(requireValue(rawArgs, index, "--ttl-hours"), "--ttl-hours", { min: 1, max: 168 });
      index += 1;
      continue;
    }
    if (arg?.startsWith("--ttl-hours=")) {
      parsed.ttlHours = parseNumberFlag(arg.split("=", 2)[1] ?? "", "--ttl-hours", { min: 1, max: 168 });
      continue;
    }
  }

  return parsed;
};

export async function runResearchCommand(args: ParsedArgs) {
  const [subcommand, ...rest] = args.rawArgs;
  if (subcommand !== "run") {
    throw createUsageError("Usage: opendevbrowser research run --topic <value> [options]");
  }

  const parsed = parseResearchRunArgs(rest);
  if (!parsed.topic?.trim()) {
    throw createUsageError("Missing --topic");
  }

  const data = await callDaemon("research.run", {
    topic: parsed.topic,
    days: parsed.days,
    from: parsed.from,
    to: parsed.to,
    sourceSelection: parsed.sourceSelection,
    sources: parsed.sources,
    mode: parsed.mode ?? "compact",
    includeEngagement: parsed.includeEngagement ?? false,
    limitPerSource: parsed.limitPerSource,
    outputDir: parsed.outputDir,
    ttlHours: parsed.ttlHours
  });

  return {
    success: true,
    message: "Research workflow completed.",
    data
  };
}

export const __test__ = {
  parseResearchRunArgs,
  parseSources
};
